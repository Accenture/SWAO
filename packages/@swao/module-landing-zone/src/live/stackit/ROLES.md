# `stackit` live driver: roles

Status: **Reader accepted, minimal set unverified** (#3576, 2026-11-03). The
driver runs on a service account holding the built-in project role
**Reader**. Owner decision 2026-11-03: Reader is accepted with
`--accept-write-capable-credentials`; no custom read-only role is created. The
minimal set below is derived from the recorded actions of the live run and
stays **unverified: no identity with only these permissions (owner decision
2026-11-03)**, as for `otc` and `aws` (Design 120 section 6.3, Q-08, Q-21).

**Release registration (#3831, owner decision 2026-11-04, Q-21).** The driver is registered in release builds (`liveVerified: true`, no `SWAO_LZ_UNVERIFIED_DRIVERS` needed) on the evidence of the live Reader service account runs (#3576; `swao-mock-csp conform` green at route and scan level against the neutralised live Reader run of 2026-11-04, #3601, PR #1840). The minimal role set below stays unverified; release notes must say so.

## Read-only guarantee

SWAO never writes to the project, whatever the role allows. Every request
passes the driver's read allow-list in the HTTP layer (`live/http.ts`, #3571):
GET and HEAD only, plus exactly the Key Flow token POST (`^/oauth/v2/token$`),
which exchanges the signed assertion for an access token and creates nothing.
Pinned by `stackit/__tests__/stackit-driver.test.ts` (the read-only wrapper
refuses non-read calls; the POST rule matches only the token path; the scan
sends only the token POST and GETs) and `stackit-replay.test.ts` (the replayed
Reader run uses GET and the token POST only). On the live run of 2026-11-03
all 19 requests were GETs or the token POST.

## Reader is not strictly read-only

Live 2026-11-03 (recording `2026-11-03T18-11-13-275Z`): the service account's
own permissions on the project (`GET /v2/users/{email}/permissions`) list 378
permissions for Reader. Seven are not reads, by their published descriptions:

| Permission | Description (STACKIT) |
|---|---|
| `postgres-flex.backup.restore` | Can restore a postgres-flex from a backup. |
| `marketplace.inquiry.create` | Can create STACKIT Marketplace inquiries |
| `support.ticket.create` | Deprecated: Can create support tickets for a project. |
| `support.help-center.ticket.create` | Can create support tickets for a project. |
| `ske.cluster.kubeconfig.idp.create` | Can create IDP-based kubeconfigs for SKE clusters |
| `data-catalog.instance.use` | Can log in to and use a data catalog instance. |
| `lds.authentication.auth` | Can authenticate towards workspace |

So the probe reports Reader as `refused` (correct), and a run needs
`--accept-write-capable-credentials`, stamped into the scan. The driver uses
none of these permissions. Verbs classified as reads by their descriptions:
`get`, `list`, `read`, `view`, `describe`, `show`, `query`, and as seen live
`ping` ("echo the project_id"), `logs`, `metrics`, `check-enabled`, `overview`
and `<x>-list` (`stackit-probe.ts`).

## Identities used on the test project

| Identity | Purpose | Probe result |
|---|---|---|
| Service account without a role (2026-11-03, first run) | First live run | `unverifiable` (no permission, no membership; project APIs 403) |
| Same service account with the project role Reader | Development, recording and the complete run, with `--accept-write-capable-credentials` (owner decision 2026-11-03) | `refused` (membership `reader`, 7 non-read permissions) |

## Driver calls and the permissions they need (derived, unverified)

| Driver method | Call (route) | Spec | Needs | Live with Reader |
|---|---|---|---|---|
| all | `POST /oauth/v2/token` | docs.stackit.cloud, Key Flow | an active service account key | 200 |
| `probeReadOnly` | `GET /v2/users/{email}/permissions?resourceType=project&resource=` | authorization v2 | none: own e-mail | 200, 378 permissions |
| `probeReadOnly` | `GET /v2/users/{email}/memberships?resourceType=project&resourceId=` | authorization v2 | none: own e-mail | 200, role `reader` |
| `listRegions` | `GET /v2/regions/{region}/availability-zones` | iaas v2 | none observed (200 without a role too) | 200 |
| `listServices` | `GET /v2/projects/{project_id}/regions/{region}/services` | service-enablement v2 | a `service-enablement.*` read permission (403 without a role) | 200: eu01 34, eu02 16 |
| `listResources` | `GET /v2/projects/{project_id}/regions/{region}/{servers, volumes, networks, public-ips, security-groups}` | iaas v2 | `iaas.*` read permissions (403 without a role) | eu01 200; eu02 404 "resource not found: project" (no IaaS presence) |
| `listQuotas` | `GET /v2/projects/{project_id}/regions/{region}/quotas` | iaas v2 | an `iaas.*` read permission | eu01 200 (12 quotas); eu02 404 |
| `listServiceResources`, `listPosture` (#3970) | `GET /v2/project/{project_id}/regions/{region}/buckets`; `GET /v3/projects/{project_id}/regions/{region}/instances` and `.../instances/{instance_id}`; `GET /v2/projects/{project_id}/regions/{region}/instances?tag=` and `.../instances/{instance_id}`; `GET /v1/projects/{project_id}/regions/{region}/resourcePools`; `GET /v1/projects/{project_id}/distributions`; #3995: `GET /v3/projects/{project_id}/regions/{region}/instances` and `.../instances/{instance_id}` on mssql-flex-service (route key `/sqlserver-flex/v3/...`) | object-storage v2, postgres-flex v3, mongodb-flex v2, sfs v1, cdn v1, sqlserverflex v3 | `object-storage.bucket.list`, `postgres-flex.instance.list` and `.get`, `mongodb-flex.instance.list` and `.get`, `file-storage.resource-pool.list`, `cdn.distribution.list`, `sqlserver-flex.instance.list` and `.get` (`x-stackit-authorization` of the specifications; all in the Reader permission list) | see "Data service reads" below |
| `listGuardrails`, `listActivity` | none: no API identified yet (#3576 Q-3576-2) | - | - | not collected |

Which exact permission names gate each call is not published; the
`service-enablement.*` and `iaas.*` prefixes are those the Reader permission
list holds. A narrower custom role is not created (owner decision 2026-11-03).

## Read-call coverage

Design 123 section 5.7 (D-13, #3886): every relevant read call of the
driver, the data product it feeds, and whether the driver uses it. `yes`
rows are exactly the calls the driver declares and makes against the mock
pack (pinned by `ops/mock-csp/contract/coverage.contract.ts`). `planned` rows are candidates from Design 123 sections 5.4 and 5.6, not yet verified: the named sprint issue checks the route or action against the API reference and adds it; `no` rows carry one of the reasons
of section 5.7. Every property a used call returns is kept: normalised
fields, else the `attributes` map after the privacy filter
(`live/privacy.ts` `filterAttributes`). The read-only allow-list is never
widened for coverage (Design 120 section 6.3).

Source of the property sets: the live Reader runs of 2026-11-04 and
2026-11-05 (the test
project holds one security group: `id`, `name`, `description`, `labels`,
`rules`, `stateful`, `createdAt`, `updatedAt`) and, for the kinds without
data in the test project (servers, volumes, networks, public IPs), the iaas
v2 schemas of the STACKIT API specification subset of the mock pack
(`ops/mock-csp/providers/stackit/spec/stackit-spec-subset.json`, for example
`iaas.Volume.encrypted`, `iaas.Server.serviceAccountMails`).

| Read call | Feeds | Used | Reason when not used |
|---|---|---|---|
| `POST /oauth/v2/token` | auth | yes | - |
| `GET /v2/users/{email}/permissions` | probe | yes | - |
| `GET /v2/users/{email}/memberships` | probe | yes | - |
| `GET /v2/regions/{region}/availability-zones` | offering | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/services` | offering | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/servers` | estate, posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/volumes` | estate, posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/networks` | estate | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/public-ips` | estate, posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/security-groups` | estate, posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/quotas` | estate | yes | - |
| `GET /v2/projects` | hierarchy | yes | - |
| `GET /v2/folders` | hierarchy | yes | - |
| `GET /v2/folders/{container_id}` | hierarchy | yes | - |
| `GET /v2/organizations/{organization_id}` | hierarchy | yes | - |
| `GET /v2/projects/{id}` | hierarchy | no | duplicate, and its path is the Audit Log route `/v2/projects/{project_id}` (one route key for two APIs in the recorder and the mock pack): the member project list gives the same `parent`, and its `parents` chain was empty for a project under the organisation (live 2026-11-05, #3883) |
| `GET /v2/projects/{project_id}/regions/{region}/security-groups/{security_group_id}/rules` | posture | no | duplicate: the security group list returns the `rules` of every group (live 2026-11-05, #3867) |
| `GET /v2/projects/{project_id}/regions/{region}/load-balancers` | posture | yes | - |
| `GET /v1/projects/{project_id}/regions/{region}/keyrings` | posture | yes | - |
| `GET /v1/projects/{project_id}/regions/{region}/keyrings/{keyring_id}/keys` | posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/servers/{server_id}/backup-schedules` | posture | yes | - |
| `GET /v2/project/{project_id}/members` | posture | yes | - |
| `GET /v2/projects/{project_id}` | posture | yes | - |
| `GET /v2/project/{project_id}/regions/{region}/buckets` | estate, posture | yes | - |
| `GET /v3/projects/{project_id}/regions/{region}/instances` | estate, posture | yes | - |
| `GET /v3/projects/{project_id}/regions/{region}/instances/{instance_id}` | estate, posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/instances` | estate, posture | yes | - |
| `GET /v2/projects/{project_id}/regions/{region}/instances/{instance_id}` | estate, posture | yes | - |
| `GET /v1/projects/{project_id}/regions/{region}/resourcePools` | estate, posture | yes | - |
| `GET /v1/projects/{project_id}/distributions` | estate, posture | yes | - |
| `GET /sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances` | estate, posture | yes | - |
| `GET /sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances/{instance_id}` | estate, posture | yes | - |
| `GET /v2/project/{project_id}/regions/{region}/bucket/{bucket_name}` | posture | no | duplicate: the bucket list returns the same `Bucket` fields; neither has encryption or public access (those are S3 API settings that need S3 credentials, not the service account token) |

### Posture reads (#3867, live Reader run 2026-11-05)

| Driver method | Call | Answer with the Reader key | Note |
|---|---|---|---|
| `listPosture` | iaas volumes, public IPs, security groups, servers (the inventory lists, read once per scope run) | 200 in eu01, 404 in eu02 (no project presence) | `encrypted`, `encryptionParameters`, `networkInterface`, embedded `rules` |
| `listPosture` | `GET /v1/projects/{project_id}/regions/{region}/keyrings` (kms.api.stackit.cloud), then the keys of each ring | 200 in both regions, no key ring | key `protection` (software or hsm) enriches the volume entries |
| `listPosture` | `GET /v2/projects/{project_id}/regions/{region}/load-balancers` (load-balancer.api.stackit.cloud) | 200 in eu01 (none), 403 "Service not enabled" in eu02 | the network load balancer terminates no TLS (protocols TCP, UDP, TCP proxy, TLS passthrough), so in-transit encryption is not decidable |
| `listPosture` | `GET /v2/project/{project_id}/members` (authorization) | 200 | privileged members (roles that are not read-only) counted; MFA is not visible |
| `listPosture` | `GET /v2/projects/{project_id}` (auditlog.api.stackit.cloud, documented `start-time-range` and `end-time-range`) | 404, empty body | `audit_trail` and `log_retention` not_collected with HTTP 404; open question in #3867 |
| `listPosture` | `GET /v2/projects/{project_id}/regions/{region}/servers/{server_id}/backup-schedules` (server-backup.api.stackit.cloud) | not called: no server in the test project | 404 means the backup service is not enabled for the server (unprotected) |

### Data service reads (#3970, live Reader run 2026-11-06)

Object storage v2, PostgreSQL Flex v3, MongoDB Flex v2, SFS v1 and CDN v1
(hosts `object-storage.api`, `postgres-flex-service.api`,
`mongodb-flex-service.api`, `sfs.api`, `cdn.api` of `stackit.cloud`). One
read per list, region and scope run, shared by `listServiceResources`
(estate) and `listPosture`. Service Enablement of the test project: object
storage, PostgreSQL Flex and MongoDB Flex ENABLED in eu01 and eu02; SFS and
CDN ENABLED in eu01 and not listed in eu02.

| Driver method | Call | Answer with the Reader key | Note |
|---|---|---|---|
| both | bucket list, eu01 and eu02 | 404 `{"detail":[{"key":"project.not_found"}]}` | object storage was never enabled for the project in the region (`POST /v2/project/{projectId}/regions/{region}` creates it before any bucket): an empty answered region (`STACKIT_DATA_ABSENT_ANSWERS`) |
| both | PostgreSQL Flex v3 list (`page`, `size`), eu01 and eu02 | 200, no instance | an instance would be read with `GET .../instances/{instance_id}` (`encryption`, `backupSchedule`, `retentionDays`) |
| both | MongoDB Flex v2 list (`tag=`, required by the specification, sent empty as the STACKIT CLI does), eu01 and eu02 | 200, no instance | an instance would be read with `GET .../instances/{instance_id}` (`backupSchedule`; no encryption property) |
| both | SFS v1 resource pools | eu01 200, none; eu02 the connection is closed without an HTTP answer (with and without a token) | eu02 does not list SFS in Service Enablement: an empty answered region only with that pair |
| both | CDN v1 distributions (project-wide, `pageSize`, `pageIdentifier`) | 200, none | TLS floor from `config.tls.enableTls10` and `enableTls11` (documented default: TLS 1.2 and 1.3 only) |
| both | SQL Server Flex v3 list (`page`, `size`; host mssql-flex-service.api.stackit.cloud, route key `/sqlserver-flex/v3/...`, #3995), eu01 and eu02 | 200, no instance (live Reader run 2026-11-07) | an instance would be read with `GET .../instances/{instance_id}` (`encryption`, `backupSchedule`, `retentionDays`) |

### Hierarchy reads (#3883, live Reader run 2026-11-05)

Resource Manager v2 (`resource-manager.api.stackit.cloud`, global; API
reference `services/resource-manager/v0/resource-manager.json` of
stackit-api-specifications). Node ids are the UUIDs (`projectId`,
`folderId`, `organizationId`, `parent.id`).

| Driver method | Call | Answer with the Reader key | Note |
|---|---|---|---|
| `listHierarchy` | `GET /v2/projects?member=<service account>` (with `limit`, `offset`) | 200, one project | `parent` is the organisation (`type` ORGANIZATION); `containerId` and `labels` are not kept |
| `listHierarchy` | `GET /v2/organizations/{organization_id}` (container id of the parent) | 403 "You are not allowed to perform this action." | the organisation is an `unknown` node; the tree is partial |
| `listHierarchy` | `GET /v2/folders?containerParentId=` and `GET /v2/projects?containerParentId=` (platform scope, the tree below the organisation) | 403 on the organisation | `hierarchy:children` not_collected |
| `listHierarchy` | `GET /v2/folders/{container_id}?includeParents=true` (a parent folder and its folder chain) | not called: the test project hangs directly under the organisation | nested folders answered by the mock pack (`multi-scope`, `app-partial`) |

## Setting up the identity

1. In the STACKIT portal, project, IAM: add the service account as a member
   with the **Reader** role (not Editor or Owner).
2. Create a key ("Create new key pair") and store the key JSON in the SWAO
   vault: `Get-Clipboard -Raw | node scripts/lz-credentials-to-vault.mjs --csp
   stackit --key-stdin` (#3677). The vault is the only copy.
3. Run `swao lz probe stackit-test`: Reader shows `refused` with the 7
   permissions above; the scan then needs `--accept-write-capable-credentials`.
