// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass 14 secret scan (#3419) -- default Gitleaks scan, MAL-00, history
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// A fake tool runner (#4300: Pass 14 runs its tools through the injectable
// async runner) controls whether Gitleaks is "installed" and what it reports;
// no tool runs, no network.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ToolRunner } from '@swao/core';
import { runSecretScanPass, runMalwarePass, buildGitleaksArgs, readMalwareConfig, runPass14Tool } from './pass-14-malware.js';

interface SpawnCall { cmd: string; args: readonly string[] }
const calls: SpawnCall[] = [];
let installed = new Set<string>();
let gitleaksFindings: unknown[] | null = null;

const fakeRunner: ToolRunner = async (req) => {
  const cmd = req.command;
  const args = req.args;
  calls.push({ cmd, args });
  if (!installed.has(cmd)) {
    return { exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: `spawn ${cmd} ENOENT` };
  }
  if (cmd === 'gitleaks' && gitleaksFindings && gitleaksFindings.length > 0) {
    const i = args.indexOf('--report-path');
    writeFileSync(String(args[i + 1]), JSON.stringify(gitleaksFindings), 'utf-8');
    return { exitCode: 1, stdout: '', stderr: '', timedOut: false, spawnError: null };
  }
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null };
};
const deps = { runner: fakeRunner };


function ctxFor(source: string, workspace: string) {
  return { appId: 'a', sourcePath: source, workspacePath: workspace, iter: 1, assessedAt: '2026-10-23' };
}

function tmp(): { source: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-3419-'));
  const source = join(root, 'src');
  mkdirSync(source);
  return { source, workspace: root };
}

beforeEach(() => {
  calls.length = 0;
  installed = new Set();
  gitleaksFindings = null;
});

describe('runSecretScanPass (#3419 default secret scan)', () => {
  it('runs Gitleaks only: no OSV-Scanner, ClamAV, YARA or ORT', async () => {
    installed = new Set(['gitleaks', 'osv-scanner', 'clamscan', 'clamdscan', 'yara']);
    const { source, workspace } = tmp();
    writeFileSync(join(source, 'package-lock.json'), '{}');
    const r = await runSecretScanPass(ctxFor(source, workspace), deps);
    expect(new Set(calls.map((c) => c.cmd))).toEqual(new Set(['gitleaks']));
    expect(r.pass.name).toBe('secret_scan');
    expect(r.pass.id).toBe(14);
    expect(r.pass.status).toBe('complete');
    expect(r.assessment['scan_set']).toBe('secrets');
    expect(r.assessment['tools_skipped']).toEqual([]);
    expect(r.signals.map((s) => s.id)).toEqual(['MAL-03']);
  });

  it('missing Gitleaks yields an informational MAL-00 with the install hint, not only a console warning', async () => {
    const { source, workspace } = tmp();
    const r = await runSecretScanPass(ctxFor(source, workspace), deps);
    expect(r.pass.status).toBe('not_applicable');
    expect(r.assessment['malware_scan_status']).toBe('skipped_tools_missing');
    expect(r.assessment['missing_tools']).toEqual(['gitleaks']);
    const mal00 = r.signals.find((s) => s.id === 'MAL-00');
    expect(mal00).toBeDefined();
    expect(mal00!.severity).toBe('informational');
    expect(mal00!.derivation).toContain('Secret scan incomplete');
    expect(mal00!.derivation).toContain('gitleaks');
    expect(mal00!.derivation).toContain('install');
  });

  it('masks detected secret values (#3415): the clear text never reaches the signal', async () => {
    installed = new Set(['gitleaks']);
    const planted = 'Sup3rS3cretPassw0rd!';
    gitleaksFindings = [{ RuleID: 'generic-password', File: 'src/db.ts', StartLine: 7, Secret: planted, Match: `password = "${planted}"` }];
    const { source, workspace } = tmp();
    const r = await runSecretScanPass(ctxFor(source, workspace), deps);
    const sig = r.signals.find((s) => s.id === 'MAL-03');
    expect(sig?.severity).toBe('high');
    const dumped = JSON.stringify(r);
    expect(dumped).not.toContain(planted);
    expect(dumped).toContain(`Su***(${planted.length})`);
  });
});

