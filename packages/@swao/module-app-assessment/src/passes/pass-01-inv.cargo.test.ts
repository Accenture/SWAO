// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- pass-01 Cargo workspace service_dep tests (#2945)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runInvPass } from './pass-01-inv.js';
import type { PassContext } from '@swao/core';

const BASE_CTX = {
  appId: 'test-app',
  iter: 1,
  assessedAt: '2026-10-07',
  llm: undefined as unknown as PassContext['llm'],
};

describe('pass-01 Cargo workspace service_dep scanning (#2945)', () => {
  let dir: string;
  let wsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-cargo-'));
    wsDir = join(dir, 'ws');
    mkdirSync(wsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits service_dep:postgresql from flat Cargo.toml with sqlx+postgres', async () => {
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'Cargo.toml'), [
      '[package]',
      'name = "myapp"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'sqlx = { version = "0.7", features = ["runtime-tokio", "postgres"] }',
    ].join('\n'), 'utf-8');

    const result = await runInvPass({
      ...BASE_CTX,
      passesDir: dir,
      sourcePath: srcDir,
      workspacePath: wsDir,
    });
    const signals = result?.signals ?? [];
    const serviceDeps = signals.filter((s) => s.implies?.includes('service_dep:postgresql'));
    expect(serviceDeps.length).toBeGreaterThan(0);
  });

  it('emits service_dep signals from workspace member Cargo.toml files (#2945)', async () => {
    const srcDir = join(dir, 'src');
    mkdirSync(join(srcDir, 'api'), { recursive: true });
    mkdirSync(join(srcDir, 'worker'), { recursive: true });

    // Workspace root -- no direct deps (this is the pattern that was broken).
    writeFileSync(join(srcDir, 'Cargo.toml'), [
      '[workspace]',
      'members = ["api", "worker"]',
    ].join('\n'), 'utf-8');

    // api crate depends on sqlx+postgres.
    writeFileSync(join(srcDir, 'api', 'Cargo.toml'), [
      '[package]',
      'name = "api"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'sqlx = { version = "0.7", features = ["runtime-tokio", "postgres"] }',
    ].join('\n'), 'utf-8');

    // worker crate depends on redis.
    writeFileSync(join(srcDir, 'worker', 'Cargo.toml'), [
      '[package]',
      'name = "worker"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'redis = "0.24"',
    ].join('\n'), 'utf-8');

    const result = await runInvPass({
      ...BASE_CTX,
      passesDir: dir,
      sourcePath: srcDir,
      workspacePath: wsDir,
    });
    const signals = result?.signals ?? [];
    const implies = signals.flatMap((s) => s.implies ?? []);
    expect(implies).toContain('service_dep:postgresql');
    expect(implies).toContain('service_dep:redis');
  });

  it('deduplicates service_dep when same service appears in multiple member crates', async () => {
    const srcDir = join(dir, 'src');
    mkdirSync(join(srcDir, 'a'), { recursive: true });
    mkdirSync(join(srcDir, 'b'), { recursive: true });

    writeFileSync(join(srcDir, 'Cargo.toml'), [
      '[workspace]',
      'members = ["a", "b"]',
    ].join('\n'), 'utf-8');

    const cratoml = [
      '[package]',
      'name = "pkg"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'redis = "0.24"',
    ].join('\n');
    writeFileSync(join(srcDir, 'a', 'Cargo.toml'), cratoml, 'utf-8');
    writeFileSync(join(srcDir, 'b', 'Cargo.toml'), cratoml, 'utf-8');

    const result = await runInvPass({
      ...BASE_CTX,
      passesDir: dir,
      sourcePath: srcDir,
      workspacePath: wsDir,
    });
    const signals = result?.signals ?? [];
    const redisSignals = signals.filter((s) => s.implies?.includes('service_dep:redis'));
    expect(redisSignals.length).toBe(1);
  });
});
