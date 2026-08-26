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

import type { IaCResource, IaCResourceGraph } from '../../types.js';

// ---------------------------------------------------------------------------
// Pulumi resource type -> service_dep mapping (design 085 SS9, #1321)
//
// Pulumi type format: {provider}:{module}/{className}:{TypeName}
// Examples: aws:s3/bucket:Bucket, azure-native:storage:StorageAccount
//
// Entries here are presence-based. Attribute-based detection (engine guards
// for RDS, ElastiCache, Cloud SQL) is handled in extractPulumiServices().
// ---------------------------------------------------------------------------

type PulumiMapping = readonly [string, readonly string[]];

export const PULUMI_RESOURCE_TYPE_TO_SERVICE_DEP: readonly PulumiMapping[] = [
  // Object storage
  ['aws:s3/bucket:Bucket',                         ['object_storage']],
  ['aws:s3/bucketV2:BucketV2',                    ['object_storage']],
  ['azure-native:storage:StorageAccount',         ['object_storage']],
  ['gcp:storage/bucket:Bucket',                   ['object_storage']],

  // Kubernetes
  ['aws:eks/cluster:Cluster',                     ['kubernetes']],
  ['azure-native:containerservice:ManagedCluster', ['kubernetes']],
  ['gcp:container/cluster:Cluster',               ['kubernetes']],

  // PostgreSQL (type-deterministic -- Azure named services)
  ['azure-native:dbforpostgresql:FlexibleServer', ['postgresql']],
  ['azure-native:dbforpostgresql:Server',         ['postgresql']],

  // Redis (type-deterministic)
  ['azure-native:cache:Redis',                    ['redis']],
  ['gcp:redis/instance:Instance',                 ['redis']],
  ['aws:elasticache/replicationGroup:ReplicationGroup', ['redis']],

  // Serverless
  ['aws:lambda/function:Function',                ['serverless_compute']],
  ['azure-native:web:WebApp',                     ['serverless_compute']],
  ['gcp:cloudfunctions/function:Function',        ['serverless_compute']],
  ['gcp:cloudfunctionsv2/function:Function',      ['serverless_compute']],

  // VM compute
  ['aws:ec2/instance:Instance',                   ['vm_compute']],
  ['azure-native:compute:VirtualMachine',         ['vm_compute']],
  ['gcp:compute/instance:Instance',               ['vm_compute']],

  // Networking (firewall / security groups)
  ['aws:ec2/securityGroup:SecurityGroup',         ['networking']],
  ['aws:ec2/securityGroupRule:SecurityGroupRule', ['networking']],
  ['azure-native:network:NetworkSecurityGroup',   ['networking']],
  ['gcp:compute/firewall:Firewall',               ['networking']],

  // KMS / key management
  ['aws:kms/key:Key',                             ['key_vault']],
  ['azure-native:keyvault:Vault',                 ['key_vault']],
  ['gcp:kms/keyRing:KeyRing',                     ['key_vault']],
  ['gcp:kms/cryptoKey:CryptoKey',                 ['key_vault']],

  // Secrets management
  ['aws:secretsmanager/secret:Secret',            ['secrets_management']],
  ['azure-native:keyvault:Secret',                ['secrets_management']],
  ['gcp:secretmanager/secret:Secret',             ['secrets_management']],

  // MySQL (type-deterministic Azure)
  ['azure-native:dbformysql:FlexibleServer',      ['mysql']],
  ['azure-native:dbformysql:Server',              ['mysql']],

  // Load balancer
  ['aws:alb/loadBalancer:LoadBalancer',           ['load_balancer']],
  ['aws:lb/loadBalancer:LoadBalancer',            ['load_balancer']],
  ['azure-native:network:LoadBalancer',           ['load_balancer']],
  ['gcp:compute/globalForwardingRule:GlobalForwardingRule', ['load_balancer']],

  // Container registry
  ['aws:ecr/repository:Repository',              ['container_registry']],
  ['azure-native:containerregistry:Registry',    ['container_registry']],
  ['gcp:artifactregistry/repository:Repository', ['container_registry']],

  // NoSQL database
  ['aws:dynamodb/table:Table',                   ['nosql_database']],
  ['azure-native:documentdb:DatabaseAccount',    ['nosql_database']],
  ['gcp:bigtable/instance:Instance',             ['nosql_database']],

  // Queue / messaging / event streaming
  ['aws:sqs/queue:Queue',                        ['queue']],
  ['aws:sns/topic:Topic',                        ['messaging']],
  ['azure-native:servicebus:Queue',              ['queue']],
  ['azure-native:eventhub:EventHub',             ['event_streaming', 'messaging']],
  ['aws:kinesis/stream:Stream',                  ['event_streaming']],

  // DNS
  ['aws:route53/zone:Zone',                      ['dns']],
  ['azure-native:dns:Zone',                      ['dns']],
  ['gcp:dns/managedZone:ManagedZone',            ['dns']],

  // Backup
  ['aws:backup/vault:BackupVault',               ['backup']],
  ['azure-native:recoveryservices:Vault',        ['backup']],

  // VPN
  ['aws:ec2/vpnGateway:VpnGateway',             ['vpn']],
  ['azure-native:network:VpnGateway',           ['vpn']],

  // Monitoring / audit logging
  ['azure-native:operationalinsights:Workspace', ['monitoring']],
  ['gcp:monitoring/alertPolicy:AlertPolicy',     ['monitoring']],
  ['gcp:logging/projectSink:ProjectSink',        ['audit_logging']],
  ['aws:cloudwatch/logGroup:LogGroup',           ['monitoring']],
];

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function addEvidence(
  detected: Map<string, string[]>,
  code: string,
  evidence: string,
): void {
  const existing = detected.get(code) ?? [];
  existing.push(evidence);
  detected.set(code, existing);
}

