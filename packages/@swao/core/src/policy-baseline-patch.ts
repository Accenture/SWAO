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

// #4128 BC-02 (Design 123 section 17.5.2): a minimal line patch of a
// policy-baseline.yaml. The MCP consultation edits only `state`, `params` and
// the optional `decision` record of existing policies. There is no
// comment-preserving YAML library in the repository, and a full dump would drop
// the header and section comments of the shipped file, so the patch finds the
// policy block by its `- id:` line and replaces only the `state:` line, the
// `params:` block and the `decision:` block of that policy; every other line,
// comments, BOM and line endings included, stays byte-identical. The candidate
// is then parsed again and compared, in canonical form, with the intended
// document; a mismatch refuses the patch ("edit by hand").
//
// Values are always emitted through js-yaml (flow style for lists), never by
// string concatenation, so a value can never add YAML structure.

import { dump, load } from 'js-yaml';
import { z } from 'zod';
import {
  CLIENT_POLICY_ID_PATTERN,
  POLICY_DECISION_RATIONALE_MAX,
  POLICY_PARAM_SCHEMAS,
  POLICY_STATES,
  PolicyDecisionSchema,
  SHIPPED_POLICY_ID_PATTERN,
  type PolicyBaseline,
  type PolicyDecision,
  type PolicyState,
} from './policy-baseline.js';
import { collectSecretShapedPaths } from './swao-yml.js';

/** Most changes in one proposal (Design 123 section 17.3, tool 4). */
export const POLICY_BASELINE_MAX_CHANGES = 25;

/** One requested change of an existing policy (Design 123 section 17.3, tool 4). */
export const PolicyBaselineChangeSchema = z
  .object({
    policy_id: z.string().refine((v) => SHIPPED_POLICY_ID_PATTERN.test(v) || CLIENT_POLICY_ID_PATTERN.test(v), 'policy_id must be CPB-<CAT>-NN or X-<PREFIX>-<CAT>-NN'),
    state: z.enum(POLICY_STATES).optional(),
    /** Parameters to set; merged key by key over the current params of the policy. */
    params: z.record(z.string(), z.unknown()).optional(),
    rationale: z.string().min(1).max(POLICY_DECISION_RATIONALE_MAX).optional(),
  })
  .strict()
  .refine((c) => c.state !== undefined || c.params !== undefined || c.rationale !== undefined, 'a change needs state, params or rationale');
export type PolicyBaselineChange = z.infer<typeof PolicyBaselineChangeSchema>;

/** Counts of a patch (the NDJSON event of section 17.5.7 carries these, never ids or values). */
export interface PolicyBaselinePatchCounts {
  policies_changed: number;
  states_changed: number;
  params_changed: number;
  decisions_written: number;
}

/** Per changed policy: the old and new state and params (for the diff summary and the confirmation dialog). */
export interface PolicyBaselinePatchItem {
  policy_id: string;
  old_state: PolicyState;
  new_state: PolicyState;
  old_params: Record<string, unknown>;
  new_params: Record<string, unknown>;
  decision: PolicyDecision | null;
}

export type PolicyBaselinePatchResult =
  | { ok: true; text: string; changed: boolean; counts: PolicyBaselinePatchCounts; items: PolicyBaselinePatchItem[] }
  | { ok: false; errors: string[] };

const NO_COUNTS: PolicyBaselinePatchCounts = { policies_changed: 0, states_changed: 0, params_changed: 0, decisions_written: 0 };

