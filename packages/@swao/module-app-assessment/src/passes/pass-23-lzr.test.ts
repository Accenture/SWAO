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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findLzrInputFiles, parseTfState, runLzrPass, extractSourceServices, parseTfPlan, deriveLzrProviderId } from './pass-23-lzr.js';

const TMP_WS = join(tmpdir(), `swao-lzr-test-${process.pid}`);
const IMPORTS_DIR = join(TMP_WS, 'wsp', 'inputs', 'terraform');

// #3142: sanitised synthetic fixtures inside the package. The originals lived
// under examples/portfolio-workspace/ and were removed in sprint-125.
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'lzr');
const GHOSTFOLIO_APP_DIR = join(FIXTURES_DIR, 'ghostfolio');
const SOVEREIGN_HEALTH_APP_DIR = join(FIXTURES_DIR, 'sovereign-health');
const GHOSTFOLIO_TFSTATE_PATH = join(GHOSTFOLIO_APP_DIR, 'wsp', 'inputs', 'terraform', 'lz-ghostfolio-prod.tfstate');

const FULL_TFSTATE = {
  version: 4,
  resources: [
    {
      mode: 'managed',
      type: 'stackit_ske_cluster',
      name: 'prod',
      instances: [{ attributes: { id: 'ske-01', status: 'healthy', kubernetes_version: '1.30' } }],
    },
    {
      mode: 'managed',
      type: 'stackit_postgresflex_instance',
      name: 'db',
      instances: [{ attributes: { id: 'pg-01', version: '15', status: 'ready' } }],
    },
    {
      mode: 'managed',
      type: 'stackit_redis_instance',
      name: 'cache',
      instances: [{ attributes: { id: 'redis-01', status: 'ready' } }],
    },
    {
      mode: 'managed',
      type: 'stackit_objectstorage_bucket',
      name: 'uploads',
      instances: [{ attributes: { id: 'bucket-01', server_side_encryption: { algorithm: 'AES256', enabled: true } } }],
    },
  ],
};

beforeAll(() => {
  mkdirSync(IMPORTS_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_WS, { recursive: true, force: true });
});

const baseCtx = {
  appId: 'test-app',
  sourcePath: TMP_WS,
  workspacePath: TMP_WS,
  iter: 1,
  assessedAt: '2026-04-28',
};

// ---------------------------------------------------------------------------
// findLzrInputFiles
// ---------------------------------------------------------------------------

