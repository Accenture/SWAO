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
import { basename, dirname, join } from 'path';
import { load } from 'js-yaml';
import {
  loadRegimeRegistry,
  loadRegimeCatalogue,
  resolveCatalogsDir,
  loadServiceControls,
  computeServiceMappingCoverage,
  loadPolicyBaseline,
  findShippedPolicyBaseline,
  shippedPolicyIdsOf,
  policyBaselineFindings,
  withCatalogueParseCache,
  loadCatalogueYamlFile,
  resolveRegimeCatalogue,
  type RegimeRegistry,
} from '@swao/core';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { collectLzCapabilityTags } from '@swao/module-landing-zone';
import { listAppConfigs } from '../app-config-walk.js';
import { meterStep } from '../probe-meter.js';

export type CommunityFrameworksProbeStatus = 'ok' | 'warn' | 'absent' | 'fail';

// Sprint-037 #0342: per-framework summary used to render one info line per
// community framework in the doctor output.
export interface CommunityFrameworkSummary {
  id: string;
  scope: 'standard' | 'community';
  contributor: string | null;
  controls_count: number;
  /** #3577 (Design 120 §8.2): service-controls.yaml coverage against the
   *  capability tags of the LZ catalogues the workspace resolves. */
  service_mapping: ServiceMappingSummary;
  /** #3869 (Design 123 section 7.4): policy-baseline.yaml of a Client LZ Policy Baseline copy. */
  policy_baseline: PolicyBaselineSummary;
}

export interface PolicyBaselineSummary {
  /** absent: the framework is not a policy baseline; invalid: the file fails the loader (fails the probe). */
  status: 'absent' | 'ok' | 'invalid';
  policies: number;
  enabled: number;
  disabled: number;
  /** Policies not reviewed yet (state not_set, D-10): reported, never evaluated. */
  not_set: string[];
  catalogue_version: string | null;
  /** catalogue_version of the shipped baseline named by baseline_of; null when SWAO ships none. */
  shipped_version: string | null;
  /** The copy's catalogue_version is lower than the shipped one. */
  stale: boolean;
  /** Shipped policy ids the copy does not have (stale copies). */
  missing_shipped_ids: string[];
  /** Capability tags the baseline names that no resolved LZ catalogue uses. */
  unused_tags: string[];
}

const ABSENT_POLICY_BASELINE: PolicyBaselineSummary = {
  status: 'absent', policies: 0, enabled: 0, disabled: 0, not_set: [], catalogue_version: null,
  shipped_version: null, stale: false, missing_shipped_ids: [], unused_tags: [],
};

export interface ServiceMappingSummary {
  /** absent: no service-controls.yaml (every capability grey); invalid: file fails the schema. */
  status: 'absent' | 'ok' | 'invalid';
  /** In-use capability tags with a mapping. */
  mapped: number;
  /** Distinct capability tags used by the resolved LZ catalogues; measured for every
   *  status (one cached scan per probe run, the same catalogues the LZ coverage probe reads). */
  in_use: number;
  /** Mapped tags that no resolved LZ catalogue uses. */
  unused_mappings: string[];
}