/** Stable JSON with sorted object keys (order-independent comparison). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** One YAML scalar or flow collection on one line (js-yaml, never concatenation). */
function yamlInline(v: unknown): string {
  return dump(v, { flowLevel: 0, lineWidth: -1, noRefs: true }).replace(/\n$/, '');
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '';

/**
 * Validate the requested changes against the loaded document (Design 123
 * section 17.5.2 step 1): the policy exists, no policy twice, `state` from
 * POLICY_STATES, `params` pass the kind's strict schema with no coercion (also
 * after the merge), the rationale is one line and nothing is secret-shaped.
 * Errors name the policy and the field, never a secret value.
 */
export function validatePolicyBaselineChanges(doc: PolicyBaseline, changes: readonly PolicyBaselineChange[]): string[] {
  const errors: string[] = [];
  if (changes.length === 0) errors.push('changes: at least one change is needed');
  if (changes.length > POLICY_BASELINE_MAX_CHANGES) errors.push(`changes: at most ${POLICY_BASELINE_MAX_CHANGES} changes per proposal`);
  const seen = new Set<string>();
  changes.forEach((c, i) => {
    const shape = PolicyBaselineChangeSchema.safeParse(c);
    if (!shape.success) {
      for (const iss of shape.error.issues) errors.push(`changes.${i}${iss.path.length ? `.${iss.path.join('.')}` : ''}: ${iss.message}`);
      return;
    }
    if (seen.has(c.policy_id)) errors.push(`changes.${i}.policy_id: ${c.policy_id} is changed twice; one change per policy`);
    seen.add(c.policy_id);
    const p = doc.policies.find((x) => x.id === c.policy_id);
    if (!p) {
      errors.push(`changes.${i}.policy_id: ${c.policy_id} is not a policy of this baseline (adding policies is out of scope, Design 123 O-6)`);
      return;
    }
    const hits: (string | number)[][] = [];
    collectSecretShapedPaths({ params: c.params ?? {}, rationale: c.rationale ?? '' }, [], hits);
    if (hits.length > 0) {
      for (const h of hits) errors.push(`changes.${i}.${h.join('.')}: secret-shaped value refused`);
      return;
    }
    if (c.rationale !== undefined) {
      const d = PolicyDecisionSchema.shape.rationale.safeParse(c.rationale);
      if (!d.success) errors.push(`changes.${i}.rationale: ${d.error.issues[0]?.message ?? 'invalid'}`);
    }
    if (c.params !== undefined) {
      const schema = POLICY_PARAM_SCHEMAS[p.kind] as z.ZodType;
      const given = schema.safeParse(c.params);
      if (!given.success) {
        for (const iss of given.error.issues) errors.push(`changes.${i}.params${iss.path.length ? `.${iss.path.join('.')}` : ''}: ${iss.message} (kind ${p.kind})`);
        return;
      }
      const merged = { ...(p.params as Record<string, unknown>), ...c.params };
      const m = schema.safeParse(merged);
      if (!m.success) errors.push(`changes.${i}.params: the merged parameters do not pass kind ${p.kind}`);
      if (p.kind === 'region_residency' && Object.keys(merged).length === 0) errors.push(`changes.${i}.params: region_residency needs at least one parameter`);
    }
  });
  return errors;
}

/**
 * The candidate document in memory (Design 123 section 17.3.1): each change
 * sets the state and merges the given params key by key over the current
 * params, as the line patch does. Call validatePolicyBaselineChanges first;
 * an unknown policy id is ignored here.
 */
export function applyPolicyBaselineChanges(doc: PolicyBaseline, changes: readonly PolicyBaselineChange[]): PolicyBaseline {
  const byId = new Map(changes.map((c) => [c.policy_id, c] as const));
  return {
    ...doc,
    policies: doc.policies.map((p) => {
      const c = byId.get(p.id);
      if (!c) return p;
      return {
        ...p,
        state: c.state ?? p.state,
        params: c.params !== undefined ? { ...(p.params as Record<string, unknown>), ...c.params } : p.params,
      } as typeof p;
    }),
  };
}

interface Region {
  /** First line index of the key line. */
  start: number;
  /** One past the last line of the region (trailing blank and comment lines excluded). */
  end: number;
}

/** The region of `key:` at `keyIndent` inside [from, to): the key line and its deeper-indented children. */
function keyRegion(lines: readonly string[], from: number, to: number, keyIndent: number, key: string): Region | null {
  const re = new RegExp(`^ {${keyIndent}}${key}:(?:\\s|$)`);
  for (let i = from; i < to; i++) {
    if (!re.test(lines[i]!)) continue;
    let end = i + 1;
    let last = i + 1;
    while (end < to) {
      const l = lines[end]!;
      if (!isBlank(l) && indentOf(l) <= keyIndent) break;
      end++;
      if (!isBlank(l) && !l.trimStart().startsWith('#')) last = end;
    }
    return { start: i, end: last };
  }
  return null;
}

function emitParams(pad: string, childPad: string, params: Record<string, unknown>): string[] {
  const keys = Object.keys(params);
  if (keys.length === 0) return [`${pad}params: {}`];
  return [`${pad}params:`, ...keys.map((k) => `${childPad}${k}: ${yamlInline(params[k])}`)];
}

function emitDecision(pad: string, childPad: string, d: PolicyDecision): string[] {
  return [
    `${pad}decision:`,
    `${childPad}rationale: ${yamlInline(d.rationale)}`,
    `${childPad}decided_on: ${yamlInline(d.decided_on)}`,
    `${childPad}via: ${yamlInline(d.via)}`,
  ];
}

export interface PatchPolicyBaselineOptions {
  /** Date of the decision records written by this patch (YYYY-MM-DD, UTC). */
  decidedOn: string;
}

/**
 * Apply validated changes to the text of a policy-baseline.yaml as a minimal
 * line patch (Design 123 section 17.5.2 steps 2 and 3). Call
 * validatePolicyBaselineChanges first; this function refuses anything it cannot
 * express as a minimal edit. With no difference from the file it returns
 * `changed: false` and the original text.
 */
export function patchPolicyBaselineText(
  text: string,
  doc: PolicyBaseline,
  changes: readonly PolicyBaselineChange[],
  options: PatchPolicyBaselineOptions,
): PolicyBaselinePatchResult {
  const refuse = (why: string): PolicyBaselinePatchResult => ({ ok: false, errors: [`cannot apply as a minimal edit; edit by hand (${why})`] });
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const crlf = body.includes('\r\n');
  if (crlf && body.replace(/\r\n/g, '').includes('\n')) return refuse('mixed line endings');
  const eol = crlf ? '\r\n' : '\n';
  const lines = body.split(eol);

  let raw: unknown;
  try { raw = load(body); } catch { return refuse('the file is not valid YAML'); }
  const intended = JSON.parse(JSON.stringify(raw ?? {})) as { schema_version?: unknown; policies?: Array<Record<string, unknown>> };
  if (!Array.isArray(intended.policies)) return refuse('no policies list');

  const items: PolicyBaselinePatchItem[] = [];
  const counts = { ...NO_COUNTS };
  // Edits from the bottom up keep the earlier line indexes valid.
  const edits: Array<{ start: number; end: number; lines: string[] }> = [];

  for (const c of changes) {
    const p = doc.policies.find((x) => x.id === c.policy_id);
    if (!p) return refuse(`policy ${c.policy_id} not found`);
    const rawPolicy = intended.policies.find((x) => x && x['id'] === c.policy_id);
    if (!rawPolicy) return refuse(`policy ${c.policy_id} not found in the file`);

    const oldParams = { ...(p.params as Record<string, unknown>) };
    const newParams = c.params !== undefined ? { ...oldParams, ...c.params } : oldParams;
    const newState = c.state ?? p.state;
    const stateChanged = newState !== p.state;
    const paramsChanged = canonicalJson(newParams) !== canonicalJson(oldParams);
    const decision: PolicyDecision | null = c.rationale !== undefined ? { rationale: c.rationale, decided_on: options.decidedOn, via: 'consultation' } : null;
    const decisionChanged = decision !== null && canonicalJson(decision) !== canonicalJson(p.decision ?? null);
    if (!stateChanged && !paramsChanged && !decisionChanged) continue;

    // The policy block: from its `- id:` line to the next line at or above the dash.
    const idRe = new RegExp(`^( *)- +id: *(["']?)${escapeRegExp(c.policy_id)}\\2 *(?:#.*)?$`);
    const starts = lines.flatMap((l, i) => (idRe.test(l) ? [i] : []));
    if (starts.length !== 1) return refuse(`policy ${c.policy_id} has no single "- id:" line`);
    const start = starts[0]!;
    const dash = indentOf(lines[start]!);
    const keyIndent = lines[start]!.indexOf('id:');
    let end = start + 1;
    while (end < lines.length && (isBlank(lines[end]!) || indentOf(lines[end]!) > dash)) end++;
    const pad = ' '.repeat(keyIndent);

    const policyEdits: Array<{ start: number; end: number; lines: string[] }> = [];
    const stateRegion = keyRegion(lines, start + 1, end, keyIndent, 'state');
    if (!stateRegion || stateRegion.end - stateRegion.start !== 1) return refuse(`policy ${c.policy_id} has no one-line state`);
    if (stateChanged) {
      const m = /^( *state: *)(["']?)[a-z_]+\2( *#.*)?$/.exec(lines[stateRegion.start]!);
      if (!m) return refuse(`policy ${c.policy_id} state line is not a plain value`);
      policyEdits.push({ start: stateRegion.start, end: stateRegion.end, lines: [`${m[1]}${yamlInline(newState)}${m[3] ?? ''}`] });
      rawPolicy['state'] = newState;
    }

    const paramsRegion = keyRegion(lines, start + 1, end, keyIndent, 'params');
    const childPadOf = (r: Region | null): string => {
      const child = r ? lines.slice(r.start + 1, r.end).find((l) => !isBlank(l) && !l.trimStart().startsWith('#')) : undefined;
      return child ? ' '.repeat(indentOf(child)) : `${pad}  `;
    };
    if (paramsChanged) {
      const emitted = emitParams(pad, childPadOf(paramsRegion), newParams);
      if (paramsRegion) policyEdits.push({ start: paramsRegion.start, end: paramsRegion.end, lines: emitted });
      else policyEdits.push({ start: stateRegion.end, end: stateRegion.end, lines: emitted });
      rawPolicy['params'] = newParams;
    }

    if (decisionChanged && decision) {
      const decisionRegion = keyRegion(lines, start + 1, end, keyIndent, 'decision');
      const emitted = emitDecision(pad, childPadOf(decisionRegion), decision);
      if (decisionRegion) {
        policyEdits.push({ start: decisionRegion.start, end: decisionRegion.end, lines: emitted });
      } else {
        // After the params block, else after the state line.
        const after = paramsRegion ? paramsRegion.end : stateRegion.end;
        policyEdits.push({ start: after, end: after, lines: emitted });
      }
      rawPolicy['decision'] = decision;
    }

    // Two edits of one policy never overlap: state, params and decision are distinct keys.
    edits.push(...policyEdits);
    counts.policies_changed++;
    if (stateChanged) counts.states_changed++;
    if (paramsChanged) counts.params_changed++;
    if (decisionChanged) counts.decisions_written++;
    items.push({ policy_id: p.id, old_state: p.state, new_state: newState, old_params: oldParams, new_params: newParams, decision: decisionChanged ? decision : null });
  }

  if (items.length === 0) return { ok: true, text, changed: false, counts, items };

  // A decision record needs schema 0.2 (section 17.5.6): bump the header line once.
  const anyDecision = intended.policies.some((x) => x && x['decision'] !== undefined);
  if (anyDecision && intended.schema_version !== '0.2') {
    const i = lines.findIndex((l) => /^schema_version:/.test(l));
    const m = i >= 0 ? /^(schema_version: *)(["']?)0\.1\2( *#.*)?$/.exec(lines[i]!) : null;
    if (!m) return refuse('schema_version line is not "0.1"');
    edits.push({ start: i, end: i + 1, lines: [`${m[1]}${m[2]}0.2${m[2]}${m[3] ?? ''}`] });
    intended.schema_version = '0.2';
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  const out = [...lines];
  for (const e of edits) out.splice(e.start, e.end - e.start, ...e.lines);
  const candidate = bom + out.join(eol);

  // Verify by re-parse (section 17.5.2 step 3).
  let reparsed: unknown;
  try { reparsed = load(candidate.startsWith('﻿') ? candidate.slice(1) : candidate); } catch { return refuse('the patched text is not valid YAML'); }
  if (canonicalJson(reparsed) !== canonicalJson(intended)) return refuse('the patched text does not parse to the intended values');
  return { ok: true, text: candidate, changed: candidate !== text, counts, items };
}

/**
 * Unified-style diff of two texts, changed lines only with `context` lines
 * around each hunk (Design 123 section 17.3, tool 4). Line-based, no external
 * library; the line patch keeps the hunks small.
 */
export function policyBaselineLineDiff(before: string, after: string, context = 2): string[] {
  const a = before.replace(/^﻿/, '').split(/\r?\n/);
  const b = after.replace(/^﻿/, '').split(/\r?\n/);
  // Longest common subsequence table (files are a few hundred lines).
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Array<{ op: ' ' | '-' | '+'; text: string; line: number }> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ op: ' ', text: a[i]!, line: j + 1 }); i++; j++; }
    else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) { ops.push({ op: '-', text: a[i]!, line: j + 1 }); i++; }
    else { ops.push({ op: '+', text: b[j]!, line: j + 1 }); j++; }
  }
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.op === ' ') return;
    for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++) keep[x] = true;
  });
  const outLines: string[] = [];
  let gap = false;
  ops.forEach((o, k) => {
    if (!keep[k]) { gap = true; return; }
    if (gap || outLines.length === 0) outLines.push(`@@ line ${o.line} @@`);
    gap = false;
    outLines.push(`${o.op} ${o.text}`);
  });
  return outLines;
}

/** Escape every regular-expression metacharacter, including the backslash (CodeQL js/incomplete-sanitization). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}
