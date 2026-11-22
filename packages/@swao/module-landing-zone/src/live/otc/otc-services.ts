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

// #3572: OTC native code -> catalogue code table (Design 120 section 7.3).
//
// - `code` is the Config / RMS provider name (the native code the inventory
//   reports in `provider`), observed in the partner hackathon recording of
//   2026-10-28 (Design 120 section 3).
// - `catalogueCode` is `LzServiceSchema.code` in `swao/lz-catalogues/otc.json`.
// - `tags` are the catalogue `fulfills` of that entry (Design 095 section 6.3,
//   D-095-02). They are not mapped anew: `otc-services.test.ts` pins them to
//   otc.json, so the two cannot drift apart.
// - `catalogTypes` are the IAM token catalogue `type` values of the service,
//   observed in the same recording (99 types in eu-de).
// - `priceKeys` are the product keys of the public price API that belong to
//   the service, observed in the same recording (102 keys).

export interface OtcServiceEntry {
  code: string;
  catalogueCode: string;
  tags: readonly string[];
  catalogTypes: readonly string[];
  priceKeys: readonly string[];
}

const e = (code: string, catalogueCode: string, tags: string[], catalogTypes: string[], priceKeys: string[] = []): OtcServiceEntry =>
  ({ code, catalogueCode, tags, catalogTypes, priceKeys });

