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

// Leg orchestrator (#1421, Design 092 s3.1/s7).
//
// One LLM Assessment run = 2..5 legs; each leg is a COMPLETE App
// Assessment executed as a CHILD process (063 s17.4) inside a TEMP clone
// of the workspace, with the leg-recorder env streaming CallRecords to
// this run's calls/ sink. Leg WSP trees are working data: after metric
// extraction the temp workspace is deleted (092 s7.2; keep_leg_wsp for
// debugging only). The host injects spawnLeg (binary self-spawn) and the
// tier/precondition gates have already passed (llm-type.ts).
//
// v1 extraction scope: performance / cost / reliability / structural
// quality groups from call records + the leg's run manifest; the
// content-quality extractor (verdict + signal agreement) is the follow-on
// slice of #1421 noted in the sprint brief.

import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallRecordSchema, analysisMode, type CallRecord } from './call-record.js';
import { buildPassGroups, buildBucketView, buildChallengePassGroups, buildLzChallengePassGroups } from './pass-groups.js';
import { normaliseProperty, groupSubResult, finalResult, type GroupSubResult, type PropertyScore } from './comparison-engine.js';
import { metricById } from './metric-catalogue.js';
import { buildManifest, hashDirectory, type LlmLegManifest } from './llm-run-manifest.js';
import { FindingsStore, RunLog } from './run-store.js';
import { LEG_ENV } from './leg-recorder.js';
import { logApp } from '@swao/core';

export interface ResolvedLeg {
  id: string;
  connector: string;
  model: string;
  primary: boolean;
  connectorSha256?: string;
  costSource: 'billed' | 'configured' | 'local';
}

export interface LegSpawnResult {
  exitCode: number | null;
  durationMs: number;
}

/** Challenge pass result written to calls/<leg>/challenge-results.json (#1708). */
export interface ChallengePassResult {
  /** ISO-8601 timestamp when the challenge finished. */
  completed_at: string;
  /** Per-agent call statistics (one entry per workspace-configured agent). */
  agents: Array<{
    agent_id: string;
    calls: number;
    dnf: boolean;
    duration_ms: number;
    error?: string;
  }>;
  /** Exit code from the challenge spawn; 0 = clean run. */
  exit_code: number | null;
}

export interface OrchestratorDeps {
  workspaceRoot: string;
  appId: string;
  legs: ResolvedLeg[];
  execution: 'serial' | 'parallel';
  repeat: number;
  weights: Record<string, number>;
  keepLegWsp: boolean;
  passSuiteVersion: string;
  /** Host-injected: spawn `swao assess --app <id> --llm <connector:model>
   *  --no-cache` as a child in legWorkspaceRoot with the given extra env. */
  spawnLeg: (leg: ResolvedLeg, legWorkspaceRoot: string, env: Record<string, string>) => Promise<LegSpawnResult>;
  /**
   * Optional (#1708 / OQ-92-19 Q1): spawn the stakeholder challenge for a
   * completed leg workspace. Called after the leg's App Assessment finishes
   * and before the temp WSP is discarded (§7.2). When omitted the challenge
   * phase is skipped silently. The host injects `swao challenge --all-agents
   * --report` against the leg workspace; returns call counts per agent.
   * legEnv carries SWAO_LLM_ASSESSMENT_* variables so the challenge subprocess
   * can stream CallRecords to the same sink as the leg (#1819).
   */
  spawnChallenge?: (leg: ResolvedLeg, legWorkspaceRoot: string, legEnv: Record<string, string>) => Promise<ChallengePassResult>;
  /**
   * Optional (#1820): spawn the LZ sovereignty challenge for each leg.
   * Mirrors spawnChallenge but runs `swao challenge --lz --all-agents`.
   * C2-namespace PassGroup entries are produced from the results (#1820).
   */
  spawnLzChallenge?: (leg: ResolvedLeg, legWorkspaceRoot: string, legEnv: Record<string, string>) => Promise<ChallengePassResult>;
  timestamp?: () => string;
  onProgress?: (message: string) => void;
  /** When true, call interpretationConnector after scoring to add an
   *  AI-generated narrative to publication-model.json (#1431). */
  interpretation?: boolean;
  /** Connector used for the narrative; must implement generate(prompt). */
  interpretationConnector?: { generate(prompt: string): Promise<string> };
}

