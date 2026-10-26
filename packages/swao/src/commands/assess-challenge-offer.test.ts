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

// #3427: `swao assess` prints the challenge next step for the new run and
// names the other run's challenge (CLI parity with the TUI ChallengePromptPhase).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessChallengeOfferLines } from './assess-challenge-offer.js';

const OLD_RUN = '2026-10-20T09-00-00';
const NEW_RUN = '2026-10-22T17-15-00';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function wsp(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-3427-cli-'));
  dirs.push(ws);
  const w = join(ws, 'apps', 'demo-app', 'wsp');
  for (const id of [OLD_RUN, NEW_RUN]) {
    mkdirSync(join(w, 'runs', id), { recursive: true });
    writeFileSync(join(w, 'runs', id, 'wsp.yaml'), 'overall: {}\n');
  }
  return w;
}

function challengeOf(w: string, ts: string, runId: string): void {
  const dir = join(w, 'challenge-app', ts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'AA_business-owner.yaml'), `agent_id: business-owner\nchallenged_run:\n  run_id: ${runId}\nfindings: []\n`);
}

const base = (w: string) => ({ wspDir: w, runDir: join(w, 'runs', NEW_RUN), kind: 'app' as const, tier: 'enterprise', skipLlm: false });

describe('assessChallengeOfferLines (#3427)', () => {
  it('stale: names the other run and prints the command', () => {
    const w = wsp();
    challengeOf(w, '2026-10-20T10-00-00', OLD_RUN);
    expect(assessChallengeOfferLines(base(w))).toEqual([
      `[note] No stakeholder challenge for this run; the newest challenge on disk (challenge 2026-10-20T10-00-00 of run ${OLD_RUN}) belongs to another run and is not included.`,
      '[next] Stakeholder Challenge for this run: swao challenge --all-agents --app demo-app',
    ]);
  });

  it('none: prints only the next step', () => {
    expect(assessChallengeOfferLines(base(wsp()))).toEqual([
      '[next] Stakeholder Challenge for this run: swao challenge --all-agents --app demo-app',
    ]);
  });

  it('current, below Enterprise, deterministic-only and service runs: no offer (TUI gates)', () => {
    const w = wsp();
    expect(assessChallengeOfferLines({ ...base(w), tier: 'consultant' })).toEqual([]);
    expect(assessChallengeOfferLines({ ...base(w), skipLlm: true })).toEqual([]);
    expect(assessChallengeOfferLines({ ...base(w), isService: true })).toEqual([]);
    challengeOf(w, '2026-10-22T17-30-00', NEW_RUN);
    expect(assessChallengeOfferLines(base(w))).toEqual([]);
  });

  it('LZ: the command pins the new run', () => {
    const w = wsp();
    expect(assessChallengeOfferLines({ ...base(w), kind: 'lz' })).toEqual([
      `[next] LZ Sovereignty Challenge for this run: swao challenge --type lz --all-agents --app demo-app --run ${NEW_RUN}`,
    ]);
  });
});
