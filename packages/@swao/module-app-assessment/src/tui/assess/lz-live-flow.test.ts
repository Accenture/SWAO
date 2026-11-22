// #3588: pure logic of the Landing Zone Live Assessment screen (Design 120
// section 14.3) and its CLI parity for steps 1 to 4.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildLiveAssessArgs, buildProbeArgs, doneActionArgs, listLiveFrameworks, parseProbeOutput, probeDecision, tuiProbeDetail, readRegisteredLandingZones, LIVE_DONE_ACTIONS,
  formatLiveBaselineSummary, parseLiveRunDir, readLiveBaselineSummary, readLiveEvidenceRows, evidenceResolveArgs,
  formatLiveOrganisationalSummary, lzIngestionFolder, lzIngestionFolderHint, frameworksForLz, probeRecovery,
} from './lz-live-flow.js';
import { LZ_BASELINE_RESULT_SUFFIX, LZ_EVIDENCE_MAP_FILE, buildLzEvidenceMap, deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(yml: string, fws: Record<string, { mapping: boolean }> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-lzl-flow-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), yml);
  for (const [id, o] of Object.entries(fws)) {
    const dir = join(d, 'wsp', 'inputs', 'catalogs', 'community', id.toLowerCase());
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'framework-meta.yaml'), `framework:\n  id: ${id}\n  name: "${id} test"\n  version: "1"\n`);
    if (o.mapping) writeFileSync(join(dir, 'service-controls.yaml'), `schema_version: "0.1"\nframework: ${id}\nmappings: []\n`);
  }
  return d;
}

const LZ_YML = ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    display: OTC test', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '      - id: app-a', '        kind: application', '        auth: iam-password-token', ''].join('\n');

describe('readRegisteredLandingZones (#3588 step 1)', () => {
  it('lists the registered landing zones with their scopes; none or invalid gives an empty list', () => {
    expect(readRegisteredLandingZones(ws(LZ_YML))).toEqual([{ id: 'otc-test', provider: 'otc', display: 'OTC test', scopes: [{ id: 'platform', kind: 'platform' }, { id: 'app-a', kind: 'application' }] }]);
    expect(readRegisteredLandingZones(ws('name: demo\n'))).toEqual([]);
    expect(readRegisteredLandingZones(ws('landing_zones: [{ id: "Bad Id" }]\n'))).toEqual([]);
  });
});

describe('landing_zones[].frameworks preselection (#4198, Design 125 section 5.7)', () => {
  it('reads the stored frameworks and selects the installed ones when the landing zone is chosen', () => {
    const d = ws(LZ_YML.replace('    display: OTC test\n', '    display: OTC test\n    frameworks: [CLIENT_LZ_POLICY_BASELINE, NOT_INSTALLED]\n'), { CLIENT_LZ_POLICY_BASELINE: { mapping: true }, BSI_C5: { mapping: true } });
    const [lz] = readRegisteredLandingZones(d);
    expect(lz?.frameworks).toEqual(['CLIENT_LZ_POLICY_BASELINE', 'NOT_INSTALLED']);
    const installed = listLiveFrameworks(d);
    expect([...frameworksForLz(lz!, installed, new Set(['BSI_C5']))]).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
  });

  it('without stored frameworks (or none installed) the current selection stays', () => {
    const d = ws(LZ_YML, { BSI_C5: { mapping: true } });
    const [lz] = readRegisteredLandingZones(d);
    expect(lz?.frameworks).toBeUndefined();
    expect([...frameworksForLz(lz!, listLiveFrameworks(d), new Set(['BSI_C5']))]).toEqual(['BSI_C5']);
    expect([...frameworksForLz({ ...lz!, frameworks: ['GONE'] }, listLiveFrameworks(d), new Set(['BSI_C5']))]).toEqual(['BSI_C5']);
  });
});

