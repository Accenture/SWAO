import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSESS_SRC = resolve(__dirname, '../commands/assess.ts');
// #4286: the flattening moved to findings-doc.ts (buildFindingsDoc), which adds the
// reason for a run that evaluated no framework; behaviour tests in findings-doc.test.ts.
const FINDINGS_SRC = resolve(__dirname, '../commands/findings-doc.ts');

describe('commands/assess.ts -- findings.yaml populated from compliance controls (#2674)', () => {
  it('extracts findings from compliance.regimes in wsp-plan.yaml', () => {
    expect(readFileSync(ASSESS_SRC, 'utf-8')).toContain('buildFindingsDoc(planRaw?.compliance?.regimes ?? [], assessedAt, runDir)');
    const src = readFileSync(FINDINGS_SRC, 'utf-8');
    expect(src).toContain('flatMap');
    expect(src).toContain('regime.controls ?? []');
  });

  it('writes flat findings with required fields: id, title, severity, outcome, regime, assessed_at', () => {
    const src = readFileSync(FINDINGS_SRC, 'utf-8');
    expect(src).toContain("ctrl['id']");
    expect(src).toContain("ctrl['title']");
    expect(src).toContain("ctrl['severity']");
    expect(src).toContain("ctrl['outcome']");
    expect(src).toContain('regime.id');
    expect(src).toContain("ctrl['assessed_at']");
  });

  it('writes findings.yaml using yaml dump (not the empty placeholder string)', () => {
    const src = readFileSync(ASSESS_SRC, 'utf-8');
    expect(src).toContain("writeFileSync(join(runDir, 'findings.yaml'), dump(buildFindingsDoc(");
    expect(src).not.toContain("'findings:\\n  []\\n'");
  });
});