describe('findLzrInputFiles (#0105, #0232 path)', () => {
  it('returns empty array when wsp/inputs/terraform/ dir does not exist', () => {
    const result = findLzrInputFiles('/nonexistent/path');
    expect(result).toEqual([]);
  });

  it('returns .tfstate files from wsp/inputs/terraform/ dir', () => {
    writeFileSync(join(IMPORTS_DIR, 'test.tfstate'), '{}');
    const result = findLzrInputFiles(TMP_WS);
    expect(result.some((f) => f.endsWith('.tfstate'))).toBe(true);
  });

  it('returns .tfplan files from wsp/inputs/terraform/ dir', () => {
    writeFileSync(join(IMPORTS_DIR, 'plan.tfplan'), '{}');
    const result = findLzrInputFiles(TMP_WS);
    expect(result.some((f) => f.endsWith('.tfplan'))).toBe(true);
  });

  it('ignores non-tf files', () => {
    writeFileSync(join(IMPORTS_DIR, 'readme.md'), '# readme');
    const result = findLzrInputFiles(TMP_WS);
    expect(result.every((f) => f.endsWith('.tfstate') || f.endsWith('.tfplan'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseTfState
// ---------------------------------------------------------------------------

const SOVEREIGN_HEALTH_TFSTATE_PATH = join(SOVEREIGN_HEALTH_APP_DIR, 'wsp', 'inputs', 'terraform', 'terraform-prod.tfstate');

describe('parseTfState (#0105)', () => {
  it('parses a valid tfstate JSON file', () => {
    const p = join(IMPORTS_DIR, 'valid.tfstate');
    writeFileSync(p, JSON.stringify(FULL_TFSTATE));
    const result = parseTfState(p);
    expect(result.resources).toHaveLength(4);
  });

  it('parses the ghostfolio WoZ fixture', () => {
    const result = parseTfState(GHOSTFOLIO_TFSTATE_PATH);
    expect(result.resources).toBeDefined();
    expect((result.resources ?? []).length).toBeGreaterThan(0);
  });

  it('parses TFv5 show format (format_version 1.0) and normalises resources', () => {
    const tfv5 = {
      format_version: '1.0',
      terraform_version: '1.9.0',
      values: {
        root_module: {
          resources: [
            { address: 'docker_container.db', mode: 'managed', type: 'docker_container', name: 'db',
              provider_name: 'registry.terraform.io/kreuzwerker/docker', schema_version: 2,
              values: { image: 'sha256:abc123', name: 'my-db', env: ['POSTGRES_DB=test'] },
              sensitive_values: {} },
            { address: 'docker_container.api', mode: 'managed', type: 'docker_container', name: 'api',
              provider_name: 'registry.terraform.io/kreuzwerker/docker', schema_version: 2,
              values: { image: 'myapp:latest', name: 'my-api', env: [] },
              sensitive_values: {} },
          ],
        },
      },
    };
    const p = join(IMPORTS_DIR, 'tfv5.tfstate');
    writeFileSync(p, JSON.stringify(tfv5));
    const result = parseTfState(p);
    expect(result.resources).toHaveLength(2);
    expect(result.resources?.[0]?.type).toBe('docker_container');
    expect(result.resources?.[0]?.name).toBe('db');
    expect(result.resources?.[0]?.instances[0]?.attributes['image']).toBe('sha256:abc123');
    expect(result.resources?.[1]?.instances[0]?.attributes['image']).toBe('myapp:latest');
  });

  it('TFv5: filters out data-source resources (mode != managed)', () => {
    const tfv5WithData = {
      format_version: '1.0',
      values: {
        root_module: {
          resources: [
            { mode: 'managed', type: 'docker_container', name: 'app',
              values: { image: 'nginx:latest' }, sensitive_values: {} },
            { mode: 'data', type: 'docker_image', name: 'nginx_image',
              values: { repo_digest: 'nginx@sha256:abc' }, sensitive_values: {} },
          ],
        },
      },
    };
    const p = join(IMPORTS_DIR, 'tfv5-data.tfstate');
    writeFileSync(p, JSON.stringify(tfv5WithData));
    const result = parseTfState(p);
    expect(result.resources).toHaveLength(1);
    expect(result.resources?.[0]?.mode).toBeUndefined();
    expect(result.resources?.[0]?.type).toBe('docker_container');
  });

  it('parses the sovereign-health TFv5 show-format fixture', () => {
    const result = parseTfState(SOVEREIGN_HEALTH_TFSTATE_PATH);
    expect(result.resources).toBeDefined();
    expect((result.resources ?? []).length).toBeGreaterThan(0);
    const types = (result.resources ?? []).map((r) => r.type);
    expect(types).toContain('docker_container');
    expect(types).toContain('hostinger_vps');
  });
});

// ---------------------------------------------------------------------------
// runLzrPass -- full assessment
// ---------------------------------------------------------------------------

describe('runLzrPass (#0105)', () => {
  it('returns pass id 23 and signal_prefix LZR', async () => {
    const p = join(IMPORTS_DIR, 'full.tfstate');
    writeFileSync(p, JSON.stringify(FULL_TFSTATE));
    const result = await runLzrPass(baseCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-test',
    });
    expect(result.pass.id).toBe(23);
    expect(result.pass.signal_prefix).toBe('LZR');
  });

  it('emits LZR-prefixed signal IDs', async () => {
    const p = join(IMPORTS_DIR, 'full2.tfstate');
    writeFileSync(p, JSON.stringify(FULL_TFSTATE));
    const result = await runLzrPass(baseCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-test',
    });
    for (const sig of result.signals) {
      expect(sig.id).toMatch(/^LZR-\d{2}$/);
    }
  });

  it('overall_verdict is ready when all services present in tfstate', async () => {
    const p = join(IMPORTS_DIR, 'full3.tfstate');
    writeFileSync(p, JSON.stringify(FULL_TFSTATE));
    const result = await runLzrPass(baseCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-test',
    });
    expect(result.lzrResult.overall_verdict).toBe('ready');
    expect(result.lzrResult.blockers).toHaveLength(0);
  });

  it('overall_verdict is blocked when SKE is missing', async () => {
    const partial = {
      ...FULL_TFSTATE,
      resources: FULL_TFSTATE.resources.filter((r) => r.type !== 'stackit_ske_cluster'),
    };
    const partialWs = join(TMP_WS, 'partial-app');
    mkdirSync(join(partialWs, 'wsp', 'inputs', 'terraform'), { recursive: true });
    writeFileSync(join(partialWs, 'wsp', 'inputs', 'terraform', 'state.tfstate'), JSON.stringify(partial));
    const result = await runLzrPass(
      { ...baseCtx, workspacePath: partialWs },
      { providerId: 'stackit_de_sovereign', landingZoneId: 'lz-partial' },
    );
    expect(result.lzrResult.overall_verdict).toBe('blocked');
    expect(result.lzrResult.blockers.length).toBeGreaterThan(0);
  });

  it('emits positive signals for detected services', async () => {
    const p = join(IMPORTS_DIR, 'full4.tfstate');
    writeFileSync(p, JSON.stringify(FULL_TFSTATE));
    const result = await runLzrPass(baseCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-test',
    });
    const positive = result.signals.filter((s) => s.severity === 'positive');
    expect(positive.length).toBeGreaterThan(0);
  });

  it('assessment block includes overall_verdict and counts', async () => {
    const p = join(IMPORTS_DIR, 'full5.tfstate');
    writeFileSync(p, JSON.stringify(FULL_TFSTATE));
    const result = await runLzrPass(baseCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-test',
    });
    expect(result.assessment['overall_verdict']).toBeDefined();
    expect(typeof result.assessment['checks_run']).toBe('number');
    expect(typeof result.assessment['blockers_count']).toBe('number');
  });

  it('runs cleanly against the ghostfolio WoZ fixture', async () => {
    const ghostfolioCtx = {
      ...baseCtx,
      workspacePath: GHOSTFOLIO_APP_DIR,
    };
    const result = await runLzrPass(ghostfolioCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-ghostfolio-prod',
    });
    expect(result.pass.status).toBe('complete');
    expect(result.lzrResult.provider_id).toBe('stackit_de_sovereign');
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('ghostfolio WoZ fixture: overall_verdict is ready', async () => {
    const ghostfolioCtx = {
      ...baseCtx,
      workspacePath: GHOSTFOLIO_APP_DIR,
    };
    const result = await runLzrPass(ghostfolioCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-ghostfolio-prod',
    });
    expect(result.lzrResult.overall_verdict).toBe('ready');
  });

  it('TFv5 source-only: sovereign-health show-format fixture enters source-only mode', async () => {
    const sovereignHealthCtx = {
      ...baseCtx,
      workspacePath: SOVEREIGN_HEALTH_APP_DIR,
    };
    const result = await runLzrPass(sovereignHealthCtx, {
      providerId: 'stackit_de_sovereign',
      landingZoneId: 'lz-sovereign-health-prod',
    });
    expect(result.pass.status).toBe('complete');
    expect(result.assessment['ingestion_strategy']).toBe('source_environment_analysis');
    const pgBlocker = result.lzrResult.blockers.find((b) => b.check_id === 'LZC-STACKIT-02');
    expect(pgBlocker).toBeDefined();
    const pgSignal = result.signals.find((s) => s.implies?.includes('service_dep:postgresql'));
    expect(pgSignal).toBeDefined();
  });

  it('returns empty import_files count when wsp/inputs/terraform/ is empty', async () => {
    const emptyWs = join(TMP_WS, 'empty-app');
    mkdirSync(join(emptyWs, 'wsp', 'inputs', 'terraform'), { recursive: true });
    const result = await runLzrPass(
      { ...baseCtx, workspacePath: emptyWs },
      { providerId: 'stackit_de_sovereign', landingZoneId: 'lz-empty' },
    );
    expect(result.assessment['input_files']).toBe(0);
  });

  it('source-only: docker postgres container triggers LZC-STACKIT-02 blocker for target', async () => {
    const dockerTfstate = {
      version: 4,
      resources: [
        {
          mode: 'managed',
          type: 'hostinger_vps',
          name: 'prod',
          instances: [{ attributes: { hostname: 'sovereign-health-prod', plan: 'KVM 2', region: 'eu-west' } }],
        },
        {
          mode: 'managed',
          type: 'docker_container',
          name: 'db',
          instances: [{ attributes: { name: 'sovereign-health-db', image: 'postgres:15', ports: [{ internal: 5432, ip: '127.0.0.1' }] } }],
        },
        {
          mode: 'managed',
          type: 'docker_container',
          name: 'api',
          instances: [{ attributes: { name: 'sovereign-health-api', image: 'brickos/sovereign-health:latest', ports: [{ internal: 8080, external: 443 }] } }],
        },
      ],
    };
    const dockerWs = join(TMP_WS, 'docker-source-app');
    mkdirSync(join(dockerWs, 'wsp', 'inputs', 'terraform'), { recursive: true });
    writeFileSync(
      join(dockerWs, 'wsp', 'inputs', 'terraform', 'terraform-prod.tfstate'),
      JSON.stringify(dockerTfstate),
    );
    const result = await runLzrPass(
      { ...baseCtx, workspacePath: dockerWs },
      { providerId: 'stackit_de_sovereign', landingZoneId: 'lz-stackit-eu01' },
    );
    expect(result.lzrResult.overall_verdict).toBe('blocked');
    const pgBlocker = result.lzrResult.blockers.find((b) => b.check_id === 'LZC-STACKIT-02');
    expect(pgBlocker).toBeDefined();
    const pgSignal = result.signals.find((s) => s.implies?.includes('service_dep:postgresql'));
    expect(pgSignal).toBeDefined();
    expect(result.assessment['ingestion_strategy']).toBe('source_environment_analysis');
  });
});

// ---------------------------------------------------------------------------
// extractSourceServices
// ---------------------------------------------------------------------------

describe('extractSourceServices', () => {
  it('maps postgres image to postgresql service_dep', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'db', instances: [{ attributes: { image: 'postgres:15' } }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.has('postgresql')).toBe(true);
    expect(result.get('postgresql')?.[0]).toContain('postgres:15');
  });

  it('maps redis image to redis service_dep', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'cache', instances: [{ attributes: { image: 'redis:7-alpine' } }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.has('redis')).toBe(true);
  });

  it('ignores non-database containers', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'api', instances: [{ attributes: { image: 'brickos/sovereign-health:latest' } }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.size).toBe(0);
  });

  it('handles registry-prefixed image names', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'db', instances: [{ attributes: { image: 'registry.example.com/postgres:15' } }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.has('postgresql')).toBe(true);
  });

  it('SHA256 digest: detects postgresql via POSTGRES_DB env var', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'db', instances: [{
          attributes: {
            image: 'sha256:c8180498e5035b3529c365fb1715f21922e355ab6f72537b03bd842d361b9004',
            env: ['POSTGRES_DB=sovereign_health', 'POSTGRES_USER=sovereign_health'],
            command: ['postgres', '-c', 'shared_preload_libraries=pgaudit'],
          },
        }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.has('postgresql')).toBe(true);
    expect(result.get('postgresql')?.[0]).toContain('postgres env vars');
  });

  it('SHA256 digest: detects postgresql via command when no env vars present', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'mydb', instances: [{
          attributes: {
            image: 'sha256:aabbccdd',
            env: [],
            command: ['postgres', '-c', 'max_connections=200'],
          },
        }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.has('postgresql')).toBe(true);
    expect(result.get('postgresql')?.[0]).toContain('postgres command');
  });

  it('SHA256 digest: detects redis via resource name when no env or command hints', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'redis', instances: [{
          attributes: {
            image: 'sha256:aa189b5a1954929c393585e6dc5717a75b18f75a931df8bdcc00a3d3bd546be6',
            env: [],
            command: [],
          },
        }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.has('redis')).toBe(true);
    expect(result.get('redis')?.[0]).toContain("resource name 'redis'");
  });

  it('SHA256 digest: non-service container produces no detection', () => {
    const byType = new Map([
      ['docker_container', [
        { type: 'docker_container', name: 'api', instances: [{
          attributes: {
            image: 'sha256:6a0e796179e425e1',
            env: ['RUST_LOG=warn', 'SHI_MODE=saas'],
            command: [],
          },
        }] },
      ]],
    ]);
    const result = extractSourceServices(byType);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #3153: provider derivation, generic checks, warnings, .tfplan parsing
// ---------------------------------------------------------------------------

function lzrWorkspace(name: string, files: Record<string, string | Buffer>): string {
  const ws = join(TMP_WS, name);
  const dir = join(ws, 'wsp', 'inputs', 'terraform');
  mkdirSync(dir, { recursive: true });
  for (const [f, content] of Object.entries(files)) writeFileSync(join(dir, f), content);
  return ws;
}

describe('deriveLzrProviderId (#3153)', () => {
  it('reads the vendor token from the landing-zone ID', () => {
    expect(deriveLzrProviderId({ landingZoneId: 'lz-aws-eu-central-1' })).toEqual({ providerId: 'aws_eu_central_1', source: 'landing_zone_id' });
    expect(deriveLzrProviderId({ landingZoneId: 'lz-azure-eu-west' }).providerId).toBe('azure_west_europe');
    expect(deriveLzrProviderId({ landingZoneId: 'lz-stackit-de-01' }).providerId).toBe('stackit_de_sovereign');
    expect(deriveLzrProviderId({ landingZoneId: 'lz-aws-esc-de-east-1' }).providerId).toBe('aws_eu_sovereign');
  });

  it('accepts an exact catalogue provider ID', () => {
    expect(deriveLzrProviderId({ landingZoneId: 'otc_de_sovereign' })).toEqual({ providerId: 'otc_de_sovereign', source: 'landing_zone_id' });
  });

  it('falls back to configuration, then Terraform resource prefixes, then the default', () => {
    expect(deriveLzrProviderId({ landingZoneId: 'lz-prod', configuredProvider: 'gcp' })).toEqual({ providerId: 'gcp_eu_regions', source: 'configuration' });
    expect(deriveLzrProviderId({ landingZoneId: 'lz-prod', resourceTypes: ['aws_db_instance', 'docker_container'] }))
      .toEqual({ providerId: 'aws_eu_central_1', source: 'terraform_resources' });
    expect(deriveLzrProviderId({ landingZoneId: 'lz-prod', resourceTypes: ['docker_container'] }))
      .toEqual({ providerId: 'stackit_de_sovereign', source: 'default' });
  });
});

describe('runLzrPass provider derivation and generic checks (#3153)', () => {
  it('derives the provider from the landing zone when providerId is omitted', async () => {
    const ws = lzrWorkspace('aws-derive', {
      'aws.tfstate': JSON.stringify({ version: 4, resources: [
        { mode: 'managed', type: 'aws_security_group_rule', name: 'egress', instances: [{ attributes: { type: 'egress' } }] },
      ] }),
    });
    const result = await runLzrPass({ ...baseCtx, workspacePath: ws }, { landingZoneId: 'lz-aws-eu-central-1' });
    expect(result.lzrResult.provider_id).toBe('aws_eu_central_1');
    expect(result.assessment['provider_id_source']).toBe('landing_zone_id');
    // LZC-GEN-01 is applicable for AWS resource types and passes.
    const gen01 = result.lzrResult.network_checks.find((c) => c.check_id === 'LZC-GEN-01');
    expect(gen01?.status).toBe('pass');
    expect(result.signals.some((s) => s.severity === 'positive' && s.derivation.includes('aws_security_group_rule'))).toBe(true);
  });

  it('LZC-GEN-01 is a blocker for an AWS landing zone without egress rules', async () => {
    const ws = lzrWorkspace('aws-no-egress', {
      'aws.tfstate': JSON.stringify({ version: 4, resources: [
        { mode: 'managed', type: 'aws_instance', name: 'web', instances: [{ attributes: {} }] },
      ] }),
    });
    const result = await runLzrPass({ ...baseCtx, workspacePath: ws }, { landingZoneId: 'lz-aws-eu-central-1' });
    expect(result.lzrResult.blockers.map((b) => b.check_id)).toContain('LZC-GEN-01');
    expect(result.lzrResult.overall_verdict).toBe('blocked');
  });

  it('LZC-GEN-03 fails for a publicly accessible database and passes for a private one', async () => {
    const pub = lzrWorkspace('aws-public-db', {
      'db.tfstate': JSON.stringify({ version: 4, resources: [
        { mode: 'managed', type: 'aws_db_instance', name: 'main', instances: [{ attributes: { publicly_accessible: true } }] },
      ] }),
    });
    const pubResult = await runLzrPass({ ...baseCtx, workspacePath: pub }, { landingZoneId: 'lz-aws-eu-central-1' });
    const blocker = pubResult.lzrResult.blockers.find((b) => b.check_id === 'LZC-GEN-03');
    expect(blocker?.evidence[0]).toContain('publicly_accessible');

    const priv = lzrWorkspace('aws-private-db', {
      'db.tfstate': JSON.stringify({ version: 4, resources: [
        { mode: 'managed', type: 'aws_db_instance', name: 'main', instances: [{ attributes: { publicly_accessible: false } }] },
      ] }),
    });
    const privResult = await runLzrPass({ ...baseCtx, workspacePath: priv }, { landingZoneId: 'lz-aws-eu-central-1' });
    expect(privResult.lzrResult.network_checks.find((c) => c.check_id === 'LZC-GEN-03')?.status).toBe('pass');
  });

  it('reports generic checks that Terraform state cannot decide instead of dropping them', async () => {
    const result = await runLzrPass(
      { ...baseCtx, workspacePath: GHOSTFOLIO_APP_DIR },
      { providerId: 'stackit_de_sovereign', landingZoneId: 'lz-ghostfolio-prod' },
    );
    const notEvaluated = (result.assessment['checks_not_evaluated'] as Array<{ check_id: string }>).map((c) => c.check_id);
    expect(notEvaluated).toEqual(expect.arrayContaining(['LZC-GEN-01', 'LZC-GEN-02', 'LZC-GEN-04', 'LZC-GEN-05']));
    expect(result.lzrResult.policy_checks.find((c) => c.check_id === 'LZC-GEN-02')?.status).toBe('skipped');
    expect(result.lzrResult.network_checks.find((c) => c.check_id === 'LZC-GEN-01')?.status).toBe('skipped');
    // The private postgresflex ACL makes GEN-03 decidable.
    expect(result.lzrResult.network_checks.find((c) => c.check_id === 'LZC-GEN-03')?.status).toBe('pass');
  });

  it('reports unmet warning-level checks and returns an advisory verdict', async () => {
    const ws = lzrWorkspace('stackit-no-redis', {
      'state.tfstate': JSON.stringify({
        ...FULL_TFSTATE,
        resources: FULL_TFSTATE.resources.filter((r) => r.type !== 'stackit_redis_instance'),
      }),
    });
    const result = await runLzrPass({ ...baseCtx, workspacePath: ws }, { providerId: 'stackit_de_sovereign', landingZoneId: 'lz-x' });
    expect(result.lzrResult.blockers).toHaveLength(0);
    expect(result.lzrResult.warnings.map((w) => w.check_id)).toContain('LZC-STACKIT-03');
    expect(result.lzrResult.overall_verdict).toBe('advisory');
    expect(result.signals.some((s) => s.severity === 'medium')).toBe(true);
    for (const sig of result.signals) expect(sig.id).toMatch(/^LZR-\d{2}$/);
  });

  it('source mode: a redis container produces a warning for the target landing zone', async () => {
    const ws = lzrWorkspace('source-redis', {
      'src.tfstate': JSON.stringify({ version: 4, resources: [
        { mode: 'managed', type: 'docker_container', name: 'cache', instances: [{ attributes: { image: 'redis:7' } }] },
      ] }),
    });
    const result = await runLzrPass({ ...baseCtx, workspacePath: ws }, { providerId: 'stackit_de_sovereign', landingZoneId: 'lz-x' });
    expect(result.assessment['ingestion_strategy']).toBe('source_environment_analysis');
    expect(result.lzrResult.warnings.map((w) => w.check_id)).toContain('LZC-STACKIT-03');
    expect(result.lzrResult.overall_verdict).toBe('advisory');
  });
});

describe('.tfplan parsing (#3153)', () => {
  it('parses planned_values from a JSON plan, including child modules', async () => {
    const plan = {
      format_version: '1.2',
      planned_values: {
        root_module: {
          resources: [{ mode: 'managed', type: 'stackit_ske_cluster', name: 'prod', values: { name: 'c' } }],
          child_modules: [{
            resources: [
              { mode: 'managed', type: 'stackit_postgresflex_instance', name: 'db', values: {} },
              { mode: 'data', type: 'stackit_image', name: 'img', values: {} },
            ],
          }],
        },
      },
    };
    const ws = lzrWorkspace('plan-json', { 'main.tfplan': JSON.stringify(plan) });
    const parsed = parseTfPlan(join(ws, 'wsp', 'inputs', 'terraform', 'main.tfplan'));
    expect(parsed.resources?.map((r) => r.type)).toEqual(['stackit_ske_cluster', 'stackit_postgresflex_instance']);
    const result = await runLzrPass({ ...baseCtx, workspacePath: ws }, { landingZoneId: 'lz-stackit-de-01' });
    expect(result.assessment['resource_types_found']).toBe(2);
    expect(result.lzrResult.service_checks.some((c) => c.provisioned_in_lz === true)).toBe(true);
  });

  it('reports a binary plan as unparsed instead of throwing', async () => {
    const ws = lzrWorkspace('plan-binary', { 'main.tfplan': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]) });
    const result = await runLzrPass({ ...baseCtx, workspacePath: ws }, { landingZoneId: 'lz-stackit-de-01' });
    const unparsed = result.assessment['input_files_unparsed'] as Array<{ file: string; reason: string }>;
    expect(unparsed[0]?.file).toBe('main.tfplan');
    expect(unparsed[0]?.reason).toContain('terraform show -json');
  });
});
