// #4050 (Design 120 section 8.4): document-only evaluation of the organisational
// controls (`layer: governance`) of a Landing Zone Live Assessment. Synthetic
// controls and document names only.
import { describe, it, expect } from 'vitest';
import { LzOrganisationalResultSchema } from '@swao/core';
import { evaluateLzOrganisationalControls, lzOrganisationalControls, toLzOrganisationalResult } from '../lz-organisational-eval.js';
import type { LzOrganisationalCatalogControl, LzOrganisationalDocument } from '../lz-organisational-eval.js';

const FOLDER = 'landing-zones/otc-test/ingestion';
const gov = (id: string, inputs: string[], extra: Partial<LzOrganisationalCatalogControl> = {}): LzOrganisationalCatalogControl => ({
  id, title: `Control ${id}`, severity_default: 'high', layer: 'governance', assessment_type_scope: ['app', 'aud', 'lz'],
  evidence_basis: inputs.map((i) => ({ context_input: i })), ...extra,
});
const CONTROLS: LzOrganisationalCatalogControl[] = [
  gov('ORG_1', ['ict_risk_management_framework']),
  gov('ORG_2', ['incident_classification_policy', 'incident_reporting_procedure']),
  gov('ORG_3', ['register_of_information']),
  gov('ORG_TLPT', ['tlpt_report'], { applies_when: { dora_tlpt_required: 'true' } }),
  gov('ORG_NONE', []),
  gov('ORG_APP_ONLY', ['exit_plan'], { assessment_type_scope: ['app'] }),
  { id: 'RUN_1', title: 'Runtime control', layer: 'runtime', assessment_type_scope: ['lz'], evidence_basis: [{ context_input: 'ict_risk_management_framework' }] },
];
const doc = (source: string, readable = true): LzOrganisationalDocument => ({ source, category: 'compliance', readable });
const run = (documents: LzOrganisationalDocument[], frameworkContext?: Record<string, string>) =>
  evaluateLzOrganisationalControls({ frameworks: [{ id: 'DORA', version: '2.0.0', controls: CONTROLS }], documents, folder: FOLDER, ...(frameworkContext ? { frameworkContext } : {}) });
const byId = (e: ReturnType<typeof run>) => new Map(e.frameworks[0]!.controls.map((c) => [c.id, c] as const));

describe('lzOrganisationalControls (#4050)', () => {
  it('keeps governance controls scoped to lz or unscoped; drops runtime and app-only controls', () => {
    expect(lzOrganisationalControls(CONTROLS).map((c) => c.id)).toEqual(['ORG_1', 'ORG_2', 'ORG_3', 'ORG_TLPT', 'ORG_NONE']);
    expect(lzOrganisationalControls([gov('X', ['a'], { assessment_type_scope: [] })]).map((c) => c.id)).toEqual(['X']);
  });
});

describe('evaluateLzOrganisationalControls (#4050)', () => {
  it('without documents every control stays UNKNOWN with a reason naming the folder; never GAP, never a pass', () => {
    const c = byId(run([]));
    for (const id of ['ORG_1', 'ORG_2', 'ORG_3']) {
      expect(c.get(id)).toMatchObject({ outcome: 'UNKNOWN', reason: 'no_documents' });
      expect(c.get(id)!.rationale).toContain(`${FOLDER}/`);
    }
    expect(c.get('ORG_2')!.missing_input).toEqual(['incident_classification_policy', 'incident_reporting_procedure']);
    expect([...c.values()].some((x) => (x.outcome as string) === 'GAP' || x.outcome === 'SATISFIED')).toBe(false);
  });

  it('decides from documents named after the expected inputs: all present SATISFIED, some PARTIAL, none UNKNOWN', () => {
    const e = run([doc('ICT-Risk-Management-Framework_v3.pdf'), doc('policies/Incident Classification Policy.docx'), doc('unrelated-notes.md')]);
    const c = byId(e);
    expect(c.get('ORG_1')).toMatchObject({ outcome: 'SATISFIED', reason: 'all_documents', found_inputs: ['ict_risk_management_framework'], missing_input: [], sources: ['ICT-Risk-Management-Framework_v3.pdf'] });
    expect(c.get('ORG_1')!.rationale).toMatch(/not their content/);
    expect(c.get('ORG_2')).toMatchObject({ outcome: 'PARTIAL', reason: 'some_documents', found_inputs: ['incident_classification_policy'], missing_input: ['incident_reporting_procedure'] });
    expect(c.get('ORG_3')).toMatchObject({ outcome: 'UNKNOWN', reason: 'no_matching_document', missing_input: ['register_of_information'], sources: [] });
    expect(e.documents).toEqual({ total: 3, readable: 3, matched: 2 });
  });

  it('a matching document without extractable text does not decide the control', () => {
    const c = byId(run([doc('register_of_information.pdf', false)]));
    expect(c.get('ORG_3')).toMatchObject({ outcome: 'UNKNOWN', reason: 'unreadable_document', found_inputs: [] });
  });

  it('applies_when against the workspace framework_context: missing key N_A, matching key evaluated', () => {
    expect(byId(run([doc('tlpt_report.md')])).get('ORG_TLPT')).toMatchObject({ outcome: 'N_A', reason: 'not_applicable' });
    expect(byId(run([doc('tlpt_report.md')], { dora_tlpt_required: 'true' })).get('ORG_TLPT')).toMatchObject({ outcome: 'SATISFIED' });
  });

  it('a control without an expected input cannot be decided from documents', () => {
    expect(byId(run([doc('anything.md')])).get('ORG_NONE')).toMatchObject({ outcome: 'UNKNOWN', reason: 'no_expected_input' });
  });
});

describe('toLzOrganisationalResult (#4050)', () => {
  it('replaces document paths by evidence references and carries no file name; counts per framework', () => {
    const e = run([doc('ICT-Risk-Management-Framework_v3.pdf'), doc('Incident Classification Policy.docx')]);
    const ref = 'ev:2026-11-07T20-00-00:document:Ref-0123456789';
    const r = toLzOrganisationalResult(e, { lzId: 'otc-test', runId: '2026-11-07T20-00-00', generatedAt: '2026-11-07T20:00:00Z', refOf: (s) => (s.startsWith('ICT') ? ref : undefined) });
    expect(LzOrganisationalResultSchema.parse(r)).toEqual(r);
    const json = JSON.stringify(r);
    expect(json).not.toContain('ICT-Risk-Management-Framework_v3');
    expect(json).not.toContain('Incident Classification Policy');
    const fw = r.frameworks[0]!;
    expect(fw.controls.find((c) => c.id === 'ORG_1')!.evidence_refs).toEqual([ref]);
    // A path without a reference (no evidence map) is dropped, not written.
    expect(fw.controls.find((c) => c.id === 'ORG_2')!.evidence_refs).toEqual([]);
    expect(fw.counts).toEqual({ satisfied: 1, partial: 1, unknown: 2, n_a: 1 });
    // ORG_APP_ONLY is a governance control scoped to app only: counted, not decided.
    expect(fw.out_of_scope).toBe(1);
  });
});
