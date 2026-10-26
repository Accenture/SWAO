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

// LZ Assessment report generation (#1120).
// Reads lz-fit-*.yaml pass files and LZCA_*.yaml challenge files and
// produces text / YAML / JSON report content. PDF rendering delegates to
// @swao/module-pdf-report via a ReportData stub so the same renderer is reused.

import { basename, dirname, join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { load as loadYaml, dump } from 'js-yaml';
import type { ReportData, EngagementMeta, SignalEntry, ChallengeAgentFinding } from '@swao/core';
import { readRunStatus, normalizeDashes, selectChallengeForRun, challengeSourceLabel, CHALLENGE_OTHER_RUN_NOTE, staleChallengeNote, challengeCommand } from '@swao/core';
import { wrapLines } from './report.js';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface LzFitEntry {
  provider: string;
  region: string;
  overall: string;
  assessmentMode: string;
  sovereigntyStatement: string;
  /** #1241: false when no sovereignty requirements were active (DEMO run). */
  sovereigntyActive: boolean;
  /** #1246: classifies the blocking reason; present only when overall === 'SOVEREIGNTY_BLOCKED'. */
  blockerCategory?: string;
  items: Record<string, unknown>[];
  generatedAt: string;
}

/** Structurally matches LzFrameworkItem / ComplianceControlRow in the PDF module. */
export interface LzItemRow {
  id:        string;
  verdict:   string;
  rationale: string;
}

/** Structurally matches LzTargetRow in the PDF module (structural typing; no import needed). */
export interface LzTargetRow {
  csp:            string;
  region:         string;
  verdict:        string;
  frameworks:     string;
  services:       string;
  mode:           string;
  frameworkItems: LzItemRow[];
}

export interface LzChallengeEntry {
  agentId: string;
  agentRole: string;
  openingSummary?: string;
  findings: Array<{
    id: string;
    severity: string;
    concern: string;
    evidenceGap?: string;
    recommendedQuestion?: string;
  }>;
}

export interface LzReportData {
  appId: string;
  assessedAt: string;
  assessmentMode: string;
  targets: LzFitEntry[];
  /** #3281: targets a `partial` run skipped, with the reason (run-status.json failed_targets). */
  skippedTargets?: Array<{ provider: string; region: string; reason: string }>;
  /** #3281: configured geographies resolved to their default region. */
  resolvedTargets?: Array<{ requested: string; resolved: string; geography: string }>;
  challengeFindings: LzChallengeEntry[];
  /** #3330: which challenge (timestamp, run) the findings come from. */
  challengeSource?: string;
  /** #3330: a challenge of another run exists and was left out. */
  challengeOtherRunOmitted?: boolean;
  /** #3446: names the other run's challenge (staleChallengeNote, @swao/core); set only without findings. */
  challengeNote?: string;
  /** #3446: exact command that challenges the reported run (challengeCommand, @swao/core); set only without findings. */
  challengeRunCommand?: string;
  engagement?: EngagementMeta;
  /** Files that could not be parsed; used to log report.generate.error events. */
  parseErrors?: Array<{ file: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export function resolveLzRunDir(wspDir: string): string {
  const latestFile = join(wspDir, 'latest-landing-zone-catalog.txt');
  if (existsSync(latestFile)) {
    try {
      const raw = readFileSync(latestFile, 'utf-8').trim();
      const runDir = join(wspDir, raw);
      if (existsSync(runDir)) return runDir;
    } catch { /* fall through */ }
  }
  return wspDir;
}

/** #3343: run-directory id shape (`2026-10-18T21-36-25`, optional suffix); rejects paths such as `../x`. */
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[A-Za-z0-9_-]*$/;

/** #3346: `--run <id>` names no usable run of the requested assessment type. */
export class RunNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunNotFoundError';
  }
}

/** #3343: `--run <id>` names no usable landing-zone-catalog run. */
export class LzRunNotFoundError extends RunNotFoundError {
  constructor(message: string) {
    super(message);
    this.name = 'LzRunNotFoundError';
  }
}

/** Assessment types whose reports accept `--run` (#3343, #3346). */
export type RunReportType = 'application' | 'landing-zone-catalog';

/**
 * #3343 / #3346: resolve `--run <id>` (also accepted as `runs/<id>`) to
 * `wsp/runs/<id>`. Throws (via `makeError`, RunNotFoundError by default) when
 * the id is malformed, the run directory does not exist, or run-status.json
 * names another assessment type, so `swao report --run` never silently falls
 * back to the latest run. A run without run-status.json (older runs) passes.
 */
export function resolveRunDirById(
  wspDir: string,
  runId: string,
  expectedType: RunReportType,
  makeError: (message: string) => RunNotFoundError = (m) => new RunNotFoundError(m),
): string {
  const id = runId.trim().replace(/^runs[\\/]/, '');
  if (!RUN_ID_RE.test(id)) {
    throw makeError(`Invalid --run '${runId}': expected a run-directory timestamp such as 2026-10-18T21-36-25.`);
  }
  const runDir = join(wspDir, 'runs', id);
  if (!existsSync(runDir)) {
    throw makeError(`Run '${id}' not found: ${runDir} does not exist.`);
  }
  const type = readRunStatus(runDir)?.assessment_type;
  if (type !== undefined && type !== expectedType) {
    throw makeError(`Run '${id}' is a ${type} run, not ${expectedType === 'application' ? 'an' : 'a'} ${expectedType} run.`);
  }
  return runDir;
}

/**
 * #3343: `--run <id>` for `--type landing-zone-catalog`; throws
 * LzRunNotFoundError (see resolveRunDirById).
 */
export function resolveLzRunDirById(wspDir: string, runId: string): string {
  return resolveRunDirById(wspDir, runId, 'landing-zone-catalog', (m) => new LzRunNotFoundError(m));
}

/**
 * #3343: `runId` (from `--run`) selects the run; without it the latest LZ run
 * pointer decides (resolveLzRunDir). The challenge is paired with the selected run.
 */
export function generateLzReport(workspaceAppDir: string, appId: string, runId?: string): LzReportData {
  const wspDir = join(workspaceAppDir, 'wsp');
  const runDir = runId !== undefined ? resolveLzRunDirById(wspDir, runId) : resolveLzRunDir(wspDir);

  const passesDir = join(runDir, 'passes');
  const targets: LzFitEntry[] = [];
  let assessedAt = '';

  if (existsSync(passesDir)) {
    let files: string[] = [];
    try { files = readdirSync(passesDir).filter(f => /^lz-fit[^.]*\.ya?ml$/.test(f)).sort(); }
    catch { /* unreadable */ }
    for (const file of files) {
      try {
        const raw = readFileSync(join(passesDir, file), 'utf-8');
        const parsed = loadYaml(raw) as Record<string, unknown> | null;
        if (!parsed?.assessment) continue;
        const a = parsed.assessment as Record<string, unknown>;
        const p = (parsed.pass ?? {}) as Record<string, unknown>;
        if (!assessedAt && typeof p.assessed_at === 'string') assessedAt = p.assessed_at;
        targets.push({
          provider: String(a.provider ?? ''),
          region: String(a.region ?? ''),
          overall: String(a.overall ?? ''),
          assessmentMode: String(a.assessment_mode ?? 'catalogue-sovereignty-only'),
          sovereigntyStatement: normalizeDashes(String(a.sovereignty_statement ?? '')),
          sovereigntyActive: a.sovereignty_active !== false,
          blockerCategory: typeof a.blocker_category === 'string' ? a.blocker_category : undefined,
          items: Array.isArray(a.items) ? (a.items as Record<string, unknown>[]) : [],
          generatedAt: String(a.generated_at ?? ''),
        });
      } catch { /* skip malformed file */ }
    }
  }

  const modes = [...new Set(targets.map(t => t.assessmentMode))];
  const assessmentMode = modes.length === 1 ? (modes[0] ?? 'catalogue-sovereignty-only') : 'mixed';

  const parseErrors: Array<{ file: string; reason: string }> = [];
  // #3330: only the challenge of the reported run (or none) is embedded.
  const challengeSel = selectChallengeForRun(wspDir, 'lz', runDir);
  const challengeFindings = challengeSel.dir ? loadLzChallengeFindings(challengeSel.dir, parseErrors) : [];
  const challengeSource = challengeFindings.length > 0 ? challengeSourceLabel(challengeSel) : undefined;
  // #3446: without findings, name the other run's challenge and the exact command for this run.
  const challengeNote = challengeFindings.length === 0 ? staleChallengeNote(challengeSel) : undefined;
  const reportedRunId = basename(dirname(runDir)) === 'runs' ? basename(runDir) : undefined;
  const challengeRunCommand = challengeFindings.length === 0 ? challengeCommand(appId, 'lz', reportedRunId) : undefined;
  const engagement = loadLzEngagement(runDir);

  // #3281: a partial run (some targets skipped) records them in run-status.json.
  const status = runDir !== wspDir ? readRunStatus(runDir) : undefined;
  const skippedTargets = status?.status === 'partial' && status.failed_targets?.length
    ? status.failed_targets.map(f => ({ provider: f.provider, region: f.region, reason: normalizeDashes(f.reason) }))
    : undefined;
  const resolvedTargets = status?.resolved_targets?.length ? status.resolved_targets.map(r => ({ ...r })) : undefined;

  return {
    appId, assessedAt, assessmentMode, targets,
    ...(skippedTargets ? { skippedTargets } : {}),
    ...(resolvedTargets ? { resolvedTargets } : {}),
    challengeFindings,
    ...(challengeSource ? { challengeSource } : {}),
    ...(challengeSel.otherRunOmitted ? { challengeOtherRunOmitted: true } : {}),
    ...(challengeNote ? { challengeNote } : {}),
    ...(challengeRunCommand ? { challengeRunCommand } : {}),
    engagement, parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  };
}

/** Read LZCA_*.yaml from the challenge dir selected for the reported run (#3330). */
function loadLzChallengeFindings(challengeDir: string, parseErrors: Array<{ file: string; reason: string }> = []): LzChallengeEntry[] {
  const entries: LzChallengeEntry[] = [];
  let files: string[] = [];
  try { files = readdirSync(challengeDir).filter(f => /^LZCA_.+\.ya?ml$/.test(f)).sort(); }
  catch { return entries; }

  for (const file of files) {
    try {
      const raw = readFileSync(join(challengeDir, file), 'utf-8');
      const parsed = loadYaml(raw) as Record<string, unknown> | null;
      if (!parsed) {
        parseErrors.push({ file, reason: 'YAML parse failed -- file may contain a malformed header (e.g. bare language tag from LLM code fence)' });
        continue;
      }
      const agentId = String(parsed.agent_id ?? file.replace(/^LZCA_/, '').replace(/\.ya?ml$/, ''));
      const agentRole = String(parsed.agent_role ?? agentId);
      const openingSummary = typeof parsed.opening_summary === 'string'
        ? normalizeDashes(parsed.opening_summary)
        : undefined;
      const rawFindings = Array.isArray(parsed.findings) ? (parsed.findings as Record<string, unknown>[]) : [];
      const findings = rawFindings
        .filter(f => typeof f.id === 'string' && typeof f.concern === 'string')
        .map(f => ({
          id: String(f.id),
          severity: String(f.severity ?? 'MEDIUM'),
          concern: normalizeDashes(String(f.concern)),
          evidenceGap: typeof f.evidence_gap === 'string' ? normalizeDashes(f.evidence_gap) : undefined,
          recommendedQuestion: typeof f.recommended_question === 'string' ? normalizeDashes(f.recommended_question) : undefined,
        }));
      if (findings.length > 0) entries.push({ agentId, agentRole, openingSummary, findings });
    } catch (err) {
      parseErrors.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return entries;
}

function loadLzEngagement(runDir: string): EngagementMeta | undefined {
  const spineFile = join(runDir, 'wsp.yaml');
  if (!existsSync(spineFile)) return undefined;
  try {
    const parsed = loadYaml(readFileSync(spineFile, 'utf-8')) as Record<string, unknown> | null;
    const e = (parsed?.engagement ?? {}) as Record<string, unknown>;
    const eng: EngagementMeta = {
      name:             typeof e.name             === 'string' ? e.name             : undefined,
      client_code:      typeof e.client_code      === 'string' ? e.client_code      : undefined,
      partnership_lead: typeof e.partnership_lead === 'string' ? e.partnership_lead : undefined,
      start_date:       typeof e.start_date       === 'string' ? e.start_date       : undefined,
    };
    return (eng.name || eng.client_code || eng.partnership_lead || eng.start_date) ? eng : undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

function verdictLabel(verdict: string): string {
  return `[${verdict.padEnd(20)}]`;
}

function severityTag(sev: string): string {
  return `[${sev.toLowerCase().padEnd(6)}]`;
}

function formatLzComparisonTable(data: LzReportData): string[] {
  if (data.targets.length === 0) return [];
  // #2409: COL_VERDICT widened to 24 to fit 'SOVEREIGNTY_BLOCKED' (19 chars + separator).
  // The /STRUCTURAL|CERTIFICATION|MIXED subtype is dropped in the summary row and
  // shown only in the Sovereignty Gate Analysis detail section below.
  const COL_CSP     = 28;
  const COL_REGION  = 22;
  const COL_VERDICT = 24;
  const COL_FW      = 22;
  const lines: string[] = [
    'LZ Comparison',
    '-------------',
    [
      'CSP'.padEnd(COL_CSP),
      'Region'.padEnd(COL_REGION),
      'Verdict'.padEnd(COL_VERDICT),
      'Frameworks'.padEnd(COL_FW),
      'Services',
    ].join('  '),
    '-'.repeat(100),
  ];
  for (const t of data.targets) {
    const fws  = parseFrameworksFromStatement(t.sovereigntyStatement).join(', ') || '-';
    const svcs = parseServicesFromItems(t.items).join(', ') || '(catalogue-only)';
    // #1241: append /DEMO when no sovereignty requirements were active and verdict is READY.
    // #2409: drop /STRUCTURAL|CERTIFICATION|MIXED from summary row to avoid overflow;
    // the blocker subtype is shown in the Sovereignty Gate Analysis section below.
    let verdictDisplay = t.overall;
    if (!t.sovereigntyActive && t.overall === 'READY') verdictDisplay = 'READY/DEMO';
    lines.push([
      t.provider.padEnd(COL_CSP),
      t.region.padEnd(COL_REGION),
      verdictDisplay.padEnd(COL_VERDICT),
      fws.padEnd(COL_FW),
      svcs,
    ].join('  '));
  }
  lines.push('');
  return lines;
}

export function formatLzText(data: LzReportData): string {
  const title = `SWAO Landing Zone Assessment Report: ${data.appId}`;
  // #2272: engagement header appears before the report title, consistent with app reports.
  const lines: string[] = [];
  if (data.engagement) {
    const e = data.engagement;
    if (e.name)             lines.push(`Engagement:       ${e.name}`);
    if (e.client_code)      lines.push(`Client code:      ${e.client_code}`);
    if (e.partnership_lead) lines.push(`Partnership lead: ${e.partnership_lead}`);
    if (e.start_date)       lines.push(`Start date:       ${e.start_date}`);
    lines.push(`Assessed:         ${data.assessedAt || '-'}`);
    lines.push('');
  }
  lines.push(title, '='.repeat(title.length), `Assessed:  ${data.assessedAt || '-'}`, `Mode:      ${data.assessmentMode}`, '');

  if (data.targets.length === 0) {
    lines.push('No LZ assessment targets found. Run: swao assess --lzcat');
    lines.push('');
  } else {
    // Compact CSP/Region comparison table
    lines.push(...formatLzComparisonTable(data));

    lines.push('Verdict Summary');
    lines.push('---------------');
    for (const t of data.targets) {
      // #1241 + #1246: annotate verdict with DEMO or blocker category
      let v = t.overall;
      if (!t.sovereigntyActive && t.overall === 'READY') v = 'READY/DEMO';
      else if (t.blockerCategory) v = `${t.overall}/${t.blockerCategory.toUpperCase()}`;
      lines.push(`  ${verdictLabel(v)} ${t.provider} / ${t.region}`);
    }
    lines.push('');
    lines.push(...formatLzTargetNotes(data));

    lines.push('Sovereignty Gate Analysis');
    lines.push('-------------------------');
    for (const t of data.targets) {
      let v = t.overall;
      if (!t.sovereigntyActive && t.overall === 'READY') v = 'READY/DEMO';
      else if (t.blockerCategory) v = `${t.overall}/${t.blockerCategory.toUpperCase()}`;
      lines.push(`[${v}] ${t.provider} / ${t.region}`);
      for (const l of wrapLines(t.sovereigntyStatement, '  ', '  ')) lines.push(l);
      // Show item-level checks if available
      const itemRows = buildItemRows(t.items);
      if (itemRows.length > 0) {
        lines.push('');
        lines.push('  Gate checks:');
        for (const row of itemRows) {
          lines.push(`    [${row.verdict.padEnd(10)}] ${row.id}`);
          if (row.rationale) {
            for (const l of wrapLines(row.rationale, '             ', '             ')) lines.push(l);
          }
        }
      }
      lines.push('');
    }
  }

  if (data.challengeFindings.length === 0) {
    lines.push(data.challengeOtherRunOmitted
      ? `Stakeholder Challenge Findings: none for this run (${CHALLENGE_OTHER_RUN_NOTE}). Run the LZ Sovereignty Challenge to generate.`
      : 'Stakeholder Challenge Findings: none. Run the LZ Sovereignty Challenge to generate.');
    // #3446: name the other run's challenge and give the exact command.
    if (data.challengeNote) lines.push(data.challengeNote);
    if (data.challengeRunCommand) lines.push(`Command: ${data.challengeRunCommand}`);
    lines.push('');
  } else {
    lines.push('Stakeholder Challenge Findings');
    lines.push('------------------------------');
    if (data.challengeSource) lines.push(`Source: ${data.challengeSource}`);
    for (const agent of data.challengeFindings) {
      lines.push('');
      lines.push(`${agent.agentRole} (${agent.findings.length} finding${agent.findings.length === 1 ? '' : 's'})`);
      if (agent.openingSummary) {
        for (const l of wrapLines(agent.openingSummary, '  ', '  ')) lines.push(l);
        lines.push('');
      }
      for (const f of agent.findings) {
        const prefix = `  ${severityTag(f.severity)} ${f.id.padEnd(14)}  `;
        const cont   = ' '.repeat(prefix.length);
        lines.push(...wrapLines(f.concern, prefix, cont));
        if (f.recommendedQuestion) {
          const q = f.recommendedQuestion.split('\n')[0]?.trim() ?? '';
          if (q) lines.push(...wrapLines(`Question: ${q}`, cont, cont));
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/** #3281: skipped targets of a partial run and resolved geographies (text report). */
export function formatLzTargetNotes(data: LzReportData): string[] {
  const out: string[] = [];
  if (data.skippedTargets && data.skippedTargets.length > 0) {
    out.push('Skipped Targets (partial run)');
    out.push('-----------------------------');
    for (const s of data.skippedTargets) {
      const prefix = `  [SKIPPED]  ${s.provider} / ${s.region}: `;
      out.push(...wrapLines(normalizeDashes(s.reason), prefix, ' '.repeat(prefix.length)));
    }
    out.push('');
  }
  if (data.resolvedTargets && data.resolvedTargets.length > 0) {
    out.push('Resolved Geographies');
    out.push('--------------------');
    for (const r of data.resolvedTargets) out.push(`  ${r.requested} (geography ${r.geography}) assessed as ${r.resolved}`);
    out.push('');
  }
  return out;
}

// ---------------------------------------------------------------------------
// YAML formatter
// ---------------------------------------------------------------------------

export function formatLzYaml(data: LzReportData): string {
  const doc: Record<string, unknown> = {
    app: data.appId,
    assessed_at: data.assessedAt,
    assessment_mode: data.assessmentMode,
    ...(data.engagement ? { engagement: data.engagement } : {}),
    targets: data.targets.map(t => ({
      provider: t.provider,
      region: t.region,
      overall: t.overall,
      assessment_mode: t.assessmentMode,
      sovereignty_active: t.sovereigntyActive,
      sovereignty_statement: t.sovereigntyStatement,
      ...(t.blockerCategory ? { blocker_category: t.blockerCategory } : {}),
      items: t.items,
    })),
    ...(data.skippedTargets?.length ? { skipped_targets: data.skippedTargets } : {}),
    ...(data.resolvedTargets?.length ? { resolved_targets: data.resolvedTargets } : {}),
    ...(data.challengeSource ? { challenge_source: data.challengeSource } : {}),
    ...(data.challengeOtherRunOmitted ? { challenge_note: CHALLENGE_OTHER_RUN_NOTE } : {}),
    // #3446: the other run's challenge, named, and the command for this run.
    ...(data.challengeNote ? { challenge_other_run: data.challengeNote } : {}),
    ...(data.challengeRunCommand ? { challenge_command: data.challengeRunCommand } : {}),
    challenge_findings: data.challengeFindings.map(a => ({
      agent_id: a.agentId,
      agent_role: a.agentRole,
      ...(a.openingSummary ? { opening_summary: a.openingSummary } : {}),
      findings: a.findings.map(f => ({
        id: f.id,
        severity: f.severity,
        concern: f.concern,
        ...(f.evidenceGap ? { evidence_gap: f.evidenceGap } : {}),
        ...(f.recommendedQuestion ? { recommended_question: f.recommendedQuestion } : {}),
      })),
    })),
  };
  return dump(doc, { lineWidth: 120 });
}

// ---------------------------------------------------------------------------
// Helpers for parsing sovereignty_statement and items fields
// ---------------------------------------------------------------------------

const KNOWN_FRAMEWORK_CODES = [
  'BSI_C5', 'GDPR', 'ISO_27001', 'SOC_2', 'PCI_DSS', 'NIS_2', 'CCPA',
  'HIPAA', 'BSI_Grundschutz', 'NIST_SP_800', 'COBIT_5', 'AI_10_PILLARS',
];

function parseFrameworksFromStatement(stmt: string): string[] {
  // Primary: "derived from BSI_C5, GDPR" / "derived from BSI_C5, GDPR."
  const m = stmt.match(/derived from\s+([\w,\s_]+?)(?:\.|Catalogue|$)/i);
  if (m) {
    const tokens = m[1]!.split(',').map(s => s.trim()).filter(s => s.length > 0 && /^\w/.test(s));
    if (tokens.length > 0) return tokens;
  }
  // Fallback: scan for known framework codes mentioned in the statement
  return KNOWN_FRAMEWORK_CODES.filter(fw => stmt.includes(fw));
}

function parseServicesFromItems(items: Record<string, unknown>[]): string[] {
  const codes = new Set<string>();
  for (const item of items) {
    if (typeof item.service_code === 'string') codes.add(item.service_code);
  }
  return [...codes];
}

const LZ_STATUS_LABELS: Record<string, string> = {
  SUPPORTED:             'Supported',
  AVAILABLE_NOT_ENABLED: 'Available, not enabled',
  NOT_SUPPORTED:         'Not supported',
  UNKNOWN:               'Unknown',
  PASS:                  'Pass',
  FAIL:                  'Fail',
  WARN:                  'Warning',
};
function formatLzStatus(raw: string): string {
  return LZ_STATUS_LABELS[raw.toUpperCase()] ?? raw;
}

/** Build LzItemRow[] from lz-fit items (framework checks or service-level verdicts). */
function buildItemRows(items: Record<string, unknown>[]): LzItemRow[] {
  return items.map(item => {
    const fw  = typeof item.framework    === 'string' ? item.framework    : '';
    const req = typeof item.requirement  === 'string' ? item.requirement
              : typeof item.service_code === 'string' ? item.service_code : '';
    const id  = fw && req ? `${fw} / ${req}` : req || fw || '?';
    const verdict   = formatLzStatus(String(item.status  ?? item.verdict ?? 'UNKNOWN'));
    const rationale = String(item.rationale ?? item.detail ?? '');
    return { id, verdict, rationale };
  });
}

// ---------------------------------------------------------------------------
// Build LZ target rows for the PDF comparison table
// ---------------------------------------------------------------------------

export function buildLzTargetRows(data: LzReportData): LzTargetRow[] {
  return data.targets.map(t => ({
    csp:    t.provider,
    region: t.region,
    verdict: t.overall,
    frameworks: parseFrameworksFromStatement(t.sovereigntyStatement).join(', ') || '-',
    services: parseServicesFromItems(t.items).join(', ') || '(catalogue-only)',
    mode: t.assessmentMode === 'catalogue-sovereignty-only' && !t.sovereigntyActive
      ? 'Demo'
      : t.assessmentMode === 'catalogue-sovereignty-only' ? 'Catalogue' : t.assessmentMode,
    frameworkItems: buildItemRows(t.items),
  }));
}

// ---------------------------------------------------------------------------
// Agent ID helpers
// ---------------------------------------------------------------------------

export function getLzAgentIds(data: LzReportData): string[] {
  return data.challengeFindings.map(a => a.agentId);
}

// ---------------------------------------------------------------------------
// ReportData stub for PDF renderer (#1120).
// Maps LZ targets and challenge findings into the ReportData shape so the
// existing PDF renderer can produce a structured LZ-assessment PDF without
// a separate renderer implementation.
// ---------------------------------------------------------------------------

function buildLzReportDataStubInternal(data: LzReportData, agentId: string | null = null): ReportData {
  const blockedTargets = data.targets.filter(t => t.overall === 'SOVEREIGNTY_BLOCKED');
  const readyTargets   = data.targets.filter(t => t.overall === 'READY' || t.overall === 'READY_WITH_CHANGES');
  const totalTargets   = data.targets.length;
  const pct = totalTargets > 0 ? Math.round((readyTargets.length / totalTargets) * 100) : 0;

  // List all assessed LZs with their verdict annotation
  const verdictAbbr = (v: string) =>
    v === 'READY' ? 'READY' : v === 'READY_WITH_CHANGES' ? 'READY*' : 'BLOCKED';
  const landingZone = totalTargets > 0
    ? data.targets.map(t => `${t.provider}/${t.region} (${verdictAbbr(t.overall)})`).join(', ')
    : '-';

  const blockers: SignalEntry[] = blockedTargets.map(t => ({
    id: `LZ-${t.provider}-${t.region}`.replace(/[^A-Za-z0-9-]/g, '-').toUpperCase(),
    severity: 'blocker',
    derivation: t.sovereigntyStatement,
    evidence: [],
  }));

  const topFindings: SignalEntry[] = readyTargets.map(t => ({
    id: `LZ-${t.provider}-${t.region}`.replace(/[^A-Za-z0-9-]/g, '-').toUpperCase(),
    severity: 'positive',
    derivation: t.sovereigntyStatement,
    evidence: [],
  }));

  // Filter challenge findings to a specific agent when generating per-agent PDFs
  const relevantChallenges = agentId
    ? data.challengeFindings.filter(a => a.agentId === agentId)
    : data.challengeFindings;

  const challengeFindings: ChallengeAgentFinding[] = relevantChallenges.map(a => ({
    agentId: a.agentId,
    agentRole: a.agentRole,
    openingSummary: a.openingSummary,
    findings: a.findings.map(f => ({
      id: f.id,
      concern: f.concern,
      evidenceGap: f.evidenceGap,
      recommendedQuestion: f.recommendedQuestion,
    })),
  }));

  // Recommended next steps from HIGH-severity findings (from relevant challenges only)
  const nextSteps: string[] = relevantChallenges
    .flatMap(a => a.findings.filter(f => f.severity === 'HIGH'))
    .slice(0, 5)
    .map(f => f.recommendedQuestion ?? f.concern);

  return {
    appId: data.appId,
    assessedAt: data.assessedAt,
    iter: 1,
    sevenRLabel: '',          // empty = suppress 7R row in drawSummaryTable (not applicable for LZ)
    coverageScore: `${pct}%`,
    landingZone,
    signalCounts: {
      total: totalTargets,
      ...(blockedTargets.length > 0 ? { blocker: blockedTargets.length } : {}),
      ...(readyTargets.length > 0 ? { positive: readyTargets.length } : {}),
    },
    blockers,
    topFindings,
    nextSteps,
    engagement: data.engagement,
    challengeFindings,
    ...(data.challengeSource ? { challengeSource: data.challengeSource } : {}),
    ...(data.challengeOtherRunOmitted ? { challengeOtherRunOmitted: true } : {}),
  };
}

export function buildLzReportDataStub(data: LzReportData): ReportData {
  return buildLzReportDataStubInternal(data, null);
}

/** Build a ReportData stub filtered to a single challenge agent (for per-agent PDFs). */
export function buildLzReportDataStubForAgent(data: LzReportData, agentId: string): ReportData {
  return buildLzReportDataStubInternal(data, agentId);
}
