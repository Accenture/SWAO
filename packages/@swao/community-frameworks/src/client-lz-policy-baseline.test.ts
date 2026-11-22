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

// Content guards for the shipped Client LZ Policy Baseline (#3863, Design 123
// sections 6.1, 6.2 and 10; owner decisions D-02 to D-06, D-08, D-19).
//
// B1: the folder exists in both copies, byte-identical
// B2: policy-baseline.yaml loads with the #3862 loader (status ok)
// B3: exactly the 20 policies of Design 123 section 6.2, each with its own control
// B4: every policy has a default_source; every maps_to id exists in a shipped framework
// B5: fully populated (D-06): every category has a policy, every parameter is set
// B6: default states (D-19: CPB-SVC-01 disabled with the AI and ML list filled; D-04: DE)
// B7: every capability tag is in the bundled LZ catalogue vocabulary
// B8: every assumption default is listed in the README
// B9: framework-meta: id, scope [app, lz], no sovereignty_requirements, versions agree
// B10: policy-guidance.yaml (#4128 BC-06, Design 123 section 17.4): loads, an entry per
//      shipped policy and per kind, every option's params pass the kind's schema, a source per option

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  loadPolicyBaseline,
  loadPolicyGuidance,
  policyGuidanceOptionErrors,
  POLICY_KINDS,
  policyBaselineCapabilityTags,
  policyKindParamNames,
  POLICY_CATEGORIES,
  type Policy,
  type PolicyBaseline,
} from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, '..', 'frameworks');
const SWAO_ROOT = join(__dirname, '..', '..', '..', '..');
const STANDALONE_DIR = join(SWAO_ROOT, 'community-frameworks');
const LZ_CATALOGUES_DIR = join(SWAO_ROOT, 'lz-catalogues');
const FOLDER = 'client-lz-policy-baseline';
const DIR = join(FRAMEWORKS_DIR, FOLDER);
const ID = 'CLIENT_LZ_POLICY_BASELINE';

/** Design 123 section 6.2 (the content contract of #3863). */
const EXPECTED_IDS = [
  'CPB-RES-01', 'CPB-RES-02', 'CPB-RES-03',
  'CPB-SVC-01', 'CPB-SVC-02', 'CPB-SVC-03',
  'CPB-ENC-01', 'CPB-ENC-02',
  'CPB-NET-01', 'CPB-NET-02', 'CPB-NET-03',
  'CPB-IAM-01', 'CPB-IAM-02',
  'CPB-LOG-01', 'CPB-LOG-02',
  'CPB-TAG-01', 'CPB-AVL-01', 'CPB-BCK-01', 'CPB-COST-01', 'CPB-PRT-01',
];
const AI_ML_TAGS = ['managed_llm', 'ml_inference', 'ml_training', 'ml_speech', 'ml_translation', 'ml_vision', 'ml_nlp'];
const DISABLED_BY_DEFAULT = ['CPB-SVC-01', 'CPB-SVC-02', 'CPB-SVC-03'];

function listFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

