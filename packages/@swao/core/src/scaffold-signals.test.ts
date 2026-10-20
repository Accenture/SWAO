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

// SCAFFOLD.* signal catalogue (#3083).
import { describe, it, expect } from 'vitest';
import { SCAFFOLD_SIGNALS, SCAFFOLD_SIGNAL_CODES, ScaffoldSignalSchema, ScaffoldSignalsFileSchema, scaffoldSignal } from './scaffold-signals.js';
import { SIGNAL_ID_REGEX, SignalSchema } from './signals.js';

describe('SCAFFOLD signal catalogue (#3083)', () => {
  it('defines the six SCAFFOLD.* types with unique SCAF-NN ids', () => {
    expect(SCAFFOLD_SIGNAL_CODES).toEqual([
      'SCAFFOLD.DUPLICATE_ID',
      'SCAFFOLD.CLUSTER_DETECTED',
      'SCAFFOLD.CATEGORY_UNKNOWN',
      'SCAFFOLD.ID_FLAG_DETECTED',
      'SCAFFOLD.PII_FIELD_SCRUBBED',
      'SCAFFOLD.MANDATORY_FIELD_MISSING',
    ]);
    const ids = Object.values(SCAFFOLD_SIGNALS).map((d) => d.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('builds signals that keep the Signal interface (every Signal field validates)', () => {
    const s = scaffoldSignal('SCAFFOLD.CATEGORY_UNKNOWN', {
      derivation: 'No INFRA-CAT entry matched this app; assign infra_category manually.',
      evidence: ['sheet "S" row 2'],
      appId: 'hosapp045',
    });
    expect(ScaffoldSignalSchema.parse(s)).toMatchObject({ id: 'SCAF-03', code: 'SCAFFOLD.CATEGORY_UNKNOWN', severity: 'medium', app_id: 'hosapp045' });
    const { id: _id, code: _code, app_id: _app, ...rest } = s;
    expect(() => SignalSchema.omit({ id: true }).parse(rest)).not.toThrow();
  });

  it('does not widen the WSP signal id vocabulary', () => {
    expect(SIGNAL_ID_REGEX.test('SCAF-01')).toBe(false);
  });

  it('validates the scaffold-signals.json file shape, defaulting warnings to []', () => {
    const file = ScaffoldSignalsFileSchema.parse({ generated_at: 'x', source: 'intake.xlsx', counts: { 'SCAFFOLD.DUPLICATE_ID': 0 }, signals: [] });
    expect(file.warnings).toEqual([]);
  });
});
