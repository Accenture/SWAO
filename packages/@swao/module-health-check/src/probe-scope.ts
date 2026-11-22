// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4190 SET-01 (Design 125 section 6): every health-check probe declares the
// setup scopes it serves. A branch health check runs the generic probes plus
// the probes of its own type; a probe that does not apply is not listed in the
// branch result (instead of reporting `skip`). `swao health-check` without
// `--type` keeps running all probes.

import type { SetupAssessmentType, SetupScope } from '@swao/core';

/**
 * The probe keys of the health-check payload (`HealthCheckPayload` and the
 * `probes` object of health-check.complete), in run order. The seven service
 * probes are the keys of SERVICE_PROBES (service-probes.ts).
 */
export const HEALTH_PROBE_KEYS = [
  'license',
  'playwright',
  'mcp',
  'community_frameworks',
  'imports',
  'traceability',
  'bi_export',
  'scope',
  'prerequisites',
  'vcs_auth',
  'ingestion',
  'iac_toolchain',
  'llm_gateway',
  'wsp_metadata',
  'lz_catalogue_coverage',
  'credential_vault',
  'intake_mapping',
  'apm_weights',
  'service_workspace',
  'research_cache',
  'vendor_catalog',
  'cluster_detection',
  'pii_scrub_audit',
  'delta_snapshot',
  'framework_controls',
  'lz_connections',
] as const;
export type HealthProbeKey = (typeof HEALTH_PROBE_KEYS)[number];

/**
 * `applies_to` per probe (Design 125 section 6 and the health-check rows of
 * sections 5.1 to 5.6). A probe listed under `generic` runs in every branch.
 * Probes named by a branch row that are already generic (credential_vault and
 * community_frameworks for LZ Live, community_frameworks for LZ Catalog,
 * llm_gateway for LLM) also carry the branch, so the mapping reads like the
 * design tables. `bi_export` has no row in the design; it reads the app run
 * bundles, so it serves the Application branch.
 */
export const PROBE_APPLIES_TO: Readonly<Record<HealthProbeKey, readonly SetupScope[]>> = {
  license: ['generic'],
  wsp_metadata: ['generic'],
  credential_vault: ['generic', 'lz-live'],
  llm_gateway: ['generic', 'llm'],
  mcp: ['generic'],
  community_frameworks: ['generic', 'lz-catalog', 'lz-live'],
  prerequisites: ['application'],
  iac_toolchain: ['application'],
  playwright: ['application'],
  vcs_auth: ['application'],
  imports: ['application'],
  ingestion: ['application'],
  scope: ['application'],
  traceability: ['application'],
  bi_export: ['application'],
  service_workspace: ['service'],
  intake_mapping: ['service'],
  apm_weights: ['service'],
  vendor_catalog: ['service'],
  research_cache: ['service'],
  cluster_detection: ['service'],
  pii_scrub_audit: ['service'],
  delta_snapshot: ['service'],
  framework_controls: ['service'],
  lz_catalogue_coverage: ['lz-catalog'],
  lz_connections: ['lz-live'],
};

/** True when `key` is a known probe key. */
export function isHealthProbeKey(key: string): key is HealthProbeKey {
  return (HEALTH_PROBE_KEYS as readonly string[]).includes(key);
}

/**
 * True when the probe runs in the health check of `scope`. `undefined` scope
 * means the unscoped `swao health-check` (all probes). The generic scope runs
 * only the generic probes; a branch runs the generic probes plus its own.
 * Unknown keys run everywhere (a new probe is never silently dropped).
 */
export function isProbeInScope(key: string, scope: SetupScope | undefined): boolean {
  if (scope === undefined || !isHealthProbeKey(key)) return true;
  const applies = PROBE_APPLIES_TO[key];
  return applies.includes('generic') || applies.includes(scope);
}

/** The probe keys of a scope's health check, in run order. */
export function probesForScope(scope: SetupScope | undefined): HealthProbeKey[] {
  return HEALTH_PROBE_KEYS.filter((k) => isProbeInScope(k, scope));
}

/**
 * #4197: the workspace checks (string lists after the probe lines) per scope,
 * so a scoped run prints only the checks of its branch. Same rule as probes.
 */
export const CHECK_APPLIES_TO: Readonly<Record<string, readonly SetupScope[]>> = {
  llm_provider_errors: ['generic'],
  llm_temperature_warnings: ['generic'],
  llm_context_window_warnings: ['generic'],
  seeded_asset_warnings: ['generic'],
  placeholder_input_warnings: ['application'],
  source_accessibility_warnings: ['application'],
  run_accumulation_warnings: ['application'],
  run_status_warnings: ['application'],
  context_config_messages: ['application'],
  image_sidecar_warnings: ['application'],
  lzr_snapshot_warnings: ['lz-catalog'],
  lzr_coverage_info: ['lz-catalog'],
  lz_catalogue_provenance: ['lz-catalog'],
};

/** True when the workspace check `key` is printed in the health check of `scope`. */
export function isCheckInScope(key: string, scope: SetupScope | undefined): boolean {
  if (scope === undefined) return true;
  const applies = CHECK_APPLIES_TO[key];
  if (!applies) return true;
  return applies.includes('generic') || applies.includes(scope);
}

/** Status of a probe result that was not run because it does not serve the scope. */
export const NOT_IN_SCOPE_STATUS = 'not_in_scope';

/**
 * The placeholder stored for a probe that was not run in a scoped health
 * check. It is never printed or logged (the scoped output filters it out) and
 * its status matches no failure rule of computeFailedProbes.
 */
export function notInScopeProbe<T>(): T {
  return { status: NOT_IN_SCOPE_STATUS, message: 'not in scope', scopes: [], findings: [], apps: [], tools: [], errors: [], warnings: [], targets: [] } as unknown as T;
}

// One whitespace then non-dots (greedy): [^.] already stops at the first dot, so the match is the same as
// before without the ambiguous `\s+[^.]*?` (CodeQL js/polynomial-redos).
const LINE_HEADER_RE = /^(\s*)\[(\d+)\/(\d+)\](\s[^.]*)(\.+)(?=\s)/;

/**
 * Wraps the probe line printer of a scoped run: each `[N/26] Label....` line
 * is renumbered `[k/M]` (M = probes of the scope) and its dots adjusted so
 * the columns stay aligned. Lines without a header pass through. Without a
 * scope the printer is returned unchanged.
 */
export function scopedProbeLineEmitter(
  onLine: ((line: string) => void) | undefined,
  scope: SetupScope | undefined,
): ((line: string) => void) | undefined {
  if (!onLine || scope === undefined) return onLine;
  const total = probesForScope(scope).length;
  let k = 0;
  return (line: string) => {
    const m = LINE_HEADER_RE.exec(line);
    if (!m) { onLine(line); return; }
    k += 1;
    const oldHeader = `[${m[2]}/${m[3]}]`;
    const newHeader = `[${k}/${total}]`;
    const dots = '.'.repeat(Math.max(2, m[5]!.length + oldHeader.length - newHeader.length));
    onLine(`${m[1]}${newHeader}${m[4]}${dots}${line.slice(m[0].length)}`);
  };
}

/** The probe keys that belong to a branch and are not generic (the branch's own probes). */
export function branchOwnProbes(type: SetupAssessmentType): HealthProbeKey[] {
  return HEALTH_PROBE_KEYS.filter((k) => PROBE_APPLIES_TO[k].includes(type) && !PROBE_APPLIES_TO[k].includes('generic'));
}
