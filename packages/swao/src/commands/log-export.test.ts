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

// Integration test for `swao log export --for-feedback` (#0327 Part D).
//
// Synthesises a fixture workspace with NDJSON log files containing PII,
// runs cmdExport against it, and verifies the resulting .tar.gz contains
// (a) a redacted events.ndjson and (b) a redaction-report.json with non-zero
// counts. Uses the real tar.gz output (no mocking of the buildTar / gzip
// stack) so the binary's behaviour is what's verified.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setWorkspaceRoot } from '@swao/core';
import { cmdExport } from './log.js';

describe('cmdExport (#0327 Part D)', () => {
  let workspace: string;

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'swao-log-export-'));
    // Create wsp/logs/portfolio-events-<YYYY-MM>.ndjson with sample PII lines
    const portfolioLogsDir = join(workspace, 'wsp', 'logs');
    mkdirSync(portfolioLogsDir, { recursive: true });
    const ts = '2026-05-22';
    const portfolioEntries = [
      { ts: `${ts}T10:00:00Z`, level: 'warn', scope: 'portfolio', code: 'test.email', message: 'failed for user alice@example.com' },
      { ts: `${ts}T10:01:00Z`, level: 'error', scope: 'portfolio', code: 'test.ip', message: 'cannot reach 10.20.30.40 from runner' },
      { ts: `${ts}T10:02:00Z`, level: 'warn', scope: 'portfolio', code: 'test.token', message: 'clone with token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      { ts: `${ts}T10:03:00Z`, level: 'info', scope: 'portfolio', code: 'test.plain', message: 'no pii here' },
    ];
    const portfolioFile = join(portfolioLogsDir, 'portfolio-events-2026-05.ndjson');
    writeFileSync(portfolioFile, portfolioEntries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

    // Create an apps/<id>/wsp/logs/app-events-<YYYY-MM>.ndjson too
    const appLogsDir = join(workspace, 'apps', 'demo-app', 'wsp', 'logs');
    mkdirSync(appLogsDir, { recursive: true });
    const appEntries = [
      { ts: `${ts}T10:10:00Z`, level: 'warn', scope: 'app', app_id: 'demo-app', code: 'test.path', message: 'read C:\\Users\\helmut\\swao failed' },
    ];
    const appFile = join(appLogsDir, 'app-events-2026-05.ndjson');
    writeFileSync(appFile, appEntries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

    // Pin the workspace root so resolveWorkspaceRoot returns it without
    // walking up from cwd (which during vitest is the package dir).
    setWorkspaceRoot(workspace);
  });

  afterAll(() => {
    setWorkspaceRoot(null);
    if (workspace && existsSync(workspace)) rmSync(workspace, { recursive: true, force: true });
  });

  it('refuses to run without --for-feedback (currently the only mode)', () => {
    const outPath = join(workspace, 'output-noflag.tar.gz');
    cmdExport({ forFeedback: false, out: outPath });
    expect(process.exitCode).toBe(1);
    expect(existsSync(outPath)).toBe(false);
    process.exitCode = 0; // reset
  });

  it('writes a .tar.gz at the --out path', () => {
    const outPath = join(workspace, 'feedback-bundle.tar.gz');
    cmdExport({ forFeedback: true, out: outPath });
    expect(existsSync(outPath)).toBe(true);
    const stats = readFileSync(outPath);
    expect(stats.length).toBeGreaterThan(100);
  });

  it('gzipped tar contains events.ndjson and redaction-report.json', () => {
    const outPath = join(workspace, 'feedback-bundle-2.tar.gz');
    cmdExport({ forFeedback: true, out: outPath });
    const gzBuf = readFileSync(outPath);
    const tarBuf = gunzipSync(gzBuf);
    // Look for the two filenames in the tar headers (filename at offset 0
    // of each 512-byte header; entries are 512+ aligned).
    const tarText = tarBuf.toString('latin1');
    expect(tarText).toContain('events.ndjson');
    expect(tarText).toContain('redaction-report.json');
  });

  it('redacted events.ndjson contains [REDACTED-*] tokens instead of raw PII', () => {
    const outPath = join(workspace, 'feedback-bundle-3.tar.gz');
    cmdExport({ forFeedback: true, out: outPath });
    const gzBuf = readFileSync(outPath);
    const tarBuf = gunzipSync(gzBuf);
    const tarText = tarBuf.toString('latin1');
    // Original PII should be GONE
    expect(tarText).not.toContain('alice@example.com');
    expect(tarText).not.toContain('10.20.30.40');
    expect(tarText).not.toMatch(/ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/);
    expect(tarText).not.toContain('C:\\Users\\helmut\\');
    // Redaction markers should be PRESENT
    expect(tarText).toContain('[REDACTED-EMAIL]');
    expect(tarText).toContain('[REDACTED-IPV4]');
    expect(tarText).toContain('[REDACTED-SECRET]');
    expect(tarText).toContain('[REDACTED-USER]');
  });

  it('redaction-report.json has non-zero counts matching the inputs', () => {
    const outPath = join(workspace, 'feedback-bundle-4.tar.gz');
    cmdExport({ forFeedback: true, out: outPath });
    const gzBuf = readFileSync(outPath);
    const tarBuf = gunzipSync(gzBuf);
    // The report's content lives inside the tar; pull a wide window around
    // the redaction-report.json filename marker and search the JSON
    // fields. Larger window so workspace path strings don't push fields
    // out of frame.
    const tarText = tarBuf.toString('utf-8');
    const reportNameIdx = tarText.indexOf('redaction-report.json');
    expect(reportNameIdx).toBeGreaterThan(0);
    // The tar header is 512 bytes; content starts at the next 512-aligned
    // offset. Grabbing a 4KB window after the filename catches the whole
    // small JSON.
    const reportWindow = tarText.slice(reportNameIdx, reportNameIdx + 4096);
    expect(reportWindow).toMatch(/"email":\s*1/);
    expect(reportWindow).toMatch(/"ipv4":\s*1/);
    expect(reportWindow).toMatch(/"secret_shape":\s*1/);
    expect(reportWindow).toMatch(/"user_path":\s*1/);
    expect(reportWindow).toMatch(/"entry_count":\s*5/); // 4 portfolio + 1 app
  });

  // Note: the "default --out" code path (cmdExport with no --out, using
  // process.cwd()) is exercised in binary-e2e tests where vitest worker
  // process.chdir is not in play. Vitest's worker model disallows
  // process.chdir, so we explicitly pass --out in this integration test
  // and rely on the e2e suite for the default-path coverage.
});
