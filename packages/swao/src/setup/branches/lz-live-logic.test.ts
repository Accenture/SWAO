// #4195 SET-06 (Design 125 sections 5.5, 5.7 and 11): logic of the Landing
// Zone Live setup steps. Fixture workspaces in a temporary folder; the probe
// output is a fixed text (no CLI spawned, no tenant call).

import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { readLzLiveDefaults } from '../defaults.js';
import { defaultSetupRegistry } from '../index.js';
import {
  baselineCheck,
  createEvidenceFolders,
  ensureEvidenceFolders,
  evidenceRow,
  expectedEvidenceInputs,
  evidenceCheck,
  evidenceState,
  findPolicyBaselines,
  frameworksToSave,
  initialFrameworkSelection,
  missingBaselineLines,
  probeArgs,
  probeCheck,
  probeFailureReason,
  readyStateOf,
  probeSummaryLine,
  probeTotals,
  saveLzFrameworks,
  toProbeOutcome,
  workspaceFrameworks,
  COMMUNITY_FRAMEWORKS_URL,
} from './lz-live-logic.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const HEAD = ['# client workspace', 'name: demo', 'assessment:', '  frameworks: [bsi-c5]', ''].join('\n');
const LZS = ['landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '  - id: aws-demo', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', ''].join('\n');
const TAIL = ['', '# trailing comment kept', 'regimes_active: [bsi-c5]', ''].join('\n');

function workspace(yml = HEAD + LZS + TAIL): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-lzl-setup-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), yml);
  mkdirSync(join(d, 'wsp', 'inputs', 'catalogs', 'community'), { recursive: true });
  return d;
}

function copyBaseline(ws: string, folder = 'client-lz-policy-baseline'): string {
  const dest = join(ws, 'wsp', 'inputs', 'catalogs', 'community', folder);
  cpSync(join(communityFrameworksDir, 'client-lz-policy-baseline'), dest, { recursive: true });
  return dest;
}

const PROBE_OPTS = { capabilityTags: [] as string[] };

describe('Probe step logic (#4195)', () => {
  it('probes with the Landing Zone Connections argv and never an accept flag', () => {
    expect(probeArgs('otc-prod')).toEqual(['lz', 'probe', 'otc-prod', '--caller', 'wizard.lz-live.probe']);
    expect(probeArgs('otc-prod').some((a) => a.startsWith('--accept'))).toBe(false);
  });

  it('keeps scope, read-only state and coverage, and drops the identity and every other detail line', () => {
    const arn = ['arn', 'aws', 'iam', '', '123456789012', 'user/ops'].join(':');
    const o = toProbeOutcome('aws-demo', 1, [
      `scope platform: identity ${arn}, read-only refused`,
      '  coverage: 7 readable, not readable: kms',
      '  recording: C:/rec/aws-demo',
      `  credential is write-capable (${arn})`,
    ]);
    expect(o.rows).toEqual([{ lzId: 'aws-demo', scopeId: 'platform', readOnly: 'refused', coverage: '7 readable, not readable: kms' }]);
    expect(JSON.stringify(o)).not.toContain('123456789012');
    expect(o.failed).toBe(false);
  });

  it('#4496: a failed probe names its first error line as the reason, native ids masked (a driver error can name the caller ARN)', () => {
    const o = toProbeOutcome('aws-demo', 1, ['[lz live] User: arn:aws:iam::123456789012:user/ops is not authorized', 'second line']);
    expect(o).toMatchObject({ lzId: 'aws-demo', rows: [], code: 1, failed: true });
    expect(o.reason).toMatch(/^User: .* is not authorized$/);
    expect(o.reason).not.toContain('123456789012');
    expect(o.reason).not.toContain('[lz live]');
    expect(toProbeOutcome('b', 1, []).reason).toBeUndefined();
    expect((probeFailureReason(['x'.repeat(400)]) ?? '').length).toBe(160);
  });

  it('#4496: the Ready level is the Probe step level: a refused sign-in or nothing readable is fail', () => {
    expect(readyStateOf('login-failed')).toBe('fail');
    expect(readyStateOf('verified', 0)).toBe('fail');
    expect(readyStateOf('refused', 56)).toBe('warn');
    expect(readyStateOf('verified', 9)).toBe('ok');
    expect(readyStateOf('not-probed')).toBe('warn');
  });

  it('flags write-capable logins in the Ready summary (Design 125 section 5.5)', () => {
    const t = probeTotals([
      toProbeOutcome('a', 0, ['scope platform: identity x, read-only verified', 'scope app-1: identity y, read-only refused']),
      toProbeOutcome('b', 1, ['[lz live] failed']),
    ]);
    expect(t).toEqual({ scopes: 2, verified: 1, writeCapable: 1, unverifiable: 0, failedLandingZones: 1 });
    expect(probeSummaryLine(t)).toBe('2 scopes probed, 1 read-only, 1 write-capable login flagged, 1 landing zone not probed');
  });

  it('check lists the registered landing zones, or says none is registered', () => {
    expect(probeCheck(workspace()).map((c) => c.label)).toEqual(['otc-prod / platform', 'aws-demo / platform']);
    expect(probeCheck(workspace(HEAD))).toEqual([{ label: 'Landing zones', state: 'missing', detail: 'no live landing zone registered', short: 'none registered' }]);
  });
});

