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

export { SignalIdSchema, SignalSchema, SIGNAL_ID_REGEX, SignalOutcomeSchema, AssessorSchema } from './signals.js';
export type { SignalId, Signal, SignalOutcome, Assessor } from './signals.js';

export { EvidenceSchema } from './wsp-evidence.js';
export type { Evidence, EvidenceItem } from './wsp-evidence.js';

export { SpineSchema } from './wsp-spine.js';
export type { Spine } from './wsp-spine.js';

export { PlanSchema, ObservabilitySchema, LicenceComplianceSchema, TestingMaturitySchema, ArchitectureAssessmentSchema } from './wsp-plan.js';
export type { Plan, SecurityFinding, ContextOverride, Observability, LicenceCompliance, TestingMaturity, ArchitectureAssessment } from './wsp-plan.js';

export { LandingZoneReadinessResultSchema } from './wsp-lzr.js';
export type { LandingZoneReadinessResult, LZBlockerItem, LZServiceCheck } from './wsp-lzr.js';

export { PassFileSchema, DataSourceSchema } from './wsp-pass.js';
export type { PassFile, DataSource } from './wsp-pass.js';

export { RunManifestSchema, PassStatSchema } from './run-manifest.js';
export type { RunManifest, PassStat, LlmRunStats, FilesAssessed, RunManifestProvenance } from './run-manifest.js';

export { LandingZoneCandidateSchema, LandingZoneResultSchema } from './wsp-landing-zone.js';
export type { LandingZoneCandidate, LandingZoneResult, LockInFlag } from './wsp-landing-zone.js';

export { SwaoYmlSchema, SwaoYmlCrawlSchema, SwaoYmlVcsSchema, SwaoYmlAssessmentSchema, SwaoYmlPublicationSchema } from './swao-yml.js';
export type { SwaoYml, SwaoYmlCrawl, SwaoYmlAssessment, SwaoYmlPublication } from './swao-yml.js';

export {
  REGIME_ID_REGEX,
  RegimeIdSchema,
  ScopeSchema,
  RegimeMetaSchema,
  RegimeControlSchema,
  RegimeCatalogueSchema,
  RegimeIndexSchema,
} from './regime-catalogue.js';
export type {
  RegimeId,
  Scope,
  RegimeMeta,
  RegimeControl,
  RegimeCatalogue,
  RegimeIndex,
  RegimeIndexEntry,
} from './regime-catalogue.js';
