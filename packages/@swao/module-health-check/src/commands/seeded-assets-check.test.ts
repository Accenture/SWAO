// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module -- seeded-asset detection (#3388, Design 112 D-3)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3388 (D-3): the LLM gateway folder is the single source (no runtime
// fallback), so the health check must detect a missing/empty folder, re-seed
// the packaged connectors best-effort, and WARN only if it stays empty.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSeededAssets } from './health-check.js';
import { resolveBundledConnectorsDir } from '@swao/module-llm-providers';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// A real workspace carries a `.swao.yml`. The self-heal seeding only runs inside
// one (#3388), so helpers for the seeding paths must create the marker.
function ws(): string {
  const w = mkdtempSync(join(tmpdir(), 'swao-seed-check-'));
  dirs.push(w);
  writeFileSync(join(w, '.swao.yml'), 'workspace:\n  name: test\n');
  return w;
}

// A bare directory that is NOT a workspace (no `.swao.yml`), e.g. wherever a
// client happens to run `swao health-check` from.
function bareDir(): string {
  const w = mkdtempSync(join(tmpdir(), 'swao-seed-bare-'));
  dirs.push(w);
  return w;
}

describe('checkSeededAssets (#3388)', () => {
  it('seeds the LLM gateway folder when it is missing, and reports it', () => {
    const w = ws();
    const out = checkSeededAssets(w);
    const gwDir = join(w, 'wsp', 'inputs', 'llm-gateway');
    if (resolveBundledConnectorsDir()) {
      // Bundled seeds available (dev + binary): the folder is created and filled.
      const seeded = readdirSync(gwDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      expect(seeded.length).toBeGreaterThan(0);
      expect(out.some(l => l.startsWith('[INFO] Seeded'))).toBe(true);
      expect(out.some(l => l.startsWith('[WARN]'))).toBe(false);
    } else {
      // No bundled source in this environment: a WARN is the correct outcome.
      expect(out.some(l => l.startsWith('[WARN]'))).toBe(true);
    }
  });

  it('is silent when the folder already has a connector', () => {
    const w = ws();
    const gwDir = join(w, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'my-gateway.yaml'), 'connector:\n  id: my-gw\n');
    expect(checkSeededAssets(w)).toEqual([]);
  });

  it('ignores underscore-prefixed files (templates) when counting', () => {
    const w = ws();
    const gwDir = join(w, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, '_template.yaml'), 'connector: {}\n');
    // Only a template present -> treated as empty -> seeds or warns, never silent.
    expect(checkSeededAssets(w).length).toBeGreaterThan(0);
  });

  it('returns nothing for a null workspace', () => {
    expect(checkSeededAssets(null)).toEqual([]);
  });

  it('does NOT seed or create wsp/ in a non-workspace directory (#3388 litter guard)', () => {
    // health-check resolves workspacePath from process.cwd() when no --workspace
    // is given, so this is the directory a client runs the command from. Without
    // a .swao.yml it must stay untouched -- no seeding, no folders.
    const d = bareDir();
    expect(checkSeededAssets(d)).toEqual([]);
    expect(existsSync(join(d, 'wsp'))).toBe(false);
  });
});
