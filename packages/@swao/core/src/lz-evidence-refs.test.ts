// #3956 (Design 123 section 9.5): evidence references and the local evidence
// map. Synthetic AWS-shaped scan with native-looking ids of every kind; the
// references must carry none of them, the map must resolve every one.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LZ_EVIDENCE_KINDS, LZ_EVIDENCE_MAP_FILE, LzEvidenceMapSchema, LzEvidenceRefError, buildLzEvidenceMap, lzEvidenceKindsForPolicy,
  lzEvidencePublicIndex, parseLzEvidenceRef, readLzEvidenceMap, resolveLzEvidenceRef,
} from './lz-evidence-refs.js';
import { isLzConsoleLinkUrl, lzConsoleLink } from './lz-console-links.js';
import { POLICY_KINDS } from './policy-baseline.js';
import { deriveLzScanBaseFields, parseLzLiveScan } from './lz-live-scan.js';
import type { LzLiveScan } from './lz-live-scan.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const ACCOUNT = '123456789012';
const IDS = {
  sg: 'sg-0a1b2c3d4e5f60718',
  key: `arn:aws:kms:eu-central-1:${ACCOUNT}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
  bucket: 'arn:aws:s3:::bait-bucket-name',
  vol: 'vol-0123456789abcdef0',
  eip: 'eipalloc-0123456789abcdef0',
  table: `arn:aws:dynamodb:eu-central-1:${ACCOUNT}:table/bait-table`,
  plan: 'plan-bait-0001-aaaa',
  trail: `arn:aws:cloudtrail:eu-central-1:${ACCOUNT}:trail/bait-trail`,
  org: 'o-abcdefghij',
  root: 'r-ab12',
  ou: 'ou-ab12-cdefghij',
  scp: 'p-abcdefgh12',
  account: ACCOUNT,
  budget: `arn:aws:budgets::${ACCOUNT}:budget/bait-budget`,
};
const RUN = '2026-11-06T08-00-00';
const SALT = 'a'.repeat(64);

function evidenceScan(): LzLiveScan {
  const meta = {
    lz_id: 'aws-test', provider: 'aws', scope_id: 'platform', scope_kind: 'platform' as const, observed_at: '2026-11-06T08:00:00Z',
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
  };
  const src = { calls: ['x'] };
  const estate = {
    resources: [
      { id: IDS.bucket, type: 's3.bucket', service_code: 's3', region: 'eu-central-1' },
      { id: IDS.table, type: 'dynamodb.table', service_code: 'dynamodb', region: 'eu-central-1' },
    ],
    workloads: [], quotas: [],
    guardrails: [
      { type: 'aws-scp', id: IDS.scp, status: 'pass' as const, detail: 'customer managed' },
      { type: 'cloudtrail-trail', id: IDS.trail, status: 'pass' as const },
      { type: 'config-recorder', id: 'eu-central-1/default', status: 'fail' as const, detail: 'recording off' },
    ],
    checks: [
      { id: 'CPB-NET-01', title: 'No open admin ingress', status: 'fail' as const, controls: ['CPB-NET-01'], detail: '1 rule open', node_id: IDS.account },
      { id: 'CPB-LOG-01', title: 'Audit trail', status: 'pass' as const, controls: ['CPB-LOG-01'] },
      { id: 'LZ-CAT-01', title: 'Catalogue check', status: 'warn' as const, controls: [] },
    ],
    posture: {
      encryption: { source: src, items: [{ resource_id: IDS.vol, type: 'ec2.volume', region: 'eu-central-1', layer: 'at_rest' as const, encrypted: true, key_custody: 'customer-managed' as const, key_id: IDS.key }] },
      exposure: { source: src, items: [{ resource_id: IDS.eip, type: 'ec2.elastic-ip', region: 'eu-central-1', exposure: 'public_ip' as const, public: true, bound_to: IDS.vol }] },
      ingress_rules: { source: src, items: [
        { resource_id: IDS.sg, type: 'ec2.security-group', region: 'eu-central-1', protocol: 'tcp', port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0' },
        { resource_id: IDS.sg, type: 'ec2.security-group', region: 'eu-central-1', protocol: 'tcp', port_from: 443, port_to: 443, remote_cidr: '0.0.0.0/0' },
      ] },
      backup: { source: src, items: [{ resource_id: IDS.table, type: 'dynamodb.table', region: 'eu-central-1', protected: true, policy_id: IDS.plan, retention_days: 35 }] },
      budgets: { source: src, items: [{ resource_id: IDS.budget, type: 'budgets.budget', budget_kind: 'cost' as const, period: 'monthly' as const, alerts: [{ threshold: 80, threshold_type: 'percentage' as const, basis: 'actual' as const }] }] },
      identity: { source: src, privileged_principals: 3, privileged_without_mfa: 1, credentials: [] },
      logging: { source: src, trails: [{ resource_id: IDS.trail, region: 'eu-central-1', enabled: true, all_regions: true }] },
    },
    hierarchy: {
      nodes: [
        { id: IDS.org, kind: 'organisation' as const, native_kind: 'aws:organization' },
        { id: IDS.root, kind: 'root' as const, native_kind: 'aws:root', parent: IDS.org },
        { id: IDS.ou, kind: 'folder' as const, native_kind: 'aws:ou', parent: IDS.root, label: 'Node-1111111111' },
        { id: IDS.account, kind: 'account' as const, native_kind: 'aws:account', parent: IDS.ou, label: 'Node-1111111111' },
      ],
      source: src,
      scope_node: IDS.account,
    },
  };
  const offering = { regions: [], services: [{ code: 'ec2', name: 'EC2', capability_tags: [], regions: { 'eu-central-1': { status: 'enabled' as const, evidence: [{ source: 'api' as const, ref: 'ec2:DescribeRegions' }], observed_at: '2026-11-06T08:00:00Z' } }, frameworks: {} }] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

function evidenceMap(salt = SALT, run = RUN) {
  return buildLzEvidenceMap({
    runId: run, lzId: 'aws-test', provider: 'aws', scans: [evidenceScan()], salt, generatedAt: '2026-11-06T08:01:00Z',
    policyKinds: new Map([['CPB-NET-01', 'no_open_admin_ingress'], ['CPB-LOG-01', 'audit_trail']]),
    documents: [{ source: 'policies/ict_risk_management_framework.pdf', category: 'compliance' }],
  });
}

describe('#3956 evidence references', () => {
  it('gives every finding kind a reference that carries no native id', () => {
    const map = evidenceMap();
    const kinds = new Set(map.entries.map((e) => e.kind));
    for (const k of LZ_EVIDENCE_KINDS) expect(kinds.has(k)).toBe(true);
    for (const e of map.entries) {
      expect(e.ref).toMatch(/^ev:2026-11-06T08-00-00:.+:Ref-[0-9a-f]{10}$/);
      for (const id of Object.values(IDS)) expect(e.ref).not.toContain(id);
    }
    expect(new Set(map.entries.map((e) => e.ref)).size).toBe(map.entries.length);
    // Two ingress rules of one security group are two references; two nodes with one label too.
    expect(map.entries.filter((e) => e.kind === 'ingress_rule')).toHaveLength(2);
    expect(map.entries.filter((e) => e.kind === 'hierarchy_node')).toHaveLength(4);
  });

  it('is stable for the same salt and unlinkable across salts', () => {
    expect(evidenceMap().entries.map((e) => e.ref)).toEqual(evidenceMap().entries.map((e) => e.ref));
    const other = new Set(evidenceMap('b'.repeat(64)).entries.map((e) => e.ref.split(':').pop()));
    for (const e of evidenceMap().entries) expect(other.has(e.ref.split(':').pop())).toBe(false);
    expect(() => buildLzEvidenceMap({ runId: RUN, lzId: 'aws-test', provider: 'aws', scans: [], salt: '' })).toThrow(/salt/);
  });

  it('keeps the native reference in the map and links a check to the blocks it reads', () => {
    const map = evidenceMap();
    const rule = map.entries.find((e) => e.kind === 'ingress_rule' && e.native.setting?.includes(' 22-22 '));
    expect(rule?.native).toMatchObject({ id: IDS.sg, region: 'eu-central-1', scope_node: IDS.account, setting: 'inbound allow tcp 22-22 from 0.0.0.0/0' });
    expect(map.entries.find((e) => e.kind === 'encryption')?.native.related_ids).toEqual({ key: IDS.key });
    expect(map.entries.find((e) => e.kind === 'backup')?.native.related_ids).toEqual({ policy: IDS.plan });
    const net = map.entries.find((e) => e.kind === 'check' && e.subject === 'CPB-NET-01');
    expect(net?.related).toEqual(map.entries.filter((e) => e.kind === 'ingress_rule').map((e) => e.ref));
    expect(net?.native).toMatchObject({ id: IDS.account, node_label: 'Node-1111111111', type: 'no_open_admin_ingress' });
    const log = map.entries.find((e) => e.subject === 'CPB-LOG-01');
    expect(log?.related.length).toBe(1 + 3); // one trail, three guardrails
    expect(map.entries.find((e) => e.subject === 'LZ-CAT-01')?.related).toEqual([]);
  });

  it('every policy kind maps to evidence kinds (exhaustive)', () => {
    for (const k of POLICY_KINDS) expect(Array.isArray(lzEvidenceKindsForPolicy(k))).toBe(true);
    expect(lzEvidenceKindsForPolicy('no_open_admin_ingress')).toEqual(['ingress_rule']);
    expect(lzEvidenceKindsForPolicy('budget_alerts')).toEqual(['budget']);
  });

  it('console links come from documented pages only and never carry an id', () => {
    const map = evidenceMap();
    for (const e of map.entries) {
      if (!e.console) continue;
      expect(isLzConsoleLinkUrl(e.console.url)).toBe(true);
      expect(e.console.precision).not.toBe('resource');
      for (const id of Object.values(IDS)) expect(e.console.url).not.toContain(id);
      expect(e.console.doc).toMatch(/^https:\/\/(docs\.aws\.amazon\.com|learn\.microsoft\.com|www\.t-cloud-public\.com|docs\.stackit\.cloud)\//);
    }
    expect(map.entries.find((e) => e.kind === 'ingress_rule')?.console?.url).toBe('https://console.aws.amazon.com/ec2/');
    expect(map.entries.find((e) => e.kind === 'guardrail' && e.native.type === 'aws-scp')?.console?.url).toBe('https://console.aws.amazon.com/organizations/v2/home/policies');
    expect(lzConsoleLink({ provider: 'aws', kind: 'resource', type: 'lambda.function', region: 'eu-central-1' })?.url).toBe('https://eu-central-1.console.aws.amazon.com/');
    expect(lzConsoleLink({ provider: 'aws', kind: 'resource', type: 'lambda.function' })).toBeUndefined();
    expect(lzConsoleLink({ provider: 'otc', kind: 'resource' })?.url).toBe('https://console.otc.t-systems.com/');
    expect(lzConsoleLink({ provider: 'stackit', kind: 'resource' })?.url).toBe('https://portal.stackit.cloud/');
    expect(lzConsoleLink({ provider: 'azure', kind: 'resource' })?.url).toBe('https://portal.azure.com/');
    expect(lzConsoleLink({ provider: 'gcp', kind: 'resource' })).toBeUndefined();
    expect(isLzConsoleLinkUrl('https://evil.example/')).toBe(false);
    expect(isLzConsoleLinkUrl('https://us-gov-west-1.console.aws.amazon.com/')).toBe(false);
  });

  it('parses a reference from both ends', () => {
    expect(parseLzEvidenceRef('ev:2026-11-06T08-00-00:CPB:NET:01:Ref-0123456789')).toEqual({ run: '2026-11-06T08-00-00', subject: 'CPB:NET:01', label: 'Ref-0123456789' });
    expect(parseLzEvidenceRef('ev:../x:resource:Ref-0123456789')).toBeNull();
    expect(parseLzEvidenceRef('ev:run:resource:Node-0123456789')).toBeNull();
  });

  it('the public index joins in memory and returns references only', () => {
    const idx = lzEvidencePublicIndex(evidenceMap());
    expect(idx.check('platform', 'CPB-NET-01')).toMatch(/^ev:.+:CPB-NET-01:Ref-/);
    expect(idx.guardrail('platform', 'aws-scp', IDS.scp)).toMatch(/:guardrail:Ref-/);
    expect(idx.service('ec2')).toMatch(/:service:Ref-/);
    expect(idx.node(IDS.ou)).toMatch(/:hierarchy:Ref-/);
    expect(lzEvidencePublicIndex(null).check('platform', 'CPB-NET-01')).toBeUndefined();
  });

  it('resolves in the workspace; unknown, malformed and foreign-run references are refused', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-ev-'));
    tmp.push(ws);
    const runDir = join(ws, 'landing-zones', 'aws-test', 'wsp', 'runs', RUN);
    mkdirSync(runDir, { recursive: true });
    const map = evidenceMap();
    writeFileSync(join(runDir, LZ_EVIDENCE_MAP_FILE), JSON.stringify(map));
    expect(readLzEvidenceMap(runDir)?.entries).toHaveLength(map.entries.length);
    const ref = map.entries.find((e) => e.kind === 'ingress_rule')!.ref;
    const r = resolveLzEvidenceRef(ws, ref);
    expect(r.entry.native.id).toBe(IDS.sg);
    expect(resolveLzEvidenceRef(ws, ref, 'aws-test').lz_id).toBe('aws-test');
    expect(() => resolveLzEvidenceRef(ws, `ev:${RUN}:ingress_rules:Ref-0000000000`)).toThrow(LzEvidenceRefError);
    expect(() => resolveLzEvidenceRef(ws, ref.replace(RUN, '2026-01-01T00-00-00'))).toThrow(/not in this workspace/);
    expect(() => resolveLzEvidenceRef(ws, 'not-a-ref')).toThrow(/not an evidence reference/);
    expect(() => resolveLzEvidenceRef(ws, ref, 'otc-test')).toThrow(LzEvidenceRefError);
    try { resolveLzEvidenceRef(ws, 'x'); } catch (e) { expect((e as LzEvidenceRefError).exitCode).toBe(2); }
  });

  it('Azure-shaped scan (synthetic, no Azure environment): references without ARM ids, portal root link', () => {
    const SUB = '/subscriptions/00000000-1111-2222-3333-444444444444';
    const RG = `${SUB}/resourceGroups/bait-rg`;
    const NSG = `${RG}/providers/Microsoft.Network/networkSecurityGroups/bait-nsg`;
    const BUDGET = `${SUB}/providers/Microsoft.Consumption/budgets/bait-budget`;
    const meta = { lz_id: 'azure-test', provider: 'azure', scope_id: 'platform', scope_kind: 'platform' as const, observed_at: '2026-11-06T08:00:00Z', driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [] };
    const src = { calls: ['x'] };
    const estate = {
      resources: [{ id: NSG, type: 'Microsoft.Network/networkSecurityGroups', region: 'westeurope' }], workloads: [], quotas: [],
      guardrails: [{ type: 'azure-policy', id: 'subscription', status: 'fail' as const }],
      checks: [{ id: 'CPB-COST-01', title: 'Budget alerts', status: 'pass' as const, controls: [] }],
      posture: {
        ingress_rules: { source: src, items: [{ resource_id: NSG, region: 'westeurope', protocol: 'tcp', port_from: 3389, port_to: 3389, remote_cidr: '0.0.0.0/0' }] },
        budgets: { source: src, items: [{ resource_id: BUDGET, scope: SUB, budget_kind: 'cost' as const, alerts: [] }] },
      },
      hierarchy: { nodes: [{ id: SUB, kind: 'subscription' as const, native_kind: 'azure:subscription' }, { id: RG, kind: 'resource_group' as const, native_kind: 'azure:resource-group', parent: SUB }], source: src, scope_node: SUB },
    };
    const offering = { regions: [], services: [] };
    const scan = parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
    const map = buildLzEvidenceMap({ runId: RUN, lzId: 'azure-test', provider: 'azure', scans: [scan], salt: SALT, policyKinds: new Map([['CPB-COST-01', 'budget_alerts']]) });
    expect(new Set(map.entries.map((e) => e.kind))).toEqual(new Set(['resource', 'ingress_rule', 'budget', 'hierarchy_node', 'guardrail', 'check']));
    for (const e of map.entries) {
      for (const id of [SUB, RG, NSG, BUDGET, '00000000-1111-2222-3333-444444444444', 'bait']) expect(e.ref).not.toContain(id);
      expect(e.console?.url).toBe('https://portal.azure.com/');
    }
    expect(map.entries.find((e) => e.kind === 'check')?.related).toEqual(map.entries.filter((e) => e.kind === 'budget').map((e) => e.ref));
    expect(map.entries.find((e) => e.kind === 'budget')?.native).toMatchObject({ id: BUDGET, related_ids: { scope: SUB } });
  });

  it('the map schema refuses a duplicate or foreign-run reference', () => {
    const map = evidenceMap();
    const dup = { ...map, entries: [...map.entries, map.entries[0]!] };
    expect(LzEvidenceMapSchema.safeParse(dup).success).toBe(false);
    expect(LzEvidenceMapSchema.safeParse({ ...map, run_id: '2026-01-01T00-00-00' }).success).toBe(false);
  });
});

// #4050: organisational documents of the landing zone ingestion folder.
describe('#4050 document references', () => {
  it('references a document without its file name and without a console link; the public index finds it by path', () => {
    const map = evidenceMap();
    const doc = map.entries.find((e) => e.kind === 'document')!;
    expect(doc).toMatchObject({ scope_id: 'lz', subject: 'document', title: 'organisational document (compliance)', native: { id: 'policies/ict_risk_management_framework.pdf', type: 'compliance' } });
    expect(doc.ref).toMatch(/^ev:2026-11-06T08-00-00:document:Ref-[0-9a-f]{10}$/);
    expect(doc.ref).not.toContain('ict_risk');
    expect(doc.console).toBeUndefined();
    expect(lzEvidencePublicIndex(map).document('policies/ict_risk_management_framework.pdf')).toBe(doc.ref);
    expect(lzEvidencePublicIndex(map).document('other.pdf')).toBeUndefined();
  });
});