describe('#4233 Ready rows: the live facts per scope, as the health check', () => {
  it('one row per scope: state words, coverage, probe time and the last run; not probed when nothing is stored', () => {
    const ws = workspace();
    const wsp = join(ws, 'landing-zones', 'otc-prod', 'wsp');
    mkdirSync(join(wsp, 'runs', 'run-1'), { recursive: true });
    writeFileSync(join(wsp, 'last-probe.json'), JSON.stringify({ schema: 'lz-probe-record/1', scopes: { platform: { read_only: 'refused', readable: 56, unreadable: 2, probed_at: '2026-11-10T08:05:00.000Z', caller: 'wizard.lz-live.probe' } } }));
    writeFileSync(join(wsp, 'latest-lz-live.txt'), 'run-1\n');
    writeFileSync(join(wsp, 'runs', 'run-1', 'otc-prod.platform.lz-live-scan.json'), JSON.stringify({ meta: { scope_id: 'platform', observed_at: '2026-11-10T09:00:00.000Z' }, offering: { services: [1, 2, 3] }, estate: { resources: [1, 2] } }));
    const items = probeCheck(ws, new Date('2026-11-11T08:00:00.000Z'));
    expect(items[0]).toMatchObject({ label: 'otc-prod / platform', state: 'warn', short: 'write-capable, accepted for this run; SWAO only reads' });
    expect(items[0]?.detail).toContain('write-capable');
    expect(items[0]?.detail).toContain('coverage 56 readable / 2 not readable');
    expect(items[0]?.detail).toContain('probed 2026-11-10 08:05 UTC');
    expect(items[0]?.detail).toContain('last run 2026-11-10 09:00 UTC: 3 services, 2 resources read');
    expect(items[0]?.detail).not.toContain('...');
    expect(items[1]).toMatchObject({ label: 'aws-demo / platform', state: 'warn' });
    expect(items[1]?.detail).toContain('not probed yet');
    expect(items[1]?.detail).toContain('probe again in the Probe step of this setup');
    for (const it of items) { expect(it.detail).not.toContain('swao '); expect(it.detail).not.toContain('<'); }
  });

  it('#4496: a stored refused sign-in is a fail row on the Ready step, as on the Probe step', () => {
    const ws = workspace();
    const wsp = join(ws, 'landing-zones', 'otc-prod', 'wsp');
    mkdirSync(wsp, { recursive: true });
    writeFileSync(join(wsp, 'last-probe.json'), JSON.stringify({ schema: 'lz-probe-record/1', scopes: { platform: { read_only: 'login-failed', readable: 0, unreadable: 0, reason: 'authentication failed (HTTP 400)', probed_at: '2026-11-10T08:05:00.000Z', caller: 'wizard.lz-live.probe' } } }));
    expect(probeCheck(ws, new Date('2026-11-11T08:00:00.000Z'))[0]).toMatchObject({ label: 'otc-prod / platform', state: 'fail' });
  });

  it('a verified fresh probe is ok; an old one carries the stale mark', () => {
    const ws = workspace();
    const wsp = join(ws, 'landing-zones', 'otc-prod', 'wsp');
    mkdirSync(wsp, { recursive: true });
    writeFileSync(join(wsp, 'last-probe.json'), JSON.stringify({ schema: 'lz-probe-record/1', scopes: { platform: { read_only: 'verified', readable: 9, unreadable: 0, probed_at: '2026-11-10T08:05:00.000Z', caller: 'lz.probe' } } }));
    expect(probeCheck(ws, new Date('2026-11-11T08:00:00.000Z'))[0]).toMatchObject({ state: 'ok' });
    const stale = probeCheck(ws, new Date('2026-11-30T08:00:00.000Z'))[0]?.detail ?? '';
    expect(stale).toContain('stale');
    expect(stale).not.toContain('swao ');
  });
});

