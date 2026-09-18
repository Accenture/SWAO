// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- connector loader tests (#1395)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listConnectors, getConnector } from './connector-loader.js';

function connectorYaml(id: string, name = id): string {
  return [
    'schema_version: "1.0"',
    'connector:',
    `  id: ${id}`,
    `  name: ${name}`,
    '  protocol: openai-chat',
    '  base_url: https://llm.example.internal',
    '  models:',
    '    default: some-model',
    '',
  ].join('\n');
}

let bundledDir: string;
let workspaceRoot: string;
let workspaceGw: string;

beforeEach(() => {
  bundledDir = mkdtempSync(join(tmpdir(), 'swao-gw-bundled-'));
  workspaceRoot = mkdtempSync(join(tmpdir(), 'swao-gw-ws-'));
  workspaceGw = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(workspaceGw, { recursive: true });
});

afterEach(() => {
  rmSync(bundledDir, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('listConnectors (#1395)', () => {
  it('discovers connectors from a directory and returns a sorted list', () => {
    writeFileSync(join(bundledDir, 'zeta.yaml'), connectorYaml('zeta'));
    writeFileSync(join(bundledDir, 'alpha.yaml'), connectorYaml('alpha'));
    const r = listConnectors({ overrideDir: bundledDir });
    const ids = r.connectors.map(c => c.file.connector.id);
    // Real bundled seeds may also be discovered via the dev path; assert the
    // override-dir connectors are present and the whole list is sorted.
    expect(ids).toContain('alpha');
    expect(ids).toContain('zeta');
    expect(ids).toEqual([...ids].sort());
    expect(r.warnings).toEqual([]);
  });

  it('workspace connector with the same id overrides a later candidate', () => {
    // workspace dir has higher precedence than overrideDir? No: override is
    // first. Simulate bundled via the DEV path being absent and use
    // workspaceRoot (precedence 2) vs overrideDir (precedence 1).
    writeFileSync(join(workspaceGw, 'hub.yaml'), connectorYaml('hub', 'Workspace Hub'));
    const r = listConnectors({ workspaceRoot });
    const hub = r.connectors.find(c => c.file.connector.id === 'hub');
    expect(hub).toBeDefined();
    expect(hub!.origin).toBe('workspace');
    expect(hub!.file.connector.name).toBe('Workspace Hub');
  });

  it('first candidate wins per id (override beats workspace)', () => {
    writeFileSync(join(bundledDir, 'hub.yaml'), connectorYaml('hub', 'Override Hub'));
    writeFileSync(join(workspaceGw, 'hub.yaml'), connectorYaml('hub', 'Workspace Hub'));
    const r = listConnectors({ workspaceRoot, overrideDir: bundledDir });
    const hub = r.connectors.find(c => c.file.connector.id === 'hub');
    expect(hub!.file.connector.name).toBe('Override Hub');
  });

  it('skips broken YAML and schema-invalid files with warnings, never fatal', () => {
    writeFileSync(join(workspaceGw, 'good.yaml'), connectorYaml('good'));
    writeFileSync(join(workspaceGw, 'broken.yaml'), '{{{{not yaml');
    writeFileSync(join(workspaceGw, 'invalid.yaml'), 'schema_version: "1.0"\nconnector:\n  id: bad id\n');
    const r = listConnectors({ workspaceRoot });
    expect(r.connectors.some(c => c.file.connector.id === 'good')).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.join(' ')).toContain('broken.yaml');
  });

  it('ignores files starting with underscore (templates)', () => {
    writeFileSync(join(workspaceGw, '_template.yaml'), connectorYaml('template-should-not-load'));
    writeFileSync(join(workspaceGw, 'real.yaml'), connectorYaml('real'));
    const r = listConnectors({ workspaceRoot });
    expect(r.connectors.some(c => c.file.connector.id === 'template-should-not-load')).toBe(false);
    expect(r.connectors.some(c => c.file.connector.id === 'real')).toBe(true);
  });

  it('getConnector resolves by id and returns undefined for unknown ids', () => {
    writeFileSync(join(workspaceGw, 'hub.yaml'), connectorYaml('hub'));
    expect(getConnector('hub', { workspaceRoot })?.file.connector.id).toBe('hub');
    expect(getConnector('nope-nope', { workspaceRoot })).toBeUndefined();
  });
});
