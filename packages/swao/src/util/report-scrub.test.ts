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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scrubRunDirectory } from './report-scrub.js';
import { beginRun, buildReport, _resetRedactionReportForTests as resetReport } from '@swao/core';
import { _resetForTests as resetRedactor } from './redact-pre-llm.js';

describe('scrubRunDirectory', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-scrub-'));
    resetRedactor();
    resetReport();
    beginRun();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('scrubs PII from JSON files in place', () => {
    const fp = join(tmp, 'pass-04.json');
    writeFileSync(fp, JSON.stringify({ owner_email: 'alice@client.example' }, null, 2), 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(1);
    const after = readFileSync(fp, 'utf-8');
    expect(after).toContain('[REDACTED-EMAIL]');
    expect(after).not.toContain('alice@client.example');
  });

  it('scrubs YAML + CSV + markdown extensions', () => {
    writeFileSync(join(tmp, 'plan.yaml'), 'owner: bob@client.example\n', 'utf-8');
    writeFileSync(join(tmp, 'export.csv'), 'name,email\nBob,bob@client.example\n', 'utf-8');
    writeFileSync(join(tmp, 'notes.md'), 'Contact: carol@client.example\n', 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(3);
    for (const f of ['plan.yaml', 'export.csv', 'notes.md']) {
      expect(readFileSync(join(tmp, f), 'utf-8')).toContain('[REDACTED-EMAIL]');
    }
  });

  it('recurses into subdirectories', () => {
    const sub = join(tmp, 'passes');
    mkdirSync(sub);
    writeFileSync(join(sub, 'p4.json'), '{"x":"alice@client.example"}', 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(1);
    expect(readFileSync(join(sub, 'p4.json'), 'utf-8')).toContain('[REDACTED-EMAIL]');
  });

  it('skips binary extensions', () => {
    const bin = join(tmp, 'snapshot.xlsx');
    writeFileSync(bin, 'fake-xlsx-bytes-with-email@example.com');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(0);
    expect(readFileSync(bin, 'utf-8')).toContain('email@example.com');
  });

  it('skips redaction-report.json (audit-trail protection)', () => {
    const fp = join(tmp, 'redaction-report.json');
    writeFileSync(fp, JSON.stringify({ note: 'alice@client.example' }), 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(0);
    expect(readFileSync(fp, 'utf-8')).toContain('alice@client.example');
  });

  it('skips latest.txt pointer', () => {
    const fp = join(tmp, 'latest.txt');
    writeFileSync(fp, 'runs/2026-05-23T14-00-00', 'utf-8');
    scrubRunDirectory(tmp);
    expect(readFileSync(fp, 'utf-8')).toBe('runs/2026-05-23T14-00-00');
  });

  it('skips signature files (.sig / .sha256 / .asc)', () => {
    writeFileSync(join(tmp, 'manifest.sig'), 'binary-sig-with-pseudo email@x.com', 'utf-8');
    writeFileSync(join(tmp, 'bundle.sha256'), '0123abcd  bundle.tar.gz', 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(0);
  });

  it('does not modify files that have no PII', () => {
    const fp = join(tmp, 'clean.json');
    const body = JSON.stringify({ passes: ['inv', 'state', 'comp'] }, null, 2);
    writeFileSync(fp, body, 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(0);
    expect(readFileSync(fp, 'utf-8')).toBe(body);
  });

  it('records report_write entries to the redaction sink', () => {
    writeFileSync(join(tmp, 'a.json'), '{"x":"alice@client.example"}', 'utf-8');
    writeFileSync(join(tmp, 'b.json'), '{"x":"bob@client.example"}', 'utf-8');
    scrubRunDirectory(tmp);
    const report = buildReport();
    expect(report.totals.calls).toBe(2);
    expect(report.calls.every((c) => c.surface === 'report_write')).toBe(true);
    expect(report.calls.every((c) => c.provider === 'report-scrub')).toBe(true);
    expect(report.totals.counts.email).toBe(2);
  });

  it('handles empty run directory without crash', () => {
    const r = scrubRunDirectory(tmp);
    expect(r.files_scanned).toBe(0);
    expect(r.files_scrubbed).toBe(0);
    expect(existsSync(tmp)).toBe(true);
  });
});
