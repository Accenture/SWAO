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

// Audit-gate-style test for the real-LLM smoke harness shape (#0322 Part C).
//
// The harness itself does not run in CI (real-LLM calls cost real money).
// This test verifies the harness files exist + the runbook references it
// + the README documents the cadence. Catches the recurring drift class
// where a file is "shipped" but the runbook reference is wrong or missing.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..', '..');
const SMOKE_DIR = join(PKG_ROOT, 'tests', 'real-llm-smoke');
const SMOKE_README = join(SMOKE_DIR, 'README.md');
const SMOKE_SCRIPT = join(SMOKE_DIR, 'run-smoke.sh');
const RELEASE_RUNBOOK = join(REPO_ROOT, 'docs', 'runbooks', 'RELEASE.md');

describe('real-LLM smoke harness shape contract (#0322 Part C, sprint-036)', () => {
  it('tests/real-llm-smoke/ exists and is a directory', () => {
    expect(existsSync(SMOKE_DIR)).toBe(true);
    expect(statSync(SMOKE_DIR).isDirectory()).toBe(true);
  });

  it('tests/real-llm-smoke/README.md exists', () => {
    expect(existsSync(SMOKE_README)).toBe(true);
  });

  it('tests/real-llm-smoke/run-smoke.sh exists', () => {
    expect(existsSync(SMOKE_SCRIPT)).toBe(true);
  });

  it('run-smoke.sh starts with a bash shebang', () => {
    const first = readFileSync(SMOKE_SCRIPT, 'utf-8').split('\n')[0] ?? '';
    expect(first).toMatch(/^#!.*\bbash\b/);
  });

  it('run-smoke.sh loops over both providers (anthropic + openai)', () => {
    const content = readFileSync(SMOKE_SCRIPT, 'utf-8');
    expect(content).toContain('anthropic');
    expect(content).toContain('openai');
  });

  it('run-smoke.sh runs assess with --passes inv,synth (proves a real LLM call)', () => {
    const content = readFileSync(SMOKE_SCRIPT, 'utf-8');
    expect(content).toMatch(/--passes\s+inv,synth/);
  });

  it('README documents the cadence: before every v* tag + once per sprint close', () => {
    const content = readFileSync(SMOKE_README, 'utf-8');
    expect(content).toMatch(/before.*v\*.*tag/i);
    expect(content).toMatch(/sprint close/i);
  });

  it('README documents the not-in-CI rationale', () => {
    const content = readFileSync(SMOKE_README, 'utf-8');
    expect(content).toMatch(/not in CI/i);
    expect(content).toMatch(/(real (api )?(tokens|money)|cost)/i);
  });

  it('README documents #0322 Part C closure', () => {
    const content = readFileSync(SMOKE_README, 'utf-8');
    expect(content).toMatch(/#0322 Part C/);
  });

  it('RELEASE.md runbook references the real-LLM smoke harness', () => {
    const content = readFileSync(RELEASE_RUNBOOK, 'utf-8');
    expect(content).toMatch(/real-llm-smoke|real-LLM smoke/);
  });
});
