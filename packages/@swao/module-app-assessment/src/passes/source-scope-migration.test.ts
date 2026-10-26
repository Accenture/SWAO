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

// #3428: behaviour of the passes after the move to the central source scope.
// Synthetic fixtures only. Each case failed before the migration: the private
// walkers scanned .git/ and target/ (CRYPTO, EGR) or matched a package.json
// inside node_modules/ (INV).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { beginSourceScopeRun, endSourceScopeRun, sourceScopeWalkCount, type PassContext } from '@swao/core';
import { runCryptoPass } from './pass-08-crypto.js';
import { runEgrPass } from './pass-07-egr.js';
import { runInvPass } from './pass-01-inv.js';
import { runDataPass } from './pass-03-data.js';
import { runIamPass } from './pass-21-iam.js';
import { runTfPass } from './pass-06-tf.js';

let tmp: string;
let src: string;

function put(rel: string, content: string): void {
  const p = join(src, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function ctx(): PassContext {
  return { workspacePath: tmp, sourcePath: src, appId: 'scope-app', iter: 1, assessedAt: '2026-10-23' } as PassContext;
}

function evidenceOf(result: { signals: Array<{ evidence?: unknown }> }): string {
  return result.signals.map((s) => (Array.isArray(s.evidence) ? s.evidence.join(' ') : '')).join(' ');
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3428-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('#3428 canonical exclusions in the passes', () => {
  it('CRYPTO ignores .git/ and target/ but still reads application and test code', async () => {
    put('package.json', JSON.stringify({ name: 'scope-app', dependencies: {} }));
    put('.git/objects/hook.js', "require('crypto').createHash('sha1');");
    put('service/target/classes/Legacy.js', "require('crypto').createHash('md5');");
    put('src/__tests__/legacy.test.ts', "import { createHash } from 'crypto';\nconst h = createHash('md5');");
    const result = await runCryptoPass(ctx());
    const ev = evidenceOf(result);
    expect(ev).not.toMatch(/\.git[\\/]/);
    expect(ev).not.toMatch(/target[\\/]/);
    // Test code is tagged, not dropped (#3403 owns the exclude switch).
    expect(ev).toMatch(/legacy\.test\.ts/);
  });

  it('EGR does not report a domain that only appears in .git/ or target/', async () => {
    put('package.json', JSON.stringify({ name: 'scope-app', dependencies: {} }));
    put('.git/hooks/post.js', "fetch('https://api.stripe.com/v1/charges');");
    put('target/out.js', "fetch('https://api.stripe.com/v1/charges');");
    put('src/app.ts', 'export const ok = 1;');
    const result = await runEgrPass(ctx());
    expect(evidenceOf(result)).not.toMatch(/stripe/i);
  });

  it('INV does not take a package.json inside node_modules/ as a Node.js sub-project', async () => {
    put('pom.xml', '<project><artifactId>svc</artifactId></project>');
    put('node_modules/left/package.json', JSON.stringify({ name: 'left' }));
    const result = await runInvPass(ctx());
    const inv01 = result.signals.find((s) => s.id === 'INV-01');
    expect(inv01?.derivation ?? '').toMatch(/Java/);
    expect(inv01?.derivation ?? '').not.toMatch(/node_modules/);
  });
});

describe('#3428 one memoised walk per run', () => {
  it('INV, DATA, TF, EGR, CRYPTO and IAM share a single source walk inside a run', async () => {
    put('package.json', JSON.stringify({ name: 'scope-app', dependencies: { express: '4.18.2' } }));
    put('src/user-profile.ts', 'export const email = "user email";');
    put('ops/docker-compose.yml', 'services:\n  app: { image: node:18-alpine }\n');
    beginSourceScopeRun();
    const before = sourceScopeWalkCount();
    await runInvPass(ctx());
    await runDataPass(ctx());
    await runTfPass(ctx());
    await runEgrPass(ctx());
    await runCryptoPass(ctx());
    await runIamPass(ctx());
    expect(sourceScopeWalkCount() - before).toBe(1);
    endSourceScopeRun();
  });
});
