// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// buildKey / writeLicenseKey require SWAO_LICENSE_SECRET (the Ed25519 signing seed).
// Tests that issue a licence key are skipped when the secret is absent -- mirrors
// generate-tf.test.ts pattern (skipif-over-skip for precondition-blocked tests).
const hasSigning = !!process.env.SWAO_LICENSE_SECRET;
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Command } from 'commander';

import {
  _paths,
  LicenseGuard,
  LicenseTierError,
  LicenseLimitError,
  buildLicenseKey,
} from '@swao/core';
import type { LicensePayload } from '@swao/core';

import { registerLz } from './lz.js';
import { registerLzCatalogueUpdate } from './lz-premium.js';
import { discoverLzCatalogues } from '../catalogue/loader.js';

// ---------------------------------------------------------------------------
// Shared temp home (redirected via _paths so LicenseGuard.load() is sandboxed)
// ---------------------------------------------------------------------------
const TEMP_HOME = join(tmpdir(), `swao-lz-premium-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEMP_HOME, { recursive: true });
  _paths.statePath = join(TEMP_HOME, '.swao-state.json');
  _paths.licensePath = join(TEMP_HOME, '.swao-license.json');
  // Also redirect the legacy licence path, or LicenseGuard migrates the real
  // machine licence from the home directory and Community-tier tests fail.
  _paths.legacyLicencePath = join(TEMP_HOME, '.swao-license-legacy.json');
  if (existsSync(_paths.statePath)) rmSync(_paths.statePath);
  if (existsSync(_paths.licensePath)) rmSync(_paths.licensePath);
});

afterEach(() => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeState(data: object): void {
  writeFileSync(_paths.statePath, JSON.stringify(data), 'utf-8');
}

function writeLicenseKey(payload: LicensePayload): void {
  const key = buildLicenseKey(payload);
  writeFileSync(
    _paths.licensePath,
    JSON.stringify({ key, activated_at: '2026-04-28', tier: payload.tier, exp: payload.exp, licensee: payload.licensee }),
    'utf-8',
  );
}

function fp8(): string {
  writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123def456abc1' });
  return LicenseGuard.load().state.fingerprint.substring(0, 8);
}

// ---------------------------------------------------------------------------
// Minimal fake botocore endpoints.json (one partition, one region, one service)
// ---------------------------------------------------------------------------
const FAKE_GCP_PRODUCTS = {
  'Compute Engine': { 'europe-west3': true, 'us-east1': true },
  'Cloud SQL':      { 'europe-west3': true },
  'Vertex AI':      { 'europe-west3': false, 'us-east1': true },
};

const FAKE_ENDPOINTS = {
  partitions: [
    {
      partition: 'aws',
      regions: {
        'eu-north-1': { description: 'Europe (Stockholm)' },
      },
      services: {
        'eks': {
          endpoints: {
            'eu-north-1': {},
          },
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tier gate tests (via LicenseGuard directly -- no process.exit mocking needed)
// ---------------------------------------------------------------------------

describe('lz catalogue update -- tier gate', () => {
  it('throws LicenseTierError for Community tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).toThrow(LicenseTierError);
  });

  it('high-usage Community throws LicenseTierError, not LicenseLimitError', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).toThrow(LicenseTierError);
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).not.toThrow(LicenseLimitError);
  });

  it.skipIf(!hasSigning)('does not throw for Consultant tier', () => {
    const fingerprint = fp8();
    const payload: LicensePayload = {
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    };
    writeLicenseKey(payload);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).not.toThrow();
  });

  it.skipIf(!hasSigning)('does not throw for Enterprise tier', () => {
    const fingerprint = fp8();
    const payload: LicensePayload = {
      v: 1, tier: 'enterprise', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    };
    writeLicenseKey(payload);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('enterprise');
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Happy path: HTTP fetch (mocked) -- no local file required
// ---------------------------------------------------------------------------

describe('lz catalogue update -- HTTP fetch (mocked)', () => {
  it.skipIf(!hasSigning)('fetches endpoints from GitHub when no --endpoints-path supplied', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-http');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: [] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    // Stub globalThis.fetch to return FAKE_ENDPOINTS (avoids real network call)
    vi.stubGlobal('fetch', async (_url: string) => ({
      ok: true,
      text: async () => JSON.stringify(FAKE_ENDPOINTS),
    }));

    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'aws',
      '--catalogues-dir', fakeCatDir,
      '--dry-run',
    ]);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    // fetch should have been called with the GitHub URL
    expect(vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.stringContaining('raw.githubusercontent.com/boto/botocore'),
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Happy path: --dry-run with a local file override (--endpoints-path / --botocore-path)
// ---------------------------------------------------------------------------

describe('lz catalogue update -- dry-run happy path', () => {
  it.skipIf(!hasSigning)('parses endpoints file and reports regions without writing (Consultant licence)', async () => {
    // write a fake endpoints.json
    const fakeBotp = join(TEMP_HOME, 'endpoints.json');
    writeFileSync(fakeBotp, JSON.stringify(FAKE_ENDPOINTS), 'utf-8');

    // write a fake catalogues dir with index.json
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: [] }),
      'utf-8',
    );

    // write a consultant licence
    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    // prevent process.exit from killing the test runner
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride(); // prevent commander from calling process.exit on --help
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'aws',
      '--botocore-path', fakeBotp,
      '--catalogues-dir', fakeCatDir,
      '--dry-run',
    ]);

    // process.exit should NOT have been called
    expect(exitSpy).not.toHaveBeenCalled();

    // console.log should have been called with a message about eu-north-1
    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('aws:');
    expect(logged).toContain('1 region(s)');
    expect(logged).toContain('[dry-run]');

    // #3298: an index.json from an older workspace is never written
    const indexContent = JSON.parse(readFileSync(join(fakeCatDir, 'index.json'), 'utf-8')) as { catalogues: unknown[] };
    expect(indexContent.catalogues).toHaveLength(0);
  });

  it.skipIf(!hasSigning)('writes aws.json when not dry-run (Consultant licence)', async () => {
    const fakeBotp = join(TEMP_HOME, 'endpoints.json');
    writeFileSync(fakeBotp, JSON.stringify(FAKE_ENDPOINTS), 'utf-8');

    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: [] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'aws',
      '--botocore-path', fakeBotp,
      '--catalogues-dir', fakeCatDir,
    ]);

    // aws.json should have been written
    const awsJson = JSON.parse(readFileSync(join(fakeCatDir, 'aws.json'), 'utf-8')) as {
      meta: { provider: string; regions_count: number };
      regions: Array<{ id: string; services: Array<{ code: string; fulfills: string[] }> }>;
    };
    expect(awsJson.meta.provider).toBe('aws');
    expect(awsJson.meta.regions_count).toBe(1);
    expect(awsJson.regions[0].id).toBe('eu-north-1');
    // eks should map to ['kubernetes']
    const eksSvc = awsJson.regions[0].services.find((s) => s.code === 'eks');
    expect(eksSvc).toBeDefined();
    expect(eksSvc?.fulfills).toContain('kubernetes');

    // #3298: the refresh no longer maintains index.json; an older one is left untouched
    const index = JSON.parse(readFileSync(join(fakeCatDir, 'index.json'), 'utf-8')) as {
      catalogues: Array<{ provider: string }>;
    };
    expect(index.catalogues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STACKIT PIM API mock tests (#0871)
// ---------------------------------------------------------------------------

const FAKE_STACKIT_SKUS = [
  { product: 'Kubernetes Engine', region: 'eu01', deprecated: 'No', maturityModelState: 'ga' },
  { product: 'PostgreSQL Flex',   region: 'global', deprecated: 'No', maturityModelState: 'ga' },
  { product: 'Object Storage',    region: 'eu01', deprecated: 'No', maturityModelState: 'ga' },
  { product: 'OldService',        region: 'eu01', deprecated: 'Yes', maturityModelState: 'ga' },
];

describe('lz catalogue update -- STACKIT PIM API (mocked)', () => {
  it.skipIf(!hasSigning)('fetches PIM API SKUs and writes stackit.json', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-stackit');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: [] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    // Stub globalThis.fetch to return mock PIM API data
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('pim.api.stackit.cloud')) {
        return { ok: true, json: async () => ({ services: FAKE_STACKIT_SKUS }) };
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'stackit',
      '--catalogues-dir', fakeCatDir,
    ]);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();

    // fetch should have been called with the PIM API URL
    expect(vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.stringContaining('pim.api.stackit.cloud'),
      expect.any(Object),
    );

    // stackit.json should have been written
    const stackitJson = JSON.parse(readFileSync(join(fakeCatDir, 'stackit.json'), 'utf-8')) as {
      meta: { provider: string; confidence: string; source: { mode: string } };
      regions: Array<{ id: string; services: Array<{ code: string; fulfills: string[] }> }>;
    };
    expect(stackitJson.meta.provider).toBe('stackit');
    expect(stackitJson.meta.confidence).toBe('medium');
    expect(stackitJson.meta.source.mode).toBe('pim-api-stackit');

    // eu01 should have kubernetes-engine
    const eu01 = stackitJson.regions.find((r) => r.id === 'eu01');
    expect(eu01).toBeDefined();
    const k8s = eu01?.services.find((s) => s.code === 'kubernetes-engine');
    expect(k8s).toBeDefined();
    expect(k8s?.fulfills).toContain('kubernetes');

    // eu02 should have postgresql-flex (expanded from global)
    const eu02 = stackitJson.regions.find((r) => r.id === 'eu02');
    expect(eu02).toBeDefined();
    expect(eu02?.services.some((s) => s.code === 'postgresql-flex')).toBe(true);

    // deprecated OldService should NOT appear
    expect(eu01?.services.some((s) => s.name === 'OldService')).toBe(false);

    // #3298: the list fields live only in the file's meta block (no index.json entry)
    const stackitMeta = (JSON.parse(readFileSync(join(fakeCatDir, 'stackit.json'), 'utf-8')) as {
      meta: { source: { mode: string }; confidence: string };
    }).meta;
    expect(stackitMeta.source.mode).toBe('pim-api-stackit');
    expect(stackitMeta.confidence).toBe('medium');
    expect((JSON.parse(readFileSync(join(fakeCatDir, 'index.json'), 'utf-8')) as { catalogues: unknown[] }).catalogues).toEqual([]);

    vi.unstubAllGlobals();
  });

  it.skipIf(!hasSigning)('dry-run with STACKIT: logs stats without writing stackit.json', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-stackit-dry');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: [] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('pim.api.stackit.cloud')) {
        return { ok: true, json: async () => ({ services: FAKE_STACKIT_SKUS }) };
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'stackit',
      '--catalogues-dir', fakeCatDir,
      '--dry-run',
    ]);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();

    // stackit.json should NOT have been written
    expect(existsSync(join(fakeCatDir, 'stackit.json'))).toBe(false);

    // console.log should mention [dry-run]
    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[dry-run]');
    expect(logged).toContain('stackit');

    vi.unstubAllGlobals();
  });

  it('Community tier exits with code 2 for stackit too', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).toThrow(LicenseTierError);
  });
});

// ---------------------------------------------------------------------------
// GCP: HTTP fetch mock (no real network call -- vi.stubGlobal intercepts)
// CLAUDE.md §5.9: mock-server test required before first real API invocation.
// ---------------------------------------------------------------------------

describe('lz catalogue update -- GCP HTTP fetch (mocked, #0870)', () => {
  it.skipIf(!hasSigning)('fetches GCP products from GitHub when no --products-path supplied', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-gcp-http');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: ['gcp'] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    vi.stubGlobal('fetch', async (_url: string) => ({
      ok: true,
      text: async () => JSON.stringify(FAKE_GCP_PRODUCTS),
    }));

    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'gcp',
      '--catalogues-dir', fakeCatDir,
      '--dry-run',
    ]);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.stringContaining('GoogleCloudPlatform/region-picker'),
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// GCP: dry-run and write happy paths with --products-path (#0870)
// ---------------------------------------------------------------------------

describe('lz catalogue update -- GCP dry-run happy path (#0870)', () => {
  it.skipIf(!hasSigning)('parses products.json and reports regions without writing (Consultant licence)', async () => {
    const fakeProductsPath = join(TEMP_HOME, 'products.json');
    writeFileSync(fakeProductsPath, JSON.stringify(FAKE_GCP_PRODUCTS), 'utf-8');

    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-gcp-dryrun');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: ['gcp'] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'gcp',
      '--products-path', fakeProductsPath,
      '--catalogues-dir', fakeCatDir,
      '--dry-run',
    ]);

    expect(exitSpy).not.toHaveBeenCalled();

    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('gcp:');
    expect(logged).toContain('region(s)');
    expect(logged).toContain('[dry-run]');

    const gcpJsonPath = join(fakeCatDir, 'gcp.json');
    expect(existsSync(gcpJsonPath)).toBe(false);
  });

  it.skipIf(!hasSigning)('writes gcp.json when not dry-run (Consultant licence)', async () => {
    const fakeProductsPath = join(TEMP_HOME, 'products-write.json');
    writeFileSync(fakeProductsPath, JSON.stringify(FAKE_GCP_PRODUCTS), 'utf-8');

    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-gcp-write');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(
      join(fakeCatDir, 'index.json'),
      JSON.stringify({ catalogues: [], coming_soon: ['gcp'] }),
      'utf-8',
    );

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'gcp',
      '--products-path', fakeProductsPath,
      '--catalogues-dir', fakeCatDir,
    ]);

    const gcpJson = JSON.parse(readFileSync(join(fakeCatDir, 'gcp.json'), 'utf-8')) as {
      meta: { provider: string; regions_count: number; source: { mode: string; tool: string }; confidence: string };
      regions: Array<{ id: string; services: Array<{ code: string; fulfills: string[]; source: string }> }>;
    };
    expect(gcpJson.meta.provider).toBe('gcp');
    expect(gcpJson.meta.source.mode).toBe('scrape');
    expect(gcpJson.meta.source.tool).toBe('region-picker-github');
    expect(gcpJson.meta.confidence).toBe('medium');
    expect(gcpJson.meta.regions_count).toBe(2);
    const fra = gcpJson.regions.find((r) => r.id === 'europe-west3')!;
    expect(fra).toBeDefined();
    const computeSvc = fra.services.find((s) => s.code === 'Compute Engine');
    expect(computeSvc).toBeDefined();
    expect(computeSvc?.fulfills).toContain('vm_compute');
    const sqlSvc = fra.services.find((s) => s.code === 'Cloud SQL');
    expect(sqlSvc).toBeDefined();
    expect(sqlSvc?.fulfills).toContain('postgresql');

    // #3298: listed from the file's own meta block; the older index.json is untouched
    const gcpMeta = (JSON.parse(readFileSync(join(fakeCatDir, 'gcp.json'), 'utf-8')) as {
      meta: { source: { mode: string }; confidence: string; regions_count?: number };
    }).meta;
    expect(gcpMeta.source.mode).toBe('scrape');
    expect(gcpMeta.regions_count).toBe(2);
    expect(gcpMeta.confidence).toBe('medium');
    const index = JSON.parse(readFileSync(join(fakeCatDir, 'index.json'), 'utf-8')) as { catalogues: unknown[]; coming_soon: string[] };
    expect(index).toEqual({ catalogues: [], coming_soon: ['gcp'] });
  });
});

// ---------------------------------------------------------------------------
// Azure Retail Prices API -- mock-server tests (CLAUDE.md §5.9 requirement)
// ---------------------------------------------------------------------------

// Minimal 2-page Azure Retail Prices API response.
// Page 1 returns two products in westeurope; page 2 returns one product in
// northeurope with NextPageLink: null (end of pages).
const AZURE_PAGE_1 = {
  Items: [
    { serviceName: 'Virtual Machines', armRegionName: 'westeurope', retailPrice: 0.096, unitOfMeasure: '1 Hour', type: 'Consumption', isPrimaryMeterRegion: true },
    { serviceName: 'Storage', armRegionName: 'westeurope', retailPrice: 0.018, unitOfMeasure: '1 GB/Month', type: 'Consumption', isPrimaryMeterRegion: true },
  ],
  NextPageLink: 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$skip=1000',
  Count: 2,
};

const AZURE_PAGE_2 = {
  Items: [
    { serviceName: 'Azure Kubernetes Service', armRegionName: 'northeurope', retailPrice: 0.0, unitOfMeasure: '1 Hour', type: 'Consumption', isPrimaryMeterRegion: true },
  ],
  NextPageLink: null,
  Count: 1,
};

// Stubs a consultant-tier guard without requiring SWAO_LICENSE_SECRET.
function stubConsultantGuard(): void {
  const fakeGuard = {
    state: { tier: 'consultant' as const, fingerprint: 'abc123def456abc1', firstRun: '2026-04-28', assessmentCount: 0, daysElapsed: 70 },
    requireTier: () => undefined,
    requireFeature: () => undefined, // #3324: the command gates with requireFeature('lz-catalogue-update')
  } as unknown as LicenseGuard;
  vi.spyOn(LicenseGuard, 'load').mockReturnValue(fakeGuard);
}

describe('lz catalogue update -- Azure Retail Prices API mock-server (#0869)', () => {
  it('throws LicenseTierError for Community tier on azure provider', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireTier('consultant', { feature: 'lz catalogue update' })).toThrow(LicenseTierError);
  });

  it('fetches Azure Retail Prices API with 2-page pagination (mocked)', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-azure');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(join(fakeCatDir, 'index.json'), JSON.stringify({ catalogues: [], coming_soon: [] }), 'utf-8');

    stubConsultantGuard();
    const mockFetch = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, json: async () => AZURE_PAGE_1 }))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => AZURE_PAGE_2 }));
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => { throw new Error('process.exit:' + String(_code ?? '')); });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', '--provider', 'azure', '--catalogues-dir', fakeCatDir, '--skip-prices']);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('prices.azure.com'), expect.any(Object));

    const azureJson = JSON.parse(readFileSync(join(fakeCatDir, 'azure.json'), 'utf-8')) as {
      meta: { provider: string; source: { mode: string; tool: string }; confidence: string };
      regions: Array<{ id: string; services: Array<{ code: string; fulfills: string[] }> }>;
    };
    expect(azureJson.meta.provider).toBe('azure');
    expect(azureJson.meta.source.mode).toBe('api');
    expect(azureJson.meta.source.tool).toBe('retail-prices-api');
    expect(azureJson.meta.confidence).toBe('high');
    const regionIds = azureJson.regions.map((r) => r.id);
    expect(regionIds).toContain('westeurope');
    expect(regionIds).toContain('northeurope');
    const we = azureJson.regions.find((r) => r.id === 'westeurope');
    const vmSvc = we?.services.find((s) => s.code === 'Virtual Machines');
    expect(vmSvc).toBeDefined();
    expect(vmSvc?.fulfills).toContain('vm_compute');
    const ne = azureJson.regions.find((r) => r.id === 'northeurope');
    const aksSvc = ne?.services.find((s) => s.code === 'Azure Kubernetes Service');
    expect(aksSvc).toBeDefined();
    expect(aksSvc?.fulfills).toContain('kubernetes');

    // #3298: no index.json entry; the meta block is the only record
    expect((azureJson as unknown as { meta: { source: { mode: string } } }).meta.source.mode).toBe('api');
    const index = JSON.parse(readFileSync(join(fakeCatDir, 'index.json'), 'utf-8')) as { catalogues: unknown[] };
    expect(index.catalogues).toEqual([]);

    vi.unstubAllGlobals();
  });

  it('#3298: a fresh catalogue folder gets the refreshed file only, no index.json; the list reads its meta', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-azure-fresh');
    rmSync(fakeCatDir, { recursive: true, force: true });

    stubConsultantGuard();
    const mockFetch = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, json: async () => AZURE_PAGE_1 }))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => AZURE_PAGE_2 }));
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => { throw new Error('process.exit:' + String(_code ?? '')); });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', '--provider', 'azure', '--catalogues-dir', fakeCatDir, '--skip-prices']);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(existsSync(join(fakeCatDir, 'azure.json'))).toBe(true);
    expect(existsSync(join(fakeCatDir, 'index.json'))).toBe(false);
    const listed = discoverLzCatalogues(fakeCatDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ provider: 'azure', source: 'api', confidence: 'high' });
    expect(listed[0]!.regions_count).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it('--dry-run does not write azure.json', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-azure-dry');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(join(fakeCatDir, 'index.json'), JSON.stringify({ catalogues: [], coming_soon: [] }), 'utf-8');

    stubConsultantGuard();
    const mockFetch = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, json: async () => AZURE_PAGE_1 }))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => AZURE_PAGE_2 }));
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => { throw new Error('process.exit:' + String(_code ?? '')); });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', '--provider', 'azure', '--catalogues-dir', fakeCatDir, '--skip-prices', '--dry-run']);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
    expect(existsSync(join(fakeCatDir, 'azure.json'))).toBe(false);
    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[dry-run]');
    expect(logged).toContain('azure:');
    const indexContent = JSON.parse(readFileSync(join(fakeCatDir, 'index.json'), 'utf-8')) as { catalogues: unknown[] };
    expect(indexContent.catalogues).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('mergeRetiredServices: services absent from fresh Azure data get retired_at stamp', async () => {
    const fakeCatDir = join(TEMP_HOME, 'lz-catalogues-azure-retire');
    mkdirSync(fakeCatDir, { recursive: true });
    writeFileSync(join(fakeCatDir, 'index.json'), JSON.stringify({ catalogues: [], coming_soon: [] }), 'utf-8');

    const oldCatalogue = {
      meta: { schema_version: '0.1', name: 'Azure service catalogue', provider: 'azure', last_updated: '2026-06-01', source: { mode: 'api', tool: 'retail-prices-api', operator: 'SWAO operator' }, confidence: 'high', regions_count: 1 },
      regions: [{
        id: 'westeurope', country: 'NL',
        sovereignty: { residency_country: 'NL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: [], certifications: [] },
        services: [
          { code: 'Virtual Machines', name: 'Virtual Machines', status: 'ga', capabilities: [], fulfills: ['vm_compute'], key_custody: ['provider-managed'], last_verified: '2026-06-01', source: 'retail-prices-api' },
          { code: 'Legacy Service', name: 'Legacy Service', status: 'ga', capabilities: [], fulfills: [], key_custody: ['provider-managed'], last_verified: '2026-06-01', source: 'retail-prices-api' },
        ],
      }],
    };
    writeFileSync(join(fakeCatDir, 'azure.json'), JSON.stringify(oldCatalogue), 'utf-8');

    stubConsultantGuard();
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        Items: [{ serviceName: 'Virtual Machines', armRegionName: 'westeurope', retailPrice: 0.096, unitOfMeasure: '1 Hour', type: 'Consumption', isPrimaryMeterRegion: true }],
        NextPageLink: null,
        Count: 1,
      }),
    }));
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => { throw new Error('process.exit:' + String(_code ?? '')); });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', '--provider', 'azure', '--catalogues-dir', fakeCatDir, '--skip-prices']);

    const azureJson = JSON.parse(readFileSync(join(fakeCatDir, 'azure.json'), 'utf-8')) as {
      regions: Array<{ id: string; services: Array<{ code: string; status: string; retired_at?: string }> }>;
    };
    const we = azureJson.regions.find((r) => r.id === 'westeurope');
    const vmSvc = we?.services.find((s) => s.code === 'Virtual Machines');
    expect(vmSvc?.status).toBe('ga');
    expect(vmSvc?.retired_at).toBeUndefined();
    const legacySvc = we?.services.find((s) => s.code === 'Legacy Service');
    expect(legacySvc).toBeDefined();
    expect(legacySvc?.status).toBe('retired');
    const today = new Date().toISOString().slice(0, 10);
    expect(legacySvc?.retired_at).toBe(today);

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Workspace-discovery path (#0905): no --catalogues-dir supplied; command must
// find the workspace via .swao.yml and create <workspace>/lz-catalogues/.
// This is the regression test for the ENOENT-in-pkg-snapshot bug.
// ---------------------------------------------------------------------------

describe('lz catalogue update -- workspace auto-discovery (no --catalogues-dir)', () => {
  it.skipIf(!hasSigning)('creates <workspace>/lz-catalogues and writes catalogue when dir absent', async () => {
    const fakeWorkspace = join(TEMP_HOME, 'workspace-auto');
    mkdirSync(fakeWorkspace, { recursive: true });
    writeFileSync(join(fakeWorkspace, '.swao.yml'), 'workspace:\n  name: test\n', 'utf-8');

    const fakeBotp = join(TEMP_HOME, 'endpoints-auto.json');
    writeFileSync(fakeBotp, JSON.stringify(FAKE_ENDPOINTS), 'utf-8');

    const fingerprint = fp8();
    writeLicenseKey({
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fingerprint, iat: '2026-04-28',
    });

    vi.spyOn(process, 'cwd').mockReturnValue(fakeWorkspace);
    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);

    await program.parseAsync([
      'node', 'swao', 'lz', 'catalogue', 'update', '--skip-prices',
      '--provider', 'aws',
      '--endpoints-path', fakeBotp,
    ]);

    expect(vi.mocked(process.exit)).not.toHaveBeenCalled();

    const expectedDir = join(fakeWorkspace, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
    expect(existsSync(expectedDir)).toBe(true);
    // #3298: the bootstrap seeds no index.json; the folder is found by its catalogue files
    expect(existsSync(join(expectedDir, 'index.json'))).toBe(false);
    expect(existsSync(join(expectedDir, 'aws.json'))).toBe(true);

    const awsJson = JSON.parse(readFileSync(join(expectedDir, 'aws.json'), 'utf-8')) as {
      meta: { provider: string };
      regions: Array<{ id: string }>;
    };
    expect(awsJson.meta.provider).toBe('aws');
    expect(awsJson.regions[0].id).toBe('eu-north-1');
  });
});

// ---------------------------------------------------------------------------
// #3288 (Design 110 D-23): the same run refreshes the VM price table of the
// service cost model. A node:http mock server stands in for the Azure Retail
// Prices API (CLAUDE.md §5.9); the azure service catalogue itself comes from
// --azure-prices-path so no other request is made.
// ---------------------------------------------------------------------------

describe('lz catalogue update -- VM price refresh (#3288, mock server)', () => {
  const priceItem = (armSkuName: string, productName: string, retailPrice: number) => ({
    currencyCode: 'USD', retailPrice, armRegionName: 'germanywestcentral', armSkuName, meterName: armSkuName.replace('Standard_', '').replace('_', ' '),
    skuName: armSkuName.replace('Standard_', '').replace('_', ' '), productName, serviceName: 'Virtual Machines', unitOfMeasure: '1 Hour',
    type: 'Consumption', effectiveStartDate: '2019-09-01T00:00:00Z',
  });

  async function startMock(status: number): Promise<{ base: string; urls: string[]; close: () => Promise<void> }> {
    const urls: string[] = [];
    const server = createServer((req, res) => {
      urls.push(`${req.method} ${req.url}`);
      if (status !== 200) { res.writeHead(status); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Items: [
        priceItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 0.111),
        priceItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series Windows', 0.222),
      ], NextPageLink: null }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, urls, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
  }

  function setup(name: string): { dir: string; pricesFile: string } {
    const dir = join(TEMP_HOME, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ catalogues: [], coming_soon: [] }), 'utf-8');
    const pricesFile = join(TEMP_HOME, `${name}-azure-page.json`);
    writeFileSync(pricesFile, JSON.stringify(AZURE_PAGE_2), 'utf-8');
    stubConsultantGuard();
    vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => { throw new Error('process.exit:' + String(_code ?? '')); });
    return { dir, pricesFile };
  }

  async function run(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerLz(program);
    registerLzCatalogueUpdate(program);
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', ...args]);
  }

  it('--provider azure writes prices/vm-prices.json with the fetched Azure prices and keeps the bundled AWS prices', async () => {
    const mock = await startMock(200);
    try {
      const { dir, pricesFile } = setup('lz-prices-ok');
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await run(['--provider', 'azure', '--catalogues-dir', dir, '--azure-prices-path', pricesFile, '--azure-price-api', mock.base]);

      expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
      expect(mock.urls).toHaveLength(1);
      expect(mock.urls[0]).toMatch(/^GET \/api\/retail\/prices\?api-version=2023-01-01-preview&\$filter=/);
      expect(existsSync(join(dir, 'azure.json'))).toBe(true);
      const table = JSON.parse(readFileSync(join(dir, 'prices', 'vm-prices.json'), 'utf-8')) as {
        meta: { sources: Array<{ provider: string; url: string }> };
        prices: Array<{ provider: string; sku: string; os: string; price_per_hour: number }>;
      };
      const az = table.prices.filter((p) => p.provider === 'azure');
      expect(az).toEqual([
        expect.objectContaining({ sku: 'D2s_v3', os: 'linux', price_per_hour: 0.111 }),
        expect.objectContaining({ sku: 'D2s_v3', os: 'windows', price_per_hour: 0.222 }),
      ]);
      expect(table.meta.sources.find((s) => s.provider === 'azure')!.url.startsWith(mock.base)).toBe(true);
      // AWS was not refreshed (provider azure): its rows come from the bundled table.
      expect(table.prices.some((p) => p.provider === 'aws' && p.sku === 'm5.large' && p.os === 'windows')).toBe(true);
      const out = logs.mock.calls.map((c) => String(c[0])).join('\n');
      expect(out).toMatch(/prices: wrote .*vm-prices\.json/);
      // The TUI progress bar counts "written:"/"updated:" lines; price lines must not add to it.
      expect(out.split('\n').filter((l) => /^\s*(updated|written):/.test(l) && l.includes('vm-prices'))).toEqual([]);
    } finally {
      await mock.close();
    }
  });

  it('a failing price API (HTTP 500) is a warning: the catalogue is written, no price table, no exit', async () => {
    const mock = await startMock(500);
    try {
      const { dir, pricesFile } = setup('lz-prices-500');
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await run(['--provider', 'azure', '--catalogues-dir', dir, '--azure-prices-path', pricesFile, '--azure-price-api', mock.base]);

      expect(vi.mocked(process.exit)).not.toHaveBeenCalled();
      expect(existsSync(join(dir, 'azure.json'))).toBe(true);
      expect(existsSync(join(dir, 'prices', 'vm-prices.json'))).toBe(false);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/prices: azure price fetch failed: HTTP 500.*keeping the previous azure prices/);
    } finally {
      await mock.close();
    }
  });

  it('--dry-run fetches but does not write the price table; --skip-prices makes no price request', async () => {
    const mock = await startMock(200);
    try {
      const { dir, pricesFile } = setup('lz-prices-dry');
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await run(['--provider', 'azure', '--catalogues-dir', dir, '--azure-prices-path', pricesFile, '--azure-price-api', mock.base, '--dry-run']);
      expect(existsSync(join(dir, 'prices', 'vm-prices.json'))).toBe(false);
      expect(logs.mock.calls.map((c) => String(c[0])).join('\n')).toContain('prices: [dry-run] would write');
      expect(mock.urls).toHaveLength(1);

      await run(['--provider', 'azure', '--catalogues-dir', dir, '--azure-prices-path', pricesFile, '--azure-price-api', mock.base, '--skip-prices']);
      expect(mock.urls).toHaveLength(1);
      expect(existsSync(join(dir, 'prices', 'vm-prices.json'))).toBe(false);
    } finally {
      await mock.close();
    }
  });
});
