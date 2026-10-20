// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Phase 2 integration suite (#3092): scaffold -> research against a local mock of all APIs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { runServiceInit } from '../scaffold/init.js';
import { tier2Dir } from '../catalog/infra-cat.js';
import { runServiceResearch, validateStub, type ServiceResearchOptions } from '../research/research.js';
import { readStub, writeStub } from '../research/stub-file.js';
import { RESEARCH_TOPICS, ResearchConfidenceFileSchema } from '../research/schema.js';
import { ResearchSignalsFileSchema } from '../research/signals.js';
import { DEFAULT_HEADERS, DEFAULT_TEMPLATE_ROWS, TIER2_YAML, writeWorkbook } from './fixtures/scaffold-fixture.js';
import { fakeClock, localOnlyFetch, startMockResearchServer, type MockResearchServer } from './fixtures/mock-research-server.js';
import { buildPe } from './fixtures/binary/pe-builder.js';
import { P7_VALID } from './fixtures/binary/certs.js';

const dirs: string[] = [];
let mock: MockResearchServer;
afterAll(async () => {
  await mock.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
beforeAll(async () => { mock = await startMockResearchServer(); });

async function scaffoldedWorkspace(): Promise<string> {
  const ws = mkdtempSync(join(tmpdir(), 'swao-research-e2e-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  mkdirSync(tier2Dir(ws), { recursive: true });
  writeFileSync(join(tier2Dir(ws), 'custom.yaml'), TIER2_YAML);
  const xlsx = join(ws, 'intake.xlsx');
  await writeWorkbook(xlsx, [{ name: 'Sheet1', headers: DEFAULT_HEADERS, rows: DEFAULT_TEMPLATE_ROWS }]);
  const res = await runServiceInit({ workspacePath: ws, intakePath: xlsx });
  expect(res.ok).toBe(true);
  return ws;
}

const opts = (ws: string, extra: Partial<ServiceResearchOptions> = {}): ServiceResearchOptions => ({
  workspacePath: ws, fetch: localOnlyFetch, clock: fakeClock(), baseUrls: mock.baseUrls, now: new Date('2026-10-10T08:00:00Z'), ...extra,
});
const stub = (ws: string, app: string, topic: string) => readStub(join(ws, 'apps', app, 'wsp', 'inputs', 'research', `${topic}.md`));
const signalsOf = (ws: string, app: string) =>
  ResearchSignalsFileSchema.parse(JSON.parse(readFileSync(join(ws, 'apps', app, 'wsp', 'signals', 'research-signals.json'), 'utf-8'))).signals;

describe('swao service research --app hospacs004 (#3092)', () => {
  let ws: string;
  beforeAll(async () => {
    ws = await scaffoldedWorkspace();
    mock.requests.length = 0;
    await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
  });

  it('writes a valid stub for every topic at apps/<id>/wsp/inputs/research/<topic>.md', () => {
    for (const topic of RESEARCH_TOPICS) {
      const s = stub(ws, 'hospacs004', topic);
      expect(s, topic).not.toBeNull();
      expect(validateStub(topic, s!.front), `${topic} schema`).toBe(true);
    }
    expect(existsSync(join(ws, 'apps', 'hosapp133', 'wsp', 'inputs', 'research', 'cve-summary.md'))).toBe(false);
  });

  it('hydrates CVE, KEV, and BSI data for the FUJIFILM vendor', () => {
    const f = stub(ws, 'hospacs004', 'cve-summary')!.front as any;
    expect(f.cve).toMatchObject({ source: 'nvd', count: 4, critical_count: 1, high_count: 1, kev_match: true, confidence: 'medium' });
    expect(f.kev.matches.map((m: any) => m.cve)).toEqual(['CVE-2024-0001']);
    expect(f.bsi).toMatchObject({ alert_count: 1, highest_severity: 'hoch' });
    expect(f.osv.skipped_reason).toBe('no_oss_package');
    expect(f).toMatchObject({ status: 'researched', provenance: 'API-verified', vendor_name: 'FUJIFILM', product_name: 'PACS Storage' });
  });

  it('records provenance per source block: answered sources API-verified, skipped ones null (#3154)', () => {
    const f = stub(ws, 'hospacs004', 'cve-summary')!.front as any;
    expect([f.cve.provenance, f.kev.provenance, f.bsi.provenance, f.osv.provenance]).toEqual(['API-verified', 'API-verified', 'API-verified', null]);
    expect((stub(ws, 'hospacs004', 'eol-status')!.front as any).eol.provenance).toBe('API-verified');
    expect((stub(ws, 'hospacs004', 'virustotal')!.front as any).vt.provenance).toBeNull();
  });

  it('writes RESEARCH signals for KEV, open critical and high CVEs, the BSI advisory, and the EoL horizon (#3154)', () => {
    const signals = signalsOf(ws, 'hospacs004');
    expect(signals.map((x) => `${x.id} ${x.code}:${x.severity}`)).toEqual([
      'RES-01 CVE.CISA_KEV_MATCH:critical',
      'RES-02 CVE.CRITICAL_OPEN:critical',
      'RES-04 CVE.HIGH_SEVERITY_OPEN:high',
      'RES-07 ADVISORY.BSI_CERT_BUND:high',
      'RES-06 EOL.OS_WITHIN_18_MONTHS:high',
    ]);
    expect(signals[0]!.evidence).toContain('https://nvd.nist.gov/vuln/detail/CVE-2024-0001 (CISA due 2026-11-01)');
    expect(signals.find((x) => x.code === 'EOL.OS_WITHIN_18_MONTHS')!.evidence).toContain('wsp/inputs/research/eol-status.md');
    for (const x of signals) expect(JSON.stringify(x)).not.toMatch(/hospacs004|radiologie/i);
  });

  it('resolves the Windows Server 2016 end-of-life date', () => {
    const f = stub(ws, 'hospacs004', 'eol-status')!.front as any;
    expect(f.eol).toMatchObject({ product: 'windows-server', cycle: '2016', date: '2027-01-12', is_eol: false, confidence: 'high' });
  });

  it('skips VirusTotal without VT_API_KEY and the LLM topics without an LLM (#3289)', () => {
    expect((stub(ws, 'hospacs004', 'virustotal')!.front as any).vt.skipped_reason).toBe('no_api_key');
    for (const topic of ['vendor-profile', 'certifications', 'data-residency', 'breach-history']) {
      const s = stub(ws, 'hospacs004', topic)!;
      expect(s.front).toMatchObject({ status: 'skipped', skipped_reason: 'no_llm_configured', confidence: null, provenance: null });
      // The note says how to enable the topic and that it is not tier-gated.
      expect(String(s.front['note'])).toContain('no LLM provider is configured');
      expect(String(s.front['note'])).toContain('available in every licence tier');
      expect(String(s.front['note'])).not.toMatch(/Consultant tier/);
      expect(validateStub(topic as 'breach-history', s.front)).toBe(true);
    }
  });

  it('writes confidence.json with the minimum over researched topics', () => {
    const file = ResearchConfidenceFileSchema.parse(JSON.parse(readFileSync(join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', 'confidence.json'), 'utf-8')));
    expect(file.composite).toBe('medium');
    expect(file.topics).toMatchObject({ 'cve-summary': 'medium', 'eol-status': 'high', virustotal: null });
  });

  it('sends only vendor/product/OS data: no app ID, site, or redaction marker in any request', () => {
    expect(mock.requests.length).toBeGreaterThan(0);
    for (const r of mock.requests) {
      const wire = `${r.url} ${r.body} ${JSON.stringify(r.headers)}`.toLowerCase();
      for (const banned of ['hospacs004', 'hosapp', 'main site', 'radiologie', '[contact-name-redacted]']) expect(wire).not.toContain(banned);
    }
  });
});

describe('re-runs, refresh, dry run, and analyst edits', () => {
  it('rewrites a stub left as pending or not_implemented by an earlier build, then leaves it unchanged (#3243, #3289)', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    const path = join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', 'breach-history.md');
    const legacy = stub(ws, 'hospacs004', 'breach-history')!;
    const { skipped_reason: _r, ...front } = legacy.front as Record<string, unknown>;
    writeStub(path, { ...front, status: 'pending', note: 'LLM-augmented research (Design 103 §6.2.4, Consultant tier) has not run for this topic.' }, legacy.body, null);
    const again = await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    expect(again.apps[0]!.topics['breach-history']).toBe('refreshed');
    expect(stub(ws, 'hospacs004', 'breach-history')!.front).toMatchObject({ status: 'skipped', skipped_reason: 'no_llm_configured' });
    expect(again.llmTopics).toEqual(['vendor-profile', 'certifications', 'data-residency', 'breach-history']);
    expect(again.llm).toBeNull();
    expect(again.llmSkipReason).toBe('no_llm_configured');
    const third = await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    expect(third.apps[0]!.topics['breach-history']).toBe('unchanged');
    // A not_implemented stub written before #3289 is rewritten too.
    const cur = stub(ws, 'hospacs004', 'breach-history')!;
    writeStub(path, { ...cur.front, skipped_reason: 'not_implemented' }, cur.body, null);
    const fourth = await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    expect(fourth.apps[0]!.topics['breach-history']).toBe('refreshed');
  });

  it('leaves fresh stubs unchanged without --refresh and re-queries with it, keeping analyst text', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    const path = join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', 'cve-summary.md');
    writeFileSync(path, `${readFileSync(path, 'utf-8')}\n## Analyst notes\n\nVendor confirmed patch in Q4.\n`);

    mock.requests.length = 0;
    const firstSignals = signalsOf(ws, 'hospacs004');
    const again = await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    expect(again.apps[0]!.topics).toMatchObject({ 'cve-summary': 'unchanged', 'eol-status': 'unchanged', virustotal: 'unchanged' });
    expect(mock.requests).toHaveLength(0);
    // #3154: signals come from the final stubs, so an unchanged re-run keeps them.
    expect(firstSignals.length).toBeGreaterThan(0);
    expect(signalsOf(ws, 'hospacs004')).toEqual(firstSignals);
    expect(again.apps[0]!.signalCount).toBe(firstSignals.length);

    const later = await runServiceResearch(opts(ws, { appId: 'hospacs004', refresh: true, now: new Date('2026-10-11T08:00:00Z') }));
    expect(later.apps[0]!.topics['cve-summary']).toBe('refreshed');
    expect(mock.requests.some((r) => r.url.startsWith('/nvd'))).toBe(true);
    const s = stub(ws, 'hospacs004', 'cve-summary')!;
    expect(s.front['retrieved_at']).toBe('2026-10-11T08:00:00.000Z');
    expect(s.body).toContain('Vendor confirmed patch in Q4.');
  });

  it('re-queries a block past its TTL even without --refresh', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    mock.requests.length = 0;
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', now: new Date('2026-10-20T08:00:00Z') }));
    expect(r.apps[0]!.topics['cve-summary']).toBe('refreshed');
    expect(r.apps[0]!.topics['eol-status']).toBe('unchanged');
  });

  it('never overwrites a stub an analyst has reviewed, even with --refresh', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    const path = join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', 'eol-status.md');
    const s = readStub(path)!;
    writeStub(path, { ...s.front, reviewed_by: 'analyst', provenance: 'user-provided' }, 'reviewed', s.body);
    const before = readFileSync(path, 'utf-8');
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', refresh: true }));
    expect(r.apps[0]!.topics['eol-status']).toBe('protected');
    expect(readFileSync(path, 'utf-8')).toBe(before);
  });

  it('--dry-run makes no request and writes no file', async () => {
    const ws = await scaffoldedWorkspace();
    mock.requests.length = 0;
    const r = await runServiceResearch(opts(ws, { dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(r.apps).toHaveLength(16);
    expect(r.apps[0]!.topics['cve-summary']).toBe('created');
    expect(mock.requests).toHaveLength(0);
    // #3212: the scaffold no longer pre-creates the folder; a dry run must not create it either
    expect(existsSync(join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research'))).toBe(false);
    expect(existsSync(join(ws, 'apps', 'hospacs004', 'wsp', 'signals', 'research-signals.json'))).toBe(false);
    expect(r.apps[0]!.signalCount).toBeNull();
  });

  it('runs Pass 25 first and looks up the installer hash on VirusTotal when VT_API_KEY is set', async () => {
    const ws = await scaffoldedWorkspace();
    const bin = join(ws, 'apps', 'hospacs004', 'ingestion', 'binary');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'setup.exe'), buildPe({ signature: P7_VALID }));
    mock.requests.length = 0;
    await runServiceResearch(opts(ws, { appId: 'hospacs004', vtApiKey: 'vt-secret' }));
    const vt = (stub(ws, 'hospacs004', 'virustotal')!.front as any).vt;
    expect(vt).toMatchObject({ detection_ratio: '3/72' });
    expect(vt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(mock.requests.some((r) => r.url === `/vt/files/${vt.sha256}`)).toBe(true);
  });
});

describe('nothing to look up (#3168)', () => {
  it('records CVE and EoL as skipped with the missing inputs, sends no request, and counts the app as nothing to look up', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-research-noinput-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const xlsx = join(ws, 'intake.xlsx');
    await writeWorkbook(xlsx, [{ name: 'Sheet1', headers: ['App ID', 'OS'], rows: [['HOSAPP901', null], ['HOSAPP902', 'Windows Server 2016']] }]);
    expect((await runServiceInit({ workspacePath: ws, intakePath: xlsx })).ok).toBe(true);
    mock.requests.length = 0;
    const r = await runServiceResearch(opts(ws));

    const cve = stub(ws, 'hosapp901', 'cve-summary')!.front as any;
    expect(cve).toMatchObject({ status: 'skipped', confidence: null, skipped_reason: 'no_input', missing_inputs: ['vendor_name', 'product_name'] });
    const eol = stub(ws, 'hosapp901', 'eol-status')!.front as any;
    expect(eol).toMatchObject({ status: 'skipped', confidence: null, skipped_reason: 'no_input', missing_inputs: ['os'] });
    expect(validateStub('cve-summary', cve)).toBe(true);
    expect(validateStub('eol-status', eol)).toBe(true);
    // An app with an OS is still looked up for end of life.
    expect((stub(ws, 'hosapp902', 'eol-status')!.front as any).status).toBe('researched');
    expect(mock.requests.filter((q) => q.url.startsWith('/nvd'))).toHaveLength(0);
    expect(r.apps.find((a) => a.appId === 'hosapp901')!.composite).toBeNull();
    expect(r.distribution.none).toBeGreaterThanOrEqual(1);
    expect(r.distribution.low).toBe(r.apps.filter((a) => a.composite === 'low').length);
  });
});

describe('whole-workspace research', () => {
  it('researches every service app, dedupes identical NVD queries, and reports the distribution', async () => {
    const ws = await scaffoldedWorkspace();
    mock.requests.length = 0;
    const lines: string[] = [];
    const r = await runServiceResearch(opts(ws, { onProgress: (l) => lines.push(l) }));
    expect(r.apps).toHaveLength(16);
    expect(lines[0]).toBe('Researching 16 app(s)...');
    expect(lines.at(-1)).toMatch(/^\[16\/16\] /);
    const nvdQueries = mock.requests.filter((q) => q.url.startsWith('/nvd')).map((q) => new URL(q.url, 'http://x').searchParams.get('keywordSearch'));
    expect(new Set(nvdQueries).size).toBe(nvdQueries.length);
    expect(nvdQueries).not.toContain('Print Server');
    expect(mock.requests.filter((q) => q.url === '/kev.json')).toHaveLength(1);
    expect(r.distribution.high + r.distribution.medium + r.distribution.low + r.distribution.none).toBe(16);
    // #3168: the per-topic distribution covers every app for each API topic
    for (const t of ['cve-summary', 'eol-status', 'virustotal']) {
      const d = r.topicDistribution[t]!;
      expect(d.high + d.medium + d.low + d.none).toBe(16);
    }
    expect((stub(ws, 'hosapp302', 'cve-summary')!.front as any).cve).toMatchObject({ confidence: 'low', note: 'no_vendor_name' });
    // #3154: BSI advisories match on the product name when no vendor is known (weaker, so confidence low).
    const carestream = stub(ws, 'hosapp210', 'cve-summary')!.front as any;
    expect(carestream.bsi).toMatchObject({ alert_count: 1, highest_severity: 'kritisch', confidence: 'low', provenance: 'API-verified' });
    expect(carestream.provenance).toBe('API-verified');
    expect(signalsOf(ws, 'hosapp210').map((x) => `${x.code}:${x.severity}`)).toContain('ADVISORY.BSI_CERT_BUND:critical');
  });
});

// #3289: LLM-augmented research for vendor-profile, certifications, data-residency, breach-history.
describe('LLM-augmented research (#3289)', () => {
  const LLM_TOPICS = ['vendor-profile', 'certifications', 'data-residency', 'breach-history'] as const;
  const answer = JSON.stringify({
    summary: 'The vendor is headquartered in Japan with an EU subsidiary.',
    findings: [
      { statement: 'EU subsidiary in Germany', confidence: 'high', sources: [{ url: 'https://vendor.example/legal', title: 'Legal' }] },
      { statement: 'Roadmap not published', confidence: 'medium', sources: ['https://vendor.example/roadmap', 'not-a-url'] },
      { statement: 'Unsourced claim', confidence: 'high', sources: [] },
    ],
  });

  /** Mocked LlmProvider: records every prompt; `reply` decides the answer per prompt. */
  function mockLlm(reply: (prompt: string) => Promise<string> | string) {
    const prompts: string[] = [];
    return {
      prompts,
      llm: { name: 'mock', model: 'mock-model', complete: async (p: string) => { prompts.push(p); return reply(p); } },
    };
  }

  it('researches all four topics, writes LLM-researched stubs with model-cited sources, and caps confidence at medium', async () => {
    const ws = await scaffoldedWorkspace();
    const m = mockLlm(() => `Here is the result:\n\`\`\`json\n${answer}\n\`\`\``);
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm }));
    expect(m.prompts).toHaveLength(4);
    expect(r.llm).toEqual({ provider: 'mock', model: 'mock-model' });
    expect(r.llmSkipReason).toBeNull();
    for (const topic of LLM_TOPICS) {
      expect(r.apps[0]!.topics[topic]).toBe('created');
      const s = stub(ws, 'hospacs004', topic)!;
      const f = s.front as any;
      expect(validateStub(topic, f)).toBe(true);
      expect(f).toMatchObject({ status: 'researched', provenance: 'LLM-researched', confidence: 'low', retrieved_at: '2026-10-10T08:00:00.000Z' });
      expect(f.llm).toMatchObject({ source: 'llm', provider: 'mock', model: 'mock-model', prompt_version: '1.1-2026-10-18', provenance: 'LLM-researched', fetched_at: '2026-10-10T08:00:00.000Z' });
      expect(f.llm.findings).toHaveLength(3);
      expect(f.llm.findings[0]).toEqual({ statement: 'EU subsidiary in Germany', confidence: 'high', sources: [{ url: 'https://vendor.example/legal', title: 'Legal', cited_by: 'model', verified: false }] });
      // Non-URL sources are dropped; a finding without a source is low.
      expect(f.llm.findings[1].sources).toEqual([{ url: 'https://vendor.example/roadmap', title: null, cited_by: 'model', verified: false }]);
      expect(f.llm.findings[2].confidence).toBe('low');
      expect(s.body).toContain('Source cited by the model, not verified: https://vendor.example/legal');
    }
    // Topic confidence is the weakest finding (low here); confidence.json reflects it.
    expect(r.apps[0]!.topicConfidence['vendor-profile']).toBe('low');
    expect(r.apps[0]!.composite).toBe('low');
    expect(r.topicDistribution['breach-history']).toEqual({ high: 0, medium: 0, low: 1, none: 0 });
  });

  it('never rates an LLM topic above medium even when every finding is high', async () => {
    const ws = await scaffoldedWorkspace();
    const high = JSON.stringify({ summary: 's', findings: [{ statement: 'x', confidence: 'high', sources: ['https://a.example/'] }] });
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => high).llm }));
    expect((stub(ws, 'hospacs004', 'certifications')!.front as any).confidence).toBe('medium');
  });

  it('sends only vendor, product, version, and category: no app ID, site, or redaction marker in any prompt', async () => {
    const ws = await scaffoldedWorkspace();
    const m = mockLlm(() => answer);
    await runServiceResearch(opts(ws, { llm: m.llm }));
    expect(m.prompts.length).toBeGreaterThan(0);
    expect(m.prompts.some((p) => p.includes('Vendor: FUJIFILM') && p.includes('Product: PACS Storage'))).toBe(true);
    for (const p of m.prompts) {
      const low = p.toLowerCase();
      for (const banned of ['hospacs004', 'hosapp', 'main site', 'radiologie', '[contact-name-redacted]']) expect(low).not.toContain(banned);
    }
  });

  it('records a malformed answer as skipped (llm_malformed_response) and retries it on the next run', async () => {
    const ws = await scaffoldedWorkspace();
    const bad = mockLlm(() => 'I cannot answer in JSON, sorry.');
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: bad.llm }));
    for (const topic of LLM_TOPICS) {
      const f = stub(ws, 'hospacs004', topic)!.front as any;
      expect(f).toMatchObject({ status: 'skipped', skipped_reason: 'llm_malformed_response', confidence: null, provenance: null });
      expect(f.llm.error).toContain('no JSON object');
      expect(validateStub(topic, f)).toBe(true);
    }
    expect(r.apps[0]!.topicConfidence['vendor-profile']).toBeNull();
    // Wrong shape: valid JSON but no findings array.
    const shape = mockLlm(() => JSON.stringify({ summary: 'x' }));
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: shape.llm }));
    expect(shape.prompts).toHaveLength(4);
    expect((stub(ws, 'hospacs004', 'vendor-profile')!.front as any).llm.error).toContain('findings');
    // The next run with a working model retries and succeeds.
    const good = mockLlm(() => answer);
    const again = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: good.llm }));
    expect(good.prompts).toHaveLength(4);
    expect(again.apps[0]!.topics['vendor-profile']).toBe('refreshed');
    expect((stub(ws, 'hospacs004', 'vendor-profile')!.front as any).status).toBe('researched');
  });

  it('records a provider error as skipped (llm_error) without failing the other topics or the API topics', async () => {
    const ws = await scaffoldedWorkspace();
    const m = mockLlm((p) => {
      if (p.includes('security incidents')) throw new Error('HTTP 503 from gateway');
      return answer;
    });
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm }));
    expect(stub(ws, 'hospacs004', 'breach-history')!.front).toMatchObject({ status: 'skipped', skipped_reason: 'llm_error' });
    expect(String((stub(ws, 'hospacs004', 'breach-history')!.front as any).llm.error)).toContain('HTTP 503');
    expect(String(stub(ws, 'hospacs004', 'breach-history')!.front['note'])).toContain('the LLM call failed');
    for (const topic of ['vendor-profile', 'certifications', 'data-residency'] as const) {
      expect((stub(ws, 'hospacs004', topic)!.front as any).status).toBe('researched');
    }
    expect((stub(ws, 'hospacs004', 'cve-summary')!.front as any).status).toBe('researched');
    expect(r.apps[0]!.topicConfidence['breach-history']).toBeNull();
  });

  it('keeps a fresh LLM stub unchanged without another call, re-queries with --refresh, and makes no call on a dry run', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => answer).llm }));
    const second = mockLlm(() => answer);
    const r2 = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: second.llm }));
    expect(second.prompts).toHaveLength(0);
    expect(r2.apps[0]!.topics['data-residency']).toBe('unchanged');
    expect(r2.apps[0]!.topicConfidence['data-residency']).toBe('low');
    const dry = mockLlm(() => answer);
    const r3 = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: dry.llm, refresh: true, dryRun: true }));
    expect(dry.prompts).toHaveLength(0);
    expect(r3.apps[0]!.topics['data-residency']).toBe('refreshed');
    const ref = mockLlm(() => answer);
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: ref.llm, refresh: true }));
    expect(ref.prompts).toHaveLength(4);
    // Past the 30-day cache period the topic is researched again without --refresh.
    const late = mockLlm(() => answer);
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: late.llm, now: new Date('2026-11-20T08:00:00Z') }));
    expect(late.prompts).toHaveLength(4);
  });

  it('keeps earlier LLM findings when a later run has no LLM configured', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => answer).llm }));
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', refresh: true }));
    expect(r.apps[0]!.topics['vendor-profile']).toBe('unchanged');
    expect(r.apps[0]!.topicConfidence['vendor-profile']).toBe('low');
    const f = stub(ws, 'hospacs004', 'vendor-profile')!.front as any;
    expect(f).toMatchObject({ status: 'researched', provenance: 'LLM-researched' });
    expect(f.llm.findings).toHaveLength(3);
  });

  it('never calls the LLM for a stub an analyst has reviewed', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004' }));
    const path = join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', 'certifications.md');
    const cur = stub(ws, 'hospacs004', 'certifications')!;
    writeStub(path, { ...cur.front, reviewed_by: 'analyst', reviewed_at: '2026-10-09' }, cur.body, null);
    const m = mockLlm(() => answer);
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm, refresh: true }));
    expect(r.apps[0]!.topics.certifications).toBe('protected');
    expect(m.prompts.some((p) => p.includes('certifications and attestations'))).toBe(false);
    expect(m.prompts).toHaveLength(3);
  });

  it('switches from skipped to researched once an LLM is configured, and reports llm_unavailable when the host could not build one', async () => {
    const ws = await scaffoldedWorkspace();
    const r1 = await runServiceResearch(opts(ws, { appId: 'hospacs004', llmSkipReason: 'llm_unavailable', llmSkipDetail: 'missing API key' }));
    expect(r1.llmSkipReason).toBe('llm_unavailable');
    const f = stub(ws, 'hospacs004', 'vendor-profile')!.front;
    expect(f).toMatchObject({ status: 'skipped', skipped_reason: 'llm_unavailable' });
    expect(String(f['note'])).toContain('could not be used (missing API key)');
    const m = mockLlm(() => answer);
    const r2 = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm }));
    expect(m.prompts).toHaveLength(4);
    expect(r2.apps[0]!.topics['vendor-profile']).toBe('refreshed');
  });

  it('skips an app with nothing to look up (no vendor, no product name) without calling the LLM', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-research-llm-noinput-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const xlsx = join(ws, 'intake.xlsx');
    await writeWorkbook(xlsx, [{ name: 'Sheet1', headers: ['App ID', 'OS'], rows: [['HOSAPP901', null]] }]);
    expect((await runServiceInit({ workspacePath: ws, intakePath: xlsx })).ok).toBe(true);
    const m = mockLlm(() => answer);
    await runServiceResearch(opts(ws, { llm: m.llm }));
    expect(m.prompts).toHaveLength(0);
    const f = stub(ws, 'hosapp901', 'breach-history')!.front;
    expect(f).toMatchObject({ status: 'skipped', skipped_reason: 'no_input', missing_inputs: ['vendor_name', 'product_name'] });
    expect(validateStub('breach-history', f)).toBe(true);
  });
});

