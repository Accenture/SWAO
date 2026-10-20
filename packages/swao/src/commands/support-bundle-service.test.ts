// Phase 11 suite (#3135, #3136; Design 103 §19.5).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { emptyCounts } from '@swao/core';
import { collectServiceArtefacts, redactServiceValue, renderRedactionLog, type ServiceRedaction } from './support-bundle-service.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const identity = (v: unknown) => v;
const PII = ['erika@example.org', '+49 30 1234567', 'Erika Musterfrau'];

function serviceWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-sb-svc-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), dump({ wsp_version: '0.9', service_portfolio: { source: 'intake.xlsx', mapping: 'column-map.yaml' } }));
  writeFileSync(join(ws, 'column-map.yaml'), dump({ version: '1.0', fields: { os: { col: 'I' } } }));
  mkdirSync(join(ws, 'wsp', 'signals'), { recursive: true });
  writeFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), JSON.stringify({ generated_at: '2026-10-10', signals: [] }));
  writeFileSync(join(ws, 'wsp', 'portfolio-summary.json'), JSON.stringify({ app_count: 1, apps: [{ id: 'hosapp200' }] }));
  mkdirSync(join(ws, 'wsp', 'inputs', 'catalogs', 'infra-cat'), { recursive: true });
  writeFileSync(join(ws, 'wsp', 'inputs', 'catalogs', 'infra-cat', 'engagement.yaml'), dump({ services: [{ id: 'INFRA_CUSTOM_LAB', name: 'Lab' }] }));

  const app = join(ws, 'apps', 'hosapp200');
  mkdirSync(join(app, 'wsp', 'inputs', 'research'), { recursive: true });
  mkdirSync(join(app, 'wsp', 'inputs', 'binary'), { recursive: true });
  writeFileSync(join(app, '.swao.yml'), dump({ app_id: 'hosapp200', assessment: { type: 'service' } }));
  writeFileSync(join(app, 'wsp', 'inputs', 'research', 'vendor-profile.md'),
    `---\n${dump({ topic: 'vendor-profile', app_id: 'hosapp200', reviewed_by: PII[2], note: `Escalation via ${PII[0]} or ${PII[1]}`, retrieved_at: '2026-10-10T08:00:00Z' })}---\n\n## Vendor profile\n\nBody text with Secret Notes that must stay out of the bundle.\n`);
  writeFileSync(join(app, 'wsp', 'inputs', 'research', 'confidence.json'), JSON.stringify({ app_id: 'hosapp200', composite: 'medium', topics: {} }));
  writeFileSync(join(app, 'wsp', 'inputs', 'binary', 'binary-analysis.json'), JSON.stringify({ app_id: 'hosapp200', files: [{ path: 'wsp/inputs/binary/setup.exe', sha256: 'ab' }] }));
  writeFileSync(join(app, 'wsp', 'inputs', 'binary', 'manifest.json'), JSON.stringify({ files: [{ name: 'setup.exe', sha256: 'ab' }] }));

  // An application app in the same workspace contributes nothing.
  mkdirSync(join(ws, 'apps', 'demo-app', 'wsp', 'inputs', 'research'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'), dump({ app_id: 'demo-app', assessment: { type: 'application' } }));
  writeFileSync(join(ws, 'apps', 'demo-app', 'wsp', 'inputs', 'research', 'x.md'), '---\ntopic: x\n---\n');
  return ws;
}

describe('service artefacts in the support bundle (#3135)', () => {
  it('collects the service artefact set under service/ plus redaction-log.txt', () => {
    const r = collectServiceArtefacts(serviceWorkspace(), emptyCounts(), identity)!;
    expect(r.entries.map((e) => e.name)).toEqual([
      'service/scaffold-signals.json',
      'service/portfolio-summary.json',
      'service/column-map.yaml',
      'service/infra-cat/engagement.yaml',
      'service/apps/hosapp200/research/vendor-profile.md',
      'service/apps/hosapp200/research/confidence.json',
      'service/apps/hosapp200/binary/binary-analysis.json',
      'service/apps/hosapp200/binary/manifest.json',
      'redaction-log.txt',
    ]);
  });

  it('bundles research stub front-matter only', () => {
    const r = collectServiceArtefacts(serviceWorkspace(), emptyCounts(), identity)!;
    const stub = r.entries.find((e) => e.name.endsWith('vendor-profile.md'))!.content.toString('utf-8');
    expect(stub.startsWith('---\n')).toBe(true);
    expect(stub).not.toContain('Secret Notes');
    expect(stub).not.toContain('## Vendor profile');
    expect((load(stub.replace(/^---\n|---\n$/g, '')) as Record<string, unknown>)['topic']).toBe('vendor-profile');
  });

  it('returns nothing for an application workspace, so application bundles are unchanged', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-sb-app-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: app\n');
    expect(collectServiceArtefacts(ws, emptyCounts(), identity)).toBeNull();
  });
});

describe('second-pass PII redaction (#3136)', () => {
  it('redacts e-mail, phone, and reviewer names in bundled artefacts and logs file + field only', () => {
    const r = collectServiceArtefacts(serviceWorkspace(), emptyCounts(), identity)!;
    const all = r.entries.map((e) => e.content.toString('utf-8')).join('\n');
    for (const v of PII) expect(all).not.toContain(v);
    const stub = r.entries.find((e) => e.name.endsWith('vendor-profile.md'))!.content.toString('utf-8');
    expect(stub).toContain('reviewed_by: \'[REDACTED-NAME]\'');
    expect(stub).toContain('Escalation via [REDACTED-EMAIL] or [REDACTED-PHONE]');
    expect(r.redactions).toEqual([
      { file: 'service/apps/hosapp200/research/vendor-profile.md', field: 'reviewed_by', kind: 'name' },
      { file: 'service/apps/hosapp200/research/vendor-profile.md', field: 'note', kind: 'email' },
      { file: 'service/apps/hosapp200/research/vendor-profile.md', field: 'note', kind: 'phone' },
    ]);
    const log = r.entries.find((e) => e.name === 'redaction-log.txt')!.content.toString('utf-8');
    expect(log).toContain('service/apps/hosapp200/research/vendor-profile.md\treviewed_by\tname');
    expect(log).toContain('service/apps/hosapp200/research/vendor-profile.md\tnote\temail');
  });

  it('leaves dates, versions, app names, and vendor names alone', () => {
    const log: ServiceRedaction[] = [];
    const v = { retrieved_at: '2026-10-10T08:00:00Z', version: '9.1.20231', product_name: 'Imaging Viewer', vendor_name: 'FUJIFILM Europe', top: [{ id: 'CVE-2026-12345' }] };
    expect(redactServiceValue(v, 'f', log)).toEqual(v);
    expect(log).toEqual([]);
  });

  it('writes an explicit no-redactions line when nothing was found', () => {
    expect(renderRedactionLog([])).toMatch(/# No redactions applied\.\n$/);
  });
});
