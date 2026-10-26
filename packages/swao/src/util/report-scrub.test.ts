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
import { scrubRunDirectory, quoteBareYamlPlaceholders } from './report-scrub.js';
import { load as yamlLoad } from 'js-yaml';
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

  // #3417: client-shaped wsp-evidence.yaml. Pre-fix the VAT class rewrote the
  // BESTELLSTATUS / FREIGABELISTE / SENDUNGSART parts of the uppercased EVD
  // keys to [REDACTED-VAT], which then surfaced as `redacted-vat` evidence IDs.
  it('leaves evidence IDs, catalogue keys and evidence_index unchanged (#3417)', () => {
    const body = [
      'evidence_catalogue:',
      '  EVD-SRC-TEST-JAVA-DE-EXAMPLE-ACME-ORDERS-BESTELLSTATUS-BDD-STEPS-JAVA:',
      '    type: file',
      '    source_path: wsp/inputs/source/src/test/java/de/example/acme/orders/bestellstatus/BddSteps.java',
      '    summary: bestellstatus/BddSteps.java',
      '    refs:',
      '      - src/test/java/de/example/acme/orders/bestellstatus/BddSteps.java',
      '  EVD-SRC-MAIN-JAVA-DE-EXAMPLE-ACME-ORDERS-FREIGABELISTE-SERVICE-JAVA:',
      '    type: file',
      '    summary: FREIGABELISTE service for SENDUNGSART accounts',
      '  EVD-K8S-SENDUNGSART-DEPLOYMENT-YAML:',
      '    type: file',
      'evidence_index:',
      '  src/test/java/de/example/acme/orders/bestellstatus/BddSteps.java: EVD-SRC-TEST-JAVA-DE-EXAMPLE-ACME-ORDERS-BESTELLSTATUS-BDD-STEPS-JAVA',
      '  k8s/sendungsart/deployment.yaml: EVD-K8S-SENDUNGSART-DEPLOYMENT-YAML',
      '',
    ].join('\n');
    const fp = join(tmp, 'wsp-evidence.yaml');
    writeFileSync(fp, body, 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(0);
    expect(readFileSync(fp, 'utf-8')).toBe(body);
    expect(buildReport().totals.counts.business_id).toBe(0);
  });

  it('scrubs an evidence_index key and the matching signal ref to the same string (#3417)', () => {
    const ref = 'docs/invoice-DE123456789.pdf';
    const evid = join(tmp, 'wsp-evidence.yaml');
    const pass = join(tmp, 'pass-03.json');
    writeFileSync(evid, `evidence_index:\n  ${ref}: EVD-DOCS-INVOICE-PDF\n`, 'utf-8');
    writeFileSync(pass, JSON.stringify({ signals: [{ id: 'DATA-01', evidence: [ref] }] }), 'utf-8');
    scrubRunDirectory(tmp);
    const yamlAfter = readFileSync(evid, 'utf-8');
    const keyAfter = /evidence_index:\n {2}(.+): EVD-DOCS-INVOICE-PDF/.exec(yamlAfter)?.[1];
    const refAfter = (JSON.parse(readFileSync(pass, 'utf-8')) as { signals: Array<{ evidence: string[] }> }).signals[0]?.evidence[0];
    expect(keyAfter).toBe('docs/invoice-[REDACTED-VAT].pdf');
    expect(refAfter).toBe(keyAfter);
  });

  it('exempts EVD- tokens that another class would match, but still scrubs the text around them (#3417)', () => {
    // AB1234567 is passport-shaped; inside an EVD slug it must survive.
    const fp = join(tmp, 'signals.json');
    writeFileSync(
      fp,
      JSON.stringify({ evidence: ['EVD-SRC-AB1234567-CONFIG-YAML'], owner: 'alice@client.example', doc: 'AB1234567' }),
      'utf-8',
    );
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(1);
    const after = readFileSync(fp, 'utf-8');
    expect(after).toContain('EVD-SRC-AB1234567-CONFIG-YAML');
    expect(after).toContain('[REDACTED-EMAIL]');
    expect(after).toContain('"doc":"[REDACTED-PASSPORT]"');
    const report = buildReport();
    expect(report.totals.counts.email).toBe(1);
    expect(report.totals.counts.business_id).toBe(1);
  });

  // #3415: a plain password (no vendor token shape) in the signals, the risk
  // register trigger and the plan is masked by the run-dir sweep.
  it('masks a planted credential value in signals, risk register and plan (#3415)', () => {
    const planted = 'Zx9-fake-Pw42'; // gitleaks:allow (synthetic #3415 fixture)
    mkdirSync(join(tmp, 'passes'), { recursive: true });
    writeFileSync(join(tmp, 'passes', '03-data.yaml'), `signals:\n  - id: DATA-02\n    derivation: "Hard-coded password '${planted}' in TestHelper.java"\n`, 'utf-8');
    writeFileSync(join(tmp, 'risk-register.yaml'), `risks:\n  - id: RR-001\n    trigger: "Signal DATA-02 -- password = '${planted}'"\n`, 'utf-8');
    writeFileSync(join(tmp, 'wsp-plan.json'), JSON.stringify({ note: `pwd: ${planted}` }), 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(3);
    for (const f of ['passes/03-data.yaml', 'risk-register.yaml', 'wsp-plan.json']) {
      const body = readFileSync(join(tmp, f), 'utf-8');
      expect(body).not.toContain(planted);
      expect(body).toContain('Zx***(13)');
    }
    // 48744075: credential values are counted under the credential class.
    expect(buildReport().totals.counts.credential).toBe(3);
  });

  // #3456: a .json file whose string values embed serialised JSON (a
  // kilo-context-style export) carries the credential with backslash-escaped
  // quotes; the sweep reads the file as text and must still mask it.
  it('masks a credential with JSON-escaped quotes in a .json file (#3456)', () => {
    const planted = 'Zx9-fake-Pw42'; // gitleaks:allow (synthetic #3456 fixture)
    const fp = join(tmp, 'kilo-context.json');
    const body = JSON.stringify(
      {
        evidence: 'EVD-SRC-APPLICATION-JSON',
        files: [{ path: 'config/application.json', content: JSON.stringify({ db: { password: planted } }) }],
        note: `Hard-coded password = "${planted}" in TestHelper.java`,
        legacy: `apiKey: \\'${planted}\\'`,
      },
      null,
      2,
    );
    writeFileSync(fp, body, 'utf-8');
    const r = scrubRunDirectory(tmp);
    expect(r.files_scrubbed).toBe(1);
    const after = readFileSync(fp, 'utf-8');
    expect(after).not.toContain(planted);
    expect(after).toContain('EVD-SRC-APPLICATION-JSON');
    const parsed = JSON.parse(after) as { files: Array<{ content: string }>; note: string; legacy: string };
    expect(JSON.parse(parsed.files[0]!.content)).toEqual({ db: { password: 'Zx***(13)' } });
    expect(parsed.note).toBe('Hard-coded password = "Zx***(13)" in TestHelper.java');
    expect(parsed.legacy).toBe("apiKey: \\'Zx***(13)\\'");
    expect(buildReport().totals.counts.credential).toBe(3);
  });

  it('handles empty run directory without crash', () => {
    const r = scrubRunDirectory(tmp);
    expect(r.files_scanned).toBe(0);
    expect(r.files_scrubbed).toBe(0);
    expect(existsSync(tmp)).toBe(true);
  });
});

