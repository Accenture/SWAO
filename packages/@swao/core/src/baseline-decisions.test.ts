// #3981 (Design 123 section 8.4): ranked contributions of the baseline decisions,
// the persisted file reader and the summary lines.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINE_DECISIONS_FILE, baselineContributionLabel, formatBaselineDecisionLines, formatBaselineContributions, rankBaselineContributions, readBaselineDecisions, type BaselineControlDecisions } from './baseline-decisions.js';
import { lzProviderBrand } from './lz-provider-brand.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const D: BaselineControlDecisions = {
  source: 'live',
  regimes: {
    FW: {
      'CPB-LOG-01': { policy_id: 'CPB-LOG-01', outcome: 'GAP', rationale: 'r', contributions: [
        { scope_id: 'app', provider: 'otc', outcome: 'GAP', rationale: 'estate fail' },
        { scope_id: 'platform', provider: 'otc', outcome: 'PARTIAL', rationale: 'estate warn' },
      ] },
      'CPB-SVC-01': { policy_id: 'CPB-SVC-01', outcome: 'SATISFIED', rationale: 'r' },
      'CPB-IAM-01': { policy_id: 'CPB-IAM-01', outcome: 'UNKNOWN', rationale: 'r' },
    },
  },
};

describe('baseline decisions (#3981)', () => {
  it('ranks worst first, stable on ties', () => {
    const r = rankBaselineContributions([
      { target: 'a/1', provider: 'a', outcome: 'SATISFIED', rationale: 'x' },
      { target: 'a/2', provider: 'a', outcome: 'GAP', rationale: 'x' },
      { target: 'a/3', provider: 'a', outcome: 'N_A', rationale: 'x' },
      { target: 'a/4', provider: 'a', outcome: 'GAP', rationale: 'x' },
      { target: 'a/5', provider: 'a', outcome: 'UNKNOWN', rationale: 'x' },
    ]);
    expect(r.map((c) => c.target)).toEqual(['a/2', 'a/4', 'a/5', 'a/1', 'a/3']);
    expect(formatBaselineContributions(r.slice(0, 1))).toEqual(['  1. GAP       a/2']);
  });

  it('summary lines: counts, controls worst first, ranked contributions, no rationale text', () => {
    const lines = formatBaselineDecisionLines(D);
    expect(lines[0]).toBe('Baseline decisions FW (source live): 3 controls, 1 SATISFIED, 1 GAP, 1 UNKNOWN');
    expect(lines[1]).toMatch(/^ {2}CPB-LOG-01 +GAP +ranked: 1\. GAP scope app \(OTC, T Cloud Public\), 2\. PARTIAL scope platform \(OTC, T Cloud Public\)$/);
    expect(lines[2]).toMatch(/CPB-IAM-01 +UNKNOWN/);
    expect(lines[3]).toMatch(/CPB-SVC-01 +SATISFIED/);
    expect(lines.join('\n')).not.toContain('estate fail');
    expect(formatBaselineDecisionLines(D, 1).at(-1)).toBe('  ... 2 more');
    expect(formatBaselineDecisionLines({ source: 'none', regimes: {}, reason: 'no LZ target' })).toEqual(['Baseline decisions (source none): none, no LZ target']);
  });

  it('#4005: a scope label names the provider brand, a catalogue label keeps provider/region; the persisted provider stays the id', () => {
    expect(baselineContributionLabel({ scope_id: 'platform', provider: 'otc', outcome: 'GAP', rationale: 'x' })).toBe('scope platform (OTC, T Cloud Public)');
    expect(baselineContributionLabel({ scope_id: 'p', provider: 'stackit', outcome: 'GAP', rationale: 'x' })).toBe('scope p (STACKIT)');
    expect(baselineContributionLabel({ target: 'otc/eu-de', provider: 'otc', region: 'eu-de', outcome: 'GAP', rationale: 'x' })).toBe('otc/eu-de');
    expect(lzProviderBrand('otc')).toBe('OTC, T Cloud Public');
    expect(lzProviderBrand('aws-esc')).toBe('AWS ESC, AWS European Sovereign Cloud');
    expect(lzProviderBrand('azure')).toBe('Azure, Microsoft Azure');
    expect(D.regimes['FW']?.['CPB-LOG-01']?.contributions?.[0]?.provider).toBe('otc');
  });

  it('reads the persisted file; absent or invalid is null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-bd-'));
    tmp.push(dir);
    expect(readBaselineDecisions(dir)).toBeNull();
    writeFileSync(join(dir, BASELINE_DECISIONS_FILE), JSON.stringify(D));
    expect(readBaselineDecisions(dir)).toEqual(D);
    writeFileSync(join(dir, BASELINE_DECISIONS_FILE), JSON.stringify({ ...D, source: 'other' }));
    expect(readBaselineDecisions(dir)).toBeNull();
  });
});
