// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { AWS_RESOURCE_CAPABILITY_TAGS } from './aws/aws-resource-capabilities.js';

// #3931 (Design 123 section 5.4, the estate side of service_deny and
// service_allow_list): the capability tags of a deployed resource, from its
// live resource type (`estate.resources[].type`). Tags are the ones the
// drivers' offering uses for the owning service (OTC otc-services.ts, STACKIT
// fetch-stackit.ts STACKIT_SERVICE_FULFILLS, the AWS and Azure catalogue
// `fulfills`), so a resource and its service speak the same vocabulary.
//
// Only unambiguous types are mapped. A type whose capability depends on a
// property the type does not carry (an OTC `rds.instances` can be PostgreSQL,
// MySQL or SQL Server) is left out, so the caller reports it as unmapped and never guesses
// (ADR-0041). Sources:
// - otc: the 17 RMS resource types of the live operator run of 2026-11-05,
//   plus the types of the RMS provider directory served by the mock pack;
// - stackit: the five iaas kinds of the driver (STACKIT_IAAS_KINDS), live
//   Reader run of 2026-11-05 (one security group), and the data service
//   types of #3970 (STACKIT_DATA_KINDS);
// - aws: the types the driver derives from the ARNs of the recorded mock pack
//   (tagging API, operator run of 2026-11-03), plus the EC2, EKS and ECR types
//   of the Service Authorization Reference ARN formats, plus (#4056) the
//   types of the live operator runs of 2026-11-07 whose service has no
//   catalogue tags, with a source per type (aws/aws-resource-capabilities.ts);
// - azure: the Resource Graph types of the spec-derived mock pack.

export const LIVE_RESOURCE_CAPABILITY_MAPS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  otc: {
    'apig.instances': ['api_gateway'],
    // #3954: APIs of a dedicated gateway (in-transit posture items).
    'apig.apis': ['api_gateway'],
    'cce.clusters': ['kubernetes'],
    'cce.nodes': ['kubernetes'],
    'dcs.instances': ['redis'],
    'dns.publicZones': ['dns'],
    'ecs.cloudservers': ['vm_compute'],
    'elb.listeners': ['load_balancer'],
    'elb.loadbalancers': ['load_balancer'],
    'evs.volumes': ['block_storage'],
    'fgs.functions': ['serverless_compute'],
    'iam.agencies': ['identity_management'],
    'iam.groups': ['identity_management'],
    'iam.users': ['identity_management'],
    'kms.keys': ['key_vault'],
    'obs.buckets': ['object_storage'],
    'vpc.bandwidths': ['vpc_networking', 'networking'],
    'vpc.publicips': ['vpc_networking', 'networking'],
    'vpc.securityGroups': ['vpc_networking', 'networking'],
    'vpc.vpcs': ['vpc_networking', 'networking'],
  },
  stackit: {
    'iaas.server': ['vm_compute'],
    'iaas.volume': ['block_storage'],
    'iaas.network': ['networking'],
    'iaas.public-ip': ['networking'],
    'iaas.security-group': ['networking'],
    // #3871 posture: the load balancer API types of the posture collector (stackit-posture.ts).
    'load-balancer.load-balancer': ['load_balancer'],
    'load-balancer.listener': ['load_balancer'],
    // #3970: the data service types of the driver (STACKIT_DATA_KINDS), tags of fetch-stackit.ts
    // STACKIT_SERVICE_FULFILLS (Object Storage, PostgreSQL Flex, MongoDB Flex, File Storage, CDN).
    'object-storage.bucket': ['object_storage'],
    'postgres-flex.instance': ['postgresql'],
    // #3995: SQL Server Flex v3 instances run the SQL Server engine only.
    'sqlserver-flex.instance': ['sql_server'],
    'mongodb-flex.instance': ['nosql_database'],
    'sfs.resource-pool': ['file_storage'],
    'cdn.distribution': ['cdn'],
  },
  aws: {
    'dynamodb.table': ['nosql_database'],
    'ec2.instance': ['vm_compute'],
    'ec2.volume': ['block_storage'],
    'ec2.vpc': ['vpc_networking', 'networking'],
    'ec2.subnet': ['vpc_networking', 'networking'],
    'ec2.security-group': ['vpc_networking', 'networking'],
    'ecr.repository': ['container_registry'],
    'eks.cluster': ['kubernetes'],
    // #3871 posture: the ELBv2 load balancer and listener types of the posture
    // collectors (parseArn of the ARN, aws-posture.ts), so applies_to and
    // allow_capabilities see a load balancer.
    'elasticloadbalancing.alb': ['load_balancer'],
    'elasticloadbalancing.nlb': ['load_balancer'],
    'elasticloadbalancing.loadbalancer': ['load_balancer'],
    'elasticloadbalancing.listener/app': ['load_balancer'],
    'elasticloadbalancing.listener/net': ['load_balancer'],
    'kms.key': ['key_vault'],
    'lambda.function': ['serverless_compute'],
    's3.bucket': ['object_storage'],
    'secretsmanager.secret': ['secrets_management'],
    'sns.topic': ['messaging'],
    'sqs.queue': ['queue'],
    // #4056: the live types without catalogue tags (sources in aws/aws-resource-capabilities.ts).
    ...AWS_RESOURCE_CAPABILITY_TAGS,
  },
  azure: {
    'microsoft.compute/disks': ['block_storage'],
    'microsoft.compute/virtualmachines': ['vm_compute'],
    // #3935 lane G2 (Design 123 section 5.4, Azure): the posture types the Azure collector
    // reads (azure-posture.ts AZ_TYPES), each naming one capability:
    // - Azure Cache for Redis is Redis only: the catalogue service `Azure Cache for Redis`
    //   fulfils ['redis'] (lz-catalogues/azure.json), as OTC `dcs.instances` above;
    // - an Azure SQL logical server hosts SQL Server engine databases only: `sql_server`
    //   is the vocabulary tag of that engine (STACKIT `SQLServer Flex`, fetch-stackit.ts;
    //   OTC RDS; the frameworks' service-controls.yaml). AZURE_TAG_CORRECTIONS in
    //   azure-driver.ts keeps the catalogue side empty; the resource side needs no correction;
    // - a storage account is the `Storage` service of the catalogue (AZURE_ARM_ALIASES),
    //   which fulfils ['object_storage'], and the collector reads its blob public access
    //   (`allowBlobPublicAccess`). A FileStorage-kind account (file shares only) is not
    //   told apart by the type; `file_storage` is not added, so a storage account is never
    //   pulled into backup_configured without a collector behind it.
    'microsoft.cache/redis': ['redis'],
    'microsoft.sql/servers': ['sql_server'],
    'microsoft.storage/storageaccounts': ['object_storage'],
    'microsoft.containerservice/managedclusters': ['kubernetes'],
    'microsoft.dbforpostgresql/flexibleservers': ['postgresql'],
    'microsoft.keyvault/vaults': ['key_vault'],
    'microsoft.network/virtualnetworks': ['vpc_networking', 'networking'],
    // #3868: the network types of the posture scenario (public IPs, NSGs), as the OTC and STACKIT network kinds.
    'microsoft.network/networksecuritygroups': ['vpc_networking', 'networking'],
    'microsoft.network/publicipaddresses': ['vpc_networking', 'networking'],
  },
};

