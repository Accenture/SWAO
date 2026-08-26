// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { load } from 'js-yaml';
import {
  loadRegimeRegistry,
  loadRegimeCatalogue,
  resolveCatalogsDir,
  type RegimeRegistry,
} from '@swao/core';

export type CommunityFrameworksProbeStatus = 'ok' | 'warn' | 'absent' | 'fail';

// Sprint-037 #0342: per-framework summary used to render one info line per
// community framework in the doctor output.
export interface CommunityFrameworkSummary {
  id: string;
  scope: 'standard' | 'community';
  contributor: string | null;
  controls_count: number;
}

export interface CommunityFrameworksProbeResult {
  status: CommunityFrameworksProbeStatus;
  catalogs_dir: string;
  standard_count: number;
  // Sprint-037 #0341: `overlay_count` renamed to `community_count` per the
  // design 029 §11 unified scope. The counter increments for every regime
  // resolved to scope='community' by the registry walker.
  community_count: number;
  collisions: string[];
  warnings: string[];
  errors: string[];
  // Sprint-037 #0342: one summary per community-scope regime so the doctor
  // can print a per-framework info line. Order matches registry insertion.
  frameworks: CommunityFrameworkSummary[];
}

// Sprint-037 #0342: read a community framework's `framework-meta.yaml`
// (canonical per design 029 §11) and validate the required fields. The
// `controls.yaml` regime_meta block carries a subset (id, contributor)
// too; this function consults framework-meta first and falls back to
// regime_meta so synthetic test fixtures that ship only controls.yaml
// continue to pass.
//
// The `classification:` field was removed in sprint-038 #0349 (see
// regime-catalogue.ts ScopeSchema comment).
interface FrameworkMetaRaw {
  framework?: {
    id?: unknown;
    contributor?: unknown;
  };
}
interface RegimeMetaRaw {
  regime_meta?: {
    id?: unknown;
    contributor?: unknown;
  };
}

function readFrameworkMetaFields(catalogueFile: string): {
  id: string | null;
  contributor: string | null;
  sourceFile: string;
} {
  const result = {
    id: null as string | null,
    contributor: null as string | null,
    sourceFile: catalogueFile,
  };
  // Try framework-meta.yaml sibling first (design 029 §11 canonical location).
  const frameworkMetaPath = join(dirname(catalogueFile), 'framework-meta.yaml');
  if (existsSync(frameworkMetaPath)) {
    try {
      const raw = load(readFileSync(frameworkMetaPath, 'utf-8')) as FrameworkMetaRaw | null;
      const fw = raw?.framework;
      if (fw) {
        if (typeof fw.id === 'string') result.id = fw.id;
        if (typeof fw.contributor === 'string') {
          result.contributor = fw.contributor;
        } else if (fw.contributor && typeof fw.contributor === 'object') {
          const c = fw.contributor as { name?: unknown; email?: unknown };
          if (typeof c.name === 'string') result.contributor = c.name;
        }
        result.sourceFile = frameworkMetaPath;
      }
    } catch { /* fall through to regime_meta */ }
  }
  // Fallback: controls.yaml regime_meta block.
  if (result.id === null || result.contributor === null) {
    try {
      const raw = load(readFileSync(catalogueFile, 'utf-8')) as RegimeMetaRaw | null;
      const rm = raw?.regime_meta;
      if (rm) {
        if (result.id === null && typeof rm.id === 'string') result.id = rm.id;
        if (result.contributor === null) {
          if (typeof rm.contributor === 'string') {
            result.contributor = rm.contributor;
          } else if (rm.contributor && typeof rm.contributor === 'object') {
            const c = rm.contributor as { name?: unknown };
            if (typeof c.name === 'string') result.contributor = c.name;
          }
        }
      }
    } catch { /* nothing more we can read */ }
  }
  return result;
}

// #0724: extract declared regime IDs from an app .swao.yml object (lenient parse).
function extractDeclaredRegimes(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const ids: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim() && v.trim() !== 'all') ids.push(v.trim()); };
  // assessment.regimes_active[]
  const activeArr = (obj['assessment'] as Record<string, unknown> | undefined)?.['regimes_active'];
  if (Array.isArray(activeArr)) activeArr.forEach(push);
  // assessment.frameworks[]
  const fwArr = (obj['assessment'] as Record<string, unknown> | undefined)?.['frameworks'];
  if (Array.isArray(fwArr)) fwArr.forEach(push);
  // top-level regimes: (legacy)
  const topRegimes = obj['regimes'];
  if (Array.isArray(topRegimes)) topRegimes.forEach(push);
  return [...new Set(ids)];
}

