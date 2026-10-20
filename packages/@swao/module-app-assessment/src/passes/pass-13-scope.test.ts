// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  inputPathSatisfied,
  evaluateBlindSpot,
  buildScopeCoverage,
  loadBlindSpotsCatalogue,
  resolveDefaultBlindSpotsCataloguePath,
  runScopePass,
  mentionsContainerPlatform,
  mentionsWebFacing,
  hasWebFacingEvidence,
} from './pass-13-scope.js';
import type { BlindSpotEntry } from '../schema/blind-spots-catalogue.js';

// Sprint 029 Phase 1 (#0263) -- Pass 13 unit tests. Cover the rule-engine
// paths (closed / partial / open + option-B override) and the runner
// integration with the bundled catalogue.

const NOW = '2026-05-14T12:00:00Z';

function makeEntry(overrides: Partial<BlindSpotEntry> = {}): BlindSpotEntry {
  return {
    id: 'BS_TEST',
    name: 'Test blind spot',
    category: 'network',
    description: 'A synthetic blind spot used by Pass 13 unit tests.',
    severity_default: 'high',
    current_swao_coverage: 'none',
    input_that_closes: 'test_input',
    input_paths: ['wsp/inputs/test-input'],
    input_path_hint: 'Drop the test input under wsp/inputs/test-input/',
    related_regimes: ['BSI_C5'],
    ...overrides,
  };
}

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-pass13-'));
  appDir = join(tmp, 'apps', 'audited');
  mkdirSync(join(appDir, 'wsp', 'inputs'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('inputPathSatisfied (#0263 rule-engine primitive)', () => {
  it('returns false for missing path', () => {
    expect(inputPathSatisfied(appDir, 'wsp/inputs/nonexistent')).toBe(false);
  });

  it('returns false for empty directory', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'empty'), { recursive: true });
    expect(inputPathSatisfied(appDir, 'wsp/inputs/empty')).toBe(false);
  });

  it('returns false for zero-byte file', () => {
    writeFileSync(join(appDir, 'wsp', 'inputs', 'empty.csv'), '');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/empty.csv')).toBe(false);
  });

  it('returns true for non-empty file', () => {
    writeFileSync(join(appDir, 'wsp', 'inputs', 'runbook.md'), '# Runbook\nContent.\n');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/runbook.md')).toBe(true);
  });

  it('returns true for directory with at least one non-empty file', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'iam'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'iam', 'roles.json'), '{"roles":[]}');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/iam')).toBe(true);
  });

  it('ignores dot-files when checking non-emptiness', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'with-dotfile'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'with-dotfile', '.gitkeep'), '');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/with-dotfile')).toBe(false);
  });
});

describe('evaluateBlindSpot (#0263 coverage classification)', () => {
  it('open when input absent and baseline coverage is none', () => {
    const entry = makeEntry({ current_swao_coverage: 'none' });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('open');
    expect(result.inputProvided).toBeNull();
  });

  it('partial when input absent and baseline coverage is partial', () => {
    const entry = makeEntry({ current_swao_coverage: 'partial' });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('partial');
  });

  it('closed when input present, regardless of baseline (Option B override)', () => {
    // Baseline says partial; input present -> closed wins.
    writeFileSync(join(appDir, 'wsp', 'inputs', 'test-input'), 'content');
    const entry = makeEntry({ current_swao_coverage: 'partial' });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('closed');
    expect(result.inputProvided).toBe('wsp/inputs/test-input');
  });

  it('closed when input is a populated directory', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'test-input'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'test-input', 'export.yaml'), 'a: 1');
    const entry = makeEntry();
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('closed');
  });

  it('walks multiple input_paths and matches the first that satisfies', () => {
    writeFileSync(join(appDir, 'wsp', 'inputs', 'second-path.csv'), 'col1,col2\n1,2');
    const entry = makeEntry({
      input_paths: ['wsp/inputs/first-path', 'wsp/inputs/second-path.csv'],
    });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('closed');
    expect(result.inputProvided).toBe('wsp/inputs/second-path.csv');
  });
});

