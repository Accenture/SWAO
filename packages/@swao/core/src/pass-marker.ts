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

// #4267 (Design 098 section 4.1): the stdout pass markers of `swao assess`.
// A process that runs `swao assess` as a child (the TUI Assess screen) reads
// `[pass-start]` and `[pass-done]` lines to write assess.app.pass.* events
// keyed exactly like the engine assessment.pass.* events (pass key, name,
// pass_id, run_id, duration). The markers are opt-in: written only when the
// parent sets SWAO_PASS_MARKERS=1 in the child env, so an operator terminal,
// a CI log, the MCP tool output and every other screen that spawns
// `swao assess` without reading the markers never see them.
//
// Format: `[pass-start] num=01 key=inv name=inventory pass_id=<id> run_id=<id>`
//         `[pass-done] num=01 key=inv name=inventory pass_id=<id> run_id=<id> status=ok duration_ms=12 signals=7`
// Values never contain spaces. The lines do not match the operator line
// patterns `Pass NN, name` or `[ok] Pass NN` the TUI counts passes by (#4402).

export type PassMarkerKind = 'start' | 'done';

export interface PassMarker {
  kind: PassMarkerKind;
  /** Pass number, two digits (`01`, `10`, `23`). */
  num: string;
  /** Canonical pass key (`inv`, `dynamic`, `lzr`), as in assessment.pass.* context.pass. */
  key: string;
  /** Canonical pass name (`inventory`), no punctuation. */
  name: string;
  /** Same value as the engine assessment.pass.* pass_id. */
  pass_id: string;
  run_id?: string;
  /** done only: `ok`, `skip` (not applicable) or `degraded`. */
  status?: string;
  /** done only. */
  duration_ms?: number;
  /** done only. */
  signals?: number;
}

const TAG: Record<PassMarkerKind, string> = { start: '[pass-start]', done: '[pass-done]' };

function clean(v: string): string {
  return v.replace(/\s+/g, '_');
}

/** One marker line (no trailing newline). */
export function formatPassMarker(m: PassMarker): string {
  const parts = [TAG[m.kind], `num=${clean(m.num)}`, `key=${clean(m.key)}`, `name=${clean(m.name)}`, `pass_id=${clean(m.pass_id)}`];
  if (m.run_id) parts.push(`run_id=${clean(m.run_id)}`);
  if (m.kind === 'done') {
    if (m.status) parts.push(`status=${clean(m.status)}`);
    if (typeof m.duration_ms === 'number') parts.push(`duration_ms=${Math.max(0, Math.round(m.duration_ms))}`);
    if (typeof m.signals === 'number') parts.push(`signals=${m.signals}`);
  }
  return parts.join(' ');
}

const MARKER_RE = /^\s*\[pass-(start|done)\]((?:\s+[a-z_]+=\S*)*)\s*$/;

