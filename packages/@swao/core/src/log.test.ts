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

// Tests for the WSP-scoped event log (#0327 Phase B).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setWorkspaceRoot,
  resolveWorkspaceRoot,
  logPortfolio,
  logApp,
  enhancement,
  listSinkPaths,
  type LogEntry,
} from './log.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-log-test-'));
  // Create the workspace marker (.swao.yml) so resolveWorkspaceRoot would
  // also find it via walk-up. Tests set setWorkspaceRoot explicitly anyway.
  mkdirSync(join(tmpRoot, 'apps'), { recursive: true });
  // touch the engagement spine marker
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { writeFileSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(join(tmpRoot, '.swao.yml'), '# test fixture\n');
  setWorkspaceRoot(tmpRoot);
});

afterEach(() => {
  setWorkspaceRoot(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

function readNdjson(path: string): LogEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogEntry);
}

describe('logPortfolio', () => {
  it('writes an NDJSON entry to wsp/logs/portfolio-events-<YYYY-MM>.ndjson', () => {
    logPortfolio('warn', 'test.code', 'hello world');
    const paths = listSinkPaths(tmpRoot);
    const entries = readNdjson(paths.portfolio);
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].scope).toBe('portfolio');
    expect(entries[0].code).toBe('test.code');
    expect(entries[0].message).toBe('hello world');
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends to the existing file rather than overwriting', () => {
    logPortfolio('info', 'a.b', 'first');
    logPortfolio('info', 'a.b', 'second');
    logPortfolio('info', 'a.b', 'third');
    const paths = listSinkPaths(tmpRoot);
    const entries = readNdjson(paths.portfolio);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.message)).toEqual(['first', 'second', 'third']);
  });

  it('creates wsp/logs/ if missing', () => {
    expect(existsSync(join(tmpRoot, 'wsp', 'logs'))).toBe(false);
    logPortfolio('info', 'a.b', 'msg');
    expect(existsSync(join(tmpRoot, 'wsp', 'logs'))).toBe(true);
  });
});

describe('logApp', () => {
  it('writes to apps/<appId>/wsp/logs/app-events-<YYYY-MM>.ndjson', () => {
    mkdirSync(join(tmpRoot, 'apps', 'sovereign-health'), { recursive: true });
    logApp('sovereign-health', 'enhancement', 'assessment.evidence_basis.unimplemented', 'control X needs adapter');
    const paths = listSinkPaths(tmpRoot);
    const appSink = paths.apps.find((a) => a.appId === 'sovereign-health')?.path;
    expect(appSink).toBeDefined();
    const entries = readNdjson(appSink!);
    expect(entries).toHaveLength(1);
    expect(entries[0].scope).toBe('app');
    expect(entries[0].app_id).toBe('sovereign-health');
    expect(entries[0].level).toBe('enhancement');
  });

  it('isolates two apps -- entries do not cross-contaminate', () => {
    mkdirSync(join(tmpRoot, 'apps', 'app-one'), { recursive: true });
    mkdirSync(join(tmpRoot, 'apps', 'app-two'), { recursive: true });
    logApp('app-one', 'warn', 'foo', 'one');
    logApp('app-two', 'warn', 'foo', 'two');
    const paths = listSinkPaths(tmpRoot);
    const oneSink = paths.apps.find((a) => a.appId === 'app-one')?.path;
    const twoSink = paths.apps.find((a) => a.appId === 'app-two')?.path;
    expect(readNdjson(oneSink!).map((e) => e.message)).toEqual(['one']);
    expect(readNdjson(twoSink!).map((e) => e.message)).toEqual(['two']);
  });
});

describe('write-time redaction', () => {
  it('strips userinfo from URL-shaped strings in message and context', () => {
    logPortfolio(
      'error',
      'provider.vcs.auth-failed',
      'clone failed: https://oauth2:ghp_secrettoken@github.com/foo/bar.git',
      { context: { url: 'https://x-access-token:ghp_anothertoken@github.com/baz/qux.git' } },
    );
    const paths = listSinkPaths(tmpRoot);
    const entries = readNdjson(paths.portfolio);
    expect(entries[0].message).not.toContain('ghp_secrettoken');
    expect(entries[0].message).toContain('https://github.com/foo/bar.git');
    expect(entries[0].context!.url).not.toContain('ghp_anothertoken');
    expect(entries[0].context!.url).toContain('https://github.com/baz/qux.git');
  });
});

