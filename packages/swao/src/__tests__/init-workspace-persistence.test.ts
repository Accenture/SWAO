import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INIT_SRC = resolve(__dirname, '../commands/init.ts');

describe('commands/init.ts -- saveDefaultWorkspace called on swao init (#2719)', () => {
  it('imports saveDefaultWorkspace from @swao/core', () => {
    const src = readFileSync(INIT_SRC, 'utf-8');
    expect(src).toContain("saveDefaultWorkspace");
    expect(src).toContain("from '@swao/core'");
  });

  it('calls saveDefaultWorkspace with workspaceDir before the final process.exit', () => {
    const src = readFileSync(INIT_SRC, 'utf-8');
    const saveIdx = src.indexOf('saveDefaultWorkspace(workspaceDir)');
    // Use lastIndexOf: init.ts has an early-exit path (already-existing workspace).
    // saveDefaultWorkspace must appear before the scaffolding-complete exit, not the early one.
    const lastExitIdx = src.lastIndexOf('process.exit(0)');
    expect(saveIdx).toBeGreaterThan(-1);
    expect(lastExitIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeLessThan(lastExitIdx);
  });
});
