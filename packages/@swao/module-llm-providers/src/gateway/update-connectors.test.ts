// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- swao llm-gateway update (#3388 step 4, D-2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateBundledConnectors, isPrivateSeedConnector, PRIVATE_SEED_MARKER } from './connector-loader.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function connectorYaml(id: string, model: string): string {
  return [
    'schema_version: "1.0"',
    'connector:',
    `  id: ${id}`,
    `  name: ${id}`,
    '  protocol: openai-chat',
    '  base_url: https://example.invalid',
    '  models:',
    `    default: ${model}`,
  ].join('\n') + '\n';
}

function setup(): { ws: string; src: string; gw: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-gw-update-ws-'));
  const src = mkdtempSync(join(tmpdir(), 'swao-gw-update-src-'));
  dirs.push(ws, src);
  const gw = join(ws, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(gw, { recursive: true });
  return { ws, src, gw };
}

describe('updateBundledConnectors (#3388 step 4, D-2)', () => {
  it('adds packaged connectors the workspace lacks', () => {
    const { ws, src } = setup();
    writeFileSync(join(src, 'alpha.yaml'), connectorYaml('alpha', 'm1'));
    const r = updateBundledConnectors(ws, { srcDir: src });
    expect(r.added).toEqual(['alpha.yaml']);
    expect(r.upToDate).toEqual([]);
    expect(readFileSync(join(ws, 'wsp', 'inputs', 'llm-gateway', 'alpha.yaml'), 'utf-8')).toContain('id: alpha');
  });

  it('reports up to date when the workspace copy is identical, no re-write', () => {
    const { ws, src } = setup();
    writeFileSync(join(src, 'alpha.yaml'), connectorYaml('alpha', 'm1'));
    updateBundledConnectors(ws, { srcDir: src }); // seeds alpha + manifest
    const r = updateBundledConnectors(ws, { srcDir: src });
    expect(r.upToDate).toEqual(['alpha.yaml']);
    expect(r.updated).toEqual([]);
  });

  it('refreshes an UNCHANGED seed when the packaged version changed', () => {
    const { ws, src } = setup();
    writeFileSync(join(src, 'alpha.yaml'), connectorYaml('alpha', 'm1'));
    updateBundledConnectors(ws, { srcDir: src }); // seed v1, manifest = hash(v1)
    // Packaged version changes; the workspace copy was NOT touched by the user.
    writeFileSync(join(src, 'alpha.yaml'), connectorYaml('alpha', 'm2'));
    const r = updateBundledConnectors(ws, { srcDir: src });
    expect(r.updated).toEqual(['alpha.yaml']);
    expect(readFileSync(join(ws, 'wsp', 'inputs', 'llm-gateway', 'alpha.yaml'), 'utf-8')).toContain('default: m2');
  });

  it('keeps a user-edited connector and never clobbers it', () => {
    const { ws, src, gw } = setup();
    writeFileSync(join(src, 'alpha.yaml'), connectorYaml('alpha', 'm1'));
    updateBundledConnectors(ws, { srcDir: src }); // seed v1
    writeFileSync(join(gw, 'alpha.yaml'), connectorYaml('alpha', 'user-edit')); // user edits
    writeFileSync(join(src, 'alpha.yaml'), connectorYaml('alpha', 'm2'));        // packaged changes
    const r = updateBundledConnectors(ws, { srcDir: src });
    expect(r.keptModified).toEqual(['alpha.yaml']);
    expect(readFileSync(join(gw, 'alpha.yaml'), 'utf-8')).toContain('default: user-edit');
  });

  it('never seeds client-private connectors, which carry the private-distribution marker (#3388, CLAUDE.md 5.7)', () => {
    const { ws, src, gw } = setup();
    writeFileSync(join(src, 'client-prod.yaml'), `${PRIVATE_SEED_MARKER}
${connectorYaml('client-prod', 'm1')}`);
    writeFileSync(join(src, 'client-preprod.yaml'), ['# header comment', PRIVATE_SEED_MARKER, connectorYaml('client-preprod', 'm1')].join(String.fromCharCode(13, 10)));
    writeFileSync(join(src, 'anthropic.yaml'), connectorYaml('anthropic', 'm1'));
    const r = updateBundledConnectors(ws, { srcDir: src });
    expect(r.added).toEqual(['anthropic.yaml']);
    expect(() => readFileSync(join(gw, 'client-prod.yaml'), 'utf-8')).toThrow();
    expect(() => readFileSync(join(gw, 'client-preprod.yaml'), 'utf-8')).toThrow();
  });

  it('isPrivateSeedConnector matches only a whole marker line', () => {
    const lf = (...l: string[]): string => l.join(String.fromCharCode(10));
    const crlf = (...l: string[]): string => l.join(String.fromCharCode(13, 10));
    expect(isPrivateSeedConnector(lf(PRIVATE_SEED_MARKER, 'id: x'))).toBe(true);
    expect(isPrivateSeedConnector(crlf('a: 1', `  ${PRIVATE_SEED_MARKER}  `, ''))).toBe(true);
    expect(isPrivateSeedConnector(lf('# swao-distribution: public', 'id: x'))).toBe(false);
    expect(isPrivateSeedConnector(`note: "${PRIVATE_SEED_MARKER}"`)).toBe(false);
  });

  it('dry-run reports the matrix without writing', () => {
    const { ws, src, gw } = setup();
    writeFileSync(join(src, 'beta.yaml'), connectorYaml('beta', 'm1'));
    const r = updateBundledConnectors(ws, { srcDir: src, dryRun: true });
    expect(r.added).toEqual(['beta.yaml']);
    expect(() => readFileSync(join(gw, 'beta.yaml'), 'utf-8')).toThrow();
  });
});
