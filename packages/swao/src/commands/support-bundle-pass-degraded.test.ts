// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Support bundle: degraded pass marker (#3436)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3436: pass-inventory.json marked 11-comp `exit_status: complete` after its
// LLM call was exhausted. The header stays `complete`; the inventory now
// carries `degraded: true` from the pass assessment block. Synthetic files.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dump } from 'js-yaml';
import { buildPassInventory } from './support-bundle.js';

const root = mkdtempSync(join(tmpdir(), 'swao-3436-bundle-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('buildPassInventory degraded marker (#3436)', () => {
  it('flags a degraded compliance pass and leaves a normal pass unflagged', () => {
    const passes = join(root, 'apps', 'demo', 'wsp', 'runs', '2026-10-23T00-00-00', 'passes');
    mkdirSync(passes, { recursive: true });
    writeFileSync(join(root, 'apps', 'demo', 'wsp', 'latest.txt'), 'runs/2026-10-23T00-00-00');
    writeFileSync(join(passes, '11-comp.yaml'), dump({
      pass: { id: 11, name: 'compliance_evaluation', status: 'complete', iter: 1 },
      signals: [],
      assessment: { degraded: true, degraded_reason: 'llm_unavailable', degraded_regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] },
    }));
    writeFileSync(join(passes, '01-inv.yaml'), dump({ pass: { id: 1, name: 'inventory', status: 'complete', iter: 1 }, signals: [], assessment: {} }));
    const inv = buildPassInventory(root).passes['demo'] as { passes: Array<Record<string, unknown>> };
    const comp = inv.passes.find((p) => p['pass_id'] === '11-comp')!;
    expect(comp['exit_status']).toBe('complete');
    expect(comp['degraded']).toBe(true);
    expect(comp['degraded_reason']).toBe('llm_unavailable');
    expect(inv.passes.find((p) => p['pass_id'] === '01-inv')!['degraded']).toBeUndefined();
  });
});
