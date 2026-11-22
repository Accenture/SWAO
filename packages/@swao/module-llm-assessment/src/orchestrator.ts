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

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { cp, rm } from 'node:fs/promises';
import { CallRecordSchema, analysisMode, type CallRecord } from './call-record.js';
import { buildPassGroups, buildBucketView, buildChallengePassGroups, buildLzChallengePassGroups } from './pass-groups.js';
import { normaliseProperty, groupSubResult, finalResult, type DidNotFinish, type GroupSubResult, type PropertyScore } from './comparison-engine.js';
import { metricById } from './metric-catalogue.js';
import { buildManifest, type LlmLegManifest } from './llm-run-manifest.js';
import { FindingsStore, RunLog } from './run-store.js';
import { LEG_ENV } from './leg-recorder.js';
import { prepareLegWorkspace, PreparationCancelledError } from './leg-workspace.js';
import { hashTree, type TreeHashProgress } from './tree-hash.js';
import { buildProvenance, guardSecretText, logApp, readAppSourceRoot, formatCostTotal, listLzCatalogueFitFiles, treeKillPid } from '@swao/core';
import { LegLogTailer, applyLegEvent, activityFields, type LegActivityState } from './leg-activity.js';

export interface ResolvedLeg {
  id: string;
  connector: string;
  model: string;
  primary: boolean;
  connectorSha256?: string;
  /** #4372: 'unpriced' = no price known before the run (preflight warns). */
  costSource: 'billed' | 'configured' | 'local' | 'unpriced';
}

export interface LegSpawnResult {
  exitCode: number | null;
  durationMs: number;
  /**
   * #4243: the last part of the leg's combined stdout and stderr, kept by the
   * host. Redacted and stored as calls/<leg>.stderr.log; a failed leg's
   * reason and its leg.failed / leg.complete events quote the last lines.
   */
  outputTail?: string;
  /** #4470: PID of the leg process (also reported early through LegSpawnHooks.onPid). */
  pid?: number;
}

/** #4470: host callbacks of one leg spawn. */
export interface LegSpawnHooks {
  /** Called once the leg process has started, so the watchdog can kill its tree by PID. */
  onPid?: (pid: number) => void;
}

/** #4470: which leg limit ended a leg: no activity (stall) or the total time cap. */
export type LegLimit = 'stall' | 'total';

