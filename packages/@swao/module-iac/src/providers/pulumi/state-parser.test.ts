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
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { parsePulumiState, findPulumiStateFiles } from './state-parser.js';
import { extractPulumiServices } from './resource-map.js';

const FIXTURE = join(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  '__fixtures__',
  'sample-stack-export.json',
);

const TMP = join(tmpdir(), `swao-pulumi-test-${process.pid}`);

// ---------------------------------------------------------------------------
// parsePulumiState
// ---------------------------------------------------------------------------

describe('parsePulumiState', () => {
  it('parses the fixture and returns an IaCResourceGraph', () => {
    const graph = parsePulumiState(FIXTURE);
    expect(graph.toolchain).toBe('pulumi');
    expect(graph.formatVersion).toBe('3');
  });

  it('filters out pulumi:pulumi:Stack and pulumi:providers:* resources', () => {
    const graph = parsePulumiState(FIXTURE);
    // Fixture has 5 resources; 2 (Stack + provider) must be filtered
    expect(graph.resources).toHaveLength(3);
    for (const r of graph.resources) {
      expect(r.type).not.toMatch(/^pulumi:pulumi:/);
      expect(r.type).not.toMatch(/^pulumi:providers:/);
    }
  });

  it('extracts the logical name from the URN (last segment after ::)', () => {
    const graph = parsePulumiState(FIXTURE);
    const names = graph.resources.map((r) => r.name);
    expect(names).toContain('my-bucket');
    expect(names).toContain('my-cluster');
    expect(names).toContain('my-db');
  });

  it('merges inputs and outputs into attributes', () => {
    const graph = parsePulumiState(FIXTURE);
    const bucket = graph.resources.find((r) => r.name === 'my-bucket');
    expect(bucket?.attributes['bucket']).toBe('my-bucket');
    expect(bucket?.attributes['arn']).toBeTruthy();
  });

  it('sets sourceToolchain to pulumi on every resource', () => {
    const graph = parsePulumiState(FIXTURE);
    for (const r of graph.resources) {
      expect(r.sourceToolchain).toBe('pulumi');
    }
  });
});

// ---------------------------------------------------------------------------
// extractPulumiServices
// ---------------------------------------------------------------------------

describe('extractPulumiServices -- fixture', () => {
  it('detects object_storage, kubernetes, postgresql from the fixture', () => {
    const graph = parsePulumiState(FIXTURE);
    const services = extractPulumiServices(graph);
    expect(services.get('object_storage')).toBeTruthy();
    expect(services.get('kubernetes')).toBeTruthy();
    expect(services.get('postgresql')).toBeTruthy();
    // No redis in the fixture
    expect(services.get('redis')).toBeUndefined();
  });

  it('correctly attributes postgresql to RDS postgres engine, not presence', () => {
    // aws:rds/instance:Instance is attribute-based -- if engine were mysql, no postgresql signal
    const graph = parsePulumiState(FIXTURE);
    const rds = graph.resources.find((r) => r.name === 'my-db');
    expect(rds?.attributes['engine']).toBe('postgres14');
  });
});

// ---------------------------------------------------------------------------
// extractPulumiServices -- attribute-based edge cases
// ---------------------------------------------------------------------------

