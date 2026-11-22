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

// #4056 (Design 123 section 5.4, the estate side of service_deny and
// service_allow_list on AWS): capability tags of the AWS resource types the
// live operator runs of 2026-11-07 list, whose owning service carries no
// `fulfills` in the bundled catalogue (lz-catalogues/aws.json: `logs`,
// `events`, `states`, `sso`, `controltower`, `servicecatalog` are empty) or
// is no offering code at all (`cloudwatch`, `codewhisperer`). Without these,
// 172 resources of the two stored live runs were unmapped and the estate
// check stayed unverified.
//
// Each record names its source: the ARN format proves the type (the
// generated Service Authorization Reference table, aws-arn-formats.ts), the
// tag follows the vocabulary another catalogue uses for the same kind of
// service (lz-catalogues/*.json `fulfills`). A type with no such precedent is
// left out and stays unmapped (ADR-0041).

export interface AwsResourceCapability {
  readonly tags: readonly string[];
  readonly source: string;
}

export const AWS_RESOURCE_CAPABILITIES: Readonly<Record<string, AwsResourceCapability>> = {
  'cloudwatch.alarm': {
    tags: ['monitoring'],
    source: 'CloudWatch alarm ARN (aws-arn-formats.ts:95); `monitoring` as OTC Cloud Eye (otc.json) and OCI Monitoring (oci.json)',
  },
  'logs.log-group': {
    tags: ['log_management'],
    source: 'CloudWatch Logs log-group ARN (aws-arn-formats.ts:225); `log_management` as STACKIT Logs (stackit.json)',
  },
  'sso.permissionset': {
    tags: ['identity_management'],
    source: 'IAM Identity Center PermissionSet ARN (aws-arn-formats.ts:355); `identity_management` as the AWS identitystore service (aws.json) and OTC IAM (otc.json)',
  },
  'states.statemachine': {
    tags: ['serverless_compute'],
    source: 'Step Functions stateMachine ARN (aws-arn-formats.ts:356); `serverless_compute` as GCP Workflows (gcp.json) and STACKIT Workflows (stackit.json)',
  },
  'events.rule': {
    tags: ['event_streaming'],
    source: 'EventBridge rule ARN (aws-arn-formats.ts:159); `event_streaming` as GCP Eventarc (gcp.json) and Delos Event Grid (delos.json), the majority of the event-routing services in the catalogues',
  },
  'controltower.enabledcontrol': {
    tags: ['compliance_monitoring'],
    source: 'Control Tower EnabledControl ARN (aws-arn-formats.ts:120), a governance control applied to an organisational unit (AWS Control Tower user guide, controls); `compliance_monitoring` as AWS Config (aws.json)',
  },
  'servicecatalog.stack': {
    tags: ['iac'],
    source: 'Service Catalog provisioned product, a CloudFormation stack (Service Catalog administrator guide, concepts); `iac` as AWS CloudFormation (aws.json)',
  },
  'codewhisperer.profile': {
    tags: ['managed_llm'],
    source: 'CodeWhisperer profile ARN (aws-arn-formats.ts:108), the Amazon Q Developer profile (Amazon Q Developer user guide, what is); `managed_llm` as Amazon Bedrock (aws.json)',
  },
};

/** The tag map of AWS_RESOURCE_CAPABILITIES, spread into LIVE_RESOURCE_CAPABILITY_MAPS.aws. */
export const AWS_RESOURCE_CAPABILITY_TAGS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(AWS_RESOURCE_CAPABILITIES).map(([type, r]) => [type, r.tags] as const),
);