// Walk workspace/apps/*/. swao.yml and warn for any unresolvable regime.
function checkDeclaredRegimes(
  workspacePath: string,
  registry: RegimeRegistry,
  warnings: string[],
): void {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return;
  let appDirs: string[];
  try {
    appDirs = readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return; }

  for (const app of appDirs) {
    const yamlPath = join(appsDir, app, '.swao.yml');
    if (!existsSync(yamlPath)) continue;
    let parsed: unknown;
    try {
      parsed = load(readFileSync(yamlPath, 'utf-8'));
    } catch { continue; }
    for (const regime of extractDeclaredRegimes(parsed)) {
      if (!registry.byId.has(regime)) {
        warnings.push(
          `apps/${app}: regime "${regime}" declared in .swao.yml is not loaded in the catalog (WARN -- catalog may not be fully set up yet)`,
        );
      }
    }
  }
}

export function buildCommunityFrameworksProbe(
  workspacePath: string,
): CommunityFrameworksProbeResult {
  const catalogsDir = resolveCatalogsDir(workspacePath);
  const result: CommunityFrameworksProbeResult = {
    status: 'absent',
    catalogs_dir: catalogsDir,
    standard_count: 0,
    community_count: 0,
    collisions: [],
    warnings: [],
    errors: [],
    frameworks: [],
  };

  if (!existsSync(catalogsDir)) {
    return result;
  }

  let registry: RegimeRegistry;
  try {
    registry = loadRegimeRegistry(catalogsDir);
  } catch (e) {
    result.status = 'fail';
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }

  for (const [id, resolved] of registry.byId) {
    // Skip cross-id alias registrations (e.g. HIPAA -> NIST_SP_800_66R2 via
    // replaces:). Aliases exist for .swao.yml lookup; counting and display
    // are canonical-entry only.
    if (id !== resolved.entry.id) continue;
    // Sprint-039 #0358 Phase 3 -- standard scope retired; every resolved
    // entry is community now. `standard_count` retained on the result
    // shape for backwards compat with JSON consumers but always 0.
    result.community_count += 1;
    try {
      const catalogue = loadRegimeCatalogue(resolved.catalogueFile);
      if (catalogue.regime_meta.id !== resolved.entry.id) {
        result.warnings.push(
          `${id}: regime_meta.id "${catalogue.regime_meta.id}" does not match index entry "${resolved.entry.id}"`,
        );
      }
      if (catalogue.regime_meta.version !== resolved.entry.version) {
        result.warnings.push(
          `${id}: regime_meta.version "${catalogue.regime_meta.version}" does not match index entry "${resolved.entry.version}"`,
        );
      }
      if (catalogue.controls.length !== resolved.entry.controls_count) {
        result.warnings.push(
          `${id}: controls.length=${catalogue.controls.length} does not match index controls_count=${resolved.entry.controls_count}`,
        );
      }

      // Sprint-037 #0342: community-scope frameworks require id +
      // contributor per design 029 §11 (`classification:` removed in
      // sprint-038 #0349). Validate against framework-meta.yaml
      // (canonical) with regime_meta fallback. Capture the summary
      // either way so doctor can render one info line per framework.
      const meta = readFrameworkMetaFields(resolved.catalogueFile);
      const summary: CommunityFrameworkSummary = {
        id: resolved.entry.id,
        scope: resolved.scope,
        contributor: meta.contributor,
        controls_count: catalogue.controls.length,
      };
      result.frameworks.push(summary);

      if (resolved.scope === 'community') {
        const missing: string[] = [];
        if (!meta.id) missing.push('id');
        if (!meta.contributor) missing.push('contributor');
        if (missing.length > 0) {
          result.errors.push(
            `community/${id}: required field${missing.length === 1 ? '' : 's'} missing or invalid in ${meta.sourceFile}: ${missing.join(', ')}. Fix the framework-meta.yaml (canonical) or regime_meta block.`,
          );
        }
      }
    } catch (e) {
      result.errors.push(
        `${id} (${resolved.catalogueFile}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  for (const colliding of registry.collisions) {
    result.collisions.push(colliding);
    result.warnings.push(
      `regime id "${colliding}" appears in both standard and community; community supersedes via replaces: (design 029 §11)`,
    );
  }

  // #0724: walk apps/ and warn (not fail) for each regime declared in
  // assessment.regimes_active or assessment.frameworks that is absent from the registry.
  checkDeclaredRegimes(workspacePath, registry, result.warnings);

  if (result.errors.length > 0) {
    result.status = 'fail';
  } else if (result.warnings.length > 0) {
    result.status = 'warn';
  } else if (result.standard_count + result.community_count > 0) {
    result.status = 'ok';
  } else {
    result.status = 'absent';
  }

  return result;
}
