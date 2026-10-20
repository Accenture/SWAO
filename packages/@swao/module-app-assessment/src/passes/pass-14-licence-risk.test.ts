// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3160: Pass 14 classifies ORT declared licences with licence-risk-catalogue.yaml
// (MAL-10 copyleft with risk tiers, MAL-13 non-commercial or no-derivatives).

import { describe, it, expect } from 'vitest';
import { SignalSchema } from '@swao/core';
import { loadLicenceRiskCatalogue, type LicenceRiskCatalogue } from '../catalogue/reference-catalogues.js';
import { classifyLicenceExpression, mapOrtAnalyzerCopyleft, mapOrtLicenceRestricted } from './pass-14-malware.js';

function catalogue(): LicenceRiskCatalogue {
  const r = loadLicenceRiskCatalogue();
  if (!r.ok) throw new Error(r.reason);
  return r.data;
}

/** ORT analyzer-result fixture (shape as read by extractOrtPackages). */
const ORT_FIXTURE = {
  analyzer: {
    result: {
      packages: [
        { id: 'NPM::permissive:1.0.0', declared_licenses: ['MIT'] },
        { id: 'NPM::dual:1.0.0', declared_licenses: ['MIT OR GPL-2.0-only'] },
        { id: 'NPM::sspl-lib:1.0.0', declared_licenses: ['SSPL-1.0'] },
        { package: { id: 'NPM::affero:2.0.0', declared_licenses: ['AGPL-3.0-or-later'] } },
        { id: 'Maven:org.eclipse:epl-lib:1.0', declared_licenses: ['EPL-2.0'] },
        { id: 'NPM::nc-data:1.0.0', declared_licenses: ['CC-BY-NC-4.0'] },
        { id: 'Go::busl-lib:1.0.0', declared_licenses: ['BUSL-1.1'] },
      ],
    },
  },
};

describe('classifyLicenceExpression', () => {
  const cat = catalogue();
  it('looks up SPDX IDs, including deprecated forms', () => {
    expect(classifyLicenceExpression('AGPL-3.0-only', cat)).toBe('critical');
    expect(classifyLicenceExpression('GPL-2.0+', cat)).toBe('high');
    expect(classifyLicenceExpression('LGPL-2.1', cat)).toBe('medium');
    expect(classifyLicenceExpression('mit', cat)).toBe('clear');
  });

  it('OR takes the least risky alternative, AND the riskiest term', () => {
    expect(classifyLicenceExpression('MIT OR GPL-2.0-only', cat)).toBe('clear');
    expect(classifyLicenceExpression('(MIT AND GPL-3.0-only)', cat)).toBe('high');
    expect(classifyLicenceExpression('GPL-2.0-only WITH Classpath-exception-2.0', cat)).toBe('high');
  });

  it('returns null when nothing in the expression is listed', () => {
    expect(classifyLicenceExpression('LicenseRef-proprietary', cat)).toBeNull();
    expect(classifyLicenceExpression('', cat)).toBeNull();
  });

  it('#3296: lists EPL, CDDL, OSL, CeCILL, BUSL-1.1 and Elastic-2.0', () => {
    expect(classifyLicenceExpression('EPL-2.0', cat)).toBe('medium');
    expect(classifyLicenceExpression('EPL-1.0', cat)).toBe('medium');
    expect(classifyLicenceExpression('CDDL-1.1', cat)).toBe('medium');
    expect(classifyLicenceExpression('OSL-3.0', cat)).toBe('critical');
    expect(classifyLicenceExpression('CeCILL-2.1', cat)).toBe('high');
    expect(classifyLicenceExpression('CeCILL-C', cat)).toBe('medium');
    expect(classifyLicenceExpression('CeCILL-B', cat)).toBe('clear');
    expect(classifyLicenceExpression('BUSL-1.1', cat)).toBe('high');
    expect(classifyLicenceExpression('Elastic-2.0', cat)).toBe('high');
  });

  it('#3296: the catalogue header names the consumer prefix', () => {
    expect(cat.signal_prefix).toBe('MAL');
  });
});

describe('mapOrtAnalyzerCopyleft with the catalogue', () => {
  it('adds SSPL, resolves dual licences, keeps the regex fallback, names network copyleft (severity stays high)', () => {
    const sig = mapOrtAnalyzerCopyleft(ORT_FIXTURE, catalogue());
    expect(sig).not.toBeNull();
    expect(() => SignalSchema.parse(sig)).not.toThrow();
    expect(sig!.severity).toBe('high');
    expect(sig!.derivation).toContain('network copyleft');
    const ev = sig!.evidence.join('\n');
    expect(ev).toContain('sspl-lib');
    expect(ev).toContain('AGPL-3.0-or-later (risk tier critical)');
    expect(ev).toContain('EPL-2.0 (risk tier medium)'); // listed since #3296
    expect(ev).not.toContain('dual'); // MIT OR GPL-2.0-only resolves to MIT
    expect(ev).not.toContain('nc-data');
    expect(ev).not.toContain('busl-lib'); // source-available, not copyleft: MAL-13
    expect(sig!.evidence).toHaveLength(3);
  });

  it('without the catalogue behaves as before (regex only, high)', () => {
    const sig = mapOrtAnalyzerCopyleft(ORT_FIXTURE);
    expect(sig!.severity).toBe('high');
    // anchored regexes: AGPL and EPL only; SSPL is missed without the catalogue
    expect(sig!.evidence).toEqual(['NPM::affero:2.0.0: AGPL-3.0-or-later', 'Maven:org.eclipse:epl-lib:1.0: EPL-2.0']);
  });
});

describe('mapOrtLicenceRestricted (MAL-13)', () => {
  it('flags non-commercial, no-derivatives and source-available licences', () => {
    const sig = mapOrtLicenceRestricted(ORT_FIXTURE, catalogue());
    expect(sig).not.toBeNull();
    expect(() => SignalSchema.parse(sig)).not.toThrow();
    expect(sig!.id).toBe('MAL-13');
    expect(sig!.severity).toBe('medium'); // BUSL-1.1 is source-available (#3296)
    expect(sig!.evidence).toEqual([
      'NPM::nc-data:1.0.0: CC-BY-NC-4.0 (restricted_use)',
      'Go::busl-lib:1.0.0: BUSL-1.1 (source_available)',
    ]);
  });

  it('non-commercial terms alone stay low', () => {
    const sig = mapOrtLicenceRestricted({ analyzer: { result: { packages: [{ id: 'nc', declared_licenses: ['CC-BY-NC-ND-4.0'] }] } } }, catalogue());
    expect(sig!.severity).toBe('low');
  });

  it('returns null when no dependency carries such a licence', () => {
    expect(mapOrtLicenceRestricted({ analyzer: { result: { packages: [{ id: 'a', declared_licenses: ['MIT'] }] } } }, catalogue())).toBeNull();
  });
});
