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

import type { TfResource } from './state-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResourceMapping = readonly [string, readonly string[]];

// ---------------------------------------------------------------------------
// Cloud-native resource type -> service_dep mapping table (design 085 SS9)
//
// Presence-based: if the resource type appears in the state, ALL listed
// service_dep codes are detected. Multi-code entries (e.g., servicebus)
// emit more than one code.
//
// Issues that require attribute inspection (aws_db_instance engine guard,
// google_sql_database_instance database_version, hcloud_managed_database
// type, aws_elasticache_cluster engine) are handled in
// extractAttributeBasedServices() below -- do NOT add those resource types
// to this table.
// ---------------------------------------------------------------------------

export const RESOURCE_TYPE_TO_SERVICE_DEP: readonly ResourceMapping[] = [
  // --- #1301: VPS/compute + docker_network/volume ---
  ['hostinger_vps',              ['vm_compute']],
  ['hcloud_server',              ['vm_compute']],
  ['openstack_compute_instance_v2', ['vm_compute']],
  ['stackit_server',             ['vm_compute']],
  ['docker_network',             ['networking']],
  ['stackit_network',            ['networking']],
  ['docker_volume',              ['block_storage']],
  ['stackit_volume',             ['block_storage']],

  // --- #1302: Kubernetes cluster ---
  ['aws_eks_cluster',            ['kubernetes']],
  ['azurerm_kubernetes_cluster', ['kubernetes']],
  ['google_container_cluster',   ['kubernetes']],
  ['hcloud_managed_cluster',     ['kubernetes']],
  ['digitalocean_kubernetes_cluster', ['kubernetes']],
  ['stackit_ske_cluster',        ['kubernetes']],

  // --- #1303: Object storage ---
  ['aws_s3_bucket',              ['object_storage']],
  ['azurerm_storage_account',    ['object_storage']],
  ['azurerm_storage_blob',       ['object_storage']],
  ['google_storage_bucket',      ['object_storage']],
  ['minio_bucket',               ['object_storage']],
  ['stackit_objectstorage_bucket', ['object_storage']],

  // --- #1304: KMS and secrets management ---
  ['aws_kms_key',                ['key_vault']],
  ['azurerm_key_vault',          ['key_vault']],
  ['google_kms_key_ring',        ['key_vault']],
  ['google_kms_crypto_key',      ['key_vault']],
  ['vault_mount',                ['secrets_management']],
  ['aws_secretsmanager_secret',  ['secrets_management']],
  ['azurerm_key_vault_secret',   ['secrets_management']],
  ['google_secret_manager_secret', ['secrets_management']],
  ['stackit_secretsmanager_instance', ['secrets_management']],

  // --- #1305 PostgreSQL (type-deterministic only; engine-guarded variants
  //     aws_db_instance, aws_rds_cluster, google_sql_database_instance,
  //     hcloud_managed_database are handled in extractAttributeBasedServices) ---
  ['azurerm_postgresql_flexible_server', ['postgresql']],
  ['azurerm_postgresql_server',  ['postgresql']],
  ['stackit_postgresql_instance', ['postgresql']],

  // --- #1306 MySQL/MariaDB (type-deterministic) ---
  ['azurerm_mysql_flexible_server', ['mysql']],
  ['azurerm_mysql_server',       ['mysql']],
  ['stackit_mysqlflex_instance', ['mysql']],
  ['azurerm_mariadb_server',     ['mariadb']],

  // --- #1307 Redis (type-deterministic entries;
  //     aws_elasticache_cluster + aws_elasticache_serverless_cache
  //     require engine guard -- see extractAttributeBasedServices) ---
  ['azurerm_redis_cache',        ['redis']],
  ['google_redis_instance',      ['redis']],
  ['google_memorystore_redis_instance', ['redis']],
  ['aws_elasticache_replication_group', ['redis']],

  // --- #1308 Queues / messaging / event streaming ---
  ['aws_sqs_queue',              ['queue']],
  ['aws_sns_topic',              ['messaging']],
  ['aws_mq_broker',              ['messaging', 'queue']],
  ['aws_kinesis_stream',         ['event_streaming']],
  ['aws_msk_cluster',            ['event_streaming', 'messaging']],
  ['azurerm_eventhub_namespace', ['event_streaming', 'messaging']],
  ['azurerm_servicebus_namespace', ['messaging', 'queue']],
  ['google_pubsub_topic',        ['event_streaming', 'messaging', 'queue']],
  ['confluentcloud_kafka_cluster', ['event_streaming', 'messaging']],

  // --- #1309 NoSQL database ---
  ['aws_dynamodb_table',         ['nosql_database']],
  ['azurerm_cosmosdb_account',   ['nosql_database']],
  ['google_bigtable_instance',   ['nosql_database']],
  ['google_firestore_database',  ['nosql_database']],
  ['google_datastore_index',     ['nosql_database']],
  ['mongodbatlas_cluster',       ['nosql_database']],
  ['stackit_mongodbflex_instance', ['nosql_database']],

  // --- #1310 Load balancer ---
  ['aws_lb',                     ['load_balancer']],
  ['aws_alb',                    ['load_balancer']],
  ['aws_lb_listener',            ['load_balancer']],
  ['azurerm_lb',                 ['load_balancer']],
  ['azurerm_application_gateway', ['load_balancer']],
  ['google_compute_forwarding_rule', ['load_balancer']],
  ['google_compute_backend_service', ['load_balancer']],

  // --- #1311 Container registry ---
  ['aws_ecr_repository',         ['container_registry']],
  ['azurerm_container_registry', ['container_registry']],
  ['google_artifact_registry_repository', ['container_registry']],
  ['google_container_registry',  ['container_registry']],

  // --- #1312 DNS ---
  ['aws_route53_zone',           ['dns']],
  ['aws_route53_record',         ['dns']],
  ['azurerm_dns_zone',           ['dns']],
  ['google_dns_managed_zone',    ['dns']],

  // --- #1313 Backup ---
  ['aws_backup_vault',           ['backup']],
  ['aws_backup_plan',            ['backup']],
  ['azurerm_backup_policy_vm',   ['backup']],
  ['azurerm_recovery_services_vault', ['backup']],
  ['google_backup_backup_vault', ['backup']],

  // --- #1314 VPN connectivity ---
  ['aws_vpn_gateway',            ['vpn']],
  ['aws_customer_gateway',       ['vpn']],
  ['aws_vpn_connection',         ['vpn']],
  ['azurerm_vpn_gateway',        ['vpn']],
  ['azurerm_virtual_network_gateway', ['vpn']],
  ['google_compute_vpn_gateway', ['vpn']],

  // --- #1315 Serverless / FaaS ---
  ['aws_lambda_function',        ['serverless_compute']],
  ['azurerm_function_app',       ['serverless_compute']],
  ['azurerm_linux_function_app', ['serverless_compute']],
  ['google_cloudfunctions_function', ['serverless_compute']],
  ['google_cloudfunctions2_function', ['serverless_compute']],

  // --- #1316 Monitoring and audit logging ---
  ['aws_cloudwatch_log_group',   ['monitoring']],
  ['aws_cloudwatch_metric_alarm', ['monitoring']],
  ['azurerm_log_analytics_workspace', ['monitoring']],
  ['azurerm_monitor_action_group', ['monitoring']],
  ['google_logging_project_sink', ['audit_logging']],
  ['google_monitoring_alert_policy', ['monitoring']],
  ['datadog_monitor',            ['monitoring']],

  // --- #1317 Firewall and security groups ---
  ['aws_security_group',         ['networking']],
  ['aws_vpc_security_group_ingress_rule', ['networking']],
  ['azurerm_network_security_group', ['networking']],
  ['google_compute_firewall',    ['networking']],
];

