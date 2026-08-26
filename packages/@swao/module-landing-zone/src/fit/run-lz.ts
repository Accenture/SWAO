// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { findRegion, type WspResult, type LzScanResult } from '@swao/core';
import { resolveLzCataloguesDir, loadLzCatalogue } from '../catalogue/loader.js';
import { normalizeAwsSnapshot } from '../scan/scan-aws.js';
import { normalizeAzureSnapshot } from '../scan/scan-azure.js';
import {
  orchestrateLandingZone,
  type FrameworkSovereigntyDecl,
  deriveSovereigntyRequirements,
} from './orchestrate-lz.js';
import type { LzRequiredService } from './lz-fit.js';

/**
 * Workspace I/O driver for the landing-zone assessment (Design 056, #0567).
 * Keeps orchestrate-lz.ts pure (no fs): this resolves the catalogue region,
 * loads + normalises the workspace LZ scan snapshot (optional), derives the
 * framework sovereignty requirements, and calls orchestrateLandingZone.
 *
 * Required services are derived from the app WSP by the caller (assess.ts, which
 * bridges the app-assessment loaders + core deriveConstraints) and passed in.
 */

export interface AssembleLzInput {
  workspacePath: string;
  /** Catalogue provider id, e.g. "aws", "azure", "stackit". */
  provider: string;
  /** Region id within the provider catalogue. */
  regionId: string;
  /** Capability needs derived from the app WSP (service_dep:<key> -> {code}). */
  requiredServices: LzRequiredService[];
  /** Sovereignty declarations from the active frameworks (none declare yet -> no gate). */
  frameworkDecls?: FrameworkSovereigntyDecl[];
  cataloguesDir?: string;
  assessedAt?: string;
}

export type AssembleLzResult =
  | { ok: true; wsp: WspResult; notice?: string }
  | { ok: false; error: string };

/**
 * Read sovereignty declarations from installed community framework-meta.yaml
 * files. Scans all subdirectories under `<catalogsDir>/community/`, reads
 * each `framework-meta.yaml`, and returns declarations for the requested
 * `frameworkIds` (matched by `framework.id`, not folder name -- folder names
 * are slugs like `bsi-c5` while IDs are `BSI_C5`). Silently skips absent or
 * unparseable meta files.
 *
 * Used by the assess.ts host to convert selected framework IDs into the
 * FrameworkSovereigntyDecl[] that `assembleLzCatalogWsp` consumes.
 */
export function readFrameworkSovereigntyDecls(
  frameworkIds: string[],
  catalogsDir: string,
  bundledDir?: string,
): FrameworkSovereigntyDecl[] {
  if (frameworkIds.length === 0) return [];
  const scanned = scanFrameworkMetas(catalogsDir);
  // Workspace catalog is the authoritative source; bundledDir fills gaps for frameworks not
  // found there (e.g., when the app has no app-level community catalog and relies on the
  // workspace-level or bundled copy). communityFrameworksDir points directly at framework
  // subdirs, so use scanMetaDir rather than scanFrameworkMetas (which appends '/community').
  if (bundledDir) {
    const bundledById = new Map<string, ScannedFrameworkMeta>();
    scanMetaDir(bundledDir, bundledById);
    for (const [id, meta] of bundledById) {
      if (!scanned.has(id)) scanned.set(id, meta);
    }
  }
  return frameworkIds.map(id => ({ id, sovereignty_requirements: scanned.get(id)?.sovereignty_requirements }));
}

type SovereigntyReqs = FrameworkSovereigntyDecl['sovereignty_requirements'];

interface ScannedFrameworkMeta {
  id: string;
  name?: string;
  sovereignty_requirements?: SovereigntyReqs;
  description?: string;
  authority?: string;
  controlsCount?: number;
  slug?: string;
  contributorName?: string;
}

/** Populate `byId` with framework metas read from a directory of framework subfolders.
 *  Entries already present in `byId` are NOT overwritten (caller controls priority). */
