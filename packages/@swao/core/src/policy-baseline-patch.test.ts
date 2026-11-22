// #4128 BC-02 (Design 123 sections 17.5.2 and 17.5.6): the minimal line patch
// of policy-baseline.yaml and the schema 0.2 decision record.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { PolicyBaselineSchema, parsePolicyBaselineText, type PolicyBaseline } from './policy-baseline.js';
import {
  patchPolicyBaselineText,
  policyBaselineLineDiff,
  validatePolicyBaselineChanges,
  type PolicyBaselineChange,
} from './policy-baseline-patch.js';

const SHIPPED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const SHIPPED = readFileSync(join(SHIPPED_DIR, 'policy-baseline.yaml'), 'utf-8');
const DATE = { decidedOn: '2026-11-08' };

const docOf = (text: string): PolicyBaseline => PolicyBaselineSchema.parse(load(text.replace(/^﻿/, '')));

function patch(text: string, changes: PolicyBaselineChange[]) {
  const doc = docOf(text);
  expect(validatePolicyBaselineChanges(doc, changes)).toEqual([]);
  return patchPolicyBaselineText(text, doc, changes, DATE);
}

/** Lines of `before` that are not in `after` and vice versa (multiset difference). */
function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  const removed = a.filter((x) => { const n = cb.get(x) ?? 0; if (n > 0) { cb.set(x, n - 1); return false; } return true; });
  const added = b.filter((x) => { const n = ca.get(x) ?? 0; if (n > 0) { ca.set(x, n - 1); return false; } return true; });
  return { removed, added };
}

