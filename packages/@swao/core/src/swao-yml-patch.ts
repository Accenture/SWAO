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

// #4283 (Design 125 section 7): the one minimal-patch writer for `.swao.yml`
// (workspace and app files). An edit names a key path (`['assessment',
// 'lenses']`) and a new value, or `undefined` to remove the key. Only the
// lines of the edited key change: comments, key order, quoting, blank lines,
// flow-style lines of untouched keys, the BOM and the line endings stay
// byte-identical. The approach generalises the line edits of
// `writeAssessmentLlm` (setup/llm-values.ts), `setWorkspaceKey`
// (setup/workspace-state.ts) and the verify-by-reparse of
// policy-baseline-patch.ts: the repository has no comment-preserving YAML
// library, so the patch walks block mappings by indentation.
//
// Rules:
// - an existing key keeps its line position and its inline comment; only its
//   value lines are replaced;
// - a missing key is inserted after the last child of its parent; a missing
//   top-level key is appended at the end of the file;
// - a parent written in flow style (`workspace: { a: 1 }`) or as a scalar is
//   re-emitted on its own lines only;
// - values are emitted through js-yaml, never by string concatenation, so a
//   value can never add YAML structure; scalars and lists of scalars become
//   one flow line, mappings and lists of mappings a block, unless the edit
//   asks for a style or the old value was flow style;
// - removing the last key of a mapping removes the then empty parent key
//   line too (comment lines stay);
// - opt-in (#4280, `adoptCommentedTemplates`): a missing top-level key whose
//   commented template is in the file (`# workspace:` followed by `#   ...`
//   lines, as `swao init` writes them) is adopted in place: the header line is
//   uncommented, and so are the commented lines on the edit path, so their
//   inline comments stay; every other template line stays commented. Without
//   the option a missing key is appended as before;
// - the candidate text is parsed again and compared, in canonical form, with
//   the parsed original plus the edits; on a mismatch (or when the original
//   does not parse, for example a duplicate key) nothing is written.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { dump, load } from 'js-yaml';
import { canonicalJson } from './policy-baseline-patch.js';

/** A key path from the document root, for example `['assessment', 'lenses']`. */
export type SwaoYmlKeyPath = readonly string[];

/** Emission style of an edited value. `auto` keeps the old style where there was one. */
export type SwaoYmlValueStyle = 'auto' | 'flow' | 'block';

/** One edit: set `path` to `value`, or remove the key when `value` is undefined. */
export interface SwaoYmlEdit {
  path: SwaoYmlKeyPath;
  value: unknown;
  style?: SwaoYmlValueStyle;
}

/** Options of the patch (all off by default, so existing callers keep their output). */
export interface SwaoYmlPatchOptions {
  /**
   * #4280 (Design 125 section 7): adopt a commented template of a missing
   * top-level key in place instead of appending a second block.
   */
  adoptCommentedTemplates?: boolean;
}

export type SwaoYmlPatchResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; error: string };

type Doc = Record<string, unknown>;
interface Range { from: number; to: number; indent: number }
type PrevStyle = 'flow' | 'block' | 'none';

const isPlainObject = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const isScalar = (v: unknown): boolean => v === null || typeof v !== 'object' || v instanceof Date;
const indentOf = (line: string): number => line.length - line.trimStart().length;
const isContent = (line: string): boolean => {
  const t = line.trim();
  return t !== '' && !t.startsWith('#');
};
const isSeqItem = (line: string): boolean => /^\s*-(\s|$)/.test(line);

