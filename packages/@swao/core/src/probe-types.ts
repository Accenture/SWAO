// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Shared doctor-probe result types (#0573, Sprint 062 Phase 4). The doctor
// command's formatters live in @swao/module-health-check, but two of its probe
// builders stay host-coupled (`buildVcsAuthProbe` runs `git ls-remote`;
// `buildImportsProbe` reads the workspace `.swao.yml` tree). The host injects
// those builders into module-health-check; the module needs only their RESULT types.
//
// These interfaces are the single source of truth: the host probe modules
// (`vcs-auth-probe.ts`, `imports-probe.ts`) import them from here, and so does
// module-health-check's `doctor.ts` formatter layer. Leaf module (no runtime deps).

// ---------------------------------------------------------------------------
// VCS auth probe (host: packages/swao/src/doctor/vcs-auth-probe.ts)
// ---------------------------------------------------------------------------

export type VcsAuthProbeStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface VcsAuthProbeResult {
  status: VcsAuthProbeStatus;
  /** Per-app probe outcome. `host` is the redacted host string; `outcome` is
   *  the classifier the operator sees. */
  apps: Array<{
    app_id: string;
    vcs_url: string | null;
    host: string | null;
    outcome: 'ok' | 'auth-failed' | 'not-found' | 'network-unreachable' | 'no-token' | 'no-vcs-config' | 'skip-non-https' | 'skip-fixture-host' | 'skip-deadline';
    hint: string;
  }>;
  message: string;
}

// ---------------------------------------------------------------------------
// Imports probe (host: packages/swao/src/context/imports-probe.ts)
// ---------------------------------------------------------------------------

export type ImportsProbeStatus = 'ok' | 'degraded' | 'blocked' | 'absent' | 'fail';

export interface ImportFinding {
  /** Context-input entry id from `.swao.yml` (e.g. `cmdb`, `finops`). */
  id: string;
  /** Context-input type (e.g. `cmdb_export`, `finops_costing`). */
  type: string;
  /** Path as registered in `.swao.yml`, relative to the workspace. */
  path: string;
  status: 'ok' | 'degraded' | 'blocked' | 'fail';
  /** CMDB-specific: required columns absent from the header. */
  missing_required: string[];
  /** CMDB-specific: recommended columns absent. */
  missing_recommended: string[];
  /** CMDB-specific: optional columns absent. */
  missing_optional: string[];
  error: string | null;
}

export interface ImportsProbeResult {
  status: ImportsProbeStatus;
  findings: ImportFinding[];
  message: string;
}
