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

// Service Portfolio Assessment screen (Design 103 §3.6, #3075, #3083, #3144).
// Sprint 151 (#3164, #3165, #3166, #3169, #3211): one set of questions up front
// (intake, column map, scope), then init, research, assessment of the chosen
// apps, and the Enterprise export run without further prompts. Every stage is
// a CLI child process, so TUI and CLI share one code path; the screen follows
// the Application Assessment look: Header, ProgressBar, capped LiveOutput,
// GuidanceBox, a heartbeat while a pass runs, and Esc to cancel.

import { useState, useEffect, useRef } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Box, Text, useInput, useStdout } from 'ink';
import { load as loadYaml } from 'js-yaml';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { findWorkspace, LicenseGuard } from '@swao/core';
import { discoverServiceApps, planServiceInit, rankServiceApps, resolveServiceIntake, SERVICE_INTAKE_DIR, type IntakeSourceConflict, type OtherSourcePolicy } from '@swao/module-service-assessment';
import { GuidanceBox, LiveOutput, ProgressBar, SelectInput, TextInput } from '@swao/tui-kit';
import { Header } from '../components/Header.js';

type Phase = 'intake' | 'mapping' | 'llm' | 'checking' | 'other-source' | 'scope' | 'confirm' | 'running' | 'finished';
type Stage = 'init' | 'research' | 'assess' | 'export';
export type ServiceScope = 'top' | 'all' | 'none';

/** "Top N" for the first assessment run (#3165): several LLM calls and a few minutes per app. */
export const SERVICE_TOP_N = 20;
/** Typical minutes per service app with an LLM (UAT 2026-10-11: 3-4 min). */
const MINUTES_PER_APP: readonly [number, number] = [3, 4];
/**
 * #3518: LLM calls per app for the confirmation step. Research: the four LLM
 * topics (LlmResearchTopic in module-service-assessment research/llm-prompts.ts:37),
 * for every service app unless skipped. Assessment: at least one call each in
 * Pass 04 CTX (pass-04-ctx.ts:325), Pass 09 SYNTH (pass-09-synth.ts:489),
 * Pass 11 COMP (compliance-evaluator.ts:920, one call per 20 controls per regime)
 * and Pass 12 BLOCKS (pass-12-blocks.ts:396); conditional passes add more.
 */
export const RESEARCH_LLM_CALLS_PER_APP = 4;
export const MIN_ASSESS_LLM_CALLS_PER_APP = 4;
const OUTPUT_LINES = 6;
const OUTPUT_WIDTH = 100;
const SUMMARY_ROWS = 8;

/** Column mapping page of the user manual (#3220, #3164); English is the root locale. */
export const SERVICE_COLUMN_MAPPING_DOCS_URL = 'https://accenture.github.io/SWAO/service-assessment/column-mapping';

/** A stage the finished screen can re-run on its own, without the questions (#3220, #3165). */
export type RerunStage = 'research' | 'assess' | 'export';
export type FinishedAction = 'back' | RerunStage;

/** Which single-stage re-runs are offered after a run. */
export interface RerunAvailability {
  /** Number of apps the last run assessed (0 = scaffold and research only: no assessment re-run). */
  assessApps: number;
  /** Enterprise export allowed by the licence. */
  export: boolean;
}

/** Key handling on the finished screen (#3220): R research, A the same assessment scope, E export; Enter / Esc / Q back. */
export function finishedKeyAction(input: string, key: { escape?: boolean; return?: boolean }, avail: RerunAvailability): FinishedAction | null {
  if (key.escape || key.return || input === 'q' || input === 'Q') return 'back';
  const k = input.toLowerCase();
  if (k === 'r') return 'research';
  if (k === 'a' && avail.assessApps > 0) return 'assess';
  if (k === 'e' && avail.export) return 'export';
  return null;
}

/** Affordance lines for the finished screen, matching finishedKeyAction. */
export function rerunAffordances(avail: RerunAvailability): string[] {
  return [
    'R -- re-run research',
    ...(avail.assessApps > 0 ? [`A -- re-assess the same ${avail.assessApps} app(s)`] : []),
    ...(avail.export ? ['E -- re-run the export'] : []),
    'Enter / Esc / Q -- back',
  ];
}

/** Detail rows of the guidance panel; the Column mapping docs page comes first so a short terminal still shows it (#3220, #3164). */
export function serviceGuidanceDetails(): Array<{ label: string; value: string }> {
  return [
    { label: 'Column mapping', value: SERVICE_COLUMN_MAPPING_DOCS_URL },
    { label: 'Intake', value: `${SERVICE_INTAKE_DIR}/<workbook>.xlsx (optional column map next to it)` },
    { label: 'CLI', value: 'swao service init | swao service research | swao service rank --top 20 | swao assess --app <id> --type service' },
    { label: 'Output', value: 'apps/<id>/.swao.yml, wsp/portfolio-summary.json, apps/<id>/wsp/runs/' },
  ];
}

