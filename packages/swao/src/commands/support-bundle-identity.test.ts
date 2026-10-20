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

/**
 * #3331: the support bundle must not carry the OS user name, the host name or
 * a user-profile path anywhere inside any file, including mid-sentence probe
 * messages (the MCP stale-entry message of #3163 was the reported leak).
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { homedir, hostname, tmpdir, userInfo } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { _paths as licencePaths } from '@swao/core';
import { cmdSupportBundle, redactUserIdentity, type BundleIdentity } from './support-bundle.js';

const WIN_ID: BundleIdentity = { home: 'C:\\Users\\jane.doe', users: ['jane.doe'], hosts: ['WS-JD-0042'] };
const POSIX_ID: BundleIdentity = { home: '/home/jdoe', users: ['jdoe'], hosts: ['build-box-7'] };

describe('redactUserIdentity (#3331)', () => {
  it('redacts a user-profile path embedded mid-string in an MCP stale-entry message (JSON-escaped)', () => {
    const message = 'msix config C:\\Users\\jane.doe\\AppData\\Local\\Packages\\Claude_abc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json '
      + 'points at C:\\swao\\swao-v1.4.0\\swao-enterprise-win-x64.exe (not the running SWAO binary); conventional config '
      + 'C:\\Users\\jane.doe\\AppData\\Roaming\\Claude\\claude_desktop_config.json points at C:\\swao\\old\\swao.exe';
    const text = JSON.stringify({ health_check: { mcp: { status: 'stale_entry', message } } }, null, 2);
    const out = redactUserIdentity(text, WIN_ID);
    expect(out.toLowerCase()).not.toContain('jane');
    const parsed = JSON.parse(out) as { health_check: { mcp: { message: string } } };
    // Still useful: the rest of the path and the non-profile paths survive.
    expect(parsed.health_check.mcp.message).toContain('msix config <home>\\AppData\\Local\\Packages\\Claude_abc');
    expect(parsed.health_check.mcp.message).toContain('C:\\swao\\swao-v1.4.0\\swao-enterprise-win-x64.exe');
  });

  it('redacts raw (unescaped) and forward-slash forms of the home directory, case-insensitively', () => {
    const out = redactUserIdentity('a c:\\users\\JANE.DOE\\x b C:/Users/jane.doe/y', WIN_ID);
    expect(out).toBe('a <home>\\x b <home>/y');
  });

  it('redacts any other user profile, /home/<name> and /Users/<name>, but keeps Public', () => {
    const id: BundleIdentity = { home: null, users: [], hosts: [] };
    expect(redactUserIdentity('err at D:\\Users\\other.person\\proj\\a.ts', id)).toBe('err at <home>\\proj\\a.ts');
    expect(redactUserIdentity('cfg /home/alice/.config/x and /Users/bob/Library/y', id)).toBe('cfg <home>/.config/x and <home>/Library/y');
    expect(redactUserIdentity('"C:\\\\Users\\\\carol\\\\x"', id)).toBe('"<home>\\\\x"');
    expect(redactUserIdentity('C:\\Users\\Public\\Documents', id)).toBe('C:\\Users\\Public\\Documents');
    // Not a path segment: a URL path is left alone.
    expect(redactUserIdentity('https://example.org/home/page', id)).toBe('https://example.org/home/page');
  });

  it('redacts %USERPROFILE%', () => {
    expect(redactUserIdentity('set to %USERPROFILE%\\swao', POSIX_ID)).toBe('set to <home>\\swao');
  });

  it('redacts the user name and host name as standalone tokens, not inside other words', () => {
    const out = redactUserIdentity('built by jdoe on build-box-7 (JDOE@BUILD-BOX-7); jdoex and xjdoe stay', POSIX_ID);
    expect(out).toBe('built by <user> on <host> (<user>@<host>); jdoex and xjdoe stay');
    expect(redactUserIdentity('/home/jdoe/w and /home/jdoe', POSIX_ID)).toBe('<home>/w and <home>');
  });

  it('skips generic or short tokens that would mangle ordinary text', () => {
    const id: BundleIdentity = { home: null, users: ['root', 'ab'], hosts: ['localhost'] };
    expect(redactUserIdentity('workspace root ab on localhost', id)).toBe('workspace root ab on localhost');
  });
});

// ---- end to end: run the command, extract the tarball, scan every file ----

function untar(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('ascii').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    off += 512;
    files.set(name, buf.subarray(off, off + size).toString('utf-8'));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

const FAKE_USER = 'zq3331operator';
const FAKE_HOST = 'ZQ3331-WORKSTATION';
const ENV_KEYS = ['USERNAME', 'USER', 'COMPUTERNAME', 'HOSTNAME', 'SWAO_TEST_3331_DIR', 'SWAO_TEST_3331_NOTE'] as const;

describe('cmdSupportBundle: no user identity in any bundle file (#3331)', () => {
  let ws = '';
  let cwd = '';
  let saved: Record<string, string | undefined> = {};
  let savedPaths = { ...licencePaths };

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    cwd = process.cwd();
    ws = mkdtempSync(join(tmpdir(), 'swao-sbt-identity-'));
    // LicenseGuard.load() may create or migrate state files: keep it off the operator's real home.
    savedPaths = { ...licencePaths };
    const lic = join(ws, 'licence-sandbox');
    mkdirSync(lic);
    Object.assign(licencePaths, {
      statePath: join(lic, '.swao-state.json'),
      licensePath: join(lic, 'licence.json'),
      legacyLicencePath: join(lic, 'no-legacy.json'),
    });
  });
  afterEach(() => {
    Object.assign(licencePaths, savedPaths);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    process.chdir(cwd);
    process.exitCode = undefined;
    rmSync(ws, { recursive: true, force: true });
  });

  it('scrubs a planted MCP probe message, log text and SWAO_* env values across all files', () => {
    // currentBundleIdentity() also reads these env vars, so the planted values are known identities.
    process.env['USERNAME'] = FAKE_USER;
    process.env['COMPUTERNAME'] = FAKE_HOST;
    const realHome = homedir();
    let realUser = '';
    try { realUser = userInfo().username; } catch { /* none */ }
    const realHost = hostname();
    process.env['SWAO_TEST_3331_DIR'] = join(realHome, 'swao-projects');
    process.env['SWAO_TEST_3331_NOTE'] = `run by ${FAKE_USER} on ${FAKE_HOST}`;

    mkdirSync(join(ws, 'apps'), { recursive: true });
    writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: identity-test\n');
    const logs = join(ws, 'wsp', 'logs');
    mkdirSync(logs, { recursive: true });
    const mcpMessage = `msix config C:\\Users\\${FAKE_USER}\\AppData\\Local\\Packages\\Claude_x\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json `
      + `points at C:\\swao\\swao-v1.4.0\\swao-enterprise-win-x64.exe (not the running SWAO binary); conventional config `
      + `${join(realHome, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')} points at /home/${FAKE_USER}/swao`;
    writeFileSync(join(logs, 'health-check-2026-10.ndjson'), `${JSON.stringify({
      ts: '2026-10-18T12:00:00.000Z',
      fail_count: 0,
      probes: { mcp: { status: 'stale_entry', message: mcpMessage }, scope: { status: 'warn', message: `host ${FAKE_HOST} user ${FAKE_USER}` } },
    })}\n`);
    writeFileSync(join(logs, 'portfolio-events-2026-10.ndjson'), `${JSON.stringify({
      ts: new Date().toISOString(), level: 'error', scope: 'portfolio', code: 'test.error',
      message: `failed reading ${join(realHome, 'Documents', 'x.yml')} on ${FAKE_HOST}`,
      context: { cwd: ws, who: FAKE_USER },
    })}\n`);

    const outDir = join(ws, 'out');
    process.chdir(ws);
    cmdSupportBundle({ workspace: ws, out: outDir });
    expect(process.exitCode ?? 0).toBe(0);

    const tgz = readdirSync(outDir).filter((f) => f.endsWith('.tar.gz'));
    expect(tgz).toHaveLength(1);
    const files = untar(gunzipSync(readFileSync(join(outDir, tgz[0]!))));
    expect(files.size).toBeGreaterThanOrEqual(17);

    const needles = [FAKE_USER, FAKE_HOST, realHome];
    if (realUser.length >= 3 && !['root', 'runner', 'node', 'user', 'admin'].includes(realUser.toLowerCase())) needles.push(realUser);
    if (realHost.length >= 3 && realHost.toLowerCase() !== 'localhost') needles.push(realHost);
    const hits: string[] = [];
    for (const [name, text] of files) {
      const lower = text.toLowerCase();
      for (const n of needles) {
        const variants = [n, n.replace(/\\/g, '\\\\'), n.replace(/\\/g, '/')].map((v) => v.toLowerCase());
        if (variants.some((v) => lower.includes(v))) hits.push(`${name}: ${n}`);
      }
      if (name.endsWith('.json')) expect(() => JSON.parse(text), name).not.toThrow();
    }
    expect(hits).toEqual([]);

    // Still useful: the probe message keeps its structure.
    const hc = JSON.parse(files.get('health-check.json')!) as { health_check: { probes: { mcp: { message: string } } } };
    expect(hc.health_check.probes.mcp.message).toContain('msix config <home>\\AppData\\Local\\Packages\\Claude_x');
    expect(hc.health_check.probes.mcp.message).toContain('C:\\swao\\swao-v1.4.0\\swao-enterprise-win-x64.exe');
    const env = JSON.parse(files.get('environment.json')!) as { swao_env_vars: Record<string, string> };
    expect(env.swao_env_vars['SWAO_TEST_3331_NOTE']).toBe('run by <user> on <host>');
  }, 120_000);
});