function keyMatcher(key: string): RegExp {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:${esc}|"${esc}"|'${esc}')[ \\t]*:(?=\\s|$)`);
}

const RESERVED_PLAIN = /^(true|false|yes|no|on|off|null|y|n|~)$/i;
function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) && !RESERVED_PLAIN.test(key) ? key : JSON.stringify(key);
}

/** One YAML scalar or flow collection on one line (js-yaml, never concatenation). */
function yamlInline(v: unknown): string {
  const s = dump(v, { flowLevel: 0, lineWidth: -1, noRefs: true }).replace(/\n$/, '');
  return s.includes('\n') ? JSON.stringify(v) : s;
}

/** Splits the text after `key:` into its value and a trailing comment (with its leading spaces). */
export function splitInlineComment(rest: string): { value: string; comment: string } {
  let quote: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) {
        if (quote === "'" && rest[i + 1] === "'") { i++; continue; }
        quote = null;
      }
      continue;
    }
    const prev = i === 0 ? ' ' : rest[i - 1]!;
    if ((c === '"' || c === "'") && /[\s[{,:]/.test(prev)) { quote = c; continue; }
    if (c === '#' && /\s/.test(prev)) {
      let s = i;
      while (s > 0 && /\s/.test(rest[s - 1]!)) s--;
      return { value: rest.slice(0, s).trim(), comment: rest.slice(s) };
    }
  }
  return { value: rest.trim(), comment: '' };
}

function findKey(lines: readonly string[], range: Range, key: string): number {
  const re = keyMatcher(key);
  for (let i = range.from; i < range.to; i++) {
    const l = lines[i]!;
    if (isContent(l) && indentOf(l) === range.indent && re.test(l.slice(range.indent))) return i;
  }
  return -1;
}

/** Exclusive end of the entry whose key line is `i`: its deeper lines (trailing comments and blanks excluded). */
function entryEnd(lines: readonly string[], i: number, indent: number): number {
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (!isContent(l)) continue;
    const ind = indentOf(l);
    if (ind > indent || (ind === indent && isSeqItem(l))) { last = j; continue; }
    break;
  }
  return last + 1;
}

function restOf(line: string, indent: number, key: string): string {
  const m = keyMatcher(key).exec(line.slice(indent));
  return line.slice(indent + (m ? m[0].length : 0));
}

function detectIndentUnit(lines: readonly string[]): number {
  let unit = 0;
  for (const l of lines) {
    if (!isContent(l)) continue;
    const ind = indentOf(l);
    if (ind > 0 && (unit === 0 || ind < unit)) unit = ind;
  }
  return unit > 0 ? unit : 2;
}

function chooseFlow(v: unknown, style: SwaoYmlValueStyle, prev: PrevStyle): boolean {
  if (isScalar(v)) return true;
  if (Array.isArray(v) ? v.length === 0 : Object.keys(v as Doc).length === 0) return true;
  if (style === 'flow') return true;
  if (style === 'block') return false;
  if (prev === 'flow') return true;
  if (prev === 'block') return false;
  return Array.isArray(v) && v.every(isScalar);
}

function emitEntry(key: string, value: unknown, indent: number, unit: number, style: SwaoYmlValueStyle, prev: PrevStyle, comment: string): string[] {
  const pad = ' '.repeat(indent);
  const k = yamlKey(key);
  if (chooseFlow(value, style, prev)) return [`${pad}${k}: ${yamlInline(value)}${comment}`];
  const body = dump(value, { lineWidth: -1, noRefs: true, indent: unit }).replace(/\n$/, '').split('\n');
  const child = pad + ' '.repeat(unit);
  return [`${pad}${k}:${comment}`, ...body.map((l) => (l === '' ? l : child + l))];
}

/** A missing key with its missing descendants: one key line per level, the value at the leaf. */
function emitChain(keys: SwaoYmlKeyPath, value: unknown, indent: number, unit: number, style: SwaoYmlValueStyle): string[] {
  if (keys.length === 1) return emitEntry(keys[0]!, value, indent, unit, style, 'none', '');
  return [`${' '.repeat(indent)}${yamlKey(keys[0]!)}:`, ...emitChain(keys.slice(1), value, indent + unit, unit, style)];
}

function getAt(doc: Doc, path: SwaoYmlKeyPath): unknown {
  let cur: unknown = doc;
  for (const k of path) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Applies one edit to the parsed document (the expected result the text must parse to). */
function applyToDoc(doc: Doc, edit: SwaoYmlEdit): void {
  const { path } = edit;
  if (edit.value === undefined) {
    const chain: Doc[] = [doc];
    for (const k of path.slice(0, -1)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      const next = chain[chain.length - 1]![k];
      if (!isPlainObject(next)) return;
      chain.push(next);
    }
    const leaf = path[path.length - 1]!;
    if (leaf === '__proto__' || leaf === 'constructor' || leaf === 'prototype') return;
    const parent = chain[chain.length - 1]!;
    if (!Object.prototype.hasOwnProperty.call(parent, leaf)) return;
    delete parent[leaf];
    for (let d = chain.length - 1; d > 0; d--) {
      if (Object.keys(chain[d]!).length > 0) break;
      const key = path[d - 1]!;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      delete chain[d - 1]![key];
    }
    return;
  }
  let cur = doc;
  for (const k of path.slice(0, -1)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k] as Doc;
  }
  const last = path[path.length - 1]!;
  if (last === '__proto__' || last === 'constructor' || last === 'prototype') return;
  cur[last] = structuredClone(edit.value);
}

/** `# <indent><text>` with the `# ` removed, when the rest is a deeper YAML line; else null. */
function uncommented(line: string): string | null {
  const m = /^# ( +\S.*)$/.exec(line);
  return m ? m[1]! : null;
}

