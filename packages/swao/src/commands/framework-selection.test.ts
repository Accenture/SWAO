// #4269: the framework selection event and run-context fields of an app run.
import { describe, it, expect } from 'vitest';
import { frameworkSelection, frameworkSelectionLine, serviceBaselineAdded, serviceRunRegimes } from './framework-selection.js';

const APP = ['GDPR_DEMO', 'AI_10_PILLARS_DEMO', 'NIST_SP_800_66R2_DEMO', 'BSI_GRUNDSCHUTZ_2023_DEMO'];

describe('frameworkSelection (#4269)', () => {
  it('a narrowed run selection: default, chosen and source run-selection; the line names 1 of 4', () => {
    const s = frameworkSelection(APP, ['GDPR_DEMO']);
    expect(s).toEqual({ default: APP, chosen: ['GDPR_DEMO'], source: 'run-selection' });
    expect(frameworkSelectionLine(s)).toBe('[info] Frameworks for this run: GDPR_DEMO (1 of 4 app frameworks chosen for this run; the app default stays GDPR_DEMO, AI_10_PILLARS_DEMO, NIST_SP_800_66R2_DEMO, BSI_GRUNDSCHUTZ_2023_DEMO)');
  });
  it('the default (no selection, or the same set): source app-default and no console line', () => {
    expect(frameworkSelection(APP, undefined)).toEqual({ default: APP, chosen: APP, source: 'app-default' });
    expect(frameworkSelection(APP, [...APP].reverse()).source).toBe('app-default');
    expect(frameworkSelectionLine(frameworkSelection(APP, undefined))).toBeNull();
  });
  it('none chosen', () => {
    expect(frameworkSelectionLine(frameworkSelection(['GDPR_DEMO'], []))).toContain('Frameworks for this run: none (0 of 1 app framework chosen');
  });
});

describe('serviceRunRegimes (#4400)', () => {
  it('a service run always evaluates SWAO_APM; a selection adds frameworks, never removes it', () => {
    expect(serviceRunRegimes('service', ['GDPR_DEMO'], ['SWAO_APM'])).toEqual(['SWAO_APM', 'GDPR_DEMO']);
    expect(serviceRunRegimes('service', [], ['SWAO_APM'])).toEqual(['SWAO_APM']);
    expect(serviceRunRegimes('service', undefined, ['NIS2'])).toEqual(['SWAO_APM', 'NIS2']);
    expect(serviceRunRegimes('service', ['NIS2', 'SWAO_APM'], [])).toEqual(['SWAO_APM', 'NIS2']);
    expect(serviceRunRegimes('service', undefined, ['SWAO_APM'])).toBeUndefined();
  });

  it('owner decision 2026-11-15: a selection adds to the app default of a service app, it never replaces it', () => {
    expect(serviceRunRegimes('service', ['SWAO_APM', 'NIS2'], ['SWAO_APM', 'DORA'])).toEqual(['SWAO_APM', 'DORA', 'NIS2']);
    expect(serviceRunRegimes('service', ['NIS2'], ['DORA'])).toEqual(['SWAO_APM', 'DORA', 'NIS2']);
    expect(serviceBaselineAdded('service', ['NIS2'], ['DORA'])).toBe(true);
    expect(serviceBaselineAdded('service', ['SWAO_APM', 'NIS2'], ['DORA'])).toBe(false);
    expect(serviceBaselineAdded('application', ['NIS2'], [])).toBe(false);
  });

  it('an application run is unchanged', () => {
    expect(serviceRunRegimes('application', ['GDPR_DEMO'], ['SWAO_APM'])).toEqual(['GDPR_DEMO']);
    expect(serviceRunRegimes(undefined, undefined, [])).toBeUndefined();
  });
});
