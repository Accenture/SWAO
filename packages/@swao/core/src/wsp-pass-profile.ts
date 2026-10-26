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

// #3419: the ONE default pass list for an application assessment. It lives in
// core so @swao/module-mcp (pass names, progress total) and
// @swao/module-app-assessment (CLI `--passes` default, TUI pre-selection) read
// the same list without a circular package dependency (Design 080 §7.1).
// Before #3419 the orchestrator, the two TUI screens and this file each kept a
// literal and drifted apart (comp, dynamic, malware, scope).
//
// Order is CANONICAL_PASS_ORDER (@swao/module-app-assessment orchestrator).
// `secrets` (Pass 14 secret scan, Gitleaks only) is a default pass since
// #3419; the full malware scan (`malware`: Gitleaks + OSV-Scanner + ClamAV +
// YARA + ORT) stays opt-in and supersedes `secrets` when both are requested.
// Pass 23 (LZR) is not listed: it runs only with `--lzr <landingZoneId>`.
// orchestrator.test.ts cross-checks this list against the orchestrator, the
// TUI defaults and the pass registry.
export const DEFAULT_PASS_PROFILE: ReadonlyArray<{ readonly key: string; readonly name: string }> = [
  { key: 'inv', name: 'inventory' },
  { key: 'state', name: 'state_analysis' },
  { key: 'data', name: 'data_classification' },
  { key: 'ctx', name: 'context_ingestion' },
  { key: 'sbom', name: 'sbom_cve' },
  { key: 'tf', name: 'twelve_factor' },
  { key: 'egr', name: 'egress' },
  { key: 'crypto', name: 'crypto_posture' },
  // #3405: Pass 26 code health (deterministic, no LLM, no external tool).
  { key: 'quality', name: 'code_health' },
  { key: 'dynamic', name: 'dynamic_analysis' },
  { key: 'scope', name: 'scope_coverage' },
  { key: 'secrets', name: 'secret_scan' },
  { key: 'comp', name: 'compliance_evaluation' },
  { key: 'synth', name: 'synthesis' },
  { key: 'blocks', name: 'block_assessments' },
];

/** Default `--passes` keys, canonical order (#3419). */
export const CANONICAL_DEFAULT_PASS_KEYS: readonly string[] = DEFAULT_PASS_PROFILE.map((p) => p.key);

/** Default pass names (PassHeader.name), canonical order. */
export const DEFAULT_PASS_NAMES: readonly string[] = DEFAULT_PASS_PROFILE.map((p) => p.name);

export const TOTAL_DEFAULT_PASSES = DEFAULT_PASS_NAMES.length;