/**
 * #4280: adopts the commented template of the top-level key `path[0]` in
 * place. The template is a column-0 line `# <key>:` (optionally with an
 * inline comment) followed by commented lines that are deeper YAML lines once
 * `# ` is removed. The header is uncommented, and so is each commented line on
 * `path` (parent before child), so the following edit finds them and keeps
 * their inline comments. Returns false when the file has no such template.
 */
function adoptTemplate(lines: string[], path: SwaoYmlKeyPath, unit: number): boolean {
  const re = keyMatcher(path[0]!);
  const h = lines.findIndex((l) => l.startsWith('# ') && re.test(l.slice(2)) && splitInlineComment(restOf(l.slice(2), 0, path[0]!)).value === '');
  if (h < 0) return false;
  let end = h + 1;
  while (end < lines.length && uncommented(lines[end]!) !== null) end++;
  lines[h] = lines[h]!.slice(2);
  uncommentPath(lines, h + 1, end, path, 1, 0, unit);
  return true;
}

/**
 * Uncomments the commented template lines of `path[depth..]` between `from`
 * and `end` (parent before child, each one level deeper than the last).
 * Returns the number of lines uncommented.
 */
function uncommentPath(lines: string[], from: number, end: number, path: SwaoYmlKeyPath, depth: number, baseIndent: number, unit: number): number {
  let n = 0;
  for (let d = depth; d < path.length; d++) {
    const want = baseIndent + unit * (d - depth + 1);
    let hit = -1;
    for (let j = from; j < end; j++) {
      const u = uncommented(lines[j]!);
      if (u === null) continue;
      const ind = indentOf(u);
      if (ind < want) break; // left the parent
      if (ind === want && keyMatcher(path[d]!).test(u.slice(ind))) { hit = j; break; }
    }
    if (hit < 0) break;
    lines[hit] = uncommented(lines[hit]!)!;
    from = hit + 1;
    n++;
  }
  return n;
}

/**
 * #4280: a missing nested key whose commented template line follows the
 * entries of its (live) parent block, as after an earlier adoption: the
 * template lines on the path are uncommented. Returns true when one was.
 */
function adoptNested(lines: string[], parentLine: number, parentIndent: number, path: SwaoYmlKeyPath, depth: number, unit: number): boolean {
  let end = parentLine + 1;
  while (end < lines.length) {
    const l = lines[end]!;
    if (uncommented(l) !== null || (isContent(l) && indentOf(l) > parentIndent)) { end++; continue; }
    break;
  }
  return uncommentPath(lines, parentLine + 1, end, path, depth, parentIndent, unit) > 0;
}

