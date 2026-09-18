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
import { runInvPass } from './pass-01-inv.js';

const TMP_ROOT = join(tmpdir(), `swao-inv-tfstate-test-${process.pid}`);
const TMP_SRC  = join(TMP_ROOT, 'src');
const TMP_WS   = join(TMP_ROOT, 'ws');
const TF_DIR   = join(TMP_WS, 'wsp', 'inputs', 'terraform');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Minimal TFv5 show-json tfstate with a redis container (SHA256 digest).
const TFSTATE_REDIS_DIGEST = JSON.stringify({
  format_version: '1.0',
  values: {
    root_module: {
      resources: [
        {
          mode: 'managed',
          type: 'docker_container',
          name: 'redis',
          values: {
            image: 'sha256:abcdef1234567890abcdef',
            name: 'redis',
            env: [],
            command: [],
          },
        },
      ],
    },
  },
});

// TFv5 tfstate with both postgresql and redis.
const TFSTATE_PG_AND_REDIS = JSON.stringify({
  format_version: '1.0',
  values: {
    root_module: {
      resources: [
        {
          mode: 'managed',
          type: 'docker_container',
          name: 'db',
          values: {
            image: 'sha256:111111111111111111111',
            name: 'db',
            env: ['POSTGRES_DB=sovereign', 'POSTGRES_USER=app'],
            command: [],
          },
        },
        {
          mode: 'managed',
          type: 'docker_container',
          name: 'redis',
          values: {
            image: 'sha256:222222222222222222222',
            name: 'redis',
            env: [],
            command: [],
          },
        },
      ],
    },
  },
});

// Minimal Cargo.toml with sqlx+postgres but no redis crate.
const CARGO_TOML_PG_ONLY = `
[package]
name = "sovereign-health"
version = "0.1.0"
edition = "2021"

[dependencies]
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio-rustls"] }
`;

const BASE_CTX = {
  appId: 'test-app',
  iter: 1,
  assessedAt: '2026-07-29',
  llm: undefined as unknown as PassContext['llm'],
  passesDir: TMP_ROOT,
};

// Import type only to type the BASE_CTX llm field correctly.
import type { PassContext } from '@swao/core';

// ---------------------------------------------------------------------------