function scanMetaDir(dir: string, byId: Map<string, ScannedFrameworkMeta>): void {
  if (!existsSync(dir)) return;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const metaPath = join(dir, entry.name, 'framework-meta.yaml');
      if (!existsSync(metaPath)) continue;
      try {
        const raw = load(readFileSync(metaPath, 'utf-8')) as {
          framework?: {
            id?: string; name?: string; sovereignty_requirements?: SovereigntyReqs;
            description?: string; authority?: string;
            contributor?: { name?: string };
          };
        } | null;
        const fwId = raw?.framework?.id;
        if (fwId && !byId.has(fwId)) {
          let controlsCount: number | undefined;
          const controlsPath = join(dir, entry.name, 'controls.yaml');
          if (existsSync(controlsPath)) {
            try {
              const cyml = load(readFileSync(controlsPath, 'utf-8')) as { controls?: unknown[] } | null;
              controlsCount = Array.isArray(cyml?.controls) ? cyml.controls.length : undefined;
            } catch { /* fall through */ }
          }
          byId.set(fwId, {
            id: fwId,
            name: typeof raw?.framework?.name === 'string' ? raw.framework.name : undefined,
            sovereignty_requirements: raw?.framework?.sovereignty_requirements,
            description: typeof raw?.framework?.description === 'string'
              ? raw.framework.description.replace(/\s+/g, ' ').trim() : undefined,
            authority: typeof raw?.framework?.authority === 'string' ? raw.framework.authority : undefined,
            controlsCount,
            slug: entry.name,
            contributorName: typeof raw?.framework?.contributor?.name === 'string'
              ? raw.framework.contributor.name : undefined,
          });
        }
      } catch { /* skip unparseable */ }
    }
  } catch { /* dir not iterable */ }
}

/**
 * Scan community framework-meta.yaml files from the workspace community catalog
 * (`catalogsDir/community/`). Reads ONLY from disk -- bundled binary frameworks
 * are intentionally excluded (#1659).
 */
function scanFrameworkMetas(catalogsDir: string): Map<string, ScannedFrameworkMeta> {
  const byId = new Map<string, ScannedFrameworkMeta>();
  // Workspace overrides: scan into a fresh map, then merge overriding byId
  const workspaceById = new Map<string, ScannedFrameworkMeta>();
  scanMetaDir(join(catalogsDir, 'community'), workspaceById);
  for (const [id, meta] of workspaceById) byId.set(id, meta);
  return byId;
}

export interface GateCapableFramework {
  id: string;
  name?: string;
  /** Human-readable one-line description of what the gate enforces. */
  gate_summary: string;
  description?: string;
  authority?: string;
  controlsCount?: number;
  slug?: string;
  contributorName?: string;
}

/**
 * Discover all installed community frameworks for the LZ picker (#1678).
 * Returns every framework found in the workspace community catalog, regardless
 * of whether it declares sovereignty_requirements. Frameworks with sovereignty
 * requirements get a descriptive gate_summary; those without get a generic one.
 * The picker must always show what the user has installed -- SWAO does not
 * pre-filter based on metadata flags.
 */
