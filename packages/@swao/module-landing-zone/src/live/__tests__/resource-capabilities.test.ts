// #3931: capability tags of deployed resources by live resource type
// (estate side of service_deny / service_allow_list, Design 123 section 5.4).
import { describe, it, expect } from 'vitest';
import { LIVE_RESOURCE_CAPABILITY_MAPS, LIVE_SERVICE_INVENTORY_TYPES, liveResourceCapabilityTags } from '../resource-capabilities.js';
import { OTC_SERVICES } from '../otc/otc-services.js';
import { STACKIT_DATA_KINDS, STACKIT_IAAS_KINDS } from '../stackit/stackit-driver.js';
import { AZURE_ARM_ALIASES } from '../azure/azure-driver.js';
import { AWS_RESOURCE_CAPABILITIES } from '../aws/aws-resource-capabilities.js';
import { discoverLzCatalogues, loadLzCatalogue, resolveLzCataloguesDir } from '../../catalogue/loader.js';

/** The RMS resource types of the live operator run on the OTC test tenant, 2026-11-05 (#3886). */
const OTC_LIVE_TYPES = [
  'apig.instances', 'cce.clusters', 'cce.nodes', 'ecs.cloudservers', 'elb.listeners', 'elb.loadbalancers', 'evs.volumes', 'fgs.functions',
  'iam.agencies', 'iam.groups', 'iam.users', 'kms.keys', 'obs.buckets', 'vpc.bandwidths', 'vpc.publicips', 'vpc.securityGroups', 'vpc.vpcs',
];

describe('liveResourceCapabilityTags (#3931)', () => {
  it('maps every RMS type of the live OTC run, and each tag is a tag of the owning OTC service', () => {
    for (const t of OTC_LIVE_TYPES) {
      const tags = liveResourceCapabilityTags('otc', t);
      expect(tags, t).toBeDefined();
      const service = OTC_SERVICES.find((s) => s.code === t.split('.')[0]);
      for (const tag of tags ?? []) expect(service?.tags, `${t} ${tag}`).toContain(tag);
    }
  });

  it('maps every STACKIT iaas kind the driver lists', () => {
    for (const k of STACKIT_IAAS_KINDS) expect(liveResourceCapabilityTags('stackit', k.type), k.type).toBeDefined();
    expect(liveResourceCapabilityTags('stackit', 'iaas.server')).toEqual(['vm_compute']);
    // #3871 posture: the load balancer types of the posture collector.
    expect(liveResourceCapabilityTags('stackit', 'load-balancer.load-balancer')).toEqual(['load_balancer']);
  });

  it('maps AWS and Azure types only where the type names one capability', () => {
    expect(liveResourceCapabilityTags('aws', 's3.bucket')).toEqual(['object_storage']);
    expect(liveResourceCapabilityTags('aws', 'lambda.function')).toEqual(['serverless_compute']);
    // #3871 posture: the ELBv2 types of the posture collectors (parseArn) are load balancers; rds.db stays unmapped (engine).
    for (const t of ['elasticloadbalancing.alb', 'elasticloadbalancing.nlb', 'elasticloadbalancing.listener/app']) expect(liveResourceCapabilityTags('aws', t), t).toEqual(['load_balancer']);
    expect(liveResourceCapabilityTags('aws', 'rds.db')).toBeUndefined();
    expect(liveResourceCapabilityTags('azure', 'microsoft.compute/virtualmachines')).toEqual(['vm_compute']);
    // #3868: the network types of the posture scenario map like the OTC and STACKIT network kinds.
    expect(liveResourceCapabilityTags('azure', 'microsoft.network/publicipaddresses')).toEqual(['vpc_networking', 'networking']);
    expect(liveResourceCapabilityTags('azure', 'microsoft.network/networksecuritygroups')).toEqual(['vpc_networking', 'networking']);
    const networkOnly = new Set(['microsoft.network/virtualnetworks', 'microsoft.network/publicipaddresses', 'microsoft.network/networksecuritygroups']);
    for (const t of Object.keys(LIVE_RESOURCE_CAPABILITY_MAPS['azure'] ?? {})) {
      if (!networkOnly.has(t)) expect(Object.keys(AZURE_ARM_ALIASES), t).toContain(t);
    }
  });

  it('#3935 lane G2: maps the Azure posture types that name one capability (storage account, SQL server, Redis)', () => {
    expect(liveResourceCapabilityTags('azure', 'microsoft.storage/storageaccounts')).toEqual(['object_storage']);
    expect(liveResourceCapabilityTags('azure', 'microsoft.sql/servers')).toEqual(['sql_server']);
    expect(liveResourceCapabilityTags('azure', 'microsoft.cache/redis')).toEqual(['redis']);
    // a storage account is never pulled into file_storage (backup_configured has no collector for it)
    expect(liveResourceCapabilityTags('azure', 'microsoft.storage/storageaccounts')).not.toContain('file_storage');
  });

  it('leaves ambiguous and unknown types unmapped (never guessed, ADR-0041)', () => {
    // an OTC RDS instance is PostgreSQL, MySQL or SQL Server; the type does not say which
    expect(liveResourceCapabilityTags('otc', 'rds.instances')).toBeUndefined();
    // management resources have no capability
    expect(liveResourceCapabilityTags('aws', 'cloudformation.stack')).toBeUndefined();
    expect(liveResourceCapabilityTags('otc', 'unknown.type')).toBeUndefined();
    expect(liveResourceCapabilityTags('gcp', 'compute.instance')).toBeUndefined();
    expect(liveResourceCapabilityTags('otc', 'constructor')).toBeUndefined();
    expect(liveResourceCapabilityTags('otc', '__proto__')).toBeUndefined();
  });

  it('#3871: the service inventory types are exactly the STACKIT data kinds of the driver, each mapped', () => {
    expect([...(LIVE_SERVICE_INVENTORY_TYPES['stackit'] ?? [])].sort()).toEqual(STACKIT_DATA_KINDS.map((k) => k.type).sort());
    for (const t of LIVE_SERVICE_INVENTORY_TYPES['stackit'] ?? []) expect(liveResourceCapabilityTags('stackit', t), t).toBeDefined();
  });

  it('every mapped type has at least one tag', () => {
    for (const [p, m] of Object.entries(LIVE_RESOURCE_CAPABILITY_MAPS)) for (const [t, tags] of Object.entries(m)) expect(tags.length, `${p} ${t}`).toBeGreaterThan(0);
  });
});

