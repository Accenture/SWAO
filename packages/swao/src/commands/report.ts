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

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { load, dump } from 'js-yaml';
import type { Command } from 'commander';
import { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError } from '@swao/core';
import { formatPortfolioLzrReport } from '../lzr/portfolio-lzr.js';
import type { PortfolioLzrSummary } from '../lzr/portfolio-lzr.js';
// #0583 (per-tier builds): the general (non-LZR) --portfolio case is the
// spawn-based per-app dispatcher in @swao/module-portfolio (Enterprise tier).
// To keep the Enterprise module CODE out of the Community / Consultant bundles,
// the host no longer imports runPortfolio / formatPortfolioResult here. They are
// injected via ReportDeps (gated stubs in lower tiers, real impls in
// Enterprise). Only the TYPES are imported -- `import type` is erased by esbuild
// so it pulls no module code into the bundle. The LZR report path stays
// host-side (it is Community).
import type { PortfolioRunDeps, PortfolioResult } from '@swao/module-portfolio';
import { buildAuditorReport } from './auditor-report-schema.js';
import { findWorkspace, setWorkspaceRoot, logPortfolio } from '@swao/core';
// #0583: renderTextReportToPdf lives in @swao/module-pdf-report (Consultant
// tier). Import the TYPE only (erased by esbuild) and inject the renderer via
// ReportDeps so the Community bundle never contains the pdf module's code.
import type { RenderPdfArgs, LlmPdfArgs } from '@swao/module-pdf-report';
import { SWAO_VERSION, SWAO_CONTACTS_INLINE, SWAO_LANDING_URL } from '../branding.js';
import {
  generateLzReport, formatLzText, formatLzYaml,
  buildLzReportDataStub, buildLzReportDataStubForAgent,
  getLzAgentIds, buildLzTargetRows,
} from './report-lz.js';
// #0580: persona taxonomy relocated to @swao/module-challenge. report.ts is a
// host file, so this host -> module import is permitted (the reverse, module ->
// host, is not).
// Persona taxonomy from @swao/core (#0580) -- NOT from @swao/module-challenge:
// report is a Community command and must not depend on the Enterprise challenge
// module (per-tier builds, #0583).
import { CANONICAL_AGENT_ORDER, PERSONAS, REPORT_VIEW_ALIASES, reportViewToAgentId, AGENT_IDS } from '@swao/core';

// #0576: SignalEntry / EngagementMeta / ReportData / LicenseeBranding moved to
// @swao/core so @swao/module-pdf-report's renderer can type its inputs without
// importing the host. Re-exported here so the existing `from './report.js'`
// import sites (auditor-report-schema, view tests) keep compiling.
import type { SignalEntry, EngagementMeta, ReportData, LicenseeBranding, ChallengeAgentFinding } from '@swao/core';
export type { SignalEntry, EngagementMeta, ReportData, LicenseeBranding } from '@swao/core';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];

function severityRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i >= 0 ? i : 99;
}

function truncate(s: string, max = 100): string {
  const first = normalizeDashes(s.split('\n')[0].trim());
  return first.length > max ? first.slice(0, max - 3) + '...' : first;
}

/** Normalise LLM-emitted em-dashes and en-dashes to ASCII equivalents. */
export function normalizeDashes(text: string): string {
  return text.replace(/\u2014/g, '--').replace(/\u2013/g, '-');
}

/**
 * Wrap text word-by-word so lines stay within maxWidth.
 * firstPrefix is prepended to the first line; contPrefix to all subsequent lines.
 * Returns an array of lines (already including the prefixes).
 */
export function wrapLines(text: string, firstPrefix: string, contPrefix: string, maxWidth = 100): string[] {
  const words = normalizeDashes(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = firstPrefix;
  for (const word of words) {
    const sep = cur === firstPrefix || cur === contPrefix ? '' : ' ';
    if (cur.trimEnd() === cur && cur.length > 0 && (cur + sep + word).length > maxWidth) {
      out.push(cur);
      cur = contPrefix + word;
    } else {
      cur += (cur === firstPrefix || cur === contPrefix ? '' : ' ') + word;
    }
  }
  if (cur !== firstPrefix && cur !== contPrefix) out.push(cur);
  return out;
}

/** Return a fixed-width severity label: [critical], [high    ], etc. */
function severityLabel(sev: string): string {
  const abbrev: Record<string, string> = { informational: 'info' };
  const s = abbrev[sev.toLowerCase()] ?? sev.toLowerCase();
  return `[${s.padEnd(8)}]`; // 'critical' and 'positive' are 8 chars
}

function loadYaml(filePath: string): unknown {
  try {
    return load(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function msToHuman(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function resolveRunDirs(workspaceAppDir: string): {
  wspDir: string;
  passesDir: string;
  runManifestPath: string;
} {
  const wspDir = join(workspaceAppDir, 'wsp');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runDir = join(wspDir, latestPath);
      if (existsSync(runDir)) {
        return {
          wspDir,
          passesDir: join(runDir, 'passes'),
          runManifestPath: join(runDir, 'run-manifest.json'),
        };
      }
    } catch { /* fall through */ }
  }
  return {
    wspDir,
    passesDir: join(wspDir, 'passes'),
    runManifestPath: join(wspDir, 'run-manifest.json'),
  };
}

export function generateReport(workspaceAppDir: string, appId: string): ReportData {
  const { wspDir, passesDir, runManifestPath } = resolveRunDirs(workspaceAppDir);
  const runDir = resolveRunDir(wspDir);

  // Load spine for meta -- read from the latest run dir, not the flat wsp/ slot
  const spine = loadYaml(join(runDir, 'wsp.yaml')) as Record<string, unknown> | null;
  const spineOverall = (spine?.overall ?? {}) as Record<string, unknown>;
  const spineMeta = (spine?.meta ?? {}) as Record<string, unknown>;
  const spineLz = (spine?.landing_zone ?? {}) as Record<string, unknown>;
  const spineEng = (spine?.engagement ?? {}) as Record<string, unknown>;

  // #0228: engagement metadata header. The assess pipeline already
  // copies the .swao.yml engagement block into wsp.yaml, so reading
  // from the spine here keeps reports consistent with dim_app in the
  // BI bundle.
  const engagement: EngagementMeta = {
    name:             typeof spineEng['name'] === 'string'             ? (spineEng['name'] as string)             : undefined,
    client_code:      typeof spineEng['client_code'] === 'string'      ? (spineEng['client_code'] as string)      : undefined,
    partnership_lead: typeof spineEng['partnership_lead'] === 'string' ? (spineEng['partnership_lead'] as string) : undefined,
    start_date:       typeof spineEng['start_date'] === 'string'       ? (spineEng['start_date'] as string)       : undefined,
  };
  const engagementHasAny = engagement.name || engagement.client_code || engagement.partnership_lead || engagement.start_date;

  let assessedAt = '';
  let iter = 1;
  let sevenRLabel = 'pending';
  let coverageScore = 'pending';
  let landingZone = '';

  if (spine) {
    const raw = (spine.assessed_at as string | undefined) ?? '';
    assessedAt = raw.slice(0, 10);
    iter = (spineMeta.iter as number | undefined) ?? 1;
    if (spineOverall.seven_r_label) sevenRLabel = String(spineOverall.seven_r_label);
    if (spineOverall.coverage_score !== undefined) {
      const pct = Math.round(Number(spineOverall.coverage_score) * 100);
      coverageScore = `${pct}%`;
    }
    if (spineLz.primary) landingZone = String(spineLz.primary);
  }

  // Aggregate signals from all passes
  const allSignals: SignalEntry[] = [];
  if (existsSync(passesDir)) {
    const files = readdirSync(passesDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    for (const file of files) {
      const parsed = loadYaml(join(passesDir, file)) as {
        signals?: Array<{ id?: string; severity?: string; derivation?: string; evidence?: unknown }>;
        pass?: { assessed_at?: string; iter?: number };
        assessment?: Record<string, unknown>;
      } | null;

      if (!parsed) continue;

      // Use first pass's assessed_at if spine not present
      if (!assessedAt && parsed.pass?.assessed_at) {
        assessedAt = String(parsed.pass.assessed_at).slice(0, 10);
      }
      if (iter === 1 && parsed.pass?.iter) {
        iter = Number(parsed.pass.iter);
      }

      // Override with SYNTH assessment if this is the synth pass
      if (file.startsWith('09-synth') && parsed.assessment) {
        const a = parsed.assessment;
        if (a['seven_r_label']) sevenRLabel = String(a['seven_r_label']);
        if (a['coverage_score'] !== undefined) {
          const pct = Math.round(Number(a['coverage_score']) * 100);
          coverageScore = `${pct}%`;
        }
        if (a['landing_zone']) landingZone = String(a['landing_zone']);
        if (Array.isArray(a['recommended_next_steps'])) {
          // handled below -- read signals first
        }
      }

      if (parsed.signals) {
        for (const s of parsed.signals) {
          if (s.id) {
            allSignals.push({
              id: s.id,
              severity: s.severity ?? 'informational',
              derivation: s.derivation ?? '',
              evidence: Array.isArray(s.evidence) ? (s.evidence as string[]) : undefined,
            });
          }
        }
      }
    }
  }

  // Signal counts
  const signalCounts: Record<string, number> = { total: allSignals.length };
  for (const sev of SEVERITY_ORDER) signalCounts[sev] = 0;
  for (const s of allSignals) {
    const sev = s.severity;
    signalCounts[sev] = (signalCounts[sev] ?? 0) + 1;
  }

  // Migration blockers: critical signals + high EGR/SBOM signals
  const blockers = allSignals
    .filter(s => {
      const prefix = s.id.split('-')[0];
      return s.severity === 'critical' || (s.severity === 'high' && (prefix === 'EGR' || prefix === 'SBOM'));
    })
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  // Top 3 findings (by severity rank)
  const topFindings = [...allSignals]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 3);

  // Next steps from SYNTH pass
  let nextSteps: string[] = [];
  if (existsSync(passesDir)) {
    const synthFile = join(passesDir, '09-synth.yaml');
    if (existsSync(synthFile)) {
      const parsed = loadYaml(synthFile) as { assessment?: Record<string, unknown> } | null;
      const steps = parsed?.assessment?.['recommended_next_steps'];
      if (Array.isArray(steps)) nextSteps = steps.map(String);
    }
  }

  // Read duration from engine-written run manifest (if present)
  let duration: string | undefined;
  const runManifest = loadJson(runManifestPath) as {
    duration_ms?: number;
    started_at?: string;
    finished_at?: string;
  } | null;
  if (runManifest?.duration_ms !== undefined) {
    duration = msToHuman(runManifest.duration_ms);
  } else if (runManifest?.started_at && runManifest?.finished_at) {
    const ms = new Date(runManifest.finished_at).getTime() - new Date(runManifest.started_at).getTime();
    if (ms > 0) duration = msToHuman(ms);
  }

  // #0851: load challenge agent findings from wsp/challenge-app/*.yaml (Enterprise
  // --report output). Each file is named <agentId>.yaml and contains the raw
  // LLM YAML with a `findings:` array. We parse them here so the PDF renderer
  // and other consumers get structured data without importing the Enterprise
  // challenge module (per-tier build rule, #0583).
  // #1056: ChallengeScreen now writes to wsp/challenge-app/<ts>/ subdirectories.
  // Resolve the latest subdirectory (most recent ts prefix); fall back to flat
  // wsp/challenge-app/ for backward compat with runs before this fix.
  const challengeFindings: ChallengeAgentFinding[] = [];
  const challengeBase = join(wspDir, 'challenge-app');
  let challengeDir = challengeBase;
  if (existsSync(challengeBase)) {
    const subDirs = readdirSync(challengeBase)
      .filter(f => {
        try { return statSync(join(challengeBase, f)).isDirectory(); } catch { return false; }
      })
      .sort();
    if (subDirs.length > 0) {
      challengeDir = join(challengeBase, subDirs[subDirs.length - 1]);
    }
  }
  if (existsSync(challengeDir)) {
    const challengeFiles = readdirSync(challengeDir)
      .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'combined.yaml')
      .sort();
    for (const file of challengeFiles) {
      const agentId = file.replace(/^AA_/, '').replace(/\.ya?ml$/, '');
      const parsed = loadYaml(join(challengeDir, file)) as {
        findings?: Array<{
          id?: string;
          concern?: string;
          evidence_gap?: string;
          recommended_question?: string;
        }>;
      } | null;
      if (!parsed?.findings?.length) continue;
      const agentRole = (AGENT_IDS as Record<string, string>)[agentId] ?? agentId;
      challengeFindings.push({
        agentId,
        agentRole,
        findings: parsed.findings
          .filter(f => f.id && f.concern)
          .map(f => ({
            id: f.id!,
            concern: f.concern!,
            evidenceGap: f.evidence_gap,
            recommendedQuestion: f.recommended_question,
          })),
      });
    }
  }

  return {
    appId,
    assessedAt,
    iter,
    sevenRLabel,
    coverageScore,
    landingZone,
    signalCounts,
    blockers,
    topFindings,
    nextSteps,
    duration,
    engagement: engagementHasAny ? engagement : undefined,
    challengeFindings: challengeFindings.length > 0 ? challengeFindings : undefined,
  };
}

// ---------------------------------------------------------------------------
// M18 #0276 -- branded licensee header for Consultant and Enterprise reports.
// Pulls licensee / organisation / tier / expires from the active licence and
// renders a small block above the engagement header. Community reports
// produce no licensee block (we do not brand the free tier). The
// LicenseeBranding type now lives in @swao/core (#0576); see the import above.
// ---------------------------------------------------------------------------

/**
 * Build the licensee-branding payload from the currently-active licence.
 * Returns "no branding" when the active tier is Community, when no licence
 * is present, or when loading the licence throws.
 */
export function buildLicenseeBranding(): LicenseeBranding {
  const empty: LicenseeBranding = { text: [], yaml: '', data: undefined };

  let state;
  try {
    state = LicenseGuard.load().state;
  } catch {
    return empty;
  }

  if (state.tier !== 'consultant' && state.tier !== 'enterprise') {
    return empty;
  }
  if (!state.licensee) {
    return empty;
  }

  const tierLabel = state.tier === 'enterprise' ? 'Enterprise' : 'Consultant';
  const orgSuffix = state.organisation ? `, ${state.organisation}` : '';
  const expSuffix = state.exp ? ` -- expires ${state.exp}` : '';

  const text = [
    `Generated for:     ${state.licensee}${orgSuffix}`,
    `License:           ${tierLabel}${expSuffix}`,
    '',
  ];

  const yamlLines = [
    '_generated_for:',
    `  licensee: ${JSON.stringify(state.licensee)}`,
    ...(state.email ? [`  email: ${JSON.stringify(state.email)}`] : []),
    ...(state.organisation ? [`  organisation: ${JSON.stringify(state.organisation)}`] : []),
    `  tier: ${state.tier}`,
    ...(state.exp ? [`  expires: ${state.exp}`] : []),
    '',
  ];

  const data: LicenseeBranding['data'] = {
    licensee: state.licensee,
    ...(state.email ? { email: state.email } : {}),
    ...(state.organisation ? { organisation: state.organisation } : {}),
    tier: state.tier,
    ...(state.exp ? { expires: state.exp } : {}),
  };

  return { text, yaml: yamlLines.join('\n'), data };
}

// #0228: 5-line engagement header rendered above each text-view body.
// Emits nothing when no engagement field is populated; otherwise emits
// engagement, client_code, partnership_lead, start_date, assessed lines.
// Missing fields render as "--" so column alignment stays stable.
export function formatEngagementHeader(data: ReportData): string {
  const eng = data.engagement;
  if (!eng) return '';
  const lines = [
    `Engagement:        ${eng.name ?? '--'}`,
    `Client code:       ${eng.client_code ?? '--'}`,
    `Partnership lead:  ${eng.partnership_lead ?? '--'}`,
    `Start date:        ${eng.start_date ?? '--'}`,
    `Assessed:          ${data.assessedAt || '--'}`,
    '',
  ];
  return lines.join('\n');
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - s.length));
}