export function discoverGateCapableFrameworks(catalogsDir: string, bundledDir?: string): GateCapableFramework[] {
  const out: GateCapableFramework[] = [];
  for (const meta of scanFrameworkMetas(catalogsDir).values()) {
    const sr = meta.sovereignty_requirements;
    let gate_summary: string;
    if (sr) {
      const parts: string[] = [];
      if (sr.forbid_exposure?.length) parts.push(`blocks ${sr.forbid_exposure.join(', ')}`);
      if (sr.require_operator_jurisdiction?.length) parts.push(`requires ${sr.require_operator_jurisdiction.join('/')} operator`);
      if (sr.require_residency_country?.length) parts.push(`requires residency ${sr.require_residency_country.join('/')}`);
      if (sr.require_certifications?.length) parts.push(`requires ${sr.require_certifications.join(', ')} certification`);
      gate_summary = parts.length > 0 ? parts.join('; ') : 'compliance gate';
    } else {
      gate_summary = 'no sovereignty requirements defined';
    }
    out.push({
      id: meta.id,
      name: meta.name,
      gate_summary,
      description: meta.description,
      authority: meta.authority,
      controlsCount: meta.controlsCount,
      slug: meta.slug,
      contributorName: meta.contributorName,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const SNAPSHOT_NORMALISERS: Record<string, (raw: Record<string, unknown>, opts: { collectionMode: 'export' }) => LzScanResult> = {
  aws: (raw, opts) => normalizeAwsSnapshot(raw, opts),
  'aws-esc': (raw, opts) => normalizeAwsSnapshot(raw, opts),
  azure: (raw, opts) => normalizeAzureSnapshot(raw, opts),
};

/** Empty observed scan (used when no workspace snapshot is present).
 *  Identified by provenance.source === 'no-snapshot'; run-lz passes
 *  catalogueMode=true to computeLzFit so available services resolve to
 *  SUPPORTED rather than AVAILABLE_NOT_ENABLED -- the CSP offers the
 *  service, no customer LZ has yet been deployed to check. */
function emptyScan(provider: string, assessedAt: string): LzScanResult {
  return {
    provider,
    collection_mode: 'export',
    confidence: 'observed',
    scanned_at: assessedAt,
    regions: [],
    enabled_services: [],
    guardrails: [],
    quotas: [],
    provenance: { source: 'no-snapshot' },
  };
}

/** Load + normalise the workspace LZ scan snapshot if present, else empty. */
function loadScan(workspacePath: string, provider: string, assessedAt: string): LzScanResult {
  const snapshotPath = join(workspacePath, 'wsp', 'inputs', 'terraform', `lz-${provider}-snapshot.json`);
  const normaliser = SNAPSHOT_NORMALISERS[provider];
  if (!normaliser || !existsSync(snapshotPath)) return emptyScan(provider, assessedAt);
  const raw = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Record<string, unknown>;
  return normaliser(raw, { collectionMode: 'export' });
}

export function assembleLandingZoneWsp(input: AssembleLzInput): AssembleLzResult {
  const assessedAt = input.assessedAt ?? new Date().toISOString().slice(0, 10);

  const dir = resolveLzCataloguesDir(input.cataloguesDir, input.workspacePath);
  if (!dir) return { ok: false, error: 'No lz-catalogues directory found (looked for index.json).' };

  if (!existsSync(join(dir, `${input.provider}.json`))) {
    return { ok: false, error: `No catalogue for provider "${input.provider}". Run \`swao lz catalogue list\`.` };
  }
  const catalogue = loadLzCatalogue(dir, input.provider);
  const region = findRegion(catalogue, input.regionId);
  if (!region) {
    return {
      ok: false,
      error: `Region "${input.regionId}" not found in the ${input.provider} catalogue. ` +
        `Available: ${catalogue.regions.map((r) => r.id).join(', ')}.`,
    };
  }

  const scan = loadScan(input.workspacePath, input.provider, assessedAt);
  const catalogueMode = scan.provenance?.source === 'no-snapshot';
  const scanNotice = catalogueMode
    ? `No LZ scan snapshot found for provider "${input.provider}". ` +
      `Assessing against the CSP catalogue only -- available services are rated SUPPORTED (positive match). ` +
      `Provide a deployed-LZ snapshot at wsp/inputs/terraform/lz-${input.provider}-snapshot.json ` +
      `to check which services are actually provisioned (Design 065 §6.1).`
    : undefined;

  const sovereigntyRequirements = deriveSovereigntyRequirements(input.frameworkDecls ?? []);

  // Inject framework-mandated baseline services (#1353). Frameworks such as GDPR
  // declare required_services (e.g. key_vault) that must be assessed regardless
  // of whether the app's INV pass emitted a matching service_dep signal.
  const frameworkMandatedServices = sovereigntyRequirements?.required_services ?? [];
  const augmentedRequired = [...input.requiredServices];
  for (const code of frameworkMandatedServices) {
    if (!augmentedRequired.some((s) => s.code === code)) {
      augmentedRequired.push({ code, label: `${code} (framework-mandated)` });
    }
  }

  const wsp = orchestrateLandingZone({
    region,
    scan,
    requiredServices: augmentedRequired,
    sovereigntyRequirements,
    assessedAt,
    catalogueMode,
  });
  return { ok: true, wsp, notice: scanNotice };
}

/** Canonical alias (ADR-0051): `assembleLzCatalogWsp` is the new name.
 *  `assembleLandingZoneWsp` is kept as a deprecated re-export until v2.0.0. */
export const assembleLzCatalogWsp = assembleLandingZoneWsp;
