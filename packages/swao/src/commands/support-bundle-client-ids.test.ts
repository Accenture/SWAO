// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- support bundle v2.5: no client identifiers or secrets (#3517)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Fixture values are invented and neutral; none names a real client or system.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { _paths as licencePaths, emptyCounts } from '@swao/core';
import { BUNDLE_VERSION, REDACTION_LEVEL, cmdSupportBundle } from './support-bundle.js';
import {
  _collectLimits, collectClientIdentifiers, collectKnownSecrets, createClientIdPseudonymiser, entriesWithKnownSecrets, finalSecretPass, pseudonymTag,
  type ClientIdentifiers,
} from './support-bundle-client-ids.js';

const APP_ID = 'zqfin-ledger042';
const OTHER_APP = 'zqhr-payroll7';
const APP_NAME = 'Zq Ledger Reconcile Hub';
const SHEET = 'Zq Serverliste Standort Nord';
const HEADER = 'Zq Betriebsverantwortung Fachbereich';
const PDF = 'Operations-Handbook-ZQ-v3.2-2026-09.pdf';
const PDF_STEM = 'Operations-Handbook-ZQ-v3.2-2026-09';
const DOC_SPACED = 'Betriebskonzept Zahlungsverkehr 2026.docx';
const SECRET = 'Zq9xSecretValue77'; // pragma: allowlist secret (synthetic fixture value)
const EMAIL = 'ops.lead@zq-example.org';
const IP = '10.42.7.19';

const ids = (appIds: string[], files: string[] = [], stems: string[] = [], appNames: string[] = []): ClientIdentifiers =>
  ({ appIds: new Set(appIds), fileNames: new Set(files.map((f) => f.toLowerCase())), stems: new Set(stems.map((s) => s.toLowerCase())), appNames: new Set(appNames) });
const zeroCounts = () => ({ app_ids: 0, app_names: 0, workbook_names: 0, file_names: 0, structure_names: 0, secrets_masked: 0, pii_values: 0, collection_truncated: 0, fallback_file_tokens: 0 });

