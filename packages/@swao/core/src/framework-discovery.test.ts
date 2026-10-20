// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3297: framework discovery from framework-meta.yaml (no _registry.yaml).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverFrameworks, findFramework, frameworkContributorName } from './framework-discovery.js';

function meta(id: string, extra = ''): string {
  return `framework:\n  id: ${id}\n  name: "${id} framework"\n  version: "1.0"\n  contributor:\n    name: "SWAO Development Team"\n${extra}`;
}

describe('discoverFrameworks (#3297)', () => {
  let root: string;
  let warnings: string[];
  const warn = (m: string): void => { warnings.push(m); };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-fw-discovery-'));
    warnings = [];
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function folder(name: string, metaYaml?: string): void {
    mkdirSync(join(root, name), { recursive: true });
    if (metaYaml !== undefined) writeFileSync(join(root, name, 'framework-meta.yaml'), metaYaml, 'utf-8');
  }

  it('returns every folder with a valid meta, sorted by id, id from the meta', () => {
    folder('zeta-folder', meta('ALPHA'));
    folder('alpha-folder', meta('ZETA'));
    const found = discoverFrameworks(root, { warn });
    expect(found.map((f) => [f.id, f.folder])).toEqual([['ALPHA', 'zeta-folder'], ['ZETA', 'alpha-folder']]);
    expect(found[0]!.meta.name).toBe('ALPHA framework');
    expect(frameworkContributorName(found[0]!.meta)).toBe('SWAO Development Team');
    expect(warnings).toEqual([]);
  });

  it('ignores folders without a meta and _/. entries, silently', () => {
    folder('no-meta');
    folder('_private', meta('PRIV'));
    folder('.hidden', meta('HID'));
    folder('ok', meta('OK'));
    writeFileSync(join(root, '_registry.yaml'), 'frameworks: []\n', 'utf-8');
    expect(discoverFrameworks(root, { warn }).map((f) => f.id)).toEqual(['OK']);
    expect(warnings).toEqual([]);
  });

  it('skips an invalid meta with a warning and never throws', () => {
    folder('bad-schema', meta('BAD', '  scoring_mode: weighted\n'));
    folder('bad-id', 'framework:\n  name: "no id here"\n');
    folder('bad-yaml', 'framework: [unclosed\n');
    folder('good', meta('GOOD'));
    const found = discoverFrameworks(root, { warn });
    expect(found.map((f) => f.id)).toEqual(['GOOD']);
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toMatch(/skipped bad-schema: .*scoring_mode/);
    expect(warnings.join('\n')).toMatch(/skipped bad-id/);
    expect(warnings.join('\n')).toMatch(/skipped bad-yaml: .*not valid YAML/);
  });

  it('defaults the warning sink to console.warn', () => {
    folder('bad', 'framework: {}\n');
    const orig = console.warn;
    const seen: string[] = [];
    console.warn = (m: string) => { seen.push(m); };
    try { expect(discoverFrameworks(root)).toEqual([]); } finally { console.warn = orig; }
    expect(seen).toHaveLength(1);
  });

  it('keeps the first folder on a duplicate id and warns', () => {
    folder('a-first', meta('DUP'));
    folder('b-second', meta('DUP'));
    const found = discoverFrameworks(root, { warn });
    expect(found.map((f) => f.folder)).toEqual(['a-first']);
    expect(warnings[0]).toMatch(/skipped b-second: id DUP is already declared by a-first/);
  });

  it('hides listed: false unless includeUnlisted is set', () => {
    folder('shown', meta('SHOWN'));
    folder('hidden', meta('HIDDEN', '  listed: false\n'));
    expect(discoverFrameworks(root, { warn }).map((f) => f.id)).toEqual(['SHOWN']);
    expect(discoverFrameworks(root, { warn, includeUnlisted: true }).map((f) => f.id)).toEqual(['HIDDEN', 'SHOWN']);
  });

  it('returns [] for a missing root', () => {
    expect(discoverFrameworks(join(root, 'nope'), { warn })).toEqual([]);
  });

  it('findFramework matches id case-insensitively or the folder name', () => {
    folder('gdpr', meta('GDPR'));
    const found = discoverFrameworks(root, { warn });
    expect(findFramework(found, 'GDPR')?.folder).toBe('gdpr');
    expect(findFramework(found, 'gdpr')?.id).toBe('GDPR');
    expect(findFramework(found, 'NOPE')).toBeUndefined();
  });
});