describe('listLiveFrameworks (#3588 step 4)', () => {
  it('local catalogue only, pre-selected from assessment.frameworks, mapping coverage shown', () => {
    const d = ws(`${LZ_YML}assessment:\n  frameworks: [BSI_C5]\n  regimes_active: [GDPR]\n`, { BSI_C5: { mapping: true }, GDPR: { mapping: false } });
    expect(listLiveFrameworks(d)).toEqual([
      { id: 'BSI_C5', name: 'BSI_C5 test', version: '1', hasServiceMapping: true, preselected: true },
      { id: 'GDPR', name: 'GDPR test', version: '1', hasServiceMapping: false, preselected: false },
    ]);
  });
  it('falls back to regimes_active for the preselection', () => {
    const d = ws(`${LZ_YML}assessment:\n  regimes_active: [GDPR]\n`, { GDPR: { mapping: false } });
    expect(listLiveFrameworks(d)[0]?.preselected).toBe(true);
  });
});

const PROBE = [
  'scope platform: identity mock-user, read-only verified',
  '  coverage: 9 readable',
  '  read-only verified',
  'scope app-a: identity mock-user, read-only refused',
  '  coverage: 9 readable, not readable: cts',
  '  credential is write-capable (role te_admin grants write actions)',
].join('\n');

describe('probe parsing and decision (#3588 step 3)', () => {
  it('parses scope lines and their detail', () => {
    const p = parseProbeOutput(PROBE);
    expect(p.map((l) => [l.scopeId, l.readOnly])).toEqual([['platform', 'verified'], ['app-a', 'refused']]);
    expect(p[1]?.detail).toContain('credential is write-capable (role te_admin grants write actions)');
  });
  it('#4460: the probe result names the TUI choice, not the CLI flag', () => {
    const p = parseProbeOutput([
      'scope platform: identity x, read-only refused',
      '  credential is write-capable (role te_admin grants write actions). Use a read-only role (see the driver ROLES.md), or pass --accept-write-capable-credentials for this run.',
      'scope app-a: identity x, read-only unverifiable',
      '  read-only could not be verified (no role list). Pass --accept-unverified-read-only for this run to continue.',
    ].join('\n'));
    const all = p.flatMap((l) => l.detail).join(' ');
    expect(all).not.toContain('--accept-');
    expect(p[0]?.detail[0]).toContain('or choose "Continue with the write-capable credential for this run" below.');
    expect(p[1]?.detail[0]).toContain('Choose "Accept for this run only" below.');
    expect(tuiProbeDetail('coverage: 9 readable')).toBe('coverage: 9 readable');
  });
  it('refused stops (and wins over unverifiable); unverifiable asks; verified proceeds; a missing scope is an error', () => {
    const p = parseProbeOutput(PROBE);
    expect(probeDecision(p, ['platform'])).toEqual({ kind: 'proceed' });
    expect(probeDecision(p, ['platform', 'app-a']).kind).toBe('refused');
    const u = parseProbeOutput('scope platform: identity x, read-only unverifiable\nscope app-a: identity x, read-only refused');
    expect(probeDecision(u, ['platform']).kind).toBe('unverifiable');
    expect(probeDecision(u, ['platform', 'app-a']).kind).toBe('refused');
    expect(probeDecision(p, ['nope'])).toEqual({ kind: 'error', message: 'no probe result for scope nope' });
  });
});

describe('CLI parity of steps 1 to 4 (#3588)', () => {
  it('probe: one call for all scopes, one per scope otherwise', () => {
    expect(buildProbeArgs('otc-test', ['platform', 'app-a'], ['platform', 'app-a'])).toEqual([['lz', 'probe', 'otc-test']]);
    expect(buildProbeArgs('otc-test', ['app-a'], ['platform', 'app-a'])).toEqual([['lz', 'probe', 'otc-test', '--scope', 'app-a']]);
  });
  it('assess: --lz, --scope per scope, --frameworks, and the per-run accept flags only when confirmed', () => {
    expect(buildLiveAssessArgs({ lzId: 'otc-test', scopes: ['platform', 'app-a'], frameworks: ['BSI_C5', 'GDPR'], acceptWriteCapableCredentials: false, acceptUnverifiedReadOnly: false }))
      .toEqual(['assess', '--type', 'landing-zone-live', '--lz', 'otc-test', '--scope', 'platform', '--scope', 'app-a', '--frameworks', 'BSI_C5,GDPR']);
    expect(buildLiveAssessArgs({ lzId: 'otc-test', scopes: ['platform'], frameworks: ['BSI_C5'], acceptWriteCapableCredentials: true, acceptUnverifiedReadOnly: true }))
      .toEqual(expect.arrayContaining(['--accept-write-capable-credentials', '--accept-unverified-read-only']));
    expect(() => buildLiveAssessArgs({ lzId: 'otc-test', scopes: ['platform'], frameworks: [], acceptWriteCapableCredentials: false, acceptUnverifiedReadOnly: false })).toThrow(/at least one framework/);
  });
});

