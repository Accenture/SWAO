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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync } from 'fs';
import { runMeshstackChecks } from './meshstack-adapter.js';
import type { MeshstackAdapterConfig } from './meshstack-adapter.js';
import { LandingZoneReadinessResultSchema } from '../../schema/wsp-lzr.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpStub(content: object): string {
  const dir = join(tmpdir(), `mesh-adapter-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'lz-meshstack-snapshot.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const BASE_CONFIG: MeshstackAdapterConfig = {
  platformId: 'stackit-de-01',
  landingZoneId: 'lz-stackit-de-01',
  providerId: 'stackit_de_sovereign',
};

const CLEAN_STUB = {
  platform_id: 'stackit-de-01',
  tenant_exists: true,
  building_block_definitions: [
    { identifier: 'stackit-ske', displayName: 'STACKIT Kubernetes Engine (SKE)', status: 'ACTIVE' },
    { identifier: 'stackit-postgresql', displayName: 'STACKIT PostgreSQL Flex', status: 'ACTIVE' },
    { identifier: 'stackit-redis', displayName: 'STACKIT Redis', status: 'ACTIVE' },
  ],
  building_block_instances: [
    { definitionIdentifier: 'stackit-ske', state: 'SUCCEEDED', displayName: 'ghostfolio-ske' },
    { definitionIdentifier: 'stackit-postgresql', state: 'SUCCEEDED', displayName: 'ghostfolio-pg' },
    { definitionIdentifier: 'stackit-redis', state: 'SUCCEEDED', displayName: 'ghostfolio-redis' },
  ],
  quota_supported: false,
};

// ---------------------------------------------------------------------------
// Ghostfolio clean stub -- all services ready
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- ghostfolio clean stub', () => {
  it('returns overall_verdict: ready from ghostfolio stub file', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(result.overall_verdict).toBe('ready');
  });

  it('service_checks: kubernetes BB SUCCEEDED -> status ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const k8s = result.service_checks.find((s) => s.service === 'kubernetes');
    expect(k8s?.status).toBe('ready');
    expect(k8s?.provisioned_in_lz).toBe(true);
  });

  it('service_checks: postgresql BB SUCCEEDED -> status ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const pg = result.service_checks.find((s) => s.service === 'postgresql');
    expect(pg?.status).toBe('ready');
  });

  it('service_checks: redis BB SUCCEEDED -> status ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const redis = result.service_checks.find((s) => s.service === 'redis');
    expect(redis?.status).toBe('ready');
  });

  it('no blockers in clean stub', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(result.blockers).toHaveLength(0);
  });

  it('output validates against LandingZoneReadinessResultSchema', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(() => LandingZoneReadinessResultSchema.parse(result)).not.toThrow();
  });

  it('ingestion_strategy is meshcloud in stub mode', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.ingestion_strategy).toBe('meshcloud');
  });
});

// ---------------------------------------------------------------------------
// Missing tenant -- advisory verdict
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- missing tenant', () => {
  it('tenant_exists=false -> LZ-SVC-01 warning + overall_verdict: advisory', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, tenant_exists: false, building_block_instances: [] });
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    expect(result.overall_verdict).toBe('advisory');
    const warn = result.warnings.find((w) => w.check_id === 'LZ-SVC-01');
    expect(warn).toBeDefined();
    expect(warn?.description).toContain('stackit-de-01');
  });
});

// ---------------------------------------------------------------------------
// Missing BB instance -- advisory verdict
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- missing BB', () => {
  it('redis BB absent from instances -> LZ-MESH-03 warning + overall_verdict: advisory', async () => {
    const snapshotFile = makeTmpStub({
      ...CLEAN_STUB,
      building_block_instances: [
        { definitionIdentifier: 'stackit-ske', state: 'SUCCEEDED', displayName: 'ghostfolio-ske' },
        { definitionIdentifier: 'stackit-postgresql', state: 'SUCCEEDED', displayName: 'ghostfolio-pg' },
        // redis BB removed
      ],
    });
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(result.overall_verdict).toBe('advisory');
    const redisSvc = result.service_checks.find((s) => s.service === 'redis');
    expect(redisSvc?.status).toBe('warning');
  });

  it('BB in non-SUCCEEDED state is treated as absent', async () => {
    const snapshotFile = makeTmpStub({
      ...CLEAN_STUB,
      building_block_instances: [
        { definitionIdentifier: 'stackit-ske', state: 'FAILED', displayName: 'ghostfolio-ske' },
      ],
    });
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    const k8s = result.service_checks.find((s) => s.service === 'kubernetes');
    expect(k8s?.status).toBe('warning');
    expect(result.overall_verdict).toBe('advisory');
  });
});

// ---------------------------------------------------------------------------
// Stub mode: no credential access
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- stub mode isolation', () => {
  it('stub mode succeeds without SWAO_CREDENTIAL_MESHSTACK_API_KEY env var', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const saved = process.env['SWAO_CREDENTIAL_MESHSTACK_API_KEY'];
    delete process.env['SWAO_CREDENTIAL_MESHSTACK_API_KEY'];
    try {
      const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
      expect(result.overall_verdict).toBe('ready');
    } finally {
      if (saved !== undefined) process.env['SWAO_CREDENTIAL_MESHSTACK_API_KEY'] = saved;
    }
  });

  it('provider_id and landing_zone_id are reflected in output', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks(
      { ...BASE_CONFIG, snapshotFile, providerId: 'otc_de_sovereign', landingZoneId: 'lz-otc-de-prod' },
      [],
    );
    expect(result.provider_id).toBe('otc_de_sovereign');
    expect(result.landing_zone_id).toBe('lz-otc-de-prod');
  });
});

// ---------------------------------------------------------------------------
// No services requested
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- no required services', () => {
  it('empty requiredServices -> no service_checks, verdict ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.service_checks).toHaveLength(0);
    expect(result.overall_verdict).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Quota supported flag
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- quota', () => {
  it('quota_supported=false -> no quota_checks emitted', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.quota_checks).toHaveLength(0);
  });

  it('quota_supported=true -> quota_check emitted with status ok', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, quota_supported: true });
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.quota_checks).toHaveLength(1);
    expect(result.quota_checks[0]?.status).toBe('ok');
  });
});


// ---------------------------------------------------------------------------
// #0480 live-path tests (mock fetch)
// ---------------------------------------------------------------------------

describe('runMeshstackChecks -- live API path (#0480)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('snapshot path sets input_type: snapshot', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runMeshstackChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect((result as Record<string, unknown>).input_type).toBe('snapshot');
  });

  it('live path calls meshStack BB endpoints; sets input_type: live_api', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('meshbuildingblockdefinitions')) {
        return Promise.resolve({ ok: true, json: async () => ({ _embedded: { 'mesh:meshBuildingBlockDefinitions': [] } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ _embedded: { 'mesh:meshBuildingBlocks': [] } }) });
    });
    vi.stubGlobal('fetch', mockFetch);

    const origKey = process.env['SWAO_MESHSTACK_API_KEY'];
    process.env['SWAO_MESHSTACK_API_KEY'] = 'test-key';
    try {
      const result = await runMeshstackChecks({ ...BASE_CONFIG, baseUrl: 'https://test.mesh.example' }, []);
      expect((result as Record<string, unknown>).input_type).toBe('live_api');
      expect(result.overall_verdict).toBeDefined();
    } finally {
      if (origKey === undefined) delete process.env['SWAO_MESHSTACK_API_KEY'];
      else process.env['SWAO_MESHSTACK_API_KEY'] = origKey;
    }
  });

  it('live path returns advisory when API key absent', async () => {
    const origKey = process.env['SWAO_MESHSTACK_API_KEY'];
    delete process.env['SWAO_MESHSTACK_API_KEY'];
    try {
      const result = await runMeshstackChecks({ ...BASE_CONFIG }, []);
      expect(result.overall_verdict).toBe('advisory');
      expect((result as Record<string, unknown>).input_type).toBe('live_api');
    } finally {
      if (origKey !== undefined) process.env['SWAO_MESHSTACK_API_KEY'] = origKey;
    }
  });
});
