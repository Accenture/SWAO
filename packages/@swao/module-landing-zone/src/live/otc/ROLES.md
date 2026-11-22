# `otc` live driver: roles

Status: **mapped, unverified** (#3573, 2026-11-03). Every API action of the
complete operator run is mapped below to the narrowest read-only role or
policy named in the published OTC documentation. The mapping is **unverified:
no identity with only these roles available (owner decision 2026-11-03)**, so
it has not been proven by a run with an identity that holds only these roles
(Design 120 section 6.3, Q-08). Treat it as the starting point for a client
role set, not as a tested minimum.

**Release registration (#3831, owner decision 2026-11-04, Q-21).** The driver is registered in release builds (`liveVerified: true`, no `SWAO_LZ_UNVERIFIED_DRIVERS` needed) on the evidence of the live operator runs on the test tenant (#3572, #3573: complete run, repeated run and replay of the neutralised recording reproduce the live scan). The minimal role set below stays unverified; release notes must say so.

## Read-only guarantee

SWAO never writes to the tenant, whatever the login allows. Every request
passes the driver's read allow-list in the HTTP layer (`live/http.ts`, #3571):
GET and HEAD only, plus the IAM token POST, which issues a token and creates
nothing. Pinned by `live/__tests__/live.test.ts:114`,
`otc/__tests__/otc-driver.test.ts:136,462` and
`otc/__tests__/otc-replay.test.ts` (the replayed operator run sends only the
token POST and GETs). On the operator run of 2026-11-03 all 37 recorded
requests were GETs or the token POST.

## AK/SK (`aksk`, #3685)

With `aksk` the driver sends GETs only, each signed with the access key
(`otc-sign.ts`); there is no token POST. The reads it adds are IAM self-reads
of the key's own account: `GET /v3/auth/domains`, `GET /v3/auth/projects`,
`GET /v3/auth/catalog` and `GET /v3.0/OS-CREDENTIAL/credentials/{access_key}`
(the user of a permanent key). A key inherits the roles of its user, so the
role set below applies unchanged. A **temporary** key (`session-token`) has no
credential lookup (404, live 2026-11-04): the probe cannot name the user and
reports `unverifiable`; such a run needs `--accept-unverified-read-only`.

The live check of 2026-11-04 used a temporary AK/SK that was requested with
the operator token through `POST /v3.0/OS-CREDENTIAL/securitytokens` (900 s;
owner approval 2026-11-04 16:15Z) by the check script, outside the driver:
the driver's read allow-list does not contain that call. Never create a
permanent access key for SWAO on a tenant.

## Identities used on the test tenant

| Identity | Purpose | Probe result |
|---|---|---|
| Operator domain-level login | Development, recording and the complete run, with `--accept-write-capable-credentials` (owner decisions 2026-11-02 and 2026-11-03) | `refused` (live 2026-11-03: Tenant Administrator, Security Administrator and Agent Operator roles; four non-read actions) |
| Group "read-only admin" (AOM ReadOnlyAccess, AOM Viewer, AOM Global Access, APIG ReadOnlyAccess) | Not run: no user holds only this group, and none is created (owner decision 2026-11-03). The low-privilege `unknown` / `not_collected` path is covered by mock-server 403 tests (`otc/__tests__/otc-driver.test.ts:470`) | - |

## API actions of the complete run and their narrowest read-only role

Recorded on the operator run 2026-11-03 (`SWAO_LZ_RECORD`, 37 requests, 11
routes). Sources are the OTC documentation sources published in the
`opentelekomcloud-docs` GitHub organisation (the rendered site
docs.otc.t-systems.com carries the same text).

| Driver method | Call (route) | Action | Narrowest read-only role or policy | Source |
|---|---|---|---|---|
| all | `POST /v3/auth/tokens` | token issue | none (any IAM user) | IAM API reference, token management |
| `probeReadOnly` | `GET /v3/users/{user_id}/groups` | user groups of the caller | none: the user's own token suffices | IAM API reference, "Querying the User Group to Which a User Belongs" (token "with the Security Administrator permission or authenticated token of the user") |
| `probeReadOnly` | `GET /v3/domains/{domain_id}/groups/{group_id}/roles` | group roles, domain | **Security Administrator** (no read-only alternative published) | IAM API reference, "Querying Permissions of a User Group Under a Domain" |
| `probeReadOnly` | `GET /v3/projects/{project_id}/groups/{group_id}/roles` | group roles, project | **Security Administrator** (no read-only alternative published) | IAM API reference, "Querying Permissions of a User Group Corresponding to a Project" |
| `probeReadOnly` | `GET /v3/OS-INHERIT/domains/{domain_id}/groups/{group_id}/roles/inherited_to_projects` | group roles, all projects | **Security Administrator** (no read-only alternative published) | IAM API reference, "Querying All Permissions of a User Group" |
| `listRegions` | `GET /v2.1/{project_id}/os-availability-zone` | `ecs:availabilityZones:list` | ECS ReadOnlyAccess | ECS API reference, permissions and supported actions, AZ management; ECS user guide, permissions |
| `listServices` | `GET /v1/resource-manager/domains/{domain_id}/providers` | not listed in the published RMS action table | no published RMS read-only policy (only RMS FullAccess); candidate: a policy granting `rms:*:list*`, `rms:*:get*` (the recorded AOM Global Access policy document allows exactly these). Read on the operator login only (Tenant Administrator); never exercised with that policy alone | RMS user guide, permissions management; RMS API reference, permissions policies and supported actions |
| `listResources` | `GET /v1/resource-manager/domains/{domain_id}/all-resources` | not listed in the published RMS action table (closest: `rms:resources:list`) | as above; RMS shows resources according to the caller's per-service permissions, so each service also needs its read role (for example ECS ReadOnlyAccess) | RMS user guide ("the resources displayed depend on the resource permissions of the users") |
| `listGuardrails` | `GET /v3/{project_id}/trackers` | querying a tracker | CTS ReadOnlyAccess | CTS user guide, permissions management (operation table) |
| `listActivity` | `GET /v3/{project_id}/traces` | querying traces | CTS ReadOnlyAccess | CTS user guide, permissions management (operation table) |
| `listPosture` (#3865) | `GET /v1/resource-manager/domains/{domain_id}/all-resources` | the inventory read, shared with `listResources` (one read per scope run) | as `listResources` | as above |
| `listPosture` (#3865) | `GET /v3/{project_id}/elb/listeners` | list listeners | ELB ReadOnlyAccess (candidate, unverified) | ELB API reference, querying listeners |
| `listPosture` (#3865) | `GET /v3/{project_id}/instances` | list DB instances | RDS ReadOnlyAccess (candidate, unverified) | RDS API reference, querying DB instances |
| `listPosture` (#3865) | `GET /v3/{project_id}/vaults`, `GET /v3/{project_id}/policies` | list vaults, list policies | CBR ReadOnlyAccess (candidate, unverified) | CBR API reference, querying the vault list and the policy list |
| `listPosture` (#3865) | `GET /v3/{project_id}/trackers` | querying a tracker (OBS transfer lifecycle) | CTS ReadOnlyAccess | as `listGuardrails` |
| `listPosture` (#3865) | `GET /v3/domains/{domain_id}/groups/{group_id}/roles`, `GET /v3/OS-INHERIT/.../inherited_to_projects` | group roles of every IAM group, to count privileged users | **Security Administrator** (as the probe) | as `probeReadOnly` |
| `listPosture` (#3951) | `POST /v3.0/OS-CREDENTIAL/securitytokens` | temporary AK/SK from the login token (token method, 900 s), once per scope run, only for the OBS reads; not sent for an `aksk` scope | none beyond the login (IAM API reference, "Obtaining a Temporary AK/SK": any user may convert its own token) | IAM API reference, access key management |
| `listPosture` (#3951) | `GET /?encryption`, `GET /?acl`, `GET /?policy` (every RMS bucket), `GET /?lifecycle` (each CTS trace bucket), bucket in the host, OBS signature | `obs:bucket:GetEncryptionConfiguration`, `obs:bucket:GetBucketAcl`, `obs:bucket:GetBucketPolicy`, `obs:bucket:GetLifecycleConfiguration` | OBS ReadOnlyAccess (candidate, unverified) | OBS API reference, advanced bucket settings |
| `listPosture` (#3954) | `GET /v2/{project_id}/apigw/instances/{instance_id}/api-groups`, `GET .../apis` | `apig:groups:list`, `apig:apis:list` | APIG ReadOnlyAccess (candidate, unverified) | APIG API reference, dedicated gateway APIs v2, querying API groups and APIs |
| `listServices`, `listPrices` | `GET https://calculator.otc-service.com/en/open-telekom-price-api/` | public price list | none (no login) | public endpoint |
| `listQuotas` | none | - | - (no verified OTC quota API; `not_collected`) | #3572 |

### Resulting role set (unverified)

| Role or policy | Scope | Unlocks |
|---|---|---|
| ECS ReadOnlyAccess | region projects (eu-de, eu-nl) | AZs per region; ECS resources in the RMS inventory |
| CTS ReadOnlyAccess | region projects | trackers (guardrails), traces (activity counts) |
| A custom policy with `rms:*:list*`, `rms:*:get*` (no system-defined RMS read-only policy is published; candidate, not exercised alone) | domain | RMS provider directory and all-resources inventory |
| Per-service ReadOnlyAccess for every service whose resources should appear in the inventory | region projects | the matching RMS inventory entries |
| Security Administrator | domain | the probe's group role queries; **write-capable** (manages IAM), see open points |

## Read-call coverage

Design 123 section 5.7 (D-13, #3886): every relevant read call of the
driver, the data product it feeds, and whether the driver uses it. `yes`
rows are exactly the driver's route templates and the calls it makes against
the mock pack (pinned by `ops/mock-csp/contract/coverage.contract.ts`).
`planned` rows are candidates from Design 123 sections 5.4 and 5.6, not yet verified: the named sprint issue checks the route or action against the API reference and adds it; `no` rows carry one of
the reasons of section 5.7. Every property a used call returns is kept:
normalised fields, else the `attributes` map after the privacy filter
(`live/privacy.ts` `filterAttributes`). The read-only allow-list is never
widened for coverage (Design 120 section 6.3); the one credential rule added
since, the temporary AK/SK request of the OBS reads (#3951), issues a 15-minute
credential and creates nothing persistent (owner review open).

Source of the property sets: the live operator run of 2026-11-03 (RMS
`all-resources`: top-level fields `ep_id`, `ep_name`, `project_id`,
`project_name`, `checksum`, `updated`, `provisioning_state`, `state` and a
per-service `properties` object, about 190 distinct property keys across
the test tenant's resource types), re-checked by the live run of 2026-11-05 (#3886).

| Read call | Feeds | Used | Reason when not used |
|---|---|---|---|
| `POST /v3/auth/tokens` | auth | yes | - |
| `GET /v3/auth/domains` | auth, probe | yes | - |
| `GET /v3/auth/projects` | auth | yes | - |
| `GET /v3/auth/catalog` | auth | yes | - |
| `GET /v3.0/OS-CREDENTIAL/credentials/{access_key}` | probe | yes | - |
| `GET /v3/users/{user_id}/groups` | probe | yes | - |
| `GET /v3/domains/{domain_id}/groups/{group_id}/roles` | probe, posture | yes | - |
| `GET /v3/projects/{project_id}/groups/{group_id}/roles` | probe | yes | - |
| `GET /v3/OS-INHERIT/domains/{domain_id}/groups/{group_id}/roles/inherited_to_projects` | probe, posture | yes | - |
| `GET /v2.1/{project_id}/os-availability-zone` | offering | yes | - |
| `GET /v1/resource-manager/domains/{domain_id}/providers` | offering | yes | - |
| `GET /v1/resource-manager/domains/{domain_id}/all-resources` | estate, posture | yes | - |
| `GET /v3/{project_id}/trackers` | estate, posture | yes | - |
| `GET /v3/{project_id}/traces` | estate | yes | - |
| `GET /en/open-telekom-price-api/` | offering | yes | - |
| `GET /v3/projects` | hierarchy | yes | - |
| `GET /v1.0/enterprise-projects` | hierarchy | yes | - |
| `GET /v3/{project_id}/elb/listeners` | posture | yes | - |
| `GET /v3/{project_id}/instances` | posture | yes | - |
| `GET /v3/{project_id}/vaults` | posture | yes | - |
| `GET /v3/{project_id}/policies` | posture | yes | - |
| `POST /v3.0/OS-CREDENTIAL/securitytokens` | posture | yes | - |
| `GET /{bucket}` | posture | yes | - |
| `GET /v2/{project_id}/apigw/instances/{instance_id}/api-groups` | posture | yes | - |
| `GET /v2/{project_id}/apigw/instances/{instance_id}/apis` | posture | yes | - |
| `GET /v2/{project_id}/apigw/instances/{instance_id}/features` | posture | no | not read: a feature configuration can hold the private key of backend two-way authentication (`backend_client_certificate`, APIG appendix "Supported Features"); the TLS floor comes from the custom domains of the API groups (#3954) |
| `GET /v1/{project_id}/security-group-rules` | posture | no | duplicate: RMS `all-resources` returns the rules of every security group (`security_group_rules`, live 2026-11-05, #3865), so the VPC read adds nothing |
| `GET /v1/{project_id}/publicips` | posture | no | duplicate: RMS `all-resources` returns every EIP with `associateInstanceId` (live 2026-11-05, #3865) |
| `POST /v1.0/{project_id}/kms/list-keys` | posture | no | outside the read-only allow-list: a POST; the key list comes from RMS `kms.keys` instead (live 2026-11-05, #3865, Design 120 section 6.3) |
| `GET /v3/users` | posture | no | duplicate: RMS `iam.users` returns `credentials`, `virtual_mfa_device`, `login_protect` and `group_list` (live 2026-11-05, #3865) |
| `GET /v3.0/OS-MFA/virtual-mfa-devices` | posture | no | duplicate: RMS `iam.users` carries `virtual_mfa_device` (live 2026-11-05, #3865) |

## Open points

- **Verification gap (owner decision 2026-11-03).** No identity with only the
  roles above exists on the test tenant, so the set is not verified by a run.
  A client tenant run with a least-privilege identity is the first chance to
  verify it; until then the `otc` driver's evidence is the operator run.
- **The probe needs Security Administrator.** The three group role queries are
  documented with the Security Administrator permission only. A least-privilege
  identity therefore cannot read its own role assignments: its probe result is
  `unverifiable`, and the run needs `--accept-unverified-read-only`
  (Design 120 section 6.3). A narrower IAM read role is not published.
- **RMS read access.** The published RMS documentation has no read-only
  system policy and does not list the `providers` and `all-resources` routes in
  its action table. Which minimal action set they need is an open question for
  a client tenant run.
- MFA: the operator login needs no virtual MFA passcode for the password
  token (verified 2026-11-03, #3572).
