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

// #3487: optional tool enrichment for Pass 26 (Design 117 section 10.1).
//
// Opt-in (`assessment.code_health.tools: [lizard, jscpd]`). Each requested tool
// is located and version-checked (@swao/core detectCodeHealthTools), then run
// through the injectable ToolRunner with a fixed argument vector:
//
//   lizard --csv --CCN 15 --ignore_warnings=-1 --input_file <tmp>/files.txt
//   jscpd --config <tmp>/jscpd.json --silent --absolute --reporters json
//         --output <tmp>/jscpd --min-lines 5 --min-tokens 50 --max-lines 100000
//         --max-size 1mb --mode mild --exitCode 0 --noSymlinks --ignore <fixed globs> -- <source>
//
// Both run with a SWAO-owned temp directory as working directory, so a
// `whitelizard.txt` or `package.json` in the scanned tree is not read, and
// jscpd gets an explicit (empty) config file, so the tree's `.jscpd.json` is
// not read either. lizard reads exactly the production files Pass 26
// measured (the list file); jscpd scans the source root and its results are
// filtered to the same files. Results are written under
// `assessment.code_health.tools`; the built-in metrics, KPIs, worklist and
// QUAL-01 to QUAL-07 are never changed by a tool result. jscpd code fragments
// are never stored. Paths are source-relative, lists sorted, no duration or
// temp path is recorded, so a rerun with the same tool versions is identical.

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CODE_HEALTH_TOOL_VERSIONS, formatVersionRange } from '@swao/core';
import type { DetectedCodeHealthTool, CodeHealthToolName, ToolRunner, ToolInvocation } from '@swao/core';

/** lizard's default warning threshold; functions above it are counted. */
export const LIZARD_CCN_THRESHOLD = 15;
/** jscpd thresholds (its defaults, passed explicitly so a config file cannot change them). */
export const JSCPD_MIN_LINES = 5;
export const JSCPD_MIN_TOKENS = 50;
/** Folders jscpd never scans (results are filtered to the measured files anyway). */
export const JSCPD_IGNORE = '**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/target/**,**/vendor/**,**/bower_components/**,**/coverage/**,**/*.min.js';
const MAX_NAME_LENGTH = 200;
const MAX_REASON_LENGTH = 300;

export type ToolRunStatus = 'complete' | 'absent' | 'unsupported_version' | 'failed' | 'timed_out';

interface ToolBase {
  status: ToolRunStatus;
  version: string | null;
  supported_range: string;
  /** Why the tool gave no result (status other than `complete`). */
  reason?: string;
}

export interface LizardFunctionEntry {
  file: string;
  function: string;
  start_line: number;
  end_line: number;
  ccn: number;
  nloc: number;
  parameters: number;
  evidence: string;
}

export interface LizardToolResult extends ToolBase {
  ccn_threshold?: number;
  files_analysed?: number;
  functions_analysed?: number;
  functions_over_threshold?: number;
  max_ccn?: number;
  average_ccn?: number;
  top_functions?: LizardFunctionEntry[];
}

export interface JscpdFileEntry {
  file: string;
  duplicated_lines: number;
  lines: number;
  clone_pairs: number;
}

export interface JscpdCloneEntry {
  format: string;
  lines: number;
  first: string;
  second: string;
}

export interface JscpdToolResult extends ToolBase {
  min_lines?: number;
  min_tokens?: number;
  files_analysed?: number;
  lines_analysed?: number;
  duplicated_lines?: number;
  duplication_pct?: number;
  clone_pairs?: number;
  top_files?: JscpdFileEntry[];
  top_clones?: JscpdCloneEntry[];
}

export interface CodeHealthToolsBlock {
  requested: CodeHealthToolName[];
  jscpd?: JscpdToolResult;
  lizard?: LizardToolResult;
}

export interface ToolEnrichmentInput {
  /** Source root as given to the pass. */
  sourcePath: string;
  /** Measured production code files: source-relative path to absolute path. */
  files: ReadonlyArray<{ rel: string; abs: string }>;
  requested: readonly CodeHealthToolName[];
  topN: number;
  timeoutMs: number;
  runner: ToolRunner;
  detect: (names: readonly CodeHealthToolName[]) => Promise<DetectedCodeHealthTool[]>;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
}

