// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  assess: test-code setting wiring (#3403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3403: the setting is resolved app-first / workspace-second, handed to the
// source scope at the run boundary (every pass inherits it), put on the pass
// context, applied as the signal marker before the pass file is validated and
// written, and recorded in run-manifest files_assessed.source_scope.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManifestSchema } from '@swao/core';
import { readRunTestCodeSetting, testCodeFilesAssessed } from './assess-test-code.js';

const assessSrc = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function workspace(wsYml: string | null): { ws: string; appYml: string } {
  root = mkdtempSync(join(tmpdir(), 'swao-3403-assess-'));
  const app = join(root, 'apps', 'a1');
  mkdirSync(app, { recursive: true });
  if (wsYml !== null) writeFileSync(join(root, '.swao.yml'), wsYml, 'utf-8');
  return { ws: root, appYml: join(app, '.swao.yml') };
}

describe('readRunTestCodeSetting (#3403)', () => {
  it('falls back to the workspace .swao.yml the Setup Wizard writes', () => {
    const { ws, appYml } = workspace('assessment:\n  exclude_test_code: true\n');
    expect(readRunTestCodeSetting(undefined, ws, appYml)).toMatchObject({ mode: 'exclude', source: 'workspace' });
  });

  it('the app setting wins over the workspace setting', () => {
    const { ws, appYml } = workspace('assessment:\n  exclude_test_code: true\n');
    expect(readRunTestCodeSetting({ test_code: { mode: 'tag' } }, ws, appYml)).toMatchObject({ mode: 'tag', source: 'app' });
  });

  it('defaults to include; an invalid workspace file is ignored', () => {
    const { ws, appYml } = workspace('assessment:\n  test_code:\n    mode: nonsense\n');
    expect(readRunTestCodeSetting({}, ws, appYml)).toMatchObject({ mode: 'include', source: 'default' });
  });
});

describe('testCodeFilesAssessed (#3403)', () => {
  const scope = {
    files_scanned: 10, files_test: 4, files_generated: 0, files_hidden: 1, dirs_excluded: 2,
    excluded_dir_names: { node_modules: 1, '.git': 1 }, symlinks_skipped: 0, truncated: false,
  };

  it('records the mode always and the counts outside include; exclude lowers the in-scope total', () => {
    const inc = testCodeFilesAssessed(scope, { mode: 'include', extraPatterns: [], keepPatterns: [], source: 'default' }, { tagged: 0, lowered: 0 });
    expect(inc.source_files_total).toBe(10);
    expect(inc.source_scope).toMatchObject({ test_code_mode: 'include', test_code_source: 'default' });
    expect(inc.source_scope).not.toHaveProperty('signals_test_tagged');
    const exc = testCodeFilesAssessed(scope, { mode: 'exclude', extraPatterns: [], keepPatterns: [], source: 'app' }, { tagged: 1, lowered: 0 });
    expect(exc.source_files_total).toBe(6);
    expect(exc.source_scope).toMatchObject({ files_test_excluded: 4, signals_test_tagged: 1, signals_test_lowered: 0 });
  });

  it('passes the run-manifest schema (the publication reads it through the schema)', () => {
    const tag = testCodeFilesAssessed(scope, { mode: 'tag', extraPatterns: [], keepPatterns: [], source: 'workspace' }, { tagged: 3, lowered: 2 });
    const manifest = {
      schema_version: '1.5', run_id: 'r1', app: 'a1', iter: 1, assessed_at: '2026-10-24',
      started_at: '2026-10-24T10:00:00Z', finished_at: '2026-10-24T10:01:00Z', duration_ms: 60000,
      passes_executed: ['inventory'], total_signals_emitted: 1, pass_stats: [],
      files_assessed: { source_files_total: tag.source_files_total, source_scope: tag.source_scope },
    };
    const parsed = RunManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.files_assessed?.source_scope?.signals_test_lowered).toBe(2);
  });
});

describe('assess.ts wiring (#3403)', () => {
  it('resolves the setting and starts the source-scope run with it', () => {
    expect(assessSrc).toContain('const testCodeSetting = readRunTestCodeSetting(assessmentCfg, workspaceRoot, swaoYmlPath);');
    expect(assessSrc).toMatch(/beginSourceScopeRun\(\{\s*testCode: scopeTestCodeMode\(testCodeSetting\.mode\),\s*extraTestPatterns: testCodeSetting\.extraPatterns,\s*keepPatterns: testCodeSetting\.keepPatterns,\s*\}\);/);
    expect(assessSrc).not.toMatch(/beginSourceScopeRun\(\);/);
  });

  it('puts the mode on the main pass context', () => {
    const ctxBlock = /const ctx: PassContext = \{([\s\S]*?)\};/.exec(assessSrc)?.[1] ?? '';
    expect(ctxBlock).toContain('testCode: testCodeSetting.mode');
  });

  it('marks signals before the pass file is validated and written', () => {
    const mark = assessSrc.indexOf('applyTestCodeMarker(');
    const validate = assessSrc.indexOf('const validation = PassFileSchema.safeParse(result);');
    expect(mark).toBeGreaterThan(0);
    expect(mark).toBeLessThan(validate);
  });

  it('records the setting in run-manifest files_assessed', () => {
    expect(assessSrc).toContain('testCodeFilesAssessed(');
  });
});
