// #4050: the lz-organisational-result/1 file of a Landing Zone Live run.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documentNameMatchesInput } from './finding-integrity.js';
import { LZ_ORGANISATIONAL_RESULT_FILE, LzOrganisationalResultSchema, lzOrganisationalCounts, lzOrganisationalDecided, readLzOrganisationalResult } from './lz-organisational-result.js';
import type { LzOrganisationalResult } from './lz-organisational-result.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const RESULT: LzOrganisationalResult = {
  schema: 'lz-organisational-result/1', lz_id: 'otc-test', run_id: '2026-11-07T20-00-00', generated_at: '2026-11-07T20:00:00Z',
  folder: 'landing-zones/otc-test/ingestion', documents: { total: 1, readable: 1, matched: 1 },
  frameworks: [{
    id: 'DORA', version: '2025-01-17', counts: { satisfied: 1, partial: 0, unknown: 1, n_a: 0 }, out_of_scope: 0,
    controls: [
      { id: 'DORA_Art_6', title: 'ICT risk management framework', outcome: 'SATISFIED', reason: 'all_documents', expected_inputs: ['ict_risk_management_framework'], found_inputs: ['ict_risk_management_framework'], missing_input: [], evidence_refs: ['ev:2026-11-07T20-00-00:document:Ref-0123456789'], rationale: 'Documented.' },
      { id: 'DORA_Art_28', title: 'Register of information', outcome: 'UNKNOWN', reason: 'no_matching_document', expected_inputs: ['register_of_information'], found_inputs: [], missing_input: ['register_of_information'], evidence_refs: [], rationale: 'Not evaluated.' },
    ],
  }],
};

describe('lz-organisational-result (#4050)', () => {
  it('counts outcomes and the decided controls', () => {
    expect(lzOrganisationalCounts(RESULT.frameworks[0]!.controls)).toEqual({ satisfied: 1, partial: 0, unknown: 1, n_a: 0 });
    expect(lzOrganisationalDecided(RESULT)).toBe(1);
  });

  it('reads a valid file; a missing, invalid or file-name-carrying reference is null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-lz-org-'));
    tmp.push(dir);
    expect(readLzOrganisationalResult(dir)).toBeNull();
    writeFileSync(join(dir, LZ_ORGANISATIONAL_RESULT_FILE), JSON.stringify(RESULT));
    expect(readLzOrganisationalResult(dir)).toEqual(RESULT);
    const bad = structuredClone(RESULT);
    bad.frameworks[0]!.controls[0]!.evidence_refs = ['policies/ict_risk_management_framework.pdf'];
    expect(LzOrganisationalResultSchema.safeParse(bad).success).toBe(false);
    writeFileSync(join(dir, LZ_ORGANISATIONAL_RESULT_FILE), JSON.stringify({ ...RESULT, frameworks: [{ ...RESULT.frameworks[0], controls: [{ ...RESULT.frameworks[0]!.controls[0], outcome: 'GAP' }] }] }));
    expect(readLzOrganisationalResult(dir)).toBeNull();
  });

  it('documentNameMatchesInput uses the app naming rule: case and separators ignored, blank input never matches', () => {
    expect(documentNameMatchesInput('policies/Register-of-Information_v2.xlsx', 'register_of_information')).toBe(true);
    expect(documentNameMatchesInput('Incident Classification Policy.docx', 'incident_classification_policy')).toBe(true);
    expect(documentNameMatchesInput('policies.pdf', 'incident_classification_policy')).toBe(false);
    expect(documentNameMatchesInput('anything.pdf', '  ')).toBe(false);
  });
});
