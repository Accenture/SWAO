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

// #3330: challenge-to-run pairing (two runs, two challenges).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectChallengeForRun, challengeSourceLabel, toFolderTs,
  challengeFreshness, challengeCommand, otherChallengeLabel, staleChallengeNote, challengeOfferForRun,
} from './challenge-run.js';

const R1 = '2026-10-11T17-43-36';
const R2 = '2026-10-18T12-37-09';

let wsp: string;

function lzRun(id: string, status: 'complete' | 'partial' | 'failed' = 'complete'): string {
  const dir = join(wsp, 'runs', id);
  mkdirSync(join(dir, 'passes'), { recursive: true });
  writeFileSync(join(dir, 'passes', 'lz-fit-aws-eu-central-1.yaml'), 'assessment: {}\n');
  writeFileSync(join(dir, 'run-status.json'), JSON.stringify({
    schema_version: '1.0', assessment_type: 'landing-zone-catalog', app: 'a', run_id: id,
    status, started_at: '2026-10-18T00:00:00Z', swao_version: 'test',
  }));
  return dir;
}

function appRun(id: string): string {
  const dir = join(wsp, 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wsp.yaml'), 'overall: {}\n');
  writeFileSync(join(dir, 'run-manifest.json'), '{}');
  return dir;
}

function lzChallenge(ts: string, runId?: string): string {
  const dir = join(wsp, 'challenge-lz', ts);
  mkdirSync(dir, { recursive: true });
  const ref = runId ? `challenged_run:\n  run_id: ${runId}\n  assessment_type: landing-zone-catalog\n` : '';
  writeFileSync(join(dir, 'LZCA_ciso.yaml'), `agent_id: ciso\n${ref}findings: []\n`);
  return dir;
}

beforeEach(() => { wsp = mkdtempSync(join(tmpdir(), 'swao-challenge-run-')); });
afterEach(() => { rmSync(wsp, { recursive: true, force: true }); });

describe('selectChallengeForRun (#3330)', () => {
  it('returns none when no challenge folder exists', () => {
    const sel = selectChallengeForRun(wsp, 'lz', lzRun(R1));
    expect(sel).toEqual({ dir: null, match: 'none', otherRunOmitted: false });
  });

  it('matches by recorded run id and ignores a newer challenge of another run', () => {
    const r1 = lzRun(R1);
    const r2 = lzRun(R2);
    const c1 = lzChallenge('2026-10-11T17-43-39', R1);
    const c2 = lzChallenge('2026-10-18T13-00-00', R2);
    const s1 = selectChallengeForRun(wsp, 'lz', r1);
    expect(s1.dir).toBe(c1);
    expect(s1.match).toBe('run-id');
    expect(s1.runId).toBe(R1);
    expect(s1.otherRunOmitted).toBe(true);
    const s2 = selectChallengeForRun(wsp, 'lz', r2);
    expect(s2.dir).toBe(c2);
    expect(s2.otherRunOmitted).toBe(false);
    expect(challengeSourceLabel(s2)).toBe(`challenge 2026-10-18T13-00-00 of run ${R2}`);
  });

  it('omits an older challenge of another run (issue scenario)', () => {
    lzRun(R1);
    const r2 = lzRun(R2);
    lzChallenge('2026-10-11T17-43-39', R1);
    const sel = selectChallengeForRun(wsp, 'lz', r2);
    expect(sel.dir).toBeNull();
    expect(sel.match).toBe('none');
    expect(sel.otherRunOmitted).toBe(true);
  });

  it('pairs a challenge without run id with the newest run at or before it', () => {
    const r1 = lzRun(R1);
    const r2 = lzRun(R2);
    const legacy = lzChallenge('2026-10-11T17-43-39');
    expect(selectChallengeForRun(wsp, 'lz', r2)).toMatchObject({ dir: null, otherRunOmitted: true });
    const s1 = selectChallengeForRun(wsp, 'lz', r1);
    expect(s1).toMatchObject({ dir: legacy, match: 'timestamp', runId: R1 });
    expect(challengeSourceLabel(s1)).toContain('paired by timestamp');
  });

  it('a failed later run is not a pairing boundary', () => {
    lzRun(R1);
    const r2 = lzRun(R2);
    lzRun('2026-10-18T12-40-41', 'failed');
    const legacy = lzChallenge('2026-10-18T13-00-00');
    expect(selectChallengeForRun(wsp, 'lz', r2)).toMatchObject({ dir: legacy, match: 'timestamp' });
  });

  it('application runs do not act as LZ boundaries', () => {
    const r1 = lzRun(R1);
    appRun('2026-10-12T09-00-00');
    const legacy = lzChallenge('2026-10-13T10-00-00');
    expect(selectChallengeForRun(wsp, 'lz', r1)).toMatchObject({ dir: legacy, match: 'timestamp' });
  });

  it('pairs a flat combined.yaml (app) by its run id or its assessed_at', () => {
    const a1 = appRun(R1);
    const a2 = appRun(R2);
    const base = join(wsp, 'challenge-app');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'combined.yaml'), `assessed_at: '2026-10-12T08:00:00.000Z'\nreports: []\n`);
    expect(selectChallengeForRun(wsp, 'app', a1)).toMatchObject({ dir: base, match: 'timestamp', challengeTs: '2026-10-12T08-00-00' });
    expect(selectChallengeForRun(wsp, 'app', a2)).toMatchObject({ dir: null, otherRunOmitted: true });
    writeFileSync(join(base, 'combined.yaml'), `assessed_at: '2026-10-12T08:00:00.000Z'\nchallenged_run:\n  run_id: ${R2}\nreports: []\n`);
    expect(selectChallengeForRun(wsp, 'app', a2)).toMatchObject({ dir: base, match: 'run-id' });
  });

  it('uses the newest challenge, flagged unscoped, when there is no run dir', () => {
    lzChallenge('2026-10-11T17-43-39', R1);
    const c2 = lzChallenge('2026-10-18T13-00-00');
    const sel = selectChallengeForRun(wsp, 'lz', wsp);
    expect(sel).toMatchObject({ dir: c2, match: 'unscoped' });
    expect(challengeSourceLabel(sel)).toContain('newest challenge shown');
  });

  it('toFolderTs converts ISO to the folder form', () => {
    expect(toFolderTs('2026-10-18T12:37:09.123Z')).toBe('2026-10-18T12-37-09');
    expect(toFolderTs('not a date')).toBeUndefined();
  });
});