// ---------------------------------------------------------------------------
// Internal helpers
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

function getAttr(r: TfResource, key: string): string {
  return ((r.instances[0]?.attributes?.[key] ?? '') as string);
}

// ---------------------------------------------------------------------------
// Attribute-based detection (#1305 PostgreSQL, #1306 MySQL/MariaDB,
// #1307 Redis engine guard, #1318 PG version + pgaudit)
// ---------------------------------------------------------------------------

// Extract the major integer from version strings like "15.4", "POSTGRES_15",
// or "15". Returns null when the value is absent or not parseable.
export function extractPgMajorVersion(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/^POSTGRES_/i, '');
  const major = parseInt(stripped.split('.')[0] ?? '', 10);
  return isNaN(major) ? null : String(major);
}

// Serialise an attribute value to a string for substring search.
function attrStr(r: TfResource, key: string): string {
  const raw = r.instances[0]?.attributes?.[key];
  if (raw === null || raw === undefined) return '';
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

function extractAttributeBasedServices(
  byType: Map<string, TfResource[]>,
  detected: Map<string, string[]>,
): void {
  // aws_db_instance: engine attribute distinguishes postgres / mysql / mariadb
  for (const r of byType.get('aws_db_instance') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine.startsWith('postgres') || engine.includes('aurora-postgresql')) {
      addEvidence(detected, 'postgresql', `aws_db_instance.${r.name} (engine: ${engine})`);
      const major = extractPgMajorVersion(getAttr(r, 'engine_version'));
      if (major) addEvidence(detected, `postgresql@${major}`, `aws_db_instance.${r.name} (engine_version: ${getAttr(r, 'engine_version')})`);
    } else if (engine === 'mysql' || engine.includes('aurora-mysql')) {
      addEvidence(detected, 'mysql', `aws_db_instance.${r.name} (engine: ${engine})`);
    } else if (engine === 'mariadb') {
      addEvidence(detected, 'mariadb', `aws_db_instance.${r.name} (engine: ${engine})`);
    }
  }

  // aws_rds_cluster: engine for aurora variants
  for (const r of byType.get('aws_rds_cluster') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine.includes('aurora-postgresql') || engine.startsWith('postgres')) {
      addEvidence(detected, 'postgresql', `aws_rds_cluster.${r.name} (engine: ${engine})`);
      const major = extractPgMajorVersion(getAttr(r, 'engine_version'));
      if (major) addEvidence(detected, `postgresql@${major}`, `aws_rds_cluster.${r.name} (engine_version: ${getAttr(r, 'engine_version')})`);
    } else if (engine.includes('aurora-mysql') || engine === 'mysql') {
      addEvidence(detected, 'mysql', `aws_rds_cluster.${r.name} (engine: ${engine})`);
    }
  }

  // google_sql_database_instance: database_version prefix
  for (const r of byType.get('google_sql_database_instance') ?? []) {
    const dbVersion = getAttr(r, 'database_version').toUpperCase();
    if (dbVersion.startsWith('POSTGRES_')) {
      addEvidence(detected, 'postgresql', `google_sql_database_instance.${r.name} (version: ${dbVersion})`);
      const major = extractPgMajorVersion(dbVersion);
      if (major) addEvidence(detected, `postgresql@${major}`, `google_sql_database_instance.${r.name} (database_version: ${dbVersion})`);
      // pgaudit via database_flags ([{name, value}] array)
      const rawFlags = r.instances[0]?.attributes?.['database_flags'];
      if (Array.isArray(rawFlags)) {
        const enabled = (rawFlags as Array<Record<string, string>>)
          .some((f) => typeof f['name'] === 'string' && f['name'].includes('pgaudit') && f['value'] === 'on');
        if (enabled) addEvidence(detected, 'postgresql+pgaudit', `google_sql_database_instance.${r.name} (database_flags: pgaudit enabled)`);
      } else {
        const s = attrStr(r, 'database_flags');
        if (s.includes('pgaudit')) addEvidence(detected, 'postgresql+pgaudit', `google_sql_database_instance.${r.name} (database_flags: pgaudit)`);
      }
    } else if (dbVersion.startsWith('MYSQL_')) {
      addEvidence(detected, 'mysql', `google_sql_database_instance.${r.name} (version: ${dbVersion})`);
    }
  }

  // hcloud_managed_database: type attribute ("pg" or "mysql")
  for (const r of byType.get('hcloud_managed_database') ?? []) {
    const dbType = getAttr(r, 'type').toLowerCase();
    if (dbType === 'pg' || dbType.startsWith('postgres')) {
      addEvidence(detected, 'postgresql', `hcloud_managed_database.${r.name} (type: ${dbType})`);
      const ver = getAttr(r, 'version');
      const major = extractPgMajorVersion(ver);
      if (major) addEvidence(detected, `postgresql@${major}`, `hcloud_managed_database.${r.name} (version: ${ver})`);
    } else if (dbType === 'mysql') {
      addEvidence(detected, 'mysql', `hcloud_managed_database.${r.name} (type: ${dbType})`);
    }
  }

  // azurerm_postgresql_flexible_server: version attribute (#1318)
  for (const r of byType.get('azurerm_postgresql_flexible_server') ?? []) {
    const ver = getAttr(r, 'version');
    const major = extractPgMajorVersion(ver);
    if (major) addEvidence(detected, `postgresql@${major}`, `azurerm_postgresql_flexible_server.${r.name} (version: ${ver})`);
  }

  // azurerm_postgresql_server: version attribute (#1318)
  for (const r of byType.get('azurerm_postgresql_server') ?? []) {
    const ver = getAttr(r, 'version');
    const major = extractPgMajorVersion(ver);
    if (major) addEvidence(detected, `postgresql@${major}`, `azurerm_postgresql_server.${r.name} (version: ${ver})`);
  }

  // pgaudit via AWS parameter group resources (#1318)
  for (const r of [
    ...(byType.get('aws_db_parameter_group') ?? []),
    ...(byType.get('aws_rds_cluster_parameter_group') ?? []),
  ]) {
    if (attrStr(r, 'parameter').includes('pgaudit')) {
      addEvidence(detected, 'postgresql+pgaudit', `${r.type}.${r.name} (parameter includes pgaudit)`);
    }
  }

  // pgaudit via Azure PostgreSQL Flexible Server configuration (#1318)
  for (const r of byType.get('azurerm_postgresql_flexible_server_configuration') ?? []) {
    if (attrStr(r, 'name').includes('pgaudit') || attrStr(r, 'value').includes('pgaudit')) {
      addEvidence(detected, 'postgresql+pgaudit', `azurerm_postgresql_flexible_server_configuration.${r.name} (pgaudit config)`);
    }
  }

  // aws_elasticache_cluster: engine attribute (redis vs memcached)
  for (const r of byType.get('aws_elasticache_cluster') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine === 'redis') {
      addEvidence(detected, 'redis', `aws_elasticache_cluster.${r.name} (engine: redis)`);
    }
    // memcached: no mapping
  }

  // aws_elasticache_serverless_cache: engine attribute
  for (const r of byType.get('aws_elasticache_serverless_cache') ?? []) {
    const engine = getAttr(r, 'engine').toLowerCase();
    if (engine === 'redis') {
      addEvidence(detected, 'redis', `aws_elasticache_serverless_cache.${r.name} (engine: redis)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cloud-native resource service detection (presence + attribute)
// ---------------------------------------------------------------------------

export function extractCloudNativeServices(byType: Map<string, TfResource[]>): Map<string, string[]> {
  const detected = new Map<string, string[]>();

  // Presence-based pass
  for (const [resourceType, serviceCodes] of RESOURCE_TYPE_TO_SERVICE_DEP) {
    const resources = byType.get(resourceType);
    if (!resources || resources.length === 0) continue;
    for (const r of resources) {
      for (const code of serviceCodes) {
        addEvidence(detected, code, `${resourceType}.${r.name}`);
      }
    }
  }

  // Attribute-based pass (engine/version/type guards)
  extractAttributeBasedServices(byType, detected);

  return detected;
}

// ---------------------------------------------------------------------------
// Merge helper -- combines any number of service maps (union with dedup)
// ---------------------------------------------------------------------------

export function mergeServiceMaps(
  ...maps: Map<string, string[]>[]
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const m of maps) {
    for (const [code, evidence] of m) {
      const existing = merged.get(code) ?? [];
      merged.set(code, [...existing, ...evidence]);
    }
  }
  return merged;
}
