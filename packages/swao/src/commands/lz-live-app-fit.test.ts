// #3822: the host hook that gives the landing zone portfolio merge the
// required services of an app (same derivation as the LZ catalogue fit).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const signals = vi.hoisted(() => ({ byDir: new Map<string, unknown[]>() }));
vi.mock('@swao/module-app-assessment', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/module-app-assessment')>();
  return { ...original, loadPriorSignals: vi.fn((dir: string) => signals.byDir.get(dir) ?? []) };
});

import { lzLiveAppRequiredServices } from './lz-live-app-fit.js';

const tmp: string[] = [];
afterEach(() => { signals.byDir.clear(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-lzl-appfit-'));
  tmp.push(d);
  mkdirSync(join(d, 'apps', 'payments'), { recursive: true });
  return d;
}

describe('lzLiveAppRequiredServices (#3822)', () => {
  it('derives the required services from the app signals (service_dep implies)', () => {
    const root = ws();
    signals.byDir.set(join(root, 'apps', 'payments'), [
      { id: 'INV-10', implies: ['service_dep:postgresql', 'service_dep:kafka'], confidence: 'high', evidence: ['postgresql: pom.xml'] },
      { id: 'INV-11', implies: ['service_dep:postgresql'] },
    ]);
    expect(lzLiveAppRequiredServices(root, 'payments')).toEqual([
      { code: 'postgresql', signalId: 'INV-10', confidence: 'high', evidence: ['pom.xml'] },
      { code: 'kafka', signalId: 'INV-10', confidence: 'high', evidence: ['postgresql: pom.xml'] },
    ]);
  });

  it('undefined for an app without signals, an unknown app folder or an unsafe id', () => {
    const root = ws();
    expect(lzLiveAppRequiredServices(root, 'payments')).toBeUndefined();
    expect(lzLiveAppRequiredServices(root, 'billing')).toBeUndefined();
    expect(lzLiveAppRequiredServices(root, '../escape')).toBeUndefined();
  });
});
