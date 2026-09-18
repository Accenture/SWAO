// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * ci-tokens.ts unit tests (D1 -- #0930).
 *
 * Covers: readCiTokens (read + validate), buildCiTokenStyleBlock (HTML builder),
 * and the unknown-token-name error path.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readCiTokens, buildCiTokenStyleBlock, TIER1_TOKENS } from './ci-tokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, 'fixtures', 'ci-accent-red.yaml');

function writeTmpYaml(content: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'swao-ci-test-'));
  const path = join(dir, 'ci.yaml');
  writeFileSync(path, content, 'utf-8');
  return { dir, path };
}

describe('readCiTokens', () => {
  it('reads the ci-accent-red fixture correctly', () => {
    const tokens = readCiTokens(FIXTURE_PATH);
    expect(tokens.light['--brand-accent']).toBe('#ff0000');
    expect(tokens.dark['--bg-primary']).toBe('#1e293b');
  });

  it('accepts all declared Tier 1 token names', () => {
    const yaml = TIER1_TOKENS.map(t => `"${t}": "value"`).join('\n');
    const { dir, path } = writeTmpYaml(yaml);
    try {
      const tokens = readCiTokens(path);
      expect(Object.keys(tokens.light).length).toBe(TIER1_TOKENS.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws with the unknown key name when an invalid token is used', () => {
    const { dir, path } = writeTmpYaml('"--foo-bar": "#abc"');
    try {
      expect(() => readCiTokens(path)).toThrow('unknown token "--foo-bar"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws for an unknown token in the dark: block', () => {
    const { dir, path } = writeTmpYaml('dark:\n  "--evil-token": "#abc"');
    try {
      expect(() => readCiTokens(path)).toThrow('unknown token "--evil-token"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty maps for an empty YAML file', () => {
    const { dir, path } = writeTmpYaml('# empty');
    try {
      const tokens = readCiTokens(path);
      expect(tokens.light).toEqual({});
      expect(tokens.dark).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildCiTokenStyleBlock', () => {
  it('returns an empty string when both maps are empty', () => {
    const block = buildCiTokenStyleBlock({ light: {}, dark: {} });
    expect(block).toBe('');
  });

  it('wraps light tokens in :root { ... }', () => {
    const block = buildCiTokenStyleBlock({ light: { '--brand-accent': '#ff0000' }, dark: {} });
    expect(block).toContain('<style id="swao-ci-tokens">');
    expect(block).toContain(':root {');
    expect(block).toContain('--brand-accent: #ff0000;');
    expect(block).not.toContain('.dark :root');
  });

  it('wraps dark tokens in .dark :root { ... }', () => {
    const block = buildCiTokenStyleBlock({ light: {}, dark: { '--bg-primary': '#1e293b' } });
    expect(block).toContain('.dark :root {');
    expect(block).toContain('--bg-primary: #1e293b;');
    // No standalone :root block (only the dark-prefixed one)
    expect(block).not.toMatch(/^:root \{/m);
  });

  it('includes both :root and .dark :root when both are present', () => {
    const block = buildCiTokenStyleBlock({
      light: { '--brand-accent': '#ff0000' },
      dark:  { '--bg-primary': '#1e293b' },
    });
    expect(block).toContain(':root {');
    expect(block).toContain('.dark :root {');
  });
});
