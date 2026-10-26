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

/**
 * #3478: the safe client-config writer behind `swao mcp install --client`
 * (Design 116 REQ-13.4, F-14). Every MCP client target goes through it:
 *
 * - parse or refuse: a file that is not strict JSON is never rewritten (JSON
 *   with comments or trailing commas is refused with a clear message rather
 *   than stripped);
 * - merge: only the SWAO server entry changes, by a text edit at its exact
 *   position, so every other byte (key order, indentation, line endings, BOM)
 *   stays as it was and install followed by uninstall restores the file
 *   byte for byte;
 * - an existing SWAO key is matched case-insensitively and updated in place;
 * - backup `<file>.swao-backup-<UTC timestamp>` before any write or delete;
 * - atomic write: temp file in the same folder, then rename (retried briefly
 *   on Windows while another process holds the target open, #3491);
 * - idempotent: an identical run reports "no change" and touches nothing;
 * - dry run: a diff, nothing written (no backup, temp file or folder).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

// ---------------------------------------------------------------------------
// Strict JSON scanning (positions only; JSON.parse has already validated)
// ---------------------------------------------------------------------------

interface MemberSpan {
  key: string;
  keyStart: number;
  valueStart: number;
  /** Index after the value. */
  valueEnd: number;
}

interface ObjectSpan {
  /** Index of `{`. */
  start: number;
  /** Index after `}`. */
  end: number;
  members: MemberSpan[];
}

function skipWs(t: string, i: number): number {
  while (i < t.length && (t[i] === ' ' || t[i] === '\t' || t[i] === '\n' || t[i] === '\r')) i++;
  return i;
}

function skipString(t: string, i: number): number {
  // t[i] === '"'
  i++;
  while (i < t.length) {
    const c = t[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    i++;
  }
  return i;
}

function skipValue(t: string, i: number): number {
  const c = t[i];
  if (c === '"') return skipString(t, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    while (i < t.length) {
      const d = t[i];
      if (d === '"') { i = skipString(t, i); continue; }
      if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    return i;
  }
  while (i < t.length && !/[\s,}\]]/.test(t[i] ?? '')) i++;
  return i;
}

function scanObject(t: string, start: number): ObjectSpan {
  const members: MemberSpan[] = [];
  let i = skipWs(t, start + 1);
  while (i < t.length && t[i] !== '}') {
    const keyStart = i;
    const keyEnd = skipString(t, i);
    const key = JSON.parse(t.slice(keyStart, keyEnd)) as string;
    i = skipWs(t, keyEnd);
    i = skipWs(t, i + 1); // ':'
    const valueStart = i;
    const valueEnd = skipValue(t, i);
    members.push({ key, keyStart, valueStart, valueEnd });
    i = skipWs(t, valueEnd);
    if (t[i] === ',') i = skipWs(t, i + 1);
  }
  return { start, end: i + 1, members };
}

function lineStart(t: string, i: number): number {
  const n = t.lastIndexOf('\n', i - 1);
  return n < 0 ? 0 : n + 1;
}

function onlyWs(s: string): boolean {
  return /^[ \t]*$/.test(s);
}

function indentAt(t: string, i: number): string {
  const ls = lineStart(t, i);
  const m = /^[ \t]*/.exec(t.slice(ls, i));
  return m ? m[0] : '';
}

/** Index after the end of the line containing i (after `\n`), or the text end. */
function afterLineEnd(t: string, i: number): number {
  const n = t.indexOf('\n', i);
  return n < 0 ? t.length : n + 1;
}

interface Layout {
  eol: string;
  unit: string;
}

function detectLayout(t: string, root: ObjectSpan): Layout {
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  let unit = '  ';
  const first = root.members[0];
  if (first && onlyWs(t.slice(lineStart(t, first.keyStart), first.keyStart))) {
    const ind = indentAt(t, first.keyStart).slice(indentAt(t, root.start).length);
    if (ind.length > 0) unit = ind;
  }
  return { eol, unit };
}

function serialise(value: unknown, layout: Layout, indent: string): string {
  return JSON.stringify(value, null, layout.unit).split('\n').join(layout.eol + indent);
}