export interface OrchestrationResult {
  runDir: string;
  manifestPath: string;
  records: CallRecord[];
  groups: GroupSubResult[];
  final: ReturnType<typeof finalResult>;
  findingsCount: number;
}

/** Clone the minimal workspace a leg needs: portfolio .swao.yml + the app
 *  dir without generated artefacts. */
export function cloneLegWorkspace(workspaceRoot: string, appId: string, legId: string): string {
  const tmp = mkdtempSync(join(tmpdir(), `swao-leg-${legId.replace(/[^a-z0-9-]/gi, '_')}-`));
  const rootYml = join(workspaceRoot, '.swao.yml');
  if (existsSync(rootYml)) cpSync(rootYml, join(tmp, '.swao.yml'));
  // Workspace-level inputs (connectors, catalogs) -- read-only context.
  const wspInputs = join(workspaceRoot, 'wsp', 'inputs');
  if (existsSync(wspInputs)) cpSync(wspInputs, join(tmp, 'wsp', 'inputs'), { recursive: true });
  const appSrc = join(workspaceRoot, 'apps', appId);
  const appDst = join(tmp, 'apps', appId);
  cpSync(appSrc, appDst, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(appSrc.length).replace(/\\/g, '/');
      // Exclude generated artefacts; keep sources + wsp/inputs.
      return !/^\/wsp\/(runs|reports|exports|cache|logs)(\/|$)/.test(rel);
    },
  });
  // Belt-and-suspenders: cpSync filter is not guaranteed to exclude directories
  // before recursing into them on all Node.js/OS combinations (#2004). Explicitly
  // remove any generated artefact dirs that should have been excluded so the leg
  // workspace always starts clean (no prior run data, no historical event logs).
  for (const dir of ['runs', 'reports', 'exports', 'cache', 'logs']) {
    const excluded = join(appDst, 'wsp', dir);
    if (existsSync(excluded)) rmSync(excluded, { recursive: true, force: true });
  }
  return tmp;
}

/** Extract the 7R migration verdict from a completed leg workspace's wsp.yaml.
 *  Returns null when the run dir, wsp.yaml, or seven_r_label field is absent. */
