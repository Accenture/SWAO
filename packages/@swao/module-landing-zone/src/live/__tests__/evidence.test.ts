// #3956 (Design 123 section 9.5): the evidence map of a live run and
// `swao lz evidence` on the OTC mock. Synthetic fixtures only (mock CSP);
// live acceptance is recorded in the issue.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, LZ_EVIDENCE_MAP_FILE, LzEvidenceMapSchema, LzLiveScanSchema, isLzConsoleLinkUrl } from '@swao/core';
import { runLzLiveAssessment } from '../assess.js';
import { lzEvidenceAction } from '../cli.js';
import { openLzConsoleLink, writeLzEvidenceMap } from '../evidence.js';
import { formatLzHierarchy, runLzHierarchy } from '../hierarchy-view.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../builtin.js';
import { unregisterLiveLzDriver } from '../registry.js';
import { READONLY_ROLE, makeOtcMock } from '../otc/__tests__/otc-mock.js';

const META = 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n';
const CONTROLS = 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n';
const MAPPING = 'schema_version: "0.1"\nframework: BSI_C5\nmappings:\n  - capability: vm_compute\n    controls: [OPS-01]\n    relevance: configure\n    confidence: curated\n';
const RUN = '2026-11-06T08-00-00';

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
beforeEach(() => { unregisterLiveLzDriver(); registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' }); });
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function assessed(): Promise<{ ws: string; store: CredentialStore; runDir: string }> {
  const ws = tempDir('swao-lzl-evidence-');
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '        regions: [eu-de, eu-nl]', ''].join('\n'));
  const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'framework-meta.yaml'), META);
  writeFileSync(join(dir, 'controls.yaml'), CONTROLS);
  writeFileSync(join(dir, 'service-controls.yaml'), MAPPING);
  const store = new CredentialStore(tempDir('swao-lzl-evidence-vault-'));
  await store.set('lz:otc-test:platform:username', 'mock-user');
  await store.set('lz:otc-test:platform:password', 'mock-pass-value');
  await store.set('lz:otc-test:platform:domain', 'MOCK-DOMAIN');
  const mock = makeOtcMock({ roles: [READONLY_ROLE] });
  const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: () => new Date('2026-11-06T08:00:00Z') });
  expect(out.status).toBe('complete');
  return { ws, store, runDir: out.runDir };
}

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: (cwd: string) => ({ cwd, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } }) };
};

/** Every provider id of the scan (resources, posture, nodes, guardrails). */
function nativeIds(runDir: string): string[] {
  const scan = LzLiveScanSchema.parse(JSON.parse(readFileSync(join(runDir, 'otc-test.platform.lz-live-scan.json'), 'utf-8')));
  const e = scan.estate;
  const p = e.posture;
  return [
    ...e.resources.map((r) => r.id),
    ...(e.hierarchy?.nodes ?? []).map((n) => n.id),
    ...e.guardrails.flatMap((g) => (g.id ? [g.id] : [])),
    ...[...(p?.encryption?.items ?? []), ...(p?.exposure?.items ?? []), ...(p?.ingress_rules?.items ?? []), ...(p?.backup?.items ?? [])].map((i) => i.resource_id),
    ...(p?.logging?.trails ?? []).flatMap((t) => (t.resource_id ? [t.resource_id] : [])),
  ].filter((id) => id.length >= 6);
}

describe('evidence map writer (#3956)', () => {
  it('writes evidence-refs.json next to the scans; references carry no native id', async () => {
    const { runDir } = await assessed();
    const map = LzEvidenceMapSchema.parse(JSON.parse(readFileSync(join(runDir, LZ_EVIDENCE_MAP_FILE), 'utf-8')));
    expect(map).toMatchObject({ lz_id: 'otc-test', provider: 'otc', run_id: RUN });
    expect(map.entries.length).toBeGreaterThan(0);
    const ids = nativeIds(runDir);
    expect(ids.length).toBeGreaterThan(0);
    for (const e of map.entries) for (const id of ids) expect(e.ref).not.toContain(id);
    for (const e of map.entries) if (e.console) expect(isLzConsoleLinkUrl(e.console.url)).toBe(true);
  }, 30_000);

  it('never throws: a run without a writable map stays valid', async () => {
    const out = await writeLzEvidenceMap({ runDir: tempDir('swao-ev-x-'), runId: '../escape', lzId: 'otc-test', provider: 'otc', scans: [], store: new CredentialStore(tempDir('swao-ev-v-')) });
    expect(out.ok).toBe(false);
  });
});