describe('patchPolicyBaselineText (#4128 BC-02)', () => {
  it('changes only the state line of one policy in the shipped file; every other line stays byte-identical', () => {
    const r = patch(SHIPPED, [{ policy_id: 'CPB-SVC-03', state: 'enabled' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.counts).toEqual({ policies_changed: 1, states_changed: 1, params_changed: 0, decisions_written: 0 });
    const d = changedLines(SHIPPED, r.text);
    expect(d.removed).toEqual(['    state: disabled']);
    expect(d.added).toEqual(['    state: enabled']);
    // Comments and the header stay.
    expect(r.text.split('\n').slice(0, 25)).toEqual(SHIPPED.split('\n').slice(0, 25));
    expect(docOf(r.text).policies.find((p) => p.id === 'CPB-SVC-03')?.state).toBe('enabled');
    // The other disabled policies stay disabled (the right block was patched).
    expect(docOf(r.text).policies.find((p) => p.id === 'CPB-SVC-01')?.state).toBe('disabled');
  });

  it('replaces a block params list with flow-style lists, merging the given keys', () => {
    const r = patch(SHIPPED, [{ policy_id: 'CPB-RES-01', params: { allowed_countries: ['DE', 'EU'] } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = changedLines(SHIPPED, r.text);
    expect(d.removed).toEqual(['      allowed_countries: [DE]']);
    expect(d.added).toEqual(['      allowed_countries: [DE, EU]']);
    expect(r.items[0]).toMatchObject({ policy_id: 'CPB-RES-01', old_params: { allowed_countries: ['DE'] }, new_params: { allowed_countries: ['DE', 'EU'] } });
  });

  it('keeps the other keys of a params block when one key changes (merge)', () => {
    const r = patch(SHIPPED, [{ policy_id: 'CPB-ENC-02', params: { min_tls_version: '1.3' } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = docOf(r.text).policies.find((x) => x.id === 'CPB-ENC-02')!;
    expect(p.params).toEqual({ min_tls_version: '1.3', applies_to: ['load_balancer', 'api_gateway', 'cdn'] });
    expect(changedLines(SHIPPED, r.text).removed).toEqual(['      min_tls_version: "1.2"']);
  });

  it('turns an inline params: {} into a block and back', () => {
    const text = SHIPPED.replace(/(- id: CPB-LOG-02[\s\S]*?params:)\n {6}min_days: 180/, '$1 {}');
    expect(text).not.toBe(SHIPPED);
    const r = patch(text, [{ policy_id: 'CPB-LOG-02', params: { min_days: 365 } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Block form with the default child indent: the shipped layout again, with the new value.
    expect(r.text).toBe(SHIPPED.replace('      min_days: 180', '      min_days: 365'));
  });

  it('writes a decision record after params and bumps schema_version to "0.2" (quotes kept)', () => {
    const r = patch(SHIPPED, [{ policy_id: 'CPB-LOG-02', params: { min_days: 365 }, rationale: 'Retention follows the agency archive rule' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts).toEqual({ policies_changed: 1, states_changed: 0, params_changed: 1, decisions_written: 1 });
    const d = changedLines(SHIPPED, r.text);
    expect(d.removed).toEqual(['schema_version: "0.1"', '      min_days: 180']);
    expect(d.added).toEqual([
      'schema_version: "0.2"',
      '      min_days: 365',
      '    decision:',
      '      rationale: Retention follows the agency archive rule',
      "      decided_on: '2026-11-08'",
      '      via: consultation',
    ]);
    const parsed = parsePolicyBaselineText(r.text, { controlIds: new Set(docOf(SHIPPED).policies.map((p) => p.control)) });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.baseline.policies.find((p) => p.id === 'CPB-LOG-02')?.decision).toEqual({ rationale: 'Retention follows the agency archive rule', decided_on: '2026-11-08', via: 'consultation' });
  });

  it('keeps CRLF line endings and a leading BOM', () => {
    const text = `﻿${SHIPPED.replace(/\n/g, '\r\n')}`;
    const r = patch(text, [{ policy_id: 'CPB-IAM-02', params: { max_age_days: 60 } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith('﻿')).toBe(true);
    expect(r.text.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(r.text.length).toBe(text.length); // "90" to "60" keeps the length; nothing else moved
    expect(r.text.replace('max_age_days: 60', 'max_age_days: 90')).toBe(text);
  });

  it('returns no change when the values are already in place', () => {
    const r = patch(SHIPPED, [{ policy_id: 'CPB-LOG-02', state: 'enabled', params: { min_days: 180 } }]);
    expect(r).toMatchObject({ ok: true, changed: false, text: SHIPPED, items: [] });
  });

  it('refuses mixed line endings and a policy block it cannot find as one "- id:" line', () => {
    const nl = SHIPPED.indexOf('\n');
    const mixed = `${SHIPPED.slice(0, nl)}\r\n${SHIPPED.slice(nl + 1)}`; // only the first line ending becomes CRLF
    const doc = docOf(SHIPPED);
    const r = patchPolicyBaselineText(mixed, doc, [{ policy_id: 'CPB-LOG-02', state: 'disabled' }], DATE);
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/^cannot apply as a minimal edit; edit by hand \(mixed line endings\)/)] });
    const flow = SHIPPED.replace(/  - id: CPB-COST-01\n[\s\S]*?default_source: assumption\n/, '  - {id: CPB-COST-01, kind: budget_alerts, category: cost, control: CPB-COST-01, state: enabled, params: {required: true}, default_source: assumption}\n');
    expect(flow).not.toBe(SHIPPED);
    const f = patchPolicyBaselineText(flow, docOf(flow), [{ policy_id: 'CPB-COST-01', state: 'disabled' }], DATE);
    expect(f.ok).toBe(false);
  });

  it('a rationale that looks like YAML structure is emitted as a quoted scalar, never as structure', () => {
    for (const rationale of ['x: y', ']: {a', 'enabled # state: disabled', "- id: CPB-LOG-01", '&anchor *alias', '"quoted" and \'single\'']) {
      const r = patch(SHIPPED, [{ policy_id: 'CPB-TAG-01', rationale }]);
      expect(r.ok, rationale).toBe(true);
      if (!r.ok) continue;
      const doc = docOf(r.text);
      expect(doc.policies).toHaveLength(docOf(SHIPPED).policies.length);
      expect(doc.policies.find((p) => p.id === 'CPB-TAG-01')?.decision?.rationale).toBe(rationale);
      expect(doc.policies.find((p) => p.id === 'CPB-TAG-01')?.state).toBe('enabled');
      expect(doc.policies.find((p) => p.id === 'CPB-LOG-01')?.decision).toBeUndefined();
    }
  });
});

describe('validatePolicyBaselineChanges (#4128 BC-02)', () => {
  const doc = docOf(SHIPPED);
  it('accepts typed changes of existing policies', () => {
    expect(validatePolicyBaselineChanges(doc, [{ policy_id: 'CPB-ENC-02', params: { min_tls_version: '1.3' } }, { policy_id: 'CPB-SVC-01', state: 'enabled' }])).toEqual([]);
  });
  it('refuses unknown policies, duplicates, coerced parameter types, unknown parameters, multi-line rationales and secrets', () => {
    const errs = validatePolicyBaselineChanges(doc, [
      { policy_id: 'CPB-XXX-01', state: 'enabled' },
      { policy_id: 'CPB-ENC-02', params: { min_tls_version: 1.3 } },
      { policy_id: 'CPB-LOG-02', params: { min_days: '365' } },
      { policy_id: 'CPB-NET-02', params: { evil: true } },
      { policy_id: 'CPB-TAG-01', rationale: 'line one\n    state: disabled' },
      { policy_id: 'CPB-TAG-01', state: 'disabled' },
      { policy_id: 'CPB-IAM-02', rationale: 'ghp_' + 'a'.repeat(36) },
    ]);
    expect(errs.join('\n')).toMatch(/changes\.0\.policy_id: CPB-XXX-01 is not a policy of this baseline/);
    expect(errs.join('\n')).toMatch(/changes\.1\.params\.min_tls_version/);
    expect(errs.join('\n')).toMatch(/changes\.2\.params\.min_days/);
    expect(errs.join('\n')).toMatch(/changes\.3\.params/);
    expect(errs.join('\n')).toMatch(/changes\.4\.rationale: rationale must be one line/);
    expect(errs.join('\n')).toMatch(/changes\.5\.policy_id: CPB-TAG-01 is changed twice/);
    expect(errs.join('\n')).toMatch(/changes\.6\.rationale: secret-shaped value refused/);
    expect(errs.join('\n')).not.toContain('a'.repeat(36));
  });
  it('refuses an empty change, an unknown state and more than 25 changes', () => {
    expect(validatePolicyBaselineChanges(doc, [{ policy_id: 'CPB-TAG-01' } as PolicyBaselineChange])).not.toEqual([]);
    expect(validatePolicyBaselineChanges(doc, [{ policy_id: 'CPB-TAG-01', state: 'on' as never }])).not.toEqual([]);
    expect(validatePolicyBaselineChanges(doc, [])).toEqual(['changes: at least one change is needed']);
    const many = Array.from({ length: 26 }, () => ({ policy_id: 'CPB-TAG-01', state: 'enabled' as const }));
    expect(validatePolicyBaselineChanges(doc, many)[0]).toBe('changes: at most 25 changes per proposal');
  });
});

describe('schema 0.2 decision record (#4128 BC-02)', () => {
  it('0.1 still loads; a decision needs 0.2; 0.2 without decisions loads', () => {
    const doc = load(SHIPPED) as Record<string, unknown> & { policies: Array<Record<string, unknown>> };
    expect(PolicyBaselineSchema.safeParse(doc).success).toBe(true);
    const withDecision = { ...doc, policies: doc.policies.map((p, i) => (i === 0 ? { ...p, decision: { rationale: 'r', decided_on: '2026-11-08', via: 'consultation' } } : p)) };
    const r = PolicyBaselineSchema.safeParse(withDecision);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((x) => x.message)).toContain('a decision record needs schema_version "0.2"');
    expect(PolicyBaselineSchema.safeParse({ ...withDecision, schema_version: '0.2' }).success).toBe(true);
    expect(PolicyBaselineSchema.safeParse({ ...doc, schema_version: '0.2' }).success).toBe(true);
    // The decision record is strict: no person's name field, a fixed `via`.
    const named = { ...withDecision, schema_version: '0.2', policies: withDecision.policies.map((p, i) => (i === 0 ? { ...p, decision: { rationale: 'r', decided_on: '2026-11-08', via: 'consultation', decided_by: 'someone' } } : p)) };
    expect(PolicyBaselineSchema.safeParse(named).success).toBe(false);
  });
});

describe('policyBaselineLineDiff (#4128 BC-02)', () => {
  it('lists changed lines with two lines of context', () => {
    const r = patch(SHIPPED, [{ policy_id: 'CPB-LOG-02', params: { min_days: 365 } }]);
    if (!r.ok) throw new Error('patch failed');
    const d = policyBaselineLineDiff(SHIPPED, r.text);
    expect(d.filter((l) => l.startsWith('- ') || l.startsWith('+ '))).toEqual(['-       min_days: 180', '+       min_days: 365']);
    expect(d[0]).toMatch(/^@@ line \d+ @@$/);
    expect(d).toHaveLength(7); // header, 2 context, 2 changed, 2 context
  });
});

describe('applyPolicyBaselineChanges (#4128 BC-03)', () => {
  it('sets the state and merges params in memory, as the line patch does', async () => {
    const { applyPolicyBaselineChanges } = await import('./policy-baseline-patch.js');
    const doc = docOf(SHIPPED);
    const next = applyPolicyBaselineChanges(doc, [{ policy_id: 'CPB-ENC-02', params: { min_tls_version: '1.3' } }, { policy_id: 'CPB-SVC-01', state: 'enabled' }]);
    expect(next.policies.find((p) => p.id === 'CPB-ENC-02')?.params).toEqual({ min_tls_version: '1.3', applies_to: ['load_balancer', 'api_gateway', 'cdn'] });
    expect(next.policies.find((p) => p.id === 'CPB-SVC-01')?.state).toBe('enabled');
    expect(doc.policies.find((p) => p.id === 'CPB-SVC-01')?.state).toBe('disabled');
    const r = patch(SHIPPED, [{ policy_id: 'CPB-ENC-02', params: { min_tls_version: '1.3' } }, { policy_id: 'CPB-SVC-01', state: 'enabled' }]);
    if (!r.ok) throw new Error('patch failed');
    expect(docOf(r.text).policies).toEqual(next.policies);
  });
});