describe('Policy Baseline step logic (#4195, validation as #3869)', () => {
  it('without a baseline points to the GitHub folder and offers no install command (Design 123 D-07)', () => {
    const ws = workspace();
    expect(findPolicyBaselines(ws, PROBE_OPTS).baselines).toEqual([]);
    const text = [...missingBaselineLines(), ...baselineCheck(ws, PROBE_OPTS).map((c) => c.detail ?? '')].join('\n');
    expect(text).toContain(COMMUNITY_FRAMEWORKS_URL);
    expect(text).toContain('wsp/inputs/catalogs/community/');
    expect(text).not.toMatch(/\bswao\s|--|framework install/);
    expect(baselineCheck(ws, PROBE_OPTS)[0]?.state).toBe('missing');
  });

  it('reports a valid copy with its policy counts', () => {
    const ws = workspace();
    copyBaseline(ws);
    const [b] = findPolicyBaselines(ws, PROBE_OPTS).baselines;
    expect(b).toMatchObject({ id: 'CLIENT_LZ_POLICY_BASELINE', status: 'ok', stale: false });
    expect(b!.policies).toBeGreaterThan(0);
    expect(baselineCheck(ws, PROBE_OPTS)[0]?.label).toBe('Policy baseline CLIENT_LZ_POLICY_BASELINE');
  });

  it('a renamed copy is found by its framework id, an invalid one fails, a stale one warns', () => {
    const ws = workspace();
    const dir = copyBaseline(ws, 'our-baseline');
    const file = join(dir, 'policy-baseline.yaml');
    const text = readFileSync(file, 'utf-8');
    writeFileSync(file, text.replace('catalogue_version: "1.0.0"', 'catalogue_version: "0.9.0"'));
    const [stale] = findPolicyBaselines(ws, PROBE_OPTS).baselines;
    expect(stale).toMatchObject({ id: 'CLIENT_LZ_POLICY_BASELINE', status: 'ok', stale: true, catalogueVersion: '0.9.0' });
    expect(baselineCheck(ws, PROBE_OPTS)[0]?.state).toBe('warn');

    writeFileSync(file, text.replace('catalogue_version: "1.0.0"', 'catalogue_version: "1.0.0"\nunexpected_key: 1'));
    const [invalid] = findPolicyBaselines(ws, PROBE_OPTS).baselines;
    expect(invalid?.status).toBe('invalid');
    expect(invalid?.messages.join('\n')).toContain('policy-baseline.yaml is invalid');
    expect(baselineCheck(ws, PROBE_OPTS)[0]?.state).toBe('missing');
  });

  it('the initial selection is the stored frameworks, else the valid baselines', () => {
    const avail = [{ id: 'BSI_C5', folder: 'bsi-c5', version: '1' }, { id: 'CLIENT_LZ_POLICY_BASELINE', folder: 'client-lz-policy-baseline', version: '1.0.0' }];
    const base = [{ id: 'CLIENT_LZ_POLICY_BASELINE', status: 'ok' as const, policies: 1, enabled: 1, disabled: 0, notSet: 0, catalogueVersion: '1.0.0', shippedVersion: '1.0.0', stale: false, messages: [] }];
    expect(initialFrameworkSelection({ id: 'a', provider: 'otc', scopes: [], frameworks: ['BSI_C5', 'GONE'] }, avail, base)).toEqual(['BSI_C5']);
    expect(initialFrameworkSelection({ id: 'a', provider: 'otc', scopes: [], frameworks: ['bsi-c5', 'client_lz_policy_baseline'] }, avail, base)).toEqual(['BSI_C5', 'CLIENT_LZ_POLICY_BASELINE']);
    expect(initialFrameworkSelection({ id: 'a', provider: 'otc', scopes: [], frameworks: [] }, avail, base)).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
    expect(initialFrameworkSelection({ id: 'a', provider: 'otc', scopes: [], frameworks: [] }, avail, [{ ...base[0]!, status: 'invalid' }])).toEqual([]);
  });

  it('lists the workspace frameworks only (never the bundled ones)', () => {
    const ws = workspace();
    expect(workspaceFrameworks(ws)).toEqual([]);
    copyBaseline(ws);
    expect(workspaceFrameworks(ws).map((f) => f.id)).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
  });
});

