// #3587: privacy defaults of Design 120 section 6.4 at the workspace level:
// landing-zones/<lz-id>/.raw/ is git-ignored by `swao init` and never enters
// the support bundle.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { cmdSupportBundle } from './support-bundle.js';
import { ensureGitignore } from './init.js';

const tmp: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

// A raw API response marker that must never leave the workspace.
const RAW_MARKER = ['raw', 'api', 'response', 'marker', '42'].join('-');

describe('landing-zones/<lz-id>/.raw/ (#3587, Design 120 section 6.4)', () => {
  it('swao init writes the .raw rule into a new workspace .gitignore', () => {
    const ws = tempDir('swao-gi-new-');
    ensureGitignore(ws);
    expect(readFileSync(join(ws, '.gitignore'), 'utf-8').split(/\r?\n/)).toContain('landing-zones/*/.raw/');
  });

  it('swao init adds the .raw rule to an existing .gitignore once', () => {
    const ws = tempDir('swao-gi-old-');
    writeFileSync(join(ws, '.gitignore'), 'node_modules/\n');
    ensureGitignore(ws);
    ensureGitignore(ws);
    const lines = readFileSync(join(ws, '.gitignore'), 'utf-8').split(/\r?\n/);
    expect(lines).toContain('node_modules/');
    expect(lines.filter((l) => l === 'landing-zones/*/.raw/')).toHaveLength(1);
  });

  it('the support bundle carries no .raw/ content and no .raw path', () => {
    const ws = tempDir('swao-sb-ws-');
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    mkdirSync(join(ws, 'wsp'), { recursive: true });
    const raw = join(ws, 'landing-zones', 'otc-test', '.raw', '2026-11-03T08-00-00');
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(raw, 'traces.json'), JSON.stringify({ traces: [{ note: RAW_MARKER }] }));
    const run = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-03T08-00-00');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'otc-test.platform.lz-live-scan.json'), '{}');
    const out = tempDir('swao-sb-out-');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cmdSupportBundle({ workspace: ws, out });
    const bundles = readdirSync(out).filter((f) => f.endsWith('.tar.gz'));
    expect(bundles).toHaveLength(1);
    const tar = gunzipSync(readFileSync(join(out, bundles[0]!))).toString('latin1');
    expect(tar.length).toBeGreaterThan(0);
    expect(tar).not.toContain(RAW_MARKER);
    expect(tar).not.toContain('.raw/');
  });
});