/** Applies one edit to the lines; `after` is the parsed document with this edit applied. */
function applyToLines(lines: string[], edit: SwaoYmlEdit, after: Doc, unit: number, opts: SwaoYmlPatchOptions = {}): string | null {
  const { path } = edit;
  let range: Range = { from: 0, to: lines.length, indent: 0 };
  if (opts.adoptCommentedTemplates && getAt(after, path.slice(0, 1)) !== undefined && findKey(lines, range, path[0]!) < 0) {
    adoptTemplate(lines, path, unit);
    range = { from: 0, to: lines.length, indent: 0 };
  }
  for (let d = 0; d < path.length; d++) {
    const key = path[d]!;
    const isLeaf = d === path.length - 1;
    const prefix = path.slice(0, d + 1);
    const sub = getAt(after, prefix);
    let i = findKey(lines, range, key);
    if (i < 0 && d > 0 && sub !== undefined && opts.adoptCommentedTemplates) {
      const parentLine = range.from - 1;
      const parentIndent = indentOf(lines[parentLine]!);
      if (adoptNested(lines, parentLine, parentIndent, path, d, unit)) {
        range = { from: parentLine + 1, to: entryEnd(lines, parentLine, parentIndent), indent: range.indent };
        i = findKey(lines, range, key);
      }
    }
    if (i < 0) {
      if (sub === undefined) return null; // nothing to remove
      const emitted = emitChain(path.slice(d), getAt(after, path), range.indent, unit, edit.style ?? 'auto');
      if (d === 0) {
        while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
        lines.push(...(lines.length > 0 ? ['', ...emitted] : emitted), '');
      } else {
        let at = range.from;
        for (let j = range.from; j < range.to; j++) if (isContent(lines[j]!)) at = j + 1;
        lines.splice(at, 0, ...emitted);
      }
      return null;
    }
    const keyIndent = range.indent;
    const end = entryEnd(lines, i, keyIndent);
    const { value: inline, comment } = splitInlineComment(restOf(lines[i]!, keyIndent, key));
    if (sub === undefined) {
      // Removed key, or a parent left empty by the removal: drop the key and
      // value lines of this entry; comment lines inside a pruned parent stay.
      if (isLeaf) lines.splice(i, end - i);
      else for (let j = end - 1; j >= i; j--) if (isContent(lines[j]!)) lines.splice(j, 1);
      return null;
    }
    if (isLeaf || inline !== '') {
      let prev: PrevStyle = 'none';
      if (inline.startsWith('{') || inline.startsWith('[')) prev = 'flow';
      else if (inline === '' && end > i + 1) prev = 'block';
      const style: SwaoYmlValueStyle = isLeaf ? (edit.style ?? 'auto') : (prev === 'flow' ? 'flow' : 'block');
      lines.splice(i, end - i, ...emitEntry(key, sub, keyIndent, unit, style, prev, comment));
      return null;
    }
    // Block mapping parent: descend into its children.
    let child: Range = { from: i + 1, to: i + 1, indent: keyIndent + unit };
    for (let j = i + 1; j < end; j++) {
      const l = lines[j]!;
      if (!isContent(l)) continue;
      if (isSeqItem(l)) return `${prefix.join('.')} is a list, not a mapping`;
      child = { from: i + 1, to: end, indent: indentOf(l) };
      break;
    }
    range = child;
  }
  return null;
}

function normaliseValue(v: unknown): unknown {
  if (v === undefined) return undefined;
  return load(dump(v, { noRefs: true, skipInvalid: true, lineWidth: -1 }));
}

/**
 * Applies `edits` to the text of a `.swao.yml` and returns the new text.
 * Pure; the caller writes. `ok: false` names the reason and no text is
 * produced: the original does not parse or is not a mapping, a parent on an
 * edit path is a list, or the candidate does not parse back to the intended
 * document.
 */