interface Control { id: string; maps_to?: string[] }
function controlsOf(dir: string): Control[] {
  const raw = load(readFileSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'), 'utf-8')) as { controls?: Control[] };
  return raw.controls ?? [];
}

const loaded = loadPolicyBaseline(DIR, ID, { shippedPolicyIds: new Set(EXPECTED_IDS) });
const baseline: PolicyBaseline | null = loaded.baseline;
const policies: Policy[] = baseline?.policies ?? [];
const byId = new Map(policies.map((p) => [p.id, p] as const));

describe('Client LZ Policy Baseline content (#3863)', () => {
  it('B1: present in the package and the standalone copy, byte-identical', () => {
    expect(existsSync(DIR)).toBe(true);
    const sa = join(STANDALONE_DIR, FOLDER);
    expect(existsSync(sa), 'standalone copy missing').toBe(true);
    const files = listFiles(DIR);
    expect(files).toEqual(['README.md', 'controls.yaml', 'framework-meta.yaml', 'policy-baseline.yaml', 'policy-guidance.yaml', 'service-controls.yaml']);
    expect(listFiles(sa)).toEqual(files);
    for (const f of files) {
      expect(readFileSync(join(sa, f)).equals(readFileSync(join(DIR, f))), `${f} differs`).toBe(true);
    }
  });

  it('B2: policy-baseline.yaml passes the loader', () => {
    expect(loaded.errors).toEqual([]);
    expect(loaded.status).toBe('ok');
    expect(baseline?.framework).toBe(ID);
    expect(baseline?.baseline_of).toBe(ID);
  });

  it('B3: exactly the 20 policies of Design 123 section 6.2, each with the control of the same id', () => {
    expect(policies.map((p) => p.id)).toEqual(EXPECTED_IDS);
    const controlIds = controlsOf(FOLDER).map((c) => c.id);
    expect(controlIds).toEqual(EXPECTED_IDS);
    for (const p of policies) expect(p.control, p.id).toBe(p.id);
  });

  it('B4: every policy has a default_source and every maps_to id exists in a shipped framework', () => {
    for (const p of policies) expect(p.default_source.trim().length, p.id).toBeGreaterThan(0);
    const shippedIds = new Set<string>();
    for (const d of readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === FOLDER || d.name.startsWith('_')) continue;
      for (const c of controlsOf(d.name)) shippedIds.add(c.id);
    }
    const mapped = controlsOf(FOLDER).flatMap((c) => (c.maps_to ?? []).map((m) => [c.id, m] as const));
    expect(mapped.length).toBeGreaterThan(20);
    expect(mapped.filter(([, m]) => !shippedIds.has(m)).map(([c, m]) => `${c} -> ${m}`)).toEqual([]);
    // A control without maps_to has a pure assumption default.
    for (const c of controlsOf(FOLDER).filter((x) => (x.maps_to ?? []).length === 0)) {
      expect(byId.get(c.id)?.default_source, c.id).toMatch(/assumption/);
    }
  });

  it('B5: fully populated (D-06): every category has a policy and every parameter of every policy is set', () => {
    expect([...new Set(policies.map((p) => p.category))].sort()).toEqual([...POLICY_CATEGORIES].sort());
    const kindsWithAllParams = new Map<string, Set<string>>();
    for (const p of policies) {
      const set = kindsWithAllParams.get(p.kind) ?? new Set<string>();
      for (const [k, v] of Object.entries(p.params)) if (v !== undefined) set.add(k);
      kindsWithAllParams.set(p.kind, set);
    }
    // region_residency spreads its four parameters over CPB-RES-01 to 03; every other policy sets all of its own.
    for (const [kind, set] of kindsWithAllParams) {
      expect([...set].sort(), kind).toEqual(policyKindParamNames(kind as Policy['kind']).sort());
    }
    for (const p of policies.filter((x) => x.kind !== 'region_residency')) {
      const given = p.params as Record<string, unknown>;
      expect(policyKindParamNames(p.kind).filter((n) => given[n] === undefined), p.id).toEqual([]);
    }
  });

  it('B6: default states and values (D-04, D-19)', () => {
    for (const p of policies) {
      expect(p.state, p.id).toBe(DISABLED_BY_DEFAULT.includes(p.id) ? 'disabled' : 'enabled');
    }
    const svc01 = byId.get('CPB-SVC-01');
    expect(svc01?.kind).toBe('service_deny');
    expect(svc01?.kind === 'service_deny' ? svc01.params.capabilities : []).toEqual(AI_ML_TAGS);
    const svc03 = byId.get('CPB-SVC-03');
    expect(svc03?.kind === 'service_deny' ? svc03.params.capabilities : []).toEqual(['postgresql']);
    const res01 = byId.get('CPB-RES-01');
    expect(res01?.kind === 'region_residency' ? res01.params.allowed_countries : []).toEqual(['DE']);
  });

  it('B7: every capability tag is in the bundled LZ catalogue vocabulary', () => {
    const vocabulary = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (k === 'fulfills' && Array.isArray(v)) v.forEach((t) => { if (typeof t === 'string') vocabulary.add(t); });
          else walk(v);
        }
      }
    };
    for (const f of readdirSync(LZ_CATALOGUES_DIR)) {
      if (f.endsWith('.json') && !f.startsWith('_')) walk(JSON.parse(readFileSync(join(LZ_CATALOGUES_DIR, f), 'utf-8')));
    }
    expect(vocabulary.size).toBeGreaterThan(50);
    const tags = baseline ? policyBaselineCapabilityTags(baseline) : [];
    expect(tags.length).toBeGreaterThan(20);
    expect(tags.filter((t) => !vocabulary.has(t))).toEqual([]);
  });

  it('B8: every assumption default is listed in the README', () => {
    const readme = readFileSync(join(DIR, 'README.md'), 'utf-8');
    const section = readme.slice(readme.indexOf('## Sourced defaults and assumptions'));
    const assumed = policies.filter((p) => /assumption/.test(p.default_source)).map((p) => p.id);
    expect(assumed.length).toBeGreaterThanOrEqual(15);
    for (const id of assumed) expect(section, id).toContain(`| ${id} |`);
  });

  it('B9: framework-meta declares the id and both assessment types, without a sovereignty block', () => {
    const meta = (load(readFileSync(join(DIR, 'framework-meta.yaml'), 'utf-8')) as { framework: Record<string, unknown> }).framework;
    expect(meta['id']).toBe(ID);
    expect(meta['assessment_type_scope']).toEqual(['app', 'lz']);
    expect(meta['sovereignty_requirements']).toBeUndefined();
    expect(meta['catalogue_version']).toBe(baseline?.catalogue_version);
    expect(meta['name']).toBe('Client LZ Policy Baseline (German public agency default)');
  });
});

