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

// spawnSync is mocked so the tests control whether Gitleaks is "installed"
// and what it reports; no tool runs, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

interface SpawnCall { cmd: string; args: readonly string[] }
const calls: SpawnCall[] = [];
let installed = new Set<string>();
let gitleaksFindings: unknown[] | null = null;

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: (cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      if (!installed.has(cmd)) {
        const err = Object.assign(new Error(`spawnSync ${cmd} ENOENT`), { code: 'ENOENT' });
        return { status: null, error: err, stdout: '', stderr: '', pid: 0, output: [], signal: null };
      }
      if (cmd === 'gitleaks' && gitleaksFindings && gitleaksFindings.length > 0) {
        const i = args.indexOf('--report-path');
        writeFileSync(String(args[i + 1]), JSON.stringify(gitleaksFindings), 'utf-8');
        return { status: 1, stdout: '', stderr: '', pid: 0, output: [], signal: null };
      }
      return { status: 0, stdout: '', stderr: '', pid: 0, output: [], signal: null };
    },
  };
});

const { runSecretScanPass, runMalwarePass, buildGitleaksArgs, readMalwareConfig } = await import('./pass-14-malware.js');

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
    const r = await runSecretScanPass(ctxFor(source, workspace));
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
    const r = await runSecretScanPass(ctxFor(source, workspace));
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
    const r = await runSecretScanPass(ctxFor(source, workspace));
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
    const r = await runMalwarePass(ctxFor(source, workspace));
    expect(r.pass.name).toBe('malware_scanning');
    expect(r.assessment['tools_attempted']).toContain('osv-scanner');
    expect(r.signals.some((s) => s.id === 'MAL-00' && s.derivation.includes('gitleaks'))).toBe(true);
  });

  it('does not count ORT "not enabled" or YARA "no rules" as a missing tool', async () => {
    installed = new Set(['gitleaks']);
    const { source, workspace } = tmp();
    const r = await runMalwarePass(ctxFor(source, workspace));
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
    await runSecretScanPass(ctxFor(source, workspace));
    const g = calls.find((c) => c.cmd === 'gitleaks');
    expect(g?.args).not.toContain('--no-git');
  });

  it('defaults scan_history to false', () => {
    const { workspace } = tmp();
    expect(readMalwareConfig(workspace).gitleaksScanHistory).toBe(false);
  });
});