describe('buildScopeCoverage (#0263 aggregate)', () => {
  it('computes coverage_ratio as (closed + 0.5 * partial) / total', () => {
    const catalogue = { schema_version: '1' as const, catalogue_version: '1.0.0', blind_spots: [] };
    const evaluations = [
      { entry: makeEntry({ id: 'BS_A' }), coverage: 'closed' as const, inputProvided: 'wsp/inputs/a' },
      { entry: makeEntry({ id: 'BS_B' }), coverage: 'closed' as const, inputProvided: 'wsp/inputs/b' },
      { entry: makeEntry({ id: 'BS_C' }), coverage: 'closed' as const, inputProvided: 'wsp/inputs/c' },
      { entry: makeEntry({ id: 'BS_D' }), coverage: 'partial' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_E' }), coverage: 'partial' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_F' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_G' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_H' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_I' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_J' }), coverage: 'open' as const, inputProvided: null },
    ];
    const result = buildScopeCoverage(catalogue, evaluations, NOW);
    expect(result.total_blind_spots).toBe(10);
    expect(result.closed).toBe(3);
    expect(result.partial).toBe(2);
    expect(result.open).toBe(5);
    expect(result.coverage_ratio).toBe(0.4);
  });

  it('returns 0 ratio for empty catalogue', () => {
    const catalogue = { schema_version: '1' as const, catalogue_version: '1.0.0', blind_spots: [] };
    const result = buildScopeCoverage(catalogue, [], NOW);
    expect(result.coverage_ratio).toBe(0);
    expect(result.total_blind_spots).toBe(0);
  });

  it('attaches partial_coverage_note only to partial entries with partial baseline', () => {
    const partialBaseline = makeEntry({ id: 'BS_PARTIAL', current_swao_coverage: 'partial' });
    const evaluations = [
      { entry: partialBaseline, coverage: 'partial' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_OPEN' }), coverage: 'open' as const, inputProvided: null },
    ];
    const catalogue = { schema_version: '1' as const, catalogue_version: '1.0.0', blind_spots: [] };
    const result = buildScopeCoverage(catalogue, evaluations, NOW);
    const partialRow = result.blind_spots.find((b) => b.id === 'BS_PARTIAL');
    const openRow = result.blind_spots.find((b) => b.id === 'BS_OPEN');
    expect(partialRow?.partial_coverage_note).toBeDefined();
    expect(openRow?.partial_coverage_note).toBeUndefined();
    expect(openRow?.input_required).toBeDefined();
  });
});

