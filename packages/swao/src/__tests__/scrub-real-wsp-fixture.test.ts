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

// #0362 (sprint-039) -- integration test that scrubs a real-shaped WSP
// run-directory and asserts the post-scrub content meets the invariants
// the sprint-038 #0354 bugs would have violated:
//
//   1. IPv6 timestamp exemption -- `assessed_at: "2026-05-09T13:00:00Z"`
//      shapes (and similar ISO 8601 datetimes) MUST survive the scrub.
//      The all-numeric <=7-group exemption added in sprint-038 should
//      prevent the IPv6 regex from matching ISO timestamps.
//
//   2. Allowlist propagation -- a value present in the allowlist
//      (operator's own email, named consultants) MUST pass through every
//      redactor class unmodified. Sprint-038 originally had the
//      allowlist only on the top-level redactor; inherited classes
//      stripped it. Both paths (top-level + threaded-through) are now
//      under the allowlist; this test catches a regression in either.
//
// Pattern: build a fixture in a tmpdir matching the on-disk shape
// `scrubRunDirectory()` walks, then run the scrub and read the files
// back. Explicit invariant assertions are tighter than snapshot diffing
// for whitespace-sensitive YAML.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { scrubRunDirectory } from '../util/report-scrub.js';
import { setAllowlist, _resetForTests } from '../util/redact-pre-llm.js';

let RUN_DIR: string;
let TMP_PARENT: string;

const ALLOWLISTED_EMAIL = 'assessor@example.com';
const NONALLOWLISTED_EMAIL = 'random.client@example.org';

const ISO_TIMESTAMP_PRIMARY = '2026-05-09T13:00:00Z';
const ISO_TIMESTAMP_OFFSET = '2026-05-09T13:00:00+02:00';
const REAL_IPV6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';

beforeAll(() => {
  TMP_PARENT = mkdtempSync(join(tmpdir(), 'swao-pii-scrub-'));
  RUN_DIR = join(TMP_PARENT, 'runs', '2026-05-09T13-00-00');
  mkdirSync(RUN_DIR, { recursive: true });

  // wsp-plan.yaml -- the timestamps here are the highest-risk false
  // positive (4569 fields would have been corrupted in sprint-038 before
  // the exemption fix).
  writeFileSync(
    join(RUN_DIR, 'wsp-plan.yaml'),
    [
      `assessed_at: "${ISO_TIMESTAMP_PRIMARY}"`,
      `assessor: ${ALLOWLISTED_EMAIL}`,
      `notes: "Report compiled by ${ALLOWLISTED_EMAIL} on schedule"`,
      `client_contact: ${NONALLOWLISTED_EMAIL}`,
      `pipeline_window:`,
      `  start: "${ISO_TIMESTAMP_OFFSET}"`,
      `  end:   "2026-05-09T17:30:00.000Z"`,
      'compliance:',
      '  regimes: []',
      '',
    ].join('\n'),
    'utf-8',
  );

  // passes/07-egr.yaml -- mix of an actual IPv6 address (must be
  // redacted) and another timestamp (must survive). Tests that the
  // exemption is per-token, not per-file.
  mkdirSync(join(RUN_DIR, 'passes'), { recursive: true });
  writeFileSync(
    join(RUN_DIR, 'passes', '07-egr.yaml'),
    [
      `assessed_at: "${ISO_TIMESTAMP_PRIMARY}"`,
      `signals:`,
      `  - id: EGR-99`,
      `    severity: high`,
      `    derivation: "Outbound to ${REAL_IPV6} on port 443; not on allowlist."`,
      '',
    ].join('\n'),
    'utf-8',
  );

  // redaction-report.json -- skip-listed by the scrub (the audit trail
  // must NOT itself be scrubbed). Including it in the fixture so the
  // skip-list logic is also exercised under the same sweep.
  writeFileSync(
    join(RUN_DIR, 'redaction-report.json'),
    JSON.stringify({
      events: [
        { surface: 'llm_egress', counts: { email: 1 }, provider: 'anthropic' },
      ],
    }, null, 2),
    'utf-8',
  );
});

afterAll(() => {
  if (TMP_PARENT) rmSync(TMP_PARENT, { recursive: true, force: true });
});

beforeEach(() => {
  _resetForTests();
  setAllowlist([ALLOWLISTED_EMAIL]);
});