/**
 * #4056: the 25 resource types of the two stored AWS live operator runs
 * (2026-11-07T05-13-04 and 2026-11-07T17-01-33, 678 resources each). The
 * service code of a type is its prefix (parseArn, aws-arn.ts).
 */
const AWS_LIVE_TYPES = [
  'cloudformation.stack', 'cloudformation.stackset', 'cloudtrail.eventdatastore', 'cloudwatch.alarm', 'codebuild.project',
  'codepipeline.pipeline', 'codewhisperer.profile', 'config.configrule', 'controltower.enabledcontrol', 'dynamodb.table',
  'events.rule', 'kms.key', 'lambda.eventsourcemapping', 'lambda.function', 'logs.log-group', 's3.bucket',
  'secretsmanager.secret', 'servicecatalog.stack', 'sns.topic', 'sqs.queue', 'ssm.document', 'ssm.parameter', 'ssm.session',
  'sso.permissionset', 'states.statemachine',
];

describe('AWS resource-type capability map (#4056)', () => {
  const dir = resolveLzCataloguesDir();
  const aws = dir ? loadLzCatalogue(dir, 'aws') : null;
  /** `fulfills` of an AWS catalogue service by code, the offering-side join of lz-baseline-eval.ts joinResources. */
  const serviceTags = (code: string): readonly string[] => {
    for (const r of aws?.regions ?? []) for (const svc of r.services) if (svc.code === code && svc.fulfills.length > 0) return svc.fulfills;
    return [];
  };

  it('every live type resolves as the evaluator joins it: type map first, then the service fulfills', () => {
    expect(aws).not.toBeNull();
    const unresolved = AWS_LIVE_TYPES.filter((t) => {
      const tags = liveResourceCapabilityTags('aws', t) ?? serviceTags(t.split('.')[0] ?? '');
      return tags.length === 0;
    });
    expect(unresolved).toEqual([]);
  });

  it('maps the eight types whose service has no catalogue tags, and only those need a record', () => {
    expect(Object.keys(AWS_RESOURCE_CAPABILITIES).sort()).toEqual([
      'cloudwatch.alarm', 'codewhisperer.profile', 'controltower.enabledcontrol', 'events.rule',
      'logs.log-group', 'servicecatalog.stack', 'sso.permissionset', 'states.statemachine',
    ]);
    for (const t of Object.keys(AWS_RESOURCE_CAPABILITIES)) {
      expect(serviceTags(t.split('.')[0] ?? ''), t).toEqual([]);
      expect(liveResourceCapabilityTags('aws', t), t).toEqual(AWS_RESOURCE_CAPABILITIES[t]?.tags);
    }
    // the Amazon Q Developer profile is the one managed AI resource (CPB-SVC-01)
    expect(liveResourceCapabilityTags('aws', 'codewhisperer.profile')).toEqual(['managed_llm']);
  });

  it('every record names a source and uses only tags of the shared fulfills vocabulary', () => {
    const vocabulary = new Set<string>();
    for (const entry of discoverLzCatalogues(dir ?? '')) {
      const cat = loadLzCatalogue(dir ?? '', entry.provider);
      for (const r of cat.regions) for (const svc of r.services) for (const t of svc.fulfills) vocabulary.add(t);
    }
    for (const [t, r] of Object.entries(AWS_RESOURCE_CAPABILITIES)) {
      expect(r.source.length, t).toBeGreaterThan(20);
      expect(r.tags.length, t).toBeGreaterThan(0);
      for (const tag of r.tags) expect(vocabulary.has(tag), `${t} ${tag}`).toBe(true);
    }
  });
});