/** Path key for matching tool output to measured files (separators and, on Windows, case folded). */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? s.toLowerCase() : s;
}

function realOrSelf(p: string): string {
  try { return realpathSync.native(p); } catch { return p; }
}

/** Map from every spelling of a measured file (as given, real path) to its relative path. */
function fileIndex(files: ToolEnrichmentInput['files']): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    m.set(pathKey(f.abs), f.rel);
    m.set(pathKey(realOrSelf(f.abs)), f.rel);
  }
  return m;
}

// ---------------------------------------------------------------------------
// lizard
// ---------------------------------------------------------------------------

/** One CSV record (RFC 4180 quoting, `""` escapes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const INT_RE = /^\d{1,9}$/;

export interface LizardRow {
  nloc: number;
  ccn: number;
  parameters: number;
  file: string;
  function: string;
  start: number;
  end: number;
}

/**
 * lizard `--csv` rows: NLOC, CCN, token, PARAM, length, location, file,
 * function, long_name, start, end (no header in 1.17). Rows that do not fit
 * are counted as malformed and skipped.
 */
export function parseLizardCsv(stdout: string): { rows: LizardRow[]; malformed: number } {
  const rows: LizardRow[] = [];
  let malformed = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const f = parseCsvLine(line);
    const n = f.length;
    if (n < 11) { malformed++; continue; }
    const head = f.slice(0, 5);
    const start = f[n - 2] as string;
    const end = f[n - 1] as string;
    if (head[0] === 'NLOC') continue; // a header row, should a later version print one
    if (!head.every((x) => INT_RE.test(x)) || !INT_RE.test(start) || !INT_RE.test(end)) { malformed++; continue; }
    rows.push({
      nloc: Number(head[0]),
      ccn: Number(head[1]),
      parameters: Number(head[3]),
      file: f[6] as string,
      function: f[7] as string,
      start: Number(start),
      end: Number(end),
    });
  }
  return { rows, malformed };
}

