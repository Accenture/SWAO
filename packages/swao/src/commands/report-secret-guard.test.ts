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


// #4352: the text, YAML and PDF report inputs pass the secret output guard
// (Design 032 section 11.6). Values are built at run time.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateLzReport, formatLzText, formatLzYaml } from './report-lz.js';
import { finaliseReportText, formatViewAuditor } from './report.js';
import { buildAuditorReport } from './auditor-report-schema.js';
import { dump } from 'js-yaml';
import type { ReportData } from '@swao/core';

const pw = 'Qx' + 'z'.repeat(8) + '7k';
const RUN = '2026-11-10T08-53-21';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function lzRunWithChallenge(): string {
  const appDir = mkdtempSync(join(tmpdir(), 'swao-report-secret-'));
  dirs.push(appDir);
  const run = join(appDir, 'wsp', 'runs', RUN);
  mkdirSync(join(run, 'passes'), { recursive: true });
  writeFileSync(join(run, 'passes', 'lz-fit.yaml'), [
    `pass: { assessed_at: "${RUN.slice(0, 10)}" }`,
    'assessment:',
    '  provider: otc',
    '  region: eu-de',
    '  overall: NEEDS_VERIFICATION',
    `  sovereignty_statement: "The fallback password '${pw}' is set in the E2E setup."`,
    '  items: []',
    '',
  ].join('\n'));
  writeFileSync(join(run, 'run-status.json'), JSON.stringify({
    schema_version: '1.0', assessment_type: 'landing-zone-catalog', app: 'demo', run_id: RUN,
    status: 'complete', started_at: '2026-11-10T00:00:00Z', swao_version: 'test',
  }));
  writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), `runs/${RUN}`);
  const ch = join(appDir, 'wsp', 'challenge-lz', '2026-11-10T09-00-00');
  mkdirSync(ch, { recursive: true });
  writeFileSync(join(ch, 'LZCA_lzca-ciso-security.yaml'), [
    'agent_id: lzca-ciso-security',
    'agent_role: CISO / Security',
    'challenged_run:',
    `  run_id: ${RUN}`,
    '  assessment_type: landing-zone-catalog',
    'findings:',
    '  - id: LZCA-CISO-01',
    '    severity: HIGH',
    `    concern: "A hard-coded fallback password '${pw}' is used when the variable is unset."`,
    '',
  ].join('\n'));
  return appDir;
}

describe('report output guard (#4352)', () => {
  it('generateLzReport masks a quoted credential in the data that feeds text, YAML, JSON and PDF', () => {
    const data = generateLzReport(lzRunWithChallenge(), 'demo');
    expect(JSON.stringify(data)).not.toContain(pw);
    const text = formatLzText(data);
    expect(text).not.toContain(pw);
    expect(text).toContain('Qx***(12)');
    expect(formatLzYaml(data)).not.toContain(pw);
  });

  it('finaliseReportText masks credentials and normalises dashes in one pass', () => {
    const out = finaliseReportText(`DATA-10 — fallback password '${pw}'; Server=db;Pwd=${'Ab' + 'c'.repeat(8)};`);
    expect(out).not.toContain(pw);
    expect(out).not.toContain('Ab' + 'c'.repeat(8));
    expect(out).not.toContain('—');
  });
});

describe('report view loaders pass the output guard (#4352)', () => {
  it('the auditor drill-down (wrapped derivation and ruled-out text) and the auditor report never carry a credential from a pass file', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'swao-report-secret-aud-'));
    dirs.push(appDir);
    const wspDir = join(appDir, 'wsp');
    const runDir = join(wspDir, 'runs', RUN);
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    const long = 'The global setup uses a hard-coded fallback password ' + "'" + pw + "'" + ' when the variable is unset, which is far longer than the column width so the formatter truncates it.';
    writeFileSync(join(runDir, 'passes', '03-data.yaml'), dump({
      pass: { id: 3, name: 'data', status: 'complete' },
      signals: [{ id: 'DATA-10', severity: 'high', outcome: 'negative', derivation: long, evidence: [], false_positive_considered: true, false_positive_ruled_out: 'The connection string Server=db;Password=' + pw + ' is the test default.' }],
    }));
    writeFileSync(join(wspDir, 'latest.txt'), `runs/${RUN}`);
    const data = { appId: 'demo', assessedAt: '2026-11-10', iter: 1, sevenRLabel: 'Refactor', coverageScore: '0.90' } as unknown as ReportData;
    const text = formatViewAuditor(data, wspDir, runDir);
    expect(text).not.toContain(pw);
    expect(text).not.toContain(pw.slice(0, 6) + 'z');
    expect(text).toContain('DATA-10');
    expect(text).toContain('Qx***(12)');
    const aud = JSON.stringify(buildAuditorReport(data, wspDir, runDir));
    expect(aud).not.toContain(pw);
  });
});
