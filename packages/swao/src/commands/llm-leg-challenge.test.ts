// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3336: LLM-comparison legs read only the challenge their own subprocess
// wrote (files at or after the spawn); the run id is ignored by design.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLegChallengeAgents } from './llm-leg-challenge.js';

let wsp: string;
const HOUR = 3_600_000;

function writeOld(path: string, content: string, ageMs: number): void {
  writeFileSync(path, content);
  const t = new Date(Date.now() - ageMs);
  utimesSync(path, t, t);
}

function folderTs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace(/:/g, '-');
}

beforeEach(() => { wsp = mkdtempSync(join(tmpdir(), 'swao-leg-challenge-')); });
afterEach(() => { rmSync(wsp, { recursive: true, force: true }); });

describe('readLegChallengeAgents (#3336)', () => {
  it('app: reads combined.yaml written by this leg (run id of the main run is ignored by design)', () => {
    const started = Date.now();
    mkdirSync(join(wsp, 'challenge-app'), { recursive: true });
    writeFileSync(join(wsp, 'challenge-app', 'combined.yaml'),
      'challenged_run:\n  run_id: 2026-10-18T12-37-09\nreports:\n  - agent_id: business-owner\n  - agent_id: finops-lead\n');
    const r = readLegChallengeAgents(wsp, 'app', started);
    expect(r.agents.map(a => a.agent_id)).toEqual(['business-owner', 'finops-lead']);
    expect(r.source).toMatch(/combined\.yaml$/);
  });

  it('app: a combined.yaml older than the leg spawn is not reported (failed leg reports no agents)', () => {
    mkdirSync(join(wsp, 'challenge-app'), { recursive: true });
    writeOld(join(wsp, 'challenge-app', 'combined.yaml'), 'reports:\n  - agent_id: business-owner\n', HOUR);
    const r = readLegChallengeAgents(wsp, 'app', Date.now());
    expect(r).toEqual({ agents: [], source: null });
  });

  it('app: flat AA_ files of this leg; older AA_ files are skipped', () => {
    const base = join(wsp, 'challenge-app');
    mkdirSync(base, { recursive: true });
    writeOld(join(base, 'AA_old.yaml'), 'agent_id: old\n', HOUR);
    const started = Date.now();
    writeFileSync(join(base, 'AA_new.yaml'), 'agent_id: new\n');
    expect(readLegChallengeAgents(wsp, 'app', started).agents.map(a => a.agent_id)).toEqual(['new']);
  });

  it('lz: the challenge-lz/<ts>/ folder written by this leg, not an older folder', () => {
    const started = Date.now();
    const oldDir = join(wsp, 'challenge-lz', folderTs(started - HOUR));
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'LZCA_lzca-procurement.yaml'), 'agent_id: x\n');
    expect(readLegChallengeAgents(wsp, 'lz', started)).toEqual({ agents: [], source: null });
    const newDir = join(wsp, 'challenge-lz', folderTs(started + 2_000));
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, 'LZCA_lzca-ciso-security.yaml'), 'agent_id: x\n');
    const r = readLegChallengeAgents(wsp, 'lz', started);
    expect(r.agents).toEqual([{ agent_id: 'lzca-ciso-security' }]);
    expect(r.source).toBe(newDir);
  });
});