describe('extractPulumiServices -- attribute-based', () => {
  function makeGraph(type: string, name: string, attrs: Record<string, unknown>) {
    return {
      toolchain: 'pulumi' as const,
      formatVersion: '3',
      resources: [{ type, name, provider: type.split(':')[0] ?? 'aws', attributes: attrs, mode: 'managed' as const, sourceToolchain: 'pulumi' as const }],
    };
  }

  it('aws:rds/instance:Instance with engine=mysql emits mysql not postgresql', () => {
    const g = makeGraph('aws:rds/instance:Instance', 'mydb', { engine: 'mysql' });
    const s = extractPulumiServices(g);
    expect(s.get('mysql')).toHaveLength(1);
    expect(s.get('postgresql')).toBeUndefined();
  });

  it('aws:elasticache/cluster:Cluster with engine=redis emits redis', () => {
    const g = makeGraph('aws:elasticache/cluster:Cluster', 'cache', { engine: 'redis' });
    expect(extractPulumiServices(g).get('redis')).toHaveLength(1);
  });

  it('aws:elasticache/cluster:Cluster with engine=memcached does NOT emit redis', () => {
    const g = makeGraph('aws:elasticache/cluster:Cluster', 'cache', { engine: 'memcached' });
    expect(extractPulumiServices(g).get('redis')).toBeUndefined();
  });

  it('azure-native:dbforpostgresql:FlexibleServer emits postgresql (presence)', () => {
    const g = makeGraph('azure-native:dbforpostgresql:FlexibleServer', 'pg', {});
    expect(extractPulumiServices(g).get('postgresql')).toHaveLength(1);
  });

  it('azure-native:dbforpostgresql:FlexibleServer with version emits postgresql@N', () => {
    const g = makeGraph('azure-native:dbforpostgresql:FlexibleServer', 'pg', { version: '16' });
    expect(extractPulumiServices(g).get('postgresql@16')).toHaveLength(1);
  });

  it('aws:rds/cluster:RdsCluster with engine aurora-postgresql emits postgresql', () => {
    const g = makeGraph('aws:rds/cluster:RdsCluster', 'aurora', { engine: 'aurora-postgresql' });
    expect(extractPulumiServices(g).get('postgresql')).toHaveLength(1);
    expect(extractPulumiServices(g).get('mysql')).toBeUndefined();
  });

  it('aws:rds/cluster:RdsCluster with engine aurora-mysql emits mysql not postgresql', () => {
    const g = makeGraph('aws:rds/cluster:RdsCluster', 'aurora', { engine: 'aurora-mysql' });
    expect(extractPulumiServices(g).get('mysql')).toHaveLength(1);
    expect(extractPulumiServices(g).get('postgresql')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractPulumiServices -- expanded resource types (#1329)
// ---------------------------------------------------------------------------

describe('extractPulumiServices -- expanded types', () => {
  function makeGraph(type: string, name: string, attrs: Record<string, unknown>) {
    return {
      toolchain: 'pulumi' as const,
      formatVersion: '3',
      resources: [{ type, name, provider: type.split(':')[0] ?? 'aws', attributes: attrs, mode: 'managed' as const, sourceToolchain: 'pulumi' as const }],
    };
  }

  it('aws:ec2/instance:Instance emits vm_compute', () => {
    const g = makeGraph('aws:ec2/instance:Instance', 'web', {});
    expect(extractPulumiServices(g).get('vm_compute')).toBeTruthy();
  });

  it('azure-native:compute:VirtualMachine emits vm_compute', () => {
    const g = makeGraph('azure-native:compute:VirtualMachine', 'vm', {});
    expect(extractPulumiServices(g).get('vm_compute')).toBeTruthy();
  });

  it('aws:kms/key:Key emits key_vault', () => {
    const g = makeGraph('aws:kms/key:Key', 'kms', {});
    expect(extractPulumiServices(g).get('key_vault')).toBeTruthy();
  });

  it('azure-native:network:LoadBalancer emits load_balancer', () => {
    const g = makeGraph('azure-native:network:LoadBalancer', 'lb', {});
    expect(extractPulumiServices(g).get('load_balancer')).toBeTruthy();
  });

  it('aws:alb/loadBalancer:LoadBalancer emits load_balancer', () => {
    const g = makeGraph('aws:alb/loadBalancer:LoadBalancer', 'alb', {});
    expect(extractPulumiServices(g).get('load_balancer')).toBeTruthy();
  });

  it('aws:dynamodb/table:Table emits nosql_database', () => {
    const g = makeGraph('aws:dynamodb/table:Table', 'dynamo', {});
    expect(extractPulumiServices(g).get('nosql_database')).toBeTruthy();
  });

  it('gcp:redis/instance:Instance emits redis', () => {
    const g = makeGraph('gcp:redis/instance:Instance', 'redis', {});
    expect(extractPulumiServices(g).get('redis')).toBeTruthy();
  });

  it('aws:secretsmanager/secret:Secret emits secrets_management', () => {
    const g = makeGraph('aws:secretsmanager/secret:Secret', 'sec', {});
    expect(extractPulumiServices(g).get('secrets_management')).toBeTruthy();
  });

  it('azure-native:eventhub:EventHub emits event_streaming and messaging', () => {
    const g = makeGraph('azure-native:eventhub:EventHub', 'eh', {});
    const s = extractPulumiServices(g);
    expect(s.get('event_streaming')).toBeTruthy();
    expect(s.get('messaging')).toBeTruthy();
  });

  it('gcp:logging/projectSink:ProjectSink emits audit_logging', () => {
    const g = makeGraph('gcp:logging/projectSink:ProjectSink', 'sink', {});
    expect(extractPulumiServices(g).get('audit_logging')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// findPulumiStateFiles
// ---------------------------------------------------------------------------

describe('findPulumiStateFiles', () => {
  it('returns files from wsp/inputs/pulumi/', () => {
    const dir = join(TMP, 'ws');
    const pulumiDir = join(dir, 'wsp', 'inputs', 'pulumi');
    mkdirSync(pulumiDir, { recursive: true });
    writeFileSync(join(pulumiDir, 'myapp-prod.json'), '{}');

    const files = findPulumiStateFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('myapp-prod.json');

    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns empty array when directory does not exist', () => {
    expect(findPulumiStateFiles('/nonexistent/path')).toHaveLength(0);
  });

  it('returns empty array when workspacePath is undefined', () => {
    expect(findPulumiStateFiles(undefined)).toHaveLength(0);
  });
});
