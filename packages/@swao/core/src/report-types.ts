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

// Report data + licensee-branding contract types (#0576, Sprint-063 Phase 5).
//
// Relocated from @swao/swao's commands/report.ts so @swao/module-pdf-report's
// PDF renderer can type its inputs without importing host code (a @swao/module-*
// may not import packages/swao/src/...). Mirrors the #0575 WSP-schema-to-core
// precedent. The host's report.ts re-exports these for existing import sites;
// the module imports them from @swao/core.

/** A single signal row as surfaced in a stakeholder report view. */
export interface SignalEntry {
  id: string;
  severity: string;
  derivation: string;
  evidence?: string[];
}

/** Engagement metadata header (#0228) read from the WSP spine. */
export interface EngagementMeta {
  name?: string;
  client_code?: string;
  partnership_lead?: string;
  start_date?: string;
}

/** A single challenge finding from an agent report (YAML parsed output). */
export interface ChallengeFindingEntry {
  id: string;
  concern: string;
  evidenceGap?: string;
  recommendedQuestion?: string;
}

/** Challenge findings produced by one stakeholder agent. */
export interface ChallengeAgentFinding {
  agentId: string;
  agentRole: string;
  openingSummary?: string;
  findings: ChallengeFindingEntry[];
}

/** Aggregated assessment-report payload built by the host's generateReport. */
export interface ReportData {
  appId: string;
  assessedAt: string;
  iter: number;
  sevenRLabel: string;
  coverageScore: string;
  landingZone: string;
  signalCounts: Record<string, number>;
  blockers: SignalEntry[];
  topFindings: SignalEntry[];
  nextSteps: string[];
  duration?: string;
  engagement?: EngagementMeta;
  /** Challenge agent findings loaded from wsp/challenge-app/*.yaml (Enterprise only). */
  challengeFindings?: ChallengeAgentFinding[];
}

// ---------------------------------------------------------------------------
// M18 #0276 -- branded licensee header for Consultant and Enterprise reports.
// The host builds this from the active licence; text/yaml reports and the PDF
// renderer consume it. Community reports produce no branding (empty arrays /
// undefined data).
// ---------------------------------------------------------------------------

export interface LicenseeBranding {
  /** Text lines to prepend to text/PDF reports. Empty array means no branding. */
  text: string[];
  /** YAML key-value block to prepend (already serialised with trailing newline).
   *  Empty string means no branding. */
  yaml: string;
  /** Plain object to inject as the `_generated_for` top-level key in
   *  YAML/JSON outputs. undefined means no branding. */
  data: {
    licensee: string;
    email?: string;
    organisation?: string;
    tier: 'consultant' | 'enterprise';
    expires?: string;
  } | undefined;
}
