// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Command } from 'commander';
import type {
  SwaoModuleManifest,
  PassContribution,
  PassResult,
  AssessmentTypeContribution,
  CommandContribution,
  TuiScreenContribution,
  WspResult,
} from '@swao/core';
import { AssessmentTypeScreen } from './tui/AssessmentTypeScreen.js';
import { AssessScreen } from './tui/AssessScreen.js';
import { assessOrchestrator } from './orchestrator.js';
import { registerAccept } from './commands/accept.js';
import { registerMigrateWorkspace } from './commands/migrate-workspace.js';
import { registerDiff } from './commands/diff.js';
import { registerNormalize } from './commands/normalize.js';
import { runInvPass } from './passes/pass-01-inv.js';
import { runStatePass } from './passes/pass-02-state.js';
import { runDataPass } from './passes/pass-03-data.js';
import { runCtxPass } from './passes/pass-04-ctx.js';
import { runSbomPass } from './passes/pass-05-sbom.js';
import { runTfPass } from './passes/pass-06-tf.js';
import { runEgrPass } from './passes/pass-07-egr.js';
import { runCryptoPass } from './passes/pass-08-crypto.js';
import { runSynthPass } from './passes/pass-09-synth.js';
import { runDynamicPass } from './passes/pass-10-dynamic.js';
import { runPhase2, runDomChecks } from './passes/phase2/extractor.js';
import { loadAnalyticsBlocklist, getAnalyticsDomainSet } from './passes/phase2/analytics-blocklist.js';
// COMP (Pass 11) moved to @swao/module-framework (#0570); the host imports it
// from there directly.
import { runBlocksPass } from './passes/pass-12-blocks.js';
import { runScopePass } from './passes/pass-13-scope.js';
import { runMalwarePass } from './passes/pass-14-malware.js';
import { runLzrPass, findLzrInputFiles } from './passes/pass-23-lzr.js';

// Re-export the raw pass runners for the transition window (#0548). @swao/swao's
// passes/index.ts barrel re-exports these, and assess.ts dispatches them
// directly until the AssessOrchestrator lands in #0549.
export {
  runInvPass,
  runStatePass,
  runDataPass,
  runCtxPass,
  runSbomPass,
  runTfPass,
  runEgrPass,
  runCryptoPass,
  runSynthPass,
  runDynamicPass,
  runBlocksPass,
  runScopePass,
  runMalwarePass,
  runLzrPass,
  findLzrInputFiles,
  runPhase2,
  runDomChecks,
  loadAnalyticsBlocklist,
  getAnalyticsDomainSet,
};
export type { LlmPassResponse } from './passes/types.js';
// Re-exported so the LZ assessment (in @swao/swao) can derive the app's required
// services from a prior app WSP (loadPriorSignals -> core deriveConstraints), #0567.
export { loadPriorSignals } from './passes/pass-09-synth.js';

// App-assessment commands and library functions relocated from @swao/swao
// (#0552). @swao/swao's CLI bootstrap imports the register fns; assess.ts
// imports derivePlanForRun / loadAcceptedRun. diff and normalize stay in
// @swao/swao for now (their tails -- RunManifest schema fanout and the
// stateful redact-pre-llm util -- are tracked as a follow-up).
export {
  registerAccept,
  loadAcceptedRun,
  resolveAcceptedRunPath,
  ACCEPTED_RUN_FILENAME,
} from './commands/accept.js';
export type { AcceptedRun } from './commands/accept.js';
export { registerMigrateWorkspace } from './commands/migrate-workspace.js';
export { registerDiff } from './commands/diff.js';
export { registerNormalize, runNormalize } from './commands/normalize.js';
export type { NormalizeOptions, NormalizeResult, NormalizeReportEntry } from './commands/normalize.js';
export {
  derivePlanForRun,
  buildEvidenceCatalogue,
  normaliseSourcePath,
  computeDataMigrationFeasibility,
  loadIngestionEvidenceRecords,
  propagateIngestionEvidence,
} from './commands/derive-plan.js';
export type { DerivePlanResult } from './commands/derive-plan.js';

export { runIngestPrePass, classifyIngestFile } from './passes/pass-00-ingest.js';
export type { IngestManifest, IngestedFile, IngestCategory, IngestPrePassOptions } from './passes/pass-00-ingest.js';
export {
  AssessOrchestrator,
  assessOrchestrator,
} from './orchestrator.js';
export type {
  AppAssessmentPassKey,
  AppAssessmentPassDescriptor,
} from './orchestrator.js';

// Pass 10 (DYNAMIC) and Pass 23 (LZR) take orchestrator-supplied inputs beyond
// PassContext (a Playwright crawl result; a provider/landing-zone selection).
// Their PassContribution.run adapters exist so the registry can discover all
// 14 passes now, but real dispatch through these inputs is wired by the
// AssessOrchestrator in #0549. Until then assess.ts calls runDynamicPass /
// runLzrPass directly with those inputs.
const dynamicContributionRun = async (): Promise<PassResult> => {
  throw new Error(
    'Pass 10 (DYNAMIC) requires a crawl result supplied by the assess orchestrator (wired in #0549).',
  );
};
const lzrContributionRun = async (): Promise<PassResult> => {
  throw new Error(
    'Pass 23 (LZR) requires provider/landing-zone inputs supplied by the assess orchestrator (wired in #0549).',
  );
};