function getAttr(r: IaCResource, key: string): string {
  return ((r.attributes?.[key] ?? '') as string);
}

// ---------------------------------------------------------------------------
// Pulumi service extraction (presence + attribute)
// ---------------------------------------------------------------------------

export function extractPulumiServices(graph: IaCResourceGraph): Map<string, string[]> {
  const detected = new Map<string, string[]>();

  // Build byType lookup
  const byType = new Map<string, IaCResource[]>();
  for (const r of graph.resources) {
    const list = byType.get(r.type) ?? [];
    list.push(r);
    byType.set(r.type, list);
  }

  // Presence-based pass
  for (const [resourceType, serviceCodes] of PULUMI_RESOURCE_TYPE_TO_SERVICE_DEP) {
    const resources = byType.get(resourceType);
    if (!resources || resources.length === 0) continue;
    for (const r of resources) {
      for (const code of serviceCodes) {
        addEvidence(detected, code, `${resourceType}.${r.name}`);
      }
    }
  }

  // Attribute-based: aws:rds/instance:Instance -- engine distinguishes postgres/mysql
  for (const r of byType.get('aws:rds/instance:Instance') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine.startsWith('postgres') || engine.includes('aurora-postgresql')) {
      addEvidence(detected, 'postgresql', `aws:rds/instance:Instance.${r.name} (engine: ${engine})`);
    } else if (engine === 'mysql' || engine.includes('aurora-mysql')) {
      addEvidence(detected, 'mysql', `aws:rds/instance:Instance.${r.name} (engine: ${engine})`);
    }
  }

  // Attribute-based: aws:rds/cluster:RdsCluster -- aurora engine guard
  for (const r of byType.get('aws:rds/cluster:RdsCluster') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine.includes('aurora-postgresql') || engine.startsWith('postgres')) {
      addEvidence(detected, 'postgresql', `aws:rds/cluster:RdsCluster.${r.name} (engine: ${engine})`);
    } else if (engine.includes('aurora-mysql') || engine === 'mysql') {
      addEvidence(detected, 'mysql', `aws:rds/cluster:RdsCluster.${r.name} (engine: ${engine})`);
    }
  }

  // Attribute-based: aws:elasticache/cluster:Cluster -- engine guard (redis vs memcached)
  for (const r of byType.get('aws:elasticache/cluster:Cluster') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine === 'redis') {
      addEvidence(detected, 'redis', `aws:elasticache/cluster:Cluster.${r.name} (engine: redis)`);
    }
  }

  // Attribute-based: gcp:sql/databaseInstance:DatabaseInstance -- databaseVersion prefix
  for (const r of byType.get('gcp:sql/databaseInstance:DatabaseInstance') ?? []) {
    const dbVersion = getAttr(r, 'databaseVersion').toUpperCase();
    if (dbVersion.startsWith('POSTGRES_')) {
      addEvidence(detected, 'postgresql', `gcp:sql/databaseInstance:DatabaseInstance.${r.name} (version: ${dbVersion})`);
    } else if (dbVersion.startsWith('MYSQL_')) {
      addEvidence(detected, 'mysql', `gcp:sql/databaseInstance:DatabaseInstance.${r.name} (version: ${dbVersion})`);
    }
  }

  // Attribute-based: azure-native:dbforpostgresql:FlexibleServer -- version attribute
  for (const r of byType.get('azure-native:dbforpostgresql:FlexibleServer') ?? []) {
    const ver = getAttr(r, 'version');
    if (ver) {
      const major = parseInt(ver.split('.')[0] ?? '', 10);
      if (!isNaN(major)) {
        addEvidence(detected, `postgresql@${major}`, `azure-native:dbforpostgresql:FlexibleServer.${r.name} (version: ${ver})`);
      }
    }
  }

  return detected;
}
