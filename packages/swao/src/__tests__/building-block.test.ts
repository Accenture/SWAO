// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../../');
const MANIFEST_PATH = join(REPO_ROOT, 'ops', 'building-block', 'manifest.yaml');
const PKG_PATH      = join(REPO_ROOT, 'packages', 'swao', 'package.json');

function manifest() {
  return loadYaml(readFileSync(MANIFEST_PATH, 'utf-8')) as Record<string, unknown>;
}

function spec(doc: Record<string, unknown>) {
  return doc['spec'] as Record<string, unknown>;
}

function inputs(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return spec(doc)['inputs'] as Array<Record<string, unknown>>;
}

function outputs(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return spec(doc)['outputs'] as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// manifest.yaml -- structure
// ---------------------------------------------------------------------------

describe('Building Block manifest (#0124)', () => {
  it('manifest.yaml exists at ops/building-block/manifest.yaml', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it('is valid YAML (parses without error)', () => {
    expect(() => manifest()).not.toThrow();
  });

  it('kind is BuildingBlockDefinition', () => {
    expect(manifest()['kind']).toBe('BuildingBlockDefinition');
  });

  it('apiVersion is present', () => {
    const doc = manifest();
    expect(typeof doc['apiVersion']).toBe('string');
    expect(doc['apiVersion']).toMatch(/meshstack/);
  });

  it('spec.version matches packages/swao/package.json version', () => {
    const pkgVersion = JSON.parse(readFileSync(PKG_PATH, 'utf-8')).version as string;
    const manifestVersion = (spec(manifest())['version'] as string).replace(/^"(.*)"$/, '$1');
    expect(manifestVersion).toBe(pkgVersion);
  });

  // --- inputs ---------------------------------------------------------------

  it('has input: app_id (string, required)', () => {
    const inp = inputs(manifest()).find(i => i['name'] === 'app_id');
    expect(inp).toBeDefined();
    expect(inp!['type']).toBe('string');
    expect(inp!['required']).toBe(true);
  });

  it('has input: workspace_path (string, required)', () => {
    const inp = inputs(manifest()).find(i => i['name'] === 'workspace_path');
    expect(inp).toBeDefined();
    expect(inp!['type']).toBe('string');
    expect(inp!['required']).toBe(true);
  });

  it('has input: llm_provider with enum values', () => {
    const inp = inputs(manifest()).find(i => i['name'] === 'llm_provider');
    expect(inp).toBeDefined();
    expect(inp!['type']).toBe('string');
    const vals = inp!['enum'] as string[];
    expect(vals).toContain('anthropic');
    expect(vals).toContain('ollama');
    expect(vals).toContain('stub');
  });

  it('has input: anthropic_api_key with type secret', () => {
    const inp = inputs(manifest()).find(i => i['name'] === 'anthropic_api_key');
    expect(inp).toBeDefined();
    expect(inp!['type']).toBe('secret');
  });

  // --- outputs --------------------------------------------------------------

  it('has output: wsp_url', () => {
    const out = outputs(manifest()).find(o => o['name'] === 'wsp_url');
    expect(out).toBeDefined();
    expect(out!['type']).toBe('string');
  });

  it('has output: seven_r_label', () => {
    const out = outputs(manifest()).find(o => o['name'] === 'seven_r_label');
    expect(out).toBeDefined();
    expect(out!['type']).toBe('string');
  });

  it('has output: coverage_score (number)', () => {
    const out = outputs(manifest()).find(o => o['name'] === 'coverage_score');
    expect(out).toBeDefined();
    expect(out!['type']).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// scripts/package-bb.sh
// ---------------------------------------------------------------------------

describe('scripts/package-bb.sh (#0124)', () => {
  const scriptPath = join(REPO_ROOT, 'scripts', 'package-bb.sh');

  it('package-bb.sh exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('is a bash script', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toMatch(/^#!.*bash/);
  });

  it('references manifest.yaml', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('manifest.yaml');
  });

  it('reads version from package.json', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('package.json');
  });

  it('produces a swao-bb-<version>.tar.gz tarball', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('swao-bb-');
    expect(content).toContain('.tar.gz');
  });
});

// ---------------------------------------------------------------------------
// ops/building-block/README.md
// ---------------------------------------------------------------------------

describe('ops/building-block/README.md (#0124)', () => {
  it('README.md exists', () => {
    expect(existsSync(join(REPO_ROOT, 'ops', 'building-block', 'README.md'))).toBe(true);
  });

  it('documents how to upload the tarball to meshStack', () => {
    const content = readFileSync(join(REPO_ROOT, 'ops', 'building-block', 'README.md'), 'utf-8');
    expect(content).toMatch(/upload/i);
    expect(content).toMatch(/meshStack/i);
  });
});