// #3484: a scrubbed bare IP stays a YAML string, not a flow sequence.
describe('YAML placeholder quoting (#3484)', () => {
  it('quotes bare placeholders so the value parses as a string', () => {
    const out = quoteBareYamlPlaceholders('host: [REDACTED-IPV4]\nlist:\n  - [REDACTED-EMAIL]\nport: 8080\nurl: "[REDACTED-IPV4]"\nnote: [REDACTED-IPV4]:443 # db\n');
    const doc = yamlLoad(out) as Record<string, unknown>;
    expect(doc['host']).toBe('[REDACTED-IPV4]');
    expect(doc['list']).toEqual(['[REDACTED-EMAIL]']);
    expect(doc['port']).toBe(8080);
    expect(doc['url']).toBe('[REDACTED-IPV4]');
    expect(doc['note']).toBe('[REDACTED-IPV4]:443');
  });

  it('scrubRunDirectory keeps a YAML IP field a string', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-scrub-3484-'));
    try {
      writeFileSync(join(dir, 'hosts.yaml'), 'db_host: 10.1.2.3\n', 'utf-8');
      scrubRunDirectory(dir);
      const doc = yamlLoad(readFileSync(join(dir, 'hosts.yaml'), 'utf-8')) as Record<string, unknown>;
      expect(typeof doc['db_host']).toBe('string');
      expect(doc['db_host']).toContain('REDACTED-IPV4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves lines without a leading placeholder untouched', () => {
    const src = 'a: text [REDACTED-IPV4] inside\nb: plain\n';
    expect(quoteBareYamlPlaceholders(src)).toBe(src);
  });
});
