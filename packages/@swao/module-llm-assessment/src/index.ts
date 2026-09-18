// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * @swao/module-llm-assessment -- LLM Assessment for SWAO (Design 092).
 *
 * Registers `type: llm`: N complete assessment runs (2..5 legs) of a
 * user-selected, already-assessed application, per-call metadata capture,
 * dimension-grouped comparison with relative min/max scoring, findings log,
 * and the third HTML publication type. Available on all tiers (Community+)
 * per DOCX golden standard.
 *
 * Sprint-114 phasing: #1419 surface/schema, #1420 gates (this scaffold),
 * #1421-#1423 run-loop engine, #1424-#1426 comparison, #1427 TUI,
 * #1428-#1431 publication, #1432 prompt-size probe.
 */

import type { SwaoModuleManifest, AssessmentTypeContribution } from '@swao/core';
import { llmAssessmentType } from './llm-type.js';

export {
  checkAppAssessmentPrecondition,
} from './gates.js';
export type { PreconditionResult, PreconditionFailure } from './gates.js';
export {
  llmAssessmentType,
  runLlmAssessment,
  LlmAssessmentGateError,
  EnginePendingError,
} from './llm-type.js';
export {
  METRIC_CATALOGUE,
  METRIC_CATALOGUE_VERSION,
  METRIC_GROUPS,
  metricById,
  metricsByGroup,
  scoredMetrics,
} from './metric-catalogue.js';
export type {
  MetricDefinition,
  MetricDirection,
  MetricScope,
  MetricGroup,
} from './metric-catalogue.js';
export {
  normaliseProperty,
  rankScores,
  groupSubResult,
  finalResult,
  trafficLight,
  DEGENERATE_SPREAD_EPSILON,
  DEFAULT_WEIGHTS,
  WEIGHT_KEY_GROUPS,
} from './comparison-engine.js';
export type {
  PropertyScore,
  GroupSubResult,
  FinalResult,
  TrafficLight,
} from './comparison-engine.js';
export {
  CallRecordSchema,
  SIZE_BUCKETS,
  SIZE_BUCKET_BOUNDS_TOKENS,
  sizeBucket,
  analysisMode,
} from './call-record.js';
export type { CallRecord, SizeBucket, AnalysisMode } from './call-record.js';
export { buildPassGroups, buildBucketView, buildChallengePassGroups, buildLzChallengePassGroups } from './pass-groups.js';
export type { PassGroup, PassLegAggregate, BucketView } from './pass-groups.js';
export {
  createRecordingProvider,
  looksParseable,
  detectRefusal,
  detectAlteredMarkers,
  countForeignPaths,
} from './recording-provider.js';
export type { RecorderDeps, RecordingProvider, UsageSnapshot, CallContext } from './recording-provider.js';
export { RunLog, FindingsStore, CORE_FINDING_TYPES } from './run-store.js';
export type { Finding, FindingSeverity, RunLogEvent } from './run-store.js';
export {
  computeComparabilityKey,
  hashDirectory,
  EMPTY_TREE_HASH,
  buildManifest,
  verifyLegInvariants,
  LlmAssessmentManifestSchema,
  LlmLegManifestSchema,
  LLM_ASSESSMENT_KINDS,
} from './llm-run-manifest.js';
export type {
  LlmAssessmentManifest,
  LlmLegManifest,
  LlmAssessmentKind,
  ComparabilityInput,
  LegInvariants,
  GuardViolation,
} from './llm-run-manifest.js';
export { createLegRecorderFromEnv, LEG_ENV } from './leg-recorder.js';
export type { LegRecorder } from './leg-recorder.js';
export { orchestrateLegs, cloneLegWorkspace, assembleGroups, listRunDirs } from './orchestrator.js';
export type { OrchestratorDeps, OrchestrationResult, ResolvedLeg, LegSpawnResult, ChallengePassResult } from './orchestrator.js';

export const assessmentTypes: AssessmentTypeContribution[] = [llmAssessmentType];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-llm-assessment',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    assessmentTypes,
  },
};
