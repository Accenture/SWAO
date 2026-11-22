// #3801: resource types carry no resource name (Design 120 section 6.4).
// The AWS ARN parser on every ARN shape of the bug, the leak detector on AWS,
// Azure, OTC and STACKIT id shapes, and the scan boundary guard: a driver that
// still returns a name in a type gets it replaced and a source recorded.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { awsResourceType, parseArn } from '../aws/aws-arn.js';
import { AWS_ARN_FORMATS } from '../aws/aws-arn-formats.js';
import { resourceIdNameSegments, resourceTypeNameLeaks, scrubResourceTypes } from '../privacy.js';
import { runLzLiveScan } from '../scan.js';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { VERIFIED, makeFakeDriver } from './fake-driver.js';

const ACCT = ['1111', '2222', '3333'].join('');
const arn = (svc: string, resource: string, region = 'eu-central-1'): string => `arn:aws:${svc}:${region}:${ACCT}:${resource}`;

describe('AWS ARN resource type (aws-arn.ts)', () => {
  const cases: [string, string][] = [
    ['arn:aws:s3:::payroll-exports', 's3.bucket'],
    ['arn:aws:s3:::payroll-exports/2026/report.csv', 's3.object'],
    [arn('sns', 'payroll-alerts'), 'sns.topic'],
    [arn('sqs', 'payroll-queue'), 'sqs.queue'],
    [arn('codepipeline', 'payroll-pipeline'), 'codepipeline.pipeline'],
    [arn('logs', 'log-group:/aws/lambda/payroll-fn:*'), 'logs.log-group'],
    [arn('secretsmanager', 'secret:prod/payroll/db-AbCdEf'), 'secretsmanager.secret'],
    [arn('lambda', 'function:payroll-fn'), 'lambda.function'],
    [arn('ec2', 'instance/i-0123456789abcdef0'), 'ec2.instance'],
    [arn('cloudformation', 'stack/payroll-stack/11111111-2222-4333-8444-555555555555'), 'cloudformation.stack'],
    // #3851: supplement format and type aliases
    [arn('servicecatalog', 'stack/payroll-product/pp-abcdefghijklm'), 'servicecatalog.stack'],
    [arn('events', 'rule/payroll-nightly'), 'events.rule'],
    [arn('events', 'rule/payroll-bus/payroll-nightly'), 'events.rule'],
  ];
  for (const [a, want] of cases) {
    it(`${a.split(':').slice(2, 3)} ${want}`, () => {
      const p = parseArn(a);
      expect(p && `${p.service}.${p.type}`).toBe(want);
      expect(resourceTypeNameLeaks({ id: a, type: want })).toEqual([]);
    });
  }

  it('falls back to a literal type token of the service, else `resource`; never a name', () => {
    expect(awsResourceType('ec2', 'instance')).toBe('resource');
    expect(awsResourceType('unknown-service', 'thing/payroll-thing')).toBe('resource');
    expect(parseArn('not-an-arn')).toBeNull();
  });

  it('is generated from the AWS Service Authorization Reference (formats per service)', () => {
    expect(Object.keys(AWS_ARN_FORMATS).length).toBeGreaterThan(300);
    expect(AWS_ARN_FORMATS['s3']).toContainEqual(['bucket', '${BucketName}']);
    expect(AWS_ARN_FORMATS['sns']).toContainEqual(['topic', '${TopicName}']);
  });
});

describe('resource type name leaks (privacy.ts)', () => {
  it('detects the old parseArn results for the bug shapes', () => {
    expect(resourceTypeNameLeaks({ id: 'arn:aws:s3:::payroll-exports', type: 's3.payroll-exports' })).toEqual(['payroll-exports']);
    expect(resourceTypeNameLeaks({ id: arn('sns', 'payroll-alerts'), type: 'sns.payroll-alerts' })).toEqual(['payroll-alerts']);
    expect(resourceTypeNameLeaks({ id: arn('logs', 'log-group:payroll-logs/x'), type: 'logs.log-group:payroll-logs' })).toEqual(['payroll-logs']);
    expect(resourceTypeNameLeaks({ id: arn('secretsmanager', 'secret:prod/db-AbCdEf'), type: 'secretsmanager.secret:prod' })).toEqual(['prod']);
  });

  it('reads Azure ARM ids, OTC and STACKIT ids, and accepts their clean types', () => {
    const arm = '/subscriptions/s-1/resourceGroups/payroll-rg/providers/Microsoft.Compute/virtualMachines/payroll-vm';
    expect(resourceIdNameSegments(arm)).toEqual(['payroll-rg', 'payroll-vm']);
    expect(resourceTypeNameLeaks({ id: arm, type: 'microsoft.compute/virtualmachines' })).toEqual([]);
    expect(resourceTypeNameLeaks({ id: arm, type: 'microsoft.compute/payroll-vm' })).toEqual(['payroll-vm']);
    expect(resourceTypeNameLeaks({ id: '7a6c0f3e-1111-4222-8333-944444444444', type: 'ecs.cloudservers' })).toEqual([]);
    expect(resourceTypeNameLeaks({ id: 'srv-1234', type: 'iaas.server' })).toEqual([]);
  });

  it('detects a resource name with a dot (SQS FIFO) and scrubs it like any other name (#3850)', () => {
    const fifo = { id: arn('sqs', 'payroll-queue.fifo'), type: 'sqs.payroll-queue.fifo' };
    expect(resourceTypeNameLeaks(fifo)).toEqual(['payroll-queue.fifo']);
    expect(resourceTypeNameLeaks({ id: arn('sqs', 'payroll-queue.fifo'), type: 'sqs.queue' })).toEqual([]);
    expect(resourceTypeNameLeaks({ id: 'arn:aws:s3:::my.payroll.bucket', type: 's3.bucket' })).toEqual([]);
    const r = scrubResourceTypes([fifo, { id: arn('sqs', 'payroll-queue'), type: 'sqs.payroll-queue' }]);
    expect(r.replaced).toBe(2);
    expect(r.resources.map((x) => x.type)).toEqual(['sqs.resource', 'sqs.resource']);
  });

  it('scrubResourceTypes replaces a leaking type with <service>.resource and counts it', () => {
    const r = scrubResourceTypes([{ id: 'arn:aws:s3:::payroll-exports', type: 's3.payroll-exports' }, { id: arn('lambda', 'function:f1'), type: 'lambda.function' }]);
    expect(r.replaced).toBe(1);
    expect(r.resources.map((x) => x.type)).toEqual(['s3.resource', 'lambda.function']);
  });
});

describe('scan boundary (scan.ts)', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('no resource type in the scan output repeats a name of its id, even when a driver returns one', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, {
      listResources: async () => [
        { id: 'arn:aws:s3:::payroll-exports', type: 's3.payroll-exports', service_code: 's3' },
        { id: arn('sqs', 'payroll-queue'), type: 'sqs.queue', service_code: 'sqs' },
      ],
    }));
    const ws = dir('swao-types-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n'));
    const store = new CredentialStore(dir('swao-types-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }) });
    const scan = out.results[0]?.scan;
    expect(scan).toBeDefined();
    const resources = scan?.estate.resources ?? [];
    expect(resources.map((r) => r.type)).toEqual(['s3.resource', 'sqs.queue']);
    for (const r of resources) expect(resourceTypeNameLeaks(r)).toEqual([]);
    expect(scan?.meta.sources).toContainEqual({ name: 'inventory:resource-types', status: 'not_collected', reason: '1 resource type(s) repeated a resource name and were replaced' });
  });
});
