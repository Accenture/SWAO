import { describe, expect, it } from 'vitest';
import { loadEvidenceYaml } from './evidence-yaml.js';

describe('loadEvidenceYaml (#4477, #4465)', () => {
  it('tolerates two identical evidence_index keys, the last one wins', () => {
    const text = "evidence_catalogue:\n  EVD-A: { refs: [a] }\n  EVD-B: { refs: [b] }\nevidence_index:\n  'generic-api-key: C:***(117)': EVD-A\n  'generic-api-key: C:***(117)': EVD-B\n";
    const errors: string[] = [];
    const doc = loadEvidenceYaml('x.yaml', () => text, r => errors.push(r)) as { evidence_index: Record<string, string> };
    expect(doc.evidence_index).toEqual({ 'generic-api-key: C:***(117)': 'EVD-B' });
    expect(errors).toEqual([]);
  });

  it('reports a parse failure with its first line only and returns null', () => {
    const calls: Array<[string, string]> = [];
    const doc = loadEvidenceYaml('x.yaml', () => 'a: [unclosed\n  b: c\n', (r, s) => calls.push([r, s]));
    expect(doc).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe('parse');
    expect(calls[0]![0]).not.toContain('\n');
  });

  it('reports a read failure and returns null', () => {
    const calls: string[] = [];
    const doc = loadEvidenceYaml('x.yaml', () => { throw new Error('EACCES: denied'); }, (_r, s) => calls.push(s));
    expect(doc).toBeNull();
    expect(calls).toEqual(['read']);
  });
});