export interface CommunityFrameworksProbeOptions {
  /** Capability tags in use (tests); default: collectLzCapabilityTags(workspacePath). */
  capabilityTags?: readonly string[];
  /** Tag collector (tests); default: collectLzCapabilityTags(workspacePath).tags. */
  collectCapabilityTags?: (workspacePath: string) => readonly string[];
  /** Bundled frameworks dir holding the shipped baselines (tests); default: communityFrameworksDir. */
  bundledFrameworksDir?: string;
  /**
   * #4410: time budget of the probe. When the framework walk passes it, the
   * remaining frameworks are not validated and the probe reports warn with the
   * count, so it always finishes and logs its result (the Setup Wizard stops a
   * health check after 120 s without output). Default 60 s.
   */
  budgetMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

export interface CommunityFrameworksProbeResult {
  status: CommunityFrameworksProbeStatus;
  catalogs_dir: string;
  standard_count: number;
  // Sprint-037 #0341: `overlay_count` renamed to `community_count` per the
  // design 029 §11 unified scope. The counter increments for every regime
  // resolved to scope='community' by the registry walker.
  community_count: number;
  // #2910: bundled frameworks always available via binary; counted separately
  // from workspace-level catalog so the probe can emit 'ok' on fresh workspaces.
  bundled_count: number;
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
      const raw = loadCatalogueYamlFile(catalogueFile) as RegimeMetaRaw | null; // #4410: cached within the probe run
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

/** #4452: at most this many app names are listed with a missing regime. */
const MISSING_REGIME_APPS_SHOWN = 3;

/**
 * #4452: the warning for one declared regime that resolves nowhere, naming
 * the app count once instead of one warning per app.
 */
export function missingRegimeWarning(regime: string, apps: readonly string[]): string {
  const shown = apps.slice(0, MISSING_REGIME_APPS_SHOWN).map((a) => `apps/${a}`).join(', ');
  const more = apps.length > MISSING_REGIME_APPS_SHOWN ? ` and ${apps.length - MISSING_REGIME_APPS_SHOWN} more` : '';
  const count = `${apps.length} app${apps.length === 1 ? '' : 's'}`;
  return `regime "${regime}" declared in .swao.yml of ${count} (${shown}${more}) is not found in the workspace or the bundled catalogue; the catalogue may not be set up yet`;
}

// Walk workspace/apps/*/.swao.yml and warn for any unresolvable regime.
// #4452: a regime that is not in the workspace registry but resolves through
// the bundled catalogue (resolveRegimeCatalogue, as the Service framework step
// does; SWAO_APM of every service app) counts as loaded. Each missing regime
// is one warning with its app count.
function checkDeclaredRegimes(
  workspacePath: string,
  registry: RegimeRegistry,
  warnings: string[],
  bundledFrameworksDir: string,
): void {
  // #4461: the shared walk of apps/<id>/.swao.yml (one read per health check).
  const appsByRegime = new Map<string, string[]>();
  for (const cfg of listAppConfigs(workspacePath)) {
    if (cfg.parseError) continue;
    const app = cfg.id;
    for (const regime of extractDeclaredRegimes(cfg.doc)) {
      if (registry.byId.has(regime)) continue;
      const apps = appsByRegime.get(regime) ?? [];
      apps.push(app);
      appsByRegime.set(regime, apps);
    }
  }
  for (const regime of [...appsByRegime.keys()].sort()) {
    // One bundled lookup per distinct id, not per app.
    if (meterStep('bundled catalogue lookup', () => resolveRegimeCatalogue(workspacePath, regime, bundledFrameworksDir))) continue;
    warnings.push(missingRegimeWarning(regime, appsByRegime.get(regime)!.sort()));
  }
}

// #3577: service-controls.yaml sits next to framework-meta.yaml in a framework
// folder (<community>/<slug>/controls.yaml). Flat single-file catalogues have
// no folder of their own and therefore no service mapping.
function summariseServiceMapping(
  catalogueFile: string,
  frameworkId: string,
  knownControlIds: ReadonlySet<string>,
  capabilityTags: () => readonly string[],
  warnings: string[],
): ServiceMappingSummary {
  if (basename(catalogueFile) !== 'controls.yaml') return { status: 'absent', mapped: 0, in_use: capabilityTags().length, unused_mappings: [] };
  const loaded = loadServiceControls(dirname(catalogueFile), frameworkId);
  // No mapping: every in-use capability is unmapped (grey).
  if (loaded.status === 'absent') return { status: 'absent', mapped: 0, in_use: capabilityTags().length, unused_mappings: [] };
  if (loaded.status === 'invalid') {
    warnings.push(`${frameworkId}: service-controls.yaml is invalid (${loaded.errors.join('; ')}); its capabilities are treated as unmapped (grey)`);
    return { status: 'invalid', mapped: 0, in_use: capabilityTags().length, unused_mappings: [] };
  }
  const unknownControls = [...new Set(loaded.mapping.mappings.flatMap((m) => m.controls))]
    .filter((c) => !knownControlIds.has(c))
    .sort();
  if (unknownControls.length > 0) {
    warnings.push(`${frameworkId}: service-controls.yaml references control ids not in controls.yaml: ${unknownControls.join(', ')}`);
  }
  const coverage = computeServiceMappingCoverage(loaded.mapping, capabilityTags());
  if (coverage.unused_mappings.length > 0) {
    warnings.push(`${frameworkId}: service-controls.yaml maps capability tags no resolved LZ catalogue uses: ${coverage.unused_mappings.join(', ')}`);
  }
  return { status: loaded.status, mapped: coverage.mapped, in_use: coverage.in_use, unused_mappings: coverage.unused_mappings };
}

// #3869 (Design 123 section 7.4): validate policy-baseline.yaml in a framework
// folder. Schema errors fail the probe; not_set policies, a stale copy (with the
// shipped ids it misses) and capability tags no resolved LZ catalogue uses are
// warnings. The shipped baseline is the bundled one named by the copy's
// baseline_of; its policy ids are the CPB- reservation set of the loader (D-09).
function summarisePolicyBaseline(
  catalogueFile: string,
  frameworkId: string,
  bundledFrameworksDir: string,
  capabilityTags: () => readonly string[],
  warnings: string[],
  errors: string[],
): PolicyBaselineSummary {
  if (basename(catalogueFile) !== 'controls.yaml') return ABSENT_POLICY_BASELINE;
  const dir = dirname(catalogueFile);
  const first = loadPolicyBaseline(dir, frameworkId);
  if (first.status === 'absent') return ABSENT_POLICY_BASELINE;
  const shipped = first.status === 'ok' ? findShippedPolicyBaseline(bundledFrameworksDir, first.baseline.baseline_of) : null;
  const loaded = shipped ? loadPolicyBaseline(dir, frameworkId, { shippedPolicyIds: shippedPolicyIdsOf(shipped) }) : first;
  if (loaded.status !== 'ok') {
    errors.push(`${frameworkId}: policy-baseline.yaml is invalid (${loaded.errors.join('; ')})`);
    return { ...ABSENT_POLICY_BASELINE, status: 'invalid' };
  }
  const doc = loaded.baseline;
  // #4128 BC-01: the rules live in @swao/core (policyBaselineFindings), shared
  // with the MCP write path (Design 123 section 17.5.5). No resolved LZ
  // catalogue means no vocabulary to check against; no unused-tag warning then.
  const findings = policyBaselineFindings(doc, shipped, capabilityTags());
  for (const e of findings.errors) errors.push(`${frameworkId}: ${e}`);
  for (const w of findings.warnings) warnings.push(`${frameworkId}: ${w}`);
  const notSet = findings.not_set;
  const drift = findings.drift;
  const unused = findings.unused_tags;
  return {
    status: 'ok',
    policies: doc.policies.length,
    enabled: doc.policies.filter((p) => p.state === 'enabled').length,
    disabled: doc.policies.filter((p) => p.state === 'disabled').length,
    not_set: notSet,
    catalogue_version: doc.catalogue_version,
    shipped_version: shipped?.baseline.catalogue_version ?? null,
    stale: drift?.stale ?? false,
    missing_shipped_ids: drift?.stale ? drift.missing_shipped_ids : [],
    unused_tags: unused,
  };
}

/** #4410: default time budget of the community frameworks probe. */
export const COMMUNITY_FRAMEWORKS_PROBE_BUDGET_MS = 60_000;

export function buildCommunityFrameworksProbe(
  workspacePath: string,
  opts: CommunityFrameworksProbeOptions = {},
): CommunityFrameworksProbeResult {
  // #4410: parse every catalogue YAML once per probe run (it was parsed three times).
  return withCatalogueParseCache(() => communityFrameworksProbe(workspacePath, opts));
}

function communityFrameworksProbe(
  workspacePath: string,
  opts: CommunityFrameworksProbeOptions,
): CommunityFrameworksProbeResult {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const budgetMs = opts.budgetMs ?? COMMUNITY_FRAMEWORKS_PROBE_BUDGET_MS;
  let tagsInUse: readonly string[] | undefined = opts.capabilityTags;
  const collectTags = opts.collectCapabilityTags ?? ((ws: string): readonly string[] => collectLzCapabilityTags(ws).tags);
  // Lazy and cached: one catalogue scan per probe run. A scan failure must not drop
  // the framework summaries, so it degrades to "no tags in use" with one warning.
  const tagWarnings: string[] = [];
  const capabilityTags = (): readonly string[] => {
    if (tagsInUse === undefined) {
      try {
        tagsInUse = meterStep('LZ catalogue capability tags', () => collectTags(workspacePath));
      } catch (e) {
        tagsInUse = [];
        tagWarnings.push(`service mapping coverage: LZ catalogue capability tags could not be read (${e instanceof Error ? e.message : String(e)}); in-use counts are 0`);
      }
    }
    return tagsInUse;
  };
  const catalogsDir = resolveCatalogsDir(workspacePath);
  // #2910: count bundled frameworks (always available via binary) regardless of workspace state.
  let bundledCount = 0;
  try {
    if (existsSync(communityFrameworksDir)) {
      bundledCount = readdirSync(communityFrameworksDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('_')).length;
    }
  } catch { /* best-effort */ }

  const result: CommunityFrameworksProbeResult = {
    status: 'absent',
    catalogs_dir: catalogsDir,
    standard_count: 0,
    community_count: 0,
    bundled_count: bundledCount,
    collisions: [],
    warnings: [],
    errors: [],
    frameworks: [],
  };

  if (!existsSync(catalogsDir)) {
    // #2910: status stays 'absent' (workspace catalog not installed), but bundled_count
    // is populated so the formatter can show a non-alarming message when bundled > 0.
    return result;
  }

  let registry: RegimeRegistry;
  try {
    registry = meterStep('framework registry load', () => loadRegimeRegistry(catalogsDir));
  } catch (e) {
    result.status = 'fail';
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }

  const canonical = [...registry.byId].filter(([id, r]) => id === r.entry.id).length;
  let validated = 0;
  for (const [id, resolved] of registry.byId) {
    if (id === resolved.entry.id && now() - startedAt > budgetMs) {
      // #4410: out of time; report what was not validated instead of running on.
      result.warnings.push(`stopped after ${Math.round(budgetMs / 1000)} s: ${validated} of ${canonical} frameworks validated; run the health check again when the machine is less busy`);
      break;
    }
    if (id === resolved.entry.id) validated += 1;
    // Skip cross-id alias registrations (e.g. HIPAA -> NIST_SP_800_66R2 via
    // replaces:). Aliases exist for .swao.yml lookup; counting and display
    // are canonical-entry only.
    if (id !== resolved.entry.id) continue;
    // Sprint-039 #0358 Phase 3 -- standard scope retired; every resolved
    // entry is community now. `standard_count` retained on the result
    // shape for backwards compat with JSON consumers but always 0.
    result.community_count += 1;
    try {
      const catalogue = meterStep('framework catalogue validation', () => loadRegimeCatalogue(resolved.catalogueFile));
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
        service_mapping: summariseServiceMapping(
          resolved.catalogueFile,
          resolved.entry.id,
          new Set(catalogue.controls.map((c) => c.id)),
          capabilityTags,
          result.warnings,
        ),
        policy_baseline: summarisePolicyBaseline(
          resolved.catalogueFile,
          resolved.entry.id,
          opts.bundledFrameworksDir ?? communityFrameworksDir,
          capabilityTags,
          result.warnings,
          result.errors,
        ),
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

  result.warnings.push(...tagWarnings);

  // #0724: walk apps/ and warn (not fail) for each regime declared in
  // assessment.regimes_active or assessment.frameworks that is absent from the registry.
  checkDeclaredRegimes(workspacePath, registry, result.warnings, opts.bundledFrameworksDir ?? communityFrameworksDir);

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