export function extractLegVerdict(legWorkspace: string, appId: string): string | null {
  try {
    const runsDir = join(legWorkspace, 'apps', appId, 'wsp', 'runs');
    if (!existsSync(runsDir)) return null;
    const runDirs = readdirSync(runsDir).filter((d) => /^\d{4}-/.test(d)).sort();
    const latestRun = runDirs[runDirs.length - 1];
    if (!latestRun) return null;
    const wspYamlPath = join(runsDir, latestRun, 'wsp.yaml');
    if (!existsSync(wspYamlPath)) return null;
    const content = readFileSync(wspYamlPath, 'utf-8');
    const match = content.match(/^\s*seven_r_label:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function readLegRecords(sinkPath: string): CallRecord[] {
  if (!existsSync(sinkPath)) return [];
  const out: CallRecord[] = [];
  for (const line of readFileSync(sinkPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    const parsed = CallRecordSchema.safeParse(JSON.parse(line));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

interface LegRunStats {
  wallClockMs: number;
  exitCode: number | null;
}

/** Assemble the property dimension groups from call records (v1 scope). */
export function assembleGroups(records: CallRecord[], legStats: Record<string, LegRunStats>, legIds: string[]): GroupSubResult[] {
  const byLeg = (id: string) => records.filter((r) => r.leg.id === id);
  const scored = (metricId: string, pick: (legRecords: CallRecord[]) => number | null): PropertyScore | null => {
    const metric = metricById(metricId);
    if (!metric) return null;
    const raw: Record<string, number | null> = {};
    for (const id of legIds) raw[id] = pick(byLeg(id));
    return normaliseProperty(metric, raw);
  };

  const done = (rs: CallRecord[]) => rs.filter((r) => !r.reliability.dnf);
  const median = (vals: number[]): number | null => {
    if (vals.length === 0) return null;
    const s = [...vals].sort((a, b) => a - b);
    return s.length % 2 ? s[Math.floor(s.length / 2)]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  const p95 = (vals: number[]): number | null => {
    if (vals.length === 0) return null;
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
  };
  const rate = (hit: number, total: number): number | null => (total === 0 ? null : (hit / total) * 100);

  const perf = [
    scored('perf.latency_p50_ms', (rs) => median(done(rs).map((r) => r.timing.total_ms))),
    scored('perf.latency_p95_ms', (rs) => p95(done(rs).map((r) => r.timing.total_ms))),
    scored('perf.throughput_tok_s', (rs) => {
      const d = done(rs).filter((r) => r.timing.total_ms > 0);
      if (d.length === 0) return null;
      return d.reduce((a, r) => a + r.tokens.completion / (r.timing.total_ms / 1000), 0) / d.length;
    }),
    scored('perf.wallclock_total_ms', (rs) => {
      const id = rs[0]?.leg.id;
      return id && legStats[id] ? legStats[id].wallClockMs : null;
    }),
  ].filter((p): p is PropertyScore => p !== null);

  const cost = [
    scored('cost.total_usd', (rs) => {
      const priced = done(rs).filter((r) => r.cost_usd.computed !== null);
      if (priced.length === 0) return null;
      return priced.reduce((a, r) => a + (r.cost_usd.computed as number), 0);
    }),
  ].filter((p): p is PropertyScore => p !== null);

  const reliability = [
    scored('rel.dnf_count', (rs) => (rs.length === 0 ? null : rs.filter((r) => r.reliability.dnf).length)),
    scored('rel.retry_count', (rs) => (rs.length === 0 ? null : rs.reduce((a, r) => a + r.reliability.retries, 0))),
    scored('rel.truncated_count', (rs) => (rs.length === 0 ? null : rs.filter((r) => r.quality.truncated).length)),
  ].filter((p): p is PropertyScore => p !== null);

  const structural = [
    scored('qs.parse_valid_rate', (rs) => rate(done(rs).filter((r) => r.quality.parse_valid).length, done(rs).length)),
    scored('qs.schema_conform_rate', (rs) => rate(done(rs).filter((r) => r.quality.schema_conform).length, done(rs).length)),
  ].filter((p): p is PropertyScore => p !== null);

  const security = [
    scored('sec.refusal_count', (rs) => (rs.length === 0 ? null : rs.filter((r) => r.quality.refusal_detected).length)),
    scored('sec.redaction_marker_altered', (rs) => (rs.length === 0 ? null : rs.filter((r) => r.security.redaction_marker_altered).length)),
    scored('sec.foreign_path_count', (rs) => (rs.length === 0 ? null : rs.reduce((a, r) => a + r.security.foreign_path_count, 0))),
    scored('sec.pii_reproduction_count', (rs) => (rs.length === 0 ? null : rs.filter((r) => r.security.pii_reproduction_detected).length)),
    scored('sec.prompt_injection_count', (rs) => (rs.length === 0 ? null : rs.filter((r) => r.security.prompt_injection_detected).length)),
  ].filter((p): p is PropertyScore => p !== null);

  return [
    groupSubResult('performance', perf),
    groupSubResult('cost', cost),
    groupSubResult('reliability', reliability),
    groupSubResult('quality-structural', structural),
    groupSubResult('security', security),
  ];
}

// #1795: copy call-N.json artefacts from a leg's WSP run directory to the
// main run directory before the temp leg workspace is deleted. Preserves the
// full prompt/response audit trail for every LLM-backed assessment pass.
function copyLegCallArtefacts(
  legWorkspace: string,
  appId: string,
  legId: string,
  mainRunDir: string,
): void {
  const legWspDir = join(legWorkspace, 'apps', appId, 'wsp');
  const latestFile = join(legWspDir, 'latest.txt');
  if (!existsSync(latestFile)) return;
  let runRef: string;
  try { runRef = readFileSync(latestFile, 'utf-8').trim(); } catch { return; }
  const passesDir = join(legWspDir, runRef, 'passes');
  if (!existsSync(passesDir)) return;
  const legSlug = legId.replace(/[^a-z0-9-]/gi, '_');
  const destDir = join(mainRunDir, 'calls', legSlug, 'passes');
  try {
    mkdirSync(destDir, { recursive: true });
    for (const name of readdirSync(passesDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        writeFileSync(join(destDir, name), readFileSync(join(passesDir, name)));
      } catch { /* skip unreadable file -- non-fatal */ }
    }
  } catch { /* non-fatal */ }
}

// #1797: relay provider.llm.* events from a leg's app event log to the main
// workspace app event log so remote support can trace per-leg LLM calls without
// keeping the temp leg workspace alive.
// #2004: runStartedAt filter -- only relay events timestamped at or after the
// run start, so that any pre-existing log content copied into the leg workspace
// (cpSync filter bypass on some Node.js/OS combinations) is not re-appended.
function relayLegProviderEvents(
  legWorkspace: string,
  mainWorkspaceRoot: string,
  appId: string,
  legId: string,
  runStartedAt: Date,
): void {
  const now = new Date();
  const monthSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const legLogPath = join(legWorkspace, 'apps', appId, 'wsp', 'logs', `app-events-${monthSlug}.ndjson`);
  if (!existsSync(legLogPath)) return;
  let raw: string;
  try { raw = readFileSync(legLogPath, 'utf-8'); } catch { return; }
  const mainLogDir = join(mainWorkspaceRoot, 'apps', appId, 'wsp', 'logs');
  const mainLogPath = join(mainLogDir, `app-events-${monthSlug}.ndjson`);
  const runStartIso = runStartedAt.toISOString();
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as { ts?: string; code?: string; context?: Record<string, unknown> };
      // Only relay events that occurred during this run (skip historical log content).
      if (typeof entry.ts === 'string' && entry.ts < runStartIso) continue;
      // Relay provider.llm.* events (LLM call telemetry) and dynamic.vision.* events
      // (#1997: vision pass events previously dropped by the too-narrow filter).
      if (typeof entry.code === 'string' && (/^provider\.llm\./.test(entry.code) || /^dynamic\.vision\./.test(entry.code))) {
        const relayed = { ...entry, context: { ...(entry.context ?? {}), leg_id: legId } };
        lines.push(JSON.stringify(relayed));
      }
    } catch { /* skip malformed */ }
  }
  if (lines.length === 0) return;
  try {
    mkdirSync(mainLogDir, { recursive: true });
    appendFileSync(mainLogPath, lines.join('\n') + '\n', 'utf-8');
  } catch { /* non-fatal: log relay is best-effort */ }
}

export async function orchestrateLegs(deps: OrchestratorDeps): Promise<OrchestrationResult> {
  const ts = (deps.timestamp ?? (() => new Date().toISOString()))();
  const runTs = ts.slice(0, 19).replace(/[:.]/g, '-');
  const runDir = join(deps.workspaceRoot, 'llm-assessments', 'swao', runTs);
  mkdirSync(join(runDir, 'calls'), { recursive: true });
  mkdirSync(join(runDir, 'comparison'), { recursive: true });

  const log = new RunLog(join(runDir, 'log.ndjson'));
  const findings = new FindingsStore(log);
  const progress = deps.onProgress ?? (() => undefined);

  const appDir = join(deps.workspaceRoot, 'apps', deps.appId);
  const sourceHash = hashDirectory(appDir, (rel) => rel.startsWith('wsp/'));
  const inputsHash = hashDirectory(join(appDir, 'wsp', 'inputs'));
  log.write('info', 'run.start', `LLM Assessment starting: ${deps.legs.length} legs, ${deps.execution}`, {
    app: deps.appId, source_hash: sourceHash, inputs_hash: inputsHash,
  });

  const legIds = deps.legs.map((l) => l.id);
  const allRecords: CallRecord[] = [];
  const legStats: Record<string, LegRunStats> = {};
  const legVerdicts: Record<string, string | null> = {};
  const challengeResults = new Map<string, { agents: Array<{ agent_id: string; calls: number; dnf: boolean; duration_ms: number }> }>();
  const lzChallengeResults = new Map<string, { agents: Array<{ agent_id: string; calls: number; dnf: boolean; duration_ms: number }> }>();
  // #1819: per-leg challenge call records for real cost/latency/parse metrics in publications.
  const challengeCallRecords = new Map<string, CallRecord[]>();
  const lzChallengeCallRecords = new Map<string, CallRecord[]>();

  const runOneLeg = async (leg: ResolvedLeg): Promise<void> => {
    progress(`leg ${leg.id}: starting (${leg.connector} / ${leg.model})`);
    log.write('info', 'leg.start', `leg ${leg.id} starting`, { leg_id: leg.id, connector: leg.connector, model: leg.model });
    // #2001: mirror leg.start to app-events so the UAT monitor sees each leg begin.
    logApp(deps.appId, 'info', 'leg.start', `leg ${leg.id} starting`, { context: { leg_id: leg.id, connector: leg.connector, model: leg.model } });
    const sink = join(runDir, 'calls', `${leg.id.replace(/[^a-z0-9-]/gi, '_')}.ndjson`);
    // #2014: declare before the try so the finally block can always clearInterval
    // and rmSync even when cloneLegWorkspace throws. setInterval starts first inside
    // the try so the heartbeat covers the synchronous workspace copy.
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let legWorkspace = '';
    try {
      // #1965: emit a heartbeat every 30 s so the log file never goes silent for
      // >2 min while a leg is in progress (H-1 black-spot detection threshold).
      // #2001: also write to app-events so the UAT monitor and any app-events
      // consumer sees activity while the leg subprocess is running.
      heartbeatTimer = setInterval(() => {
        log.write('info', 'leg.heartbeat', `leg ${leg.id} in progress`, { leg_id: leg.id });
        logApp(deps.appId, 'info', 'leg.heartbeat', `leg ${leg.id} in progress`, { context: { leg_id: leg.id } });
      }, 30_000);
      legWorkspace = cloneLegWorkspace(deps.workspaceRoot, deps.appId, leg.id);
      const env: Record<string, string> = {
        [LEG_ENV.RECORD]: sink,
        [LEG_ENV.LEG_ID]: leg.id,
        [LEG_ENV.CONNECTOR]: leg.connector,
        [LEG_ENV.MODEL]: leg.model,
        [LEG_ENV.COST_SOURCE]: leg.costSource,
        ...(leg.connectorSha256 ? { [LEG_ENV.CONNECTOR_SHA256]: leg.connectorSha256 } : {}),
      };
      // #2008: stall watchdog -- resolves with a synthetic failure result rather
      // than rejecting so that the per-leg findings/manifest writes below still run.
      const LEG_STALL_TIMEOUT_MS = parseInt(process.env['SWAO_LEG_STALL_TIMEOUT_MS'] ?? String(30 * 60 * 1000), 10);
      let stallTimerId: ReturnType<typeof setTimeout> | undefined;
      const stallPromise = new Promise<LegSpawnResult>((resolve) => {
        stallTimerId = setTimeout(() => {
          log.write('warn', 'leg.stall', `leg ${leg.id} stall watchdog fired after ${Math.round(LEG_STALL_TIMEOUT_MS / 60_000)} min`, { leg_id: leg.id, timeout_ms: LEG_STALL_TIMEOUT_MS });
          logApp(deps.appId, 'warn', 'leg.stall', `leg ${leg.id} stall watchdog fired`, { context: { leg_id: leg.id, timeout_ms: LEG_STALL_TIMEOUT_MS } });
          resolve({ durationMs: LEG_STALL_TIMEOUT_MS, exitCode: 1 });
        }, LEG_STALL_TIMEOUT_MS);
      });
      const result = await Promise.race([deps.spawnLeg(leg, legWorkspace, env), stallPromise]);
      if (stallTimerId !== undefined) clearTimeout(stallTimerId);
      legStats[leg.id] = { wallClockMs: result.durationMs, exitCode: result.exitCode };
      if (result.exitCode !== 0) {
        findings.add({
          severity: 'error', leg: leg.id, type: 'leg-failed',
          message: `leg ${leg.id} exited ${result.exitCode ?? 'null'}; its metrics cover only completed calls`,
        });
      }
      const legRecords = readLegRecords(sink);
      allRecords.push(...legRecords);
      if (legRecords.length === 0) {
        findings.add({
          severity: 'error', leg: leg.id, type: 'no-calls-recorded',
          message: `leg ${leg.id} recorded no LLM calls -- check connector configuration and the workload-shape guard`,
        });
      }
      for (const r of legRecords) {
        if (r.reliability.dnf) {
          findings.add({
            severity: 'warn', leg: leg.id, pass_id: r.pass_id, call_ref: `${r.pass_id}#${r.call_index}`,
            type: r.reliability.rate_limited ? 'rate-limit' : 'timeout',
            message: `leg ${leg.id}, pass ${r.pass_id}: ${r.reliability.error ?? 'no usable response'}`,
            metric_impact: 'rel.dnf_count',
          });
        }
        if (r.cost_usd.computed === null && r.cost_usd.source !== 'local') {
          findings.add({
            severity: 'warn', leg: leg.id, pass_id: r.pass_id, type: 'cost-unavailable',
            message: `leg ${leg.id}: no price available for a billed call`, metric_impact: 'cost.total_usd',
          });
        }
      }
      log.write('info', 'leg.complete', `leg ${leg.id} complete`, {
        leg_id: leg.id, exit: result.exitCode, calls: legRecords.length, wall_clock_ms: result.durationMs,
      });
      progress(`leg ${leg.id}: complete (${legRecords.length} calls)`);
      legVerdicts[leg.id] = extractLegVerdict(legWorkspace, deps.appId);

      // #1797: relay per-leg provider.llm.* events to main workspace log before
      // the temp leg workspace is deleted (see finally block below).
      relayLegProviderEvents(legWorkspace, deps.workspaceRoot, deps.appId, leg.id, new Date(ts));
      // #1795: copy call-N.json artefacts from leg WSP run to main run dir.
      copyLegCallArtefacts(legWorkspace, deps.appId, leg.id, runDir);

      // #1708 (OQ-92-19 Q1): stakeholder challenge phase -- runs after App
      // Assessment, before §7.2 discard. Skipped when not configured.
      if (deps.spawnChallenge) {
        progress(`leg ${leg.id}: running stakeholder challenge...`);
        log.write('info', 'leg.challenge.start', `leg ${leg.id} challenge starting`, { leg_id: leg.id });
        try {
          const challengeResult = await deps.spawnChallenge(leg, legWorkspace, env);
          const challengePath = join(runDir, 'calls', `${leg.id.replace(/[^a-z0-9-]/gi, '_')}`, 'challenge-results.json');
          mkdirSync(join(runDir, 'calls', `${leg.id.replace(/[^a-z0-9-]/gi, '_')}`), { recursive: true });
          writeFileSync(challengePath, JSON.stringify(challengeResult, null, 2), 'utf-8');
          challengeResults.set(leg.id, challengeResult);
          log.write('info', 'leg.challenge.complete', `leg ${leg.id} challenge complete`, {
            agents: challengeResult.agents.length,
            exit_code: challengeResult.exit_code,
          });
          progress(`leg ${leg.id}: challenge complete (${challengeResult.agents.length} agents)`);
        } catch (challengeErr) {
          log.write('warn', 'leg.challenge.error', `leg ${leg.id} challenge failed: ${(challengeErr as Error).message}`, {});
          progress(`leg ${leg.id}: challenge failed -- continuing without challenge data`);
        }
      }
      // #1820: LZ sovereignty challenge phase -- mirrors spawnChallenge but
      // targets LZ agents. C2-namespace PassGroups produced from results.
      if (deps.spawnLzChallenge) {
        progress(`leg ${leg.id}: running LZ sovereignty challenge...`);
        log.write('info', 'leg.challenge-lz.start', `leg ${leg.id} LZ challenge starting`, { leg_id: leg.id });
        try {
          const lzChallengeResult = await deps.spawnLzChallenge(leg, legWorkspace, env);
          const lzChallengePath = join(runDir, 'calls', `${leg.id.replace(/[^a-z0-9-]/gi, '_')}`, 'lz-challenge-results.json');
          mkdirSync(join(runDir, 'calls', `${leg.id.replace(/[^a-z0-9-]/gi, '_')}`), { recursive: true });
          writeFileSync(lzChallengePath, JSON.stringify(lzChallengeResult, null, 2), 'utf-8');
          lzChallengeResults.set(leg.id, lzChallengeResult);
          log.write('info', 'leg.challenge-lz.complete', `leg ${leg.id} LZ challenge complete`, {
            agents: lzChallengeResult.agents.length,
            exit_code: lzChallengeResult.exit_code,
          });
          progress(`leg ${leg.id}: LZ challenge complete (${lzChallengeResult.agents.length} agents)`);
        } catch (lzChallengeErr) {
          log.write('warn', 'leg.challenge-lz.error', `leg ${leg.id} LZ challenge failed: ${(lzChallengeErr as Error).message}`, {});
          progress(`leg ${leg.id}: LZ challenge failed -- continuing without LZ challenge data`);
        }
      }
      // #1819: re-read the leg sink after challenge phases; the challenge subprocess
      // appends its per-call records (pass_id = 'challenge-*') to the same NDJSON
      // so real cost / latency / parse_valid metrics appear in the C1/C2 pass-groups.
      if (deps.spawnChallenge || deps.spawnLzChallenge) {
        const allLegRecords = readLegRecords(sink);
        const newRecords = allLegRecords.slice(legRecords.length);
        challengeCallRecords.set(leg.id,
          newRecords.filter((r) => r.pass_id.startsWith('challenge-') && !r.pass_id.startsWith('challenge-lz-')),
        );
        lzChallengeCallRecords.set(leg.id,
          newRecords.filter((r) => r.pass_id.startsWith('challenge-lz-')),
        );
      }
    } finally {
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      if (legWorkspace) {
        if (deps.keepLegWsp) {
          log.write('info', 'leg.workspace-kept', `leg ${leg.id} workspace kept for debugging`, { path: legWorkspace });
        } else {
          rmSync(legWorkspace, { recursive: true, force: true });
        }
      }
    }
  };

  if (deps.execution === 'parallel') {
    await Promise.all(deps.legs.map((leg) => runOneLeg(leg)));
  } else {
    for (const leg of deps.legs) await runOneLeg(leg);
  }

  // Comparison (v1 groups) + persistence.
  const groups = assembleGroups(allRecords, legStats, legIds);
  const final = finalResult(groups, deps.weights);
  const passGroups = buildPassGroups(allRecords, legIds);
  const challengePassGroups = buildChallengePassGroups(challengeResults, legIds, challengeCallRecords);
  const lzChallengePassGroups = buildLzChallengePassGroups(lzChallengeResults, legIds, lzChallengeCallRecords);
  const bucketViews = ['latency_p50_ms', 'parse_valid_rate', 'truncation_count'].map((p) =>
    buildBucketView(allRecords, legIds, p as 'latency_p50_ms'),
  );

  const manifestLegs: LlmLegManifest[] = deps.legs.map((l) => ({
    id: l.id, connector: l.connector, model: l.model, primary: l.primary,
    ...(l.connectorSha256 ? { connector_sha256: l.connectorSha256 } : {}),
  }));
  const manifest = buildManifest({
    kind: 'swao', appId: deps.appId, created: ts,
    execution: deps.execution, repeat: deps.repeat,
    analysisMode: analysisMode(deps.legs.length),
    legs: manifestLegs, sourceHash, inputsHash,
    passSuiteVersion: deps.passSuiteVersion, weights: deps.weights,
    inputsChanged: false,
  });
  const manifestPath = join(runDir, 'manifest.yaml');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  writeFileSync(join(runDir, 'comparison', 'comparison.json'), JSON.stringify({ groups, final, passGroups, challengePassGroups, lzChallengePassGroups, bucketViews }, null, 2), 'utf-8');

  // Build publication model object before writing; the interpretation connector
  // may add a narrative field (#1431). Hoist so the final JSON is written once.
  const pubModel: Record<string, unknown> = {
    schema_version: '1.0', kind: 'swao', app_id: deps.appId, created: ts,
    analysis_mode: manifest.analysis_mode, legs: manifestLegs, weights: final.weights,
    final, groups, passGroups, challengePassGroups, lzChallengePassGroups, bucketViews, findings: findings.all(),
    verdicts: legVerdicts,
  };

  if (deps.interpretation && deps.interpretationConnector) {
    try {
      const legCount = deps.legs.length;
      const topEntry = Object.entries(
        (final as { rank: Record<string, number | null> }).rank,
      ).filter((e): e is [string, number] => e[1] !== null)
        .sort((a, b) => a[1] - b[1])[0];
      const topLeg = topEntry?.[0] ?? 'unknown';
      const prompt = [
        `You are a cloud-architecture assessment tool. Summarise the following LLM Assessment for application '${deps.appId}'.`,
        `${legCount} LLM legs were compared. Top-ranked leg: '${topLeg}'.`,
        `Final scores: ${JSON.stringify((final as { score: Record<string, unknown> }).score)}.`,
        `Provide a 2-3 sentence executive summary noting the winner and key differentiators.`,
        `Be factual and concise. Do not use markdown.`,
      ].join(' ');
      const narrative = await deps.interpretationConnector.generate(prompt);
      pubModel['narrative'] = typeof narrative === 'string' ? narrative.slice(0, 2000) : narrative;
    } catch (err) {
      log.write('warn', 'interpretation.error', `Narrative generation failed: ${(err as Error).message}`);
    }
  }

  writeFileSync(join(runDir, 'comparison', 'publication-model.json'), JSON.stringify(pubModel, null, 2), 'utf-8');
  findings.writeYaml(runDir);
  // Latest pointer inside the kind dir (092 s7: never wsp/latest.txt).
  writeFileSync(join(deps.workspaceRoot, 'llm-assessments', 'swao', 'latest.txt'), runTs + '\n', 'utf-8');
  log.write('info', 'run.complete', `LLM Assessment complete: ${allRecords.length} calls across ${deps.legs.length} legs`, {
    run_dir: runDir, findings: findings.all().length,
  });

  return { runDir, manifestPath, records: allRecords, groups, final, findingsCount: findings.all().length };
}

/** Discover legs still present in a run dir (used by tests + doctor). */
export function listRunDirs(workspaceRoot: string): string[] {
  const dir = join(workspaceRoot, 'llm-assessments', 'swao');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => /^\d{4}-/.test(d)).sort();
}