describe('swao lz evidence (#3956)', () => {
  it('lists the references of the latest run without native ids, and resolves one with the native id and the console link', async () => {
    const { ws, runDir } = await assessed();
    const l = io();
    expect(lzEvidenceAction(undefined, { lz: 'otc-test' }, l.deps(ws))).toBe(0);
    expect(l.out[0]).toMatch(/^landing zone otc-test, run 2026-11-06T08-00-00: \d+ evidence reference/);
    const listing = l.out.join('\n');
    for (const id of nativeIds(runDir)) expect(listing).not.toContain(id);

    const map = LzEvidenceMapSchema.parse(JSON.parse(readFileSync(join(runDir, LZ_EVIDENCE_MAP_FILE), 'utf-8')));
    const withId = map.entries.find((e) => e.native.id !== undefined)!;
    const r = io();
    expect(lzEvidenceAction(withId.ref, {}, r.deps(ws))).toBe(0);
    expect(r.out.join('\n')).toContain(`native id: ${withId.native.id}`);
    expect(r.out.join('\n')).toContain('console: https://console.otc.t-systems.com/');
    expect(r.out.join('\n')).toContain('link pattern source: https://www.t-cloud-public.com/en/support/first-steps');
  }, 30_000);

  it('--open opens only the allowlisted console link', async () => {
    const { ws, runDir } = await assessed();
    const map = LzEvidenceMapSchema.parse(JSON.parse(readFileSync(join(runDir, LZ_EVIDENCE_MAP_FILE), 'utf-8')));
    const opened: string[] = [];
    const r = io();
    expect(lzEvidenceAction(map.entries[0]!.ref, { open: true, openLink: (u) => { opened.push(u); return true; } }, r.deps(ws))).toBe(0);
    expect(opened).toEqual(['https://console.otc.t-systems.com/']);
    const spawned: unknown[] = [];
    const fake = ((cmd: string, args: string[]) => { spawned.push([cmd, args]); return { unref: () => undefined }; }) as unknown as typeof import('node:child_process').spawn;
    expect(openLzConsoleLink('https://evil.example/?a=1&b=2', fake)).toBe(false);
    expect(spawned).toEqual([]);
    expect(openLzConsoleLink('https://console.otc.t-systems.com/', fake)).toBe(true);
    expect(JSON.stringify(spawned)).toContain('https://console.otc.t-systems.com/');
  }, 30_000);

  it('exits 2 for a malformed, unknown or foreign-run reference', async () => {
    const { ws, runDir } = await assessed();
    const map = LzEvidenceMapSchema.parse(JSON.parse(readFileSync(join(runDir, LZ_EVIDENCE_MAP_FILE), 'utf-8')));
    const ref = map.entries[0]!.ref;
    for (const bad of ['nonsense', `ev:${RUN}:resource:Ref-0000000000`, ref.replace(RUN, '2025-01-01T00-00-00')]) {
      const r = io();
      expect(lzEvidenceAction(bad, {}, r.deps(ws))).toBe(2);
      expect(r.err.join('\n')).toMatch(/\[lz live\] /);
    }
    // A reference from another workspace's run of the same name does not resolve here.
    const other = await assessed();
    const r = io();
    // Same run name, other vault salt: the label differs, so the reference is foreign there.
    expect(lzEvidenceAction(ref, {}, r.deps(other.ws))).toBe(2);
    expect(r.err.join('\n')).toContain('is not in the evidence map of run');
    const l = io();
    expect(lzEvidenceAction(undefined, {}, l.deps(ws))).toBe(1);
    expect(lzEvidenceAction(undefined, { lz: 'otc-test', run: '2020-01-01T00-00-00' }, l.deps(ws))).toBe(2);
  }, 60_000);

  it('resolves from an explicit run folder (swao lz scan --out) and refuses a reference of another run there', async () => {
    const { ws, runDir } = await assessed();
    const copy = join(tempDir('swao-ev-copy-'), RUN);
    cpSync(runDir, copy, { recursive: true });
    const map = LzEvidenceMapSchema.parse(JSON.parse(readFileSync(join(copy, LZ_EVIDENCE_MAP_FILE), 'utf-8')));
    const r = io();
    expect(lzEvidenceAction(map.entries[0]!.ref, { runDir: copy }, r.deps(ws))).toBe(0);
    expect(lzEvidenceAction(map.entries[0]!.ref.replace(RUN, '2025-01-01T00-00-00'), { runDir: copy }, r.deps(ws))).toBe(2);
  }, 30_000);

  it('swao lz hierarchy shows the node references (TUI and CLI parity)', async () => {
    const { ws, store, runDir } = await assessed();
    // The OTC mock lists no tenant tree: give the stored scan one, drop the merged view, rebuild the map.
    const file = join(runDir, 'otc-test.platform.lz-live-scan.json');
    const scan = JSON.parse(readFileSync(file, 'utf-8')) as { estate: Record<string, unknown> };
    const DOMAIN = ['dom', 'bait', '0001'].join('-');
    const PROJECT = ['prj', 'bait', '0002'].join('-');
    scan.estate['hierarchy'] = { nodes: [
      { id: DOMAIN, kind: 'organisation', native_kind: 'otc:domain', label: 'Node-1111111111' },
      { id: PROJECT, kind: 'project', native_kind: 'otc:region-project', parent: DOMAIN, label: 'Node-2222222222' },
    ], source: { calls: ['x'] }, scope_node: PROJECT };
    const parsed = LzLiveScanSchema.parse(scan);
    writeFileSync(file, JSON.stringify(parsed));
    rmSync(join(runDir, 'lz-live-merged.yaml'));
    expect((await writeLzEvidenceMap({ runDir, runId: RUN, lzId: 'otc-test', provider: 'otc', scans: [parsed], store })).ok).toBe(true);
    const lines = formatLzHierarchy(runLzHierarchy({ workspaceRoot: ws, lzId: 'otc-test' }));
    expect(lines.join('\n')).not.toContain(DOMAIN);
    expect(lines.join('\n')).not.toContain(PROJECT);
    expect(lines.some((l) => l.includes('node(s):'))).toBe(true);
    expect(lines.join('\n')).toMatch(/ev:2026-11-06T08-00-00:hierarchy:Ref-[0-9a-f]{10}/);
  }, 30_000);
});
