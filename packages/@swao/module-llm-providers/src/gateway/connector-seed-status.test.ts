// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- outdated workspace seed, bundled price (#4491)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  bundledModelPrice, connectorSeedStatus, getConnector, outdatedWorkspaceConnectors,
  resolveBundledConnectorsDir, seedStatusText, updateBundledConnectors,
} from './connector-loader.js';
import { buildLlmGatewayProbe } from './gateway-probe.js';

function anthropicYaml(reviewed: string, models: Array<[string, number, number] | [string]>): string {
  return [
    'schema_version: "1.0"',
    'connector:',
    '  id: anthropic',
    '  name: Anthropic Claude',
    '  protocol: anthropic-messages',
    '  base_url: https://api.anthropic.example',
    '  auth:',
    '    credential_key: anthropic-api-key',
    '    header: x-api-key',
    '    scheme: raw',
    '  models:',
    `    default: ${models[0]![0]}`,
    '    catalogue:',
    ...models.flatMap((m) => [`      - id: ${m[0]}`, ...(m.length === 3 ? [`        cost: { input_per_million: ${m[1]}, output_per_million: ${m[2]} }`] : [])]),
    '  meta:',
    '    source: bundled',
    `    last_reviewed: "${reviewed}"`,
    '',
  ].join('\n');
}

// The owner's case (dev11): the seed of 2026-08-05 against the packaged file of 2026-11-16.
const OLD = anthropicYaml('2026-08-05', [['claude-haiku-4-5-20251001', 1, 5], ['claude-opus-4-7', 15, 75], ['claude-haiku-5-5']]);
const NEW = anthropicYaml('2026-11-16', [['claude-haiku-5-5', 0.1, 0.5], ['claude-opus-4-7', 5, 25], ['claude-haiku-4-5-20251001', 1, 5]]);

let root: string;
let src: string;
let ws: string;
let gw: string;

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

function seedOld(): void {
  writeFileSync(join(gw, 'anthropic.yaml'), OLD);
  writeFileSync(join(gw, '.seeded.json'), JSON.stringify({ files: { 'anthropic.yaml': sha(join(gw, 'anthropic.yaml')) } }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-4491-'));
  src = join(root, 'bundled');
  ws = join(root, 'ws');
  gw = join(ws, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(src, { recursive: true });
  mkdirSync(gw, { recursive: true });
  writeFileSync(join(src, 'anthropic.yaml'), NEW);
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('connectorSeedStatus (#4491)', () => {
  it('an unedited old seed is outdated; the update brings claude-opus-4-7 5/25 and claude-haiku-5-5 0.10/0.50', () => {
    seedOld();
    const s = connectorSeedStatus(ws, 'anthropic', { srcDir: src });
    expect(s).toMatchObject({ status: 'outdated', file: 'anthropic.yaml', workspaceReviewed: '2026-08-05', bundledReviewed: '2026-11-16' });
    expect(seedStatusText(s)).toContain('older than the packaged one (reviewed 2026-08-05, packaged 2026-11-16)');
    // The Setup LLM step names neither the step nor the CLI; other TUI screens name no CLI syntax.
    expect(seedStatusText(s, { hint: 'none', withFile: false })).toBe('is older than the packaged one (reviewed 2026-08-05, packaged 2026-11-16)');
    expect(seedStatusText(s, { hint: 'setup' })).not.toContain('swao llm-gateway');
    expect(seedStatusText(s)).toContain('swao llm-gateway update');
    expect(outdatedWorkspaceConnectors(ws, { srcDir: src }).map((x) => x.status)).toEqual(['outdated']);

    const r = updateBundledConnectors(ws, { srcDir: src, only: ['anthropic.yaml'] });
    expect(r.updated).toEqual(['anthropic.yaml']);
    const cat = getConnector('anthropic', { workspaceRoot: ws })!.file.connector.models.catalogue!;
    expect(cat.find((m) => m.id === 'claude-opus-4-7')!.cost).toEqual({ input_per_million: 5, output_per_million: 25 });
    expect(cat.find((m) => m.id === 'claude-haiku-5-5')!.cost).toEqual({ input_per_million: 0.1, output_per_million: 0.5 });
    expect(connectorSeedStatus(ws, 'anthropic', { srcDir: src }).status).toBe('current');
  });

  it('an edited copy gets a notice only (edited), never the update', () => {
    seedOld();
    writeFileSync(join(gw, 'anthropic.yaml'), OLD.replace('Anthropic Claude', 'Anthropic (ours)'));
    const s = connectorSeedStatus(ws, 'anthropic', { srcDir: src });
    expect(s.status).toBe('edited');
    expect(seedStatusText(s)).toContain('was edited and a newer packaged version exists');
    expect(updateBundledConnectors(ws, { srcDir: src, only: ['anthropic.yaml'] }).keptModified).toEqual(['anthropic.yaml']);
  });

  it('a current copy with discovered models and a price filled by discovery stays current', () => {
    writeFileSync(join(gw, 'anthropic.yaml'), NEW.replace('    catalogue:\n', '    discovered_at: "2026-11-16T17:34:26.434Z"\n    catalogue:\n') + '');
    expect(connectorSeedStatus(ws, 'anthropic', { srcDir: src }).status).toBe('current');
    expect(connectorSeedStatus(ws, 'unknown', { srcDir: src }).status).toBe('none');
  });
});

describe('bundledModelPrice (#4491)', () => {
  it('the packaged price of a listed model, also for a dated snapshot; undefined otherwise', () => {
    expect(bundledModelPrice('anthropic', 'claude-haiku-5-5', { srcDir: src })).toEqual({ input_per_million: 0.1, output_per_million: 0.5 });
    expect(bundledModelPrice('anthropic', 'claude-opus-4-7-20260101', { srcDir: src })).toEqual({ input_per_million: 5, output_per_million: 25 });
    expect(bundledModelPrice('anthropic', 'claude-unknown', { srcDir: src })).toBeUndefined();
    expect(bundledModelPrice('nope', 'x', { srcDir: src })).toBeUndefined();
  });
});

describe('Health Check llm_gateway probe warns about an outdated seed (#4491)', () => {
  it('names the outdated unedited connector file', async () => {
    const real = resolveBundledConnectorsDir();
    expect(real).not.toBeNull();
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    for (const f of ['anthropic.yaml']) copyFileSync(join(real!, f), join(gw, f));
    const text = readFileSync(join(gw, 'anthropic.yaml'), 'utf-8');
    const reviewed = /last_reviewed: "([^"]+)"/.exec(text)![1]!;
    writeFileSync(join(gw, 'anthropic.yaml'), text.replace(`last_reviewed: "${reviewed}"`, 'last_reviewed: "2020-01-01"'));
    writeFileSync(join(gw, '.seeded.json'), JSON.stringify({ files: { 'anthropic.yaml': sha(join(gw, 'anthropic.yaml')) } }));
    const probe = await buildLlmGatewayProbe(ws);
    expect(probe.ok).not.toBe(false);
    expect(probe.message).toContain('connector file anthropic.yaml is older than the packaged one (reviewed 2020-01-01');
  });
});