describe('client-identifier pseudonymiser (#3517)', () => {
  const tag = pseudonymTag('fixed-salt');

  it('replaces an app ID wherever it stands as its own segment run, stably, and leaves longer IDs alone', () => {
    const p = createClientIdPseudonymiser(ids([APP_ID, 'zqweb']), tag);
    const out = p.scrub(`apps/${APP_ID}/wsp swao-${APP_ID}-report.html ${APP_ID.toUpperCase()}.json zqweb2 zqweb_api`);
    expect(out).not.toMatch(/zqfin-ledger042/i);
    const ph = out.match(/<app-[0-9a-f]{6}>/g)!;
    expect(new Set(ph).size).toBe(2); // the long ID and zqweb
    expect(out).toContain('zqweb2'); // a different, longer ID is not touched
    expect(out).toMatch(/^apps\/<app-[0-9a-f]{6}>\/wsp swao-<app-[0-9a-f]{6}>-report\.html <app-[0-9a-f]{6}>\.json zqweb2 <app-[0-9a-f]{6}>_api$/);
    expect(p.mapping[ph[0]!]).toBe(APP_ID);
    expect(p.counts.app_ids).toBe(2);
  });

  it('finds names right after a JSON escape and keeps the escape valid', () => {
    const p = createClientIdPseudonymiser(ids([APP_ID], [PDF]), tag);
    const json = JSON.stringify({ m: `line\n${APP_ID}\n${PDF}` });
    const out = p.scrub(json);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toMatch(/zqfin-ledger042|Operations-Handbook/i);
  });

  it('replaces client file names, their stems and spaced document titles, keeping the extension', () => {
    const p = createClientIdPseudonymiser(ids([], [PDF, DOC_SPACED], [PDF_STEM]), tag);
    const out = p.scrub(`ingested ${PDF}; title ${PDF_STEM}. Also "${DOC_SPACED}" next to run-manifest.json`);
    expect(out).not.toMatch(/Operations-Handbook|Zahlungsverkehr/);
    expect(out).toMatch(/ingested <file-[0-9a-f]{8}\.pdf>; title <file-[0-9a-f]{8}>\. Also "<file-[0-9a-f]{8}\.docx>" next to run-manifest\.json/);
  });

  it('leaves JSON keys and SWAO entry names alone; only the app ID of service/apps/<id>/ is replaced', () => {
    const p = createClientIdPseudonymiser(ids([APP_ID], ['context.ts', 'service.ts'], ['Ops-Guide-2026'], ['Ledger Hub 2']), tag);
    expect(p.scrub('{"context":{"file":"context.ts"},"message":"Ledger Hub 2 read Ops-Guide-2026"}'))
      .toMatch(/^\{"context":\{"file":"<file-[0-9a-f]{8}\.ts>"\},"message":"<appname-[0-9a-f]{6}> read <file-[0-9a-f]{8}>"\}$/);
    expect(p.entryName('service/scaffold-signals.json')).toBe('service/scaffold-signals.json');
    expect(p.entryName(`service/apps/${APP_ID}/research/cve-summary.md`)).toMatch(/^service\/apps\/<app-[0-9a-f]{6}>\/research\/cve-summary\.md$/);
  });

  it('collects only title-like stems from documents and exact names from source trees, and records a truncated walk', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-sbt-collect-'));
    try {
      const app = join(ws, 'apps', APP_ID);
      mkdirSync(join(app, 'wsp', 'inputs', 'docs'), { recursive: true });
      mkdirSync(join(app, 'wsp', 'inputs', 'source'), { recursive: true });
      writeFileSync(join(app, 'wsp', 'inputs', 'docs', PDF), 'x');
      writeFileSync(join(app, 'wsp', 'inputs', 'docs', 'context.pdf'), 'x');
      for (const f of ['context.ts', 'message.ts', 'service.ts', 'Ledger-Batch-Job.java']) writeFileSync(join(app, 'wsp', 'inputs', 'source', f), 'x');
      const found = collectClientIdentifiers(ws);
      expect(found.fileNames.has('context.ts')).toBe(true);
      expect(found.stems.has(PDF_STEM.toLowerCase())).toBe(true);
      expect([...found.stems]).not.toContain('context'); // an ordinary word, even as a document stem
      expect([...found.stems]).not.toContain('ledger-batch-job'); // source files give exact names only
      expect(found.truncated).toEqual([]);
      const saved = _collectLimits.entriesPerFolder;
      _collectLimits.entriesPerFolder = 1;
      try { expect(collectClientIdentifiers(ws).truncated!.length).toBeGreaterThan(0); } finally { _collectLimits.entriesPerFolder = saved; }
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });

  it('fallback file-shape scrub replaces document and source names but not SWAO JSON names or keys', () => {
    const p = createClientIdPseudonymiser(ids([]), tag);
    const out = p.scrubFileShapes(JSON.stringify({ m: `opened ${PDF} and Billing.java, wrote run-manifest.json and 04-ctx.json`, 'Board.xlsx': 1 }));
    expect(out).not.toMatch(/Operations-Handbook|Billing\.java/);
    expect(out).toContain('run-manifest.json');
    expect(out).toContain('04-ctx.json');
    expect(out).toContain('"Board.xlsx":1');
    expect(p.counts.fallback_file_tokens).toBe(2);
  });

  it('keeps the shape of workspace-structure paths, hashing client folder content and non-SWAO names', () => {
    const p = createClientIdPseudonymiser(ids([APP_ID]), tag);
    expect(p.structurePath(`apps\\${APP_ID}\\wsp\\inputs\\docs\\${PDF}`)).toMatch(/^apps\/<app-[0-9a-f]{6}>\/wsp\/inputs\/<name-[0-9a-f]{8}>\/<name-[0-9a-f]{8}\.pdf>$/);
    expect(p.structurePath(`apps/${APP_ID}/wsp/runs/2026-10-25T13-46-17-235Z/run-manifest.json`)).toMatch(/^apps\/<app-[0-9a-f]{6}>\/wsp\/runs\/2026-10-25T13-46-17-235Z\/run-manifest\.json$/);
    expect(p.structurePath('wsp/reports/Board Summary Q3.xlsx')).toMatch(/^wsp\/reports\/<name-[0-9a-f]{8}\.xlsx>$/);
  });
});

