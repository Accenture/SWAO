// #4256 (TUI-12, Design 126 section 4.6, A-20): the stage name and the run
// guidance of the Application and LZ Catalog run screens follow the run state.
import { describe, it, expect } from 'vitest';
import { passWords, runGuidance, runStage, runTitle, subProgress, type RunState } from './run-view.js';

const APP: RunState = { kind: 'application', app: 'sovereign-health', passName: '', passSubLabel: '', completed: 0, total: 14 };
const LZ: RunState = { kind: 'landing-zone', app: 'sovereign-health', passName: '', passSubLabel: '', completed: 0, total: 2 };

describe('run view state (#4256, A-20)', () => {
  it('RV-01 preparing: stage 1, a preparing stage name and a preparing guidance, never a pass text', () => {
    const st = runStage(APP, 5000);
    expect(st).toMatchObject({ stage: 1, stages: 14, elapsedMs: 5000 });
    expect(st.label).toBe('Preparing: cloning the source and preparing the passes');
    expect(runGuidance(APP).title).toBe('Preparing the run');
    expect(runGuidance(LZ).what).toContain('landing zone catalogue');
    expect(runStage(LZ, 0).label).toBe('Preparing: loading the catalogue and the app inputs');
  });

  it('RV-02 a running pass names the pass; the guidance shows its description, not "Cloning"', () => {
    const s = { ...APP, passName: 'context_ingestion', completed: 3 };
    expect(runStage(s, 0)).toMatchObject({ stage: 4, label: 'Pass context ingestion' });
    const g = runGuidance(s);
    expect(g.title).toBe('Running: Pass context ingestion');
    expect(g.what).toContain('wsp/inputs/');
    expect(g.what).not.toMatch(/Cloning/i);
    expect(g.sections).toContainEqual({ label: 'Progress', text: '3 of 14 passes finished' });
    expect(g.cli).toBe('swao assess --app sovereign-health');
  });

  it('RV-03 the sub-progress of a pass is an item bar and part of the stage name (comma, no double dash)', () => {
    const st = runStage({ ...APP, passName: 'compliance_evaluation', passSubLabel: 'BSI_C5 (3/7)', completed: 10 }, 0);
    expect(st.label).toBe('Pass compliance evaluation, BSI_C5 (3/7)');
    expect(st).toMatchObject({ itemsDone: 3, itemsTotal: 7, itemsLabel: 'Steps' });
    expect(subProgress('no counts')).toBeNull();
    expect(subProgress('x (2/0)')).toBeNull();
  });

  it('RV-04 the guidance text has no spaced double hyphen (pass descriptions are normalised)', () => {
    const g = runGuidance({ ...APP, passName: 'egress' });
    expect(g.what).not.toContain(' -- ');
    expect(g.what).toContain('CDNs, US-hosted SaaS');
  });

  it('RV-05 the LZ Catalog run names the target and counts targets; the stage never passes the total', () => {
    const s = { ...LZ, passName: 'lz_fit', passSubLabel: 'otc:eu-de', completed: 2 };
    expect(runStage(s, 0)).toMatchObject({ stage: 2, stages: 2, label: 'lz fit, otc:eu-de' });
    expect(runGuidance(s).sections).toContainEqual({ label: 'Progress', text: '2 of 2 targets finished' });
    expect(runGuidance(s).cli).toBe('swao assess --type landing-zone --app sovereign-health');
    expect(runTitle(LZ)).toBe('Fitting sovereign-health to the landing zone catalogue');
    expect(runTitle(APP)).toBe('Assessing sovereign-health');
    expect(passWords('block_assessments')).toBe('block assessments');
  });

  it('RV-06 an unknown pass falls back to a general text', () => {
    expect(runGuidance({ ...APP, passName: 'future_pass' }).what).toContain('Each pass analyses');
  });
});