describe('Client LZ Policy Baseline guidance (#4128 BC-06)', () => {
  const g = loadPolicyGuidance(DIR, ID);
  it('B10: policy-guidance.yaml loads and is marked as owner-reviewed (O-4, 2026-11-09)', () => {
    expect(g.errors).toEqual([]);
    expect(g.status).toBe('ok');
    expect(g.guidance?.status).toBe('reviewed');
  });
  it('B10: an entry per shipped policy with a question, at least two options, each with pros, cons and a source', () => {
    const entries = g.guidance?.policies ?? {};
    expect(Object.keys(entries)).toEqual(EXPECTED_IDS);
    for (const id of EXPECTED_IDS) {
      const e = entries[id]!;
      expect(e.question.endsWith('?'), id).toBe(true);
      expect(e.options.length, id).toBeGreaterThanOrEqual(2);
      for (const o of e.options) expect(/\(frameworks\/[^)]*\.yaml:\d+/.test(o.source) || /assumption/.test(o.source), `${id}: ${o.source}`).toBe(true);
    }
  });
  it('B10: the params of every option pass the parameter schema of the kind', () => {
    const errors = policies.flatMap((p) => policyGuidanceOptionErrors(p.kind, g.guidance!.policies[p.id]!, p.id));
    expect(errors).toEqual([]);
  });
  it('B10: a fallback entry per kind for client-added policies', () => {
    expect(Object.keys(g.guidance?.kinds ?? {}).sort()).toEqual([...POLICY_KINDS].sort());
    const errors = POLICY_KINDS.flatMap((k) => policyGuidanceOptionErrors(k, g.guidance!.kinds[k]!, k));
    expect(errors).toEqual([]);
  });
  it('B10: no em or en dashes in the guidance prose', () => {
    const text = readFileSync(join(DIR, 'policy-guidance.yaml'), 'utf-8');
    expect(text.includes(String.fromCharCode(0x2014)) || text.includes(String.fromCharCode(0x2013))).toBe(false);
  });
});