// #3304: --skip-llm and RESEARCH signals from LLM findings (Design 103 §6.2.4).
describe('service research --skip-llm and LLM-derived signals (#3304)', () => {
  const LLM_TOPICS = ['vendor-profile', 'certifications', 'data-residency', 'breach-history'] as const;
  const breaches = JSON.stringify({
    summary: 'Two incidents are publicly documented.',
    findings: [
      { statement: '2023 ransomware incident affecting customer imaging data', confidence: 'high', sources: [{ url: 'https://news.example/breach-2023', title: 'Report' }] },
      { statement: '2021 credential leak at a support portal', confidence: 'medium', sources: ['https://cert.example/2021'] },
    ],
  });
  const none = JSON.stringify({ summary: 'Nothing publicly documented.', findings: [] });

  function mockLlm(reply: (prompt: string) => string) {
    const prompts: string[] = [];
    return { prompts, llm: { name: 'mock', model: 'mock-model', complete: async (p: string) => { prompts.push(p); return reply(p); } } };
  }
  const breachSignal = (ws: string) => signalsOf(ws, 'hospacs004').find((s) => s.code === 'VENDOR.BREACH_HISTORY');

  it('skips the four LLM topics with skipped_by_user and makes no LLM call, even with a provider configured', async () => {
    const ws = await scaffoldedWorkspace();
    const m = mockLlm(() => breaches);
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm, skipLlm: true }));
    expect(m.prompts).toHaveLength(0);
    expect(r.llm).toBeNull();
    expect(r.llmSkipReason).toBe('skipped_by_user');
    for (const topic of LLM_TOPICS) {
      const s = stub(ws, 'hospacs004', topic)!;
      expect(s.front).toMatchObject({ status: 'skipped', skipped_reason: 'skipped_by_user', confidence: null, provenance: null });
      expect(String(s.front['note'])).toContain('--skip-llm');
      expect(validateStub(topic, s.front)).toBe(true);
    }
    // The API topics still ran.
    expect((stub(ws, 'hospacs004', 'cve-summary')!.front as any).status).toBe('researched');
    expect(breachSignal(ws)).toBeUndefined();
  });

  it('keeps earlier LLM findings intact under --skip-llm, including with --refresh, and keeps their signal', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => breaches).llm }));
    const before = stub(ws, 'hospacs004', 'breach-history')!;
    const m = mockLlm(() => none);
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm, skipLlm: true, refresh: true }));
    expect(m.prompts).toHaveLength(0);
    for (const topic of LLM_TOPICS) expect(r.apps[0]!.topics[topic]).toBe('unchanged');
    const after = stub(ws, 'hospacs004', 'breach-history')!;
    expect(after.front).toEqual(before.front);
    expect(after.body).toBe(before.body);
    expect(breachSignal(ws)).toBeDefined();
  });

  it('a skipped_by_user stub is researched on the next run without --skip-llm', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', skipLlm: true }));
    const m = mockLlm(() => breaches);
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm }));
    expect(m.prompts).toHaveLength(4);
    expect(r.apps[0]!.topics['breach-history']).toBe('refreshed');
    expect((stub(ws, 'hospacs004', 'breach-history')!.front as any).status).toBe('researched');
  });

  it('emits VENDOR.BREACH_HISTORY (RES-09) from breach findings: medium at most, llm_inference, model-cited and unverified', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm((p) => (p.includes('security incidents') ? breaches : none)).llm }));
    const s = breachSignal(ws)!;
    expect(s).toMatchObject({ id: 'RES-09', code: 'VENDOR.BREACH_HISTORY', source: 'llm_inference', assessor: 'llm', severity: 'medium', confidence: 'medium', outcome: 'negative', category: 'application' });
    expect(s.legacy_tier).toBeUndefined();
    expect(s.derivation).toContain('2 publicly reported');
    expect(s.derivation).toContain('unverified');
    expect(s.derivation).toContain('mock / mock-model');
    expect(s.evidence).toEqual([
      'wsp/inputs/research/breach-history.md',
      'https://news.example/breach-2023 (cited by the model, not verified)',
      'https://cert.example/2021 (cited by the model, not verified)',
    ]);
    // Only breach-history yields an LLM signal here: the other answers carry no structured facts (#3308).
    expect(signalsOf(ws, 'hospacs004').filter((x) => x.source === 'llm_inference')).toHaveLength(1);
  });

  it('caps confidence at medium even for a hand-edited high stub, and drops to low with an unsourced finding', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => breaches).llm }));
    const path = join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', 'breach-history.md');
    const cur = stub(ws, 'hospacs004', 'breach-history')!;
    const f = cur.front as any;
    writeStub(path, { ...f, confidence: 'high', llm: { ...f.llm, confidence: 'high', findings: f.llm.findings.map((x: any) => ({ ...x, confidence: 'high' })) } }, cur.body, null);
    await runServiceResearch(opts(ws, { appId: 'hospacs004', skipLlm: true }));
    expect(breachSignal(ws)!.confidence).toBe('medium');

    const ws2 = await scaffoldedWorkspace();
    const unsourced = JSON.stringify({ summary: 's', findings: [{ statement: 'A 2022 breach was reported in the press', confidence: 'high', sources: [] }] });
    await runServiceResearch(opts(ws2, { appId: 'hospacs004', llm: mockLlm(() => unsourced).llm }));
    const s2 = breachSignal(ws2)!;
    expect(s2.confidence).toBe('low');
    expect(s2.evidence).toEqual(['wsp/inputs/research/breach-history.md']);
  });

  it('emits no breach signal for an empty answer, a "no breaches" finding, a failed call, or a skipped topic', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => none).llm }));
    expect(breachSignal(ws)).toBeUndefined();

    const ws2 = await scaffoldedWorkspace();
    const negative = JSON.stringify({ summary: 's', findings: [
      { statement: 'No publicly documented data breaches affecting this product were found.', confidence: 'medium', sources: ['https://vendor.example/security'] },
      { statement: 'There have been no GDPR enforcement actions against the vendor.', confidence: 'low', sources: [] },
    ] });
    await runServiceResearch(opts(ws2, { appId: 'hospacs004', llm: mockLlm(() => negative).llm }));
    expect(breachSignal(ws2)).toBeUndefined();
    // An incident phrased with "No ..." is still an incident.
    const ws4 = await scaffoldedWorkspace();
    const phrased = JSON.stringify({ summary: 's', findings: [
      { statement: 'No customer data was affected in the 2023 ransomware incident at the vendor.', confidence: 'medium', sources: ['https://news.example/2023'] },
    ] });
    await runServiceResearch(opts(ws4, { appId: 'hospacs004', llm: mockLlm(() => phrased).llm }));
    expect(breachSignal(ws4)?.derivation).toContain('1 publicly reported');

    const ws3 = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws3, { appId: 'hospacs004', llm: mockLlm(() => { throw new Error('HTTP 503'); }).llm }));
    expect(breachSignal(ws3)).toBeUndefined();
  });

  it('emits no signal above medium and none with a legacy tier from any LLM topic', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(() => breaches).llm }));
    for (const s of signalsOf(ws, 'hospacs004').filter((x) => x.source === 'llm_inference')) {
      expect(['medium', 'low', 'informational']).toContain(s.severity);
      expect(['medium', 'low']).toContain(s.confidence);
      expect(s.legacy_tier).toBeUndefined();
    }
  });
});

