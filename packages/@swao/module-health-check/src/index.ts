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

import type {
  SwaoModuleManifest,
  ProbeContribution,
  TuiScreenContribution,
  WorkspaceContext,
} from '@swao/core';

// The command register fns + buildHealthCheckPayload are re-exported directly below
// (export ... from './commands/*'); they are not referenced in this file, so they
// are not imported here. HealthCheckScreen + the three probe builders below ARE used
// (in the tuiScreens / probes arrays), so they remain imports.
import { HealthCheckScreen } from './tui/HealthCheckScreen.js';
import { buildTraceabilityProbe } from './probes/traceability-probe.js';
import { buildScopeProbe } from './probes/scope-probe.js';
import { buildPrerequisitesProbe } from './probes/prerequisites-probe.js';

/**
 * @swao/module-health-check -- the health-check / health-check-pii / health-check-tags
 * commands plus the diagnostic probe registry (ADR-0048 modular architecture, Phase 4, #0573).
 *
 * Three probes stay host-coupled and are NOT moved here: Playwright/Chromium
 * (binary-excluded; shared with assess), VCS auth (`git ls-remote`), and import
 * templates (host workspace layout). The host injects their builder functions
 * via `HealthCheckHostDeps` (see registerHealthCheck / buildHealthCheckPayload). The
 * health-check-only probes (MCP, compliance catalogues, traceability, BI export, scope,
 * prerequisites, tag consistency) live in this module.
 */

// Commands + payload builder (the host's CLI bootstrap calls these; registerHealthCheck
// + buildHealthCheckPayload take the injected host probe builders).
export { registerHealthCheck, buildHealthCheckPayload, buildHealthCheckLogContext } from './commands/health-check.js';
export type {
  HealthCheckHostDeps,
  HealthCheckPayload,
  LicenseProbeResult,
  PlaywrightProbeResult,
  BuildHealthCheckContext,
} from './commands/health-check.js';
export {
  checkLlmProviderConfig,
  checkLzrSnapshots,
  checkLlmTemperature,
  checkLlmContextWindow,
  checkPlaceholderInputs,
  checkLzrCoveragePerApp,
  checkRunAccumulation,
} from './commands/health-check.js';
export { registerHealthCheckPii, runHealthCheckPii } from './commands/health-check-pii.js';
export { registerHealthCheckTags } from './commands/health-check-tags.js';

// Probe builders + result types. The host re-exports some of these for tests
// (compliance catalogues probe is exercised by sprint-037 GDPR suites; the BI
// export probe test stays host-side because it drives the host star writers).
export { buildMcpProbe, claudeDesktopConfigPath } from './probes/claude-desktop.js';
export type { McpProbeResult, McpProbeStatus } from './probes/claude-desktop.js';
export { buildCommunityFrameworksProbe } from './probes/compliance-catalogues-probe.js';
export type {
  CommunityFrameworksProbeResult,
  CommunityFrameworksProbeStatus,
  CommunityFrameworkSummary,
} from './probes/compliance-catalogues-probe.js';
export { buildTraceabilityProbe, computeAppTraceability, DEFAULT_TARGETS } from './probes/traceability-probe.js';
export type {
  TraceabilityProbeResult,
  TraceabilityProbeStatus,
  TraceabilityCounts,
  TraceabilityCoverage,
  TraceabilityTargets,
  AppTraceabilityResult,
} from './probes/traceability-probe.js';
export { buildBiExportProbe } from './probes/bi-probe.js';
export type { BiExportProbeResult, BiExportProbeStatus, BiExportFinding } from './probes/bi-probe.js';
export { buildScopeProbe } from './probes/scope-probe.js';
export type { ScopeProbeResult, ScopeProbeStatus } from './probes/scope-probe.js';
export { buildPrerequisitesProbe } from './probes/prerequisites-probe.js';
export type { PrerequisitesProbeResult, PrerequisitesProbeStatus } from './probes/prerequisites-probe.js';
export { buildTagConsistencyProbe } from './probes/tag-consistency-probe.js';
export { buildIngestionProbe } from './probes/ingestion-probe.js';
export type { IngestionProbeResult, IngestionProbeStatus } from './probes/ingestion-probe.js';
export { buildWspMetadataProbe } from './probes/wsp-metadata-probe.js';
export type { WspMetadataProbeResult, WspMetadataProbeStatus } from './probes/wsp-metadata-probe.js';
export type {
  TagConsistencyProbeResult,
  TagConsistencyStatus,
  TagConsistencyFlag,
  TagConsistencyFrameworkResult,
} from './probes/tag-consistency-probe.js';

// TUI screen contributed by this module (#0573). The host renders it via direct
// import today (App.tsx) and injects the SWAO version (branding is host-only).
export { HealthCheckScreen } from './tui/HealthCheckScreen.js';
export { HealthCheckProbeList } from './tui/components/HealthCheckProbeList.js';
export { parseHealthCheckOutput, probeAction } from './tui/components/health-check-parse.js';
export type { HealthCheckProbe } from './tui/components/health-check-parse.js';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'HealthCheckScreen', tier: 'community', component: HealthCheckScreen },
];

// Health-check-only probes registered as ProbeContribution[] (#0573). Only the
// workspace-scoped probes with a uniform { status, message } shape are wrapped
// here; mapping their status to the ProbeContribution `ok` boolean is a pure
// projection (no new behaviour). The host-injected probes (Playwright / VCS /
// imports), the MCP probe (no workspace input), and the BI-export probe (app-dir
// scoped) are not contributed via this list -- they run through the health-check
// command directly. The declarative manifest records what is safely wrappable;
// the command remains the source of truth for the full 10-probe run.
export const probes: ProbeContribution[] = [
  {
    id: 'traceability',
    name: 'traceability',
    run: async (ctx: WorkspaceContext) => {
      const r = buildTraceabilityProbe(ctx.workspacePath);
      return { ok: r.status === 'ok' || r.status === 'absent', message: r.message };
    },
  },
  {
    id: 'scope',
    name: 'scope_coverage',
    run: async (ctx: WorkspaceContext) => {
      const r = buildScopeProbe(ctx.workspacePath);
      return { ok: r.status !== 'warn', message: r.message };
    },
  },
  {
    id: 'prerequisites',
    name: 'prerequisites',
    run: async () => {
      const r = buildPrerequisitesProbe();
      return { ok: r.status !== 'fail', message: r.message };
    },
  },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-health-check',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    probes,
    tuiScreens,
  },
};
