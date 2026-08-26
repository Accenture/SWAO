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

// Canonical default pass profile for app assessment (11 passes).
// Mirrors PASS_PROFILE in @swao/module-app-assessment/src/orchestrator.ts
// so @swao/module-mcp can reference the correct count + names without a
// circular package dependency (Design 080 §7.1).
//
// Update when PASS_PROFILE in orchestrator.ts changes. A cross-check test
// in mcp-assess-progress.test.ts asserts the two stay in sync.
export const DEFAULT_PASS_NAMES: readonly string[] = [
  'inventory',
  'state_analysis',
  'data_classification',
  'context_ingestion',
  'sbom_cve',
  'twelve_factor',
  'egress',
  'crypto_posture',
  'synthesis',
  'block_assessments',
  'scope_coverage',
] as const;

export const TOTAL_DEFAULT_PASSES = DEFAULT_PASS_NAMES.length;