/** Parse one line; null when it is not a pass marker. */
export function parsePassMarker(line: string): PassMarker | null {
  const m = MARKER_RE.exec(line);
  if (!m) return null;
  const f: Record<string, string> = {};
  for (const tok of (m[2] ?? '').trim().split(/\s+/)) {
    const eq = tok.indexOf('=');
    if (eq > 0) f[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  if (!f['num'] || !f['key'] || !f['pass_id']) return null;
  const out: PassMarker = {
    kind: m[1] === 'start' ? 'start' : 'done',
    num: f['num'],
    key: f['key'],
    name: f['name'] || f['key'],
    pass_id: f['pass_id'],
  };
  if (f['run_id']) out.run_id = f['run_id'];
  if (f['status']) out.status = f['status'];
  const dur = Number(f['duration_ms']);
  if (f['duration_ms'] !== undefined && Number.isFinite(dur)) out.duration_ms = dur;
  const sig = Number(f['signals']);
  if (f['signals'] !== undefined && Number.isFinite(sig)) out.signals = sig;
  return out;
}

/** True when `swao assess` writes the markers: the parent opted in with SWAO_PASS_MARKERS=1. */
export function passMarkersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['SWAO_PASS_MARKERS'] === '1';
}

// #4402 (CLAUDE.md section 5.1): the operator pass lines of `swao assess` name
// the pass as "Pass 04, context_ingestion" (no spaced double hyphen):
//   `[info] Running Pass 04, context_ingestion...`
//   `[ok]  Pass 04, context_ingestion  5 signals  ->  wsp/runs/<id>/passes/04-ctx.yaml  [22s]`
//   `[progress] Pass 11, BSI_C5 (3/7)`
// The CLI writes the label through `passLabel`; every reader (the Application
// Assessment and Service Portfolio screens, the pass-line tracker) parses it
// through the functions below. The parsers also accept the earlier form
// "Pass 04 -- name", so an older child binary keeps the progress bar working.

/** The pass label of the operator lines: `Pass 04, context_ingestion`. */
export function passLabel(num: string | number, name: string): string {
  return `Pass ${String(num)}, ${name}`;
}

/** The separator between pass number and name: a comma (current) or a spaced double hyphen (before #4402). */
const LABEL_G = /Pass (\d+)(?:,|\s+--)\s+(\S+)/gi;
const OK_G = /\[ok\]\s+Pass\s+(\d+)(?:,|\s+--)\s+(\S+)/gi;
const RUNNING_RE = /\[info\]\s+Running Pass (\d+)(?:,|\s+--)\s+(\S+)/i;
const RESULT_RE = /\[(ok|skip|fail)\]\s+Pass\s+(\d+)(?:,|\s+--)\s+(\S+)/i;
const PROGRESS_RE = /\[progress\] Pass (\d+)(?:,|\s+--)\s+(\S+) \((\d+)\/(\d+)\)/;

/** A pass named in an operator line. `name` is cleaned of trailing punctuation (dots, commas, colons). */
export interface PassLineRef {
  num: string;
  name: string;
}

/** Drops trailing `.,:;` without a regex (CodeQL js/polynomial-redos on a `+$` pattern). */
function trimTrailingPunct(s: string): string {
  let end = s.length;
  while (end > 0 && '.,:;'.includes(s.charAt(end - 1))) end--;
  return s.slice(0, end);
}

/** `[info] Running Pass NN, name...`: the pass that starts, or null. */
export function parsePassRunningLine(line: string): PassLineRef | null {
  const m = RUNNING_RE.exec(line);
  return m ? { num: m[1] ?? '', name: trimTrailingPunct(m[2] ?? '') } : null;
}

/** `[ok]  Pass NN, name ...` (also `[skip]`, `[fail]`): the finished pass and its status, or null. */
export function parsePassResultLine(line: string): (PassLineRef & { status: 'ok' | 'skip' | 'fail' }) | null {
  const m = RESULT_RE.exec(line);
  if (!m) return null;
  const status = (m[1] ?? 'ok').toLowerCase() as 'ok' | 'skip' | 'fail';
  return { status, num: m[2] ?? '', name: trimTrailingPunct(m[3] ?? '') };
}

/** `[progress] Pass 11, BSI_C5 (3/7)`: the sub-progress of a long pass, or null. */
export function parsePassProgressLine(text: string): { num: string; label: string; done: number; total: number } | null {
  const m = PROGRESS_RE.exec(text);
  if (!m) return null;
  return { num: m[1] ?? '', label: m[2] ?? '', done: parseInt(m[3] ?? '0', 10), total: parseInt(m[4] ?? '0', 10) };
}

/** Every pass label in a chunk of output, in order (a chunk can hold several lines). */
export function passLabelsIn(text: string): PassLineRef[] {
  return [...text.matchAll(LABEL_G)].map((m) => ({ num: m[1] ?? '', name: trimTrailingPunct(m[2] ?? '') }));
}

/** Passes completed in a chunk: one `[ok]  Pass NN, name` line each. */
export function countPassOkLines(text: string): number {
  return [...text.matchAll(OK_G)].length;
}