interface Edit { at: number; del: number; text: string }

function applyEdits(t: string, edits: Edit[]): string {
  let out = t;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.del);
  return out;
}

/** Edits that add `key: value` as the last member of obj, in the layout of the file. */
function insertMemberEdits(t: string, obj: ObjectSpan, key: string, value: unknown, layout: Layout): Edit[] {
  const objIndent = indentAt(t, obj.start);
  const close = obj.end - 1;
  const last = obj.members[obj.members.length - 1];
  if (!last) {
    const memberIndent = objIndent + layout.unit;
    const text = `{${layout.eol}${memberIndent}${JSON.stringify(key)}: ${serialise(value, layout, memberIndent)}${layout.eol}${objIndent}}`;
    return [{ at: obj.start, del: obj.end - obj.start, text }];
  }
  const tail = t.slice(last.valueEnd, close);
  const closeOnOwnLine = onlyWs(t.slice(lineStart(t, close), close));
  if (tail.includes('\n') && closeOnOwnLine) {
    const memberIndent = onlyWs(t.slice(lineStart(t, last.keyStart), last.keyStart)) ? indentAt(t, last.keyStart) : objIndent + layout.unit;
    return [
      { at: last.valueEnd, del: 0, text: ',' },
      { at: lineStart(t, close), del: 0, text: `${memberIndent}${JSON.stringify(key)}: ${serialise(value, layout, memberIndent)}${layout.eol}` },
    ];
  }
  // Single-line object: compact insertion right after the last value.
  const spaced = /:\s/.test(t.slice(last.keyStart, last.valueStart));
  return [{ at: last.valueEnd, del: 0, text: `,${spaced ? ' ' : ''}${JSON.stringify(key)}:${spaced ? ' ' : ''}${JSON.stringify(value)}` }];
}

/** Edits that remove member index idx of obj (the reverse of insertMemberEdits for the last member). */
function removeMemberEdits(t: string, obj: ObjectSpan, idx: number): Edit[] {
  const m = obj.members[idx];
  if (!m) return [];
  const prev = obj.members[idx - 1];
  const next = obj.members[idx + 1];
  const lineClean = onlyWs(t.slice(lineStart(t, m.keyStart), m.keyStart));
  if (!next) {
    if (!prev) {
      // Only member: leave an empty object.
      return [{ at: obj.start, del: obj.end - obj.start, text: '{}' }];
    }
    const comma = t.indexOf(',', prev.valueEnd);
    const between = t.slice(prev.valueEnd, m.keyStart);
    if (lineClean && between.includes('\n') && onlyWs(t.slice(m.valueEnd, afterLineEnd(t, m.valueEnd)).replace(/\r?\n$/, ''))) {
      return [
        { at: comma, del: 1, text: '' },
        { at: lineStart(t, m.keyStart), del: afterLineEnd(t, m.valueEnd) - lineStart(t, m.keyStart), text: '' },
      ];
    }
    return [{ at: prev.valueEnd, del: m.valueEnd - prev.valueEnd, text: '' }];
  }
  if (lineClean && onlyWs(t.slice(lineStart(t, next.keyStart), next.keyStart))) {
    return [{ at: lineStart(t, m.keyStart), del: lineStart(t, next.keyStart) - lineStart(t, m.keyStart), text: '' }];
  }
  return [{ at: m.keyStart, del: next.keyStart - m.keyStart, text: '' }];
}

// ---------------------------------------------------------------------------
// JSON entry plans
// ---------------------------------------------------------------------------

/** Where the SWAO entry lives: `container` (for example `mcpServers`) in the root object. */
export interface JsonEntryTarget {
  path: string;
  container: string;
  /** Key for a new entry. */
  defaultKey: string;
  /**
   * Picks the existing SWAO entry among the container keys. Default: the
   * first key equal to `swao` ignoring case (operators registered `SWAO`).
   */
  findKey?: (servers: Record<string, unknown>) => string | undefined;
  /**
   * Fields SWAO owns in its entry. When set, an existing entry keeps every
   * other field (for example `env` added by the operator) and only these are
   * replaced; when unset, the entry is replaced whole.
   */
  ownedFields?: ReadonlyArray<string>;
}

