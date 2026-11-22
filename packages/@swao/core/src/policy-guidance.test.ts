// #4128 BC-06 (Design 123 section 17.4): policy-guidance.yaml schema and loader.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POLICY_GUIDANCE_FILE, loadPolicyGuidance, policyGuidanceFor, policyGuidanceOptionErrors, PolicyGuidanceSchema } from './policy-guidance.js';

const option = { params: { min_days: 365 }, summary: 's', pros: ['p'], cons: ['c'], source: 'assumption' };
const valid = {
  schema_version: '0.1',
  framework: 'CLIENT_LZ_POLICY_BASELINE',
  status: 'draft',
  policies: { 'CPB-LOG-02': { question: 'How long?', options: [option] } },
  kinds: { log_retention: { question: 'How long in general?' } },
};

describe('policy-guidance.yaml (#4128 BC-06)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-pg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads a valid file, reports absent, and never throws on bad YAML', () => {
    expect(loadPolicyGuidance(dir).status).toBe('absent');
    writeFileSync(join(dir, POLICY_GUIDANCE_FILE), JSON.stringify(valid));
    const r = loadPolicyGuidance(dir, 'CLIENT_LZ_POLICY_BASELINE');
    expect(r.status).toBe('ok');
    expect(loadPolicyGuidance(dir, 'OTHER').status).toBe('invalid');
    writeFileSync(join(dir, POLICY_GUIDANCE_FILE), 'policies: [unclosed');
    expect(loadPolicyGuidance(dir).errors[0]).toMatch(/^not valid YAML/);
  });

  it('is strict: unknown keys, a client policy id as key and an unknown status are refused', () => {
    expect(PolicyGuidanceSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(PolicyGuidanceSchema.safeParse({ ...valid, policies: { 'X-ORG-LOG-01': valid.policies['CPB-LOG-02'] } }).success).toBe(false);
    expect(PolicyGuidanceSchema.safeParse({ ...valid, status: 'final' }).success).toBe(false);
    expect(PolicyGuidanceSchema.safeParse({ ...valid, kinds: { not_a_kind: { question: 'q' } } }).success).toBe(false);
  });

  it('finds the policy entry, falls back to the kind entry, else null', () => {
    const g = PolicyGuidanceSchema.parse(valid);
    expect(policyGuidanceFor(g, { id: 'CPB-LOG-02', kind: 'log_retention' })?.via).toBe('policy');
    expect(policyGuidanceFor(g, { id: 'X-ORG-LOG-01', kind: 'log_retention' })?.via).toBe('kind');
    expect(policyGuidanceFor(g, { id: 'X-ORG-TAG-01', kind: 'required_tags' })).toBeNull();
    expect(policyGuidanceFor(null, { id: 'CPB-LOG-02', kind: 'log_retention' })).toBeNull();
  });

  it('checks option params against the kind schema (no coercion)', () => {
    const g = PolicyGuidanceSchema.parse({ ...valid, policies: { 'CPB-LOG-02': { question: 'q', options: [{ ...option, params: { min_days: '365' } }] } } });
    expect(policyGuidanceOptionErrors('log_retention', g.policies['CPB-LOG-02']!, 'CPB-LOG-02')).toHaveLength(1);
    expect(policyGuidanceOptionErrors('log_retention', PolicyGuidanceSchema.parse(valid).policies['CPB-LOG-02']!, 'CPB-LOG-02')).toEqual([]);
  });
});