describe('scrub-real-WSP-fixture integration (#0362)', () => {
  it('completes the sweep within the <5s budget the AC specifies', () => {
    const t0 = Date.now();
    const result = scrubRunDirectory(RUN_DIR);
    const elapsedMs = Date.now() - t0;
    expect(elapsedMs, `sweep took ${elapsedMs}ms (budget 5000ms)`).toBeLessThan(5000);
    expect(result.files_scanned).toBeGreaterThan(0);
  });

  it('IPv6 timestamp exemption: assessed_at + pipeline_window timestamps survive the scrub', () => {
    scrubRunDirectory(RUN_DIR);
    const plan = readFileSync(join(RUN_DIR, 'wsp-plan.yaml'), 'utf-8');
    expect(plan, 'primary assessed_at must survive').toContain(`"${ISO_TIMESTAMP_PRIMARY}"`);
    expect(plan, 'offset timestamp must survive').toContain(`"${ISO_TIMESTAMP_OFFSET}"`);
    expect(plan, 'sub-second-precision timestamp must survive').toContain('"2026-05-09T17:30:00.000Z"');
    expect(plan, 'no IPv6 redaction marker on a timestamp').not.toMatch(/\[REDACTED-IPV?6?\][^\n]*T\d\d:\d\d/);
  });

  it('real IPv6 address IS redacted (sweep is functional, exemption is selective)', () => {
    scrubRunDirectory(RUN_DIR);
    const egr = readFileSync(join(RUN_DIR, 'passes', '07-egr.yaml'), 'utf-8');
    expect(egr, 'real IPv6 must be redacted').not.toContain(REAL_IPV6);
    expect(egr).toMatch(/\[REDACTED-IPV6\]/);
    // Sanity: the pass file's own timestamp survives too.
    expect(egr).toContain(`"${ISO_TIMESTAMP_PRIMARY}"`);
  });

  it('allowlist propagation: allowlisted email survives the scrub at every occurrence', () => {
    scrubRunDirectory(RUN_DIR);
    const plan = readFileSync(join(RUN_DIR, 'wsp-plan.yaml'), 'utf-8');
    // Two occurrences (assessor field + inline in notes) MUST both pass.
    const matches = plan.match(new RegExp(ALLOWLISTED_EMAIL.replace('.', '\\.'), 'g')) ?? [];
    expect(matches.length, `expected 2 occurrences of allowlisted email; got ${matches.length}`).toBe(2);
  });

  it('non-allowlisted email IS redacted (allowlist is selective, not blanket)', () => {
    scrubRunDirectory(RUN_DIR);
    const plan = readFileSync(join(RUN_DIR, 'wsp-plan.yaml'), 'utf-8');
    expect(plan, 'non-allowlisted email must be redacted').not.toContain(NONALLOWLISTED_EMAIL);
    expect(plan).toMatch(/\[REDACTED-EMAIL\]/);
  });

  it('redaction-report.json is skip-listed and NOT mutated by the sweep', () => {
    // The redaction audit trail must survive scrub-pass; otherwise a
    // self-eating loop is possible (scrub the file that records scrubs).
    const before = readFileSync(join(RUN_DIR, 'redaction-report.json'), 'utf-8');
    scrubRunDirectory(RUN_DIR);
    const after = readFileSync(join(RUN_DIR, 'redaction-report.json'), 'utf-8');
    expect(after).toBe(before);
  });

  it('#0824 wsp.yaml is skip-listed so engagement.partnership_lead survives', () => {
    const wspYamlContent = [
      'wsp_version: "0.10"',
      'engagement:',
      '  name: my-workspace',
      '  client_code: test',
      '  partnership_lead: partner@example.com',
      '  start_date: "2026-07-06"',
    ].join('\n');
    writeFileSync(join(RUN_DIR, 'wsp.yaml'), wspYamlContent, 'utf-8');
    scrubRunDirectory(RUN_DIR);
    const after = readFileSync(join(RUN_DIR, 'wsp.yaml'), 'utf-8');
    expect(after, 'partnership_lead must NOT be redacted from wsp.yaml').toContain('partner@example.com');
    expect(after, 'wsp.yaml must be unchanged').toBe(wspYamlContent);
  });

  it('empty / no-PII case: clean fixture passes through unchanged', () => {
    const cleanDir = join(TMP_PARENT, 'clean-run');
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(
      join(cleanDir, 'noop.yaml'),
      `verdict: Replatform\ntotal_signals: 12\n`,
      'utf-8',
    );
    const result = scrubRunDirectory(cleanDir);
    expect(result.files_scrubbed).toBe(0);
    expect(result.total_chars_removed).toBe(0);
  });
});