describe('done menu (#3588 step 7)', () => {
  it('lists the four actions of section 14.3; publish runs swao publish --lz-live', () => {
    expect(LIVE_DONE_ACTIONS.map((a) => a.id)).toEqual(['publish', 'catalogue-source', 'diff', 'hierarchy', 'evidence', 'back']);
    // #3885: the tenant hierarchy runs swao lz hierarchy.
    expect(doneActionArgs('hierarchy', 'otc-test', 'otc')).toEqual({ args: ['lz', 'hierarchy', 'otc-test'], followUp: 'Tenant hierarchy of the latest run, pseudonymised.' });
    expect(doneActionArgs('publish', 'otc-test', 'otc')).toEqual({ args: ['publish', '--lz-live', 'otc-test'] });
    // #3589: the catalogue source is the #3582 dry run; writing is a separate confirmed step.
    expect(doneActionArgs('catalogue-source', 'otc-test', 'otc')).toEqual({
      args: ['lz', 'catalogue', 'update', '--provider', 'otc', '--source', 'live', '--lz', 'otc-test', '--dry-run'],
      followUp: expect.stringContaining('Tools > Update LZ Catalogue > Source: Live landing zone catalogue'),
    });
    // #3830: swao lz diff exists now.
    expect(doneActionArgs('diff', 'otc-test', 'otc')).toEqual({ args: ['lz', 'diff', 'otc-test'], followUp: 'Diff vs the previous run of each scope.' });
    expect(doneActionArgs('back', 'otc-test', 'otc')).toBeNull();
    // #3956: the evidence list; #4213: the follow-up names no CLI command (the Done guidance cli line does).
    expect(doneActionArgs('evidence', 'otc-test', 'otc')).toEqual({ args: ['lz', 'evidence', '--lz', 'otc-test'], followUp: 'Evidence references of the latest run; resolve one from the evidence list.' });
  });
});

// #3956 (Design 123 section 9.5): the TUI evidence list reads the run's local map; resolving goes through the CLI.
describe('evidence references (#3956)', () => {
  it('lists references (checks first) without native ids and resolves through swao lz evidence', () => {
    const d = mkdtempSync(join(tmpdir(), 'swao-lzl-ev-'));
    tmp.push(d);
    const scan = parseLzLiveScan({
      ...deriveLzScanBaseFields({
        meta: { lz_id: 'otc-test', provider: 'otc', scope_id: 'platform', scope_kind: 'platform', observed_at: '2026-11-06T08:00:00Z', driver_version: '1', read_only: 'verified', read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [] },
        offering: { regions: [], services: [] },
        estate: { resources: [{ id: 'res-bait-000001', type: 'ecs.cloudservers' }], workloads: [], guardrails: [], quotas: [], checks: [{ id: 'CPB-TAG-01', title: 'Tags', status: 'fail', controls: [] }] },
      }),
      collection_mode: 'live', confidence: 'observed',
      meta: { lz_id: 'otc-test', provider: 'otc', scope_id: 'platform', scope_kind: 'platform', observed_at: '2026-11-06T08:00:00Z', driver_version: '1', read_only: 'verified', read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [] },
      offering: { regions: [], services: [] },
      estate: { resources: [{ id: 'res-bait-000001', type: 'ecs.cloudservers' }], workloads: [], guardrails: [], quotas: [], checks: [{ id: 'CPB-TAG-01', title: 'Tags', status: 'fail', controls: [] }] },
    });
    writeFileSync(join(d, LZ_EVIDENCE_MAP_FILE), JSON.stringify(buildLzEvidenceMap({ runId: '2026-11-06T08-00-00', lzId: 'otc-test', provider: 'otc', scans: [scan], salt: 'e'.repeat(64) })));
    const rows = readLiveEvidenceRows(d);
    expect(rows.map((r) => r.kind)).toEqual(['check', 'resource']);
    expect(JSON.stringify(rows)).not.toContain('res-bait-000001');
    expect(evidenceResolveArgs(rows[0]!.ref, false)).toEqual(['lz', 'evidence', rows[0]!.ref]);
    expect(evidenceResolveArgs(rows[0]!.ref, true)).toEqual(['lz', 'evidence', rows[0]!.ref, '--open']);
    expect(readLiveEvidenceRows(join(d, 'missing'))).toEqual([]);
  });
});

