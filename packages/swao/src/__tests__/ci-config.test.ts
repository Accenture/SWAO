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
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
// SWAO_ROOT = the swao/ subtree root.
const SWAO_ROOT = join(__dirname, '../../../../');
// OUTER_ROOT = the monorepo root; holds .github/workflows/, docs/tracker/, etc.
const OUTER_ROOT = join(SWAO_ROOT, '..');
const SWAO_PKG = join(SWAO_ROOT, 'packages/swao');
const CI_YML = join(OUTER_ROOT, '.github/workflows/ci.yml');
const TRACKER_OPEN = join(OUTER_ROOT, 'docs/tracker/issues/open');
const TRACKER_CLOSED = join(OUTER_ROOT, 'docs/tracker/issues/closed');
const SYNC_SH = join(OUTER_ROOT, 'docs/tracker/sync/sync.sh');

// The win32 `/c/...` translation below assumes Git Bash. A WSL bash on PATH
// uses `/mnt/c` and cannot resolve a `/c/...` path (it reports "No such file or
// directory", status 127); CI runs native Linux where the path is used as-is.
// Probe whether the bash that spawnSync resolves can actually read the script,
// so this gate RUNS in CI + Git Bash and SKIPS cleanly where the resolved bash
// can't reach it -- #0592 (skipIf-over-skip for precondition-blocked tests).
const SYNC_SH_BASH_PATH =
  process.platform === 'win32'
    ? SYNC_SH.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/')
    : SYNC_SH;

function bashCanReadSyncSh(): boolean {
  if (!existsSync(SYNC_SH)) return false;
  try {
    const probe = spawnSync('bash', ['-c', `test -r "${SYNC_SH_BASH_PATH}"`], { timeout: 15000 });
    return probe.status === 0;
  } catch {
    return false;
  }
}
const SYNC_SH_RUNNABLE = bashCanReadSyncSh();

// ---------------------------------------------------------------------------
// CI workflow YAML self-consistency
// ---------------------------------------------------------------------------