/** Spawns one CLI child and streams its output; injectable for tests. */
export type ServiceChildRunner = (args: string[], onText: (text: string) => void) => Promise<number>;

const STAGE_LABEL: Record<Stage, string> = {
  init: 'Scaffolding service apps from the intake',
  research: 'Researching CVE, end-of-life and advisory data',
  assess: 'Assessing service apps',
  export: 'Writing the portfolio workbook and star schema',
};

export interface ServiceInitScreenProps {
  onBack: () => void;
  /** Workspace root; defaults to the workspace containing the current directory. */
  workspacePath?: string;
  /** Test seam: replaces the CLI child process (output text in, exit code out). */
  runChild?: ServiceChildRunner;
  /** Test seam: replaces the in-process init preview (#3521). */
  previewInit?: ServiceInitPreviewer;
}

/** What `service init` would do, computed in-process before any child runs (#3521, #3518). */
export interface ServiceInitPreview {
  /** Workbook file name. */
  sourceName: string;
  /** App IDs the workbook scaffolds. */
  plannedAppIds: string[];
  /** Service apps under apps/ before the init (any source). */
  existingServiceAppIds: string[];
  /** Service apps of another intake workbook. */
  conflict: IntakeSourceConflict;
}

export type ServiceInitPreviewer = (intake: string, mapping: string, workspace: string) => Promise<ServiceInitPreview | null>;

const unquote = (v: string): string => v.trim().replace(/^"|"$/g, '');

/**
 * #3521: parse and plan the intake in-process (no writes) so the screen can
 * name a second intake workbook before scaffolding. Null when the workbook
 * cannot be read or has duplicate IDs: the CLI child then reports the error.
 */
export async function previewServiceInit(intake: string, mapping: string, workspace: string): Promise<ServiceInitPreview | null> {
  try {
    const from = unquote(intake);
    const located = from ? null : resolveServiceIntake(workspace);
    const intakePath = from ? resolve(from) : located!.intakePath;
    if (!existsSync(intakePath)) return null;
    const m = unquote(mapping);
    const mappingPath = m ? resolve(m) : located?.mappingPath ?? undefined;
    const plan = await planServiceInit({ workspacePath: workspace, intakePath, ...(mappingPath ? { mappingPath } : {}) });
    if (!plan.ok) return null;
    return {
      sourceName: plan.source.name,
      plannedAppIds: plan.plan.apps.map((a) => a.appId),
      existingServiceAppIds: plan.existingServiceAppIds,
      conflict: plan.conflict,
    };
  } catch {
    return null;
  }
}

/** #3304: `skipLlm` adds `--skip-llm` (the four LLM research topics are skipped; earlier findings are kept). */
export function buildServiceResearchArgs(workspace: string, opts: { skipLlm?: boolean } = {}): string[] {
  return ['service', 'research', '--workspace', workspace, ...(opts.skipLlm ? ['--skip-llm'] : [])];
}

/** Enterprise portfolio workbook + star schema (#3117); the CLI enforces the tier gate. */
export function buildServiceExportArgs(workspace: string): string[] {
  return ['service', 'export', '--workspace', workspace];
}

/** One service app per run: `assess --portfolio` is Enterprise-gated, this path works at every tier (#3144). */
export function buildServiceAssessArgs(workspace: string, appId: string): string[] {
  return ['assess', '--app', appId, '--type', 'service', '--workspace', workspace];
}

/** CLI arguments for the given inputs; exported for tests. An empty intake lets the CLI use wsp/inputs/service-intake/ (#3211). */
export function buildServiceInitArgs(intake: string, mapping: string, workspace: string, otherSource: OtherSourcePolicy = 'refuse'): string[] {
  const from = unquote(intake);
  const args = from ? ['service', 'init', '--from', from, '--workspace', workspace] : ['service', 'init', '--workspace', workspace];
  const m = unquote(mapping);
  if (m) args.push('--mapping', m);
  // #3521: the operator's choice for a second intake workbook (CLI parity: --replace / --keep).
  if (otherSource !== 'refuse') args.push(`--${otherSource}`);
  return args;
}

/** Intake workbook and column map found in wsp/inputs/service-intake/, for pre-filling (#3211). */
export function defaultServiceIntake(workspace: string): { intake: string; mapping: string } {
  try {
    const r = resolveServiceIntake(workspace);
    return { intake: r.intakePath, mapping: r.mappingPath ?? '' };
  } catch {
    return { intake: '', mapping: '' };
  }
}