beforeAll(() => {
  mkdirSync(TF_DIR, { recursive: true });
  mkdirSync(TMP_SRC, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test: TFv5 tfstate with redis-only -> emits INV-NN with service_dep:redis
// ---------------------------------------------------------------------------

describe('pass-01 TFv5 service detection', () => {
  it('emits service_dep:redis from tfstate when not in source code', async () => {
    const tfPath = join(TF_DIR, 'redis-only.tfstate');
    writeFileSync(tfPath, TFSTATE_REDIS_DIGEST);

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      const redisSignal = result.signals.find((s) =>
        s.implies?.includes('service_dep:redis'),
      );
      expect(redisSignal).toBeDefined();
      expect(redisSignal?.id).toMatch(/^INV-\d{2}$/);
      expect(redisSignal?.category).toBe('infrastructure_platform');
      expect(redisSignal?.confidence).toBe('high');
    } finally {
      rmSync(tfPath, { force: true });
    }
  });

  it('does not duplicate service already found in Cargo.toml (postgresql)', async () => {
    const tfPath = join(TF_DIR, 'pg-redis.tfstate');
    writeFileSync(tfPath, TFSTATE_PG_AND_REDIS);
    writeFileSync(join(TMP_SRC, 'Cargo.toml'), CARGO_TOML_PG_ONLY);

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      const pgSignals = result.signals.filter((s) =>
        s.implies?.includes('service_dep:postgresql'),
      );
      const redisSignals = result.signals.filter((s) =>
        s.implies?.includes('service_dep:redis'),
      );

      // postgresql: exactly once (from Cargo.toml; NOT duplicated from tfstate)
      expect(pgSignals).toHaveLength(1);
      // redis: exactly once (from tfstate; not in Cargo.toml)
      expect(redisSignals).toHaveLength(1);
    } finally {
      rmSync(tfPath, { force: true });
      rmSync(join(TMP_SRC, 'Cargo.toml'), { force: true });
    }
  });

  it('detects tfstate committed in the source tree (no workspace path supplied)', async () => {
    const tfPath = join(TMP_SRC, 'terraform.tfstate');
    writeFileSync(tfPath, TFSTATE_REDIS_DIGEST);

    // Pass empty-string workspacePath to simulate no WSP folder having tfstate.
    const emptyWs = join(TMP_ROOT, 'empty-ws');
    mkdirSync(emptyWs, { recursive: true });

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: emptyWs,
      });

      const redisSignal = result.signals.find((s) =>
        s.implies?.includes('service_dep:redis'),
      );
      expect(redisSignal).toBeDefined();
    } finally {
      rmSync(tfPath, { force: true });
      rmSync(emptyWs, { recursive: true, force: true });
    }
  });

  it('emits INV-06 guidance when .tf HCL files exist but no tfstate', async () => {
    writeFileSync(join(TMP_SRC, 'main.tf'), 'resource "docker_container" "app" {}');
    const emptyWs = join(TMP_ROOT, 'hcl-only-ws');
    mkdirSync(join(emptyWs, 'wsp', 'inputs', 'terraform'), { recursive: true });

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: emptyWs,
      });

      const guidanceSignal = result.signals.find((s) => s.id === 'INV-06');
      expect(guidanceSignal).toBeDefined();
      expect(guidanceSignal?.derivation).toContain('terraform show -json');
      // Must not emit any fabricated service_dep signals
      const fabricated = result.signals.filter((s) =>
        s.implies?.some((tag) => tag.startsWith('service_dep:')),
      );
      // Only Cargo / package.json derived ones would be here (none in this empty source dir)
      const tfFabricated = fabricated.filter((s) => s.id === 'INV-06' || s.evidence?.includes('.tf'));
      expect(tfFabricated.every((s) => !s.implies?.some((t) => t.startsWith('service_dep:')))).toBe(true);
    } finally {
      rmSync(join(TMP_SRC, 'main.tf'), { force: true });
      rmSync(emptyWs, { recursive: true, force: true });
    }
  });

  it('emits no new signals when no tfstate files exist (regression guard)', async () => {
    const emptyWs = join(TMP_ROOT, 'notfstate-ws');
    mkdirSync(join(emptyWs, 'wsp', 'inputs', 'terraform'), { recursive: true });

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: emptyWs,
      });

      const tfSignals = result.signals.filter((s) =>
        s.implies?.some((t) => t.startsWith('service_dep:')) && s.id.startsWith('INV-'),
      );
      // TMP_SRC has no Cargo.toml, no package.json -> no service_dep signals
      expect(tfSignals).toHaveLength(0);
    } finally {
      rmSync(emptyWs, { recursive: true, force: true });
    }
  });

  it('detects cloud-native resources from TF state (hcloud_server -> vm_compute)', async () => {
    const tfPath = join(TF_DIR, 'cloud-native.tfstate');
    writeFileSync(tfPath, JSON.stringify({
      version: 4,
      resources: [{
        mode: 'managed',
        type: 'hcloud_server',
        name: 'web',
        instances: [{ attributes: { id: 'srv-1', server_type: 'cx21' } }],
      }],
    }));

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      const vmSignal = result.signals.find((s) => s.implies?.includes('service_dep:vm_compute'));
      expect(vmSignal).toBeDefined();
      expect(vmSignal?.id).toMatch(/^INV-\d{2}$/);
    } finally {
      rmSync(tfPath, { force: true });
    }
  });

  it('assigns contiguous INV-NN IDs when both Cargo and tfstate add services', async () => {
    const tfPath = join(TF_DIR, 'redis-contiguous.tfstate');
    writeFileSync(tfPath, TFSTATE_REDIS_DIGEST);
    writeFileSync(join(TMP_SRC, 'Cargo.toml'), CARGO_TOML_PG_ONLY);

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      const pgSignal = result.signals.find((s) => s.implies?.includes('service_dep:postgresql'));
      const redisSignal = result.signals.find((s) => s.implies?.includes('service_dep:redis'));

      expect(pgSignal).toBeDefined();
      expect(redisSignal).toBeDefined();

      const pgNum  = parseInt(pgSignal!.id.replace('INV-', ''), 10);
      const redNum = parseInt(redisSignal!.id.replace('INV-', ''), 10);
      expect(redNum).toBe(pgNum + 1);
    } finally {
      rmSync(tfPath, { force: true });
      rmSync(join(TMP_SRC, 'Cargo.toml'), { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// pass-01 Pulumi state detection (#1321)
// ---------------------------------------------------------------------------

const PULUMI_DIR = join(TMP_WS, 'wsp', 'inputs', 'pulumi');

const PULUMI_EXPORT = JSON.stringify({
  version: 3,
  deployment: {
    resources: [
      {
        urn: 'urn:pulumi:prod::myapp::pulumi:pulumi:Stack::myapp-prod',
        type: 'pulumi:pulumi:Stack',
        inputs: {},
        outputs: {},
      },
      {
        urn: 'urn:pulumi:prod::myapp::aws:s3/bucket:Bucket::my-bucket',
        type: 'aws:s3/bucket:Bucket',
        inputs: { bucket: 'my-bucket' },
        outputs: { arn: 'arn:aws:s3:::my-bucket' },
      },
      {
        urn: 'urn:pulumi:prod::myapp::aws:eks/cluster:Cluster::my-cluster',
        type: 'aws:eks/cluster:Cluster',
        inputs: { name: 'my-cluster' },
        outputs: {},
      },
      {
        urn: 'urn:pulumi:prod::myapp::aws:rds/instance:Instance::my-db',
        type: 'aws:rds/instance:Instance',
        inputs: { engine: 'postgres14', instanceClass: 'db.t3.medium' },
        outputs: { address: 'my-db.us-east-1.rds.amazonaws.com' },
      },
    ],
  },
});

describe('pass-01 Pulumi state detection', () => {
  it('emits service_dep signals from wsp/inputs/pulumi/ state files', async () => {
    mkdirSync(PULUMI_DIR, { recursive: true });
    writeFileSync(join(PULUMI_DIR, 'myapp-prod.json'), PULUMI_EXPORT);

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      const objStorageSignal = result.signals.find((s) =>
        s.implies?.includes('service_dep:object_storage'),
      );
      const k8sSignal = result.signals.find((s) =>
        s.implies?.includes('service_dep:kubernetes'),
      );
      const pgSignal = result.signals.find((s) =>
        s.implies?.includes('service_dep:postgresql'),
      );

      expect(objStorageSignal, 'object_storage from aws:s3/bucket:Bucket').toBeDefined();
      expect(k8sSignal, 'kubernetes from aws:eks/cluster:Cluster').toBeDefined();
      expect(pgSignal, 'postgresql from aws:rds/instance:Instance engine=postgres14').toBeDefined();
    } finally {
      rmSync(PULUMI_DIR, { recursive: true, force: true });
    }
  });

  it('does not duplicate a service already detected via source code analysis', async () => {
    mkdirSync(PULUMI_DIR, { recursive: true });
    writeFileSync(join(PULUMI_DIR, 'myapp-prod.json'), PULUMI_EXPORT);
    // Cargo.toml already declares postgresql via sqlx
    writeFileSync(join(TMP_SRC, 'Cargo.toml'), CARGO_TOML_PG_ONLY);

    try {
      const result = await runInvPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      const pgSignals = result.signals.filter((s) =>
        s.implies?.includes('service_dep:postgresql'),
      );
      // Should appear exactly once (from Cargo.toml; not duplicated from Pulumi)
      expect(pgSignals).toHaveLength(1);
    } finally {
      rmSync(PULUMI_DIR, { recursive: true, force: true });
      rmSync(join(TMP_SRC, 'Cargo.toml'), { force: true });
    }
  });
});