describe('runMalwarePass full scan (#3419)', () => {
  it('emits MAL-00 when only Gitleaks is missing although other tools ran', async () => {
    installed = new Set(['osv-scanner']);
    const { source, workspace } = tmp();
    writeFileSync(join(source, 'package-lock.json'), '{}');
    const r = await runMalwarePass(ctxFor(source, workspace), deps);
    expect(r.pass.name).toBe('malware_scanning');
    expect(r.assessment['tools_attempted']).toContain('osv-scanner');
    expect(r.signals.some((s) => s.id === 'MAL-00' && s.derivation.includes('gitleaks'))).toBe(true);
  });

  it('does not count ORT "not enabled" or YARA "no rules" as a missing tool', async () => {
    installed = new Set(['gitleaks']);
    const { source, workspace } = tmp();
    const r = await runMalwarePass(ctxFor(source, workspace), deps);
    const missing = (r.assessment['missing_tools'] as string[] | undefined) ?? [];
    expect(missing.some((m) => m.startsWith('ort') || m.startsWith('yara ('))).toBe(false);
  });
});

describe('Gitleaks history scan option (#3419 tools.gitleaks.scan_history)', () => {
  const cfg = { gitleaksConfigFile: undefined, gitleaksScanHistory: false };

  it('keeps --no-git by default', () => {
    expect(buildGitleaksArgs(cfg, '/s', '/w', '/r.json', true)).toContain('--no-git');
  });

  it('drops --no-git when scan_history is set and the source has a .git', () => {
    expect(buildGitleaksArgs({ ...cfg, gitleaksScanHistory: true }, '/s', '/w', '/r.json', true)).not.toContain('--no-git');
  });

  it('keeps --no-git when scan_history is set but there is no .git', () => {
    expect(buildGitleaksArgs({ ...cfg, gitleaksScanHistory: true }, '/s', '/w', '/r.json', false)).toContain('--no-git');
  });

  it('reads scan_history from passes.malware.tools.gitleaks in .swao.yml and the pass honours it', async () => {
    installed = new Set(['gitleaks']);
    const { source, workspace } = tmp();
    mkdirSync(join(source, '.git'));
    writeFileSync(join(workspace, '.swao.yml'), 'passes:\n  malware:\n    tools:\n      gitleaks:\n        scan_history: true\n');
    expect(readMalwareConfig(workspace).gitleaksScanHistory).toBe(true);
    await runSecretScanPass(ctxFor(source, workspace), deps);
    const g = calls.find((c) => c.cmd === 'gitleaks');
    expect(g?.args).not.toContain('--no-git');
  });

  it('defaults scan_history to false', () => {
    const { workspace } = tmp();
    expect(readMalwareConfig(workspace).gitleaksScanHistory).toBe(false);
  });
});

describe('Pass 14 tool runs do not block the event loop (#4300)', () => {
  it('maps the runner outcome: ENOENT, timeout, exit code and output', async () => {
    const r = (res: Awaited<ReturnType<ToolRunner>>): ToolRunner => async () => res;
    expect((await runPass14Tool(r({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'spawn gitleaks ENOENT' }), 'gitleaks', [], 1000)).error?.code).toBe('ENOENT');
    expect((await runPass14Tool(r({ exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null }), 'gitleaks', [], 1000)).error?.code).toBe('ETIMEDOUT');
    const ok = await runPass14Tool(r({ exitCode: 1, stdout: 'out', stderr: 'err', timedOut: false, spawnError: null }), 'osv-scanner', ['--x'], 1000);
    expect(ok).toEqual({ status: 1, stdout: 'out', stderr: 'err' });
  });

  it('a timer (the run heartbeat) fires while the scanner runs', async () => {
    installed = new Set(['gitleaks']);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const slow: ToolRunner = async (req) => {
      calls.push({ cmd: req.command, args: req.args });
      // Wait until the timer has fired three times while this run is in flight
      // (bounded): a fixed 60 ms wait gave too few ticks under a loaded suite.
      const end = Date.now() + 3000;
      while (ticks <= 2 && Date.now() < end) await new Promise((res) => setTimeout(res, 10));
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null };
    };
    const { source, workspace } = tmp();
    const res = await runSecretScanPass(ctxFor(source, workspace), { runner: slow });
    clearInterval(timer);
    expect(res.signals.map((s) => s.id)).toEqual(['MAL-03']);
    expect(ticks).toBeGreaterThan(2);
  });
});
