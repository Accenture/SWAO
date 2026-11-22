// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live framework selection and provenance
//  (Design 120 section 8.1, #3579)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Frameworks for a live LZ evaluation come from the workspace community
// catalogue only (`<catalogsDir>/community/`), never from bundled copies or a
// network source (Design 120 section 8.1, section 4.2 item 5). The run
// manifest records id, version and the sha256 of framework-meta.yaml,
// controls.yaml and service-controls.yaml per framework.

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
import {
  POLICY_BASELINE_FILE,
  SERVICE_CONTROLS_FILE,
  discoverFrameworks,
  findFramework,
  loadPolicyBaseline,
  loadServiceControls,
  type DiscoveredFramework,
  type PolicyBaseline,
} from '@swao/core';
import { readFrameworkSovereigntyDecls } from '../fit/run-lz.js';
import type { LzLiveEvalFramework } from './lz-live-eval.js';

/**
 * Framework ids for a live run: `--frameworks` (comma-separated), else
 * `assessment.frameworks`, else `assessment.regimes_active`. Same resolution
 * as the LZ catalogue path (`commands/assess.ts`, `lzFwIds`), including `??`:
 * an explicit empty `frameworks: []` does not fall back to `regimes_active`.
 */
export function resolveLzLiveFrameworkIds(
  cliFrameworks: string | undefined,
  assessment: { frameworks?: string[]; regimes_active?: string[] } | undefined,
): string[] {
  return cliFrameworks
    ? cliFrameworks.split(',').map((s) => s.trim()).filter(Boolean)
    : assessment?.frameworks ?? assessment?.regimes_active ?? [];
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** Per-framework provenance in the run manifest (Design 120 sections 7.4, 8.1). */
export const LzLiveManifestFrameworkSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  /** sha256 over the three file hashes below (the `meta.frameworks[].sha256` of the scan). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  files: z.object({
    'framework-meta.yaml': z.string().regex(/^[0-9a-f]{64}$/),
    'controls.yaml': z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    /** null: the framework has no service mapping (every service grey). */
    'service-controls.yaml': z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    /** #3871 (Design 123 section 7.4): present only for a Client LZ Policy Baseline,
     *  so the hash of every other framework stays as it was. */
    'policy-baseline.yaml': z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }).strict(),
}).strict();
export type LzLiveManifestFramework = z.infer<typeof LzLiveManifestFrameworkSchema>;

const fileHash = (path: string): string | null => (existsSync(path) ? sha256(readFileSync(path)) : null);

/** Version of a framework: framework-meta `version`, else `regime_meta.version`
 *  of controls.yaml (required there), else "unversioned". */
function frameworkVersion(fw: DiscoveredFramework): string {
  if (fw.meta.version) return fw.meta.version;
  const controls = join(fw.dir, 'controls.yaml');
  if (existsSync(controls)) {
    try {
      const raw = load(readFileSync(controls, 'utf-8')) as { regime_meta?: { version?: unknown } } | null;
      const v = raw?.regime_meta?.version;
      if (typeof v === 'string' && v.length > 0) return v;
      if (typeof v === 'number') return String(v);
    } catch { /* unreadable controls.yaml: fall through */ }
  }
  return 'unversioned';
}

/** Manifest provenance of one installed framework. The combined sha256 hashes
 *  the line `<file>:<sha256|absent>` for each of the three files in order, and
 *  for a policy baseline a fourth line for policy-baseline.yaml (#3871), so a
 *  changed baseline setting changes the hash. */
export function lzLiveFrameworkProvenance(fw: DiscoveredFramework): LzLiveManifestFramework {
  const baselineHash = fileHash(join(fw.dir, POLICY_BASELINE_FILE));
  const files = {
    'framework-meta.yaml': fileHash(join(fw.dir, 'framework-meta.yaml')) ?? sha256(''),
    'controls.yaml': fileHash(join(fw.dir, 'controls.yaml')),
    'service-controls.yaml': fileHash(join(fw.dir, SERVICE_CONTROLS_FILE)),
    ...(baselineHash !== null ? { 'policy-baseline.yaml': baselineHash } : {}),
  };
  const combined = sha256(Object.entries(files).map(([f, h]) => `${f}:${h ?? 'absent'}\n`).join(''));
  return { id: fw.id, version: frameworkVersion(fw), sha256: combined, files };
}

export interface LzLiveFrameworkSelection {
  frameworks: LzLiveEvalFramework[];
  manifest: LzLiveManifestFramework[];
  /** Requested ids that are not installed in the workspace community catalogue. */
  not_installed: string[];
  /** Installed frameworks whose service-controls.yaml is invalid (treated as no mapping). */
  invalid_mappings: { id: string; errors: string[] }[];
  /** #3871: selected frameworks that are a Client LZ Policy Baseline (have policy-baseline.yaml). */
  baselines: LzLiveSelectedBaseline[];
  /** #3871: selected baselines whose policy-baseline.yaml does not load. */
  invalid_baselines: { id: string; errors: string[] }[];
}

/** A selected Client LZ Policy Baseline (Design 123 section 8). */
export interface LzLiveSelectedBaseline {
  id: string;
  dir: string;
  baseline: PolicyBaseline;
  /** sha256 of policy-baseline.yaml (meta.baseline.sha256 of the scan). */
  sha256: string;
}

/**
 * Load the requested frameworks from `<catalogsDir>/community/` only. Unknown
 * ids are reported, not dropped silently; an invalid service mapping is
 * reported and evaluated as no mapping (grey, never green).
 */
export function selectLzLiveFrameworks(ids: readonly string[], catalogsDir: string): LzLiveFrameworkSelection {
  const installed = discoverFrameworks(join(catalogsDir, 'community'), { includeUnlisted: true, warn: () => {} });
  const out: LzLiveFrameworkSelection = { frameworks: [], manifest: [], not_installed: [], invalid_mappings: [], baselines: [], invalid_baselines: [] };
  const seen = new Set<string>();
  for (const id of ids) {
    const fw = findFramework(installed, id);
    if (!fw) { out.not_installed.push(id); continue; }
    if (seen.has(fw.id)) continue;
    seen.add(fw.id);
    const prov = lzLiveFrameworkProvenance(fw);
    const loaded = loadServiceControls(fw.dir, fw.id);
    if (loaded.status === 'invalid') out.invalid_mappings.push({ id: fw.id, errors: loaded.errors });
    const [decl] = readFrameworkSovereigntyDecls([fw.id], catalogsDir);
    const pb = loadPolicyBaseline(fw.dir, fw.id);
    if (pb.status === 'invalid') out.invalid_baselines.push({ id: fw.id, errors: pb.errors });
    if (pb.status === 'ok') out.baselines.push({ id: fw.id, dir: fw.dir, baseline: pb.baseline, sha256: prov.files['policy-baseline.yaml'] ?? sha256('') });
    out.manifest.push(prov);
    out.frameworks.push({
      id: fw.id,
      version: prov.version,
      sha256: prov.sha256,
      mapping: loaded.mapping,
      dir: fw.dir,
      ...(decl?.sovereignty_requirements ? { sovereignty_requirements: decl.sovereignty_requirements } : {}),
    });
  }
  return out;
}