/** Scan source of the optional service inventory (`listServiceResources`, live/scan.ts, #3970). */
export const LIVE_SERVICE_INVENTORY_SOURCE = 'inventory:service-resources';

/**
 * #3871 (stored scans re-evaluated): resource types a driver lists only
 * through its optional service inventory (STACKIT STACKIT_DATA_KINDS, #3970).
 * A scan read them only when it holds the source LIVE_SERVICE_INVENTORY_SOURCE
 * with status ok; a scan written by a driver without that inventory (STACKIT
 * before #3970) never read them, so their capabilities count as not read.
 */
export const LIVE_SERVICE_INVENTORY_TYPES: Readonly<Record<string, readonly string[]>> = {
  stackit: ['object-storage.bucket', 'postgres-flex.instance', 'sqlserver-flex.instance', 'mongodb-flex.instance', 'sfs.resource-pool', 'cdn.distribution'],
};

/**
 * #3970: resource types whose read-only API carries no labels or tags, so an
 * absent tag map is "not readable", not "no tags" (required_tags). STACKIT
 * object storage v2 `Bucket` and MongoDB Flex v2 `Instance` have no labels
 * property (stackit-api-specifications at the pinned commit).
 */
export const LIVE_RESOURCE_TYPES_WITHOUT_TAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  stackit: new Set(['object-storage.bucket', 'mongodb-flex.instance']),
};

/**
 * Capability tags of a deployed resource of `provider` by its live resource
 * type; `undefined` when the type is not mapped (the caller treats the
 * resource as unmapped, never as compliant or forbidden).
 */
export function liveResourceCapabilityTags(provider: string, resourceType: string): readonly string[] | undefined {
  const byType = LIVE_RESOURCE_CAPABILITY_MAPS[provider];
  if (byType === undefined || !Object.prototype.hasOwnProperty.call(byType, resourceType)) return undefined;
  return byType[resourceType];
}