// #3308: prompt version 1.1 structured facts and the five remaining §6.2.4 signals.
describe('structured facts and the five remaining LLM signals (#3308)', () => {
  const FACT_CODES = ['VENDOR.PATCH_CADENCE_SLOW', 'DATA.NO_EU_ENTITY', 'DATA.GDPR_ART9_NO_DPA', 'MDR.CLASS_UNCLEAR', 'MDR.NOT_REGISTERED_BFARM'] as const;
  type Facts = Record<string, unknown>;
  const topicOf = (p: string): string =>
    p.includes('Describe the vendor') ? 'vendor-profile'
      : p.includes('List the security') ? 'certifications'
        : p.includes('Describe where this product') ? 'data-residency' : 'breach-history';
  const finding = { statement: 'A statement', confidence: 'high', sources: ['https://vendor.example/a'] };
  /** Mocked provider answering each topic with `facts[topic]` (omitted when undefined). */
  function mockLlm(facts: Partial<Record<string, unknown>>, opts: { fail?: boolean } = {}) {
    const prompts: string[] = [];
    return {
      prompts,
      llm: {
        name: 'mock', model: 'mock-model',
        complete: async (p: string) => {
          prompts.push(p);
          if (opts.fail) throw new Error('HTTP 503');
          const f = facts[topicOf(p)];
          return JSON.stringify({ summary: 's', ...(f !== undefined ? { facts: f } : {}), findings: topicOf(p) === 'breach-history' ? [] : [finding] });
        },
      },
    };
  }
  const SRC = ['https://vendor.example/facts'];
  const allFive: Record<string, Facts> = {
    'vendor-profile': { eu_entity: 'no', patch_cadence_days_estimate: 120, sources: SRC },
    certifications: { mdr_class: 'class_not_published', bfarm_listed: 'no', sources: SRC },
    'data-residency': { gdpr_dpa_available: 'no', sources: SRC },
  };
  const factSignals = (ws: string) => signalsOf(ws, 'hospacs004').filter((s) => (FACT_CODES as readonly string[]).includes(s.code));
  const codes = (ws: string) => factSignals(ws).map((s) => s.code).sort();

  /** Rewrites the regulatory context of hospacs004 (`data` block of its .swao.yml). */
  function setAppData(ws: string, data: Record<string, unknown>) {
    const p = join(ws, 'apps', 'hospacs004', '.swao.yml');
    const doc = load(readFileSync(p, 'utf-8')) as Record<string, any>;
    doc['data'] = { ...(doc['data'] ?? {}), ...data };
    writeFileSync(p, dump(doc), 'utf-8');
  }

  it('asks for a facts block in three topics and none in breach-history, sending only vendor, product, version, and category', async () => {
    const ws = await scaffoldedWorkspace();
    const m = mockLlm({});
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: m.llm }));
    expect(m.prompts).toHaveLength(4);
    const byTopic = Object.fromEntries(m.prompts.map((p) => [topicOf(p), p]));
    expect(byTopic['vendor-profile']).toContain('"eu_entity": "yes" | "no" | "unknown"');
    expect(byTopic['vendor-profile']).toContain('"patch_cadence_days_estimate": number | null');
    expect(byTopic['certifications']).toContain('"mdr_class":');
    expect(byTopic['certifications']).toContain('"bfarm_listed":');
    expect(byTopic['data-residency']).toContain('"gdpr_dpa_available":');
    expect(byTopic['breach-history']).not.toContain('"facts"');
    for (const p of m.prompts) {
      const low = p.toLowerCase();
      // The regulatory context gates signals only; it never reaches a prompt.
      for (const banned of ['hospacs004', 'main site', 'gdpr_art9', 'health_data', 'mdr, gdpr']) expect(low).not.toContain(banned);
    }
  });

  it('emits all five signals from explicit facts: medium, llm_inference, model-cited, unverified, never a blocker', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(allFive).llm }));
    const sig = factSignals(ws);
    expect(sig.map((s) => [s.id, s.code]).sort()).toEqual([
      ['RES-10', 'VENDOR.PATCH_CADENCE_SLOW'], ['RES-11', 'DATA.NO_EU_ENTITY'], ['RES-12', 'DATA.GDPR_ART9_NO_DPA'],
      ['RES-13', 'MDR.CLASS_UNCLEAR'], ['RES-14', 'MDR.NOT_REGISTERED_BFARM'],
    ]);
    for (const s of sig) {
      expect(s).toMatchObject({ source: 'llm_inference', assessor: 'llm', severity: 'medium', confidence: 'medium', outcome: 'negative', category: 'application' });
      expect(s.legacy_tier).toBeUndefined();
      expect(s.derivation).toContain('mock / mock-model (prompt 1.1-2026-10-18)');
      expect(s.derivation).toContain('unverified');
      expect(s.evidence[1]).toBe('https://vendor.example/facts (cited by the model, not verified)');
    }
    const by = (c: string) => sig.find((s) => s.code === c)!;
    expect(by('VENDOR.PATCH_CADENCE_SLOW').derivation).toContain('120 days');
    expect(by('VENDOR.PATCH_CADENCE_SLOW').evidence[0]).toBe('wsp/inputs/research/vendor-profile.md');
    expect(by('DATA.NO_EU_ENTITY').evidence[0]).toBe('wsp/inputs/research/vendor-profile.md');
    expect(by('DATA.GDPR_ART9_NO_DPA').evidence[0]).toBe('wsp/inputs/research/data-residency.md');
    expect(by('MDR.CLASS_UNCLEAR').evidence[0]).toBe('wsp/inputs/research/certifications.md');
    expect(by('MDR.NOT_REGISTERED_BFARM').evidence[0]).toBe('wsp/inputs/research/certifications.md');
    // The facts are stored in the stub front-matter and shown in the body for review.
    const vp = stub(ws, 'hospacs004', 'vendor-profile')!;
    expect(validateStub('vendor-profile', vp.front)).toBe(true);
    expect((vp.front as any).llm.facts).toEqual({
      eu_entity: 'no', patch_cadence_days_estimate: 120,
      sources: [{ url: 'https://vendor.example/facts', title: null, cited_by: 'model', verified: false }],
    });
    expect(vp.body).toContain('Structured facts stated by the model (unverified): eu_entity: no; patch_cadence_days_estimate: 120.');
    expect((stub(ws, 'hospacs004', 'breach-history')!.front as any).llm.facts).toBeUndefined();
    // Derived from the stubs, so a later --skip-llm run keeps them.
    await runServiceResearch(opts(ws, { appId: 'hospacs004', skipLlm: true }));
    expect(factSignals(ws)).toHaveLength(5);
  });

  it('rates a fact signal low when the facts cite no source', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm({ 'vendor-profile': { patch_cadence_days_estimate: '180' } }).llm }));
    const sig = factSignals(ws);
    expect(sig.map((s) => s.code)).toEqual(['VENDOR.PATCH_CADENCE_SLOW']);
    expect(sig[0]!.confidence).toBe('low');
    expect(sig[0]!.evidence).toEqual(['wsp/inputs/research/vendor-profile.md']);
  });

  it('gates EU entity, DPA, and BfArM on the app regulatory context; patch cadence and MDR class do not depend on it', async () => {
    const ws = await scaffoldedWorkspace();
    setAppData(ws, { regulatory: null, health_data: false, gdpr_art9: false });
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(allFive).llm }));
    expect(codes(ws)).toEqual(['MDR.CLASS_UNCLEAR', 'VENDOR.PATCH_CADENCE_SLOW']);

    // Health data alone (no regulatory list) is enough for the DPA signal; GDPR_ART9 in the list for the EU entity.
    const ws2 = await scaffoldedWorkspace();
    setAppData(ws2, { regulatory: ['GDPR_ART9'], health_data: true, gdpr_art9: null });
    await runServiceResearch(opts(ws2, { appId: 'hospacs004', llm: mockLlm(allFive).llm }));
    expect(codes(ws2)).toEqual(['DATA.GDPR_ART9_NO_DPA', 'DATA.NO_EU_ENTITY', 'MDR.CLASS_UNCLEAR', 'VENDOR.PATCH_CADENCE_SLOW']);

    // Not a medical device: no BfArM signal even with MDR in scope.
    const ws3 = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws3, { appId: 'hospacs004', llm: mockLlm({ certifications: { mdr_class: 'not_a_medical_device', bfarm_listed: 'no' } }).llm }));
    expect(codes(ws3)).toEqual([]);
  });

  it('emits nothing for a version 1.0 answer without facts, unknown values, positive answers, or a cadence of 90 days', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm({}).llm }));
    expect(codes(ws)).toEqual([]);
    expect((stub(ws, 'hospacs004', 'vendor-profile')!.front as any).llm.facts).toBeUndefined();

    const unknowns = {
      'vendor-profile': { eu_entity: 'unknown', patch_cadence_days_estimate: null, sources: SRC },
      certifications: { mdr_class: 'unknown', bfarm_listed: 'unknown', sources: SRC },
      'data-residency': { gdpr_dpa_available: 'unknown', sources: SRC },
    };
    const ws2 = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws2, { appId: 'hospacs004', llm: mockLlm(unknowns).llm }));
    expect(codes(ws2)).toEqual([]);

    const positive = {
      'vendor-profile': { eu_entity: 'yes', patch_cadence_days_estimate: 90, sources: SRC },
      certifications: { mdr_class: 'IIa', bfarm_listed: 'yes', sources: SRC },
      'data-residency': { gdpr_dpa_available: 'yes', sources: SRC },
    };
    const ws3 = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws3, { appId: 'hospacs004', llm: mockLlm(positive).llm }));
    expect(codes(ws3)).toEqual([]);
  });

  it('treats a malformed facts block as unknown: the topic stays researched and emits nothing', async () => {
    const garbage = {
      'vendor-profile': { eu_entity: 42, patch_cadence_days_estimate: 'slow', sources: 'not a list' },
      certifications: 'n/a',
      'data-residency': [{ gdpr_dpa_available: 'no' }],
    };
    const ws = await scaffoldedWorkspace();
    const r = await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(garbage).llm }));
    for (const topic of ['vendor-profile', 'certifications', 'data-residency'] as const) {
      const s = stub(ws, 'hospacs004', topic)!;
      expect((s.front as any).status).toBe('researched');
      expect(validateStub(topic, s.front)).toBe(true);
    }
    expect(r.apps[0]!.topics['vendor-profile']).toBe('created');
    expect((stub(ws, 'hospacs004', 'vendor-profile')!.front as any).llm.facts).toEqual({ eu_entity: 'unknown', patch_cadence_days_estimate: null });
    expect(codes(ws)).toEqual([]);
  });

  it('keeps a version 1.0 stub valid and silent, and emits nothing for a failed call or skipped topics', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { appId: 'hospacs004', llm: mockLlm(allFive).llm }));
    expect(factSignals(ws)).toHaveLength(5);
    // Rewrite every LLM stub as a version 1.0 stub: no facts block, older prompt version.
    for (const topic of ['vendor-profile', 'certifications', 'data-residency'] as const) {
      const path = join(ws, 'apps', 'hospacs004', 'wsp', 'inputs', 'research', `${topic}.md`);
      const cur = stub(ws, 'hospacs004', topic)!;
      const { facts: _facts, ...llm } = (cur.front as any).llm;
      const front = { ...cur.front, llm: { ...llm, prompt_version: '1.0-2026-10-18' } };
      expect(validateStub(topic, front)).toBe(true);
      writeStub(path, front, cur.body, null);
    }
    await runServiceResearch(opts(ws, { appId: 'hospacs004', skipLlm: true }));
    expect(codes(ws)).toEqual([]);

    const ws2 = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws2, { appId: 'hospacs004', llm: mockLlm(allFive, { fail: true }).llm }));
    expect(codes(ws2)).toEqual([]);

    const ws3 = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws3, { appId: 'hospacs004', llm: mockLlm(allFive).llm, skipLlm: true }));
    expect(codes(ws3)).toEqual([]);
    await runServiceResearch(opts(ws3, { appId: 'hospacs004' }));
    expect(codes(ws3)).toEqual([]);
  });
});