export function formatText(data: ReportData): string {
  const title = `SWAO Assessment Report -- ${data.appId}`;
  const header = formatEngagementHeader(data);
  const lines: string[] = [
    ...(header ? header.split('\n') : []),
    title,
    '='.repeat(title.length),
    `Assessed:      ${data.assessedAt}`,
    `Iteration:     ${data.iter}`,
    `7R Label:      ${data.sevenRLabel}`,
    `Coverage:      ${data.coverageScore}`,
    `Landing zone:  ${data.landingZone}`,
    ...(data.duration ? [`Duration:      ${data.duration}`] : []),
    '',
    'Signal Summary',
    '--------------',
  ];

  const maxCount = Math.max(...Object.values(data.signalCounts));
  const countWidth = String(maxCount).length;

  for (const sev of SEVERITY_ORDER) {
    const n = data.signalCounts[sev] ?? 0;
    if (n > 0) lines.push(`  ${pad(sev, 14)}${String(n).padStart(countWidth)}`);
  }
  lines.push(`  ${pad('total', 14)}${String(data.signalCounts.total).padStart(countWidth)}`);

  lines.push('');
  if (data.blockers.length > 0) {
    lines.push('Migration Blockers');
    lines.push('------------------');
    for (const b of data.blockers) {
      lines.push(`  ${b.id.padEnd(10)} ${truncate(b.derivation, 88)}`);
    }
  } else {
    lines.push('Migration Blockers: none');
  }

  // Top Findings excludes IDs already listed in Migration Blockers so there is no duplication.
  const blockerIds = new Set(data.blockers.map(b => b.id));
  const nonBlockerFindings = data.topFindings.filter(f => !blockerIds.has(f.id));
  if (nonBlockerFindings.length > 0) {
    lines.push('');
    lines.push('Top Findings');
    lines.push('------------');
    for (const f of nonBlockerFindings) {
      lines.push(`  ${severityLabel(f.severity)} ${f.id.padEnd(10)} ${truncate(f.derivation, 76)}`);
    }
  }

  if (data.nextSteps.length > 0) {
    lines.push('');
    lines.push('Next Steps');
    lines.push('----------');
    for (let i = 0; i < data.nextSteps.length; i++) {
      const prefix = `  ${i + 1}. `;
      const cont   = ' '.repeat(prefix.length);
      lines.push(...wrapLines(data.nextSteps[i], prefix, cont));
    }
  }

  return lines.join('\n');
}

export function formatYamlReport(data: ReportData): string {
  const summary = {
    app: data.appId,
    ...(data.engagement ? { engagement: data.engagement } : {}),
    assessed_at: data.assessedAt,
    iter: data.iter,
    seven_r_label: data.sevenRLabel,
    coverage_score: data.coverageScore,
    landing_zone: data.landingZone,
    ...(data.duration ? { duration: data.duration } : {}),
    signal_counts: data.signalCounts,
    migration_blockers: data.blockers.map(b => ({ id: b.id, severity: b.severity, derivation: truncate(b.derivation) })),
    top_findings: data.topFindings.map((f, i) => ({ rank: i + 1, severity: f.severity, id: f.id, derivation: truncate(f.derivation) })),
    next_steps: data.nextSteps,
  };
  return dump(summary, { lineWidth: 120 });
}

// ---- Role-specific view renderers ----

const SEVEN_R_PLAIN: Record<string, string> = {
  Rehost:    'Move the application to the cloud with minimal changes (lift and shift).',
  Replatform: 'Move to the cloud with targeted infrastructure improvements -- no code rewrite.',
  Refactor:  'Restructure or re-architect the application to take advantage of cloud-native capabilities.',
  Repurchase: 'Replace with a SaaS alternative; decommission the current codebase.',
  Retire:    'Decommission; the application is no longer needed.',
  Retain:    'Keep on-premises for now; revisit in the next assessment cycle.',
  Relocate:  'Move infrastructure to another region or provider with no application changes.',
};

interface RawSpine {
  overall?: {
    seven_r_label?: string;
    portability_score?: number;
    coverage_score?: number;
    confidence?: string;
  };
  assessment_scores?: {
    seven_r?: {
      confidence?: number;
      rationale_signal?: string;
    };
  };
  client_scenario?: {
    regulatory?: string[];
    rto_hours?: number;
    rpo_hours?: number;
    migration_trigger?: string;
    target_go_live?: string;
  };
  landing_zone?: { primary?: string; note?: string };
}