/** The app's latest service run (`apps/<id>/wsp/latest-service.txt`, e.g. `runs/<ts>`), or null. */
export function readServiceRunPointer(workspace: string, appId: string): string | null {
  const p = join(workspace, 'apps', appId, 'wsp', 'latest-service.txt');
  try {
    const v = existsSync(p) ? readFileSync(p, 'utf-8').trim() : '';
    return v || null;
  } catch {
    return null;
  }
}

export interface ServiceAssessOutcome {
  appId: string;
  exitCode: number;
  /** Run directory relative to `apps/<id>/wsp/`; null when the assessment produced no new run. */
  run: string | null;
  /** `skipped_passes.length` from the run's scope-coverage.json; null when unreadable. */
  skipped: number | null;
}

/**
 * Read the skipped pass count of the run an assessment just wrote. A pointer
 * equal to `before` means no new run was written (SWAO can print `[error]` and
 * still exit 0), so a stale count from an earlier run is never shown.
 */
export function readServiceAssessOutcome(workspace: string, appId: string, before: string | null, exitCode: number): ServiceAssessOutcome {
  const run = readServiceRunPointer(workspace, appId);
  if (!run || run === before) return { appId, exitCode, run: null, skipped: null };
  try {
    const doc = JSON.parse(readFileSync(join(workspace, 'apps', appId, 'wsp', run, 'scope-coverage.json'), 'utf-8')) as { skipped_passes?: unknown };
    return { appId, exitCode, run, skipped: Array.isArray(doc.skipped_passes) ? doc.skipped_passes.length : null };
  } catch {
    return { appId, exitCode, run, skipped: null };
  }
}

export function lineColor(line: string): string | undefined {
  if (line.startsWith('[error]')) return 'red';
  if (line.includes('[warn]') || /could not be auto-classified/.test(line)) return 'yellow';
  if (/SCAFFOLD signals/.test(line)) return 'cyan';
  return undefined;
}

/** `[12/234] app: ...` research progress lines. */
export function parseResearchProgress(text: string): { done: number; total: number } | null {
  const all = [...text.matchAll(/^\[(\d+)\/(\d+)\]\s/gm)];
  const m = all.at(-1);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null;
}

