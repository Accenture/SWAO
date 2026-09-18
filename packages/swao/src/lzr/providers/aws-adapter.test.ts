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
import { runAwsChecks } from './aws-adapter.js';
import type { AwsAdapterConfig } from './aws-adapter.js';
import { LandingZoneReadinessResultSchema } from '../../schema/wsp-lzr.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpStub(content: object): string {
  const dir = join(tmpdir(), `aws-adapter-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'lz-aws-snapshot.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const BASE_CONFIG: AwsAdapterConfig = {
  region: 'eu-central-1',
  landingZoneId: 'lz-ghostfolio-prod',
  providerId: 'aws_eu_central_1',
};

const CLEAN_STUB = {
  eks_clusters: [{ name: 'ghostfolio-prod', status: 'ACTIVE', version: '1.30' }],
  rds_instances: [{ identifier: 'ghostfolio-pg', engine: 'postgres', status: 'available', engineVersion: '15.6' }],
  elasticache_groups: [{ id: 'ghostfolio-redis', status: 'available' }],
  config_compliance: { non_compliant_rules: [] },
  vpc_count: 1,
  service_quota_eks_remaining: 3,
  service_quota_rds_remaining: 10,
};

// ---------------------------------------------------------------------------
// Ghostfolio fixture integration
// ---------------------------------------------------------------------------

describe('runAwsChecks -- ghostfolio clean stub', () => {
  it('returns overall_verdict: ready from ghostfolio stub file', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(result.overall_verdict).toBe('ready');
  });

  it('service_checks: kubernetes ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const k8s = result.service_checks.find((s) => s.service === 'kubernetes');
    expect(k8s?.status).toBe('ready');
    expect(k8s?.provisioned_in_lz).toBe(true);
  });

  it('service_checks: postgresql ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const pg = result.service_checks.find((s) => s.service === 'postgresql');
    expect(pg?.status).toBe('ready');
  });

  it('service_checks: redis ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const redis = result.service_checks.find((s) => s.service === 'redis');
    expect(redis?.status).toBe('ready');
  });

  it('quota_checks: EKS quota ok with remaining=3', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    const eksQ = result.quota_checks.find((q) => q.resource === 'eks_clusters');
    expect(eksQ?.status).toBe('ok');
    expect(eksQ?.available).toBe(3);
  });

  it('quota_checks: RDS quota ok with remaining=10', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['postgresql']);
    const rdsQ = result.quota_checks.find((q) => q.resource === 'rds_instances');
    expect(rdsQ?.status).toBe('ok');
    expect(rdsQ?.available).toBe(10);
  });

  it('policy_checks: LZ-POL-01 pass with no non-compliant rules', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, []);
    const pol = result.policy_checks.find((p) => p.check_id === 'LZ-POL-01');
    expect(pol?.status).toBe('pass');
  });

  it('output validates against LandingZoneReadinessResultSchema', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(() => LandingZoneReadinessResultSchema.parse(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Quota exhaustion -- blocked verdict
// ---------------------------------------------------------------------------

describe('runAwsChecks -- quota exhaustion', () => {
  it('EKS quota=0 produces LZ-QUO-01 blocker and overall_verdict: blocked', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, service_quota_eks_remaining: 0 });
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    expect(result.overall_verdict).toBe('blocked');
    const blocker = result.blockers.find((b) => b.check_id === 'LZ-QUO-01');
    expect(blocker).toBeDefined();
    expect(blocker?.blocks_migration).toBe(true);
  });

  it('EKS quota ok but kubernetes cluster absent -> blocked', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, eks_clusters: [] });
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    expect(result.overall_verdict).toBe('blocked');
    const svc = result.service_checks.find((s) => s.service === 'kubernetes');
    expect(svc?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Policy violation
// ---------------------------------------------------------------------------

describe('runAwsChecks -- policy violations', () => {
  it('non-compliant Config rules produce LZ-POL-01 fail', async () => {
    const snapshotFile = makeTmpStub({
      ...CLEAN_STUB,
      config_compliance: { non_compliant_rules: [{ rule: 'encrypted-volumes', resource: '/aws/ebs/vol-abc' }] },
    });
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, []);
    const pol = result.policy_checks.find((p) => p.check_id === 'LZ-POL-01');
    expect(pol?.status).toBe('fail');
    expect(pol?.note).toContain('encrypted-volumes');
  });
});

// ---------------------------------------------------------------------------
// Stub mode: no credential access
// ---------------------------------------------------------------------------

describe('runAwsChecks -- stub mode isolation', () => {
  it('stub mode succeeds without any SWAO_CREDENTIAL_* env vars set', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    // Unset any credential env vars to prove stub bypasses credential lookup
    const saved = {
      KEY_ID: process.env['SWAO_CREDENTIAL_AWS_ACCESS_KEY_ID'],
      SECRET: process.env['SWAO_CREDENTIAL_AWS_SECRET_ACCESS_KEY'],
    };
    delete process.env['SWAO_CREDENTIAL_AWS_ACCESS_KEY_ID'];
    delete process.env['SWAO_CREDENTIAL_AWS_SECRET_ACCESS_KEY'];
    try {
      const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
      expect(result.overall_verdict).toBe('ready');
    } finally {
      if (saved.KEY_ID !== undefined) process.env['SWAO_CREDENTIAL_AWS_ACCESS_KEY_ID'] = saved.KEY_ID;
      if (saved.SECRET !== undefined) process.env['SWAO_CREDENTIAL_AWS_SECRET_ACCESS_KEY'] = saved.SECRET;
    }
  });

  it('provider_id and landing_zone_id are reflected in output', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks(
      { ...BASE_CONFIG, snapshotFile, providerId: 'aws_eu_sovereign', landingZoneId: 'lz-esc-prod' },
      [],
    );
    expect(result.provider_id).toBe('aws_eu_sovereign');
    expect(result.landing_zone_id).toBe('lz-esc-prod');
  });

  it('ingestion_strategy is cloud_native in stub mode', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.ingestion_strategy).toBe('cloud_native');
  });
});

// ---------------------------------------------------------------------------
// Missing services
// ---------------------------------------------------------------------------

describe('runAwsChecks -- missing services in stub', () => {
  it('absent RDS instance produces LZ-SVC-02 blocker', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, rds_instances: [] });
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['postgresql']);
    const blocker = result.blockers.find((b) => b.check_id === 'LZ-SVC-02');
    expect(blocker).toBeDefined();
    expect(result.overall_verdict).toBe('blocked');
  });

  it('absent ElastiCache group produces LZ-SVC-03 blocker', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, elasticache_groups: [] });
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, ['redis']);
    const blocker = result.blockers.find((b) => b.check_id === 'LZ-SVC-03');
    expect(blocker).toBeDefined();
    expect(result.overall_verdict).toBe('blocked');
  });

  it('requiredServices not requested -> no service_checks emitted', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.service_checks).toHaveLength(0);
    expect(result.overall_verdict).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// AWS ESC via different region + provider_id
// ---------------------------------------------------------------------------

describe('runAwsChecks -- AWS ESC (aws_eu_sovereign)', () => {
  it('handles ESC provider_id identically to eu-central-1 via region string', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks(
      { region: 'de-eu-sov-1', landingZoneId: 'lz-esc-prod', providerId: 'aws_eu_sovereign', snapshotFile },
      ['kubernetes', 'postgresql', 'redis'],
    );
    expect(result.overall_verdict).toBe('ready');
    expect(result.provider_id).toBe('aws_eu_sovereign');
  });
});

// ---------------------------------------------------------------------------
// #0479 live-path tests (mock fetch)
// ---------------------------------------------------------------------------

describe('runAwsChecks -- live API path (#0479)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('snapshot path sets input_type: snapshot', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAwsChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect((result as Record<string, unknown>).input_type).toBe('snapshot');
  });

  it('live path calls EKS and RDS endpoints when no snapshot; sets input_type: live_api', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/clusters') && !url.split('/clusters/')[1]) {
        return Promise.resolve({ ok: true, json: async () => ({ clusters: ['prod-cluster'] }) });
      }
      if (url.includes('/clusters/prod-cluster')) {
        return Promise.resolve({ ok: true, json: async () => ({ cluster: { name: 'prod-cluster', status: 'ACTIVE', version: '1.30' } }) });
      }
      if (url.includes('rds.')) {
        return Promise.resolve({ ok: true, json: async () => ({ DBInstances: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    // Provide credentials via env so credentialStore resolves them
    const origAccessKey = process.env['SWAO_AWS_ACCESS_KEY_ID'];
    const origSecretKey = process.env['SWAO_AWS_SECRET_ACCESS_KEY'];
    process.env['SWAO_AWS_ACCESS_KEY_ID'] = 'AKIATEST';
    process.env['SWAO_AWS_SECRET_ACCESS_KEY'] = 'testsecret';

    try {
      const result = await runAwsChecks({ ...BASE_CONFIG }, ['kubernetes']);
      expect((result as Record<string, unknown>).input_type).toBe('live_api');
      expect(result.overall_verdict).toBeDefined();
    } finally {
      if (origAccessKey === undefined) delete process.env['SWAO_AWS_ACCESS_KEY_ID'];
      else process.env['SWAO_AWS_ACCESS_KEY_ID'] = origAccessKey;
      if (origSecretKey === undefined) delete process.env['SWAO_AWS_SECRET_ACCESS_KEY'];
      else process.env['SWAO_AWS_SECRET_ACCESS_KEY'] = origSecretKey;
    }
  });

  it('live path returns advisory when credentials absent', async () => {
    const origAccessKey = process.env['SWAO_AWS_ACCESS_KEY_ID'];
    delete process.env['SWAO_AWS_ACCESS_KEY_ID'];
    try {
      const result = await runAwsChecks({ ...BASE_CONFIG }, []);
      expect(result.overall_verdict).toBe('advisory');
      expect((result as Record<string, unknown>).input_type).toBe('live_api');
    } finally {
      if (origAccessKey !== undefined) process.env['SWAO_AWS_ACCESS_KEY_ID'] = origAccessKey;
    }
  });
});