export function patchSwaoYmlText(text: string, edits: readonly SwaoYmlEdit[], opts: SwaoYmlPatchOptions = {}): SwaoYmlPatchResult {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  let original: unknown = null;
  try {
    if (body.split(/\r?\n/).some(isContent)) original = load(body);
  } catch (err) {
    return { ok: false, error: `the file does not parse as YAML (${(err as Error).message.split('\n')[0]})` };
  }
  if (original !== null && original !== undefined && !isPlainObject(original)) {
    return { ok: false, error: 'the file is not a YAML mapping' };
  }
  const working: Doc = isPlainObject(original) ? structuredClone(original) : {};
  const lines = body.split(/\r?\n/);
  const unit = detectIndentUnit(lines);
  for (const raw of edits) {
    if (raw.path.length === 0 || raw.path.some((k) => typeof k !== 'string' || k === '')) {
      return { ok: false, error: 'an edit needs a non-empty key path' };
    }
    let value: unknown;
    try {
      value = normaliseValue(raw.value);
    } catch (err) {
      return { ok: false, error: `${raw.path.join('.')}: the value cannot be written as YAML (${(err as Error).message.split('\n')[0]})` };
    }
    const edit: SwaoYmlEdit = { ...raw, value };
    applyToDoc(working, edit);
    const problem = applyToLines(lines, edit, working, unit, opts);
    if (problem) return { ok: false, error: problem };
  }
  // A removed entry at the end of the file leaves no extra blank lines behind
  // (the blank separator a top-level insert adds goes with it).
  const trailing = (ls: readonly string[]): number => { let n = 0; while (n < ls.length && ls[ls.length - 1 - n]!.trim() === '') n++; return n; };
  const keep = Math.max(trailing(body.split(/\r?\n/)), 1);
  while (trailing(lines) > keep) lines.pop();
  const candidate = lines.join(eol);
  let back: unknown = null;
  try {
    if (lines.some(isContent)) back = load(candidate);
  } catch {
    return { ok: false, error: 'the patched file would not parse; it was left unchanged' };
  }
  if (canonicalJson(isPlainObject(back) ? back : {}) !== canonicalJson(working) || (back !== null && back !== undefined && !isPlainObject(back))) {
    return { ok: false, error: 'the patched file would not carry exactly the edited values; it was left unchanged' };
  }
  const out = bom + candidate;
  return { ok: true, text: out, changed: out !== text };
}

/**
 * Applies `edits` to the `.swao.yml` at `path` and writes it only when the
 * text changes. A missing file is created (from empty text) only with
 * `createIfMissing`. Never throws for a refused patch; the result names the
 * reason and the file is left as it was.
 */
export function patchSwaoYmlFile(path: string, edits: readonly SwaoYmlEdit[], opts: { createIfMissing?: boolean } & SwaoYmlPatchOptions = {}): SwaoYmlPatchResult {
  let text = '';
  if (existsSync(path)) {
    try {
      text = readFileSync(path, 'utf-8');
    } catch (err) {
      return { ok: false, error: `${basename(path)} cannot be read (${(err as Error).message})` };
    }
  } else if (!opts.createIfMissing) {
    return { ok: false, error: `${basename(path)} is missing` };
  }
  const r = patchSwaoYmlText(text, edits, { adoptCommentedTemplates: opts.adoptCommentedTemplates ?? false });
  if (!r.ok || !r.changed) return r;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, r.text, 'utf-8');
  } catch (err) {
    return { ok: false, error: `${basename(path)} cannot be written (${(err as Error).message})` };
  }
  return r;
}

/** `patchSwaoYmlFile` that throws on a refused patch (for callers that report errors by exception). */
export function patchSwaoYmlFileOrThrow(path: string, edits: readonly SwaoYmlEdit[], opts: { createIfMissing?: boolean } & SwaoYmlPatchOptions = {}): boolean {
  const r = patchSwaoYmlFile(path, edits, opts);
  if (!r.ok) throw new Error(`${basename(path)} could not be updated safely: ${r.error}`);
  return r.changed;
}