function mergeOwned(existing: unknown, value: unknown, owned: ReadonlyArray<string> | undefined): unknown {
  if (!owned || existing === null || typeof existing !== 'object' || Array.isArray(existing)) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const kept = Object.fromEntries(Object.entries(existing as Record<string, unknown>).filter(([k]) => !owned.includes(k)));
  // Owned fields first in SWAO's order, operator fields after.
  return { ...(value as Record<string, unknown>), ...kept };
}

export type FilePlan =
  | { kind: 'refuse'; path: string; reason: string }
  | {
      kind: 'change';
      path: string;
      /** File text before (null: the file does not exist). */
      before: string | null;
      /** File text after (null: delete the file). */
      after: string | null;
      /** The server key written or removed (agent templates use it). */
      key?: string;
    };

/** Default SWAO entry match: case-insensitive `swao`. */
export function findSwaoKeyCaseInsensitive(servers: Record<string, unknown>): string | undefined {
  return Object.keys(servers).find((k) => k.toLowerCase() === 'swao');
}

const BOM = String.fromCharCode(0xfeff);

function readText(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

/**
 * Reads the server map `container` of a JSON file for detection only (never
 * written here): undefined when the file is missing, not strict JSON, or holds
 * no such object.
 */
export function readJsonServers(path: string, container: string): Record<string, unknown> | undefined {
  const raw = readText(path);
  if (raw === null) return undefined;
  try {
    const data = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw) as Record<string, unknown> | null;
    const servers = data && typeof data === 'object' ? data[container] : undefined;
    return servers && typeof servers === 'object' && !Array.isArray(servers) ? (servers as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Structural equality (key order ignored). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  return ak.length === Object.keys(bo).length && ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

interface ParsedJson {
  text: string;
  bom: boolean;
  root: ObjectSpan;
  data: Record<string, unknown>;
}

function parseJsonFile(path: string, raw: string): ParsedJson | { refuse: string } {
  const bom = raw.startsWith(BOM);
  const text = bom ? raw.slice(1) : raw;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const hint = /\/\/|\/\*/.test(text) ? ' The file contains comments; SWAO does not rewrite JSON with comments. Add the entry by hand or remove the comments.' : '';
    return { refuse: `${path} is not valid JSON (${(e as Error).message}); nothing was changed.${hint}` };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { refuse: `${path} does not hold a JSON object; nothing was changed.` };
  }
  return { text, bom, root: scanObject(text, skipWs(text, 0)), data: data as Record<string, unknown> };
}

/** Plans writing `value` as the SWAO entry of target (parse or refuse, merge, update in place). */
export function planJsonEntryUpsert(target: JsonEntryTarget, value: unknown): FilePlan {
  const raw = readText(target.path);
  if (raw === null || raw.replace(BOM, '').trim() === '') {
    const after = JSON.stringify({ [target.container]: { [target.defaultKey]: value } }, null, 2) + '\n';
    return { kind: 'change', path: target.path, before: raw, after, key: target.defaultKey };
  }
  const parsed = parseJsonFile(target.path, raw);
  if ('refuse' in parsed) return { kind: 'refuse', path: target.path, reason: parsed.refuse };
  const { text, root, data } = parsed;
  const layout = detectLayout(text, root);
  const servers = data[target.container];
  const containerMember = root.members.find((m) => m.key === target.container);
  let edits: Edit[];
  let key = target.defaultKey;
  if (servers === undefined || !containerMember) {
    edits = insertMemberEdits(text, root, target.container, { [key]: value }, layout);
  } else {
    if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
      return { kind: 'refuse', path: target.path, reason: `${target.path}: "${target.container}" is not a JSON object; nothing was changed.` };
    }
    const serverMap = servers as Record<string, unknown>;
    const existing = (target.findKey ?? findSwaoKeyCaseInsensitive)(serverMap);
    const obj = scanObject(text, containerMember.valueStart);
    if (existing !== undefined) {
      key = existing;
      const merged = mergeOwned(serverMap[existing], value, target.ownedFields);
      if (deepEqual(serverMap[existing], merged)) return { kind: 'change', path: target.path, before: raw, after: raw, key };
      const m = obj.members.filter((x) => x.key === existing).pop();
      if (!m) return { kind: 'refuse', path: target.path, reason: `${target.path}: could not locate the "${existing}" entry; nothing was changed.` };
      edits = [{ at: m.valueStart, del: m.valueEnd - m.valueStart, text: serialise(merged, layout, indentAt(text, m.keyStart)) }];
    } else {
      edits = insertMemberEdits(text, obj, key, value, layout);
    }
  }
  const after = (parsed.bom ? BOM : '') + applyEdits(text, edits);
  return { kind: 'change', path: target.path, before: raw, after, key };
}

/**
 * Plans removing the SWAO entry of target. The container is removed when it
 * becomes empty, and the file is deleted when nothing else remains, so
 * install followed by uninstall restores the original bytes (or the absence
 * of the file).
 */
export function planJsonEntryRemove(target: JsonEntryTarget): FilePlan {
  const raw = readText(target.path);
  if (raw === null) return { kind: 'change', path: target.path, before: null, after: null };
  const parsed = parseJsonFile(target.path, raw);
  if ('refuse' in parsed) return { kind: 'refuse', path: target.path, reason: parsed.refuse };
  const { text, root, data } = parsed;
  const servers = data[target.container];
  const containerIdx = root.members.findIndex((m) => m.key === target.container);
  const containerMember = root.members[containerIdx];
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers) || !containerMember) {
    return { kind: 'change', path: target.path, before: raw, after: raw };
  }
  const existing = (target.findKey ?? findSwaoKeyCaseInsensitive)(servers as Record<string, unknown>);
  if (existing === undefined) return { kind: 'change', path: target.path, before: raw, after: raw };
  const obj = scanObject(text, containerMember.valueStart);
  const idx = obj.members.map((m) => m.key).lastIndexOf(existing);
  let edits: Edit[];
  if (obj.members.length === 1) {
    if (root.members.length === 1) return { kind: 'change', path: target.path, before: raw, after: null, key: existing };
    edits = removeMemberEdits(text, root, containerIdx);
  } else {
    edits = removeMemberEdits(text, obj, idx);
  }
  const after = (parsed.bom ? BOM : '') + applyEdits(text, edits);
  return { kind: 'change', path: target.path, before: raw, after, key: existing };
}

