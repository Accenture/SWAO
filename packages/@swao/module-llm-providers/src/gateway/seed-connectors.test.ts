import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { seedBundledConnectors, resolveBundledConnectorsDir } from './connector-loader.js';

let ws = '';
afterEach(() => { if (ws) rmSync(ws, { recursive: true, force: true }); });

describe('seedBundledConnectors (#3388)', () => {
  it('resolves a bundled connectors dir in the source tree', () => {
    expect(resolveBundledConnectorsDir()).not.toBeNull();
  });

  it('copies the public seeds into wsp/inputs/llm-gateway and writes a marker', () => {
    ws = mkdtempSync(join(tmpdir(), 'swao-seed-'));
    const r = seedBundledConnectors(ws);
    const dir = join(ws, 'wsp', 'inputs', 'llm-gateway');
    expect(r.copied).toContain('anthropic.yaml');
    expect(r.copied).toContain('openrouter.yaml');
    expect(existsSync(join(dir, 'bedrock.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.seeded'))).toBe(true);
  });

  it('does not overwrite an existing connector file', () => {
    ws = mkdtempSync(join(tmpdir(), 'swao-seed-'));
    const dir = join(ws, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'anthropic.yaml'), 'custom: true\n', 'utf-8');
    const r = seedBundledConnectors(ws);
    expect(r.copied).not.toContain('anthropic.yaml');
    expect(readFileSync(join(dir, 'anthropic.yaml'), 'utf-8')).toBe('custom: true\n');
  });

  it('does not re-seed a file the user deleted (marker respected)', () => {
    ws = mkdtempSync(join(tmpdir(), 'swao-seed-'));
    const dir = join(ws, 'wsp', 'inputs', 'llm-gateway');
    seedBundledConnectors(ws);
    rmSync(join(dir, 'bedrock.yaml'));
    const r2 = seedBundledConnectors(ws);
    expect(r2.copied).not.toContain('bedrock.yaml');
    expect(existsSync(join(dir, 'bedrock.yaml'))).toBe(false);
  });
});