describe('secret pass and refusal guard (#3517)', () => {
  it('masks a known secret in raw and JSON-escaped form, and e-mail and IPv4 values, keeping JSON valid', () => {
    const secret = 'Zq"9x\\Secret';
    const counts = zeroCounts();
    const text = `${JSON.stringify({ a: `token ${secret}`, b: EMAIL, c: `host ${IP}` }, null, 2)}\n`;
    const out = finalSecretPass('x.json', text, [secret], emptyCounts(), counts);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(IP);
    expect(counts.secrets_masked).toBeGreaterThan(0);
    expect(counts.pii_values).toBeGreaterThanOrEqual(2);
  });

  it('names the entries in which a known secret survives (content or entry name), never the value', () => {
    const entries = [
      { name: 'a.json', content: Buffer.from('{"x":"clean"}') },
      { name: 'b.ndjson', content: Buffer.from(`{"m":"${SECRET}"}`) },
      { name: `c-${SECRET}.txt`, content: Buffer.from('clean') },
    ];
    const hits = entriesWithKnownSecrets(entries, [SECRET]);
    expect(hits).toEqual(['b.ndjson', `c-${SECRET}.txt`]);
    expect(entriesWithKnownSecrets(entries.slice(0, 1), [SECRET])).toEqual([]);
  });
});

// ---- end to end: build a bundle from a client-like fixture and scan every byte ----

function untar(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0.*$/s, '');
    const base = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    off += 512;
    files.set(prefix ? `${prefix}/${base}` : base, buf.subarray(off, off + size).toString('utf-8'));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