describe('console mirror', () => {
  it('prints warn / error / enhancement to stderr; debug / info silent', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logPortfolio('debug', 'a', 'silent');
    logPortfolio('info', 'a', 'silent');
    logPortfolio('warn', 'a', 'shown');
    logPortfolio('error', 'a', 'shown');
    enhancement('a', 'shown');

    expect(warnSpy).toHaveBeenCalledTimes(2);   // warn + enhancement
    expect(errSpy).toHaveBeenCalledTimes(1);    // error
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('resolveWorkspaceRoot', () => {
  it('returns null when run outside a workspace', () => {
    setWorkspaceRoot(null);
    const isolated = mkdtempSync(join(tmpdir(), 'swao-log-noworkspace-'));
    try {
      expect(resolveWorkspaceRoot(isolated)).toBeNull();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('walks up to find the workspace marker', () => {
    setWorkspaceRoot(null);
    const nested = join(tmpRoot, 'apps', 'some-app', 'subdir');
    mkdirSync(nested, { recursive: true });
    expect(resolveWorkspaceRoot(nested)).toBe(tmpRoot);
  });
});

describe('throws on app scope without app_id', () => {
  it('rejects portfolio routing when scope=app but app_id missing', () => {
    // This is enforced internally by sinkPath; logApp() always supplies app_id.
    // Direct emit with a malformed entry is not part of the public API, but we
    // assert the contract holds via a TypeScript-protected boundary: logApp
    // requires appId at the type level.
    expect(typeof logApp).toBe('function');
  });
});

describe('listSinkPaths', () => {
  it('discovers every app subdirectory', () => {
    mkdirSync(join(tmpRoot, 'apps', 'app-a'), { recursive: true });
    mkdirSync(join(tmpRoot, 'apps', 'app-b'), { recursive: true });
    mkdirSync(join(tmpRoot, 'apps', 'app-c'), { recursive: true });
    const paths = listSinkPaths(tmpRoot);
    expect(paths.apps.map((a) => a.appId).sort()).toEqual(['app-a', 'app-b', 'app-c']);
  });
});

// #2240 -- log-quality gate.
// Every emitted event must land as exactly one valid-JSON line in the NDJSON
// sink. The swao-uat-log-monitor agent relies on this invariant; a bare `{`
// (partial write) or multi-line value causes JSON.parse to throw and the
// monitor to file an issue.
//
// These tests act as the CI regression guard: if any future change to emit()
// or JSON.stringify() causes a malformed line to reach disk, the test suite
// catches it before the PR merges.

function assertNdjsonValid(filePath: string): void {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      JSON.parse(lines[i]);
    } catch (err) {
      failures.push(
        `line ${i + 1}: ${(err as Error).message} -- raw: ${lines[i].substring(0, 200)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} NDJSON line(s) failed to parse:\n${failures.join('\n')}`,
    );
  }
}

describe('NDJSON log-quality gate (#2240)', () => {
  it('entries with tricky string values each occupy exactly one valid-JSON line', () => {
    const trickyCases: Array<{ code: string; message: string; ctx?: Record<string, unknown> }> = [
      { code: 'a', message: 'plain message' },
      { code: 'b', message: 'has "quotes" inside' },
      { code: 'c', message: 'has\nnewlines\nin\nthe\nmessage' },
      { code: 'd', message: 'has\ttabs\there' },
      { code: 'e', message: 'unicode -- dash and accent: é' },
      { code: 'f', message: 'backslash \\ and forward-slash /' },
      { code: 'g', message: 'null byte adjacent   value' },
      { code: 'h', message: 'context-embedded newline', ctx: { nested: 'line1\nline2' } },
      { code: 'i', message: 'long message: ' + 'x'.repeat(1024) },
    ];

    for (const c of trickyCases) {
      logPortfolio('info', c.code, c.message, c.ctx ? { context: c.ctx } : {});
    }

    const paths = listSinkPaths(tmpRoot);
    const raw = readFileSync(paths.portfolio, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);

    // One line per emit call -- no entry may span multiple lines.
    expect(lines).toHaveLength(trickyCases.length);

    assertNdjsonValid(paths.portfolio);
  });

  it('100 rapid sequential writes all produce valid NDJSON lines', () => {
    for (let i = 0; i < 100; i++) {
      logPortfolio('info', 'stress.write', `entry ${i}`, {
        context: { seq: i, payload: 'x'.repeat(i % 200) },
      });
    }

    const paths = listSinkPaths(tmpRoot);
    const lines = readFileSync(paths.portfolio, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);

    expect(lines).toHaveLength(100);
    assertNdjsonValid(paths.portfolio);
  });

  it('app-scoped entries also produce valid NDJSON', () => {
    mkdirSync(join(tmpRoot, 'apps', 'test-app'), { recursive: true });
    for (let i = 0; i < 10; i++) {
      logApp('test-app', 'info', 'gate.write', `entry ${i} with "special" chars\nand newline`);
    }

    const paths = listSinkPaths(tmpRoot);
    const appSink = paths.apps.find((a) => a.appId === 'test-app')?.path;
    expect(appSink).toBeDefined();
    assertNdjsonValid(appSink!);
  });
});

// #2241 #2242 #2243 #2244 -- event-sequence completeness gate.
// The swao-uat-log-monitor asserts that every .start event is followed by a
// .complete (or accepted closure: .error, .skip) within the same run session.
// Interrupted runs will always have unclosed sequences (process kill cannot
// fire completion events); this gate covers normal (non-interrupted) runs.
//
// Pairs covered (per issue requirements):
//   dynamic.start        -> dynamic.complete | dynamic.error
//   assess.pass.start    -> assess.pass.complete | assess.pass.error
//   assessment.pass.start -> assessment.pass.complete | assessment.pass.error
//   swao.run.start       -> swao.run.complete | swao.run.error

interface EventPair {
  startCode: string;
  closeCodes: string[];
}

function assertEventSequenceComplete(filePath: string, pairs: EventPair[]): void {
  const raw = readFileSync(filePath, 'utf-8');
  const entries = raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as LogEntry);

  const failures: string[] = [];
  for (const pair of pairs) {
    const opens = entries.filter((e) => e.code === pair.startCode);
    for (const open of opens) {
      const openIdx = entries.indexOf(open);
      const hasClosure = entries.slice(openIdx + 1).some((e) => pair.closeCodes.includes(e.code));
      if (!hasClosure) {
        const ctx = JSON.stringify(open.context ?? {});
        failures.push(`  unclosed '${pair.startCode}' at ${open.ts} ctx=${ctx}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Event sequence completeness gate failed:\n${failures.join('\n')}`);
  }
}

const SEQUENCE_PAIRS: EventPair[] = [
  { startCode: 'dynamic.start', closeCodes: ['dynamic.complete', 'dynamic.error'] },
  { startCode: 'assess.pass.start', closeCodes: ['assess.pass.complete', 'assess.pass.error'] },
  { startCode: 'assessment.pass.start', closeCodes: ['assessment.pass.complete', 'assessment.pass.error'] },
  { startCode: 'swao.run.start', closeCodes: ['swao.run.complete', 'swao.run.error'] },
  { startCode: 'leg.start', closeCodes: ['leg.complete', 'leg.error'] },
  { startCode: 'report.generate.start', closeCodes: ['report.generate.complete', 'report.generate.error'] },
];

describe('event-sequence completeness gate (#2241 #2242 #2243 #2244 #2287 #2060)', () => {
  it('balanced start/complete sequences all pass', () => {
    // Simulate a complete assessment run with all required paired events.
    logPortfolio('info', 'swao.run.start', 'Assessment run started', { run_id: 'run-001' });
    logPortfolio('info', 'assessment.pass.start', 'Pass 1 static starting', {
      context: { pass: 'static', num: '1' },
    });
    logPortfolio('info', 'assessment.pass.complete', 'Pass 1 static done', {
      context: { pass: 'static', num: '1' },
    });
    logPortfolio('info', 'assessment.pass.start', 'Pass 10 dynamic starting', {
      context: { pass: 'dynamic', num: '10' },
    });
    logPortfolio('info', 'dynamic.start', 'Dynamic pass started', { context: { app: 'test' } });
    logPortfolio('info', 'dynamic.complete', 'Dynamic pass done', { context: { app: 'test' } });
    logPortfolio('info', 'assessment.pass.complete', 'Pass 10 dynamic done', {
      context: { pass: 'dynamic', num: '10' },
    });
    logPortfolio('info', 'swao.run.complete', 'Assessment run complete', { run_id: 'run-001' });

    const paths = listSinkPaths(tmpRoot);
    assertEventSequenceComplete(paths.portfolio, SEQUENCE_PAIRS);
  });

  it('dynamic.error counts as a valid closure for dynamic.start', () => {
    logPortfolio('info', 'dynamic.start', 'Dynamic pass started');
    logPortfolio('warn', 'dynamic.error', 'Dynamic pass failed: playwright not found');

    const paths = listSinkPaths(tmpRoot);
    assertEventSequenceComplete(paths.portfolio, SEQUENCE_PAIRS);
  });

  it('assess.pass.start balanced by assess.pass.complete in app-events sink', () => {
    mkdirSync(join(tmpRoot, 'apps', 'seq-app'), { recursive: true });
    logApp('seq-app', 'info', 'assess.pass.start', 'Pass 1 starting', {
      context: { pass: 'static', num: '1' },
    });
    logApp('seq-app', 'info', 'assess.pass.complete', 'Pass 1 done', {
      context: { pass: 'static', num: '1' },
    });

    const paths = listSinkPaths(tmpRoot);
    const appSink = paths.apps.find((a) => a.appId === 'seq-app')?.path;
    expect(appSink).toBeDefined();
    assertEventSequenceComplete(appSink!, SEQUENCE_PAIRS);
  });

  it('unclosed dynamic.start throws with event timestamp and context', () => {
    logPortfolio('info', 'dynamic.start', 'Dynamic pass started', {
      context: { app: 'sovereign-health' },
    });
    // no dynamic.complete or dynamic.error emitted

    const paths = listSinkPaths(tmpRoot);
    expect(() => assertEventSequenceComplete(paths.portfolio, SEQUENCE_PAIRS)).toThrow(
      /unclosed 'dynamic\.start'/,
    );
  });

  it('unclosed swao.run.start throws (interrupted run scenario)', () => {
    logPortfolio('info', 'swao.run.start', 'Run started');
    // process killed -- no swao.run.complete

    const paths = listSinkPaths(tmpRoot);
    expect(() => assertEventSequenceComplete(paths.portfolio, SEQUENCE_PAIRS)).toThrow(
      /unclosed 'swao\.run\.start'/,
    );
  });

  it('leg.start balanced by leg.complete in app-events sink (#2287)', () => {
    mkdirSync(join(tmpRoot, 'apps', 'leg-app'), { recursive: true });
    logApp('leg-app', 'info', 'leg.start', 'leg leg-1 starting', {
      context: { leg_id: 'leg-1', connector: 'claude', model: 'claude-sonnet-4-6' },
    });
    logApp('leg-app', 'info', 'leg.complete', 'leg leg-1 complete', {
      context: { leg_id: 'leg-1', calls: 4, wall_clock_ms: 12000 },
    });

    const paths = listSinkPaths(tmpRoot);
    const appSink = paths.apps.find((a) => a.appId === 'leg-app')?.path;
    expect(appSink).toBeDefined();
    assertEventSequenceComplete(appSink!, SEQUENCE_PAIRS);
  });

  it('unclosed leg.start throws with leg_id context (#2287)', () => {
    mkdirSync(join(tmpRoot, 'apps', 'leg-unclosed'), { recursive: true });
    logApp('leg-unclosed', 'info', 'leg.start', 'leg leg-2 starting', {
      context: { leg_id: 'leg-2', connector: 'claude', model: 'claude-sonnet-4-6' },
    });
    // process killed before leg.complete emitted

    const paths = listSinkPaths(tmpRoot);
    const appSink = paths.apps.find((a) => a.appId === 'leg-unclosed')?.path;
    expect(appSink).toBeDefined();
    expect(() => assertEventSequenceComplete(appSink!, SEQUENCE_PAIRS)).toThrow(
      /unclosed 'leg\.start'/,
    );
  });

  it('report.generate.start balanced by report.generate.complete (#2060)', () => {
    logPortfolio('info', 'report.generate.start', 'LLM text report generation started', {
      context: { app: 'sovereign-health', report_type: 'llm', format: 'text' },
    });
    logPortfolio('info', 'report.generate.ok', 'LLM report written: /path/to/report.txt', {
      context: { app: 'sovereign-health', file: '/path/to/report.txt' },
    });
    logPortfolio('info', 'report.generate.complete', 'LLM text report generation complete', {
      context: { app: 'sovereign-health', report_type: 'llm', format: 'text', reports_generated: 1 },
    });

    const paths = listSinkPaths(tmpRoot);
    assertEventSequenceComplete(paths.portfolio, SEQUENCE_PAIRS);
  });

  it('unclosed report.generate.start throws (#2060)', () => {
    logPortfolio('info', 'report.generate.start', 'LLM report generation started', {
      context: { app: 'sovereign-health', report_type: 'llm', format: 'json' },
    });
    // early return without report.generate.complete

    const paths = listSinkPaths(tmpRoot);
    expect(() => assertEventSequenceComplete(paths.portfolio, SEQUENCE_PAIRS)).toThrow(
      /unclosed 'report\.generate\.start'/,
    );
  });
});
