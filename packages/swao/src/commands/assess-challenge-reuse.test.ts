// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM challenge -- Option A combined.yaml reuse helper (#1774)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Integration tests for reuseMainChallengeCombined (#1774 Option A).
// Verifies that a fresh combined.yaml in the main workspace is copied
// to the leg workspace (return true), while an absent or stale file is
// not copied (return false).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reuseMainChallengeCombined } from './assess.js';

const APP_ID = 'test-app';
const COMBINED_REL = ['apps', APP_ID, 'wsp', 'challenge-app', 'combined.yaml'];

/** Minimal combined.yaml with a reports list (mirrors the shape the read path expects). */
const FIXTURE_YAML = [
  'reports:',
  '  - agent_id: app-architect',
  '    findings: []',
  '  - agent_id: grc-officer',
  '    findings: []',
].join('\n');

const sevenDays = 7 * 24 * 60 * 60 * 1000;

let tmpDirs: string[] = [];

function makeWorkspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-reuse-test-'));
  tmpDirs.push(d);
  return d;
}

function placeCombinedYaml(root: string, mtimeOffset = 0): void {
  const dir = join(root, ...COMBINED_REL.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  const p = join(root, ...COMBINED_REL);
  writeFileSync(p, FIXTURE_YAML, 'utf-8');
  if (mtimeOffset !== 0) {
    const t = new Date(Date.now() + mtimeOffset);
    utimesSync(p, t, t);
  }
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

describe('reuseMainChallengeCombined (#1774 Option A)', () => {
  it('copies combined.yaml from main to leg workspace when file is fresh, returns true', () => {
    const main = makeWorkspace();
    const leg = makeWorkspace();
    placeCombinedYaml(main);

    const result = reuseMainChallengeCombined({
      mainWorkspaceRoot: main,
      legWorkspaceRoot: leg,
      appId: APP_ID,
    });

    expect(result).toBe(true);
    const legYamlPath = join(leg, ...COMBINED_REL);
    expect(existsSync(legYamlPath)).toBe(true);
  });

  it('returns false and does not write to leg workspace when main combined.yaml is absent', () => {
    const main = makeWorkspace();
    const leg = makeWorkspace();
    // No combined.yaml placed in main

    const result = reuseMainChallengeCombined({
      mainWorkspaceRoot: main,
      legWorkspaceRoot: leg,
      appId: APP_ID,
    });

    expect(result).toBe(false);
    expect(existsSync(join(leg, ...COMBINED_REL))).toBe(false);
  });

  it('returns false when main combined.yaml is older than maxAgeMs', () => {
    const main = makeWorkspace();
    const leg = makeWorkspace();
    placeCombinedYaml(main);

    // Inject `now` that is 8 days ahead, making the file appear stale.
    const eightDaysAhead = Date.now() + 8 * 24 * 60 * 60 * 1000;
    const result = reuseMainChallengeCombined({
      mainWorkspaceRoot: main,
      legWorkspaceRoot: leg,
      appId: APP_ID,
      maxAgeMs: sevenDays,
      now: eightDaysAhead,
    });

    expect(result).toBe(false);
    expect(existsSync(join(leg, ...COMBINED_REL))).toBe(false);
  });
});