describe('bundled blind-spots catalogue (#0263 schema integrity)', () => {
  it('loads and schema-validates', () => {
    const path = resolveDefaultBlindSpotsCataloguePath();
    expect(() => loadBlindSpotsCatalogue(path)).not.toThrow();
  });

  it('has 10+ entries', () => {
    const catalogue = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath());
    expect(catalogue.blind_spots.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry has at least one input_paths candidate', () => {
    const catalogue = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath());
    for (const entry of catalogue.blind_spots) {
      expect(entry.input_paths.length, `${entry.id} input_paths`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('runScopePass integration (#0263)', () => {
  it('emits SCOPE-* signals + scope_coverage block on an empty workspace', async () => {
    const result = await runScopePass({
      appId: 'audited',
      sourcePath: appDir,
      workspacePath: appDir,
      iter: 1,
      assessedAt: NOW,
    });
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
    expect(result.signals[0]?.id).toMatch(/^SCOPE-/);
    const scope = result.assessment['scope_coverage'] as { total_blind_spots: number; open: number };
    expect(scope.total_blind_spots).toBeGreaterThanOrEqual(10);
    // Empty workspace -> mostly open; some partial baselines exist.
    expect(scope.open).toBeGreaterThan(0);
  });

  it('closes a blind spot when its input_path is satisfied', async () => {
    // Stage the IAM input path so BS_CLOUD_IAM closes.
    mkdirSync(join(appDir, 'wsp', 'inputs', 'iam'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'iam', 'roles.json'), '{"roles":[]}');
    const result = await runScopePass({
      appId: 'audited',
      sourcePath: appDir,
      workspacePath: appDir,
      iter: 1,
      assessedAt: NOW,
    });
    const scope = result.assessment['scope_coverage'] as { blind_spots: Array<{ id: string; coverage: string }> };
    const iamRow = scope.blind_spots.find((b) => b.id === 'BS_CLOUD_IAM');
    expect(iamRow?.coverage).toBe('closed');
  });
});

// #3246: container-only blind spots do not apply to a service workload
// (server or VM from an intake row) without container-platform evidence.
describe('blind-spot applicability for service workloads (#3246)', () => {
  const K8S_ONLY = ['BS_NETWORK_POLICY', 'BS_SERVICE_MESH_MTLS'];
  const serviceYml = (extra = '') =>
    writeFileSync(join(appDir, '.swao.yml'), `wsp_version: "0.9"\napp_id: audited\nassessment:\n  type: service\nvendor_type: on-premises\nos_class: INFRA_PLATFORM_OS_WINDOWS_SERVER\nplatform:\n  os: Windows Server 2019\n${extra}`);
  const run = async (passesDir?: string) => runScopePass({ appId: 'audited', sourcePath: appDir, workspacePath: appDir, iter: 1, assessedAt: NOW, ...(passesDir ? { passesDir } : {}) });
  const ids = (r: Awaited<ReturnType<typeof run>>) => (r.assessment['scope_coverage'] as { blind_spots: Array<{ id: string }> }).blind_spots.map((b) => b.id);
  const implied = (r: Awaited<ReturnType<typeof run>>) => r.signals.flatMap((s) => s.implies ?? []).join(' ');

  it('the bundled catalogue marks the Kubernetes and service-mesh entries as container-only', () => {
    const cat = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath());
    expect(cat.blind_spots.filter((b) => b.requires_evidence?.includes('container_platform')).map((b) => b.id).sort()).toEqual(K8S_ONLY);
  });

  it('a server-only service gets neither entry, no SCOPE signal for them, and a not-applicable list', async () => {
    serviceYml();
    const r = await run();
    for (const id of K8S_ONLY) {
      expect(ids(r)).not.toContain(id);
      expect(implied(r)).not.toContain(id);
    }
    expect(r.signals.map((s) => s.derivation).join(' ')).not.toMatch(/kubernetes|mesh/i);
    // #3290: the fixture has no web-facing evidence either, so BS_WAF_API_GATEWAY is out too.
    const na = r.assessment['scope_not_applicable'] as Array<{ id: string; reason: string }>;
    expect(na.map((n) => n.id).sort()).toEqual([...K8S_ONLY, 'BS_WAF_API_GATEWAY'].sort());
    const scope = r.assessment['scope_coverage'] as { total_blind_spots: number };
    const full = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath()).blind_spots.length;
    expect(scope.total_blind_spots).toBe(full - 3);
    expect(r.signals.map((s) => s.id)[0]).toBe('SCOPE-01');
  });

  it('a service with a Kubernetes signal in this run keeps both entries', async () => {
    serviceYml();
    const passesDir = join(appDir, 'wsp', 'runs', 'r1', 'passes');
    mkdirSync(passesDir, { recursive: true });
    writeFileSync(join(passesDir, '05-sbom.yaml'), 'signals:\n  - id: SBOM-01\n    source: static_analysis\n    derivation: "SBOM lists the OpenShift router and kubelet components."\n');
    const r = await run(passesDir);
    for (const id of K8S_ONLY) expect(ids(r)).toContain(id);
    // #3290: only the WAF entry (no web-facing evidence) stays out.
    expect((r.assessment['scope_not_applicable'] as Array<{ id: string }>).map((n) => n.id)).toEqual(['BS_WAF_API_GATEWAY']);
  });

  it('ignores LLM-inferred and negated mentions (UAT 2026-10-11 wording)', async () => {
    serviceYml();
    const passesDir = join(appDir, 'wsp', 'runs', 'r2', 'passes');
    mkdirSync(passesDir, { recursive: true });
    writeFileSync(join(passesDir, '04-ctx.yaml'), 'signals:\n  - id: CTX-01\n    source: llm_inference\n    derivation: "The snapshot is marked fabricated and shows an EKS cluster that does not exist."\n');
    writeFileSync(join(passesDir, '08-crypto.yaml'), 'signals:\n  - id: CRYPTO-01\n    source: static_analysis\n    derivation: "Docker Compose only. No Kubernetes manifests; runs without a service mesh."\n');
    const r = await run(passesDir);
    for (const id of K8S_ONLY) expect(ids(r)).not.toContain(id);
    expect(mentionsContainerPlatform('No Kubernetes manifests.')).toBe(false);
    expect(mentionsContainerPlatform('Keine Kubernetes-Plattform vorhanden.')).toBe(false);
    expect(mentionsContainerPlatform('No backup. Hosted on OpenShift 4.12.')).toBe(true);
  });

  it('a service whose own record names a container platform keeps both entries', async () => {
    serviceYml('app_name: Kubernetes ingress cluster\n');
    const r = await run();
    for (const id of K8S_ONLY) expect(ids(r)).toContain(id);
  });

  it('a supplied network-policy input keeps (and closes) the entry even without other evidence', async () => {
    serviceYml();
    mkdirSync(join(appDir, 'wsp', 'inputs', 'network-policies'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'network-policies', 'np.yaml'), 'kind: NetworkPolicy\n');
    const r = await run();
    const row = (r.assessment['scope_coverage'] as { blind_spots: Array<{ id: string; coverage: string }> }).blind_spots.find((b) => b.id === 'BS_NETWORK_POLICY');
    expect(row?.coverage).toBe('closed');
    expect(ids(r)).not.toContain('BS_SERVICE_MESH_MTLS');
  });

  it('an application assessment keeps the full catalogue', async () => {
    writeFileSync(join(appDir, '.swao.yml'), 'wsp_version: "0.9"\napp_id: audited\n');
    const r = await run();
    for (const id of K8S_ONLY) expect(ids(r)).toContain(id);
    expect(ids(r)).toContain('BS_WAF_API_GATEWAY');
    expect(r.assessment['scope_not_applicable']).toBeUndefined();
  });
});

// #3290 (Design 110 D-25): BS_WAF_API_GATEWAY applies to a service workload
// only with web-facing evidence; a WAF gap on a batch server is noise.
describe('WAF / API gateway blind spot scoped to web-facing services (#3290)', () => {
  const WAF = 'BS_WAF_API_GATEWAY';
  const serviceYml = (extra = '') =>
    writeFileSync(join(appDir, '.swao.yml'), `wsp_version: "0.9"\napp_id: audited\napp_name: Nightly batch export\nassessment:\n  type: service\nvendor_type: on-premises\nos_class: INFRA_PLATFORM_OS_WINDOWS_SERVER\nplatform:\n  os: Windows Server 2019\n${extra}`);
  const run = async (passesDir?: string) => runScopePass({ appId: 'audited', sourcePath: appDir, workspacePath: appDir, iter: 1, assessedAt: NOW, ...(passesDir ? { passesDir } : {}) });
  const ids = (r: Awaited<ReturnType<typeof run>>) => (r.assessment['scope_coverage'] as { blind_spots: Array<{ id: string }> }).blind_spots.map((b) => b.id);
  const notApplicable = (r: Awaited<ReturnType<typeof run>>) => (r.assessment['scope_not_applicable'] as Array<{ id: string; reason: string }> | undefined) ?? [];

  it('the bundled catalogue marks only the WAF / API gateway entry as web-facing', () => {
    const cat = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath());
    expect(cat.blind_spots.filter((b) => b.requires_evidence?.includes('web_facing')).map((b) => b.id)).toEqual([WAF]);
  });

  it('a batch server without web-facing evidence drops the entry with a reason', async () => {
    serviceYml();
    const r = await run();
    expect(ids(r)).not.toContain(WAF);
    expect(r.signals.flatMap((s) => s.implies ?? []).join(' ')).not.toContain(WAF);
    const row = notApplicable(r).find((n) => n.id === WAF);
    expect(row?.reason).toMatch(/no web-facing evidence/);
  });

  it('the vendor website is not web-facing evidence', async () => {
    serviceYml('vendor:\n  name: Example Vendor\n  url: https://vendor.example.com\n');
    expect(ids(await run())).not.toContain(WAF);
  });

  it('a deterministic HTTP endpoint signal keeps the entry; an LLM-inferred or negated one does not', async () => {
    serviceYml();
    const passesDir = join(appDir, 'wsp', 'runs', 'r3', 'passes');
    mkdirSync(passesDir, { recursive: true });
    writeFileSync(join(passesDir, '04-ctx.yaml'), 'signals:\n  - id: CTX-01\n    source: llm_inference\n    derivation: "Probably serves a web portal over HTTPS."\n');
    writeFileSync(join(passesDir, '08-crypto.yaml'), 'signals:\n  - id: CRYPTO-01\n    source: static_analysis\n    derivation: "No web server or API gateway configured; file transfer only."\n');
    expect(ids(await run(passesDir))).not.toContain(WAF);
    writeFileSync(join(passesDir, '08-crypto.yaml'), 'signals:\n  - id: CRYPTO-01\n    source: static_analysis\n    derivation: "Config exposes http://app01.example.local:8080/api for the ward clients."\n');
    expect(ids(await run(passesDir))).toContain(WAF);
  });

  it('SaaS delivery, a DMZ zone, a web UI function, web SSO or REST integration notes keep the entry', async () => {
    for (const extra of [
      'network:\n  ip: null\n  zone: DMZ\n',
      'business:\n  function: Patient portal\n',
      'integrations_notes: Anbindung per REST-API an das KIS\n',
    ]) {
      serviceYml(extra);
      expect(ids(await run())).toContain(WAF);
    }
    writeFileSync(join(appDir, '.swao.yml'), 'wsp_version: "0.9"\napp_id: audited\nassessment:\n  type: service\nvendor_type: saas\n');
    expect(ids(await run())).toContain(WAF);
    expect(hasWebFacingEvidence({ platform: { auth_method: 'SAML SSO' } }, [])).toBe(true);
  });

  it('a supplied edge-controls input keeps (and closes) the entry without other evidence', async () => {
    serviceYml();
    writeFileSync(join(appDir, 'wsp', 'inputs', 'edge-controls.md'), '# Edge controls\nF5 WAF in front of the app.\n');
    const r = await run();
    const row = (r.assessment['scope_coverage'] as { blind_spots: Array<{ id: string; coverage: string }> }).blind_spots.find((b) => b.id === WAF);
    expect(row?.coverage).toBe('closed');
  });

  it('web-facing wording: matches exposure, not "Windows Server", "endpoint protection" or "the rest"', () => {
    for (const t of ['https://portal.example.org', 'Runs on IIS 10', 'Tomcat 9 application server', 'SOAP interface to the lab', 'Webanwendung fuer Befunde', 'behind an API gateway'])
      expect(mentionsWebFacing(t), t).toBe(true);
    for (const t of ['Windows Server 2019', 'Endpoint protection agent installed', 'the rest of the batch', 'No web server, no API exposed', 'Keine Webanwendung'])
      expect(mentionsWebFacing(t), t).toBe(false);
  });
});