/** #4470: a duration for a reason or log line ("50 ms", "45 s", "30 min", "3 h"). */
export function limitText(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round((ms / 3_600_000) * 10) / 10} h`;
}

const envMs = (name: string, fallback: number): number => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** #4470 defaults: 30 min without leg activity, 3 h in total, 15 s for a killed leg process to exit. */
export const LEG_STALL_DEFAULT_MS = 30 * 60_000;
export const LEG_MAX_DEFAULT_MS = 3 * 60 * 60_000;
export const LEG_KILL_GRACE_DEFAULT_MS = 15_000;
/**
 * #4478 defaults of the leg challenges (app and LZ): 30 min without challenge
 * activity (SWAO_CHALLENGE_STALL_TIMEOUT_MS), 2 h in total (SWAO_CHALLENGE_MAX_MS).
 * The kill grace and the poll interval are the leg ones (SWAO_LEG_KILL_GRACE_MS,
 * SWAO_LEG_POLL_MS).
 */
export const CHALLENGE_STALL_DEFAULT_MS = 30 * 60_000;
export const CHALLENGE_MAX_DEFAULT_MS = 2 * 60 * 60_000;

/** #4243: outcome of one leg. `failed` covers exit non-zero, stall, preflight and zero assessment calls. */
export type LegStatus = 'complete' | 'failed' | 'cancelled';
/** #4243: run status; `partial` = at least one leg complete and one not. */
export type LlmRunStatus = 'complete' | 'partial' | 'failed' | 'cancelled';

export interface LegOutcome {
  id: string;
  status: LegStatus;
  exit: number | null;
  /** Assessment calls (challenge calls are counted separately, #4290). */
  calls: number;
  /** One line: why the leg failed or was cancelled. */
  reason?: string;
  /** Last event code the leg process logged before it ended. */
  last_phase?: string;
  /** Leg workspace kept for diagnosis (failed legs, keep_leg_wsp). */
  workspace?: string;
  /** #4470: the leg limit that ended the leg (its process tree was killed). */
  limit?: LegLimit;
  /** #4470: true when the orchestrator stopped the leg process (limit). */
  killed?: boolean;
  /** #4470: PID of the leg process when known. */
  pid?: number;
  /** #4470: last pass the leg started ("03 data_classification"). */
  last_pass?: string;
  /** leg.start to leg.complete. */
  wall_clock_ms: number;
}

/** #4243 hook for #4244: validate a leg before its workspace is copied. */
export interface LegPreflightResult {
  ok: boolean;
  reason?: string;
}

/**
 * #4277: what a leg challenge works on. The stakeholder challenge works on
 * the application run the leg produced itself (#4291); the LZ challenge on
 * the main workspace's LZ Catalog run, copied into the leg workspace. All
 * challenge output stays inside the leg workspace (Design 092 s7:
 * apps/<app>/wsp is never written by an LLM Assessment run).
 */
export interface LegChallengeContext {
  /** Run id (wsp/runs/<id> inside the leg workspace) to pass as `--run`; absent = the challenge's default. */
  runId?: string;
  /** The LLM Assessment run (llm-assessments/swao/<llmRunId>). */
  llmRunId: string;
}

/** #4242: the application run whose pass suite the comparison refers to. */
export interface SuiteRunRef {
  runTs: string;
  assessmentType: string;
  passCount: number;
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
  /**
   * #4323: last output of the challenge subprocess (host-captured). Logged
   * (secret-guarded, tail only) with a non-zero exit; never persisted in
   * challenge-results.json.
   */
  output_tail?: string;
  /**
   * #4478: set when the orchestrator ended the challenge: a fired challenge
   * limit (stall watchdog or total cap) or a run cancel. The challenge counts
   * as failed (every agent dnf); the leg result stays.
   */
  failure_reason?: string;
  /** #4478: the challenge limit that fired (absent for a run cancel). */
  limit?: LegLimit;
}

/**
 * #4478: the host signal and hooks of a challenge spawn. The signal is the
 * challenge's own (aborted by a run cancel or a fired challenge limit); the
 * host stops the challenge process tree by PID on abort and reports the PID
 * through hooks.onPid at once.
 */
export type ChallengeSpawn = (leg: ResolvedLeg, legWorkspaceRoot: string, legEnv: Record<string, string>, ctx: LegChallengeContext, signal?: AbortSignal, hooks?: LegSpawnHooks) => Promise<ChallengePassResult>;

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
  spawnLeg: (leg: ResolvedLeg, legWorkspaceRoot: string, env: Record<string, string>, signal?: AbortSignal, hooks?: LegSpawnHooks) => Promise<LegSpawnResult>;
  /**
   * #4243: optional check of a leg BEFORE its workspace is copied (the leg
   * command and its preconditions). A failed check ends the leg as failed
   * with the given reason and no copy. The implementation is #4244's
   * (lane B); without it every leg is copied and spawned.
   */
  preflightLeg?: (leg: ResolvedLeg) => Promise<LegPreflightResult> | LegPreflightResult;
  /**
   * #4372: optional price check of a candidate before the run; returns a
   * warning ("no price for <model> in <connector>.yaml ...") when the cost
   * dimension may not be measured. Logged as leg.preflight.price (warn) and
   * shown as a progress line before the first leg starts.
   */
  pricePreflight?: (leg: ResolvedLeg) => string | undefined;
  /** #4243: abort = cancel the run (Esc); the running leg is stopped by the host via the signal. */
  signal?: AbortSignal;
  /** #4243: one transient status line (preparation progress); null clears it. Not persisted. */
  onStatus?: (line: string | null) => void;
  /** #4242: the application run the comparison refers to (logged with run.start). */
  suiteRun?: SuiteRunRef;
  /**
   * Optional (#1708 / OQ-92-19 Q1): spawn the stakeholder challenge for a
   * completed leg workspace. Called after the leg's App Assessment finishes
   * and before the temp WSP is discarded (§7.2). When omitted the challenge
   * phase is skipped silently. The host injects `swao challenge --all-agents
   * --report` against the leg workspace; returns call counts per agent.
   * legEnv carries SWAO_LLM_ASSESSMENT_* variables so the challenge subprocess
   * can stream CallRecords to the same sink as the leg (#1819).
   */
  /**
   * #4277: the host runs the challenge with cwd = legWorkspaceRoot and
   * `--run ctx.runId` when given; it never writes into the real app's wsp/.
   */
  spawnChallenge?: ChallengeSpawn;
  /**
   * Optional (#1820): spawn the LZ sovereignty challenge for each leg.
   * Mirrors spawnChallenge but runs `swao challenge --lz --all-agents`.
   * C2-namespace PassGroup entries are produced from the results (#1820).
   */
  spawnLzChallenge?: ChallengeSpawn;
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
  /** #4243: complete, partial, failed or cancelled. */
  status: LlmRunStatus;
  /** #4243: one outcome per leg, in leg order. */
  legs: LegOutcome[];
  /** #4372: measured assessment cost per leg in USD; null = no priced call. */
  costUsd?: Record<string, number | null>;
  /** #4372: candidates whose calls had no price ("no price for <model> in <connector>.yaml"). */
  unpriced?: Array<{ legId: string; message: string }>;
  /** #4372: calls without a price per leg, from the same records as costUsd. */
  unpricedCalls?: Record<string, number>;
  /** #4372 (#4290): run totals of every paid call with the unpriced call counts (run block of the publication model). */
  totals?: CallTotals;
}

// #4243: the leg workspace copy lives in leg-workspace.ts (prepareLegWorkspace):
// scoped to source.vcs.subdir, without .git, asynchronous with progress.

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

/** #4479: per sink the bytes counted so far, the complete non-empty lines among them and the partial last line. */
const sinkCounts = new Map<string, { offset: number; count: number; tail: string }>();

/**
 * Call records written to a leg sink so far (non-empty lines).
 * #4479: counted from the bytes added since the last call (the watchdog
 * calls it every 2 s and the heartbeat every 30 s; it read the whole sink
 * each time). A sink that shrank or was replaced is counted again from 0.
 */
export function sinkLineCount(sinkPath: string): number {
  try {
    if (!existsSync(sinkPath)) { sinkCounts.delete(sinkPath); return 0; }
    const size = statSync(sinkPath).size;
    let s = sinkCounts.get(sinkPath);
    if (!s || size < s.offset) s = { offset: 0, count: 0, tail: '' };
    if (size > s.offset) {
      const buf = Buffer.alloc(size - s.offset);
      const fd = openSync(sinkPath, 'r');
      let got = 0;
      try { got = readSync(fd, buf, 0, buf.length, s.offset); } finally { closeSync(fd); }
      const parts = (s.tail + buf.subarray(0, got).toString('utf-8')).split('\n');
      const tail = parts.pop() ?? '';
      s = { offset: s.offset + got, count: s.count + parts.filter((l) => l.trim()).length, tail };
    }
    sinkCounts.set(sinkPath, s);
    return s.count + (s.tail.trim() ? 1 : 0);
  } catch { return 0; }
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
      // #4372 (owner decision 2026-11-14): a leg with ANY unpriced call is not
      // measured on cost and not ranked on its priced calls only; the cost
      // totals still show the priced sum plus the unpriced calls.
      if (rs.some(isUnpricedRecord)) return null;
      const priced = done(rs).filter((r) => r.cost_usd.computed !== null);
      if (priced.length === 0) return null;
      const sum = priced.reduce((a, r) => a + (r.cost_usd.computed as number), 0);
      // #3389: a billed leg whose total cost is exactly 0 has no price row
      // configured (unpriced, e.g. a sovereign gateway with no cost entries).
      // Exclude it from cost ranking instead of scoring it as the cheapest.
      return sum === 0 ? null : sum;
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
      // #4243: dynamic.skip too, so a leg without a vision pass says why (#1997 guard).
      if (typeof entry.code === 'string' && (/^provider\.llm\./.test(entry.code) || /^dynamic\.vision\./.test(entry.code) || entry.code === 'dynamic.skip')) {
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

const legSlug = (id: string): string => id.replace(/[^a-z0-9-]/gi, '_');

/** #4290: records written by a leg challenge (pass_id challenge-<agent> / challenge-lz-<agent>). */
const isChallengeRecord = (r: CallRecord): boolean => r.pass_id.startsWith('challenge-');

export interface CallTotals {
  call_count: number;
  cost_usd: number;
  assessment_calls: number;
  assessment_cost_usd: number;
  challenge_calls: number;
  challenge_cost_usd: number;
  lz_challenge_calls: number;
  lz_challenge_cost_usd: number;
  /** #4372: calls without a price (counted as 0 USD in the sums above). */
  unpriced_calls: number;
  assessment_unpriced_calls: number;
  challenge_unpriced_calls: number;
  lz_challenge_unpriced_calls: number;
}

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

/**
 * #4372: a call without a price: no computed cost and not a local call
 * (local calls are free, 092 s4). Older records with null labelled billed
 * count too.
 */
export const isUnpricedRecord = (r: CallRecord): boolean => r.cost_usd.computed === null && r.cost_usd.source !== 'local';

/**
 * #4290: every call a leg paid for, from its calls/<leg>.ndjson sink: the
 * assessment calls plus the stakeholder and LZ challenge calls (the
 * challenge subprocess appends to the same sink, #1819).
 */
export function callTotals(records: readonly CallRecord[]): CallTotals {
  const sum = (rs: readonly CallRecord[]): number => rs.reduce((a, r) => a + (r.cost_usd.computed ?? 0), 0);
  const unpriced = (rs: readonly CallRecord[]): number => rs.filter(isUnpricedRecord).length;
  const lz = records.filter((r) => r.pass_id.startsWith('challenge-lz-'));
  const app = records.filter((r) => isChallengeRecord(r) && !r.pass_id.startsWith('challenge-lz-'));
  const assessment = records.filter((r) => !isChallengeRecord(r));
  return {
    call_count: records.length,
    cost_usd: round6(sum(records)),
    assessment_calls: assessment.length,
    assessment_cost_usd: round6(sum(assessment)),
    challenge_calls: app.length,
    challenge_cost_usd: round6(sum(app)),
    lz_challenge_calls: lz.length,
    lz_challenge_cost_usd: round6(sum(lz)),
    unpriced_calls: unpriced(records),
    assessment_unpriced_calls: unpriced(assessment),
    challenge_unpriced_calls: unpriced(app),
    lz_challenge_unpriced_calls: unpriced(lz),
  };
}

/** #4290: field-wise sum of per-leg totals. */
function addTotals(all: readonly CallTotals[]): CallTotals {
  const keys: Array<keyof CallTotals> = ['call_count', 'cost_usd', 'assessment_calls', 'assessment_cost_usd', 'challenge_calls', 'challenge_cost_usd', 'lz_challenge_calls', 'lz_challenge_cost_usd',
    'unpriced_calls', 'assessment_unpriced_calls', 'challenge_unpriced_calls', 'lz_challenge_unpriced_calls'];
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as unknown as CallTotals;
  for (const t of all) for (const k of keys) out[k] += t[k];
  for (const k of keys) if (k.endsWith('usd')) out[k] = round6(out[k]);
  return out;
}

/** #4474: the legs that did not finish (no score, no rank) with reason and completed calls. */
export function didNotFinishOf(outcomes: readonly LegOutcome[]): Record<string, DidNotFinish> {
  const out: Record<string, DidNotFinish> = {};
  for (const o of outcomes) {
    if (o.status === 'complete') continue;
    out[o.id] = { status: o.status, ...(o.reason ? { reason: o.reason } : {}), calls: o.calls };
  }
  return out;
}

/** #4453: elapsed time for a status line ("34s", "1m 55s"). */
export function statusElapsed(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** #4453: interval of the challenge and synthesis status lines (ms). */
function statusTickMs(): number {
  return parseInt(process.env['SWAO_LLM_STATUS_TICK_MS'] ?? '15000', 10) || 15_000;
}

/** #4453: the progress line that ends the challenge phase of a leg. */
export const CHALLENGES_FINISHED = 'challenges finished';

const RUN_ID_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}/;

/**
 * #4291: the application run the leg produced itself: the newest run folder
 * in the leg workspace's wsp/runs. The leg copy excludes wsp/runs
 * (leg-workspace.ts APP_EXCLUDED_WSP_DIRS), so every run there was written
 * by the leg; call it BEFORE stageChallengeRuns copies the LZ Catalog run in.
 * The leg's latest-application.txt is not used: it is copied from the main
 * workspace and can still name the reference run.
 */
export function legOwnRunId(legWorkspace: string, appId: string): string | undefined {
  const runsDir = join(legWorkspace, 'apps', appId, 'wsp', 'runs');
  try {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && RUN_ID_RE.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse()[0];
  } catch { return undefined; }
}

/**
 * #4277: copy the main workspace's LZ Catalog run (the run named by
 * latest-landing-zone-catalog.txt) into the leg workspace, read-only on the
 * main side; a leg produces no LZ run of its own. #4291: the application
 * reference run is no longer staged, the leg challenges its own run
 * (legOwnRunId).
 * #4441 (owner decision 2026-11-15, as #4390 for the CLI): without an LZ
 * Catalog run, the inline LZ catalogue fit (lz-catalogue-fit*.yaml) of the
 * leg's own application run is the source. The leg's latest-application.txt
 * is pointed at that run, because the LZ challenge falls back to the latest
 * application run only when no --run is given.
 */
export async function stageChallengeRuns(
  workspaceRoot: string, legWorkspace: string, appId: string, legRunId?: string,
): Promise<StagedChallengeRuns> {
  const mainWsp = join(workspaceRoot, 'apps', appId, 'wsp');
  const legWsp = join(legWorkspace, 'apps', appId, 'wsp');
  const out: StagedChallengeRuns = {};
  const stage = async (id: string): Promise<boolean> => {
    if (!RUN_ID_RE.test(id)) return false;
    const from = join(mainWsp, 'runs', id);
    if (!existsSync(from)) return false;
    const to = join(legWsp, 'runs', id);
    if (!existsSync(to)) await cp(from, to, { recursive: true });
    return true;
  };
  // #4323: without a stageable LZ Catalog run the LZ challenge is skipped
  // with this reason (no pointer, pointer to a missing run, or copy failed).
  const ptr = join(mainWsp, 'latest-landing-zone-catalog.txt');
  const useInlineFit = (): boolean => {
    if (!legRunId || !RUN_ID_RE.test(legRunId) || listLzCatalogueFitFiles(join(legWsp, 'runs', legRunId)).length === 0) return false;
    try {
      writeFileSync(join(legWsp, 'latest-application.txt'), `runs/${legRunId}`, 'utf-8');
      out.lzInlineFitRunId = legRunId;
      return true;
    } catch { return false; }
  };
  if (!existsSync(ptr)) {
    if (!useInlineFit()) out.lzSkipReason = 'no-lz-catalog-run';
    return out;
  }
  try {
    const id = readFileSync(ptr, 'utf-8').trim().replace(/^runs[/]/, '');
    if (await stage(id)) {
      out.lzRunId = id;
      mkdirSync(legWsp, { recursive: true });
      writeFileSync(join(legWsp, 'latest-landing-zone-catalog.txt'), `runs/${id}`, 'utf-8');
    } else if (!useInlineFit()) {
      // #4441: a stale pointer (the LZ Catalog run is gone) also falls back to the inline fit.
      out.lzSkipReason = 'lz-catalog-run-missing';
    }
  } catch {
    out.lzSkipReason = 'lz-catalog-run-stage-failed';
  }
  return out;
}

/** #4323: why a leg LZ challenge was not spawned. */
export type LzChallengeSkipReason = 'no-lz-catalog-run' | 'lz-catalog-run-missing' | 'lz-catalog-run-stage-failed';

/** #4323: operator sentence per skip reason (log, screen, publication). */
export const LZ_CHALLENGE_SKIP_MESSAGES: Record<LzChallengeSkipReason, string> = {
  'no-lz-catalog-run': 'not run: no LZ Catalog run of the app and no inline LZ fit in the leg run',
  'lz-catalog-run-missing': 'not run: the LZ Catalog run named by latest-landing-zone-catalog.txt does not exist',
  'lz-catalog-run-stage-failed': 'not run: the LZ Catalog run could not be copied into the leg workspace',
};

/** #4277 / #4323: result of stageChallengeRuns. */
export interface StagedChallengeRuns {
  lzRunId?: string;
  /**
   * #4441: the leg's own application run whose inline LZ catalogue fit the LZ
   * challenge reads (no LZ Catalog run). The challenge is spawned without
   * --run so its inline-fit fallback applies.
   */
  lzInlineFitRunId?: string;
  /** Set when no LZ Catalog run was staged and no inline fit exists; the LZ challenge is then skipped. */
  lzSkipReason?: LzChallengeSkipReason;
}

/** #4277: copy the leg's challenge-app/ and challenge-lz/ into `dest` (app/, lz/). */
export async function keepLegChallengeOutputs(legWorkspace: string, appId: string, dest: string): Promise<string[]> {
  const kept: string[] = [];
  for (const [dir, name] of [['challenge-app', 'app'], ['challenge-lz', 'lz']] as const) {
    const from = join(legWorkspace, 'apps', appId, 'wsp', dir);
    if (!existsSync(from)) continue;
    try {
      await cp(from, join(dest, name), { recursive: true });
      kept.push(name);
    } catch { /* best-effort */ }
  }
  return kept;
}

/** Last `maxLines` non-empty lines of `text`, at most `maxChars` characters. */
export function tailLines(text: string, maxLines = 12, maxChars = 1_500): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const tail = lines.slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

/** One-line failure reason from an output tail: the last error-looking line, else the last line. */
export function reasonFromTail(tail: string): string | undefined {
  const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return undefined;
  const err = [...lines].reverse().find((l) => /\b(error|failed|fatal|exception)\b|\[error\]/i.test(l));
  const line = err ?? lines[lines.length - 1]!;
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

/** Last event code the leg process wrote to its app event log (the phase it died in). */
export function lastLegPhase(legWorkspace: string, appId: string): string | undefined {
  const dir = join(legWorkspace, 'apps', appId, 'wsp', 'logs');
  try {
    const files = readdirSync(dir).filter((f) => /^app-events-.*\.ndjson$/.test(f)).sort();
    const newest = files[files.length - 1];
    if (!newest) return undefined;
    const lines = readFileSync(join(dir, newest), 'utf-8').split('\n').filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const code = (JSON.parse(lines[i]!) as { code?: unknown }).code;
        if (typeof code === 'string' && code.length > 0) return code;
      } catch { /* skip malformed */ }
    }
  } catch { /* no log */ }
  return undefined;
}

/** #4372: operator sentence for a candidate without a price ("no price for <model> in <connector>.yaml"). */
export function unpricedMessage(leg: { connector: string; model: string }): string {
  return `no price for ${leg.model} in ${leg.connector}.yaml`;
}

/**
 * #4372: measured assessment cost per leg in USD (sum of priced calls);
 * null when no call of the leg has a price.
 */
/** #4372: calls without a price per leg (next to legCostUsd). */
export function legUnpricedCalls(records: readonly CallRecord[], legIds: readonly string[]): Record<string, number> {
  return Object.fromEntries(legIds.map((id) => [id, records.filter((r) => r.leg.id === id && isUnpricedRecord(r)).length]));
}

/**
 * #4372: the total cost of a run or leg as text: `0.8400 USD`,
 * `0.8400 USD plus 3 unpriced calls`, or `not measured` when every call is unpriced.
 */
export function runCostText(t: Pick<CallTotals, 'call_count' | 'cost_usd' | 'unpriced_calls'>): string {
  const text = formatCostTotal({ usd: t.cost_usd, calls: t.call_count, unpricedCalls: t.unpriced_calls });
  return text;
}

export function legCostUsd(records: readonly CallRecord[], legIds: readonly string[]): Record<string, number | null> {
  return Object.fromEntries(legIds.map((id) => {
    const priced = records.filter((r) => r.leg.id === id && r.cost_usd.computed !== null);
    return [id, priced.length === 0 ? null : round6(priced.reduce((a, r) => a + (r.cost_usd.computed as number), 0))];
  }));
}

const MB = 1024 * 1024;
const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

export async function orchestrateLegs(deps: OrchestratorDeps): Promise<OrchestrationResult> {
  const ts = (deps.timestamp ?? (() => new Date().toISOString()))();
  const runTs = ts.slice(0, 19).replace(/[:.]/g, '-');
  const runDir = join(deps.workspaceRoot, 'llm-assessments', 'swao', runTs);
  mkdirSync(join(runDir, 'calls'), { recursive: true });
  mkdirSync(join(runDir, 'comparison'), { recursive: true });

  const log = new RunLog(join(runDir, 'log.ndjson'));
  const findings = new FindingsStore(log);
  const progress = deps.onProgress ?? (() => undefined);
  const status = deps.onStatus ?? (() => undefined);
  const cancelled = (): boolean => deps.signal?.aborted === true;

  // #4243: run.start is the FIRST event (duration_ms counts from here) and
  // names the legs and the suite run, so a slow preparation is visible.
  const runStartMs = Date.now();
  const legList = deps.legs.map((l) => ({ id: l.id, connector: l.connector, model: l.model, primary: l.primary }));
  const suite = deps.suiteRun
    ? { run: deps.suiteRun.runTs, assessment_type: deps.suiteRun.assessmentType, passes: deps.suiteRun.passCount }
    : undefined;
  log.write('info', 'run.start', `LLM Assessment starting: ${deps.legs.length} legs, ${deps.execution}`, {
    app: deps.appId, legs: legList, execution: deps.execution, ...(suite ? { suite } : {}),
    ...buildProvenance(), // #4430: the build that ran it (LLM runs have no swao.run.start)
  });
  // #4243: one event family at app scope (llm_assess.*); aliases in Design 092 s5.7.
  logApp(deps.appId, 'info', 'llm_assess.start', `LLM Assessment starting: ${deps.legs.length} legs`, {
    context: { legs: legList, execution: deps.execution, run_dir: runDir, ...(suite ? { suite } : {}), ...buildProvenance() },
  });
  // #4372: warn before the run when a candidate has no price.
  for (const leg of deps.legs) {
    let warning: string | undefined;
    try { warning = deps.pricePreflight?.(leg); } catch { warning = undefined; }
    if (warning) {
      log.write('warn', 'leg.preflight.price', `leg ${leg.id}: ${warning}`, { leg_id: leg.id, connector: leg.connector, model: leg.model });
      progress(`leg ${leg.id}: warning, ${warning}`);
    }
  }
  const onAbort = (): void => {
    log.write('warn', 'run.cancelled', 'LLM Assessment cancelled by the operator', {});
    progress('run cancelled by the operator: stopping the running leg');
  };
  deps.signal?.addEventListener('abort', onAbort, { once: true });

  // #4243: hashes cover the scoped source root (source.vcs.subdir) and the
  // app inputs WITHOUT the source clone; before, wsp/inputs/ read a whole
  // monorepo clone and nothing was logged for 24 minutes.
  const appDir = join(deps.workspaceRoot, 'apps', deps.appId);
  const sourceRoot = readAppSourceRoot(appDir);
  const inputsDir = join(appDir, 'wsp', 'inputs');
  const sourceRelToInputs = relative(inputsDir, sourceRoot.base).split(sep).join('/');
  const hashStart = Date.now();
  status('Preparing: hashing the app source and inputs...');
  log.write('info', 'run.prepare.start', 'hashing the app source and inputs', {
    step: 'hash', source_root: relative(appDir, sourceRoot.root).split(sep).join('/') || '.', subdir: sourceRoot.subdir,
  });
  let sourceHash = '';
  let inputsHash = '';
  // #4404: run.prepare.progress every 15 s while hashing (files and MB so far),
  // like leg.prepare.progress; before, a 183 s hash wrote no line in between.
  const hashProgress = (tree: 'source' | 'inputs', filesBefore: number, bytesBefore: number) => (p: TreeHashProgress): void => {
    const files = filesBefore + p.files;
    const bytes = bytesBefore + p.bytes;
    const secs = Math.round((Date.now() - hashStart) / 1000);
    const text = p.phase === 'list'
      ? `listing the ${tree} files, ${files} found`
      : `${files} files (${mb(bytes)}) hashed${p.total_files !== null ? ` of ${filesBefore + p.total_files}` : ''}`;
    status(`Preparing: ${text}, ${secs}s`);
    log.write('info', 'run.prepare.progress', `preparation: ${text}`, {
      step: 'hash', tree, phase: p.phase, files, bytes, ...(p.total_files !== null ? { total_files: filesBefore + p.total_files } : {}), elapsed_ms: Date.now() - hashStart,
    });
  };
  try {
    const src = await hashTree(sourceRoot.root, {
      onProgress: hashProgress('source', 0, 0),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    const inp = await hashTree(inputsDir, {
      pruneDir: (rel) => rel === sourceRelToInputs,
      onProgress: hashProgress('inputs', src.files, src.bytes),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    sourceHash = src.hash;
    inputsHash = inp.hash;
    log.write('info', 'run.prepare.complete', `hashed ${src.files + inp.files} files (${mb(src.bytes + inp.bytes)})`, {
      step: 'hash', source_hash: sourceHash, inputs_hash: inputsHash,
      source_files: src.files, source_bytes: src.bytes, inputs_files: inp.files, inputs_bytes: inp.bytes,
      duration_ms: Date.now() - hashStart,
    });
    progress(`preparation: source and inputs hashed (${src.files + inp.files} files, ${mb(src.bytes + inp.bytes)}, ${Math.round((Date.now() - hashStart) / 1000)}s)`);
  } catch (hashErr) {
    if (!cancelled()) throw hashErr;
    log.write('warn', 'run.prepare.cancelled', 'hashing cancelled', { step: 'hash', duration_ms: Date.now() - hashStart });
  }
  status(null);

  const legIds = deps.legs.map((l) => l.id);
  const allRecords: CallRecord[] = [];
  const legStats: Record<string, LegRunStats> = {};
  const legVerdicts: Record<string, string | null> = {};
  const outcomes = new Map<string, LegOutcome>(deps.legs.map((l) => [l.id, { id: l.id, status: 'cancelled', exit: null, calls: 0, wall_clock_ms: 0 }]));
  const challengeResults = new Map<string, { agents: Array<{ agent_id: string; calls: number; dnf: boolean; duration_ms: number }> }>();
  const lzChallengeResults = new Map<string, { agents: Array<{ agent_id: string; calls: number; dnf: boolean; duration_ms: number }> }>();
  // #4372: legs with unpriced assessment calls (guidance on the result screen).
  const unpricedLegs: string[] = [];
  // #4323: legs whose LZ challenge was skipped, with the reason.
  const lzChallengeSkips = new Map<string, LzChallengeSkipReason>();
  // #1819: per-leg challenge call records for real cost/latency/parse metrics in publications.
  const challengeCallRecords = new Map<string, CallRecord[]>();
  const lzChallengeCallRecords = new Map<string, CallRecord[]>();

  const heartbeat = (leg: ResolvedLeg, code: string, sink: string, sinceMs: number, extra?: () => Record<string, unknown>): ReturnType<typeof setInterval> =>
    // #1965 / #2001: never silent for more than 30 s while a leg phase runs.
    setInterval(() => {
      const elapsed_ms = Date.now() - sinceMs;
      const calls_so_far = sinkLineCount(sink);
      // #4469: the current pass and the attempt of a call in retry.
      const more = extra?.() ?? {};
      log.write('info', code, `leg ${leg.id} in progress`, { leg_id: leg.id, elapsed_ms, calls_so_far, ...more });
      logApp(deps.appId, 'info', code, `leg ${leg.id} in progress`, { context: { leg_id: leg.id, elapsed_ms, calls_so_far, ...more } });
    }, parseInt(process.env['SWAO_LEG_HEARTBEAT_MS'] ?? '30000', 10) || 30_000);

  const runOneLeg = async (leg: ResolvedLeg): Promise<void> => {
    const outcome = outcomes.get(leg.id)!;
    if (cancelled()) {
      outcome.reason = 'run cancelled before the leg started';
      log.write('info', 'leg.cancelled', `leg ${leg.id} not started: run cancelled`, { leg_id: leg.id });
      progress(`leg ${leg.id}: not started (run cancelled)`);
      return;
    }
    const slug = legSlug(leg.id);
    const sink = join(runDir, 'calls', `${slug}.ndjson`);
    const legStartMs = Date.now();
    progress(`leg ${leg.id}: starting (${leg.connector} / ${leg.model})`);
    log.write('info', 'leg.start', `leg ${leg.id} starting`, { leg_id: leg.id, connector: leg.connector, model: leg.model });
    // #2001: mirror leg.start to app-events so the UAT monitor sees each leg begin.
    logApp(deps.appId, 'info', 'leg.start', `leg ${leg.id} starting`, { context: { leg_id: leg.id, connector: leg.connector, model: leg.model } });

    // #4469 / #4470: what the leg is doing now (from its own event log).
    const activity: LegActivityState = {};
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined = heartbeat(leg, 'leg.heartbeat', sink, legStartMs, () => activityFields(activity));
    let legWorkspace = '';
    // #2516: a fired limit whose process did not exit means the child may still hold the workspace.
    let stallFired = false;
    let legRecords: CallRecord[] = [];
    let spawnMs = 0;
    let tail = '';
    // #4470: the limit that ended the leg, whether the orchestrator stopped the
    // process and whether the process exited within the grace period.
    let limitFired: LegLimit | undefined;
    let killedLeg = false;
    let spawnSettled = true;
    // Default until the leg body proves otherwise (set through a cast so TS does not narrow it).
    (outcome as LegOutcome).status = 'failed';
    const env: Record<string, string> = {
      [LEG_ENV.RECORD]: sink,
      [LEG_ENV.LEG_ID]: leg.id,
      [LEG_ENV.CONNECTOR]: leg.connector,
      [LEG_ENV.MODEL]: leg.model,
      [LEG_ENV.COST_SOURCE]: leg.costSource,
      ...(leg.connectorSha256 ? { [LEG_ENV.CONNECTOR_SHA256]: leg.connectorSha256 } : {}),
    };

    // The leg body returns early (preflight, cancel); the terminal events
    // below always run, so every leg.start is closed by a leg.complete.
    const executeLeg = async (): Promise<void> => {
      // #4243 hook: the leg preflight (#4244) runs before any copy.
      if (deps.preflightLeg) {
        const pf = await deps.preflightLeg(leg);
        if (!pf.ok) {
          outcome.reason = `preflight failed: ${pf.reason ?? 'no reason given'}`;
          outcome.last_phase = 'preflight';
          log.write('error', 'leg.preflight.failed', `leg ${leg.id} preflight failed: ${pf.reason ?? 'no reason given'}`, { leg_id: leg.id });
          return;
        }
      }

      // #4243: preparation with start / progress / complete events.
      const prepStart = Date.now();
      let lastPrepLog = prepStart;
      log.write('info', 'leg.prepare.start', `leg ${leg.id}: preparing the leg workspace`, { leg_id: leg.id, step: 'copy' });
      logApp(deps.appId, 'info', 'llm_assess.prepare.start', `leg ${leg.id}: preparing the leg workspace`, { context: { leg_id: leg.id, step: 'copy' } });
      status(`leg ${leg.id}: preparing the leg workspace...`);
      const prepared = await prepareLegWorkspace({
        workspaceRoot: deps.workspaceRoot, appId: deps.appId, legId: leg.id,
        ...(deps.signal ? { signal: deps.signal } : {}),
        onProgress: (p) => {
          status(`leg ${leg.id}: preparing the leg workspace, ${p.files} files (${mb(p.bytes)}) copied, ${Math.round(p.elapsed_ms / 1000)}s`);
          if (Date.now() - lastPrepLog >= 15_000) {
            lastPrepLog = Date.now();
            log.write('info', 'leg.prepare.progress', `leg ${leg.id}: ${p.files} files copied`, { leg_id: leg.id, files: p.files, bytes: p.bytes, elapsed_ms: p.elapsed_ms });
          }
        },
      });
      legWorkspace = prepared.path;
      status(null);
      const prepCtx = {
        leg_id: leg.id, step: 'copy', files: prepared.stats.files, bytes: prepared.stats.bytes,
        links_skipped: prepared.stats.links_skipped, duration_ms: Date.now() - prepStart,
        source_subdir: prepared.source.subdir, source_copied: prepared.source_copied, path: legWorkspace,
      };
      log.write('info', 'leg.prepare.complete', `leg ${leg.id}: leg workspace ready`, prepCtx);
      logApp(deps.appId, 'info', 'llm_assess.prepare.complete', `leg ${leg.id}: leg workspace ready`, { context: prepCtx });
      progress(`leg ${leg.id}: workspace ready (${prepared.stats.files} files, ${mb(prepared.stats.bytes)}, ${Math.round(prepCtx.duration_ms / 1000)}s)`);

      // #4470 (#2008): the stall watchdog ends a leg after SWAO_LEG_STALL_TIMEOUT_MS
      // WITHOUT leg activity (reset by every pass event, LLM attempt / waiting /
      // ok / retry event, a heartbeat with a new pass and a new call record); the
      // total cap SWAO_LEG_MAX_MS bounds the whole leg. Either one kills the leg
      // process tree by PID. #4243: abort (Esc) ends the wait as well.
      const stallMs = envMs('SWAO_LEG_STALL_TIMEOUT_MS', LEG_STALL_DEFAULT_MS);
      const maxMs = envMs('SWAO_LEG_MAX_MS', LEG_MAX_DEFAULT_MS);
      const graceMs = envMs('SWAO_LEG_KILL_GRACE_MS', LEG_KILL_GRACE_DEFAULT_MS);
      const pollMs = envMs('SWAO_LEG_POLL_MS', 2_000);
      const spawnStart = Date.now();
      // The leg's own signal: aborted by the run cancel and by a fired limit
      // (never deps.signal, which would mark the whole run cancelled).
      const legAbort = new AbortController();
      const onRunAbort = (): void => legAbort.abort();
      if (deps.signal?.aborted) legAbort.abort();
      else deps.signal?.addEventListener('abort', onRunAbort, { once: true });
      const tailer = new LegLogTailer(join(legWorkspace, 'apps', deps.appId, 'wsp', 'logs'), ts);
      let lastActivity = spawnStart;
      let lastSinkCount = 0;
      const pollActivity = (): void => {
        for (const ev of tailer.poll()) {
          const r = applyLegEvent(activity, leg.id, ev);
          if (r.progress) lastActivity = Date.now();
          // #4469: pass and retry events reach the run log while the leg runs.
          if (r.forward) log.write(r.forward.level, r.forward.code, r.forward.message, r.forward.context);
        }
        const n = sinkLineCount(sink);
        if (n !== lastSinkCount) { lastSinkCount = n; lastActivity = Date.now(); }
      };
      let watchTimer: ReturnType<typeof setInterval> | undefined;
      const limitPromise = new Promise<LegLimit>((resolve) => {
        const tick = Math.max(10, Math.min(pollMs, Math.floor(stallMs / 4), Math.floor(maxMs / 4)));
        watchTimer = setInterval(() => {
          pollActivity();
          const now = Date.now();
          if (now - spawnStart >= maxMs) resolve('total');
          else if (now - lastActivity >= stallMs) resolve('stall');
        }, tick);
      });
      let abortListener: (() => void) | undefined;
      const abortPromise = new Promise<void>((resolve) => {
        if (!deps.signal) return;
        if (deps.signal.aborted) { resolve(); return; }
        abortListener = () => resolve();
        deps.signal.addEventListener('abort', abortListener, { once: true });
      });
      let legPid: number | undefined;
      const spawnPromise = deps.spawnLeg(leg, legWorkspace, env, legAbort.signal, { onPid: (p) => { legPid = p; } });
      // Observed in every branch, so a late rejection is never unhandled.
      const settledPromise: Promise<LegSpawnResult | undefined> = spawnPromise.then((r) => r, () => undefined);
      type First = { kind: 'exit'; r: LegSpawnResult } | { kind: 'limit'; limit: LegLimit } | { kind: 'abort' };
      let first: First;
      try {
        first = await Promise.race<First>([
          spawnPromise.then((r) => ({ kind: 'exit' as const, r })),
          limitPromise.then((limit) => ({ kind: 'limit' as const, limit })),
          abortPromise.then(() => ({ kind: 'abort' as const })),
        ]);
      } finally {
        if (watchTimer !== undefined) clearInterval(watchTimer);
        deps.signal?.removeEventListener('abort', onRunAbort);
        if (abortListener) deps.signal?.removeEventListener('abort', abortListener);
      }
      let result: LegSpawnResult;
      if (first.kind === 'exit') {
        result = first.r;
        pollActivity();
      } else {
        if (first.kind === 'limit') {
          limitFired = first.limit;
          const limitMs = first.limit === 'stall' ? stallMs : maxMs;
          const stallCtx = {
            leg_id: leg.id, limit: first.limit, timeout_ms: limitMs, idle_ms: Date.now() - lastActivity, elapsed_ms: Date.now() - spawnStart,
            calls_so_far: lastSinkCount, ...activityFields(activity), ...(legPid !== undefined ? { pid: legPid } : {}),
          };
          const where = activity.pass ? ` (pass ${activity.pass})` : '';
          const msg = first.limit === 'stall'
            ? `leg ${leg.id}: stall watchdog fired, no leg activity for ${limitText(stallMs)}${where}; stopping the leg process`
            : `leg ${leg.id}: leg time limit of ${limitText(maxMs)} reached${where}; stopping the leg process`;
          log.write('warn', 'leg.stall', msg, stallCtx);
          logApp(deps.appId, 'warn', 'leg.stall', msg, { context: stallCtx });
        }
        // #4470: stop the leg process tree: the host reacts to the leg signal,
        // and the orchestrator kills by PID itself (covers a host or child that
        // ignores the signal). Only for a fired limit or a run cancel.
        legAbort.abort();
        if (legPid !== undefined) {
          try { await treeKillPid(legPid); } catch { /* best-effort */ }
        }
        killedLeg = first.kind === 'limit';
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const settled = await Promise.race([
          settledPromise,
          new Promise<undefined>((r) => { graceTimer = setTimeout(() => r(undefined), graceMs); }),
        ]);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        spawnSettled = settled !== undefined;
        if (settled?.pid !== undefined && legPid === undefined) legPid = settled.pid;
        pollActivity();
        result = settled
          ? { ...settled, exitCode: first.kind === 'limit' ? (settled.exitCode ?? 1) : null }
          : { exitCode: first.kind === 'abort' ? null : 1, durationMs: Date.now() - spawnStart };
      }
      if (legPid === undefined && result.pid !== undefined) legPid = result.pid;
      if (legPid !== undefined) outcome.pid = legPid;
      if (activity.pass) outcome.last_pass = activity.pass;
      spawnMs = result.durationMs;
      tail = result.outputTail ?? '';
      outcome.exit = result.exitCode;
      legStats[leg.id] = { wallClockMs: result.durationMs, exitCode: result.exitCode };
      // #4290: assessment records only; challenge records (pass_id challenge-*) are totalled separately.
      legRecords = readLegRecords(sink).filter((r) => !isChallengeRecord(r));
      allRecords.push(...legRecords);
      outcome.calls = legRecords.length;
      for (const r of legRecords) {
        if (r.reliability.dnf) {
          findings.add({
            severity: 'warn', leg: leg.id, pass_id: r.pass_id, call_ref: `${r.pass_id}#${r.call_index}`,
            type: r.reliability.rate_limited ? 'rate-limit' : 'timeout',
            message: `leg ${leg.id}, pass ${r.pass_id}: ${r.reliability.error ?? 'no usable response'}`,
            metric_impact: 'rel.dnf_count',
          });
        }
        if (r.cost_usd.computed === null && r.cost_usd.source !== 'local' && r.cost_usd.source !== 'unpriced') {
          findings.add({
            severity: 'warn', leg: leg.id, pass_id: r.pass_id, type: 'cost-unavailable',
            message: `leg ${leg.id}: no price available for a billed call`, metric_impact: 'cost.total_usd',
          });
        }
      }
      // #4372: one finding per leg for unpriced calls, naming model and connector.
      const unpricedCalls = legRecords.filter((r) => r.cost_usd.source === 'unpriced').length;
      if (unpricedCalls > 0) {
        unpricedLegs.push(leg.id);
        findings.add({
          severity: 'warn', leg: leg.id, type: 'cost-unavailable',
          message: `${unpricedMessage(leg)}: ${unpricedCalls} call(s) recorded without cost, the cost dimension is not measured for this leg`,
          metric_impact: 'cost.total_usd',
        });
      }

      if (cancelled()) {
        outcome.status = 'cancelled';
        outcome.reason = 'cancelled by the operator';
        return;
      }
      const lastPhase = lastLegPhase(legWorkspace, deps.appId);
      if (lastPhase) outcome.last_phase = lastPhase;
      if (limitFired) {
        outcome.limit = limitFired;
        outcome.killed = true;
        // #2516: only a process that did not exit after the kill may still hold the workspace.
        stallFired = !spawnSettled;
        const where = activity.pass ? `, last pass ${activity.pass}` : '';
        outcome.reason = limitFired === 'stall'
          ? `stall watchdog: no leg activity for ${limitText(stallMs)}${where}, ${outcome.calls} calls completed`
          : `leg time limit of ${limitText(maxMs)} reached${where}, ${outcome.calls} calls completed`;
      } else if (result.exitCode !== 0) {
        outcome.reason = `exit ${result.exitCode ?? 'null'}${reasonFromTail(guardSecretText(tail).text) ? `: ${reasonFromTail(guardSecretText(tail).text)}` : ''}`;
      } else if (legRecords.length === 0) {
        outcome.reason = 'the leg completed but recorded no assessment calls';
      } else {
        outcome.status = 'complete';
      }
      if (limitFired) {
        // #4470: a leg ended by a limit is failed whatever exit code the killed process reported.
        findings.add({
          severity: 'error', leg: leg.id, type: 'leg-failed',
          message: `leg ${leg.id} was stopped (${outcome.reason ?? limitFired}); its metrics cover only completed calls`,
        });
      } else if (result.exitCode !== 0) {
        findings.add({
          severity: 'error', leg: leg.id, type: 'leg-failed',
          message: `leg ${leg.id} exited ${result.exitCode ?? 'null'}; its metrics cover only completed calls`,
        });
      }
      if (legRecords.length === 0) {
        // #4243: F-2 tells "the leg died before its first call" apart from
        // "the leg ran but nothing reached the connector".
        findings.add({
          severity: 'error', leg: leg.id, type: 'no-calls-recorded',
          message: result.exitCode !== 0 || limitFired
            ? `leg ${leg.id} recorded no LLM calls: the leg process failed before its first call${lastPhase ? ` (last phase ${lastPhase})` : ''}, so the connector was never reached; see calls/${slug}.stderr.log`
            : `leg ${leg.id} recorded no LLM calls although the leg process completed; check the connector configuration and the workload-shape guard`,
        });
      }
    };

    try {
      await executeLeg();
    } catch (legErr) {
      if (legErr instanceof PreparationCancelledError || cancelled()) {
        outcome.status = 'cancelled';
        outcome.reason = 'cancelled by the operator';
      } else {
        // #2427: an unhandled throw becomes a finding; the run still writes its artefacts.
        const errMsg = legErr instanceof Error ? legErr.message : String(legErr);
        outcome.reason = `unhandled error: ${errMsg}`;
        log.write('error', 'leg.error', `leg ${leg.id} threw: ${errMsg}`, { leg_id: leg.id });
        logApp(deps.appId, 'error', 'leg.error', `leg ${leg.id} threw: ${errMsg}`, { context: { leg_id: leg.id } });
        findings.add({ severity: 'error', leg: leg.id, type: 'leg-failed', message: `leg ${leg.id} threw an unhandled error: ${errMsg}` });
      }
    } finally {
      // #4243: the heartbeat ends with the leg; no leg.heartbeat after leg.complete.
      if (heartbeatTimer !== undefined) { clearInterval(heartbeatTimer); heartbeatTimer = undefined; }
      status(null);
    }

    // ---- terminal events (#4243) ----
    outcome.wall_clock_ms = Date.now() - legStartMs;
    const safeTail = tail ? guardSecretText(tail).text : '';
    const stderrLog = join(runDir, 'calls', `${slug}.stderr.log`);
    if (safeTail) {
      try { writeFileSync(stderrLog, safeTail.endsWith('\n') ? safeTail : `${safeTail}\n`, 'utf-8'); } catch { /* best-effort */ }
    }
    const keepForDiagnosis = outcome.status === 'failed' && legWorkspace !== '';
    if (keepForDiagnosis) outcome.workspace = legWorkspace;
    const shortTail = safeTail ? tailLines(safeTail) : undefined;
    const terminalCtx: Record<string, unknown> = {
      leg_id: leg.id, status: outcome.status, exit: outcome.exit, calls: outcome.calls,
      wall_clock_ms: outcome.wall_clock_ms, spawn_ms: spawnMs,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.last_phase ? { last_phase: outcome.last_phase } : {}),
      ...(outcome.last_pass ? { last_pass: outcome.last_pass } : {}),
      // #4470: which limit ended the leg; its process tree was killed by PID.
      ...(outcome.limit ? { limit: outcome.limit } : {}),
      ...(killedLeg ? { killed: true, exited: spawnSettled } : {}),
      ...(outcome.pid !== undefined ? { pid: outcome.pid } : {}),
      ...(safeTail ? { stderr_log: `calls/${slug}.stderr.log` } : {}),
      ...(outcome.status === 'failed' && shortTail ? { stderr_tail: shortTail } : {}),
      ...(keepForDiagnosis ? { workspace: legWorkspace } : {}),
    };
    if (outcome.status === 'failed') {
      log.write('error', 'leg.failed', `leg ${leg.id} failed: ${outcome.reason ?? 'unknown reason'}`, terminalCtx);
      logApp(deps.appId, 'error', 'leg.failed', `leg ${leg.id} failed: ${outcome.reason ?? 'unknown reason'}`, { context: terminalCtx });
    }
    const level = outcome.status === 'complete' ? 'info' : outcome.status === 'cancelled' ? 'warn' : 'error';
    log.write(level, 'leg.complete', `leg ${leg.id} ${outcome.status}`, terminalCtx);
    // #2287: mirror leg.complete to app-events so the sequence gate sees the closure.
    logApp(deps.appId, level, 'leg.complete', `leg ${leg.id} ${outcome.status}`, { context: terminalCtx });
    progress(outcome.status === 'complete'
      ? `leg ${leg.id}: complete (${outcome.calls} calls)`
      : `leg ${leg.id}: ${outcome.status}${outcome.reason ? `: ${outcome.reason}` : ''}`);

    try {
      if (legWorkspace) {
        if (outcome.status === 'complete') legVerdicts[leg.id] = extractLegVerdict(legWorkspace, deps.appId);
        // #1795: copy call-N.json artefacts from leg WSP run to main run dir
        // (before the challenge runs are staged into the leg workspace).
        copyLegCallArtefacts(legWorkspace, deps.appId, leg.id, runDir);
      }

      // #4243: a leg that failed or recorded no assessment call gets no
      // challenge (no spend on output the leg never produced).
      const challengeEligible = outcome.status === 'complete' && legWorkspace !== '' && !cancelled();
      if (!challengeEligible && (deps.spawnChallenge || deps.spawnLzChallenge)) {
        const why = outcome.status === 'cancelled' || cancelled() ? 'the run was cancelled' : 'the leg failed or recorded no assessment calls';
        log.write('info', 'leg.challenge.skip', `leg ${leg.id}: challenges skipped, ${why}`, { leg_id: leg.id, status: outcome.status });
        progress(`leg ${leg.id}: challenges skipped (${why})`);
      }
      if (challengeEligible) {
        const challengeStartMs = Date.now();
        heartbeatTimer = heartbeat(leg, 'leg.challenge.heartbeat', sink, challengeStartMs);
        // #4453: the screen names the challenge of this leg with its elapsed time.
        const hasChallenge = deps.spawnChallenge !== undefined || deps.spawnLzChallenge !== undefined;
        if (hasChallenge) status(`leg ${leg.id}: challenge running`);
        const challengeTicker = hasChallenge
          ? setInterval(() => status(`leg ${leg.id}: challenge running, ${statusElapsed(Date.now() - challengeStartMs)}`), statusTickMs())
          : undefined;
        // #4291: the leg challenges the application run it produced itself;
        // read it BEFORE the LZ Catalog run is staged into wsp/runs.
        const legRunId = legOwnRunId(legWorkspace, deps.appId);
        // #4277: stage the main workspace's LZ Catalog run (read-only copy) into
        // the leg workspace; the challenges run there and write only there.
        const staged = await stageChallengeRuns(deps.workspaceRoot, legWorkspace, deps.appId, legRunId);
        const challengeCtx = { leg_id: leg.id, llm_run_id: runTs };
        // #4478: a challenge runs under its own signal (run cancel or a fired
        // challenge limit; never deps.signal, so a fired limit does not cancel
        // the run), a stall watchdog on challenge activity (new events in the
        // leg's app event log, new call records in the sink) and a total cap.
        // A fired limit or a cancel kills the challenge process tree by PID and
        // records the challenge as failed with the reason; the leg result stays.
        const watchChallenge = async (kind: 'app' | 'lz', start: (signal: AbortSignal, hooks: LegSpawnHooks) => Promise<ChallengePassResult>): Promise<{ result: ChallengePassResult; ended?: Record<string, unknown> }> => {
          const code = kind === 'app' ? 'leg.challenge' : 'leg.challenge-lz';
          const label = kind === 'app' ? 'challenge' : 'LZ challenge';
          const stallMs = envMs('SWAO_CHALLENGE_STALL_TIMEOUT_MS', CHALLENGE_STALL_DEFAULT_MS);
          const maxMs = envMs('SWAO_CHALLENGE_MAX_MS', CHALLENGE_MAX_DEFAULT_MS);
          const graceMs = envMs('SWAO_LEG_KILL_GRACE_MS', LEG_KILL_GRACE_DEFAULT_MS);
          const pollMs = envMs('SWAO_LEG_POLL_MS', 2_000);
          const startMs = Date.now();
          const challengeAbort = new AbortController();
          const onRunAbort = (): void => challengeAbort.abort();
          if (deps.signal?.aborted) challengeAbort.abort();
          else deps.signal?.addEventListener('abort', onRunAbort, { once: true });
          const tailer = new LegLogTailer(join(legWorkspace, 'apps', deps.appId, 'wsp', 'logs'), new Date(startMs).toISOString());
          const state: LegActivityState = {};
          let lastActivity = startMs;
          const baseCount = sinkLineCount(sink);
          let lastCount = baseCount;
          const pollActivity = (): void => {
            for (const ev of tailer.poll()) if (applyLegEvent(state, leg.id, ev).progress) lastActivity = Date.now();
            const n = sinkLineCount(sink);
            if (n !== lastCount) { lastCount = n; lastActivity = Date.now(); }
          };
          let watchTimer: ReturnType<typeof setInterval> | undefined;
          const limitPromise = new Promise<LegLimit>((resolve) => {
            const tick = Math.max(10, Math.min(pollMs, Math.floor(stallMs / 4), Math.floor(maxMs / 4)));
            watchTimer = setInterval(() => {
              pollActivity();
              const now = Date.now();
              if (now - startMs >= maxMs) resolve('total');
              else if (now - lastActivity >= stallMs) resolve('stall');
            }, tick);
          });
          let abortListener: (() => void) | undefined;
          const abortPromise = new Promise<void>((resolve) => {
            if (!deps.signal) return;
            if (deps.signal.aborted) { resolve(); return; }
            abortListener = () => resolve();
            deps.signal.addEventListener('abort', abortListener, { once: true });
          });
          let pid: number | undefined;
          const spawnPromise = start(challengeAbort.signal, { onPid: (p) => { pid = p; } });
          const settledPromise: Promise<ChallengePassResult | undefined> = spawnPromise.then((r) => r, () => undefined);
          type First = { kind: 'exit'; r: ChallengePassResult } | { kind: 'limit'; limit: LegLimit } | { kind: 'abort' };
          let first: First;
          try {
            first = await Promise.race<First>([
              spawnPromise.then((r) => ({ kind: 'exit' as const, r })),
              limitPromise.then((limit) => ({ kind: 'limit' as const, limit })),
              abortPromise.then(() => ({ kind: 'abort' as const })),
            ]);
          } finally {
            if (watchTimer !== undefined) clearInterval(watchTimer);
            deps.signal?.removeEventListener('abort', onRunAbort);
            if (abortListener) deps.signal?.removeEventListener('abort', abortListener);
          }
          if (first.kind === 'exit') return { result: first.r };
          const calls = lastCount - baseCount;
          const limit = first.kind === 'limit' ? first.limit : undefined;
          if (limit) {
            const limitMs = limit === 'stall' ? stallMs : maxMs;
            const msg = limit === 'stall'
              ? `leg ${leg.id}: ${label} stall watchdog fired, no challenge activity for ${limitText(stallMs)}; stopping the ${label} process`
              : `leg ${leg.id}: ${label} time limit of ${limitText(maxMs)} reached; stopping the ${label} process`;
            const stallCtx = {
              ...challengeCtx, limit, timeout_ms: limitMs, idle_ms: Date.now() - lastActivity, elapsed_ms: Date.now() - startMs,
              calls_so_far: calls, ...(pid !== undefined ? { pid } : {}),
            };
            log.write('warn', `${code}.stall`, msg, stallCtx);
            logApp(deps.appId, 'warn', `${code}.stall`, msg, { context: stallCtx });
          }
          // Stop the tree: the host reacts to the signal; the kill by PID covers a host that ignores it.
          challengeAbort.abort();
          if (pid !== undefined) {
            try { await treeKillPid(pid); } catch { /* best-effort */ }
          }
          let graceTimer: ReturnType<typeof setTimeout> | undefined;
          const settled = await Promise.race([
            settledPromise,
            new Promise<undefined>((r) => { graceTimer = setTimeout(() => r(undefined), graceMs); }),
          ]);
          if (graceTimer !== undefined) clearTimeout(graceTimer);
          // #2516: a process that did not exit after the kill may still hold the leg workspace.
          if (settled === undefined) stallFired = true;
          const reason = limit === 'stall'
            ? `${label} stall watchdog: no challenge activity for ${limitText(stallMs)}, ${calls} calls completed`
            : limit === 'total'
              ? `${label} time limit of ${limitText(maxMs)} reached, ${calls} calls completed`
              : 'run cancelled';
          const got = settled ?? { completed_at: '', agents: [], exit_code: null };
          return {
            result: {
              ...got,
              completed_at: new Date().toISOString(),
              agents: got.agents.map((a) => ({ ...a, dnf: true })),
              exit_code: limit ? (got.exit_code === 0 || got.exit_code === null ? 1 : got.exit_code) : null,
              failure_reason: reason,
              ...(limit ? { limit } : {}),
            },
            ended: { ...(limit ? { limit, killed: true } : { cancelled: true }), exited: settled !== undefined, ...(pid !== undefined ? { pid } : {}), failure_reason: reason },
          };
        };
        try {
          // #1708 (OQ-92-19 Q1): stakeholder challenge phase, before the s7.2 discard.
          if (deps.spawnChallenge && !legRunId) {
            // #4291: never fall back to the reference run of the main workspace.
            log.write('warn', 'leg.challenge.skip', `leg ${leg.id}: stakeholder challenge not run, the leg wrote no application run`, { ...challengeCtx, reason: 'no-leg-run' });
            progress(`leg ${leg.id}: stakeholder challenge not run (the leg wrote no application run)`);
          } else if (deps.spawnChallenge && legRunId) {
            progress(`leg ${leg.id}: running stakeholder challenge...`);
            log.write('info', 'leg.challenge.start', `leg ${leg.id} challenge starting on its own run ${legRunId}`, { ...challengeCtx, challenged_run: legRunId });
            try {
              const spawnApp = deps.spawnChallenge;
              const watched = await watchChallenge('app', (signal, hooks) => spawnApp(leg, legWorkspace, env, { llmRunId: runTs, runId: legRunId }, signal, hooks));
              const { output_tail: appTail, ...challengeResult } = watched.result;
              mkdirSync(join(runDir, 'calls', slug), { recursive: true });
              writeFileSync(join(runDir, 'calls', slug, 'challenge-results.json'), JSON.stringify(challengeResult, null, 2), 'utf-8');
              challengeResults.set(leg.id, challengeResult);
              // #2290: add leg_id to challenge complete events for log correlation.
              // #4323: a non-zero (or missing) exit code is a warning, not info.
              // #4478: a challenge ended by a limit or a cancel names the reason.
              const appExitOk = challengeResult.exit_code === 0 && !challengeResult.failure_reason;
              const appMsg = challengeResult.failure_reason
                ? `leg ${leg.id} challenge failed: ${challengeResult.failure_reason}`
                : appExitOk ? `leg ${leg.id} challenge complete` : `leg ${leg.id} challenge ended with exit code ${String(challengeResult.exit_code)}`;
              log.write(appExitOk ? 'info' : 'warn', 'leg.challenge.complete', appMsg, {
                ...challengeCtx, agents: challengeResult.agents.length, exit_code: challengeResult.exit_code,
                ...(watched.ended ?? {}),
                ...(!appExitOk && appTail ? { stderr_tail: tailLines(guardSecretText(appTail).text) } : {}),
              });
              progress(challengeResult.failure_reason
                ? `leg ${leg.id}: challenge failed (${challengeResult.failure_reason}), continuing`
                : appExitOk
                  ? `leg ${leg.id}: challenge complete (${challengeResult.agents.length} agents)`
                  : `leg ${leg.id}: challenge ended with exit code ${String(challengeResult.exit_code)} (${challengeResult.agents.length} agents)`);
            } catch (challengeErr) {
              log.write('warn', 'leg.challenge.error', `leg ${leg.id} challenge failed: ${(challengeErr as Error).message}`, challengeCtx);
              progress(`leg ${leg.id}: challenge failed, continuing without challenge data`);
            }
          }
          // #1820: LZ sovereignty challenge phase (C2-namespace PassGroups).
          // #4441: the challenged LZ run: the staged LZ Catalog run, else the leg run with the inline fit.
          const lzChallengedRun = staged.lzRunId ?? staged.lzInlineFitRunId;
          if (deps.spawnLzChallenge && !cancelled() && !lzChallengedRun) {
            // #4323: nothing to challenge; no spawn, one skip event with the reason.
            const reason = staged.lzSkipReason ?? 'no-lz-catalog-run';
            lzChallengeSkips.set(leg.id, reason);
            const msg = LZ_CHALLENGE_SKIP_MESSAGES[reason];
            log.write('info', 'leg.challenge-lz.skip', `leg ${leg.id}: LZ challenge ${msg}`, { ...challengeCtx, reason });
            progress(`leg ${leg.id}: LZ challenge ${msg}`);
          } else if (deps.spawnLzChallenge && !cancelled()) {
            progress(`leg ${leg.id}: running LZ sovereignty challenge...`);
            log.write('info', 'leg.challenge-lz.start', staged.lzRunId
              ? `leg ${leg.id} LZ challenge starting on the LZ Catalog run ${staged.lzRunId}`
              : `leg ${leg.id} LZ challenge starting on the inline LZ fit of its own run ${lzChallengedRun}`, {
              ...challengeCtx, challenged_run: lzChallengedRun, fit_source: staged.lzRunId ? 'landing-zone-catalog' : 'application',
            });
            try {
              const spawnLz = deps.spawnLzChallenge;
              const watchedLz = await watchChallenge('lz', (signal, hooks) => spawnLz(leg, legWorkspace, env, { llmRunId: runTs, ...(staged.lzRunId ? { runId: staged.lzRunId } : {}) }, signal, hooks));
              const { output_tail: lzTail, ...lzChallengeResult } = watchedLz.result;
              mkdirSync(join(runDir, 'calls', slug), { recursive: true });
              writeFileSync(join(runDir, 'calls', slug, 'lz-challenge-results.json'), JSON.stringify(lzChallengeResult, null, 2), 'utf-8');
              lzChallengeResults.set(leg.id, lzChallengeResult);
              const lzExitOk = lzChallengeResult.exit_code === 0 && !lzChallengeResult.failure_reason;
              const lzMsg = lzChallengeResult.failure_reason
                ? `leg ${leg.id} LZ challenge failed: ${lzChallengeResult.failure_reason}`
                : lzExitOk ? `leg ${leg.id} LZ challenge complete` : `leg ${leg.id} LZ challenge ended with exit code ${String(lzChallengeResult.exit_code)}`;
              log.write(lzExitOk ? 'info' : 'warn', 'leg.challenge-lz.complete', lzMsg, {
                ...challengeCtx, agents: lzChallengeResult.agents.length, exit_code: lzChallengeResult.exit_code,
                ...(watchedLz.ended ?? {}),
                ...(!lzExitOk && lzTail ? { stderr_tail: tailLines(guardSecretText(lzTail).text) } : {}),
              });
              progress(lzChallengeResult.failure_reason
                ? `leg ${leg.id}: LZ challenge failed (${lzChallengeResult.failure_reason}), continuing`
                : lzExitOk
                  ? `leg ${leg.id}: LZ challenge complete (${lzChallengeResult.agents.length} agents)`
                  : `leg ${leg.id}: LZ challenge ended with exit code ${String(lzChallengeResult.exit_code)} (${lzChallengeResult.agents.length} agents)`);
            } catch (lzChallengeErr) {
              log.write('warn', 'leg.challenge-lz.error', `leg ${leg.id} LZ challenge failed: ${(lzChallengeErr as Error).message}`, challengeCtx);
              progress(`leg ${leg.id}: LZ challenge failed, continuing without LZ challenge data`);
            }
          }
        } finally {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
          if (challengeTicker !== undefined) clearInterval(challengeTicker);
        }
        // #4453: the leg counts as finished on screen only after its challenges.
        if (hasChallenge) {
          status(null);
          progress(`leg ${leg.id}: ${CHALLENGES_FINISHED} (${statusElapsed(Date.now() - challengeStartMs)})`);
        }
        // #4277: keep the leg's challenge output in the LLM run folder, one folder per leg.
        const kept = await keepLegChallengeOutputs(legWorkspace, deps.appId, join(runDir, 'challenge', slug));
        if (kept.length > 0) log.write('info', 'leg.challenge.outputs', `leg ${leg.id}: challenge output kept in challenge/${slug}`, { ...challengeCtx, folders: kept });
        // #1819: the challenge subprocess appends its records (pass_id
        // 'challenge-*') to the same sink; split them off for the C1/C2 groups.
        const newRecords = readLegRecords(sink).filter(isChallengeRecord);
        challengeCallRecords.set(leg.id, newRecords.filter((r) => r.pass_id.startsWith('challenge-') && !r.pass_id.startsWith('challenge-lz-')));
        lzChallengeCallRecords.set(leg.id, newRecords.filter((r) => r.pass_id.startsWith('challenge-lz-')));
      }
    } finally {
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      // #1797 / #1997: relay provider and vision events (assessment and
      // challenge) before the workspace goes.
      if (legWorkspace) relayLegProviderEvents(legWorkspace, deps.workspaceRoot, deps.appId, leg.id, new Date(ts));
      if (legWorkspace) {
        if (deps.keepLegWsp || keepForDiagnosis) {
          // #4243: a failed leg's workspace stays for diagnosis (its path is in leg.complete).
          log.write('info', 'leg.workspace-kept', deps.keepLegWsp
            ? `leg ${leg.id} workspace kept for debugging`
            : `leg ${leg.id} failed: workspace kept for diagnosis`, { leg_id: leg.id, path: legWorkspace, reason: deps.keepLegWsp ? 'keep_leg_wsp' : 'failed' });
        } else if (stallFired || outcome.status === 'cancelled') {
          // #2516: the child may still hold file handles; leave it to the OS temp sweep.
          log.write('warn', 'leg.workspace-cleanup-skipped',
            `leg ${leg.id}: workspace cleanup deferred (process may still be running)`, { leg_id: leg.id, path: legWorkspace });
        } else {
          // #2574: EBUSY/EPERM on Windows is transient; leave it to the OS temp sweep.
          // #4453: asynchronous, so the screen keeps its clock while a large work folder goes.
          status(`leg ${leg.id}: removing the leg work folder`);
          try {
            await rm(legWorkspace, { recursive: true, force: true });
          } catch (e: unknown) {
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== 'EBUSY' && code !== 'EPERM') throw e;
            log.write('warn', 'leg.workspace-cleanup-skipped',
              `Cannot delete leg workspace (${code}): left for OS cleanup`, { leg_id: leg.id, path: legWorkspace });
          } finally {
            status(null);
          }
        }
      }
    }
  };

  if (deps.execution === 'parallel') {
    await Promise.all(deps.legs.map((leg) => runOneLeg(leg)));
  } else {
    for (const leg of deps.legs) await runOneLeg(leg);
  }
  deps.signal?.removeEventListener('abort', onAbort);

  const legOutcomes = deps.legs.map((l) => outcomes.get(l.id)!);
  const completeLegs = legOutcomes.filter((o) => o.status === 'complete').length;
  const runStatus: LlmRunStatus = cancelled()
    ? 'cancelled'
    : completeLegs === legOutcomes.length ? 'complete'
      : completeLegs === 0 ? 'failed' : 'partial';
  const runLevel = runStatus === 'complete' ? 'info' : runStatus === 'failed' ? 'error' : 'warn';
  // #4290: the message counts every paid call, split into assessment and challenge calls.
  const statusMessage = (t: CallTotals): string => {
    const calls = `${t.call_count} calls (${t.assessment_calls} assessment, ${t.challenge_calls + t.lz_challenge_calls} challenge), cost ${runCostText(t)}`;
    return runStatus === 'complete'
      ? `LLM Assessment complete: ${calls} across ${deps.legs.length} legs`
      : `LLM Assessment ${runStatus}: ${completeLegs} of ${deps.legs.length} legs complete, ${calls}; the comparison is incomplete`;
  };

  // #4453: the synthesis names its step and the elapsed time on screen.
  const synthStartMs = Date.now();
  let synthStep = 'comparing the results';
  const synthStatus = (): void => status(`Synthesising: ${synthStep}, ${statusElapsed(Date.now() - synthStartMs)}`);
  // #4472: the synthesis is observable in the run log too (step changes and a tick every 15 s).
  const synthLog = (tick: boolean): void => {
    const elapsed_ms = Date.now() - synthStartMs;
    log.write('info', 'run.synthesis.progress', `synthesis: ${synthStep}, ${statusElapsed(elapsed_ms)}`, { step: synthStep, elapsed_ms, tick });
  };
  const synthTicker = setInterval(() => { synthStatus(); synthLog(true); }, statusTickMs());
  const enterSynthStep = async (step: string): Promise<void> => {
    synthStep = step;
    synthStatus();
    synthLog(false);
    // Yield so the screen renders the step before the next synchronous part.
    await new Promise<void>((r) => setImmediate(r));
  };

  // #2525: wrap entire synthesis phase so run.complete is always emitted even
  // if assembleGroups / finalResult / writeFileSync throws unexpectedly.
  try {
  await enterSynthStep('comparing the results');

  // Comparison (v1 groups) + persistence.
  // #4474: only complete legs are scored and ranked; a failed or cancelled leg
  // neither gets a score nor skews the min/max normalisation of the others.
  // It is listed in final.did_not_finish with its reason and completed calls.
  const scoredIds = legIds.filter((id) => outcomes.get(id)?.status === 'complete');
  const scoredSet = new Set(scoredIds);
  const groups = assembleGroups(allRecords.filter((r) => scoredSet.has(r.leg.id)), legStats, scoredIds);
  const final = finalResult(groups, deps.weights);
  const didNotFinish = didNotFinishOf(legOutcomes);
  if (Object.keys(didNotFinish).length > 0) final.did_not_finish = didNotFinish;
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
  // #2407: include run cost/duration metadata block for operator reporting.
  const runDurationMs = Date.now() - runStartMs;
  // #4290: totals from the sinks (assessment + challenge + LZ challenge calls).
  const legTotals = new Map(deps.legs.map((leg) => [leg.id, callTotals(readLegRecords(join(runDir, 'calls', `${legSlug(leg.id)}.ndjson`)))]));
  const runTotals = addTotals([...legTotals.values()]);
  const runBlock: Record<string, unknown> = {
    run_ts: ts,
    // #4243: run status and per-leg outcome (failed legs are named, never "complete").
    status: runStatus,
    ...(suite ? { suite } : {}),
    duration_minutes: Math.round(runDurationMs / 6000) / 10,
    ...runTotals,
    legs: Object.fromEntries(deps.legs.map((leg) => {
      const o = outcomes.get(leg.id)!;
      return [leg.id, {
        status: o.status,
        ...(o.reason ? { reason: o.reason } : {}),
        exit: o.exit,
        duration_minutes: Math.round(o.wall_clock_ms / 6000) / 10,
        ...legTotals.get(leg.id)!,
      }];
    })),
  };
  const pubModel: Record<string, unknown> = {
    schema_version: '1.0', kind: 'swao', app_id: deps.appId, created: ts,
    analysis_mode: manifest.analysis_mode, legs: manifestLegs, weights: final.weights,
    run: runBlock,
    final, groups, passGroups, challengePassGroups, lzChallengePassGroups, bucketViews, findings: findings.all(),
    verdicts: legVerdicts,
  };
  // #4323: why the C2 group is empty (one reason per skipped leg), for the publication.
  if (lzChallengeSkips.size > 0) {
    const reasons = [...new Set(lzChallengeSkips.values())];
    pubModel['lzChallengeSkip'] = {
      reason: reasons[0],
      message: reasons.map((r) => LZ_CHALLENGE_SKIP_MESSAGES[r]).join('; '),
      legs: Object.fromEntries(lzChallengeSkips),
    };
  }

  if (deps.interpretation && deps.interpretationConnector && completeLegs > 0) {
    await enterSynthStep('writing the summary narrative');
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

  await enterSynthStep('writing the run folder');
  writeFileSync(join(runDir, 'comparison', 'publication-model.json'), JSON.stringify(pubModel, null, 2), 'utf-8');
  findings.writeYaml(runDir);
  // #4243: the run folder says how the run ended (cancelled runs included).
  writeFileSync(join(runDir, 'status.json'), JSON.stringify({ status: runStatus, completed_at: new Date().toISOString(), legs: legOutcomes }, null, 2), 'utf-8');
  // Latest pointer inside the kind dir (092 s7: never wsp/latest.txt).
  writeFileSync(join(deps.workspaceRoot, 'llm-assessments', 'swao', 'latest.txt'), runTs + '\n', 'utf-8');
  // #2293: structured context fields; #4243: status, measured from run.start.
  const runCtx = {
    run_dir: runDir,
    status: runStatus,
    findings: findings.all().length,
    ...runTotals,
    leg_count: deps.legs.length,
    legs_complete: completeLegs,
    legs: legOutcomes.map((o) => ({ id: o.id, status: o.status, exit: o.exit, calls: o.calls, ...(o.reason ? { reason: o.reason } : {}) })),
    duration_ms: Date.now() - runStartMs,
  };
  logApp(deps.appId, runLevel, 'llm_assess.complete', statusMessage(runTotals), { context: runCtx });
  log.write(runLevel, 'run.complete', statusMessage(runTotals), runCtx);

  return {
    runDir, manifestPath, records: allRecords, groups, final, findingsCount: findings.all().length, status: runStatus, legs: legOutcomes,
    // #4372: measured USD per leg (cost cell) and the unpriced candidates (guidance).
    costUsd: legCostUsd(allRecords, deps.legs.map((l) => l.id)),
    // #4372: unpriced calls per leg (same records as costUsd) and the run totals.
    unpricedCalls: legUnpricedCalls(allRecords, deps.legs.map((l) => l.id)),
    totals: runTotals,
    unpriced: deps.legs.filter((l) => unpricedLegs.includes(l.id)).map((l) => ({ legId: l.id, message: unpricedMessage(l) })),
  };

  } catch (synthErr) {
    const errMsg = synthErr instanceof Error ? synthErr.message : String(synthErr);
    const errCtx = { run_dir: runDir, status: 'failed', error: errMsg, call_count: allRecords.length, leg_count: deps.legs.length, duration_ms: Date.now() - runStartMs };
    log.write('error', 'run.complete', `LLM Assessment synthesis failed: ${errMsg}`, errCtx);
    logApp(deps.appId, 'error', 'llm_assess.complete', `LLM Assessment synthesis failed: ${errMsg}`, { context: errCtx });
    throw synthErr;
  } finally {
    clearInterval(synthTicker);
    status(null);
  }
}

/** Discover legs still present in a run dir (used by tests + doctor). */
export function listRunDirs(workspaceRoot: string): string[] {
  const dir = join(workspaceRoot, 'llm-assessments', 'swao');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => /^\d{4}-/.test(d)).sort();
}
