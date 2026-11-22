// #4128 BC-05 (Design 123 sections 17.5.3 and 17.5.7): the core pieces of the
// MCP baseline write path: the additive `mcp.baseline_write` key and the
// portfolio event written to an explicit workspace root.

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwaoYmlMcpSchema, SWAO_MCP_BASELINE_WRITE_MODES } from './swao-yml.js';
import { logPortfolioAt, setWorkspaceRoot } from './log.js';

const dirs: string[] = [];
afterEach(() => {
  setWorkspaceRoot(null);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('mcp.baseline_write (#4128 BC-05)', () => {
  it('accepts the three modes and refuses anything else; absent stays absent (default elicitation in the tool)', () => {
    for (const m of SWAO_MCP_BASELINE_WRITE_MODES) expect(SwaoYmlMcpSchema.safeParse({ baseline_write: m }).success).toBe(true);
    expect(SwaoYmlMcpSchema.safeParse({ baseline_write: 'always' }).success).toBe(false);
    expect(SwaoYmlMcpSchema.parse({ profile: 'full' })).toEqual({ profile: 'full' });
  });
});

describe('logPortfolioAt (#4128 BC-05)', () => {
  it('writes to the named workspace, not to the process-global log root', () => {
    const global = mkdtempSync(join(tmpdir(), 'swao-4128-global-'));
    const target = mkdtempSync(join(tmpdir(), 'swao-4128-target-'));
    dirs.push(global, target);
    writeFileSync(join(global, '.swao.yml'), 'version: 1\n');
    setWorkspaceRoot(global);
    logPortfolioAt(target, 'info', 'lz.baseline.written', 'written', { mirror: false, context: { policies_changed: 2 } });
    const month = new Date().toISOString().slice(0, 7);
    const file = join(target, 'wsp', 'logs', `portfolio-events-${month}.ndjson`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf-8').trim())).toMatchObject({ scope: 'portfolio', code: 'lz.baseline.written', context: { policies_changed: 2 } });
    expect(existsSync(join(global, 'wsp', 'logs', `portfolio-events-${month}.ndjson`))).toBe(false);
  });
});