interface RunbookStep {
  id?: string;
  action?: string;
  evidence?: string;
}

interface RunbookComponent {
  component?: string;
  disposition?: string;
  steps?: RunbookStep[];
}

interface OverrideBlock {
  author?: string;
  role?: string;
  timestamp?: string;
  rationale?: string;
}

interface RiskEntry {
  risk_id?: string;
  id?: string;
  likelihood?: string;
  severity?: string;
  trigger?: string;
  description?: string;
  mitigation?: string;
  status?: string;
  closed_rationale?: string;
  closed_at?: string;
  evidence_ids?: string[];
  machine_outcome?: string;
  override?: OverrideBlock;
}

interface RawPlan {
  migration_plan?: {
    strategy?: string;
    phase?: string;
    runbook?: RunbookComponent[];
  };
  risk_register?: RiskEntry[];
  compliance?: {
    regimes?: Array<{ name?: string; status?: string; gaps?: string[] }>;
  };
}

/** Resolve the latest run dir from wspDir (reads latest.txt if present). */
function resolveRunDir(wspDir: string): string {
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim(); // "runs/2026-..."
      const runDir = join(wspDir, latestPath);
      if (existsSync(runDir)) return runDir;
    } catch { /* fall through */ }
  }
  return wspDir;
}

function loadSpine(wspDir: string): RawSpine {
  return (loadYaml(join(resolveRunDir(wspDir), 'wsp.yaml')) ?? {}) as RawSpine;
}

function loadPlan(wspDir: string): RawPlan {
  return (loadYaml(join(resolveRunDir(wspDir), 'wsp-plan.yaml')) ?? {}) as RawPlan;
}

interface RawLzCatFit {
  provider?: string;
  region?: string;
  overall?: string;
}

function loadLzCatalogueFit(wspDir: string): RawLzCatFit | null {
  const runDir = resolveRunDir(wspDir);
  const p = join(runDir, 'lz-catalogue-fit.yaml');
  if (!existsSync(p)) return null;
  return (load(readFileSync(p, 'utf-8')) ?? {}) as RawLzCatFit;
}

export function formatViewExec(data: ReportData, wspDir: string): string {
  const spine = loadSpine(wspDir);
  const plain = SEVEN_R_PLAIN[data.sevenRLabel] ?? `${data.sevenRLabel} disposition.`;
  const confidence = spine.overall?.confidence ?? spine.assessment_scores?.seven_r?.confidence ?? '--';
  const portability = spine.overall?.portability_score !== undefined
    ? `${Math.round(spine.overall.portability_score * 100)}%`
    : '--';

  const header = formatEngagementHeader(data);
  const lines: string[] = [
    ...(header ? header.split('\n') : []),
    `SWAO Assessment Report -- ${data.appId} (Executive View)`,
    '='.repeat(55),
    `Assessed:       ${data.assessedAt}`,
    `Landing zone:   ${data.landingZone || '--'}`,
    '',
    'Migration Recommendation',
    '------------------------',
    `Disposition:    ${data.sevenRLabel}`,
    `Confidence:     ${confidence}`,
    `Coverage score: ${data.coverageScore}`,
    `Portability:    ${portability}`,
    '',
    plain,
    '',
  ];

  if (data.blockers.length > 0) {
    lines.push('Migration Blockers (must resolve before go-live)');
    lines.push('------------------------------------------------');
    for (const b of data.blockers.slice(0, 3)) {
      lines.push(`  ${severityLabel(b.severity)} ${truncate(b.derivation, 87)}`);
    }
    lines.push('');
  } else {
    lines.push('Migration Blockers: none identified.');
    lines.push('');
  }

  if (data.nextSteps.length > 0) {
    lines.push('Recommended Next Step');
    lines.push('---------------------');
    lines.push(...wrapLines(data.nextSteps[0], '  ', '  '));
    lines.push('');
  }

  return lines.join('\n');
}

