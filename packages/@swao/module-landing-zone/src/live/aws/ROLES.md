# `aws` live driver: roles

Status: **seeded and live-checked** (#3574, 2026-11-03). The action list below
is every API action the driver calls; it was recorded in the live run on a
test organisation and every action returned HTTP 200 (CloudTrail
`LookupEvents` also returned throttling responses, which the driver retries).
The minimal policy is derived from that list and mapped to the narrowest
read-only policy (Design 120 section 6.3, Q-08).

**unverified: no identity with only these permissions (owner decision
2026-11-03).** No dedicated AWS identity is created for the check, so the
driver is live-verified on the operator login only (Q-21). SWAO sends read
queries only and never writes to the account.

**Release registration (#3831, owner decision 2026-11-04, Q-21).** The driver is registered in release builds (`liveVerified: true`, no `SWAO_LZ_UNVERIFIED_DRIVERS` needed) on the evidence of the live operator runs on the lab organisation (#3574; resource types confirmed live by #3801; live vs mock conformance diff 13 of 13 green, #3602, PR #1839). The minimal role set below stays unverified; release notes must say so.

## Identity used in the test organisation

| Identity | Purpose | Probe result |
|---|---|---|
| A read-only IAM Identity Center permission set in the management account (short-lived keys written to the vault by the SSO helper script) | Development, recording and the complete run | `verified` (live 2026-11-03): every simulated write action `implicitDeny`, all 13 simulated read actions `allowed` |

The probe simulates the write actions in `AWS_PROBE_WRITE_ACTIONS`
(`aws-driver.ts`) with `iam:SimulatePrincipalPolicy` against the role ARN from
`iam:GetRole` (the assumed-role ARN has no path; SSO roles live under
`/aws-reserved/sso.amazonaws.com/`). Any `allowed` decision refuses the
credential; a missing simulate permission makes the result `unverifiable`
(Q-27).

## API actions of the driver

Every Query API call is a signed GET; every JSON API call is a `POST /` whose
`X-Amz-Target` names a read operation. The structural read-only guarantee is
the HTTP allow-list (`live/http.ts`) plus the AWS action guard
(`aws-client.ts`), which refuses any operation that is not `Describe*`,
`List*`, `Get*`, `Lookup*` or `SimulatePrincipalPolicy` before it is sent.

| Driver method | Operation (API) | IAM action |
|---|---|---|
| `probeReadOnly` | `GetCallerIdentity` (STS) | none (always allowed) |
| `probeReadOnly` | `GetRole` (IAM) | `iam:GetRole` |
| `probeReadOnly` | `SimulatePrincipalPolicy` (IAM) | `iam:SimulatePrincipalPolicy` |
| `listRegions`, `listServices` | `DescribeRegions` (EC2, `AllRegions=true`) | `ec2:DescribeRegions` |
| `listRegions` | `DescribeAvailabilityZones` (EC2) | `ec2:DescribeAvailabilityZones` |
| `listServices`, `listResources` | `GetResources` (Resource Groups Tagging API) | `tag:GetResources` |
| `listGuardrails` | `DescribeOrganization`, `ListPolicies` (Organizations) | `organizations:DescribeOrganization`, `organizations:ListPolicies` |
| `listHierarchy` (#3882, mock only on 2026-11-05) | `GetCallerIdentity`, `DescribeOrganization`, `ListRoots`, `ListOrganizationalUnitsForParent`, `ListAccountsForParent`, `ListPoliciesForTarget` (Organizations, `NextToken` paging) | `organizations:ListRoots`, `organizations:ListOrganizationalUnitsForParent`, `organizations:ListAccountsForParent`, `organizations:ListPoliciesForTarget` |
| `listGuardrails` | `DescribeTrails`, `GetTrailStatus` (CloudTrail) | `cloudtrail:DescribeTrails`, `cloudtrail:GetTrailStatus` |
| `listGuardrails` | `DescribeConfigurationRecorderStatus` (Config) | `config:DescribeConfigurationRecorderStatus` |
| `listQuotas` | `ListServiceQuotas` (Service Quotas) | `servicequotas:ListServiceQuotas` |
| `listActivity` | `LookupEvents` (CloudTrail) | `cloudtrail:LookupEvents` |
| Pass 23 (`readAwsPass23State`) | `ListClusters`, `DescribeCluster` (EKS) | `eks:ListClusters`, `eks:DescribeCluster` |
| Pass 23 (`readAwsPass23State`), `listPosture` | `DescribeDBInstances` (RDS) | `rds:DescribeDBInstances` |
| `listServices` (#3866, SCP deny evaluation, D-16; not in the management account) | `GetCallerIdentity`, `DescribeOrganization`, `ListParents`, `ListPoliciesForTarget`, `DescribePolicy` (Organizations) | `organizations:ListParents`, `organizations:ListPoliciesForTarget`, `organizations:DescribePolicy` |
| `listPosture` (#3866, mock only on 2026-11-06) | `DescribeVolumes`, `DescribeAddresses`, `DescribeInstances`, `DescribeSecurityGroupRules` (EC2) | `ec2:DescribeVolumes`, `ec2:DescribeAddresses`, `ec2:DescribeInstances`, `ec2:DescribeSecurityGroupRules` |
| `listPosture` | `ListKeys`, `DescribeKey` (KMS) | `kms:ListKeys`, `kms:DescribeKey` |
| `listPosture` | `DescribeLoadBalancers`, `DescribeListeners`, `DescribeSSLPolicies` (ELBv2) | `elasticloadbalancing:Describe*` (three actions) |
| `listPosture` | `ListUsers`, `ListAccessKeys`, `ListMFADevices`, `ListAttachedUserPolicies`, `ListUserPolicies`, `ListGroupsForUser`, `ListAttachedGroupPolicies`, `ListGroupPolicies`, `GetAccountSummary` (IAM; never `GenerateCredentialReport`) | the same `iam:` actions |
| `listPosture` | `DescribeTrails`, `GetTrailStatus` (CloudTrail), `DescribeLogGroups` (CloudWatch Logs) | `logs:DescribeLogGroups` |
| `listPosture` | `ListBackupPlans` (`GET /backup/plans/`), `ListProtectedResources` (`GET /resources/`) (AWS Backup, REST-JSON) | `backup:ListBackupPlans`, `backup:ListProtectedResources` |
| `listPosture` (#3935, mock only on 2026-11-06) | `ListBuckets` (`GET /`, `max-buckets`), `GetBucketLocation`, `GetBucketEncryption`, `GetPublicAccessBlock`, `GetBucketPolicyStatus`, `GetBucketAcl`, `GetBucketLifecycleConfiguration` (S3, REST-XML, path-style `GET /{bucket}?<subresource>`, signed `x-amz-content-sha256`); `GetPublicAccessBlock` (S3 Control, `GET /v20180820/configuration/publicAccessBlock`, `x-amz-account-id`). The policy status and ACL are read only where Block Public Access leaves that path open; the lifecycle only of trail buckets | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetEncryptionConfiguration`, `s3:GetBucketPublicAccessBlock`, `s3:GetBucketPolicyStatus`, `s3:GetBucketAcl`, `s3:GetLifecycleConfiguration`, `s3:GetAccountPublicAccessBlock` (Service Authorization Reference, Amazon S3) |
| `listPosture` (#3952, mock only on 2026-11-06) | `ListTables`, `DescribeTable`, `DescribeContinuousBackups` (DynamoDB, JSON 1.0) | `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups` |
| `listPosture` (#3936, budgets) | `DescribeBudgets`, `DescribeNotificationsForBudget`, `DescribeSubscribersForNotification` (AWS Budgets, JSON, global endpoint; subscriber addresses are counted, never kept) | `budgets:ViewBudget` (one action for the three operations, AWS Cost Management user guide, `billing-permissions-ref`) |

The offering (`listServices`) is not read from an API: services and their
regions come from the botocore-derived catalogue `lz-catalogues/aws.json`
(065 section 4), so it needs no permission.

## Read-call coverage

Design 123 section 5.7 (D-13, #3886): every relevant read call of the
driver, the data product it feeds, and whether the driver uses it. `yes`
rows are exactly the calls the driver declares and makes against the mock
pack (pinned by `ops/mock-csp/contract/coverage.contract.ts`). `planned` rows are candidates from Design 123 sections 5.4 and 5.6, not yet verified: the named sprint issue checks the route or action against the API reference and adds it; `no` rows carry one of the reasons
of section 5.7. Every property a used call returns is kept: normalised
fields, else the `attributes` map after the privacy filter
(`live/privacy.ts` `filterAttributes`). The read-only allow-list is never
widened for coverage (Design 120 section 6.3).

Read calls are named by IAM action (`<prefix>:<Operation>`). Source of the
property sets: the recorded AWS mock pack (live operator run of 2026-11-03;
no live run in sprint 156, D-17: no SSO window on 2026-11-05 night). The
tagging API returns the ARN and the tags of a resource and nothing else, so
AWS resources carry no `attributes` until the per-service reads of #3866
land; the guardrail reads keep their normalised fields.

| Read call | Feeds | Used | Reason when not used |
|---|---|---|---|
| `sts:GetCallerIdentity` | probe | yes | - |
| `iam:GetRole` | probe | yes | - |
| `iam:SimulatePrincipalPolicy` | probe | yes | - |
| `ec2:DescribeRegions` | offering | yes | - |
| `ec2:DescribeAvailabilityZones` | offering | yes | - |
| `tag:GetResources` | estate | yes | - |
| `organizations:DescribeOrganization` | estate, hierarchy | yes | - |
| `organizations:ListPolicies` | estate, posture | yes | - |
| `cloudtrail:DescribeTrails` | estate, posture | yes | - |
| `cloudtrail:GetTrailStatus` | estate, posture | yes | - |
| `cloudtrail:LookupEvents` | estate | yes | - |
| `config:DescribeConfigurationRecorderStatus` | estate | yes | - |
| `servicequotas:ListServiceQuotas` | estate | yes | - |
| `eks:ListClusters` | pass23 | yes | - |
| `eks:DescribeCluster` | pass23 | yes | - |
| `rds:DescribeDBInstances` | pass23, posture | yes | - |
| `organizations:ListRoots` | hierarchy | yes | - |
| `organizations:ListOrganizationalUnitsForParent` | hierarchy | yes | - |
| `organizations:ListAccountsForParent` | hierarchy | yes | - |
| `organizations:ListPoliciesForTarget` | hierarchy, posture | yes | - |
| `organizations:ListParents` | offering | yes | - |
| `organizations:DescribePolicy` | offering | yes | - |
| `ec2:DescribeVolumes` | posture | yes | - |
| `ec2:DescribeAddresses` | posture | yes | - |
| `ec2:DescribeInstances` | posture | yes | - |
| `ec2:DescribeSecurityGroupRules` | posture | yes | - |
| `kms:ListKeys` | posture | yes | - |
| `kms:DescribeKey` | posture | yes | - |
| `elasticloadbalancing:DescribeLoadBalancers` | posture | yes | - |
| `elasticloadbalancing:DescribeListeners` | posture | yes | - |
| `elasticloadbalancing:DescribeSSLPolicies` | posture | yes | - |
| `iam:ListUsers` | posture | yes | - |
| `iam:ListAccessKeys` | posture | yes | - |
| `iam:ListMFADevices` | posture | yes | - |
| `iam:ListAttachedUserPolicies` | posture | yes | - |
| `iam:ListUserPolicies` | posture | yes | - |
| `iam:ListGroupsForUser` | posture | yes | - |
| `iam:ListAttachedGroupPolicies` | posture | yes | - |
| `iam:ListGroupPolicies` | posture | yes | - |
| `iam:GetAccountSummary` | posture | yes | - |
| `logs:DescribeLogGroups` | posture | yes | - |
| `backup:ListBackupPlans` | posture | yes | - |
| `backup:ListProtectedResources` | posture | yes | - |
| `s3:ListAllMyBuckets` | posture | yes | - |
| `s3:GetBucketLocation` | posture | yes | - |
| `s3:GetEncryptionConfiguration` | posture | yes | - |
| `s3:GetBucketPublicAccessBlock` | posture | yes | - |
| `s3:GetAccountPublicAccessBlock` | posture | yes | - |
| `s3:GetBucketPolicyStatus` | posture | yes | - |
| `s3:GetBucketAcl` | posture | yes | - |
| `s3:GetLifecycleConfiguration` | posture | yes | - |
| `dynamodb:ListTables` | posture | yes | - |
| `dynamodb:DescribeTable` | posture | yes | - |
| `dynamodb:DescribeContinuousBackups` | posture | yes | - |
| `budgets:ViewBudget` | posture | yes | - |
| `iam:GenerateCredentialReport` | posture | no | outside the read-only allow-list: not a read verb, refused by the AWS action guard (Design 120 section 7.1, #3574 finding 1) |

## Minimal policy (derived; unverified: no identity with only these permissions, owner decision 2026-11-03)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SwaoLzLiveRead",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:SimulatePrincipalPolicy",
        "ec2:DescribeRegions",
        "ec2:DescribeAvailabilityZones",
        "tag:GetResources",
        "organizations:DescribeOrganization",
        "organizations:ListPolicies",
        "organizations:ListRoots",
        "organizations:ListOrganizationalUnitsForParent",
        "organizations:ListAccountsForParent",
        "organizations:ListPoliciesForTarget",
        "cloudtrail:DescribeTrails",
        "cloudtrail:GetTrailStatus",
        "cloudtrail:LookupEvents",
        "config:DescribeConfigurationRecorderStatus",
        "servicequotas:ListServiceQuotas",
        "eks:ListClusters",
        "eks:DescribeCluster",
        "rds:DescribeDBInstances",
        "organizations:ListParents",
        "organizations:DescribePolicy",
        "ec2:DescribeVolumes",
        "ec2:DescribeAddresses",
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroupRules",
        "kms:ListKeys",
        "kms:DescribeKey",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeSSLPolicies",
        "iam:ListUsers",
        "iam:ListAccessKeys",
        "iam:ListMFADevices",
        "iam:ListAttachedUserPolicies",
        "iam:ListUserPolicies",
        "iam:ListGroupsForUser",
        "iam:ListAttachedGroupPolicies",
        "iam:ListGroupPolicies",
        "iam:GetAccountSummary",
        "logs:DescribeLogGroups",
        "backup:ListBackupPlans",
        "backup:ListProtectedResources",
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketAcl",
        "s3:GetLifecycleConfiguration",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "budgets:ViewBudget"
      ],
      "Resource": "*"
    }
  ]
}
```

`organizations:*` actions answer only in the management account (or a
delegated administrator); in a member account the guardrails source records
them as `not_collected`. Whether the AWS managed policies `ViewOnlyAccess` or
`ReadOnlyAccess` cover every action above has not been checked against the
policy documents; use the policy above until that is done.

## Log archive scope (#3975)

An organisation trail delivers to a bucket in the log archive account. From
the platform scope that bucket refuses every read (live 2026-11-07: 3 trails,
1 organisation trail, every trail bucket `GetBucketLifecycleConfiguration`
HTTP 403). Register the log archive account as an application scope with
`purpose: log-archive` (`swao lz connect ... --kind application --purpose
log-archive`); every other scope then reads the lifecycle of a trail bucket
it cannot read itself through that scope's login, joined by bucket name to
the archive's `ListBuckets`. The archive login passes its own read-only probe
and the same gate as any scope (Design 120 section 6.3).

| Read through the log archive scope | IAM action |
|---|---|
| `ListBuckets` | `s3:ListAllMyBuckets` |
| `GetBucketLocation` (only when `ListBuckets` gives no `BucketRegion`) | `s3:GetBucketLocation` |
| `GetBucketLifecycleConfiguration` | `s3:GetLifecycleConfiguration` |

The bucket policy of the log archive bucket decides, not only the role's
policy. Live 2026-11-07 (read-only, counts only): in the log archive account
the `AWSReadOnlyAccess` role alone was refused (`AccessDenied`,
bucket policy); the read-only IAM Identity Center permission set of the test organisation (section "Identity used in the test organisation") was admitted
(HTTP 200, 1 enabled rule, Expiration 90 days, NoncurrentVersionExpiration 90
days; `GetBucketLocation` answered too). Use a read-only role the bucket
policy admits; a refused read is reported in the CPB-LOG-02 detail
(`log_archive: http_403`), never as a failure of the platform scope.