export function summariseLizard(
  rows: LizardRow[],
  index: Map<string, string>,
  topN: number,
): Omit<LizardToolResult, 'status' | 'version' | 'supported_range'> {
  const inScope: Array<LizardRow & { rel: string }> = [];
  for (const r of rows) {
    const rel = index.get(pathKey(r.file));
    if (rel !== undefined) inScope.push({ ...r, rel });
  }
  const files = new Set(inScope.map((r) => r.rel));
  const total = inScope.reduce((s, r) => s + r.ccn, 0);
  const sorted = inScope.slice().sort((a, b) => b.ccn - a.ccn || b.nloc - a.nloc || cmp(a.rel, b.rel) || a.start - b.start || cmp(a.function, b.function));
  return {
    ccn_threshold: LIZARD_CCN_THRESHOLD,
    files_analysed: files.size,
    functions_analysed: inScope.length,
    functions_over_threshold: inScope.filter((r) => r.ccn > LIZARD_CCN_THRESHOLD).length,
    max_ccn: sorted[0]?.ccn ?? 0,
    average_ccn: inScope.length > 0 ? round1(total / inScope.length) : 0,
    top_functions: sorted.slice(0, topN).map((r) => ({
      file: r.rel,
      function: clip(r.function, MAX_NAME_LENGTH),
      start_line: r.start,
      end_line: r.end,
      ccn: r.ccn,
      nloc: r.nloc,
      parameters: r.parameters,
      evidence: `${r.rel}:${r.start}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// jscpd
// ---------------------------------------------------------------------------

interface JscpdLoc { name?: unknown; start?: unknown; end?: unknown }

function asRec(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function posInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/**
 * jscpd `--reporters json` report (`jscpd-report.json`): per-source line
 * counts under statistics.formats.<format>.sources and clone pairs under
 * duplicates (firstFile / secondFile with name, start, end). Returns null when
 * the document does not have that shape.
 */
export function summariseJscpd(
  report: unknown,
  index: Map<string, string>,
  topN: number,
): Omit<JscpdToolResult, 'status' | 'version' | 'supported_range'> | null {
  const doc = asRec(report);
  const stats = asRec(doc?.['statistics']);
  const formats = asRec(stats?.['formats']);
  const duplicates = doc?.['duplicates'];
  if (!doc || !formats || !Array.isArray(duplicates)) return null;

  const lines = new Map<string, number>();
  for (const fmt of Object.values(formats)) {
    const sources = asRec(asRec(fmt)?.['sources']);
    if (!sources) continue;
    for (const [name, s] of Object.entries(sources)) {
      const rel = index.get(pathKey(name));
      const l = posInt(asRec(s)?.['lines']);
      if (rel !== undefined && l !== undefined) lines.set(rel, (lines.get(rel) ?? 0) + l);
    }
  }

  const ranges = new Map<string, Array<[number, number]>>();
  const pairsPerFile = new Map<string, number>();
  const clones: JscpdCloneEntry[] = [];
  const side = (loc: unknown): { rel: string; start: number; end: number } | null => {
    const l = asRec(loc) as JscpdLoc | undefined;
    if (!l || typeof l.name !== 'string') return null;
    const rel = index.get(pathKey(l.name));
    const start = posInt(l.start);
    const end = posInt(l.end);
    if (rel === undefined || start === undefined || end === undefined || end < start) return null;
    return { rel, start, end };
  };
  for (const d of duplicates) {
    const dup = asRec(d);
    const a = side(dup?.['firstFile']);
    const b = side(dup?.['secondFile']);
    if (!a || !b) continue; // production-to-production clones only (same scope as the built-in metric)
    for (const s of [a, b]) {
      const list = ranges.get(s.rel) ?? [];
      list.push([s.start, s.end]);
      ranges.set(s.rel, list);
    }
    pairsPerFile.set(a.rel, (pairsPerFile.get(a.rel) ?? 0) + 1);
    if (b.rel !== a.rel) pairsPerFile.set(b.rel, (pairsPerFile.get(b.rel) ?? 0) + 1);
    const [first, second] = cmp(`${a.rel}:${a.start}`, `${b.rel}:${b.start}`) <= 0 ? [a, b] : [b, a];
    clones.push({
      format: typeof dup?.['format'] === 'string' ? clip(dup['format'] as string, 40) : 'unknown',
      lines: posInt(dup?.['lines']) ?? Math.max(a.end - a.start + 1, b.end - b.start + 1),
      first: `${first.rel}:${first.start}-${first.end}`,
      second: `${second.rel}:${second.start}-${second.end}`,
    });
  }

  const dupLines = new Map<string, number>();
  for (const [rel, list] of ranges) {
    list.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    // Union of the line ranges, so overlapping clones count each line once.
    let total = 0;
    let cur: [number, number] | null = null;
    for (const [s, e] of list) {
      if (cur === null) cur = [s, e];
      else if (s <= cur[1] + 1) cur[1] = Math.max(cur[1], e);
      else { total += cur[1] - cur[0] + 1; cur = [s, e]; }
    }
    if (cur !== null) total += cur[1] - cur[0] + 1;
    // Ranges are physical lines, jscpd's `lines` count code lines: cap at the file's count.
    const fileLines = lines.get(rel);
    dupLines.set(rel, fileLines !== undefined && fileLines > 0 ? Math.min(total, fileLines) : total);
  }

  const linesAnalysed = [...lines.values()].reduce((s, n) => s + n, 0);
  const duplicated = [...dupLines.values()].reduce((s, n) => s + n, 0);
  const topFiles: JscpdFileEntry[] = [...dupLines.entries()]
    .map(([file, d]) => ({ file, duplicated_lines: d, lines: lines.get(file) ?? 0, clone_pairs: pairsPerFile.get(file) ?? 0 }))
    .sort((x, y) => y.duplicated_lines - x.duplicated_lines || cmp(x.file, y.file))
    .slice(0, topN);
  const topClones = clones
    .sort((x, y) => y.lines - x.lines || cmp(x.first, y.first) || cmp(x.second, y.second))
    .slice(0, topN);
  return {
    min_lines: JSCPD_MIN_LINES,
    min_tokens: JSCPD_MIN_TOKENS,
    files_analysed: lines.size,
    lines_analysed: linesAnalysed,
    duplicated_lines: duplicated,
    duplication_pct: linesAnalysed > 0 ? round1((duplicated * 100) / linesAnalysed) : 0,
    clone_pairs: clones.length,
    top_files: topFiles,
    top_clones: topClones,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function notRun(d: DetectedCodeHealthTool): ToolBase {
  switch (d.status) {
    case 'absent':
      return { status: 'absent', version: null, supported_range: d.supported_range, reason: `${d.name} not found (install ${installHint(d.name)}).` };
    case 'unsupported_version':
      return {
        status: 'unsupported_version',
        version: d.version,
        supported_range: d.supported_range,
        reason: `${d.name} ${d.version ?? '(version unknown)'} is outside the supported range ${d.supported_range}; not run.`,
      };
    case 'present':
      return { status: 'failed', version: d.version, supported_range: d.supported_range, reason: 'internal: tool present but not run' };
    default: {
      const never: never = d.status;
      throw new Error(`unknown tool status: ${String(never)}`);
    }
  }
}

export function installHint(name: CodeHealthToolName): string {
  switch (name) {
    case 'lizard': return 'pip install "lizard>=1.17,<1.18"';
    case 'jscpd': return 'npm install -g jscpd@4';
    default: {
      const never: never = name;
      throw new Error(`unknown code health tool: ${String(never)}`);
    }
  }
}

function failure(d: DetectedCodeHealthTool, r: { timedOut: boolean; spawnError: string | null; exitCode: number | null; stderr: string }, timeoutMs: number): ToolBase {
  if (r.timedOut) {
    return { status: 'timed_out', version: d.version, supported_range: d.supported_range, reason: `${d.name} did not finish within ${Math.round(timeoutMs / 1000)} s (assessment.code_health.tool_timeout_seconds); the process tree was stopped.` };
  }
  const detail = r.spawnError ?? `exit code ${String(r.exitCode)}${r.stderr.trim() ? `: ${r.stderr.trim()}` : ''}`;
  return { status: 'failed', version: d.version, supported_range: d.supported_range, reason: clip(`${d.name} failed (${detail}).`, MAX_REASON_LENGTH) };
}

/** Replace absolute temp / source paths (either separator) with placeholders. */
export function scrubPaths(text: string, paths: ReadonlyArray<string | null>): string {
  let out = text;
  paths.forEach((p, i) => {
    if (!p) return;
    const label = i === 0 ? '<tmp>' : '<source>';
    for (const variant of new Set([p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')])) {
      out = out.split(variant).join(label);
    }
  });
  return out;
}

function argsFor(inv: ToolInvocation, rest: string[]): string[] {
  return [...inv.prefixArgs, ...rest];
}

async function runLizard(d: DetectedCodeHealthTool, input: ToolEnrichmentInput, work: string, index: Map<string, string>): Promise<LizardToolResult> {
  const inv = d.invocation as ToolInvocation;
  const listFile = join(work, 'files.txt');
  // File names with a line break cannot be listed one per line; they are left out.
  const listed = input.files.filter((f) => !/[\r\n]/.test(f.abs));
  writeFileSync(listFile, listed.map((f) => f.abs).join('\n') + '\n', 'utf-8');
  const r = await input.runner({
    command: inv.command,
    args: argsFor(inv, ['--csv', '--CCN', String(LIZARD_CCN_THRESHOLD), '--ignore_warnings=-1', '--input_file', listFile]),
    cwd: work,
    timeoutMs: input.timeoutMs,
  });
  if (r.timedOut || r.spawnError !== null || r.exitCode !== 0) return failure(d, r, input.timeoutMs);
  const { rows, malformed } = parseLizardCsv(r.stdout);
  if (rows.length === 0 && malformed > 0) {
    return { status: 'failed', version: d.version, supported_range: d.supported_range, reason: `lizard output could not be parsed (${malformed} malformed line(s)); no result recorded.` };
  }
  return { status: 'complete', version: d.version, supported_range: d.supported_range, ...summariseLizard(rows, index, input.topN) };
}

async function runJscpd(d: DetectedCodeHealthTool, input: ToolEnrichmentInput, work: string, index: Map<string, string>): Promise<JscpdToolResult> {
  const inv = d.invocation as ToolInvocation;
  const cfg = join(work, 'jscpd.json');
  const outDir = join(work, 'jscpd');
  writeFileSync(cfg, '{}\n', 'utf-8');
  // jscpd's file finder needs forward slashes on Windows (a backslash path silently finds nothing).
  const root = realOrSelf(input.sourcePath).replace(/\\/g, '/');
  const r = await input.runner({
    command: inv.command,
    args: argsFor(inv, [
      '--config', cfg, '--silent', '--absolute', '--reporters', 'json', '--output', outDir,
      '--min-lines', String(JSCPD_MIN_LINES), '--min-tokens', String(JSCPD_MIN_TOKENS),
      '--max-lines', '100000', '--max-size', '1mb', '--mode', 'mild', '--exitCode', '0', '--noSymlinks',
      '--ignore', JSCPD_IGNORE, '--', root,
    ]),
    cwd: work,
    timeoutMs: input.timeoutMs,
  });
  if (r.timedOut || r.spawnError !== null || r.exitCode !== 0) return failure(d, r, input.timeoutMs);
  const reportPath = join(outDir, 'jscpd-report.json');
  if (!existsSync(reportPath)) {
    return { status: 'failed', version: d.version, supported_range: d.supported_range, reason: 'jscpd wrote no report (jscpd-report.json missing); no result recorded.' };
  }
  let report: unknown;
  try { report = JSON.parse(readFileSync(reportPath, 'utf-8')); } catch {
    return { status: 'failed', version: d.version, supported_range: d.supported_range, reason: 'jscpd report is not valid JSON; no result recorded.' };
  }
  const summary = summariseJscpd(report, index, input.topN);
  if (!summary) {
    return { status: 'failed', version: d.version, supported_range: d.supported_range, reason: 'jscpd report has an unexpected shape; no result recorded.' };
  }
  return { status: 'complete', version: d.version, supported_range: d.supported_range, ...summary };
}

/** Run every requested tool; never throws (a failure is a recorded status). */
export async function runCodeHealthTools(input: ToolEnrichmentInput): Promise<CodeHealthToolsBlock> {
  const requested = [...input.requested];
  const block: CodeHealthToolsBlock = { requested };
  if (requested.length === 0) return block;
  let detected: DetectedCodeHealthTool[];
  try {
    detected = await input.detect(requested);
  } catch {
    // Detection never throws in production; a fake that does counts as absent.
    detected = requested.map((name) => ({ name, status: 'absent' as const, version: null, supported_range: formatVersionRange(CODE_HEALTH_TOOL_VERSIONS[name]), invocation: null }));
  }
  const index = fileIndex(input.files);
  let work: string | null = null;
  try {
    try { work = mkdtempSync(join(tmpdir(), 'swao-code-health-')); } catch { work = null; }
    // Requested order (canonical: jscpd, lizard), whatever order detection answered in.
    for (const name of requested) {
      const d: DetectedCodeHealthTool = detected.find((x) => x.name === name)
        ?? { name, status: 'absent', version: null, supported_range: formatVersionRange(CODE_HEALTH_TOOL_VERSIONS[name]), invocation: null };
      if (d.status !== 'present' || !d.invocation) {
        block[d.name] = notRun(d);
        continue;
      }
      if (work === null) {
        block[d.name] = { status: 'failed', version: d.version, supported_range: d.supported_range, reason: `${d.name} not run: no temporary working directory could be created.` };
        continue;
      }
      try {
        switch (d.name) {
          case 'lizard': block.lizard = await runLizard(d, input, work, index); break;
          case 'jscpd': block.jscpd = await runJscpd(d, input, work, index); break;
          default: {
            const never: never = d.name;
            throw new Error(`unknown code health tool: ${String(never)}`);
          }
        }
      } catch (err) {
        block[d.name] = { status: 'failed', version: d.version, supported_range: d.supported_range, reason: clip(`${d.name} failed (${err instanceof Error ? err.message : String(err)}).`, MAX_REASON_LENGTH) };
      }
    }
  } finally {
    if (work) { try { rmSync(work, { recursive: true, force: true }); } catch { /* temp clean-up is best effort */ } }
  }
  // Failure reasons quote tool stderr: keep temp and source paths out of the WSP.
  for (const name of requested) {
    const t = block[name];
    if (t?.reason) t.reason = scrubPaths(t.reason, [work, input.sourcePath, realOrSelf(input.sourcePath)]);
  }
  return block;
}