// The 14 application-assessment passes, registered as PassContribution[].
// id matches the assess.ts PASS_MAP key; signal_prefix / name match each
// pass's emitted PassHeader.
export const passContributions: PassContribution[] = [
  { id: 'inv', name: 'inventory', signal_prefix: 'INV', run: runInvPass },
  { id: 'state', name: 'state_analysis', signal_prefix: 'STATE', run: runStatePass },
  { id: 'data', name: 'data_classification', signal_prefix: 'DATA', run: runDataPass },
  { id: 'ctx', name: 'context_ingestion', signal_prefix: 'CTX', run: runCtxPass },
  { id: 'sbom', name: 'sbom_cve', signal_prefix: 'SBOM', run: runSbomPass },
  { id: 'tf', name: 'twelve_factor', signal_prefix: 'TF', run: runTfPass },
  { id: 'egr', name: 'egress', signal_prefix: 'EGR', run: runEgrPass },
  { id: 'crypto', name: 'crypto_posture', signal_prefix: 'CRYPTO', run: runCryptoPass },
  { id: 'synth', name: 'synthesis', signal_prefix: 'SYNTH', run: runSynthPass },
  { id: 'dynamic', name: 'dynamic_analysis', signal_prefix: 'DYN', run: dynamicContributionRun },
  // 'comp' (Pass 11 / COMP) moved to @swao/module-framework (#0570).
  { id: 'blocks', name: 'block_assessments', signal_prefix: 'COMP', run: runBlocksPass },
  { id: 'scope', name: 'scope_coverage', signal_prefix: 'SCOPE', run: runScopePass },
  { id: 'lzr', name: 'lzr', signal_prefix: 'LZR', run: lzrContributionRun },
  // Pass 14 (MALWARE) is opt-in: excluded from passKeys() default profile but
  // discoverable by module consumers. (#0681 Phase 1)
  { id: 'malware', name: 'malware_scanning', signal_prefix: 'MAL', run: runMalwarePass },
];

// AssessmentTypeContribution for `type: application` (#0549). The actual
// pass dispatch is driven by AssessOrchestrator + the swao-side assess command
// (which injects the LLM provider factory and owns WSP I/O). The unified
// `swao assess` router in @swao/core (#0554) wires orchestrate() into a real
// run via CoreContext; until that lands, the contribution is registered for
// discovery and the swao assess command dispatches through AssessOrchestrator
// directly.
export const appAssessmentType: AssessmentTypeContribution = {
  type: 'application',
  run: async (): Promise<WspResult> => {
    throw new Error(
      'type:application orchestrate() is wired by the @swao/core assess router (#0554); ' +
        'until then `swao assess` dispatches through AssessOrchestrator in the CLI command.',
    );
  },
};

// App-assessment commands registered as CommandContribution[] (#0552). The
// declarative manifest records them; the actual commander wiring still happens
// when @swao/swao's CLI bootstrap calls each register fn (no module-loader
// host consumes the manifest yet).
export const commandContributions: CommandContribution[] = [
  {
    name: 'accept',
    description: 'Mark a run as the accepted baseline for an app (or clear the lock).',
    register: (program) => registerAccept(program as Command),
  },
  {
    name: 'migrate-workspace',
    description: 'Migrate a workspace to the current on-disk layout.',
    register: (program) => registerMigrateWorkspace(program as Command),
  },
  {
    name: 'diff',
    description: 'Compare two assessment runs (score deltas, new/resolved signals, provider changes).',
    register: (program) => registerDiff(program as Command),
  },
  {
    name: 'normalize',
    description: 'Classify and transform intake files (Excel/Word/PDF) into the wsp/inputs/ tree.',
    register: (program) => registerNormalize(program as Command),
  },
];

// TUI screens contributed by this module (#0553). The host renders them via
// direct import today (App.tsx); the contribution is the declarative record.
export { AssessmentTypeScreen } from './tui/AssessmentTypeScreen.js';
export type { AssessmentType } from './tui/AssessmentTypeScreen.js';
export { AssessScreen } from './tui/AssessScreen.js';
export type { AssessScaffold, AppYamlOptions, LzCatalogueHint, LzCatalogueEntry, LzCatalogueRegion, LensDef } from './tui/AssessScreen.js';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'AssessmentTypeScreen', tier: 'community', component: AssessmentTypeScreen },
  { name: 'AssessScreen', tier: 'community', component: AssessScreen },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-app-assessment',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    passes: passContributions,
    assessmentTypes: [appAssessmentType],
    commands: commandContributions,
    tuiScreens,
  },
};
