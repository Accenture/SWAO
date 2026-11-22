# `azure` live driver: roles

Status: **seeded, not live-checked** (#3575, 2026-11-04). There is no Azure
environment (Design 120 Q-21). The driver is developed against the
spec-derived Azure mock (`swao/ops/mock-csp/providers/azure/`, #3600), so it
stays unregistered for release (`liveVerified: false`). It is registered only
when `SWAO_LZ_UNVERIFIED_DRIVERS` names `azure`.

**Unverified: no Azure identity has run the driver.** The role set below is
the seed of Design 120 section 6.3 (`Reader` plus `Resource Graph Reader`). No
live run has confirmed that this set covers every call.

## Auth methods

| Method | Vault fields (`lz:<lz-id>:<scope-id>:<field>`) | Wire format |
|---|---|---|
| `service-principal-secret` | `tenant-id`, `client-id`, `client-secret` | RFC 6749 client credentials, secret in the form body |
| `service-principal-certificate` | `tenant-id`, `client-id`, `client-certificate` (PEM private key, optionally with its CERTIFICATE block) | RFC 7523 RS256 client assertion; `x5t` and `x5t#S256` only when the certificate block is present |

Managed identity (Design 120 section 7.1) is not offered. The instance
metadata endpoint is plain HTTP, and the driver base URLs must be https
(Q-3600-5, owner decision open).

The scope target is `scopes[].target.subscription` in `.swao.yml`.

## Seed role set

| Role | Why |
|---|---|
| `Reader` (`*/read`) | Subscription, locations, providers, policy assignments and definitions, role assignments and definitions |
| `Resource Graph Reader` | Resource Graph queries (`Microsoft.ResourceGraph/resources/read` in the spec's operations list) |

The probe reads the principal's role assignments
(`$filter=principalId eq '{oid}'`) and their role definitions. An action or
data action that does not end in `/read` refuses the credential. If the
principal has no assignment, or a definition is not readable, the result is
`unverifiable`. Assignments made to a group the principal belongs to may not
be listed (Q-3600-4).

## API calls of the driver

| Driver method | Operation (api-version) | Route |
|---|---|---|
| token | Entra ID client credentials (not in azure-rest-api-specs) | `POST /{tenant}/oauth2/v2.0/token` |
| `probeReadOnly` | `RoleAssignments_ListForSubscription` (2022-04-01) | `GET /subscriptions/{id}/providers/Microsoft.Authorization/roleAssignments` |
| `probeReadOnly` | `RoleDefinitions_Get` (2022-04-01) | `GET /subscriptions/{id}/providers/Microsoft.Authorization/roleDefinitions/{id}` |
| `listRegions` | `Subscriptions_Get`, `Subscriptions_ListLocations` (2022-12-01) | `GET /subscriptions/{id}`, `GET /subscriptions/{id}/locations` |
| `listServices` | `Providers_List` (2025-04-01) | `GET /subscriptions/{id}/providers` |
| `listServices`, `listGuardrails` | `PolicyAssignments_List` (`atScope()`), `PolicyDefinitions_Get*` (2025-03-01) | policy assignments; built-in, subscription and management group definitions |
| `listResources`, Pass 23 | Resource Graph `Resources` (2024-04-01) | `POST /providers/Microsoft.ResourceGraph/resources` |
| `listHierarchy` (#3884, mock only) | Resource Graph `ResourceContainers` (2024-04-01; tenant scope on a platform scope, the own subscription on an application scope) | `POST /providers/Microsoft.ResourceGraph/resources` |
| `listPosture` (#3868, mock only) | Resource Graph `Resources` (the inventory read, shared with `listResources`) and `RecoveryServicesResources` (2024-04-01; the scope's subscription) | `POST /providers/Microsoft.ResourceGraph/resources` |
| `listPosture` (#3940, mock only) | `SubscriptionDiagnosticSettings_List` (2021-05-01-preview), `Budgets_List` at subscription scope (2026-06-01) | `GET /subscriptions/{id}/providers/Microsoft.Insights/diagnosticSettings`, `GET /subscriptions/{id}/providers/Microsoft.Consumption/budgets` |

The two POSTs are on the read allow-list (`readAllowList`): the token request
and the Resource Graph query. Every other request is a GET.

`listQuotas` and `listActivity` report `not_collected`; no quota or activity
log API is read yet.

`listPosture` (#3868, Design 123 section 5.4) adds no route and no read
action: both of its queries go to the Resource Graph POST above, so the seed
role set (`Reader` plus `Resource Graph Reader`) covers it. The
`RecoveryServicesResources` rows (protected items, backup policies) are
readable with `Reader` on the vault (Microsoft Learn: "ARG allows you to
query the resources for which you have the appropriate RBAC rights").
Mock-verified only; no Azure identity has run it.

#3940 adds two GET list operations, covered by `Reader` (`*/read`:
`Microsoft.Insights/diagnosticSettings/read`,
`Microsoft.Consumption/budgets/read`). The read-only allow-list is
unchanged: any other method on these paths is refused before it is sent.
The budgets read is recorded as the source `posture:budgets`; its facts
(`readAzureBudgets`, counts and thresholds, no contacts) are not in
`estate.posture` until the shared budgets block (#3936) lands.

## Read-call coverage

Design 123 section 5.7 (D-13, #3886): every relevant read call of the
driver, the data product it feeds, and whether the driver uses it. `yes`
rows are exactly the calls the driver declares and makes against the mock
pack (pinned by `ops/mock-csp/contract/coverage.contract.ts`). `planned` rows are candidates from Design 123 sections 5.4 and 5.6, not yet verified: the named sprint issue checks the route or action against the API reference and adds it; `no` rows carry one of the reasons
of section 5.7. Every property a used call returns is kept: normalised
fields, else the `attributes` map after the privacy filter
(`live/privacy.ts` `filterAttributes`). The read-only allow-list is never
widened for coverage (Design 120 section 6.3).

Source of the property sets: the spec-derived Azure mock pack only (no
environment; `liveVerified: false`). The inventory query is the bare
`Resources` table (`AZURE_INVENTORY_QUERY`), which returns every column of a
resource (`name`, `kind`, `resourceGroup`, `managedBy`, `sku`, `plan`,
`identity`, `zones`, `extendedLocation`, `properties`, ...); before #3886 it
projected `id, type, location, tags, subscriptionId` only.

| Read call | Feeds | Used | Reason when not used |
|---|---|---|---|
| `POST /{tenant_id}/oauth2/v2.0/token` | auth | yes | - |
| `GET /subscriptions/{subscription_id}` | offering, hierarchy | yes | - |
| `GET /subscriptions/{subscription_id}/locations` | offering | yes | - |
| `GET /subscriptions/{subscription_id}/providers` | offering | yes | - |
| `POST /providers/Microsoft.ResourceGraph/resources` | estate, posture, pass23, hierarchy | yes | - |
| `GET /subscriptions/{subscription_id}/providers/Microsoft.Authorization/policyAssignments` | estate, offering | yes | - |
| `GET /providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}` | estate, offering | yes | - |
| `GET /subscriptions/{subscription_id}/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}` | estate, offering | yes | - |
| `GET /providers/Microsoft.Management/managementGroups/{management_group_id}/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}` | estate, offering | yes | - |
| `GET /subscriptions/{subscription_id}/providers/Microsoft.Authorization/roleAssignments` | probe | yes | - |
| `GET /subscriptions/{subscription_id}/providers/Microsoft.Authorization/roleDefinitions/{role_definition_id}` | probe | yes | - |
| `GET /providers/Microsoft.Management/managementGroups` | hierarchy | no | duplicate: Resource Graph `ResourceContainers` returns the management groups the principal can read with their ancestor chain (#3884, mock only) |
| `GET /providers/Microsoft.Management/managementGroups/{management_group_id}/descendants` | hierarchy | no | duplicate: `ResourceContainers` gives every subscription its `managementGroupAncestorsChain` and every management group its parent chain (#3884, mock only) |
| `GET /subscriptions` | hierarchy | no | duplicate: `ResourceContainers` lists the subscriptions (type `microsoft.resources/subscriptions`) at tenant scope (#3884, mock only) |
| `GET /subscriptions/{subscription_id}/resourcegroups` | hierarchy | no | duplicate: `ResourceContainers` lists the resource groups (type `microsoft.resources/subscriptions/resourcegroups`) (#3884, mock only) |
| `GET /subscriptions/{subscription_id}/providers/Microsoft.Insights/diagnosticSettings` | posture | yes | - |
| `GET /subscriptions/{subscription_id}/providers/Microsoft.Consumption/budgets` | posture | yes | - |
