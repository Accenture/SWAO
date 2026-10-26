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

// #3428: self-test for tests/audit-gates/source-scope-single-walker.gate.mjs.
// The gate runs against a copy of the files it scans (--root): the clean copy
// passes; an added raw readdirSync walker in a pass fails; a --source-path
// argument in the MCP assess spawn fails.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../../..');
const GATE = join(REPO_ROOT, 'tests', 'audit-gates', 'source-scope-single-walker.gate.mjs');
const PKGS = join(REPO_ROOT, 'swao', 'packages');

// What the gate reads: the passes folders, the service profile, assess.ts and the MCP server.
const COPY = [
  ['@swao', 'module-app-assessment', 'src', 'passes'],
  ['@swao', 'module-service-assessment', 'src', 'profile'],
  ['swao', 'src', 'passes'],
  ['swao', 'src', 'commands', 'assess.ts'],
  ['@swao', 'module-mcp', 'src', 'server.ts'],
];

let root: string;

function runGate(): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf-8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-gate-3428-'));
  for (const parts of COPY) {
    const from = join(PKGS, ...parts);
    if (!existsSync(from)) continue;
    cpSync(from, join(root, 'swao', 'packages', ...parts), { recursive: true });
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('source-scope-single-walker gate (#3428)', () => {
  it('passes on the current analysis code', () => {
    const r = runGate();
    expect(r.out).toContain('[ok] source-scope-single-walker');
    expect(r.status).toBe(0);
  });

  it('fails when a pass adds its own readdirSync walker', () => {
    const file = join(root, 'swao', 'packages', '@swao', 'module-app-assessment', 'src', 'passes', 'pass-07-egr.ts');
    const original = readFileSync(file, 'utf-8');
    appendFileSync(file, "\nfunction sneaky(d: string): string[] { return readdirSync(d); }\n");
    try {
      const r = runGate();
      expect(r.status).toBe(1);
      expect(r.out).toContain('pass-07-egr.ts');
    } finally {
      writeFileSync(file, original, 'utf-8');
    }
  });

  it('fails when an allowlisted file gains an extra listing call', () => {
    const file = join(root, 'swao', 'packages', '@swao', 'module-app-assessment', 'src', 'passes', 'pass-09-synth.ts');
    const original = readFileSync(file, 'utf-8');
    appendFileSync(file, "\nconst extra = (d: string) => readdirSync(d, { withFileTypes: true });\n");
    try {
      expect(runGate().status).toBe(1);
    } finally {
      writeFileSync(file, original, 'utf-8');
    }
  });

  it('fails when the MCP assess spawn passes --source-path (bypasses vcs.subdir)', () => {
    const file = join(root, 'swao', 'packages', '@swao', 'module-mcp', 'src', 'server.ts');
    const original = readFileSync(file, 'utf-8');
    appendFileSync(file, "\nconst bypass = ['assess', '--source-path', '/tmp/x'];\n");
    try {
      const r = runGate();
      expect(r.status).toBe(1);
      expect(r.out).toContain('--source-path');
    } finally {
      writeFileSync(file, original, 'utf-8');
    }
  });
});
