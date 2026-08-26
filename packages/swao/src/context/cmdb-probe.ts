// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Back-compat shim. The CMDB-specific column probe (#0042) is now part
// of the generic `[5/6] Import templates` probe (#0189) implemented in
// `imports-probe.ts`. This file keeps the original exports stable so
// existing tests and any external callers do not break.

export {
  buildCmdbProbe,
  CMDB_REQUIRED as CMDB_REQUIRED_COLUMNS,
  CMDB_RECOMMENDED as CMDB_RECOMMENDED_COLUMNS,
  CMDB_OPTIONAL as CMDB_OPTIONAL_COLUMNS,
} from './imports-probe.js';
export type {
  CmdbProbeStatus,
  CmdbProbeFinding,
  CmdbProbeResult,
} from './imports-probe.js';