export const OTC_SERVICES: readonly OtcServiceEntry[] = [
  e('ecs', 'Elastic Cloud Server', ['vm_compute'], ['compute', 'ecs'], ['ecs', 'ecsflex', 'ecsnoc', 'gpu']),
  e('bms', 'Bare Metal Server', ['vm_compute'], ['bms'], ['bms']),
  e('deh', 'Dedicated Host', ['vm_compute'], ['deh'], ['deh', 'dehl']),
  e('as', 'Auto Scaling', ['vm_compute'], ['as', 'asv1']),
  e('ims', 'Image Management Service', [], ['image']),
  e('cce', 'Cloud Container Engine', ['kubernetes'], ['cce', 'ccev2.0'], ['cce']),
  e('cci', 'Cloud Container Instance', ['container_orchestration'], [], ['cci']),
  e('swr', 'Software Repository for Container', ['container_registry'], ['swr', 'swrv2']),
  e('fgs', 'FunctionGraph', ['serverless_compute'], ['functiongraph'], ['fug']),
  e('asm', 'Application Service Mesh', [], ['asm', 'asmv1']),
  e('obs', 'Object Storage Service', ['object_storage'], ['object'], ['obs']),
  e('evs', 'Elastic Volume Service', ['block_storage'], ['volume', 'volumev2', 'volumev3', 'evs'], ['evs']),
  e('sfs', 'Scalable File Service', ['file_storage'], ['share', 'sharev2', 'sfs3', 'sfsturbo'], ['sfs']),
  e('cbr', 'Cloud Backup and Recovery', ['backup'], ['cbr'], ['cbr']),
  e('csbs', 'Cloud Server Backup Service', ['backup'], ['data-protect'], ['csbs']),
  e('vbs', 'Volume Backup Service', ['backup'], ['vbs', 'vbsv2'], ['vbs']),
  e('sdrs', 'Storage Disaster Recovery Service', ['backup'], ['sdrs'], ['sdrs']),
  e('rds', 'Relational Database Service', ['postgresql', 'mysql', 'sql_server'], ['rds', 'rdsv1', 'rdsv3', 'database'], ['rds', 'rdss']),
  e('gaussdb', 'TaurusDB', ['mysql'], ['gaussdb-mysql'], ['gaussdbformysql']),
  e('nosql', 'GeminiDB', ['nosql_database'], ['geminidb'], ['gaussdbforcassandra']),
  e('dcs', 'Distributed Cache Service', ['redis'], ['dcs', 'dcsv1'], ['dcs', 'dcsb']),
  e('dds', 'Document Database Service', ['nosql_database'], ['ddsv3'], ['dds']),
  e('dws', 'Data Warehouse Service', ['data_warehouse'], ['dws', 'dwsv1'], ['dws']),
  e('ddm', 'Distributed Database Middleware', ['postgresql', 'mysql'], ['ddmv1', 'ddmv2', 'ddmv3'], ['ddm']),
  e('drs', 'Data Replication Service', ['data_integration'], ['drs'], ['drs']),
  e('vpc', 'Virtual Private Cloud', ['vpc_networking', 'networking'], ['network', 'vpc', 'vpc2.0'], ['eip']),
  e('elb', 'Elastic Load Balancing', ['load_balancer'], ['elb', 'elbv1', 'elbv3'], ['elb']),
  e('nat', 'NAT Gateway', [], ['nat', 'natv3'], ['nat']),
  e('dcaas', 'Direct Connect', ['dedicated_connectivity'], ['dcaas'], ['dc']),
  e('er', 'Enterprise Router', ['vpc_networking', 'networking'], ['erv3'], ['er']),
  e('vpnaas', 'VPN Gateway', ['vpn'], ['evpn'], ['vpn', 'evpn']),
  e('dns', 'Domain Name Service', ['dns'], ['dns'], ['phz', 'prhz']),
  e('vpcep', 'VPC Endpoint', [], ['vpcep'], ['vpcep']),
  e('plas', 'Private Link Access Service', [], [], ['plas']),
  e('antiddos', 'Anti-DDoS', [], ['antiddos', 'Anti-DDoS']),
  e('waf', 'Web Application Firewall', ['waf'], ['waf'], ['waf']),
  e('wafd', 'Web Application Firewall Dedicated', ['waf'], ['premium-waf'], ['wafd']),
  e('hss', 'Host Security Service', ['threat_detection'], ['hss'], ['hss']),
  e('kms', 'Key Management Service', ['key_vault', 'secrets_management'], ['kms', 'kmsv1'], ['kms']),
  e('iam', 'Identity and Access Management', ['identity_management'], ['identity']),
  e('dms', 'Distributed Message Service', ['queue', 'messaging', 'kafka'], ['dms', 'dmsv1', 'dmsv2'], ['dms', 'dmsk', 'dmsrmq']),
  e('smn', 'Simple Message Notification', ['messaging'], ['smn', 'smnv2'], ['smn']),
  e('apig', 'API Gateway', ['api_gateway'], ['apigv2'], ['apig']),
  e('ces', 'Cloud Eye', ['monitoring'], ['ces', 'cesv1']),
  e('cts', 'Cloud Trace Service', ['audit_logging'], ['cts', 'ctsv2', 'ctsv3']),
  e('lts', 'Log Tank Service', ['audit_logging', 'monitoring'], ['ltsv2'], ['lts']),
  e('aom', 'Application Operations Management', ['monitoring'], ['aomv1', 'aomv2'], ['aom']),
  e('config', 'Config', ['compliance_monitoring'], ['rms']),
  e('rfs', 'Resource Template Service', [], ['rfs']),
  e('tms', 'Tag Management Service', [], ['tms']),
  e('dli', 'Data Lake Insight', ['data_analytics'], ['dli'], ['dli']),
  e('dayu', 'DataArts Studio', ['data_integration'], ['dataarts'], ['da']),
  e('mrs', 'MapReduce Service', ['big_data'], ['mrs', 'mrsv1'], ['mrs']),
  e('css', 'Cloud Search Service', ['search'], ['css'], ['css', 'csscln']),
  e('modelarts', 'ModelArts', ['ml_training', 'ml_inference'], ['modelartsv1', 'modelartsv2'], ['modelarts']),
  e('ocr', 'Optical Character Recognition', [], ['ocr'], ['ocr']),
];

const BY_CODE = new Map(OTC_SERVICES.map((s) => [s.code, s]));

export function otcServiceByCode(code: string): OtcServiceEntry | undefined {
  return BY_CODE.get(code);
}

/** Country per OTC region (Design 095 section 6; the regions-and-endpoints source). */
export const OTC_REGION_COUNTRY: Readonly<Record<string, string>> = { 'eu-de': 'DE', 'eu-nl': 'NL' };

/** Regions a platform scope reads when `.swao.yml` names none (Design 095 section 6.2). */
export const OTC_DEFAULT_REGIONS: readonly string[] = ['eu-de', 'eu-nl'];