// #3427: a run without its own challenge names the run the existing challenge
// belongs to, so the empty state, `swao publish`, the hub and the assess
// offer can say which run the challenge on disk is for.
describe('stale-challenge metadata (#3427)', () => {
  it('names the newest skipped challenge and its run', () => {
    lzRun(R1);
    const r2 = lzRun(R2);
    lzChallenge('2026-10-11T17-43-39', R1);
    lzChallenge('2026-10-12T08-00-00', R1);
    const sel = selectChallengeForRun(wsp, 'lz', r2);
    expect(sel).toEqual({
      dir: null, match: 'none', otherRunOmitted: true,
      otherRunId: R1, otherChallengeTs: '2026-10-12T08-00-00',
    });
    expect(challengeFreshness(sel)).toBe('stale');
    expect(otherChallengeLabel(sel)).toBe(`challenge 2026-10-12T08-00-00 of run ${R1}`);
    expect(staleChallengeNote(sel)).toBe(
      `No stakeholder challenge for this run; the newest challenge on disk (challenge 2026-10-12T08-00-00 of run ${R1}) belongs to another run and is not included.`,
    );
  });

  it('a timestamp-paired challenge of an earlier run names that run', () => {
    lzRun(R1);
    const r2 = lzRun(R2);
    lzChallenge('2026-10-11T17-43-39');
    expect(selectChallengeForRun(wsp, 'lz', r2)).toMatchObject({ otherRunId: R1, otherChallengeTs: '2026-10-11T17-43-39' });
  });

  it('a challenge older than every run has no known run', () => {
    lzChallenge('2026-10-01T08-00-00');
    const r1 = lzRun(R1);
    const sel = selectChallengeForRun(wsp, 'lz', r1);
    expect(sel.otherRunId).toBeUndefined();
    expect(otherChallengeLabel(sel)).toBe('challenge 2026-10-01T08-00-00 of an unrecorded run');
  });

  it('freshness is current with a matching challenge and none without any', () => {
    const r1 = lzRun(R1);
    expect(challengeFreshness(selectChallengeForRun(wsp, 'lz', r1))).toBe('none');
    expect(staleChallengeNote(selectChallengeForRun(wsp, 'lz', r1))).toBeUndefined();
    lzChallenge('2026-10-11T17-43-39', R1);
    expect(challengeFreshness(selectChallengeForRun(wsp, 'lz', r1))).toBe('current');
  });

  it('challengeCommand pins the LZ run and names the app', () => {
    expect(challengeCommand('demo-app', 'app')).toBe('swao challenge --all-agents --app demo-app');
    expect(challengeCommand('demo-app', 'lz', R2)).toBe(`swao challenge --type lz --all-agents --app demo-app --run ${R2}`);
  });

  it('#3446: challengeCommand pins the application run when given', () => {
    expect(challengeCommand('demo-app', 'app', R2)).toBe(`swao challenge --all-agents --app demo-app --run ${R2}`);
  });
});

describe('challengeOfferForRun (#3427)', () => {
  it('offers the challenge for the new run and names the stale one', () => {
    const app = join(wsp, 'apps', 'demo-app', 'wsp');
    mkdirSync(app, { recursive: true });
    const prev = wsp;
    wsp = app;
    try {
      lzRun(R1);
      lzChallenge('2026-10-11T17-43-39', R1);
      const r2 = lzRun(R2);
      const offer = challengeOfferForRun(app, 'lz', r2);
      expect(offer.freshness).toBe('stale');
      expect(offer.command).toBe(`swao challenge --type lz --all-agents --app demo-app --run ${R2}`);
      expect(offer.note).toContain(`challenge 2026-10-11T17-43-39 of run ${R1}`);
      const r1 = join(app, 'runs', R1);
      expect(challengeOfferForRun(app, 'lz', r1)).toEqual({ freshness: 'current', command: `swao challenge --type lz --all-agents --app demo-app --run ${R1}` });
    } finally {
      wsp = prev;
    }
  });
});