export function formatViewCompliance(data: ReportData, wspDir: string): string {
  const spine = loadSpine(wspDir);
  const plan = loadPlan(wspDir);
  const regulatory = spine.client_scenario?.regulatory?.join(', ') ?? '--';

  const complianceSignals = [...data.topFindings, ...data.blockers]
    .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
    .filter(s => {
      const prefix = s.id.split('-')[0];
      return ['DATA', 'CRYPTO', 'EGR'].includes(prefix) || s.severity === 'critical' || s.severity === 'high';
    })
    .slice(0, 10);

  const regimes = plan.compliance?.regimes ?? [];

  const header = formatEngagementHeader(data);
  const lines: string[] = [
    ...(header ? header.split('\n') : []),
    `SWAO Assessment Report -- ${data.appId} (GRC / Compliance View)`,
    '='.repeat(60),
    `Assessed:       ${data.assessedAt}`,
    `Regulatory:     ${regulatory}`,
    `Coverage score: ${data.coverageScore}`,
    '',
  ];

  if (regimes.length > 0) {
    lines.push('Regime Coverage');
    lines.push('---------------');
    for (const r of regimes) {
      lines.push(`  ${(r.name ?? '--').padEnd(14)} ${r.status ?? '--'}`);
      if (r.gaps && r.gaps.length > 0) {
        for (const g of r.gaps) lines.push(`    gap: ${g}`);
      }
    }
    lines.push('');
  }

  if (complianceSignals.length > 0) {
    lines.push('Compliance-Relevant Signals');
    lines.push('---------------------------');
    for (const s of complianceSignals) {
      const prefix = `  ${severityLabel(s.severity)} ${s.id.padEnd(10)}  `;
      const cont   = ' '.repeat(prefix.length);
      lines.push(...wrapLines(s.derivation, prefix, cont));
      if (s.evidence && s.evidence.length > 0) {
        lines.push(`${cont}Evidence:`);
        for (const ev of s.evidence.slice(0, 3)) {
          lines.push(`${cont}  ${ev.trim()}`);
        }
      }
      lines.push('');
    }
  }

  if (data.blockers.length > 0) {
    lines.push('Blocking Findings (must resolve before go-live)');
    lines.push('-----------------------------------------------');
    lines.push('  (see Compliance-Relevant Signals above for full descriptions)');
    lines.push('');
    for (const b of data.blockers) {
      lines.push(`  ${b.id.padEnd(10)} ${truncate(b.derivation, 88)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatViewFinops(data: ReportData, wspDir: string): string {
  const spine = loadSpine(wspDir);
  const lzCat = loadLzCatalogueFit(wspDir);
  const portability = spine.overall?.portability_score !== undefined
    ? `${Math.round(spine.overall.portability_score * 100)}%`
    : '--';

  const egressSignals = [...data.topFindings, ...data.blockers]
    .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
    .filter(s => s.id.startsWith('EGR'));

  const sbomSignals = [...data.topFindings, ...data.blockers]
    .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
    .filter(s => s.id.startsWith('SBOM'));

  const lz = spine.landing_zone;

  const header = formatEngagementHeader(data);
  const lines: string[] = [
    ...(header ? header.split('\n') : []),
    `SWAO Assessment Report -- ${data.appId} (FinOps View)`,
    '='.repeat(52),
    `Assessed:                          ${data.assessedAt}`,
    `Current infrastructure (detected): ${data.landingZone || '--'}`,
    `Portability:                       ${portability}`,
    '',
  ];

  if (lzCat) {
    const targetLz = `${lzCat.provider || '--'} / ${lzCat.region || '--'}`;
    lines.push('Recommended Target Infrastructure');
    lines.push('----------------------------------');
    lines.push(`  Target landing zone: ${targetLz}`);
    if (lzCat.overall) lines.push(`  Verdict:           ${lzCat.overall}`);
    if (lz?.note) lines.push(`  Note:              ${lz.note}`);
    lines.push('');
  }

  if (egressSignals.length > 0) {
    lines.push('Egress / Data-Transfer Risk');
    lines.push('---------------------------');
    for (const s of egressSignals) {
      lines.push(`  ${severityLabel(s.severity)} ${s.id.padEnd(8)} ${truncate(s.derivation, 78)}`);
    }
    lines.push('');
  }

  if (sbomSignals.length > 0) {
    lines.push('Software Licensing / Dependency Risk');
    lines.push('------------------------------------');
    for (const s of sbomSignals) {
      lines.push(`  ${severityLabel(s.severity)} ${s.id.padEnd(8)} ${truncate(s.derivation, 78)}`);
    }
    lines.push('');
  }

  lines.push('Signal Summary');
  lines.push('--------------');
  for (const sev of SEVERITY_ORDER) {
    const n = data.signalCounts[sev] ?? 0;
    if (n > 0) lines.push(`  ${sev.padEnd(14)} ${n}`);
  }
  lines.push(`  ${'total'.padEnd(14)} ${data.signalCounts.total}`);
  lines.push('');

  return lines.join('\n');
}

export function formatViewMigrationManager(data: ReportData, wspDir: string): string {
  const spine = loadSpine(wspDir);
  const lzCat = loadLzCatalogueFit(wspDir);
  const plan = loadPlan(wspDir);
  const scenario = spine.client_scenario;

  const header = formatEngagementHeader(data);
  const lines: string[] = [
    ...(header ? header.split('\n') : []),
    `SWAO Assessment Report -- ${data.appId} (Migration / Programme Manager View)`,
    '='.repeat(74),
    `Assessed:                          ${data.assessedAt}`,
    `7R Verdict:                        ${data.sevenRLabel}`,
    `Coverage:                          ${data.coverageScore}`,
    `Current infrastructure (detected): ${data.landingZone || '--'}`,
    ...(lzCat ? [`Target landing zone:               ${lzCat.provider || '--'} / ${lzCat.region || '--'}`] : []),
    ...(scenario?.migration_trigger ? [`Migration trigger:                 ${scenario.migration_trigger}`] : []),
    ...(scenario?.target_go_live ? [`Target go-live:                    ${scenario.target_go_live}`] : []),
    ...(scenario?.rto_hours !== undefined ? [`RTO:                               ${scenario.rto_hours}h`] : []),
    ...(scenario?.rpo_hours !== undefined ? [`RPO:                               ${scenario.rpo_hours}h`] : []),
    '',
  ];

  // Migration blockers
  if (data.blockers.length > 0) {
    lines.push('Blockers -- must resolve before cutover');
    lines.push('---------------------------------------');
    for (const b of data.blockers) {
      lines.push(`  ${severityLabel(b.severity)} ${b.id.padEnd(10)} ${truncate(b.derivation, 76)}`);
    }
    lines.push('');
  } else {
    lines.push('Blockers: none identified.');
    lines.push('');
  }

  // Runbook
  const runbook = plan.migration_plan?.runbook ?? [];
  if (runbook.length > 0) {
    lines.push('Migration Runbook');
    lines.push('-----------------');
    for (const comp of runbook) {
      lines.push(`  ${comp.component ?? '--'}  (${comp.disposition ?? '--'})`);
      for (const step of (comp.steps ?? [])) {
        const stepPrefix = `    ${(step.id ?? '--').padEnd(8)}  `;
        const stepCont   = ' '.repeat(stepPrefix.length);
        lines.push(...wrapLines(step.action ?? '', stepPrefix, stepCont));
      }
    }
    lines.push('');
  }

  // Risk register
  const risks = plan.risk_register ?? [];
  if (risks.length > 0) {
    lines.push('Risk Register');
    lines.push('-------------');
    for (const r of risks) {
      const riskId  = r.risk_id ?? r.id ?? '--';
      const sevLabel = severityLabel(r.likelihood ?? r.severity ?? '--');
      const statusTag = r.status && r.status !== 'open' ? ` [${r.status}]` : '';
      const rPrefix = `  ${sevLabel} ${riskId.padEnd(10)}${statusTag}  `;
      const rCont   = ' '.repeat((`  ${sevLabel} ${riskId.padEnd(10)}  `).length);
      lines.push(...wrapLines(r.trigger ?? r.description ?? '', rPrefix, rCont));
      if (r.mitigation) {
        const mPrefix = `${rCont}mitigation: `;
        const mCont   = ' '.repeat(mPrefix.length);
        lines.push(...wrapLines(r.mitigation, mPrefix, mCont));
      }
      if (r.closed_rationale) {
        const cPrefix = `${rCont}rationale:  `;
        const cCont   = ' '.repeat(cPrefix.length);
        lines.push(...wrapLines(r.closed_rationale, cPrefix, cCont));
      }
      if (r.closed_at) lines.push(`${rCont}closed_at:  ${r.closed_at}`);
      if (r.evidence_ids?.length) lines.push(`${rCont}evidence:   ${r.evidence_ids.join(', ')}`);
      if (r.override) {
        const ov = r.override;
        lines.push(`${rCont}[OVERRIDE by ${ov.author ?? 'unknown'} (${ov.role ?? '--'}) at ${ov.timestamp ?? '--'}]`);
        if (r.machine_outcome) lines.push(`${rCont}machine verdict: ${r.machine_outcome}`);
        if (ov.rationale) {
          const ovPrefix = `${rCont}  rationale: `;
          const ovCont   = ' '.repeat(ovPrefix.length);
          lines.push(...wrapLines(ov.rationale, ovPrefix, ovCont));
        }
      }
      lines.push('');
    }
  }

  // Next steps
  if (data.nextSteps.length > 0) {
    lines.push('Next Steps');
    lines.push('----------');
    for (let i = 0; i < data.nextSteps.length; i++) {
      const prefix = `  ${i + 1}. `;
      const cont   = ' '.repeat(prefix.length);
      lines.push(...wrapLines(data.nextSteps[i], prefix, cont));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatViewLzr(_data: ReportData, wspDir: string): string {
  const lzrFile = join(resolveRunDir(wspDir), 'passes', '23-lzr.yaml');
  if (!existsSync(lzrFile)) {
    return [
      '== Landing Zone Readiness ==',
      '',
      '  No LZR assessment found. Run: swao assess --app <appId> --lzr <landingZoneId>',
      '',
    ].join('\n');
  }

  const raw = loadYaml(lzrFile) as {
    lzrResult?: {
      provider_id?: string;
      landing_zone_id?: string;
      assessed_at?: string;
      ingestion_strategy?: string;
      overall_verdict?: string;
      blockers?: Array<{ check_id: string; description: string; remediation?: string }>;
      warnings?: Array<{ check_id: string; description: string }>;
    };
  } | null;

  const lzr = raw?.lzrResult;
  if (!lzr) {
    return '== Landing Zone Readiness ==\n\n  [error] Could not parse LZR pass file.\n';
  }

  const lines: string[] = [
    '== Landing Zone Readiness ==',
    '',
    `  Provider:   ${lzr.provider_id ?? 'unknown'}`,
    `  Zone:       ${lzr.landing_zone_id ?? 'unknown'}`,
    `  Strategy:   ${lzr.ingestion_strategy ?? 'unknown'}`,
    `  Assessed:   ${lzr.assessed_at ?? 'unknown'}`,
    '',
    `  Verdict:    ${(lzr.overall_verdict ?? 'unknown').toUpperCase()}`,
    `  Blockers:   ${lzr.blockers?.length ?? 0}`,
    `  Warnings:   ${lzr.warnings?.length ?? 0}`,
  ];

  if (lzr.blockers && lzr.blockers.length > 0) {
    lines.push('');
    lines.push('  Top blockers:');
    for (const b of lzr.blockers.slice(0, 3)) {
      lines.push(`    [${b.check_id}] ${b.description.split('\n')[0].trim()}`);
      if (b.remediation) lines.push(`      Remediation: ${b.remediation.split('\n')[0].trim()}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Auditor view (#0171) -- renders the v0.10 auditor traceability fields
// ---------------------------------------------------------------------------

interface AuditorSignal {
  id: string;
  severity?: string;
  outcome?: string;
  derivation: string;
  evidence: string[];
  signal_ref?: string;
  derivation_chain?: string[];
  false_positive_considered?: boolean;
  false_positive_ruled_out?: string;
  assessor?: string;
  assessed_at?: string;
  pass: string;
}

interface AuditorControl {
  regime: string;
  id: string;
  outcome?: string;
  status?: string;
  severity?: string;
  rationale?: string;
  signal_refs?: string[];
  evidence_ids?: string[];
  evidence?: string[];
  assessor?: string;
  assessed_at?: string;
  remediation?: string;
  // #0360 -- tags taxonomy threaded through Pass 11 from the catalogue.
  // Absent on pre-v0.1.7 plans and on controls whose catalogue carries
  // no tags (graceful no-op in the renderer).
  tags?: string[];
  // Design 080 §5.2 -- cross-reference propagation annotation. Present when
  // evidence was propagated from another signal/control via signal_refs.
  derived_from?: string;
  // Design 080 §5.4 -- attributed override; machine verdict preserved.
  machine_outcome?: string;
  override?: OverrideBlock;
}

function loadAuditorSignals(wspDir: string): AuditorSignal[] {
  const out: AuditorSignal[] = [];
  let passesDir = join(wspDir, 'passes');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runPasses = join(wspDir, latestPath, 'passes');
      if (existsSync(runPasses)) passesDir = runPasses;
    } catch { /* keep default */ }
  }
  if (!existsSync(passesDir)) return out;
  const files = readdirSync(passesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
  for (const file of files) {
    const parsed = loadYaml(join(passesDir, file)) as { signals?: Array<Record<string, unknown>> } | null;
    if (!parsed?.signals) continue;
    for (const s of parsed.signals) {
      const idVal = typeof s.id === 'string' ? s.id : '';
      if (!idVal) continue;
      out.push({
        id: idVal,
        severity: typeof s.severity === 'string' ? s.severity : undefined,
        outcome: typeof s.outcome === 'string' ? s.outcome : undefined,
        derivation: typeof s.derivation === 'string' ? s.derivation : '',
        evidence: Array.isArray(s.evidence) ? (s.evidence as string[]) : [],
        signal_ref: typeof s.signal_ref === 'string' ? s.signal_ref : undefined,
        derivation_chain: Array.isArray(s.derivation_chain) ? (s.derivation_chain as string[]) : undefined,
        false_positive_considered: typeof s.false_positive_considered === 'boolean' ? s.false_positive_considered : undefined,
        false_positive_ruled_out: typeof s.false_positive_ruled_out === 'string' ? s.false_positive_ruled_out : undefined,
        assessor: typeof s.assessor === 'string' ? s.assessor : undefined,
        assessed_at: typeof s.assessed_at === 'string' ? s.assessed_at : undefined,
        pass: file,
      });
    }
  }
  return out;
}

function loadAuditorControls(wspDir: string): AuditorControl[] {
  const out: AuditorControl[] = [];
  let planPath = join(wspDir, 'wsp-plan.yaml');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runPlan = join(wspDir, latestPath, 'wsp-plan.yaml');
      if (existsSync(runPlan)) planPath = runPlan;
    } catch { /* keep default */ }
  }
  if (!existsSync(planPath)) return out;
  const parsed = loadYaml(planPath) as
    | { compliance?: { regimes?: Array<{ id?: string; name?: string; controls?: Array<Record<string, unknown>> }> } }
    | null;
  for (const regime of parsed?.compliance?.regimes ?? []) {
    const regimeName = typeof regime.id === 'string' ? regime.id : (typeof regime.name === 'string' ? regime.name : '?');
    for (const c of regime.controls ?? []) {
      out.push({
        regime: regimeName,
        id: typeof c.id === 'string' ? c.id : '?',
        outcome: typeof c.outcome === 'string' ? c.outcome : undefined,
        status: typeof c.status === 'string' ? c.status : undefined,
        severity: typeof c.severity === 'string' ? c.severity : undefined,
        rationale: typeof c.rationale === 'string' ? c.rationale : undefined,
        signal_refs: Array.isArray(c.signal_refs) ? (c.signal_refs as string[]) : undefined,
        evidence_ids: Array.isArray(c.evidence_ids) ? (c.evidence_ids as string[]) : undefined,
        evidence: Array.isArray(c.evidence) ? (c.evidence as string[]) : undefined,
        assessor: typeof c.assessor === 'string' ? c.assessor : undefined,
        assessed_at: typeof c.assessed_at === 'string' ? c.assessed_at : undefined,
        remediation: typeof c.remediation === 'string' ? c.remediation : undefined,
        tags: Array.isArray(c.tags)
          ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : undefined,
        derived_from: typeof c.derived_from === 'string' ? c.derived_from : undefined,
        machine_outcome: typeof c.machine_outcome === 'string' ? c.machine_outcome : undefined,
        override: c.override != null && typeof c.override === 'object'
          ? (c.override as OverrideBlock)
          : undefined,
      });
    }
  }
  return out;
}

function pct(num: number, den: number): string {
  if (den === 0) return 'n/a';
  return `${Math.round((num / den) * 100)}%`;
}

export function formatViewAuditor(data: ReportData, wspDir: string): string {
  const signals = loadAuditorSignals(wspDir);
  const controls = loadAuditorControls(wspDir);

  const total = signals.length;
  const sigOutcome = signals.filter((s) => !!s.outcome).length;
  const sigRationale = signals.filter((s) => s.derivation.length >= 20).length;
  const sigChain = signals.filter((s) => (s.derivation_chain ?? []).length >= 1).length;
  const sigNeedFp = signals.filter(
    (s) => s.outcome === 'negative' && (s.severity === 'medium' || s.severity === 'high' || s.severity === 'critical'),
  );
  const sigWithFp = sigNeedFp.filter(
    (s) => s.false_positive_considered === true && (s.false_positive_ruled_out ?? '').length >= 20,
  );
  const ctlOutcome = controls.filter((c) => !!c.outcome).length;
  const ctlRationale = controls.filter((c) => (c.rationale ?? '').length >= 20).length;

  const negativeBySev: Record<string, number> = {};
  for (const s of signals) {
    if (s.outcome === 'negative') {
      negativeBySev[s.severity ?? 'unknown'] = (negativeBySev[s.severity ?? 'unknown'] ?? 0) + 1;
    }
  }
  const positive = signals.filter((s) => s.outcome === 'positive').length;
  const neutral = signals.filter((s) => s.outcome === 'neutral').length;
  const indeterminate = signals.filter((s) => s.outcome === 'indeterminate').length;

  const header = formatEngagementHeader(data);
  const lines: string[] = [
    ...(header ? header.split('\n') : []),
    `SWAO Assessment Report -- ${data.appId} (Auditor View)`,
    '='.repeat(60),
    `Assessed:        ${data.assessedAt}`,
    `7R verdict:      ${data.sevenRLabel}`,
    `Coverage score:  ${data.coverageScore}`,
    `Active regimes:  ${[...new Set(controls.map((c) => c.regime))].sort().join(', ') || '--'}`,
    `Signals:         ${total} total  |  positive ${positive}  |  neutral ${neutral}  |  indeterminate ${indeterminate}`,
    '',
  ];

  // Per-control rows grouped by regime
  if (controls.length > 0) {
    const byRegime = new Map<string, AuditorControl[]>();
    for (const c of controls) {
      if (!byRegime.has(c.regime)) byRegime.set(c.regime, []);
      byRegime.get(c.regime)!.push(c);
    }
    for (const [regime, regimeControls] of byRegime) {
      lines.push(`Regime: ${regime}`);
      lines.push('-'.repeat(60));
      for (const c of regimeControls) {
        const outcome = c.outcome ?? c.status ?? '(not set)';
        const sev = c.severity ?? 'unset';
        lines.push(`  ${c.id}`);
        lines.push(`    Outcome:    ${outcome.padEnd(20)}Severity: ${sev}`);
        if (c.assessor || c.assessed_at) {
          lines.push(`    Assessor:   ${(c.assessor ?? 'unset').padEnd(20)}Assessed at: ${c.assessed_at ?? '(not set)'}`);
        }
        if (c.rationale) {
          lines.push(`    Rationale:`);
          for (const line of wrapLine(c.rationale, 70, '      ')) lines.push(line);
        } else {
          lines.push(`    Rationale:  (not yet recorded)`);
        }
        // #0360 -- inline tag taxonomy (axis.value + applies-to.*). No-op
        // when the control carries no tags, which is the case for community
        // frameworks not yet backfilled. Two-column split keeps long tag
        // arrays from blowing the line budget.
        if (c.tags && c.tags.length > 0) {
          lines.push(`    Tags:       ${c.tags.join('  ')}`);
        }
        const refs = c.signal_refs && c.signal_refs.length > 0 ? c.signal_refs.join(', ') : null;
        if (refs) lines.push(`    Signals:    ${refs}`);
        const evIds = (c.evidence_ids && c.evidence_ids.length > 0)
          ? c.evidence_ids.join(', ')
          : (c.evidence && c.evidence.length > 0 ? c.evidence.join(', ') : null);
        if (evIds) lines.push(`    Evidence:   ${evIds}`);
        if (c.derived_from) lines.push(`    Human input / audit: ${c.derived_from}`);
        if (c.override) {
          const ov = c.override;
          lines.push(`    [OVERRIDE by ${ov.author ?? 'unknown'} (${ov.role ?? '--'}) at ${ov.timestamp ?? '--'}]`);
          if (c.machine_outcome) lines.push(`    Machine verdict: ${c.machine_outcome}`);
          if (ov.rationale) {
            for (const line of wrapLine(ov.rationale, 70, '      ')) lines.push(line);
          }
        }
        if (c.remediation) {
          lines.push(`    Remediation:`);
          for (const line of wrapLine(c.remediation, 70, '      ')) lines.push(line);
        }
        lines.push('');
      }
    }
  }

  // Per-signal rows: drill-down for the most material signals (negative outcome, severity high/critical, plus all positives by prefix)
  const drillSignals = signals
    .filter((s) => s.outcome === 'negative' && (s.severity === 'critical' || s.severity === 'high' || s.severity === 'medium'))
    .slice(0, 25);
  if (drillSignals.length > 0) {
    lines.push('Per-Signal Drill-Down (top negative outcomes)');
    lines.push('-'.repeat(60));
    for (const s of drillSignals) {
      lines.push(`  ${s.id}  (${s.pass.replace(/\.ya?ml$/, '')})`);
      lines.push(`    Severity:   ${(s.severity ?? 'unset').padEnd(20)}Outcome: ${s.outcome ?? '(not set)'}`);
      if (s.assessor || s.assessed_at) {
        lines.push(`    Assessor:   ${(s.assessor ?? 'unset').padEnd(20)}Assessed at: ${s.assessed_at ?? '(not set)'}`);
      }
      lines.push(`    Derivation:`);
      for (const line of wrapLine(s.derivation, 70, '      ')) lines.push(line);
      if (s.false_positive_considered === true) {
        lines.push(`    False-positive considered: yes`);
        if (s.false_positive_ruled_out) {
          lines.push(`    Ruled out:`);
          for (const line of wrapLine(s.false_positive_ruled_out, 70, '      ')) lines.push(line);
        }
      } else if (s.outcome === 'negative' && s.severity && ['medium', 'high', 'critical'].includes(s.severity)) {
        lines.push(`    False-positive considered: (not yet recorded)`);
      }
      if (s.evidence && s.evidence.length > 0) {
        lines.push(`    Evidence:   ${s.evidence.slice(0, 3).join(', ')}${s.evidence.length > 3 ? ` (+${s.evidence.length - 3} more)` : ''}`);
      }
      if (s.derivation_chain && s.derivation_chain.length > 0) {
        lines.push(`    Chain:      ${s.derivation_chain.join(' -> ')}`);
      }
      lines.push('');
    }
  }

  // Coverage table
  lines.push('Traceability Coverage');
  lines.push('-'.repeat(60));
  lines.push(`  Signals total .................... ${total}`);
  lines.push(`  Signals with outcome ............. ${sigOutcome} (${pct(sigOutcome, total)})`);
  lines.push(`  Signals with rationale ........... ${sigRationale} (${pct(sigRationale, total)})  derivation >= 20 chars`);
  lines.push(`  Signals needing FP narrative ..... ${sigNeedFp.length}`);
  lines.push(`  Signals with FP narrative ........ ${sigWithFp.length} (${pct(sigWithFp.length, sigNeedFp.length)})`);
  lines.push(`  Signals with derivation_chain .... ${sigChain} (${pct(sigChain, total)})`);
  lines.push(`  Negative outcomes by severity ....`);
  for (const sev of ['critical', 'high', 'medium', 'low', 'informational']) {
    const n = negativeBySev[sev] ?? 0;
    if (n > 0) lines.push(`    ${sev.padEnd(15)} ${n}`);
  }
  lines.push(`  Controls total ................... ${controls.length}`);
  lines.push(`  Controls with outcome ............ ${ctlOutcome} (${pct(ctlOutcome, controls.length)})`);
  lines.push(`  Controls with rationale .......... ${ctlRationale} (${pct(ctlRationale, controls.length)})`);
  lines.push('');

  // #0263 Phase 2 -- Scope of this assessment section.
  // Auditors need to see what was NOT assessed, not just what was.
  // Reads the scope_coverage block from wsp-plan.yaml (emitted by Pass 13).
  const scopeCoverage = loadScopeCoverage(wspDir);
  if (scopeCoverage) {
    lines.push('Scope of this assessment');
    lines.push('-'.repeat(60));
    const closedSpots = scopeCoverage.blind_spots.filter((b) => b.coverage === 'closed');
    const partialSpots = scopeCoverage.blind_spots.filter((b) => b.coverage === 'partial');
    const openSpots = scopeCoverage.blind_spots.filter((b) => b.coverage === 'open');
    const ratioPct = Math.round((scopeCoverage.coverage_ratio ?? 0) * 100);
    lines.push(`  Coverage ratio: ${ratioPct}%  (${closedSpots.length} closed, ${partialSpots.length} partial, ${openSpots.length} open)`);
    lines.push('');
    lines.push('  In scope (closed by context inputs or native SWAO coverage):');
    if (closedSpots.length === 0) {
      lines.push('    (none)');
    } else {
      for (const b of closedSpots) {
        const src = b.input_provided ? ` -- input: ${b.input_provided}` : ' -- native SWAO coverage';
        lines.push(`    - ${b.id}: ${b.name ?? ''}${src}`);
      }
    }
    lines.push('');
    lines.push('  Partially covered (SWAO assesses a subset; supply additional inputs to close):');
    if (partialSpots.length === 0) {
      lines.push('    (none)');
    } else {
      for (const b of partialSpots) {
        lines.push(`    - ${b.id}: ${b.name ?? ''}  [${b.severity}]`);
        if (b.partial_coverage_note) {
          for (const line of wrapLine(b.partial_coverage_note, 68, '      ')) lines.push(line);
        }
      }
    }
    lines.push('');
    lines.push('  Outside scope of this run (assess by other means; supply input to close):');
    if (openSpots.length === 0) {
      lines.push('    (none)');
    } else {
      for (const b of openSpots) {
        lines.push(`    - ${b.id}: ${b.name ?? ''}  [${b.severity}]`);
        if (b.input_required) {
          for (const line of wrapLine(`Close by: ${b.input_required}`, 68, '      ')) lines.push(line);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// #0263 Phase 2 -- read scope_coverage block from wsp-plan.yaml.
interface ScopeCoverageBlock {
  catalogue_version?: string;
  total_blind_spots?: number;
  closed?: number;
  partial?: number;
  open?: number;
  coverage_ratio?: number;
  blind_spots: Array<{
    id: string;
    name?: string;
    category?: string;
    coverage: 'closed' | 'partial' | 'open';
    severity: string;
    input_required?: string;
    input_provided?: string;
    partial_coverage_note?: string;
  }>;
}

function loadScopeCoverage(wspDir: string): ScopeCoverageBlock | null {
  let planPath = join(wspDir, 'wsp-plan.yaml');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runPlan = join(wspDir, latestPath, 'wsp-plan.yaml');
      if (existsSync(runPlan)) planPath = runPlan;
    } catch { /* keep default */ }
  }
  if (!existsSync(planPath)) return null;
  const parsed = loadYaml(planPath) as { scope_coverage?: ScopeCoverageBlock } | null;
  return parsed?.scope_coverage ?? null;
}

function wrapLine(text: string, max: number, indent: string): string[] {
  const out: string[] = [];
  const words = text.split(/\s+/);
  let line = indent;
  for (const word of words) {
    if (line.length + word.length + 1 > max + indent.length) {
      out.push(line);
      line = indent + word;
    } else if (line.length === indent.length) {
      line = indent + word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line.length > indent.length) out.push(line);
  return out;
}

// Canonical view renderers keyed on persona agent ID (#0286, sprint-039).
// Legacy view IDs (technical / exec / compliance / finops / migration-manager)
// are accepted as input via REPORT_VIEW_ALIASES with a deprecation warning;
// the renderer dispatch itself operates on canonical keys.
const VIEW_RENDERERS: Record<
  string,
  (data: ReportData, wspDir: string) => string
> = {
  'application-architect': (data) => formatText(data),
  'business-owner': formatViewExec,
  'grc-compliance-officer': formatViewCompliance,
  'finops-lead': formatViewFinops,
  'programme-manager': formatViewMigrationManager,
  lzr: formatViewLzr,
  auditor: formatViewAuditor,
};

// Both canonical IDs and legacy aliases pass --view validation. Legacy
// aliases normalise to canonical IDs inside the action (see resolveView)
// and emit a deprecation warning so scripts using e.g. `--view exec`
// keep working through M0.
export const VALID_VIEWS = [
  ...Object.keys(VIEW_RENDERERS),
  ...Object.keys(REPORT_VIEW_ALIASES),
];

function resolveView(input: string): { canonical: string; deprecated: boolean } {
  // Non-persona views (lzr / auditor / unknown) pass through unchanged.
  // Persona views: canonical IDs pass through; legacy aliases normalise
  // + emit a deprecation warning at call site.
  const agentId = reportViewToAgentId(input);
  if (agentId === null) {
    return { canonical: input, deprecated: false };
  }
  return { canonical: agentId, deprecated: input !== agentId };
}

function viewFilenameToken(canonicalView: string): string {
  // Use the PERSONA reportViewAlias so filenames reflect content:
  // application-architect -> 'technical'; persona views -> their alias;
  // other views (lzr / auditor) keep their own name.
  if (canonicalView === 'application-architect') return 'technical';
  if (canonicalView in PERSONAS) {
    return PERSONAS[canonicalView as keyof typeof PERSONAS].reportViewAlias;
  }
  return canonicalView;
}

/**
 * Host dependencies injected into registerReport (#0579 + #0583). `runForApp` is
 * the production per-app runner the host builds from its resolved swao CLI path
 * (buildSpawnRunForApp); the general --portfolio branch dispatches through it.
 *
 * #0583 (per-tier builds): renderPdf / runPortfolio / formatPortfolioResult are
 * injected so the higher-tier module CODE can be excluded from lower-tier
 * bundles. In Community + Consultant builds the portfolio slots are gated stubs
 * (throw the Enterprise tier error); in Community the pdf slot is a gated stub
 * (throws the Consultant tier error). The `requireTier` gate in the action fires
 * FIRST in lower tiers, so the stub is never reached on the happy path; if a
 * real impl is somehow absent at call time, the stub throws the same tier error
 * (defensive). The types are imported via `import type` (erased by esbuild), so
 * declaring these slots does NOT pull the module code into the bundle.
 */
export interface ReportDeps {
  runForApp: PortfolioRunDeps['runForApp'];
  /** Community: render the WSP run as a Mode A HTML publication (#0877). */
  renderHtml?: (wspRunDir: string) => Promise<string>;
  /** Consultant: render an already-formatted text report to a PDF file. */
  renderPdf?: (args: RenderPdfArgs) => Promise<void>;
  /** Consultant: render an LLM Assessment Model Comparison Matrix as a PDF (#1531). */
  renderLlmPdf?: (args: LlmPdfArgs) => Promise<void>;
  /** Enterprise: spawn-based per-app portfolio dispatcher. */
  runPortfolio?: (
    workspacePath: string,
    command: 'assess' | 'report',
    extraArgs: string[],
    deps: PortfolioRunDeps,
  ) => Promise<PortfolioResult>;
  /** Enterprise: render a PortfolioResult as a human-readable summary block. */
  formatPortfolioResult?: (result: PortfolioResult) => string;
}

export function registerReport(program: Command, deps: ReportDeps): void {
  program
    .command('report')
    .description('Generate a WSP assessment summary report from completed pass output. Use --portfolio to report across all apps (Enterprise).')
    .option('--app <appId>', 'Application ID to report on (required unless --portfolio)')
    .option('--workspace <path>', 'Portfolio workspace directory (default: cwd)')
    .option('--format <fmt>', 'Output format: text, yaml, json, pdf, or html (default: text; pdf requires Consultant; html is Community). yaml/json on --view auditor emit a Zod-validated AuditorReport payload.', 'text')
    .option(
      '--view <name>',
      'Report view (#0286 canonical persona IDs): ' +
      'application-architect (Application Architect, default), ' +
      'business-owner (Business Owner), ' +
      'grc-compliance-officer (GRC / Compliance Officer), ' +
      'finops-lead (FinOps Lead), ' +
      'programme-manager (Migration / Programme Manager), ' +
      'lzr, auditor. ' +
      'Legacy aliases (technical, exec, compliance, finops, migration-manager) still accepted with a deprecation warning.',
      'application-architect',
    )
    .option('--output <file>', 'Write output to file instead of stdout')
    .option('--run <runId>', 'Load a specific run by run-directory timestamp (e.g. 2026-07-04T14-23-55); bypasses latest.txt. Useful with multi-type workspaces (#0785).')
    .option('--portfolio', 'Report on all apps in the workspace (Enterprise feature)', false)
    .option('--all-views', 'Generate all stakeholder views into wsp/reports-app/ folder. Combine with --format pdf to produce one PDF per view; default is text.', false)
    .option('--type <assessmentType>', 'Assessment type: application (default), landing-zone-catalog, or llm', 'application')
    .on('option:format', (value: string) => {
      if (value === 'pdf') {
        try {
          LicenseGuard.load().requireTier('consultant', { feature: 'report --format pdf' });
        } catch (e) {
          if (e instanceof LicenseTierError || e instanceof LicenseLimitError) {
            console.error([
              '[LICENSE] swao report --format pdf requires a Consultant or Enterprise license.',
              'Run `swao license request` to obtain a license.',
              'Contact: https://github.com/Accenture/SWAO/discussions',
            ].join('\n'));
            process.exit(2);
          }
        }
      }
    })
    .action(async (opts: { app?: string; workspace?: string; format: string; view: string; output?: string; run?: string; portfolio: boolean; allViews: boolean; type: string }) => {
      // --- Portfolio enterprise gate ---
      if (opts.portfolio) {
        const guard = LicenseGuard.load();
        try {
          guard.requireTier('enterprise', { feature: 'report --portfolio' });
        } catch (err) {
          if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
            console.error([
              '[LICENSE] swao report --portfolio requires an Enterprise license.',
              'Run `swao license request` to obtain a license.',
              'Contact: https://github.com/Accenture/SWAO/discussions',
            ].join('\n'));
            process.exit(1);
          }
          if (err instanceof LicenseInvalidError) {
            console.error(`[LICENSE] Invalid license: ${(err as Error).message}`);
            process.exit(3);
          }
          throw err;
        }

        const workspaceRoot = opts.workspace
          ? resolve(opts.workspace)
          : (findWorkspace(process.cwd()) ?? process.cwd()); // #0137 fallback

        if (opts.view === 'lzr') {
          // Symmetric dual-wsp (#0230): portfolio LZR summary lives under
          // <workspace>/wsp/runs/<ts>/lzr-summary.json; latest.txt points
          // at the most recent run, mirroring the per-app convention.
          const portfolioWspDir = join(workspaceRoot, 'wsp');
          const portfolioLatestFile = join(portfolioWspDir, 'latest.txt');
          let summaryFile = '';
          if (existsSync(portfolioLatestFile)) {
            try {
              const latestPath = readFileSync(portfolioLatestFile, 'utf-8').trim();
              const candidate = join(portfolioWspDir, latestPath, 'lzr-summary.json');
              if (existsSync(candidate)) summaryFile = candidate;
            } catch { /* fall through to error */ }
          }
          if (!summaryFile) {
            console.error('[error] No portfolio LZR summary found. Run: swao assess --portfolio --lzr <landingZoneId>');
            process.exit(1);
          }
          const summary = JSON.parse(readFileSync(summaryFile, 'utf-8')) as PortfolioLzrSummary;
          const output = formatPortfolioLzrReport(summary);
          if (opts.output) {
            writeFileSync(resolve(opts.output), output, 'utf-8');
            console.log(`[ok]  Portfolio LZR report written to ${opts.output}`);
          } else {
            console.log(output);
          }
          process.exit(0);
        }

        // #0579: general portfolio report. The orchestrator discovers apps
        // under <workspace>/apps/ and spawns `swao report --app <id>` per app
        // via the host-injected runForApp, then aggregates ok/fail. It does NOT
        // pass --portfolio to the per-app runs (no re-entry). The LZR aggregate
        // (--view lzr, above) is a separate host-side path and stays untouched.
        // #0583: runPortfolio / formatPortfolioResult are Enterprise-tier
        // injected deps. The requireTier('enterprise') gate above fires first in
        // lower tiers, so this branch is unreachable there; the explicit guard
        // is defensive (a missing impl throws the same Enterprise tier error).
        if (!deps.runPortfolio || !deps.formatPortfolioResult) {
          // Re-assert the gate (throws the Enterprise tier error in lower
          // tiers); if it does not throw, an Enterprise build forgot to wire
          // the impl, which is a host-bootstrap bug, not an operator error.
          LicenseGuard.load().requireTier('enterprise', { feature: 'report --portfolio' });
          throw new Error('[bug] report --portfolio: Enterprise portfolio impl not injected.');
        }
        const result = await deps.runPortfolio(workspaceRoot, 'report', [], deps as PortfolioRunDeps);
        console.log(deps.formatPortfolioResult(result));
        process.exit(result.counts.failed > 0 ? 1 : 0);
      }

      // --- PDF consultant gate ---
      // Licence check runs first; the actual PDF rendering happens further
      // down the function, sharing the same view-renderer / output-path
      // resolution as text/yaml/json. Failing the licence gate exits with
      // a code that callers can grep for.
      if (opts.format === 'pdf') {
        const guard = LicenseGuard.load();
        try {
          guard.requireTier('consultant', { feature: 'report --format pdf' });
        } catch (err) {
          if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
            console.error([
              '[LICENSE] swao report --format pdf requires a Consultant or Enterprise license.',
              'Run `swao license request` to obtain a license.',
              'Contact: https://github.com/Accenture/SWAO/discussions',
            ].join('\n'));
            process.exit(2);
          }
          if (err instanceof LicenseInvalidError) {
            console.error(`[LICENSE] Invalid license: ${(err as Error).message}`);
            process.exit(3);
          }
          throw err;
        }
        // fall through -- the main rendering path handles format=pdf below.
      }

      if (!opts.app) {
        console.error('[error] --app <appId> is required (or use --portfolio for all apps)');
        process.exit(1);
      }

      const workspaceRoot = opts.workspace
        ? resolve(opts.workspace)
        : (findWorkspace(process.cwd()) ?? process.cwd()); // #0137 fallback
      const workspaceAppDir = join(workspaceRoot, 'apps', opts.app);

      setWorkspaceRoot(workspaceRoot);

      if (!existsSync(workspaceAppDir)) {
        console.error(
          `[error] App '${opts.app}' not found in workspace.\n` +
          `  Expected: ${workspaceAppDir}\n` +
          `  -- Run 'swao setup' if you have not configured a workspace yet, or\n` +
          `  -- cd into your workspace directory and try again.\n` +
          `  Workspace searched: ${workspaceRoot}`,
        );
        process.exit(1);
      }

      // --- LZ report branch (#1120) ---
      if (opts.type === 'landing-zone-catalog') {
        const wspDir = join(workspaceAppDir, 'wsp');
        const lzData = generateLzReport(workspaceAppDir, opts.app!);

        const lzLatestFile = join(wspDir, 'latest-landing-zone-catalog.txt');
        let lzRunTsPrefix = '';
        if (existsSync(lzLatestFile)) {
          try {
            const latestPath = readFileSync(lzLatestFile, 'utf-8').trim();
            lzRunTsPrefix = latestPath.replace(/^runs\//, '') + '-';
          } catch { /* no prefix */ }
        }

        const lzBranding = buildLicenseeBranding();
        let lzOutput: string;
        let lzOutExt = 'txt';

        if (opts.format === 'yaml') {
          lzOutExt = 'yaml';
          const body = formatLzYaml(lzData);
          lzOutput = lzBranding.yaml ? lzBranding.yaml + body : body;
        } else if (opts.format === 'json') {
          lzOutExt = 'json';
          const base = {
            app: lzData.appId,
            assessed_at: lzData.assessedAt,
            assessment_mode: lzData.assessmentMode,
            ...(lzData.engagement ? { engagement: lzData.engagement } : {}),
            targets: lzData.targets,
            challenge_findings: lzData.challengeFindings,
          };
          const wrapped = lzBranding.data ? { _generated_for: lzBranding.data, ...base } : base;
          lzOutput = JSON.stringify(wrapped, null, 2);
        } else if (opts.format === 'pdf') {
          lzOutExt = 'pdf';
          const lzText = formatLzText(lzData);
          lzOutput = lzBranding.text.length > 0 ? lzBranding.text.join('\n') + '\n' + lzText : lzText;
        } else {
          const lzText = formatLzText(lzData);
          lzOutput = lzBranding.text.length > 0 ? lzBranding.text.join('\n') + '\n' + lzText : lzText;
        }

        const reportsLzDir = join(wspDir, 'reports-lz');
        mkdirSync(reportsLzDir, { recursive: true });
        const lzOutPath = opts.output
          ? resolve(opts.output)
          : join(reportsLzDir, `${lzRunTsPrefix}lz-report.${lzOutExt}`);

        if (opts.format === 'pdf') {
          if (!deps.renderPdf) {
            LicenseGuard.load().requireTier('consultant', { feature: 'report --format pdf' });
            throw new Error('[bug] report --format pdf: Consultant pdf renderer not injected.');
          }
          const lzRows    = buildLzTargetRows(lzData);
          const agentIds  = getLzAgentIds(lzData);
          const reportsExpected = agentIds.length > 0 ? agentIds.length : 1;
          logPortfolio('info', 'report.generate.start', `LZ report generation started -- ${reportsExpected} PDF(s)`, { context: { app: opts.app, report_type: 'landing-zone-catalog', reports_expected: reportsExpected } });
          for (const pe of lzData.parseErrors ?? []) {
            logPortfolio('error', 'report.generate.error', `Challenge YAML parse failed: ${pe.file}`, { context: { app: opts.app, source: pe.file, reason: pe.reason } });
          }
          let reportsGenerated = 0;
          if (agentIds.length > 0) {
            // One PDF per challenge agent (mirrors app-report per-view PDFs)
            for (const agentId of agentIds) {
              const agentToken = agentId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
              const agentPath  = join(reportsLzDir, `${lzRunTsPrefix}lz-${agentToken}.pdf`);
              await deps.renderPdf({
                textBody:   lzOutput,
                outputPath: agentPath,
                appId:      opts.app!,
                viewName:   `lz-${agentToken}`,
                branding:   lzBranding,
                data:       buildLzReportDataStubForAgent(lzData, agentId),
                product:    { swaoVersion: SWAO_VERSION, contactsInline: SWAO_CONTACTS_INLINE, landingUrl: SWAO_LANDING_URL },
                lzTargets:  lzRows,
              });
              reportsGenerated++;
              logPortfolio('info', 'report.generate.ok', `LZ report written: ${agentPath}`, { context: { app: opts.app, file: agentPath, agent_id: agentId } });
              console.log(`[ok]  Report written to ${agentPath}`);
            }
          } else {
            // No challenge findings: generate one combined overview PDF
            await deps.renderPdf({
              textBody:   lzOutput,
              outputPath: lzOutPath,
              appId:      opts.app!,
              viewName:   'lz-report',
              branding:   lzBranding,
              data:       buildLzReportDataStub(lzData),
              product:    { swaoVersion: SWAO_VERSION, contactsInline: SWAO_CONTACTS_INLINE, landingUrl: SWAO_LANDING_URL },
              lzTargets:  lzRows,
            });
            reportsGenerated++;
            logPortfolio('info', 'report.generate.ok', `LZ report written: ${lzOutPath}`, { context: { app: opts.app, file: lzOutPath } });
            console.log(`[ok]  Report written to ${lzOutPath}`);
          }
          logPortfolio('info', 'report.generate.complete', `LZ report generation complete -- ${reportsGenerated}/${reportsExpected} PDF(s)`, { context: { app: opts.app, report_type: 'landing-zone-catalog', reports_generated: reportsGenerated, parse_errors: (lzData.parseErrors ?? []).length } });
        } else {
          writeFileSync(lzOutPath, lzOutput, 'utf-8');
          console.log(`[ok]  Report written to ${lzOutPath}`);
        }
        return;
      }

      // --- LLM Assessment PDF branch (#1531) ---
      if (opts.type === 'llm') {
        if (opts.format !== 'pdf') {
          console.error('[error] LLM Assessment report only supports --format pdf. Re-run with --format pdf.');
          process.exit(1);
        }
        if (!deps.renderLlmPdf) {
          LicenseGuard.load().requireTier('consultant', { feature: 'report --type llm --format pdf' });
          throw new Error('[bug] report --type llm --format pdf: LLM PDF renderer not injected.');
        }
        const llmRoot    = join(workspaceRoot, 'llm-assessments', 'swao');
        const latestFile = join(llmRoot, 'latest.txt');
        if (!existsSync(latestFile)) {
          console.error(
            `[error] No LLM assessment found for workspace ${workspaceRoot}.\n` +
            `  Run 'swao assess --type llm --app ${opts.app}' first.`,
          );
          process.exit(1);
        }
        const runTs       = readFileSync(latestFile, 'utf-8').trim();
        const pubModelPath = join(llmRoot, runTs, 'comparison', 'publication-model.json');
        if (!existsSync(pubModelPath)) {
          console.error(`[error] LLM assessment publication model not found: ${pubModelPath}`);
          process.exit(1);
        }
        const raw     = JSON.parse(readFileSync(pubModelPath, 'utf-8')) as Record<string, unknown>;
        const rawFinal = (raw['final'] ?? {}) as { score?: Record<string, number | null>; rank?: Record<string, number | null> };

        const reportLlmDir = join(workspaceAppDir, 'wsp', 'reports-llm');
        mkdirSync(reportLlmDir, { recursive: true });
        const llmOutPath = opts.output ? resolve(opts.output) : join(reportLlmDir, `${runTs}-llm-comparison.pdf`);

        logPortfolio('info', 'report.generate.start', `LLM report generation started`, { context: { app: opts.app, report_type: 'llm', output: llmOutPath } });
        await deps.renderLlmPdf({
          outputPath:  llmOutPath,
          appId:       opts.app!,
          runTs,
          legs:        (raw['legs'] as LlmPdfArgs['legs'] | undefined) ?? [],
          weights:     (raw['weights'] as LlmPdfArgs['weights'] | undefined) ?? {},
          finalScores: rawFinal.score ?? {},
          finalRanks:  rawFinal.rank ?? {},
          groups:      (raw['groups'] as LlmPdfArgs['groups'] | undefined) ?? [],
          passGroups:           (raw['passGroups'] as LlmPdfArgs['passGroups'] | undefined) ?? [],
          challengePassGroups: (raw['challengePassGroups'] as LlmPdfArgs['challengePassGroups'] | undefined) ?? [],
          findings:    (raw['findings'] as LlmPdfArgs['findings'] | undefined) ?? [],
          product:     { swaoVersion: SWAO_VERSION, contactsInline: SWAO_CONTACTS_INLINE, landingUrl: SWAO_LANDING_URL },
          branding:    buildLicenseeBranding(),
        });
        logPortfolio('info', 'report.generate.ok', `LLM report written: ${llmOutPath}`, { context: { app: opts.app, file: llmOutPath } });
        console.log(`[ok]  Report written to ${llmOutPath}`);
        return;
      }

      if (!VALID_VIEWS.includes(opts.view)) {
        console.error(`[error] Unknown view "${opts.view}". Valid views: ${VALID_VIEWS.join(', ')}`);
        process.exit(1);
      }

      // #0286 -- normalise legacy view aliases to canonical agent IDs and
      // warn once on stderr. Downstream dispatch operates on canonical.
      const { canonical: canonicalView, deprecated: viewDeprecated } = resolveView(opts.view);
      if (viewDeprecated) {
        console.warn(
          `[warn] --view ${opts.view} is a deprecated alias for ${canonicalView}; ` +
          `the old name will be removed at M0. See docs/design/014-stakeholder-agents.md for the canonical taxonomy.`,
        );
      }

      const data = generateReport(workspaceAppDir, opts.app);
      const { wspDir } = resolveRunDirs(workspaceAppDir);

      // Extract run timestamp from latest.txt for filename prefix (e.g. "2026-04-30T08-13-00-")
      const latestFile = join(wspDir, 'latest.txt');
      let runTsPrefix = '';
      if (existsSync(latestFile)) {
        try {
          const latestPath = readFileSync(latestFile, 'utf-8').trim(); // "runs/2026-04-30T08-13-00"
          runTsPrefix = latestPath.replace(/^runs\//, '') + '-';
        } catch { /* no prefix */ }
      }

      // #0877: HTML format -- delegate entirely to renderModeA (Community tier).
      // renderModeA writes wsp/publications/<runTs>-<appId>.html and returns the
      // output path. This bypasses the text-rendering + output-path resolution
      // below (which is designed for text/yaml/json/pdf), so we return early.
      if (opts.format === 'html') {
        if (!deps.renderHtml) {
          throw new Error('[bug] report --format html: HTML renderer not injected.');
        }
        const wspRunDir = resolveRunDir(wspDir);
        const outputPath = await deps.renderHtml(wspRunDir);
        console.log(`[ok]  HTML publication written to ${outputPath}`);
        return;
      }

      // --all-views: generate all 5 stakeholder views into wsp/reports-app/.
      // Supports text (default) and pdf formats. yaml/json under --all-views
      // would dilute the structured-report contract, so we keep that combo
      // off the menu for now.
      if (opts.allViews) {
        const reportsDir = join(wspDir, 'reports-app');
        mkdirSync(reportsDir, { recursive: true });
        // #0286 -- canonical agent-ID ordering. Filenames keep the
        // legacy alias for operator-side downstream-tooling compat
        // via viewFilenameToken().
        const allViewKeys = [...CANONICAL_AGENT_ORDER];
        const allViewsBranding = buildLicenseeBranding();
        logPortfolio('info', 'report.generate.start', `App report generation started -- ${allViewKeys.length} view(s)`, { context: { app: opts.app, report_type: 'application', format: opts.format, reports_expected: allViewKeys.length } });
        let allViewsGenerated = 0;
        for (const v of allViewKeys) {
          const vRenderer = VIEW_RENDERERS[v] ?? VIEW_RENDERERS['application-architect'];
          const vText     = vRenderer(data, wspDir);
          const fileName  = viewFilenameToken(v);
          if (opts.format === 'pdf') {
            const vPath = join(reportsDir, `${runTsPrefix}${fileName}.pdf`);
            const brandedText = allViewsBranding.text.length > 0
              ? allViewsBranding.text.join('\n') + '\n' + vText
              : vText;
            // #0583: renderPdf is the Consultant-tier injected renderer. The
            // requireTier('consultant') gate above fired first in Community, so
            // this is unreachable there; guard defensively all the same.
            if (!deps.renderPdf) {
              LicenseGuard.load().requireTier('consultant', { feature: 'report --format pdf' });
              throw new Error('[bug] report --format pdf: Consultant pdf renderer not injected.');
            }
            await deps.renderPdf({
              textBody: brandedText,
              outputPath: vPath,
              appId: opts.app!,
              viewName: v,
              branding: allViewsBranding,
              data,
              // #0576: SWAO version / contacts / landing URL are host-only
              // branding constants; the module takes them via params.
              product: { swaoVersion: SWAO_VERSION, contactsInline: SWAO_CONTACTS_INLINE, landingUrl: SWAO_LANDING_URL },
            });
            allViewsGenerated++;
            logPortfolio('info', 'report.generate.ok', `App report written: ${vPath}`, { context: { app: opts.app, file: vPath, view: v } });
            console.log(`[ok]  Report written to ${vPath}`);
          } else {
            const vPath = join(reportsDir, `${runTsPrefix}${fileName}.txt`);
            const brandedText = allViewsBranding.text.length > 0
              ? allViewsBranding.text.join('\n') + '\n' + vText
              : vText;
            writeFileSync(vPath, brandedText, 'utf-8');
            allViewsGenerated++;
            logPortfolio('info', 'report.generate.ok', `App report written: ${vPath}`, { context: { app: opts.app, file: vPath, view: v } });
            console.log(`[ok]  Report written to ${vPath}`);
          }
        }
        logPortfolio('info', 'report.generate.complete', `App report generation complete -- ${allViewsGenerated}/${allViewKeys.length} view(s)`, { context: { app: opts.app, report_type: 'application', format: opts.format, reports_generated: allViewsGenerated } });
        return;
      }

      // M18 #0276 -- branded licensee header for Consultant / Enterprise reports.
      // Community reports get no branding. Empty branding for Community is
      // transparent at every format below.
      const branding = buildLicenseeBranding();

      let output: string;
      let outExt = 'txt';
      if (opts.format === 'pdf') {
        // PDF format renders the text view through pdfkit. The textBody
        // here is the same content the text/else branch produces, so PDF
        // == "what you'd see in --format text, styled and paginated".
        outExt = 'pdf';
        const renderer = VIEW_RENDERERS[canonicalView] ?? VIEW_RENDERERS['application-architect'];
        const rendered = renderer(data, wspDir);
        output = branding.text.length > 0
          ? branding.text.join('\n') + '\n' + rendered
          : rendered;
      } else if (opts.format === 'json') {
        // JSON output is anchored on the auditor view's structured schema (#0219).
        // For other views, fall back to the basic summary shape so --format json
        // remains usable for quick CI gates without forcing --view auditor.
        const base = canonicalView === 'auditor'
          ? buildAuditorReport(data, wspDir)
          : (data as unknown as Record<string, unknown>);
        // Spread {} when no branding so the underlying shape is unchanged.
        const wrapped = branding.data
          ? { _generated_for: branding.data, ...base }
          : base;
        output = JSON.stringify(wrapped, null, 2);
        outExt = 'json';
      } else if (opts.format === 'yaml') {
        let body: string;
        if (canonicalView === 'auditor') {
          body = dump(buildAuditorReport(data, wspDir), { lineWidth: 120 });
        } else {
          body = formatYamlReport(data);
        }
        // Prepend the _generated_for block when branded; transparent for Community.
        output = branding.yaml ? branding.yaml + body : body;
        outExt = 'yaml';
      } else {
        const renderer = VIEW_RENDERERS[canonicalView] ?? VIEW_RENDERERS['application-architect'];
        const rendered = renderer(data, wspDir);
        output = branding.text.length > 0
          ? branding.text.join('\n') + '\n' + rendered
          : rendered;
      }

      // Resolve output path: explicit flag > auto-save to wsp/reports-app/ with run timestamp > stdout
      let outPath = opts.output ? resolve(opts.output) : null;
      if (!outPath && existsSync(latestFile)) {
        const reportsDir = join(wspDir, 'reports-app');
        mkdirSync(reportsDir, { recursive: true });
        // #0286 / #1119 -- viewFilenameToken maps to reportViewAlias
        // (application-architect -> "technical"; persona views -> their alias;
        // lzr/auditor unchanged).
        const viewName = viewFilenameToken(canonicalView);
        outPath = join(reportsDir, `${runTsPrefix}${viewName}.${outExt}`);
      }

      if (outPath) {
        if (opts.format === 'pdf') {
          // #0583: see the --all-views branch; renderPdf is Consultant-injected.
          if (!deps.renderPdf) {
            LicenseGuard.load().requireTier('consultant', { feature: 'report --format pdf' });
            throw new Error('[bug] report --format pdf: Consultant pdf renderer not injected.');
          }
          await deps.renderPdf({
            textBody:   output,
            outputPath: outPath,
            appId:      opts.app!,
            viewName:   canonicalView,
            branding,
            data,
            // #0576: host-only branding constants injected into the module.
            product: { swaoVersion: SWAO_VERSION, contactsInline: SWAO_CONTACTS_INLINE, landingUrl: SWAO_LANDING_URL },
          });
        } else {
          writeFileSync(outPath, output, 'utf-8');
        }
        console.log(`[ok]  Report written to ${outPath}`);
      } else if (opts.format === 'pdf') {
        // PDF on stdout makes no sense; force the auto-path resolution above.
        console.error('[error] PDF format requires --output <file> or an existing wsp/latest.txt for auto-save.');
        process.exit(1);
      } else {
        console.log(output);
      }
    });
}