/** Plans a whole text file (agent files): write `content`, or delete when content is null. */
export function planTextFile(path: string, content: string | null, mayReplace: (existing: string) => boolean, what: string): FilePlan {
  const raw = readText(path);
  if (raw !== null && raw !== content && !mayReplace(raw)) {
    return { kind: 'refuse', path, reason: `${path} exists and was not generated by SWAO; nothing was changed. Rename or remove it to let SWAO write the ${what}.` };
  }
  return { kind: 'change', path, before: raw, after: raw === null && content === null ? null : content };
}

// ---------------------------------------------------------------------------
// Diff, backup, atomic write
// ---------------------------------------------------------------------------

/** A small line diff (LCS) for --dry-run; two lines of context. */
export function formatDiff(path: string, before: string | null, after: string | null): string {
  const a = before === null ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after === null ? [] : after.replace(/\r\n/g, '\n').split('\n');
  const head = [`--- ${before === null ? '(new file)' : path}`, `+++ ${after === null ? '(deleted)' : path}`];
  if (a.length * b.length > 4_000_000) return [...head, `@@ ${a.length} lines -> ${b.length} lines (too large to diff) @@`].join('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Array<{ op: ' ' | '-' | '+'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ op: ' ', line: a[i]! }); i++; j++; }
    else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) { ops.push({ op: '+', line: b[j]! }); j++; }
    else { ops.push({ op: '-', line: a[i]! }); i++; }
  }
  const keep = ops.map((o, k) => o.op !== ' ' || ops.slice(Math.max(0, k - 2), k + 3).some((x) => x.op !== ' '));
  const out: string[] = [];
  let skipped = false;
  ops.forEach((o, k) => {
    if (keep[k]) { out.push(`${o.op}${o.line}`); skipped = false; }
    else if (!skipped) { out.push('...'); skipped = true; }
  });
  return [...head, ...out].join('\n');
}