describe('cmdSupportBundle v2.5: no app ID, input document name, detected secret or PII in any bundle file (#3517)', () => {
  let ws = '';
  let cwd = '';
  let savedPaths = { ...licencePaths };

  beforeEach(() => {
    cwd = process.cwd();
    ws = mkdtempSync(join(tmpdir(), 'swao-sbt-3517-'));
    savedPaths = { ...licencePaths };
    const lic = join(ws, 'licence-sandbox');
    mkdirSync(lic);
    Object.assign(licencePaths, {
      statePath: join(lic, '.swao-state.json'),
      licensePath: join(lic, 'licence.json'),
      legacyLicencePath: join(lic, 'no-legacy.json'),
    });
  });
  afterEach(() => {
    Object.assign(licencePaths, savedPaths);
    process.chdir(cwd);
    process.exitCode = undefined;
    rmSync(ws, { recursive: true, force: true });
  });

  function fixture(): void {
    // A service portfolio whose workbook sheet and column names must not leave the workspace.
    writeFileSync(join(ws, '.swao.yml'), [
      'workspace:', '  name: fixture-3517', 'service_portfolio:', '  source: inventory.xlsx', '  app_count: 1', '  row_count: 1',
      `  sheets: ["${SHEET}"]`, '  headers:', `    "${SHEET}":`, '      A: App ID', `      B: "${HEADER}"`, '',
    ].join('\n'));
    mkdirSync(join(ws, 'wsp', 'signals'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), JSON.stringify({
      generated_at: new Date().toISOString(), source: 'inventory.xlsx', counts: {}, signals: [],
      warnings: [`sheet "${SHEET}": column B ("${HEADER}") looks like personal data but is not declared in pii_columns`],
    }));
    const app = join(ws, 'apps', APP_ID);
    mkdirSync(join(app, 'wsp', 'inputs', 'docs'), { recursive: true });
    mkdirSync(join(app, 'wsp', 'inputs', 'source', 'config'), { recursive: true });
    writeFileSync(join(app, '.swao.yml'), `app_id: ${APP_ID}\napp_name: ${APP_NAME}\nassessment:\n  type: application\nsource:\n  path: wsp/inputs/source/\n`);
    writeFileSync(join(app, 'wsp', 'inputs', 'docs', PDF), '%PDF-1.4 fixture');
    writeFileSync(join(app, 'wsp', 'inputs', 'docs', DOC_SPACED), 'docx fixture');
    // The detected secret: a credential literal in client source, as Pass 03 finds it.
    writeFileSync(join(app, 'wsp', 'inputs', 'source', 'config', 'ledger.properties'), `db.url=jdbc:x\ndb.password = "${SECRET}"\n`);
    // Ordinary source names must not turn bundle keys or words into placeholders.
    for (const f of ['context.ts', 'message.ts', 'service.ts', 'status.ts']) writeFileSync(join(app, 'wsp', 'inputs', 'source', f), 'export {};\n');
    // A run whose manifest names the input document.
    const run = join(app, 'wsp', 'runs', '2026-10-25T13-46-17-235Z');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(app, 'wsp', 'latest.txt'), 'runs/2026-10-25T13-46-17-235Z');
    writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({
      schema_version: '1.6', run_id: 'r1', app: APP_ID, iter: 1, passes_executed: ['ingest'],
      provenance: { placeholder_inputs: [PDF], cassette_hits: [] },
    }));
    mkdirSync(join(ws, 'apps', OTHER_APP), { recursive: true });
    writeFileSync(join(ws, 'apps', OTHER_APP, '.swao.yml'), `app_id: ${OTHER_APP}\n`);

    const logs = join(app, 'wsp', 'logs');
    mkdirSync(logs, { recursive: true });
    const now = new Date().toISOString();
    const events = [
      { ts: now, level: 'info', scope: 'app', code: 'pass.ingest.file', app_id: APP_ID, message: `ingested docs/${PDF} for ${APP_ID} (${APP_NAME})`, context: { file: PDF, title: DOC_SPACED } },
      // The secret reaches a bundle file before redaction: a bare value no pattern guard recognises.
      { ts: now, level: 'error', scope: 'app', code: 'pass.data.failed', app_id: APP_ID, message: `login retry with ${SECRET} failed; contact ${EMAIL} at ${IP}`, context: { stderr: `open ${PDF_STEM} failed` } },
    ];
    writeFileSync(join(logs, 'app-events-2026-10.ndjson'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
    mkdirSync(join(ws, 'wsp', 'logs'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'logs', 'portfolio-events-2026-10.ndjson'), `${JSON.stringify({ ts: now, level: 'warn', scope: 'portfolio', code: 'portfolio.app.skipped', app_id: OTHER_APP, message: `${OTHER_APP} skipped` })}\n`);
  }

  it('leaves none of the planted client values in any entry name or content', () => {
    fixture();
    // Positive control: the planted values exist in the workspace and are found.
    const found = collectClientIdentifiers(ws);
    expect(found.appIds.has(APP_ID)).toBe(true);
    expect(found.fileNames.has(PDF.toLowerCase())).toBe(true);
    expect(collectKnownSecrets(ws).values).toContain(SECRET);

    const outDir = join(ws, 'out');
    process.chdir(ws);
    cmdSupportBundle({ workspace: ws, out: outDir });
    expect(process.exitCode ?? 0).toBe(0);
    const tgz = readdirSync(outDir).filter((f) => f.endsWith('.tar.gz'));
    expect(tgz).toHaveLength(1);
    const files = untar(gunzipSync(readFileSync(join(outDir, tgz[0]!))));
    expect(files.size).toBeGreaterThanOrEqual(17);

    const needles = [APP_ID, OTHER_APP, APP_NAME, SHEET, HEADER, PDF, PDF_STEM, 'Betriebskonzept Zahlungsverkehr', SECRET, EMAIL, IP, 'ledger.properties'];
    const hits: string[] = [];
    for (const [name, text] of files) {
      for (const n of needles) {
        if (name.toLowerCase().includes(n.toLowerCase())) hits.push(`entry name ${name}: ${n}`);
        if (text.toLowerCase().includes(n.toLowerCase())) hits.push(`${name}: ${n}`);
      }
      if (name.endsWith('.json')) expect(() => JSON.parse(text), name).not.toThrow();
    }
    expect(hits).toEqual([]);

    // Non-vacuous: the pseudonyms stand where the values were.
    const trace = files.get('execution-trace.ndjson')!;
    expect(trace).toContain('"context":');
    expect(trace).toContain('"message":');
    expect([...files.keys()]).toContain('manifest.json');
    expect(trace).toMatch(/"app_id":"<app-[0-9a-f]{6}>"/);
    expect(trace).toMatch(/<file-[0-9a-f]{8}\.pdf>/);
    expect(trace).toContain('***(17)');
    expect(trace).toMatch(/\(<appname-[0-9a-f]{6}>\)/);
    const structure = files.get('workspace-structure.json')!;
    expect(structure).toMatch(/apps\/<app-[0-9a-f]{6}>\/wsp\/inputs\/<name-[0-9a-f]{8}>\/<name-[0-9a-f]{8}\.pdf>/);
    expect(files.get('run-manifests.json')!).toMatch(/<file-[0-9a-f]{8}\.pdf>/);

    // Workbook sheet and column names are dropped; their counts stay.
    const wsConfig = JSON.parse(files.get('workspace-config.json')!) as { workspace_config: { service_portfolio: Record<string, unknown> } };
    expect(wsConfig.workspace_config.service_portfolio).toMatchObject({ sheet_count: 1, column_counts: [2] });
    expect(wsConfig.workspace_config.service_portfolio).not.toHaveProperty('headers');
    expect(wsConfig.workspace_config.service_portfolio).not.toHaveProperty('sheets');
    expect(files.get('service/scaffold-signals.json')!).toMatch(/sheet \\"<sheet-[0-9a-f]{6}>\\": column B \(\\"<column-[0-9a-f]{6}>\\"\)/);

    const manifest = JSON.parse(files.get('manifest.json')!) as { bundle_version: string; redaction_level: string; client_identifier_redaction: { app_ids: number } };
    expect(manifest['bundle_version']).toBe('2.5');
    expect(BUNDLE_VERSION).toBe('2.5');
    expect(manifest['redaction_level']).toBe(REDACTION_LEVEL);
    expect(manifest['client_identifier_redaction']['app_ids']).toBeGreaterThanOrEqual(2);

    // The mapping stays local: in the workspace, not in the archive and not next to the bundle.
    const localDir = join(ws, 'wsp', 'support-diag', 'local');
    const maps = existsSync(localDir) ? readdirSync(localDir) : [];
    expect(maps).toHaveLength(1);
    expect(readFileSync(join(localDir, maps[0]!), 'utf-8')).toContain(APP_ID);
    expect([...files.keys()].some((n) => n.includes('pseudonym'))).toBe(false);
    expect(readdirSync(outDir)).toEqual(tgz);
  }, 120_000);
});