describe('Enter keeps the stored value (Design 125 section 4)', () => {
  const avail = [{ id: 'BSI_C5', folder: 'bsi-c5', version: '1' }];
  const lz = (frameworks: string[]) => ({ id: 'a', provider: 'otc', scopes: [], frameworks });
  it('an unchanged selection over a stored value writes nothing, even when the value names a folder or is gone', () => {
    expect(frameworksToSave(lz(['bsi-c5', 'GONE']), avail, ['BSI_C5'], ['BSI_C5'])).toBeNull();
    expect(frameworksToSave(lz(['GONE']), avail, [], [])).toBeNull();
  });
  it('a changed selection keeps the stored values the catalogue does not offer', () => {
    expect(frameworksToSave(lz(['bsi-c5', 'GONE']), avail, ['BSI_C5'], [])).toEqual(['GONE']);
    expect(frameworksToSave(lz([]), avail, [], ['BSI_C5'])).toEqual(['BSI_C5']);
  });
});

describe('landing_zones[].frameworks write (Design 125 section 5.7)', () => {
  it('writes the frameworks of one landing zone, read back by the section 5.7 reader; the rest of .swao.yml is kept', () => {
    const ws = workspace();
    expect(saveLzFrameworks(ws, 'otc-prod', ['CLIENT_LZ_POLICY_BASELINE', 'BSI_C5'])).toBe('saved');
    const lzs = readLzLiveDefaults(ws).landingZones;
    expect(lzs.find((l) => l.id === 'otc-prod')?.frameworks).toEqual(['BSI_C5', 'CLIENT_LZ_POLICY_BASELINE']);
    expect(lzs.find((l) => l.id === 'aws-demo')?.frameworks).toEqual([]);
    const text = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(text.startsWith(HEAD)).toBe(true);
    expect(text).toContain('# trailing comment kept\nregimes_active: [bsi-c5]');
  });

  it('an unchanged selection writes nothing; an empty selection drops the key', () => {
    const ws = workspace();
    saveLzFrameworks(ws, 'otc-prod', ['BSI_C5']);
    const before = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(saveLzFrameworks(ws, 'otc-prod', ['BSI_C5'])).toBe('unchanged');
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toBe(before);
    expect(saveLzFrameworks(ws, 'otc-prod', [])).toBe('saved');
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).not.toContain('frameworks:\n      - BSI_C5');
    expect(readLzLiveDefaults(ws).landingZones.every((l) => l.frameworks.length === 0)).toBe(true);
  });

  it('refuses an unknown landing zone', () => {
    expect(() => saveLzFrameworks(workspace(), 'nope', ['BSI_C5'])).toThrow(/not registered/);
  });
});

