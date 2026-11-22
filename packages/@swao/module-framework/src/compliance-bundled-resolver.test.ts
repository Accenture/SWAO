// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4286 (owner decision D-10): Pass 11 resolves community frameworks through the
// shared resolver: the workspace copy first, then the bundled copy. A service app
// scaffolded with regimes_active [SWAO_APM] in a fresh workspace (no catalogue
// copied) evaluates the SWAO_APM controls.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveRegimeCatalogue } from '@swao/core';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { runCompliancePass } from './compliance-evaluator.js';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A fresh workspace with one service app; no catalogue under wsp/inputs/catalogs. */
function serviceWorkspace(regimes: string[]): { wsRoot: string; workspacePath: string; passesDir: string } {
  const wsRoot = mkdtempSync(join(tmpdir(), 'swao-4286-'));
  dirs.push(wsRoot);
  writeFileSync(join(wsRoot, '.swao.yml'), 'wsp_version: "0.9"\n');
  const workspacePath = join(wsRoot, 'apps', 'app0153');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-11-09T15-14-37', 'passes');
  mkdirSync(passesDir, { recursive: true });
  writeFileSync(join(workspacePath, '.swao.yml'), `app_id: app0153\nassessment:\n  type: service\n  regimes_active:\n${regimes.map((r) => `    - ${r}`).join('\n')}\n`, 'utf-8');
  writeFileSync(join(passesDir, '01-data.yaml'), 'pass:\n  id: 1\n  name: data\nsignals:\n  - id: DATA-01\n    severity: informational\n    derivation: "probe"\n', 'utf-8');
  return { wsRoot, workspacePath, passesDir };
}

/** Fake LLM (no real call): answers every control id in the prompt. */
function fakeLlm() {
  let calls = 0;
  return {
    get calls() { return calls; },
    llm: {
      complete: async (prompt: string): Promise<string> => {
        calls += 1;
        const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
        return JSON.stringify({ controls: ids.map((id) => ({ id, outcome: 'UNKNOWN', rationale: `Fake rationale for ${id}.`, signal_refs: ['DATA-01'], remediation: '' })) });
      },
    },
  };
}

describe('shared community framework resolver (#4286, D-10)', () => {
  it('falls back to the bundled copy when the workspace has none', () => {
    const { wsRoot } = serviceWorkspace(['SWAO_APM']);
    const r = resolveRegimeCatalogue(wsRoot, 'SWAO_APM', communityFrameworksDir);
    expect(r?.source).toBe('bundled');
    expect(r?.dir.replace(/\\/g, '/')).toMatch(/swao-apm$/);
  });

  it('prefers the workspace copy', () => {
    const { wsRoot } = serviceWorkspace(['SWAO_APM']);
    const dir = join(wsRoot, 'wsp', 'inputs', 'catalogs', 'community', 'swao-apm-engagement');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'controls.yaml'), 'regime_meta:\n  id: SWAO_APM\n  name: Engagement APM\n  version: "9.9"\ncontrols: []\n');
    const r = resolveRegimeCatalogue(wsRoot, 'SWAO_APM', communityFrameworksDir);
    expect(r?.source).toBe('workspace');
    expect(r?.catalogueFile).toBe(join(dir, 'controls.yaml'));
  });

  it('returns null for an id that exists nowhere', () => {
    const { wsRoot } = serviceWorkspace(['NO_SUCH_REGIME']);
    expect(resolveRegimeCatalogue(wsRoot, 'NO_SUCH_REGIME', communityFrameworksDir)).toBeNull();
  });
});

describe('Pass 11 on a service app in a fresh workspace (#4286)', () => {
  it('evaluates SWAO_APM from the bundled copy (regimes_evaluated 1, controls_total > 0)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { workspacePath, passesDir } = serviceWorkspace(['SWAO_APM']);
    const fake = fakeLlm();
    const out = await runCompliancePass({ appId: 'app0153', sourcePath: workspacePath, workspacePath, iter: 1, assessedAt: '2026-11-09', passesDir, llm: fake.llm });
    const a = out.assessment as { regimes_evaluated: number; controls_total: number; regimes: Array<{ regime_id?: string; id?: string }> };
    expect(a.regimes_evaluated).toBe(1);
    expect(a.controls_total).toBeGreaterThan(0);
    expect(out.signals.some((s) => /no framework with this id|no catalog found/.test(s.derivation ?? ''))).toBe(false);
  });

  it('a regime that exists nowhere is a deterministic signal, not an LLM inference', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { workspacePath, passesDir } = serviceWorkspace(['NO_SUCH_REGIME']);
    const out = await runCompliancePass({ appId: 'app0153', sourcePath: workspacePath, workspacePath, iter: 1, assessedAt: '2026-11-09', passesDir, llm: fakeLlm().llm });
    const missing = out.signals.find((s) => (s.derivation ?? '').includes('NO_SUCH_REGIME'));
    expect(missing).toBeDefined();
    expect(missing!.source).toBe('static_analysis');
    expect(missing!.assessor).toBe('rule_engine');
    expect(missing!.derivation).toContain('bundled with SWAO');
  });
});