// #3875 (Design 123 section 9.4): the baseline summary of the results step.
describe('baseline summary of the results step (#3875)', () => {
  const sha = 'a'.repeat(64);
  const policy = (id: string, estate: string, detail: string) => ({ id, kind: 'region_residency', category: 'data_residency', control: id, severity: 'blocker', offering: 'READY', estate, observability: 'observed', detail });
  function runDir(results: Record<string, unknown>[], extra: Record<string, string> = {}): string {
    const d = mkdtempSync(join(tmpdir(), 'swao-lzl-baseline-'));
    tmp.push(d);
    for (const r of results) writeFileSync(join(d, `otc-test.${String(r['scope_id'])}${LZ_BASELINE_RESULT_SUFFIX}`), JSON.stringify(r));
    for (const [f, body] of Object.entries(extra)) writeFileSync(join(d, f), body);
    return d;
  }
  const result = (scope: string, overall: string, policies: ReturnType<typeof policy>[]) => ({
    schema: 'lz-baseline-result/1', lz_id: 'otc-test', scope_id: scope, provider: 'otc', framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE',
    catalogue_version: '1.0.0', sha256: sha, overall, policies, not_reviewed: [{ id: 'CPB-NEW-01', kind: 'audit_trail', params: {} }], disabled: ['CPB-OFF-01'],
  });

  it('finds the run folder in the CLI output, relative to the workspace or absolute', () => {
    const lines = ['scope platform: complete', '[lz live] run 2026-11-05T08-00-00: complete -> landing-zones/otc-test/wsp/runs/2026-11-05T08-00-00', '[lz live] publish with: swao publish --lz-live otc-test'];
    expect(parseLiveRunDir(lines, '/ws')).toBe(join('/ws', 'landing-zones/otc-test/wsp/runs/2026-11-05T08-00-00'));
    const abs = join(tmpdir(), 'run');
    expect(parseLiveRunDir([`[lz live] run x: partial -> ${abs}`], '/ws')).toBe(abs);
    expect(parseLiveRunDir(['no run line'])).toBeNull();
  });

  it('counts the estate status per scope through the schema; detail text and resource ids never reach the lines', () => {
    const d = runDir([
      result('platform', 'BLOCKED', [policy('CPB-RES-01', 'fail', '2 resources outside DE: ecs-0f3a9c, rds-77b1'), policy('CPB-AUD-01', 'pass', 'audit on'), policy('CPB-PUB-01', 'unverified', 'read denied')]),
      result('app-a', 'READY', [policy('CPB-RES-01', 'pass', 'all in DE')]),
    ], { 'otc-test.broken.lz-baseline.json': '{ not json', 'otc-test.platform.lz-live-scan.json': '{}' });
    const s = readLiveBaselineSummary(d);
    expect(s.unreadable).toBe(1);
    expect(s.scopes.map((x) => [x.scope_id, x.overall, x.evaluated])).toEqual([['app-a', 'READY', 1], ['platform', 'BLOCKED', 3]]);
    const platform = s.scopes.find((x) => x.scope_id === 'platform')!;
    expect(platform.estate).toEqual({ pass: 1, fail: 1, warn: 0, na: 0, unverified: 1 });
    const lines = formatLiveBaselineSummary(s);
    expect(lines[0]).toBe('Client LZ Policy Baseline: CLIENT_LZ_POLICY_BASELINE 1.0.0');
    expect(lines).toContain('  scope platform: BLOCKED, 3 evaluated (1 pass, 1 fail, 0 warn, 1 unverified, 0 n/a), 1 not reviewed, 1 disabled');
    expect(lines.join('\n')).not.toMatch(/ecs-0f3a9c|rds-77b1|outside DE|read denied/);
    expect(lines).toContain('  1 baseline result file(s) could not be read');
  });

  it('no baseline result (the baseline was not selected): no lines', () => {
    expect(formatLiveBaselineSummary(readLiveBaselineSummary(runDir([])))).toEqual([]);
    expect(readLiveBaselineSummary(join(tmpdir(), 'swao-no-such-run-dir'))).toEqual({ scopes: [], unreadable: 0 });
  });
});