describe('Org Evidence step logic (#4195, #4050)', () => {
  it('names the folder the run reads, counts documents without the manifest, creates missing folders', () => {
    const ws = workspace();
    expect(evidenceState(ws, 'otc-prod')).toEqual({ lzId: 'otc-prod', folder: 'landing-zones/otc-prod/ingestion/', exists: false, documents: 0 });
    expect(createEvidenceFolders(ws, ['otc-prod', 'aws-demo'])).toEqual(['otc-prod', 'aws-demo']);
    expect(createEvidenceFolders(ws, ['otc-prod'])).toEqual([]);
    const dir = join(ws, 'landing-zones', 'otc-prod', 'ingestion');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'ict_risk_management_framework.pdf'), 'x');
    writeFileSync(join(dir, 'sub', 'policy.docx'), 'x');
    writeFileSync(join(dir, 'ingestion-manifest.json'), '{}');
    writeFileSync(join(dir, '.hidden'), 'x');
    expect(evidenceState(ws, 'otc-prod').documents).toBe(2);
    expect(existsSync(join(ws, 'landing-zones', 'aws-demo', 'ingestion'))).toBe(true);
    expect(evidenceCheck(ws).map((c) => c.state)).toEqual(['ok', 'info']);
  });

  it('#4346: ensureEvidenceFolders creates the missing folders once (idempotent) and the rows say created or the document count', () => {
    const ws = workspace();
    const first = ensureEvidenceFolders(ws, ['otc-prod', 'aws-demo']);
    expect(first.map((o) => o.status)).toEqual(['created', 'created']);
    expect(first.map((o) => evidenceRow(o))).toEqual([
      { level: 'ok', summary: 'landing-zones/otc-prod/ingestion/ created' },
      { level: 'ok', summary: 'landing-zones/aws-demo/ingestion/ created' },
    ]);
    writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'ingestion', 'exit_strategy.pdf'), 'x');
    const second = ensureEvidenceFolders(ws, ['otc-prod', 'aws-demo']);
    expect(second.map((o) => o.status)).toEqual(['exists', 'exists']);
    expect(evidenceRow(second[0]!)).toEqual({ level: 'ok', summary: 'landing-zones/otc-prod/ingestion/ 1 document' });
    expect(readFileSync(join(ws, 'landing-zones', 'otc-prod', 'ingestion', 'exit_strategy.pdf'), 'utf-8')).toBe('x');
  });

  it('#4346: a folder that cannot be created is fail with the reason', () => {
    const ws = workspace();
    writeFileSync(join(ws, 'landing-zones'), 'a file where the folder belongs');
    const [o] = ensureEvidenceFolders(ws, ['otc-prod']);
    expect(o?.status).toBe('failed');
    expect(evidenceRow(o!).level).toBe('fail');
    expect(evidenceRow(o!).summary).toMatch(/^landing-zones\/otc-prod\/ingestion\/ not created: /);
  });

  it('#4346: the Ready row names the folder and the count; the not-evaluated note only for an empty folder', () => {
    const ws = workspace();
    ensureEvidenceFolders(ws, ['otc-prod', 'aws-demo']);
    writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'ingestion', 'exit_strategy.pdf'), 'x');
    const items = evidenceCheck(ws);
    expect(items[0]).toMatchObject({ state: 'ok', detail: 'landing-zones/otc-prod/ingestion/: created, 1 document', short: '1 document' });
    expect(items[1]).toMatchObject({ state: 'info', detail: 'landing-zones/aws-demo/ingestion/: created, 0 documents (optional; organisational controls stay not evaluated)' });
  });

  it('#4346: the expected document names come from the organisational controls of the workspace frameworks', () => {
    const ws = workspace();
    expect(expectedEvidenceInputs(ws)).toEqual([]);
    cpSync(join(communityFrameworksDir, 'dora'), join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'dora'), { recursive: true });
    const names = expectedEvidenceInputs(ws);
    expect(names).toContain('ict_risk_management_framework');
    expect([...names].sort()).toEqual(names);
  });

  it('#4346: the non-interactive LZ Live check creates the folders the same way (CLI parity)', () => {
    const ws = workspace();
    defaultSetupRegistry().branch('lz-live').branch.prepareNonInteractive?.(ws);
    expect(existsSync(join(ws, 'landing-zones', 'otc-prod', 'ingestion'))).toBe(true);
    expect(existsSync(join(ws, 'landing-zones', 'aws-demo', 'ingestion'))).toBe(true);
  });
});

describe('Landing Zone Live branch steps (#4195, Design 125 section 5.5)', () => {
  it('registers Landing Zones, Probe, Policy Baseline and Org Evidence in order, all applicable', () => {
    const steps = defaultSetupRegistry().steps('lz-live');
    expect(steps.map((s) => [s.id, s.label, s.order])).toEqual([
      ['lz-live.connections', 'Landing Zones', 10],
      ['lz-live.probe', 'Probe', 20],
      ['lz-live.baseline', 'Policy Baseline', 30],
      ['lz-live.evidence', 'Org Evidence', 40],
    ]);
    expect(steps.every((s) => s.isApplicable === undefined)).toBe(true);
    expect(steps.slice(1).every((s) => typeof s.check === 'function')).toBe(true);
  });
});