/** `YYYYMMDDTHHMMSSmmmZ`: no `:` (illegal in Windows file names), millis so two runs in a second differ. */
export function backupTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace('.', '');
}

/** File system operations of the writer; injectable so tests can fail a rename. */
export interface WriterFs {
  copyFile: (src: string, dest: string) => void;
  writeFile: (path: string, text: string) => void;
  rename: (src: string, dest: string) => void;
  unlink: (path: string) => void;
  mkdirp: (dir: string) => void;
  exists: (path: string) => boolean;
}

export const NODE_WRITER_FS: WriterFs = {
  copyFile: (s, d) => copyFileSync(s, d),
  writeFile: (p, t) => writeFileSync(p, t, 'utf-8'),
  rename: (s, d) => renameSync(s, d),
  unlink: (p) => unlinkSync(p),
  mkdirp: (d) => mkdirSync(d, { recursive: true }),
  exists: (p) => existsSync(p),
};

/** Rename errors a retry can fix: on Windows another process briefly holds the file open. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export interface RenameRetryOptions {
  /** Platform whose rename semantics apply (default: the running one). */
  platform?: NodeJS.Platform;
  /** Total attempts, the first included (default 5). */
  attempts?: number;
  /** Wait before the first retry; doubles on each retry (default 20 ms). */
  baseDelayMs?: number;
  /** Synchronous wait; injectable so tests never sleep. */
  sleep?: (ms: number) => void;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * #3491: renames `src` to `dest`. On Windows an antivirus scanner or the search
 * indexer can hold `dest` open for a moment, so the rename fails with EPERM,
 * EACCES or EBUSY; those are retried with a doubling wait (20, 40, 80, 160 ms by
 * default, about 300 ms in total). Every other error, and every error on other
 * platforms, is thrown at once.
 */
export function renameWithRetry(
  rename: WriterFs['rename'],
  src: string,
  dest: string,
  opts: RenameRetryOptions = {},
): void {
  const attempts = (opts.platform ?? process.platform) === 'win32' ? (opts.attempts ?? 5) : 1;
  const sleep = opts.sleep ?? sleepSync;
  let delay = opts.baseDelayMs ?? 20;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(src, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= attempts || code === undefined || !TRANSIENT_RENAME_CODES.has(code)) throw e;
      sleep(delay);
      delay *= 2;
    }
  }
}

export type ApplyOutcome =
  | { status: 'unchanged'; path: string }
  | { status: 'dry-run'; path: string; diff: string }
  | { status: 'written' | 'deleted'; path: string; backup?: string }
  | { status: 'error'; path: string; message: string };

/** Applies a change plan: no change, dry run, or backup plus atomic write (or delete). */
export function applyFilePlan(
  plan: Extract<FilePlan, { kind: 'change' }>,
  opts: { dryRun: boolean; now?: Date; fs?: WriterFs; renameRetry?: RenameRetryOptions },
): ApplyOutcome {
  const fs = opts.fs ?? NODE_WRITER_FS;
  const { path, before, after } = plan;
  if (before === after) return { status: 'unchanged', path };
  if (opts.dryRun) return { status: 'dry-run', path, diff: formatDiff(path, before, after) };
  let backup: string | undefined;
  try {
    if (before !== null) {
      const stamp = backupTimestamp(opts.now);
      backup = `${path}.swao-backup-${stamp}`;
      for (let n = 1; fs.exists(backup); n++) backup = `${path}.swao-backup-${stamp}-${n}`;
      fs.copyFile(path, backup);
    }
    if (after === null) {
      fs.unlink(path);
      return { status: 'deleted', path, ...(backup ? { backup } : {}) };
    }
    fs.mkdirp(dirname(path));
    const tmp = join(dirname(path), `.${basename(path)}.swao-tmp-${process.pid}-${Date.now()}`);
    try {
      fs.writeFile(tmp, after);
      renameWithRetry(fs.rename, tmp, path, opts.renameRetry);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw e;
    }
    return { status: 'written', path, ...(backup ? { backup } : {}) };
  } catch (e) {
    return { status: 'error', path, message: (e as Error).message };
  }
}
