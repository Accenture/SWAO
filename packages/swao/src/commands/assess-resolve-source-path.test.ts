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

// #3404 regression: source.vcs.subdir must scope the analysis root. The test
// goes through the same path as the assess action (YAML text -> js-yaml load
// -> SwaoYmlSchema.safeParse -> resolveSourcePath), because the bug was the
// schema stripping `subdir`, not the join inside resolveSourcePath.

import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { SwaoYmlSchema } from '../schema/index.js';
import { resolveSourcePath } from './assess.js';

const APP_DIR = join(tmpdir(), 'swao-3404-app');

function parseYml(text: string): Record<string, unknown> {
  const r = SwaoYmlSchema.safeParse(load(text) ?? {});
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'invalid .swao.yml');
  return r.data as Record<string, unknown>;
}

describe('resolveSourcePath with a schema-parsed .swao.yml (#3404)', () => {
  it('returns <source.path>/<subdir> when vcs.subdir is set', () => {
    const yml = parseYml(
      'source:\n  path: wsp/inputs/source/\n  vcs:\n    type: github\n    ref: main\n    subdir: src\n',
    );
    expect(resolveSourcePath(APP_DIR, yml, undefined)).toBe(join(resolve(APP_DIR, 'wsp/inputs/source/'), 'src'));
  });

  it('supports a nested subdir', () => {
    const yml = parseYml('source:\n  path: wsp/inputs/source\n  vcs:\n    subdir: services/api\n');
    expect(resolveSourcePath(APP_DIR, yml, undefined)).toBe(join(resolve(APP_DIR, 'wsp/inputs/source'), 'services/api'));
  });

  it('returns source.path unchanged when no subdir is set', () => {
    const yml = parseYml('source:\n  path: wsp/inputs/source/\n  vcs:\n    type: github\n');
    expect(resolveSourcePath(APP_DIR, yml, undefined)).toBe(resolve(APP_DIR, 'wsp/inputs/source/'));
  });

  it('falls back to <app>/source when source.path is absent', () => {
    expect(resolveSourcePath(APP_DIR, parseYml('source:\n  vcs:\n    subdir: src\n'), undefined)).toBe(
      join(resolve(APP_DIR, 'source'), 'src'),
    );
  });

  it('lets --source-path win over source.path and subdir', () => {
    const yml = parseYml('source:\n  path: wsp/inputs/source/\n  vcs:\n    subdir: src\n');
    const cli = resolve(tmpdir(), 'elsewhere');
    expect(resolveSourcePath(APP_DIR, yml, cli)).toBe(cli);
  });
});