// #4050 (Design 120 section 8.4): the landing zone ingestion folder in the TUI flow.
describe('organisational controls in the LZ live flow (#4050)', () => {
  it('names the same folder the CLI run reads', () => {
    expect(lzIngestionFolder('otc-test')).toBe('landing-zones/otc-test/ingestion/');
    expect(lzIngestionFolderHint('otc-test')).toContain('landing-zones/otc-test/ingestion/');
  });

  it('summarises the run result; nothing without a result file', () => {
    const d = mkdtempSync(join(tmpdir(), 'swao-lzl-org-'));
    tmp.push(d);
    expect(formatLiveOrganisationalSummary(d)).toEqual([]);
    writeFileSync(join(d, 'lz-organisational.json'), JSON.stringify({
      schema: 'lz-organisational-result/1', lz_id: 'otc-test', run_id: 'r1', generated_at: '2026-11-07T20:00:00Z',
      folder: 'landing-zones/otc-test/ingestion', documents: { total: 0, readable: 0, matched: 0 },
      frameworks: [{ id: 'DORA', version: '2025-01-17', controls: [], counts: { satisfied: 0, partial: 0, unknown: 6, n_a: 2 }, out_of_scope: 27 }],
    }));
    expect(formatLiveOrganisationalSummary(d)).toEqual([
      'Organisational controls from landing-zones/otc-test/ingestion/: 0 document(s), 0 matched',
      '  DORA: 0 documented, 0 partly documented, 6 not evaluated, 2 n/a; 27 more in application or audit assessments',
    ]);
  });
});

describe('probeRecovery (#4241, #4255): a failed probe is never a dead end', () => {
  it('offers Probe again and Back; Continue without only when some scopes answered', () => {
    const none = probeRecovery(['Feature requires a consultant license'], ['platform']);
    expect(none.options.map((o) => o.value)).toEqual(['retry', 'back']);
    expect(none.failedScopes).toEqual(['platform']);
    const part = probeRecovery(['scope platform: identity u, read-only verified'], ['platform', 'app-a']);
    expect(part.options.map((o) => o.label)).toEqual(['Probe again', 'Continue without scope app-a', 'Back to the scopes']);
    expect(part.answeredScopes).toEqual(['platform']);
  });
});

describe('LZ Catalog finish run folder (#4256)', () => {
  it('names the real run folder, relative to the workspace, never <ts>', { timeout: 30_000 }, async () => {
    const { lzRunFolder } = await import('./LzAssessmentScreen.js');
    expect(lzRunFolder('sovereign-health', 'runs/2026-11-09T16-11-31\n')).toBe('apps/sovereign-health/wsp/runs/2026-11-09T16-11-31/');
    expect(lzRunFolder('a', './runs/x/')).toBe('apps/a/wsp/runs/x/');
  });
});

describe('#4399 parseProbeOutput: verdict line, identity line dropped', () => {
  it('reads the state from the verdict and keeps the identity out of the detail', () => {
    expect(parseProbeOutput([
      'scope platform: read-only check: read-only',
      '  identity: groups: read-only admin, admin',
      '  coverage: 56 readable',
      'scope app-a: read-only check: not verifiable, refused (not accepted for this run)',
    ].join('\n'))).toEqual([
      { scopeId: 'platform', readOnly: 'verified', detail: ['coverage: 56 readable'] },
      { scopeId: 'app-a', readOnly: 'unverifiable', detail: [] },
    ]);
  });
});
