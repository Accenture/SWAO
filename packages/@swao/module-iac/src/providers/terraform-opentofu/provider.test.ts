// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  IaC provider abstraction module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { TerraformOpenTofuProvider } from './provider.js';
import { registerProvider, getProvider } from '../../registry.js';
import { parseTfState, collectResourceTypes } from './state-parser.js';
import { extractCloudNativeServices } from './resource-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TMP = join(tmpdir(), `swao-tf-provider-test-${process.pid}`);

const TFSTATE_V4 = JSON.stringify({
  version: 4,
  resources: [
    {
      mode: 'managed',
      type: 'docker_container',
      name: 'db',
      instances: [{ attributes: { image: 'postgres:16', env: [], command: [] } }],
    },
  ],
});

describe('TerraformOpenTofuProvider', () => {
  it('has toolchain identifier "terraform"', () => {
    const p = new TerraformOpenTofuProvider();
    expect(p.toolchain).toBe('terraform');
  });

  it('readState returns IaCResourceGraph from a TFv4 state file', async () => {
    mkdirSync(TMP, { recursive: true });
    const stateFile = join(TMP, 'test.tfstate');
    writeFileSync(stateFile, TFSTATE_V4);

    const p = new TerraformOpenTofuProvider();
    const graph = await p.readState([stateFile]);

    expect(graph.toolchain).toBe('terraform');
    expect(graph.resources).toHaveLength(1);
    expect(graph.resources[0]?.type).toBe('docker_container');
    expect(graph.resources[0]?.name).toBe('db');

    rmSync(TMP, { recursive: true, force: true });
  });

  it('detect returns true for a dir containing a .tfstate file', async () => {
    const dir = join(TMP, 'tf-detect');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'terraform.tfstate'), TFSTATE_V4);

    const p = new TerraformOpenTofuProvider();
    expect(await p.detect(dir)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('detect returns false for an empty directory', async () => {
    const dir = join(TMP, 'empty-dir');
    mkdirSync(dir, { recursive: true });

    const p = new TerraformOpenTofuProvider();
    expect(await p.detect(dir)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('can be registered and retrieved from the global registry', () => {
    const p = new TerraformOpenTofuProvider();
    registerProvider(p);
    expect(getProvider('terraform')).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// CDK for Terraform (cdktf) fixture -- D-085-07 validation (#1330)
// cdktf compiles to TF HCL and produces standard TFv4 .tfstate files.
// This confirms TerraformOpenTofuProvider handles cdktf state identically.
// ---------------------------------------------------------------------------

const CDKTF_FIXTURE = join(__dirname, '__fixtures__', 'cdktf-sample.tfstate');

describe('TerraformOpenTofuProvider -- cdktf fixture (D-085-07, #1330)', () => {
  it('readState parses cdktf-produced .tfstate without error', async () => {
    const p = new TerraformOpenTofuProvider();
    const graph = await p.readState([CDKTF_FIXTURE]);
    expect(graph.toolchain).toBe('terraform');
    expect(graph.resources.length).toBeGreaterThanOrEqual(1);
  });

  it('emits object_storage signal for aws_s3_bucket in cdktf state', () => {
    const state = parseTfState(CDKTF_FIXTURE);
    const byType = collectResourceTypes([state]);
    const detected = extractCloudNativeServices(byType);
    expect(detected.has('object_storage')).toBe(true);
    const evidence = detected.get('object_storage') ?? [];
    expect(evidence.some((e) => e.startsWith('aws_s3_bucket.'))).toBe(true);
  });

  it('cdktf resource names with generated suffixes are preserved as-is', async () => {
    const p = new TerraformOpenTofuProvider();
    const graph = await p.readState([CDKTF_FIXTURE]);
    const s3 = graph.resources.find((r) => r.type === 'aws_s3_bucket');
    expect(s3).toBeDefined();
    expect(s3?.name).toBe('app_bucket_E3A1B2C4');
  });

  it('cdktf-tagged attributes are preserved in resource attributes', async () => {
    const p = new TerraformOpenTofuProvider();
    const graph = await p.readState([CDKTF_FIXTURE]);
    const s3 = graph.resources.find((r) => r.type === 'aws_s3_bucket');
    const tags = s3?.attributes['tags'] as Record<string, string> | undefined;
    expect(tags?.['managed-by']).toBe('cdktf');
  });
});
