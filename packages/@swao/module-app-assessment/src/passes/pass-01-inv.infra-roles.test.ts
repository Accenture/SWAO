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

// #3429: Pass 01 emits service_dep only from CURRENT infrastructure. A state
// file declared target via .swao.yml context.infra_roles feeds LZR only.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PassContext } from '@swao/core';
import { runInvPass } from './pass-01-inv.js';

const TFSTATE_REDIS = JSON.stringify({
  format_version: '1.0',
  values: {
    root_module: {
      resources: [{
        mode: 'managed',
        type: 'docker_container',
        name: 'redis',
        values: { image: 'sha256:abcdef1234567890abcdef', name: 'redis', env: [], command: [] },
      }],
    },
  },
});

let root = '';

function setup(swaoYml?: string): { ws: string; src: string } {
  root = mkdtempSync(join(tmpdir(), 'swao-inv-roles-'));
  const ws = join(root, 'ws');
  const src = join(root, 'src');
  mkdirSync(join(ws, 'wsp', 'inputs', 'terraform'), { recursive: true });
  mkdirSync(src, { recursive: true });
  writeFileSync(join(ws, 'wsp', 'inputs', 'terraform', 'target-lz.tfstate'), TFSTATE_REDIS);
  if (swaoYml) writeFileSync(join(ws, '.swao.yml'), swaoYml, 'utf-8');
  return { ws, src };
}

function ctx(ws: string, src: string): PassContext {
  return { appId: 'demo-app', iter: 1, assessedAt: '2026-10-23', sourcePath: src, workspacePath: ws, passesDir: root };
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('pass-01 infra roles (#3429)', () => {
  it('a tfstate without a role declaration is current: service_dep emitted (unchanged behaviour)', async () => {
    const { ws, src } = setup();
    const result = await runInvPass(ctx(ws, src));
    expect(result.signals.some((s) => s.implies?.includes('service_dep:redis'))).toBe(true);
  });

  it('a tfstate declared target in context.infra_roles emits no service_dep', async () => {
    const { ws, src } = setup('context:\n  infra_roles:\n    - path: terraform/target-lz.tfstate\n      role: target\n');
    const result = await runInvPass(ctx(ws, src));
    expect(result.signals.some((s) => s.implies?.includes('service_dep:redis'))).toBe(false);
  });
});