describe('CI configuration self-consistency (#0120)', () => {
  it('ci.yml exists in .github/workflows/', () => {
    expect(existsSync(CI_YML)).toBe(true);
  });

  it('package.json defines all scripts referenced by ci.yml', () => {
    const pkg = JSON.parse(readFileSync(join(SWAO_PKG, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    const ciYml = readFileSync(CI_YML, 'utf-8');

    const scriptRefs = [...ciYml.matchAll(/npm run (\S+)/g)].map((m) => m[1]);
    const nonCommented = scriptRefs.filter((s) => {
      const pattern = `npm run ${s}`;
      const idx = ciYml.indexOf(pattern);
      const lineStart = ciYml.lastIndexOf('\n', idx);
      const lineContent = ciYml.slice(lineStart + 1, idx + pattern.length);
      return !lineContent.trimStart().startsWith('#');
    });

    for (const script of nonCommented) {
      expect(pkg.scripts).toHaveProperty(script);
    }
  });

  it('Node version in .nvmrc satisfies engines.node in package.json', () => {
    const nvmrc = readFileSync(join(SWAO_PKG, '.nvmrc'), 'utf-8').trim();
    const nvmrcMajor = parseInt(nvmrc.replace(/^v/, ''), 10);
    const pkg = JSON.parse(readFileSync(join(SWAO_PKG, 'package.json'), 'utf-8')) as {
      engines?: { node?: string };
    };
    const enginesNode = pkg.engines?.node ?? '>=20.0.0';
    const minMatch = enginesNode.match(/>=?(\d+)/);
    const minMajor = minMatch ? parseInt(minMatch[1], 10) : 20;
    expect(nvmrcMajor).toBeGreaterThanOrEqual(minMajor);
  });

  it('ci.yml steps are in the required order: typecheck before test', () => {
    const ciYml = readFileSync(CI_YML, 'utf-8');
    const typecheckIdx = ciYml.indexOf('npm run typecheck');
    const testIdx = ciYml.indexOf('npm run test');
    expect(typecheckIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(-1);
    expect(typecheckIdx).toBeLessThan(testIdx);
  });

  it('ci.yml steps are in the required order: lint before test', () => {
    const ciYml = readFileSync(CI_YML, 'utf-8');
    const lintIdx = ciYml.indexOf('npm run lint');
    const testIdx = ciYml.indexOf('npm run test');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(testIdx);
  });

  it('scripts/ci-check.sh exists and is a valid shell script (starts with shebang)', () => {
    const ciScript = join(SWAO_ROOT, 'scripts/ci-check.sh');
    expect(existsSync(ciScript)).toBe(true);
    const content = readFileSync(ciScript, 'utf-8');
    expect(content.startsWith('#!/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tracker integrity
// ---------------------------------------------------------------------------

// Run sequentially -- sync.sh reads the filesystem tracker state and would be
// affected by concurrent tests that create/delete tracker files in temp dirs.
describe('Tracker integrity (#0120)', { sequential: true }, () => {
  function listIssueNumbers(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^\d{4}-/.test(f) && f.endsWith('.md'))
      .map((f) => f.slice(0, 4));
  }

  function parseFrontmatter(content: string): Record<string, unknown> {
    const normalised = content.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
    const match = normalised.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    return (load(match[1]) ?? {}) as Record<string, unknown>;
  }

  it('no open issue has a duplicate local number', () => {
    const openNums = listIssueNumbers(TRACKER_OPEN);
    const closedNums = listIssueNumbers(TRACKER_CLOSED);
    const allNums = [...openNums, ...closedNums];
    const unique = new Set(allNums);
    expect(unique.size).toBe(allNums.length);
  });

  // #1415/#1416 close finding: 179 files named 0001NNN-*.md accumulated over
  // 15 sprints because listIssueNumbers' ^\d{4}- filter silently EXCLUDED
  // them here while sync.sh validate truncated them all to "0001" and failed.
  // This guard makes the drift loud: every digit-prefixed issue file must
  // carry exactly a 4-digit number followed by a dash, so misnamed files
  // fail this suite instead of vanishing from the duplicate check.
  it('every issue file has exactly a 4-digit number prefix (no 0001NNN drift)', () => {
    for (const dir of [TRACKER_OPEN, TRACKER_CLOSED]) {
      if (!existsSync(dir)) continue;
      const offenders = readdirSync(dir).filter(
        (f) => /^\d/.test(f) && f.endsWith('.md') && !/^\d{4}-/.test(f),
      );
      expect(offenders, `misnamed issue files in ${dir}: ${offenders.join(', ')}`).toEqual([]);
    }
  });

  it('every open issue has state: open frontmatter field', () => {
    if (!existsSync(TRACKER_OPEN)) return;
    const files = readdirSync(TRACKER_OPEN).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(TRACKER_OPEN, file), 'utf-8');
      const fm = parseFrontmatter(content);
      expect(fm['state']).toBe('open');
    }
  });

  it('every closed issue has state: closed frontmatter field', () => {
    if (!existsSync(TRACKER_CLOSED)) return;
    const files = readdirSync(TRACKER_CLOSED).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(TRACKER_CLOSED, file), 'utf-8');
      const fm = parseFrontmatter(content);
      expect(fm['state']).toBe('closed');
    }
  }, 30_000); // 640+ files; Windows filesystem overhead per readFileSync exceeds 5s default

  // Skips when the resolved bash can't reach sync.sh (e.g. WSL bash in the
  // Windows dev sandbox); runs in CI (Linux) and under Git Bash. #0592.
  it.skipIf(!SYNC_SH_RUNNABLE)('sync.sh validate exits 0 against current tracker state', () => {
    // sync.sh shells out and may take 10-30s; raise vitest timeout above the default 5s.
    const result = spawnSync('bash', [SYNC_SH_BASH_PATH, 'validate'], { encoding: 'utf-8', timeout: 120000 });
    if (result.status !== 0) {
      console.error('[sync.sh validate stdout]', result.stdout);
      console.error('[sync.sh validate stderr]', result.stderr);
    }
    expect(result.status).toBe(0);
  }, 150000); // 150s -- sync.sh runs git + node scripts; larger tracker slows it on Windows
});
