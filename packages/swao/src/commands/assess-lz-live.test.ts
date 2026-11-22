// #3766: `swao assess --type landing-zone-live` is dispatched to the live
// runner before the --app handling (Design 120 section 13.2). Spawns the
// compiled CLI (dist/index.js, as health-check-json.test.ts does); the runner
// itself is covered on the OTC mock in module-landing-zone
// (live/__tests__/assess.test.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'dist', 'index.js');
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(args: string[], ws: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [cli, 'assess', '--workspace', ws, ...args], {
    encoding: 'utf-8',
    cwd: ws,
    env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'enterprise' },
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.skipIf(!existsSync(cli))('swao assess --type landing-zone-live (#3766)', () => {
  it('needs --lz, and refuses an unregistered landing zone; no --app is asked for', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-assess-lzl-'));
    tmp.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    const a = run(['--type', 'landing-zone-live'], ws);
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/requires --lz <lz-id>/);
    expect(a.out).not.toMatch(/--app/);
    const b = run(['--type', 'landing-zone-live', '--lz', 'otc-test', '--frameworks', 'BSI_C5'], ws);
    // Dispatched to the live runner: either the tier gate (a source build runs
    // as Community in CI; exit 2 with the [LICENSE] block, ADR-0055 and #3844)
    // or, licensed, the unknown landing zone refusal (exit 1).
    const tier = /\[LICENSE\] swao assess --type landing-zone-live and swao lz scan \(Landing Zone Live Assessment\) requires/.test(b.out);
    expect(b.code).toBe(tier ? 2 : 1);
    expect(b.out).toMatch(/landing zone otc-test is not registered|\[LICENSE\] swao assess --type landing-zone-live/);
    expect(b.out).not.toMatch(/coming soon/);
  }, 260_000);
});