describe('cmdSupportBundle v2.5: truncated collection falls back to the file-shape scrub (#3517)', () => {
  let ws = '';
  let cwd = '';
  let savedPaths = { ...licencePaths };
  const saved = { ..._collectLimits };

  beforeEach(() => {
    cwd = process.cwd();
    ws = mkdtempSync(join(tmpdir(), 'swao-sbt-3517t-'));
    savedPaths = { ...licencePaths };
    const lic = join(ws, 'licence-sandbox');
    mkdirSync(lic);
    Object.assign(licencePaths, { statePath: join(lic, '.swao-state.json'), licensePath: join(lic, 'licence.json'), legacyLicencePath: join(lic, 'no-legacy.json') });
  });
  afterEach(() => {
    Object.assign(_collectLimits, saved);
    Object.assign(licencePaths, savedPaths);
    process.chdir(cwd);
    process.exitCode = undefined;
    rmSync(ws, { recursive: true, force: true });
  });

  it('still keeps an input document name out of the trace when the walk budget is exhausted', () => {
    writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: fixture-3517t\n');
    const docs = join(ws, 'apps', APP_ID, 'wsp', 'inputs', 'docs');
    mkdirSync(docs, { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(docs, `filler-${i}.txt`), 'x');
    const LATE = 'zz-Quarterly-Review-ZQ-2026.pdf'; // sorts after the fillers, so the walk never reaches it
    writeFileSync(join(docs, LATE), 'x');
    const logs = join(ws, 'apps', APP_ID, 'wsp', 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'app-events-2026-10.ndjson'), `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', scope: 'app', code: 'pass.ingest.file', app_id: APP_ID, message: `ingested ${LATE}` })}\n`);
    _collectLimits.entriesPerFolder = 2;
    expect(collectClientIdentifiers(ws).fileNames.has(LATE.toLowerCase())).toBe(false);

    const outDir = join(ws, 'out');
    process.chdir(ws);
    cmdSupportBundle({ workspace: ws, out: outDir });
    expect(process.exitCode ?? 0).toBe(0);
    const tgz = readdirSync(outDir).filter((f) => f.endsWith('.tar.gz'));
    const files = untar(gunzipSync(readFileSync(join(outDir, tgz[0]!))));
    for (const [name, text] of files) {
      expect(text.includes(LATE), name).toBe(false);
      expect(text.toLowerCase().includes(APP_ID), name).toBe(false);
    }
    const manifest = JSON.parse(files.get('manifest.json')!) as { client_identifier_redaction: { collection_truncated: number; fallback_file_tokens: number } };
    expect(manifest.client_identifier_redaction.collection_truncated).toBeGreaterThan(0);
    expect(manifest.client_identifier_redaction.fallback_file_tokens).toBeGreaterThan(0);
  }, 120_000);
});
