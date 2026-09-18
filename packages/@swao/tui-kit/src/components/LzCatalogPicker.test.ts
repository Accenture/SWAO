// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library -- LzCatalogPicker unit tests (#1660)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { applyLzCuratedLabels, CURATED_LZ_FW_LABELS } from './LzCatalogPicker.js';

describe('CURATED_LZ_FW_LABELS', () => {
  it('has entry for NIST_SP_800_66R2 (HIPAA alias)', () => {
    expect(CURATED_LZ_FW_LABELS['NIST_SP_800_66R2']).toContain('HIPAA');
  });

  it('does not include sovereignty text in label values -- that belongs in GuidanceBox', () => {
    for (const val of Object.values(CURATED_LZ_FW_LABELS)) {
      expect(val).not.toContain('blocks');
      expect(val).not.toContain('requires EU');
      expect(val).not.toContain('Cloud Act');
    }
  });
});

describe('applyLzCuratedLabels', () => {
  it('generates unified label format: ID  (N controls)', () => {
    const opts = applyLzCuratedLabels([{ id: 'GDPR', controlsCount: 53 }]);
    expect(opts[0].label).toBe('GDPR  (53 controls)');
    expect(opts[0].value).toBe('GDPR');
  });

  it('omits control count when not provided', () => {
    const opts = applyLzCuratedLabels([{ id: 'BSI_C5' }]);
    expect(opts[0].label).toBe('BSI_C5');
  });

  it('applies HIPAA curated name for NIST_SP_800_66R2', () => {
    const opts = applyLzCuratedLabels([{ id: 'NIST_SP_800_66R2', controlsCount: 12 }]);
    expect(opts[0].label).toContain('HIPAA');
    expect(opts[0].label).toContain('12 controls');
    expect(opts[0].value).toBe('NIST_SP_800_66R2');
  });

  it('converts _DEMO suffix to (Demo) display', () => {
    const opts = applyLzCuratedLabels([{ id: 'GDPR_DEMO', controlsCount: 11 }]);
    expect(opts[0].label).toBe('GDPR (Demo)  (11 controls)');
  });

  it('passes through rich metadata fields', () => {
    const opts = applyLzCuratedLabels([{
      id: 'GDPR',
      name: 'General Data Protection Regulation',
      description: 'EU-wide data protection law.',
      authority: 'EU',
      controlsCount: 53,
      slug: 'gdpr',
      contributorName: 'Helmut Schindlwick',
      gate_summary: 'requires EU-entity operator',
    }]);
    expect(opts[0].name).toBe('General Data Protection Regulation');
    expect(opts[0].description).toBe('EU-wide data protection law.');
    expect(opts[0].authority).toBe('EU');
    expect(opts[0].controlsCount).toBe(53);
    expect(opts[0].slug).toBe('gdpr');
    expect(opts[0].contributorName).toBe('Helmut Schindlwick');
    expect(opts[0].gate_summary).toBe('requires EU-entity operator');
  });

  it('returns empty array for empty input', () => {
    expect(applyLzCuratedLabels([])).toHaveLength(0);
  });

  it('preserves original ordering', () => {
    const opts = applyLzCuratedLabels([
      { id: 'NIST_SP_800_66R2' },
      { id: 'GDPR' },
    ]);
    expect(opts[0].value).toBe('NIST_SP_800_66R2');
    expect(opts[1].value).toBe('GDPR');
  });

  it('handles unknown IDs without curated name', () => {
    const opts = applyLzCuratedLabels([{ id: 'MY_CUSTOM_FW', controlsCount: 5 }]);
    expect(opts[0].label).toBe('MY_CUSTOM_FW  (5 controls)');
    expect(opts[0].value).toBe('MY_CUSTOM_FW');
  });
});
