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
import type { TfResource } from './state-parser.js';
import { extractCloudNativeServices, mergeServiceMaps, extractPgMajorVersion } from './resource-map.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal byType map from a list of TfResource definitions
// ---------------------------------------------------------------------------

function makeByType(resources: TfResource[]): Map<string, TfResource[]> {
  const m = new Map<string, TfResource[]>();
  for (const r of resources) {
    const list = m.get(r.type) ?? [];
    list.push(r);
    m.set(r.type, list);
  }
  return m;
}

function makeResource(type: string, name: string, attrs: Record<string, unknown> = {}): TfResource {
  return { type, name, instances: [{ attributes: attrs }] };
}

// ---------------------------------------------------------------------------
// #1301 VPS/compute + docker_network/volume
// ---------------------------------------------------------------------------

describe('#1301 vm_compute / networking / block_storage', () => {
  it('detects vm_compute from hcloud_server', () => {
    const m = makeByType([makeResource('hcloud_server', 'web')]);
    expect(extractCloudNativeServices(m).get('vm_compute')).toHaveLength(1);
  });

  it('detects vm_compute from hostinger_vps', () => {
    const m = makeByType([makeResource('hostinger_vps', 'vps1')]);
    expect(extractCloudNativeServices(m).get('vm_compute')).toHaveLength(1);
  });

  it('detects networking from docker_network', () => {
    const m = makeByType([makeResource('docker_network', 'net1')]);
    expect(extractCloudNativeServices(m).get('networking')).toHaveLength(1);
  });

  it('detects block_storage from docker_volume', () => {
    const m = makeByType([makeResource('docker_volume', 'vol1')]);
    expect(extractCloudNativeServices(m).get('block_storage')).toHaveLength(1);
  });

  it('no vm_compute signal when no compute resource present', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'bucket1')]);
    expect(extractCloudNativeServices(m).get('vm_compute')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1302 Kubernetes
// ---------------------------------------------------------------------------

describe('#1302 kubernetes', () => {
  it('detects kubernetes from aws_eks_cluster', () => {
    const m = makeByType([makeResource('aws_eks_cluster', 'my-cluster')]);
    expect(extractCloudNativeServices(m).get('kubernetes')).toHaveLength(1);
  });

  it('detects kubernetes from azurerm_kubernetes_cluster', () => {
    const m = makeByType([makeResource('azurerm_kubernetes_cluster', 'aks')]);
    expect(extractCloudNativeServices(m).get('kubernetes')).toHaveLength(1);
  });

  it('no kubernetes signal from unrelated resource', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'bucket1')]);
    expect(extractCloudNativeServices(m).get('kubernetes')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1303 Object storage
// ---------------------------------------------------------------------------

describe('#1303 object_storage', () => {
  it('detects object_storage from aws_s3_bucket', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'my-bucket')]);
    expect(extractCloudNativeServices(m).get('object_storage')).toHaveLength(1);
  });

  it('detects object_storage from azurerm_storage_account', () => {
    const m = makeByType([makeResource('azurerm_storage_account', 'stor')]);
    expect(extractCloudNativeServices(m).get('object_storage')).toHaveLength(1);
  });

  it('no object_storage from unrelated resource', () => {
    const m = makeByType([makeResource('hcloud_server', 'srv1')]);
    expect(extractCloudNativeServices(m).get('object_storage')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1304 KMS / secrets management
// ---------------------------------------------------------------------------

describe('#1304 key_vault / secrets_management', () => {
  it('detects key_vault from aws_kms_key', () => {
    const m = makeByType([makeResource('aws_kms_key', 'mykey')]);
    expect(extractCloudNativeServices(m).get('key_vault')).toHaveLength(1);
  });

  it('detects secrets_management from vault_mount', () => {
    const m = makeByType([makeResource('vault_mount', 'kv')]);
    expect(extractCloudNativeServices(m).get('secrets_management')).toHaveLength(1);
  });

  it('no key_vault signal when absent', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'b')]);
    expect(extractCloudNativeServices(m).get('key_vault')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1305 PostgreSQL (attribute-based for engine-polymorphic types)
// ---------------------------------------------------------------------------

describe('#1305 postgresql', () => {
  it('detects postgresql from azurerm_postgresql_flexible_server (presence)', () => {
    const m = makeByType([makeResource('azurerm_postgresql_flexible_server', 'pg1')]);
    expect(extractCloudNativeServices(m).get('postgresql')).toHaveLength(1);
  });

  it('detects postgresql from aws_db_instance with engine=postgres14', () => {
    const m = makeByType([makeResource('aws_db_instance', 'pg', { engine: 'postgres14' })]);
    expect(extractCloudNativeServices(m).get('postgresql')).toHaveLength(1);
  });

  it('does NOT emit postgresql for aws_db_instance with engine=mysql', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db', { engine: 'mysql' })]);
    expect(extractCloudNativeServices(m).get('postgresql')).toBeUndefined();
  });

  it('detects postgresql from aws_rds_cluster with engine=aurora-postgresql', () => {
    const m = makeByType([makeResource('aws_rds_cluster', 'cluster', { engine: 'aurora-postgresql' })]);
    expect(extractCloudNativeServices(m).get('postgresql')).toHaveLength(1);
  });

  it('detects postgresql from google_sql_database_instance with POSTGRES_15', () => {
    const m = makeByType([makeResource('google_sql_database_instance', 'gdb', { database_version: 'POSTGRES_15' })]);
    expect(extractCloudNativeServices(m).get('postgresql')).toHaveLength(1);
  });

  it('does NOT emit postgresql for google_sql_database_instance with MYSQL_8_0', () => {
    const m = makeByType([makeResource('google_sql_database_instance', 'gdb', { database_version: 'MYSQL_8_0' })]);
    expect(extractCloudNativeServices(m).get('postgresql')).toBeUndefined();
  });

  it('detects postgresql from hcloud_managed_database with type=pg', () => {
    const m = makeByType([makeResource('hcloud_managed_database', 'hdb', { type: 'pg' })]);
    expect(extractCloudNativeServices(m).get('postgresql')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #1306 MySQL / MariaDB
// ---------------------------------------------------------------------------

describe('#1306 mysql / mariadb', () => {
  it('detects mysql from azurerm_mysql_flexible_server (presence)', () => {
    const m = makeByType([makeResource('azurerm_mysql_flexible_server', 'mysql1')]);
    expect(extractCloudNativeServices(m).get('mysql')).toHaveLength(1);
  });

  it('detects mariadb from azurerm_mariadb_server (presence)', () => {
    const m = makeByType([makeResource('azurerm_mariadb_server', 'maria1')]);
    expect(extractCloudNativeServices(m).get('mariadb')).toHaveLength(1);
  });

  it('detects mysql from aws_db_instance with engine=mysql', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db', { engine: 'mysql' })]);
    expect(extractCloudNativeServices(m).get('mysql')).toHaveLength(1);
  });

  it('detects mariadb from aws_db_instance with engine=mariadb', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db', { engine: 'mariadb' })]);
    expect(extractCloudNativeServices(m).get('mariadb')).toHaveLength(1);
  });

  it('does NOT emit mysql for aws_db_instance with engine=postgres', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db', { engine: 'postgres14' })]);
    expect(extractCloudNativeServices(m).get('mysql')).toBeUndefined();
  });

  it('detects mysql from google_sql_database_instance with MYSQL_8_0', () => {
    const m = makeByType([makeResource('google_sql_database_instance', 'gdb', { database_version: 'MYSQL_8_0' })]);
    expect(extractCloudNativeServices(m).get('mysql')).toHaveLength(1);
  });

  it('detects mysql from hcloud_managed_database with type=mysql', () => {
    const m = makeByType([makeResource('hcloud_managed_database', 'hdb', { type: 'mysql' })]);
    expect(extractCloudNativeServices(m).get('mysql')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #1307 Redis
// ---------------------------------------------------------------------------

describe('#1307 redis', () => {
  it('detects redis from azurerm_redis_cache (presence)', () => {
    const m = makeByType([makeResource('azurerm_redis_cache', 'cache')]);
    expect(extractCloudNativeServices(m).get('redis')).toHaveLength(1);
  });

  it('detects redis from aws_elasticache_replication_group (presence)', () => {
    const m = makeByType([makeResource('aws_elasticache_replication_group', 'rg')]);
    expect(extractCloudNativeServices(m).get('redis')).toHaveLength(1);
  });

  it('detects redis from aws_elasticache_cluster with engine=redis', () => {
    const m = makeByType([makeResource('aws_elasticache_cluster', 'cache', { engine: 'redis' })]);
    expect(extractCloudNativeServices(m).get('redis')).toHaveLength(1);
  });

  it('does NOT emit redis for aws_elasticache_cluster with engine=memcached', () => {
    const m = makeByType([makeResource('aws_elasticache_cluster', 'cache', { engine: 'memcached' })]);
    expect(extractCloudNativeServices(m).get('redis')).toBeUndefined();
  });

  it('detects redis from aws_elasticache_serverless_cache with engine=redis', () => {
    const m = makeByType([makeResource('aws_elasticache_serverless_cache', 'sc', { engine: 'redis' })]);
    expect(extractCloudNativeServices(m).get('redis')).toHaveLength(1);
  });

  it('does NOT emit redis for aws_elasticache_serverless_cache with engine=memcached', () => {
    const m = makeByType([makeResource('aws_elasticache_serverless_cache', 'sc', { engine: 'memcached' })]);
    expect(extractCloudNativeServices(m).get('redis')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1308 Queue / messaging / event_streaming
// ---------------------------------------------------------------------------

describe('#1308 queue / messaging / event_streaming', () => {
  it('detects queue from aws_sqs_queue', () => {
    const m = makeByType([makeResource('aws_sqs_queue', 'q1')]);
    expect(extractCloudNativeServices(m).get('queue')).toHaveLength(1);
  });

  it('detects event_streaming from aws_kinesis_stream', () => {
    const m = makeByType([makeResource('aws_kinesis_stream', 'stream1')]);
    expect(extractCloudNativeServices(m).get('event_streaming')).toHaveLength(1);
  });

  it('azurerm_servicebus_namespace emits both messaging and queue', () => {
    const m = makeByType([makeResource('azurerm_servicebus_namespace', 'sb')]);
    const result = extractCloudNativeServices(m);
    expect(result.get('messaging')).toHaveLength(1);
    expect(result.get('queue')).toHaveLength(1);
  });

  it('google_pubsub_topic emits event_streaming, messaging, and queue', () => {
    const m = makeByType([makeResource('google_pubsub_topic', 'topic1')]);
    const result = extractCloudNativeServices(m);
    expect(result.get('event_streaming')).toHaveLength(1);
    expect(result.get('messaging')).toHaveLength(1);
    expect(result.get('queue')).toHaveLength(1);
  });

  it('no queue signal from unrelated resource', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'b')]);
    expect(extractCloudNativeServices(m).get('queue')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1309 NoSQL database
// ---------------------------------------------------------------------------

describe('#1309 nosql_database', () => {
  it('detects nosql_database from aws_dynamodb_table', () => {
    const m = makeByType([makeResource('aws_dynamodb_table', 'table1')]);
    expect(extractCloudNativeServices(m).get('nosql_database')).toHaveLength(1);
  });

  it('detects nosql_database from azurerm_cosmosdb_account', () => {
    const m = makeByType([makeResource('azurerm_cosmosdb_account', 'cosmos')]);
    expect(extractCloudNativeServices(m).get('nosql_database')).toHaveLength(1);
  });

  it('no nosql signal from S3 bucket', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'b')]);
    expect(extractCloudNativeServices(m).get('nosql_database')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1310 Load balancer
// ---------------------------------------------------------------------------

describe('#1310 load_balancer', () => {
  it('detects load_balancer from aws_lb', () => {
    const m = makeByType([makeResource('aws_lb', 'alb1')]);
    expect(extractCloudNativeServices(m).get('load_balancer')).toHaveLength(1);
  });

  it('detects load_balancer from azurerm_application_gateway', () => {
    const m = makeByType([makeResource('azurerm_application_gateway', 'agw')]);
    expect(extractCloudNativeServices(m).get('load_balancer')).toHaveLength(1);
  });

  it('no load_balancer from unrelated resource', () => {
    const m = makeByType([makeResource('aws_lambda_function', 'fn')]);
    expect(extractCloudNativeServices(m).get('load_balancer')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1311 Container registry
// ---------------------------------------------------------------------------

describe('#1311 container_registry', () => {
  it('detects container_registry from aws_ecr_repository', () => {
    const m = makeByType([makeResource('aws_ecr_repository', 'repo1')]);
    expect(extractCloudNativeServices(m).get('container_registry')).toHaveLength(1);
  });

  it('detects container_registry from azurerm_container_registry', () => {
    const m = makeByType([makeResource('azurerm_container_registry', 'acr')]);
    expect(extractCloudNativeServices(m).get('container_registry')).toHaveLength(1);
  });

  it('no container_registry from EKS cluster', () => {
    const m = makeByType([makeResource('aws_eks_cluster', 'k8s')]);
    expect(extractCloudNativeServices(m).get('container_registry')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1312 DNS
// ---------------------------------------------------------------------------

describe('#1312 dns', () => {
  it('detects dns from aws_route53_zone', () => {
    const m = makeByType([makeResource('aws_route53_zone', 'zone')]);
    expect(extractCloudNativeServices(m).get('dns')).toHaveLength(1);
  });

  it('no dns from load balancer', () => {
    const m = makeByType([makeResource('aws_lb', 'alb')]);
    expect(extractCloudNativeServices(m).get('dns')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1313 Backup
// ---------------------------------------------------------------------------

describe('#1313 backup', () => {
  it('detects backup from aws_backup_vault', () => {
    const m = makeByType([makeResource('aws_backup_vault', 'vault')]);
    expect(extractCloudNativeServices(m).get('backup')).toHaveLength(1);
  });

  it('detects backup from azurerm_recovery_services_vault', () => {
    const m = makeByType([makeResource('azurerm_recovery_services_vault', 'rsv')]);
    expect(extractCloudNativeServices(m).get('backup')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #1314 VPN
// ---------------------------------------------------------------------------

describe('#1314 vpn', () => {
  it('detects vpn from aws_vpn_gateway', () => {
    const m = makeByType([makeResource('aws_vpn_gateway', 'vpn1')]);
    expect(extractCloudNativeServices(m).get('vpn')).toHaveLength(1);
  });

  it('detects vpn from azurerm_virtual_network_gateway', () => {
    const m = makeByType([makeResource('azurerm_virtual_network_gateway', 'vngw')]);
    expect(extractCloudNativeServices(m).get('vpn')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #1315 Serverless / FaaS
// ---------------------------------------------------------------------------

describe('#1315 serverless_compute', () => {
  it('detects serverless_compute from aws_lambda_function', () => {
    const m = makeByType([makeResource('aws_lambda_function', 'fn1')]);
    expect(extractCloudNativeServices(m).get('serverless_compute')).toHaveLength(1);
  });

  it('detects serverless_compute from azurerm_linux_function_app', () => {
    const m = makeByType([makeResource('azurerm_linux_function_app', 'fn2')]);
    expect(extractCloudNativeServices(m).get('serverless_compute')).toHaveLength(1);
  });

  it('no serverless from ECS service', () => {
    const m = makeByType([makeResource('aws_ecs_service', 'svc')]);
    expect(extractCloudNativeServices(m).get('serverless_compute')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1316 Monitoring and audit_logging
// ---------------------------------------------------------------------------

describe('#1316 monitoring / audit_logging', () => {
  it('detects monitoring from aws_cloudwatch_log_group', () => {
    const m = makeByType([makeResource('aws_cloudwatch_log_group', 'logs')]);
    expect(extractCloudNativeServices(m).get('monitoring')).toHaveLength(1);
  });

  it('detects audit_logging from google_logging_project_sink (not monitoring)', () => {
    const m = makeByType([makeResource('google_logging_project_sink', 'sink1')]);
    const result = extractCloudNativeServices(m);
    expect(result.get('audit_logging')).toHaveLength(1);
    expect(result.get('monitoring')).toBeUndefined();
  });

  it('detects monitoring from datadog_monitor', () => {
    const m = makeByType([makeResource('datadog_monitor', 'mon1')]);
    expect(extractCloudNativeServices(m).get('monitoring')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #1317 Firewall / security groups
// ---------------------------------------------------------------------------

describe('#1317 networking (firewall)', () => {
  it('detects networking from aws_security_group', () => {
    const m = makeByType([makeResource('aws_security_group', 'sg1')]);
    expect(extractCloudNativeServices(m).get('networking')).toHaveLength(1);
  });

  it('detects networking from google_compute_firewall', () => {
    const m = makeByType([makeResource('google_compute_firewall', 'fw1')]);
    expect(extractCloudNativeServices(m).get('networking')).toHaveLength(1);
  });

  it('no networking from S3 bucket', () => {
    const m = makeByType([makeResource('aws_s3_bucket', 'b')]);
    // Note: docker_network also emits networking, so use a resource with no network mappings
    expect(extractCloudNativeServices(m).get('networking')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeServiceMaps
// ---------------------------------------------------------------------------

describe('mergeServiceMaps', () => {
  it('merges two maps into one', () => {
    const m1 = new Map([['kubernetes', ['eks.k8s']]]);
    const m2 = new Map([['postgresql', ['rds.pg']]]);
    const merged = mergeServiceMaps(m1, m2);
    expect(merged.get('kubernetes')).toHaveLength(1);
    expect(merged.get('postgresql')).toHaveLength(1);
  });

  it('concatenates evidence for the same code', () => {
    const m1 = new Map([['kubernetes', ['eks.k8s']]]);
    const m2 = new Map([['kubernetes', ['aks.k8s2']]]);
    const merged = mergeServiceMaps(m1, m2);
    expect(merged.get('kubernetes')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// #1318 extractPgMajorVersion
// ---------------------------------------------------------------------------

describe('#1318 extractPgMajorVersion', () => {
  it('parses "15.4" -> "15"', () => expect(extractPgMajorVersion('15.4')).toBe('15'));
  it('parses "POSTGRES_15" -> "15"', () => expect(extractPgMajorVersion('POSTGRES_15')).toBe('15'));
  it('parses "postgres_16" case-insensitive -> "16"', () => expect(extractPgMajorVersion('postgres_16')).toBe('16'));
  it('parses plain "14" -> "14"', () => expect(extractPgMajorVersion('14')).toBe('14'));
  it('returns null for empty string', () => expect(extractPgMajorVersion('')).toBeNull());
  it('returns null for non-numeric', () => expect(extractPgMajorVersion('POSTGRES_')).toBeNull());
  it('returns null for "latest"', () => expect(extractPgMajorVersion('latest')).toBeNull());
});

// ---------------------------------------------------------------------------
// #1318 postgresql@<version> version-qualified signals
// ---------------------------------------------------------------------------

describe('#1318 postgresql@version signals', () => {
  it('aws_db_instance with engine=postgres and engine_version=15.4 emits postgresql@15', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db1', { engine: 'postgres', engine_version: '15.4' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql')).toBeDefined();
    expect(result.get('postgresql@15')).toBeDefined();
  });

  it('aws_db_instance with no engine_version emits postgresql but not postgresql@N', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db1', { engine: 'postgres' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql')).toBeDefined();
    expect(result.get('postgresql@15')).toBeUndefined();
  });

  it('aws_rds_cluster with aurora-postgresql engine and engine_version=15.3 emits postgresql@15', () => {
    const m = makeByType([makeResource('aws_rds_cluster', 'aurora1', { engine: 'aurora-postgresql', engine_version: '15.3' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql')).toBeDefined();
    expect(result.get('postgresql@15')).toBeDefined();
  });

  it('google_sql_database_instance POSTGRES_16 emits postgresql and postgresql@16', () => {
    const m = makeByType([makeResource('google_sql_database_instance', 'csql1', { database_version: 'POSTGRES_16' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql')).toBeDefined();
    expect(result.get('postgresql@16')).toBeDefined();
  });

  it('hcloud_managed_database with type=pg and version=15 emits postgresql@15', () => {
    const m = makeByType([makeResource('hcloud_managed_database', 'hdb1', { type: 'pg', version: '15' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql')).toBeDefined();
    expect(result.get('postgresql@15')).toBeDefined();
  });

  it('azurerm_postgresql_flexible_server with version=15 emits postgresql and postgresql@15', () => {
    const m = makeByType([makeResource('azurerm_postgresql_flexible_server', 'pflex1', { version: '15' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql')).toBeDefined();
    expect(result.get('postgresql@15')).toBeDefined();
  });

  it('azurerm_postgresql_server with version=11 emits postgresql@11', () => {
    const m = makeByType([makeResource('azurerm_postgresql_server', 'psrv1', { version: '11' })]);
    const result = extractCloudNativeServices(m);
    expect(result.get('postgresql@11')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #1318 postgresql+pgaudit signals
// ---------------------------------------------------------------------------

describe('#1318 postgresql+pgaudit signals', () => {
  it('aws_db_parameter_group with pgaudit parameter emits postgresql+pgaudit', () => {
    const m = makeByType([makeResource('aws_db_parameter_group', 'pg1', {
      parameter: JSON.stringify([{ name: 'pgaudit.log', value: 'all', apply_method: 'immediate' }]),
    })]);
    expect(extractCloudNativeServices(m).get('postgresql+pgaudit')).toBeDefined();
  });

  it('aws_rds_cluster_parameter_group with pgaudit parameter emits postgresql+pgaudit', () => {
    const m = makeByType([makeResource('aws_rds_cluster_parameter_group', 'cpg1', {
      parameter: JSON.stringify([{ name: 'pgaudit.log_catalog', value: 'on' }]),
    })]);
    expect(extractCloudNativeServices(m).get('postgresql+pgaudit')).toBeDefined();
  });

  it('azurerm_postgresql_flexible_server_configuration with pgaudit name emits postgresql+pgaudit', () => {
    const m = makeByType([makeResource('azurerm_postgresql_flexible_server_configuration', 'cfg1', {
      name: 'pgaudit.log',
      value: 'all',
    })]);
    expect(extractCloudNativeServices(m).get('postgresql+pgaudit')).toBeDefined();
  });

  it('google_sql_database_instance with database_flags array pgaudit=on emits postgresql+pgaudit', () => {
    const m = makeByType([makeResource('google_sql_database_instance', 'csql1', {
      database_version: 'POSTGRES_15',
      database_flags: [{ name: 'cloudsql.enable_pgaudit', value: 'on' }],
    })]);
    expect(extractCloudNativeServices(m).get('postgresql+pgaudit')).toBeDefined();
  });

  it('google_sql_database_instance with pgaudit flag=off does not emit postgresql+pgaudit', () => {
    const m = makeByType([makeResource('google_sql_database_instance', 'csql1', {
      database_version: 'POSTGRES_15',
      database_flags: [{ name: 'cloudsql.enable_pgaudit', value: 'off' }],
    })]);
    expect(extractCloudNativeServices(m).get('postgresql+pgaudit')).toBeUndefined();
  });

  it('no postgresql+pgaudit when no pgaudit resources present', () => {
    const m = makeByType([makeResource('aws_db_instance', 'db1', { engine: 'postgres', engine_version: '15.4' })]);
    expect(extractCloudNativeServices(m).get('postgresql+pgaudit')).toBeUndefined();
  });
});
