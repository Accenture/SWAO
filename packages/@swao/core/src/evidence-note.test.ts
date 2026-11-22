import { describe, it, expect } from 'vitest';
import { isEvidenceNote } from './evidence-note.js';

describe('isEvidenceNote (#4455, #4445)', () => {
  it('treats prose, key=value and key: k=v records as notes', () => {
    expect(isEvidenceNote('Chunks available: 4, all terraform/ snapshots')).toBe(true);
    expect(isEvidenceNote('msi_skipped_reason=no_msi_inputs')).toBe(true);
    expect(isEvidenceNote('topics: eol-status=high, others=null')).toBe(true);
    expect(isEvidenceNote('see the research at https://example.org/x')).toBe(true);
  });
  it('keeps file and path references as references', () => {
    expect(isEvidenceNote('Architecture Overview v2.docx')).toBe(false);
    expect(isEvidenceNote('inputs/context.md')).toBe(false);
    expect(isEvidenceNote('terraform/main.tf: line 12')).toBe(false);
    expect(isEvidenceNote('app.py')).toBe(false);
    expect(isEvidenceNote('')).toBe(false);
  });
});
