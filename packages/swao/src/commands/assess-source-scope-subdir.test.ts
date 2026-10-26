// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3428 (vcs.subdir proof moved from #3404): the source scope is rooted at
// resolveSourcePath(), i.e. <source.path>/<subdir>, and the passes read only
// through it, so a mono-repo sibling never produces a finding. Synthetic
// mono-repo fixture; the sibling app holds weak crypto and a US egress call
// that must not surface.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { beginSourceScopeRun, endSourceScopeRun, listSourceFiles, type PassContext } from '@swao/core';
import { assessOrchestrator } from '@swao/module-app-assessment';
import { SwaoYmlSchema } from '../schema/index.js';
import { resolveSourcePath } from './assess.js';

let appDir: string;

function put(rel: string, content: string): void {
  const p = join(appDir, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function parseYml(text: string): Record<string, unknown> {
  const r = SwaoYmlSchema.safeParse(load(text) ?? {});
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'invalid .swao.yml');
  return r.data as Record<string, unknown>;
}

beforeAll(() => {
  appDir = mkdtempSync(join(tmpdir(), 'swao-3428-subdir-'));
  // the app under assessment
  put('source/apps/billing/package.json', JSON.stringify({ name: 'billing', dependencies: { express: '4.18.2' } }));
  put('source/apps/billing/src/server.ts', "import { createHash } from 'crypto';\nexport const h = createHash('sha256');\n");
  // a sibling app in the same clone
  put('source/apps/crm/package.json', JSON.stringify({ name: 'crm', dependencies: { stripe: '14.0.0' } }));
  put('source/apps/crm/src/pay.ts', "import { createHash } from 'crypto';\nconst m = createHash('md5');\nfetch('https://api.stripe.com/v1/charges');\n");
  put('source/package.json', JSON.stringify({ name: 'monorepo-root', dependencies: { stripe: '14.0.0' } }));
});

afterAll(() => {
  endSourceScopeRun();
  rmSync(appDir, { recursive: true, force: true });
});

describe('source scope honours vcs.subdir (#3428 / #3404)', () => {
  it('a scope rooted at the resolved source path lists nothing outside the subdir', () => {
    const root = resolveSourcePath(appDir, parseYml('source:\n  path: source/\n  vcs:\n    subdir: apps/billing\n'), undefined);
    expect(root).toBe(join(resolve(appDir, 'source/'), 'apps/billing'));
    const files = listSourceFiles(root, { purpose: 'code' });
    expect(files.map((f) => f.rel).sort()).toEqual(['package.json', 'src/server.ts']);
    for (const f of files) expect(resolve(f.abs).startsWith(resolve(root))).toBe(true);
  });

  it('the static passes cite no file from the sibling app or the mono-repo root', async () => {
    const root = resolveSourcePath(appDir, parseYml('source:\n  path: source/\n  vcs:\n    subdir: apps/billing\n'), undefined);
    beginSourceScopeRun();
    const evidence: string[] = [];
    for (const key of ['inv', 'data', 'sbom', 'tf', 'egr', 'crypto', 'iam']) {
      const def = assessOrchestrator.getPass(key);
      if (!def) continue;
      const ctx = { appId: 'billing', sourcePath: root, workspacePath: appDir, iter: 1, assessedAt: '2026-10-23' } as PassContext;
      const result = await def.runner(ctx);
      for (const s of result.signals) {
        evidence.push(...(Array.isArray(s.evidence) ? s.evidence.map(String) : []), s.derivation ?? '');
      }
    }
    endSourceScopeRun();
    const text = evidence.join('\n');
    expect(text).not.toMatch(/crm|pay\.ts|monorepo-root/);
    expect(text).not.toMatch(/api\.stripe\.com/);
    expect(text).not.toMatch(/\bMD5\b/i);
  }, 60_000);
});