/** Current pass name and completed pass count, parsed like the Application Assessment screen (#0379, #0403). */
export function parsePassProgress(text: string): { passName: string | null; completed: number } {
  const passMatches = [...text.matchAll(/Pass (\d+) -- (\S+)/gi)];
  const last = passMatches.at(-1);
  return {
    passName: last ? (last[2] ?? '').replace(/\.+$/, '') : null,
    completed: [...text.matchAll(/\[ok\]\s+Pass\s+(\d+)\s+--\s+(\S+)/gi)].length,
  };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Rough duration of the assessment stage for `apps` apps, for the scope question. */
export function estimateAssessment(apps: number): string {
  const [lo, hi] = MINUTES_PER_APP;
  const fmt = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${min} min`);
  return `about ${fmt(apps * lo)} to ${fmt(apps * hi)}`;
}

/** #3518: what a scope choice means in numbers, for the option labels, the confirmation and the stage line. */
export interface ScopePlan {
  scope: ServiceScope;
  /** Service apps in the workspace after the scaffold; null when the workbook could not be read in advance. */
  totalApps: number | null;
  /** Apps the assessment stage runs for; null when not known in advance. */
  assessApps: number | null;
  /** Assessment duration estimate; null when nothing is assessed or the count is unknown. */
  duration: string | null;
  /** LLM calls: research (all apps) plus the assessment minimum. */
  researchLlmCalls: number | null;
  assessLlmCallsMin: number | null;
}

export function planScope(scope: ServiceScope, totalApps: number | null, opts: { skipLlmResearch: boolean; topN?: number }): ScopePlan {
  const topN = opts.topN ?? SERVICE_TOP_N;
  const assessApps = scope === 'none' ? 0 : totalApps === null ? (scope === 'top' ? topN : null) : scope === 'top' ? Math.min(topN, totalApps) : totalApps;
  return {
    scope,
    totalApps,
    assessApps,
    duration: assessApps ? estimateAssessment(assessApps) : null,
    researchLlmCalls: opts.skipLlmResearch ? 0 : totalApps === null ? null : totalApps * RESEARCH_LLM_CALLS_PER_APP,
    assessLlmCallsMin: assessApps === null ? null : assessApps * MIN_ASSESS_LLM_CALLS_PER_APP,
  };
}

/** Scope tag for the stage line, e.g. "Top 20", "All 461", "no assessment" (#3518). */
export function scopeTag(scope: ServiceScope, assessApps: number | null): string {
  switch (scope) {
    case 'top': return `Top ${assessApps ?? SERVICE_TOP_N}`;
    case 'all': return assessApps === null ? 'All' : `All ${assessApps}`;
    case 'none': return 'no assessment';
    default: {
      const never: never = scope;
      return String(never);
    }
  }
}

/** Confirmation lines for a scope (#3518): scope, app count, duration and LLM calls. */
export function scopeConfirmationLines(plan: ScopePlan): string[] {
  const lines = [`Scope: ${plan.scope === 'none' ? 'None (scaffold and research only)' : plan.scope === 'top' ? `Top ${plan.assessApps ?? SERVICE_TOP_N} by risk` : 'All apps'}`];
  lines.push(plan.totalApps === null
    ? 'Service apps after the scaffold: not known in advance (the workbook could not be read before the scaffold)'
    : `Service apps after the scaffold: ${plan.totalApps}`);
  lines.push(`Apps to assess: ${plan.assessApps === null ? 'all scaffolded apps (count not known in advance)' : plan.assessApps}`);
  if (plan.assessApps) {
    const [lo, hi] = MINUTES_PER_APP;
    lines.push(`Estimated assessment time: ${plan.duration} (${lo} to ${hi} min per app x ${plan.assessApps} apps)`);
  } else if (plan.scope === 'all') {
    lines.push(`Estimated assessment time: ${MINUTES_PER_APP[0]} to ${MINUTES_PER_APP[1]} min per app`);
  }
  const research = plan.researchLlmCalls === null ? `${RESEARCH_LLM_CALLS_PER_APP} per app` : `${plan.researchLlmCalls}`;
  const assess = plan.assessLlmCallsMin === null ? `at least ${MIN_ASSESS_LLM_CALLS_PER_APP} per app` : `at least ${plan.assessLlmCallsMin}`;
  lines.push(`LLM calls: research ${plan.researchLlmCalls === 0 ? '0 (LLM research skipped)' : research}; assessment ${plan.assessApps === 0 ? '0' : assess}`);
  return lines;
}

/**
 * #3518: the confirmation step may be skipped for "none" and for Top N with
 * N <= 20 only when `service_portfolio.confirm_small_scope: false` is set in the
 * workspace .swao.yml; "all" is always confirmed.
 */
export function needsScopeConfirmation(scope: ServiceScope, workspace: string, topN: number = SERVICE_TOP_N): boolean {
  if (scope === 'all') return true;
  if (scope === 'top' && topN > 20) return true;
  try {
    const doc = loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) as { service_portfolio?: { confirm_small_scope?: unknown } } | null;
    return doc?.service_portfolio?.confirm_small_scope !== false;
  } catch {
    return true;
  }
}

/** Stop a child and its own children (SWAO spawns passes and tools); Windows needs taskkill by PID. */
function killChildTree(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

function exportAllowed(): boolean {
  try {
    const guard = LicenseGuard.load();
    guard.requireFeature('service-excel');
    guard.requireFeature('bi-export');
    return true;
  } catch {
    return false;
  }
}

/** Completion view of the assessment stage: failures first, capped so the frame stays inside the terminal (#3166). */
export function ServiceAssessSummary({ outcomes, total, maxRows = SUMMARY_ROWS }: { outcomes: readonly ServiceAssessOutcome[]; total: number; maxRows?: number }): JSX.Element {
  const isOk = (o: ServiceAssessOutcome) => o.run !== null && o.exitCode === 0;
  const ok = outcomes.filter(isOk).length;
  const ordered = [...outcomes.filter((o) => !isOk(o)), ...outcomes.filter(isOk)];
  const shown = ordered.slice(0, maxRows);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Service assessments: {ok}/{total} complete{outcomes.length < total ? ` (${outcomes.length} of ${total} run so far)` : ''}</Text>
      {shown.map((o) => (
        <Text key={o.appId} color={isOk(o) ? undefined : 'red'} wrap="truncate-end">
          {'  '}{o.appId}: {o.run === null
            ? `no new run (exit code ${o.exitCode})`
            : `${o.skipped === null ? 'skipped pass count unavailable' : `${o.skipped} pass(es) skipped`} (${o.run}/scope-coverage.json)${o.exitCode !== 0 ? `, exit code ${o.exitCode}` : ''}`}
        </Text>
      ))}
      {ordered.length > shown.length && <Text dimColor>{'  '}+{ordered.length - shown.length} more (swao service rank lists all apps)</Text>}
    </Box>
  );
}

export function ServiceInitScreen({ onBack, workspacePath, runChild, previewInit = previewServiceInit }: ServiceInitScreenProps): JSX.Element {
  const workspace = useRef(workspacePath ?? findWorkspace(process.cwd()) ?? process.cwd());
  const canExport = useRef<boolean | null>(null);
  const exportOk = (): boolean => (canExport.current ??= exportAllowed());
  const defaults = useRef(defaultServiceIntake(workspace.current));
  const { stdout } = useStdout();
  const [phase, setPhase] = useState<Phase>('intake');
  const [intake, setIntake] = useState(defaults.current.intake);
  const [stage, setStage] = useState<Stage | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [appCount, setAppCount] = useState<number | null>(null);
  const [research, setResearch] = useState<{ done: number; total: number } | null>(null);
  const [researchSummary, setResearchSummary] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [currentApp, setCurrentApp] = useState<string | null>(null);
  const [passName, setPassName] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ServiceAssessOutcome[]>([]);
  const [appDurations, setAppDurations] = useState<number[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [stageStart, setStageStart] = useState(Date.now());
  const [appStart, setAppStart] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const childRef = useRef<ChildProcess | null>(null);
  const cancelledRef = useRef(false);
  const pipelineStartedRef = useRef(false);
  const backRef = useRef(false);
  const guidanceOpenRef = useRef(false);
  // #3304: the LLM research choice, reused by the R re-run.
  const skipLlmRef = useRef(false);
  // #3521: in-process plan of the init and the choice for a second intake workbook.
  const [preview, setPreview] = useState<ServiceInitPreview | null>(null);
  const [otherSource, setOtherSource] = useState<OtherSourcePolicy>('refuse');
  // #3518: the chosen scope, shown in the confirmation step and the stage line.
  const [scope, setScope] = useState<ServiceScope | null>(null);

  // Heartbeat (#3169): the child is silent for minutes during LLM passes.
  useEffect(() => {
    if (phase !== 'running') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => { backRef.current = true; killChildTree(childRef.current); }, []);

  useInput((input, key) => {
    if (backRef.current || guidanceOpenRef.current) return;
    if (phase === 'running') {
      if (key.escape) { cancelledRef.current = true; killChildTree(childRef.current); }
      return;
    }
    if (phase === 'confirm') {
      // #3518: Enter starts, Esc returns to the scope question (never leaves the screen).
      if (key.escape) setPhase('scope');
      else if (key.return && scope) void runPipeline(mapping, scope);
      return;
    }
    if (phase === 'finished') {
      // #3220 (#3165): re-run one stage without repeating the questions.
      const action = finishedKeyAction(input, key, { assessApps: selected.length, export: exportOk() });
      if (action === 'back') { backRef.current = true; onBack(); }
      else if (action) void rerunStage(action);
      return;
    }
    if (key.escape) { backRef.current = true; onBack(); }
  });

  const spawnChild = (args: string[], onText: (text: string) => void): Promise<number> => runChild
    ? runChild(args, (text) => { onText(text); setLines((prev) => [...prev, ...text.split(/\r\n|\r|\n/).map((l) => l.trimEnd()).filter(Boolean)].slice(-200)); })
    : new Promise((resolve) => {
    const isPkg = Boolean((process as { pkg?: unknown }).pkg);
    const base = isPkg ? [] : [process.argv[1] ?? ''];
    const child = spawn(process.execPath, [...base, ...args], {
      env: { ...process.env, PKG_EXECPATH: '', NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-deprecation'].filter(Boolean).join(' ') },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    childRef.current = child;
    const append = (chunk: Buffer): void => {
      const text = chunk.toString();
      onText(text);
      // #3400: split on CR too, so a child's \r-updated progress line does not
      // glue to the next output (the "234o Assessment complete" artifact).
      const next = text.split(/\r\n|\r|\n/).map((l) => l.trimEnd()).filter(Boolean);
      setLines((prev) => [...prev, ...next].slice(-200));
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', () => resolve(1));
    child.on('close', (code) => { childRef.current = null; resolve(code ?? 1); });
  });

  const startStage = (s: Stage): void => { setStage(s); setStageStart(Date.now()); setLines([]); };
  const finish = (ok: boolean, text: string): void => { setResult({ ok, text }); setStage(null); setPhase('finished'); };
  const cancelled = (): boolean => cancelledRef.current || backRef.current;

  // Stages, shared by the full pipeline and the single-stage re-runs (#3220).
  const researchStage = async (ws: string): Promise<number> => {
    startStage('research');
    setResearch(null);
    const researchLines: string[] = [];
    const code = await spawnChild(buildServiceResearchArgs(ws, { skipLlm: skipLlmRef.current }), (t) => {
      const p = parseResearchProgress(t);
      if (p) setResearch(p);
      researchLines.push(...t.split('\n').filter((l) => /^Research complete|^\s+Confidence|^\s{4}\S|RESEARCH signals|Not researched/.test(l)));
    });
    setResearchSummary(researchLines.map((l) => l.trimEnd()));
    return code;
  };

  // Sequential: each assessment rebuilds wsp/portfolio-summary.json, so parallel runs would race.
  const assessStage = async (ws: string, picked: readonly string[]): Promise<void> => {
    setSelected([...picked]);
    setOutcomes([]);
    setAppDurations([]);
    startStage('assess');
    for (const appId of picked) {
      if (cancelled()) break;
      setCurrentApp(appId);
      setPassName(null);
      const t0 = Date.now();
      setAppStart(t0);
      const before = readServiceRunPointer(ws, appId);
      const code = await spawnChild(buildServiceAssessArgs(ws, appId), (t) => {
        const p = parsePassProgress(t);
        if (p.passName) setPassName(p.passName);
      });
      setAppDurations((prev) => [...prev, Date.now() - t0]);
      setOutcomes((prev) => [...prev, readServiceAssessOutcome(ws, appId, before, code)]);
    }
    setCurrentApp(null);
  };

  const exportStage = async (ws: string): Promise<void> => {
    if (exportOk()) {
      startStage('export');
      const exportCode = await spawnChild(buildServiceExportArgs(ws), () => {});
      setExportNote(exportCode === 0 ? 'Portfolio workbook and star schema written (wsp/reports/, wsp/star-schema/).' : `swao service export exited with code ${exportCode}.`);
    } else {
      setExportNote('Portfolio workbook skipped: needs an Enterprise licence (swao service export).');
    }
  };

  const runPipeline = async (mapping: string, scope: ServiceScope): Promise<void> => {
    // #3518: a fast second Enter can arrive before the phase change re-renders
    // the input handler; the ref makes the pipeline start exactly once.
    if (pipelineStartedRef.current) return;
    pipelineStartedRef.current = true;
    const ws = workspace.current;
    // #3518: the app count the operator confirmed for "all".
    const confirmedAll = scope === 'all' ? totalAppsAfterInit : null;
    setPhase('running');

    startStage('init');
    const initCode = await spawnChild(buildServiceInitArgs(intake, mapping, ws, otherSource), () => {});
    if (cancelled()) return finish(false, 'Cancelled during the scaffold.');
    if (initCode !== 0) return finish(false, `swao service init exited with code ${initCode}; see the output above.`);
    const apps = discoverServiceApps(ws).map((a) => a.appId);
    setAppCount(apps.length);

    const researchCode = await researchStage(ws);
    if (cancelled()) return finish(false, 'Cancelled during research.');

    // #3518: never assess more apps than the operator confirmed.
    if (scope === 'all' && confirmedAll !== apps.length) {
      return finish(false, `Stopped before the assessment: ${apps.length} service app(s) after the scaffold, but ${confirmedAll === null ? 'the count was not known when you confirmed' : `${confirmedAll} were confirmed`}. Nothing was assessed; start the Service Portfolio Assessment again to confirm the current count.`);
    }

    if (scope !== 'none') {
      await assessStage(ws, scope === 'top' ? rankServiceApps(ws, { top: SERVICE_TOP_N }).map((a) => a.id) : apps);
      if (cancelled()) return finish(false, 'Cancelled; the apps assessed so far are kept.');
    }

    await exportStage(ws);
    const researchNote = researchCode === 0 ? '' : ` Research exited with code ${researchCode}.`;
    finish(researchCode === 0, scope === 'none' ? `Scaffold and research complete.${researchNote}` : `Service Portfolio Assessment complete.${researchNote}`);
  };

  /** #3220 (#3165): one stage again, same workspace and scope, no questions. */
  const rerunStage = async (s: RerunStage): Promise<void> => {
    const ws = workspace.current;
    cancelledRef.current = false;
    setPhase('running');
    if (s === 'research') {
      const code = await researchStage(ws);
      if (cancelled()) return finish(false, 'Cancelled during research.');
      return finish(code === 0, code === 0 ? 'Research re-run complete.' : `Research exited with code ${code}.`);
    }
    if (s === 'assess') {
      const picked = selected;
      await assessStage(ws, picked);
      if (cancelled()) return finish(false, 'Cancelled; the apps assessed so far are kept.');
      return finish(true, `Assessment re-run complete for the same ${picked.length} app(s).`);
    }
    setExportNote(null);
    await exportStage(ws);
    finish(true, 'Export re-run complete.');
  };

  const [mapping, setMapping] = useState('');

  // #3518: service apps the workspace holds after the scaffold: existing ones
  // (minus those parked by Replace) plus the planned ones. Null when the
  // workbook could not be read in advance.
  const totalAppsAfterInit: number | null = preview
    ? new Set([
      ...preview.existingServiceAppIds.filter((id) => !(otherSource === 'replace' && preview.conflict.appIds.includes(id))),
      ...preview.plannedAppIds,
    ]).size
    : null;
  const scopePlan = (s: ServiceScope): ScopePlan => planScope(s, totalAppsAfterInit, { skipLlmResearch: skipLlmRef.current });
  const chooseScope = (s: ServiceScope): void => {
    setScope(s);
    if (needsScopeConfirmation(s, workspace.current)) setPhase('confirm');
    else void runPipeline(mapping, s);
  };

  /** #3521: plan the init before the scope question; a second intake workbook needs a choice first. */
  const checkIntake = async (): Promise<void> => {
    setPhase('checking');
    const p = await previewInit(intake, mapping, workspace.current);
    if (backRef.current) return;
    setPreview(p);
    setOtherSource('refuse');
    setPhase(p && p.conflict.appIds.length > 0 ? 'other-source' : 'scope');
  };
  const cols = stdout?.columns ?? 80;
  const width = Math.min(cols - 4, OUTPUT_WIDTH);
  const stages: Stage[] = ['init', 'research', 'assess', 'export'];
  const stageIndex = stage ? stages.indexOf(stage) : 0;
  const avg = appDurations.length > 0 ? appDurations.reduce((a, b) => a + b, 0) / appDurations.length : null;
  const remaining = selected.length - outcomes.length;
  const eta = avg !== null && remaining > 0 ? ` | ETA ${formatDuration(avg * remaining)}` : '';

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Service Portfolio Assessment" />
      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyanBright">Service Portfolio Assessment</Text>
        <Text dimColor wrap="truncate-end">Workspace: {workspace.current}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {phase === 'intake' && (
          <>
            <TextInput
              label="Enter the path to the intake Excel file (or drag and drop)"
              labelAbove
              initialValue={defaults.current.intake}
              onSubmit={(v) => { if (v.trim() || defaults.current.intake) { setIntake(v.trim() || defaults.current.intake); setPhase('mapping'); } }}
            />
            <Text dimColor wrap="truncate-end">
              {defaults.current.intake ? `Found in ${SERVICE_INTAKE_DIR}; press Enter to use it.` : `Tip: place the workbook in ${SERVICE_INTAKE_DIR} to have it picked up automatically.`}
            </Text>
          </>
        )}

        {phase === 'mapping' && (
          <>
            <TextInput
              label="Column map (optional). Press Enter to detect the columns from the headers (recommended); enter a YAML path only if your workbook uses other headers or a different layout"
              labelAbove
              initialValue={defaults.current.mapping}
              onSubmit={(v) => { setMapping(v); setPhase('llm'); }}
            />
            {defaults.current.mapping !== '' && <Text dimColor wrap="truncate-end">Column map found next to the workbook; press Enter to use it.</Text>}
            <Text dimColor wrap="truncate-end">Column mapping guide: {SERVICE_COLUMN_MAPPING_DOCS_URL}</Text>
          </>
        )}

        {phase === 'llm' && (
          <SelectInput
            label="LLM research of vendor profile, certifications, data residency and breach history? (4 LLM calls per app; needs a workspace LLM)"
            options={[
              { value: 'run', label: 'Run LLM research (recommended; findings are model-cited and unverified until reviewed)' },
              { value: 'skip', label: 'Skip LLM research for this run (earlier LLM findings are kept)' },
            ]}
            onSelect={(v) => { skipLlmRef.current = v === 'skip'; void checkIntake(); }}
          />
        )}

        {phase === 'checking' && <Text dimColor>Reading the intake workbook...</Text>}

        {phase === 'other-source' && preview && (
          <>
            <Text color="yellow" wrap="wrap">
              [warn] The workspace already holds {preview.conflict.appIds.length} service app(s) from another intake workbook ({preview.conflict.sources.join(', ')}). Scaffolding {preview.sourceName} ({preview.plannedAppIds.length} apps) next to them lists services twice when both workbooks describe the same servers.
            </Text>
            <SelectInput
              label={`How should SWAO treat the ${preview.conflict.appIds.length} existing app(s)?`}
              // The non-destructive choice comes first, so a stray Enter changes nothing.
              options={[
                { value: 'back', label: 'Back: choose another intake workbook (or use a new workspace)' },
                { value: 'replace', label: `Replace: move them to parked-apps/ and scaffold ${preview.sourceName}` },
                { value: 'keep', label: `Keep both: add ${preview.plannedAppIds.length} app(s) next to the ${preview.conflict.appIds.length} existing ones` },
              ]}
              onSelect={(v) => {
                if (v === 'back') { setPreview(null); setPhase('intake'); return; }
                setOtherSource(v as OtherSourcePolicy);
                setPhase('scope');
              }}
            />
          </>
        )}

        {phase === 'scope' && (
          <SelectInput
            label="What should SWAO run? (no further questions after this)"
            options={[
              { value: 'top', label: `Scaffold, research all apps, assess the top ${scopePlan('top').assessApps ?? SERVICE_TOP_N} by risk (recommended; ${estimateAssessment(scopePlan('top').assessApps || SERVICE_TOP_N)})` },
              // #3518: the "all" label names the app count and the total time.
              { value: 'all', label: totalAppsAfterInit === null
                ? 'Scaffold, research and assess every app (app count not known in advance; 3 to 4 min and several LLM calls per app)'
                : `Scaffold, research and assess every app (${totalAppsAfterInit} apps, ${estimateAssessment(totalAppsAfterInit)})` },
              { value: 'none', label: 'Scaffold and research only (no LLM assessment)' },
            ]}
            onSelect={(v) => chooseScope(v as ServiceScope)}
          />
        )}

        {phase === 'confirm' && scope && (
          <Box flexDirection="column">
            <Text bold color={scope === 'all' ? 'yellow' : undefined}>Confirm what SWAO will run:</Text>
            {scopeConfirmationLines(scopePlan(scope)).map((l) => <Text key={l} wrap="truncate-end">  {l}</Text>)}
            <Box marginTop={1}><Text color="cyan">Enter -- start   Esc -- back to the scope question</Text></Box>
          </Box>
        )}

        {phase === 'running' && stage && (
          <>
            <ProgressBar value={stageIndex} total={stages.length} label={`Stage ${stageIndex + 1}/${stages.length}: ${STAGE_LABEL[stage]}${scope ? ` (${scopeTag(scope, stage === 'assess' ? selected.length : scopePlan(scope).assessApps)})` : ''} | ${formatDuration(now - stageStart)}`} color="cyan" />
            {stage === 'research' && research && (
              <ProgressBar value={research.done} total={research.total} label={`Research ${research.done}/${research.total} apps`} color="cyan" />
            )}
            {stage === 'assess' && (
              <ProgressBar
                value={outcomes.length}
                total={Math.max(1, selected.length)}
                label={`App ${Math.min(outcomes.length + 1, selected.length)}/${selected.length}: ${currentApp ?? ''} | ${passName ? `Pass ${passName.replace(/_/g, ' ')}` : 'starting'} | ${formatDuration(now - appStart)}${eta}`}
                color="cyan"
              />
            )}
            {appCount !== null && stage !== 'init' && <Text dimColor>{appCount} service app(s) scaffolded</Text>}
            <LiveOutput lines={lines} maxLines={OUTPUT_LINES} maxWidth={width} label="Output" />
          </>
        )}

        {phase === 'finished' && result && (
          <>
            <Text bold color={result.ok ? 'green' : 'yellow'} wrap="truncate-end">{result.ok ? '[ok]' : '[warn]'}  {result.text}</Text>
            {appCount !== null && <Text wrap="truncate-end">  Apps scaffolded: {appCount}</Text>}
            {researchSummary.slice(0, 6).map((l, i) => <Text key={i} wrap="truncate-end">  {l.trim()}</Text>)}
            {selected.length > 0 && <ServiceAssessSummary outcomes={outcomes} total={selected.length} />}
            {exportNote && <Text wrap="truncate-end">  {exportNote}</Text>}
            {!result.ok && <LiveOutput lines={lines} maxLines={OUTPUT_LINES} maxWidth={width} label="Last output" />}
            <Box marginTop={1} flexDirection="column">
              {/* #3220: the re-run keys stay visible with the guidance panel collapsed. */}
              <Text color="cyan" wrap="truncate-end">Keys: {rerunAffordances({ assessApps: selected.length, export: exportOk() }).join(' | ')}</Text>
              <Text dimColor wrap="truncate-end">Next: swao publish --app &lt;id&gt; (HTML), swao service rank (priority list), swao service export (Enterprise workbook)</Text>
            </Box>
          </>
        )}
      </Box>

      <Box marginTop={1}>
        <GuidanceBox
          // #3220 (#3166): remount once the intake question is answered so the
          // panel collapses for the run and the frame stays inside the terminal.
          key={phase === 'intake' ? 'guidance-intake' : 'guidance-run'}
          initiallyCollapsed={phase !== 'intake'}
          title="Service Portfolio Assessment"
          what="Assesses third-party, SaaS, and COTS applications from an Excel inventory, with no source code required. Each row becomes one app folder; phone, e-mail, and contact columns are stored as yes/no flags only. Drop more documents into apps/<id>/ingestion/ and re-run to improve the evidence."
          details={serviceGuidanceDetails()}
          affordances={[
            ...(phase === 'running' ? ['Esc -- cancel (finished apps are kept)'] : phase === 'finished' ? rerunAffordances({ assessApps: selected.length, export: exportOk() }) : phase === 'confirm' ? ['Enter -- start', 'Esc -- back to the scope question'] : ['Esc -- back']),
            'Ctrl+G -- toggle this panel',
          ]}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    </Box>
  );
}
