<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Assessment Catalogue
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# Assessment Dimension Catalogue

**Audience:** SWAO consultants, client engineering leads, client executives
**Version:** 2026-04

This catalogue explains each SWAO assessment dimension in plain language. It is the
consultant-facing reference for presenting findings to non-technical stakeholders.
For each dimension: what it measures, why it matters, how to interpret the score,
and recommended language for client workshops.

---

## 1. 7R Migration Pattern

**What it measures**

Classifies the workload's recommended cloud migration strategy using the industry-standard
7R framework: Retire, Retain, Rehost, Replatform, Repurchase, Refactor, or Re-architect.
The verdict is driven by signals from all prior assessment passes and synthesised by the
SWAO language model.

**Why it matters**

The 7R label anchors the programme business case. Replatform means the application moves
with limited code changes and a migration window measured in weeks. Re-architect means
significant investment is required before migration can begin -- often 6-18 months of
refactoring. The wrong label leads to either cost overruns (underestimating complexity)
or missed value (over-engineering a simple lift-and-shift).

**How it is scored**

Qualitative verdict with a numeric confidence score (0.0-1.0). Confidence reflects the
proportion of high-confidence signals that converge on the verdict. Below 0.70 confidence,
the assessment flags the verdict as requiring human review.

**Score ranges**

| Confidence | Status | Interpretation |
|---|---|---|
| 0.90 - 1.00 | High confidence | Proceed to migration planning |
| 0.70 - 0.89 | Confident | Review assumptions; proceed with caveat |
| 0.50 - 0.69 | Moderate | Gather additional context before committing |
| < 0.50 | Low | Manual assessment required; do not use as sole input |

**Evidence sources**

Source code structure, dependency graph, SBOM, statefulness analysis, egress signals,
context inputs (CMDB, FinOps, incident history).

**Common findings and remediation**

| Finding | Recommended action |
|---|---|
| Verdict: Retain | Identify why (regulatory, dependency, cost). Set review date. |
| Verdict: Re-architect | Scope the refactoring effort. Raise as a pre-gate. |
| Low confidence | Schedule a technical workshop to resolve ambiguous signals. |

**Suggested consultant language**

"Based on the assessment, we recommend a Replatform approach for [application]. The
technology stack is cloud-native and there are no legacy blockers. The main pre-gate
is resolving the AWS Comprehend Medical dependency before the migration window opens."

---

## 2. Portability Score

**What it measures**

The fraction of external egress services the application uses that have sovereign-cloud
equivalents. A score of 1.0 means all services can be replaced with sovereign alternatives;
0.0 means full dependency on hyperscaler-proprietary services with no sovereign equivalent.

**Why it matters**

Predicts migration risk from vendor lock-in. Services with no sovereign equivalent are
migration pre-gates: the feature must be disabled, self-hosted, or replaced before the
migration window opens. Late discovery of a portability blocker typically delays a migration
programme by 3-6 months and adds unplanned cost.

**How it is scored**

```
portability_score = (available_verdicts + 0.5 * partial_verdicts) / total_egress_signals
```

Where `available` means a sovereign-cloud equivalent exists; `partial` means an EU presence
exists but full sovereign certification is unconfirmed; `unavailable` means no sovereign option.

**Score ranges**

| Range | Status | Interpretation |
|---|---|---|
| 0.85 - 1.00 | Sovereign-ready | Migration can proceed; verify partial verdicts |
| 0.70 - 0.84 | Conditional | One or two services require validation or replacement |
| 0.50 - 0.69 | At risk | Multiple services require replacement before migration |
| < 0.50 | Blocked | Significant remediation required; migration cannot proceed as-is |

**Evidence sources**

EGR pass signals cross-referenced against the sovereign service catalogue
(`controls/sovereign-service-catalogue.yaml`).

**Common findings and remediation**

| Finding | Recommended action |
|---|---|
| `unavailable` verdict with `blocks_migration: true` | Replace or disable before migration pre-gate |
| `partial` verdict | Obtain contractual EU data routing guarantee from vendor |
| Score below 0.50 | Escalate to architecture board; evaluate Re-architect disposition |

**Suggested consultant language**

"The portability score of 0.56 tells us that 44% of the services Medplum calls have no
direct sovereign-cloud equivalent. The good news is that two of these -- AWS Textract --
may be inactive in production. Once we confirm that, the score rises to 0.75 and the
application enters the sovereign-ready range."

---

## 3. Legacy Indicators

**What it measures**

Detects enterprise legacy middleware, proprietary database clients, and native binary
dependencies that prevent or complicate a sovereign cloud migration. Classified into
three tiers by migration impact.

**Why it matters**

Legacy technology is the single most common cause of stranded migration programmes.
Tier-1 blockers (IBM MQ, TIBCO, Oracle SOA Suite) have no sovereign-cloud equivalent
and require full replacement before migration can begin -- this is often a 12-24 month
engineering programme in itself. Detecting them early prevents surprise scope expansions.

**How it is scored**

Qualitative verdict (clear / advisory / blocked) with tier breakdown counts. No numeric
score -- presence of even one tier-1 blocker escalates the 7R disposition toward
Retain or Re-architect regardless of other scores.

**Tier definitions**

| Tier | Label | Migration impact |
|---|---|---|
| Tier 1 | Blocker | No sovereign equivalent; full replacement required |
| Tier 2 | Complicator | Sovereign alternative exists; significant migration effort (30-90 days) |
| Tier 3 | Manageable | Adds migration cost; does not change 7R disposition |

**Evidence sources**

Dependency manifests (package.json, pom.xml, requirements.txt, Cargo.toml),
file patterns (.bts, .cbl), Docker Compose images, SQL migration files.

**Common findings and remediation**

| Finding | Recommended action |
|---|---|
| IBM MQ (tier 1) | Evaluate cloud-native messaging (Azure Service Bus on sovereign, or self-hosted ActiveMQ) |
| Oracle DB with stored procedures > 500 lines (tier 1) | Scope stored procedure migration effort before committing to timeline |
| .NET Framework with Windows APIs (tier 2) | Port to .NET 8+; validate containerisation |

**Suggested consultant language**

"Medplum is legacy-clear -- no tier-1 blockers detected. This is a positive differentiator;
the migration is not gated by technology debt. In contrast, we often find IBM MQ or Oracle
SOA in healthcare workloads, which adds 12-18 months to the programme."

---

## 4. Data Migration Feasibility

**What it measures**

Assesses whether the application's stateful data volume can be migrated within the agreed
recovery time objective (RTO) at a realistic data transfer rate. A feasibility ratio
greater than 1.0 means a single-window cutover is not achievable.

**Why it matters**

Data migration is the most complex and risky phase of a cloud migration. An 800 GB database
that takes 8 hours to transfer cannot be migrated in a 2-hour weekend maintenance window.
Discovering this late forces either a longer outage (business risk) or an unplanned
CDC/replication infrastructure investment.

**How it is scored**

```
feasibility_ratio = estimated_transfer_hours / rto_hours
```

Ratio < 1.0 = feasible (single cutover). Ratio > 1.0 = requires phased migration.

**Score ranges**

| Ratio | Verdict | Implication |
|---|---|---|
| < 1.0 | Feasible | Single-window migration is achievable |
| 1.0 - 2.0 | Marginal | Consider off-peak window or incremental approach |
| 2.0 - 5.0 | Requires phased migration | CDC bridge or logical replication required |
| > 5.0 | Major data migration programme | Dedicated data migration workstream needed |

**Evidence sources**

Context inputs: FinOps data (storage costs -> volume estimate), CMDB (DB engine and size),
statefulness signals (STATE pass).

**Suggested consultant language**

"With 828 GB of FHIR data and a 2-hour RTO, a direct cutover is not possible. We recommend
deploying a Debezium CDC bridge to keep the sovereign-cloud replica in sync. This reduces
the actual cutover window to under 30 minutes while the application continues serving
patients during the migration."

---

## 5. CI/CD Pipeline Security

**What it measures**

Assesses the supply chain attack surface of the application's CI/CD pipeline against a
catalogue of eight security rules (PP-R-01 to PP-R-08), covering GitHub Actions pinning,
credential management, SAST integration, dependency review, and build provenance.

**Why it matters**

Supply chain attacks (SolarWinds, XZ Utils, tj-actions incident) frequently originate in
CI/CD pipelines. A sovereign cloud migration is a high-risk period -- pipelines are
modified, new credentials are provisioned, and deployment paths change. A hardened pipeline
reduces the attack surface during the most vulnerable phase.

**How it is scored**

Count of findings by severity (critical, high, medium, low). Positive controls are recorded
separately. No aggregate score -- severity distribution drives the advisory.

**Evidence sources**

GitHub Actions workflow files (.github/workflows/), package-lock.json/pnpm-lock.yaml
(dependency integrity), SAST tool configuration.

**Common findings and remediation**

| Finding | Recommended action |
|---|---|
| Unpinned GitHub Actions (uses: action@v3) | Pin to SHA: `uses: action@sha256:...` |
| Static deployment credentials | Replace with OIDC-based ephemeral tokens |
| No SAST in PR gate | Add CodeQL or equivalent as a required status check |
| No SBOM attestation | Add `attest-build-provenance` step to release workflow |

**Suggested consultant language**

"Medplum's production pipeline is well-hardened: SHA-pinned Actions, OIDC authentication,
and CodeQL active on PRs. The four medium findings are in secondary workflows that don't
touch production. We recommend addressing these before the migration window to eliminate
any attack surface during the cutover period."

---

## 6. Observability Readiness

**What it measures**

Coverage of monitoring instrumentation across eight application components: HTTP layer,
background job queues, database query performance, external service calls, error tracking,
distributed tracing, custom business metrics, and structured log output.

**Why it matters**

An application that cannot be observed in production cannot be safely migrated. Missing
metrics or traces on sovereign cloud mean that a failure during or after migration goes
undetected until a client reports it. Observability gaps are one of the top causes of
failed cloud migrations.

**How it is scored**

```
observability_score = instrumented_components / 8
```

Threshold: 0.60 (at least 5 of 8 components instrumented before migration is recommended).

**Score ranges**

| Range | Status | Interpretation |
|---|---|---|
| 0.75 - 1.00 | Sovereign-ready | Migration can proceed; verify OTel endpoint config |
| 0.60 - 0.74 | Conditional | Close remaining gaps before migration go-live |
| < 0.60 | Not ready | Do not migrate until observability gaps are addressed |

**Common findings and remediation**

| Finding | Recommended action |
|---|---|
| Queue not instrumented | Add OTel spans to Bull/BullMQ job processors |
| No distributed tracing | Add `@opentelemetry/sdk-node` with W3C trace context propagation |
| Logs not structured | Replace `console.log` with pino/winston JSON output |

---

## 7. Licence Compliance (Pass 16)

**What it measures**

Scans the SBOM for OSS licences that are incompatible with commercial distribution or
sovereign cloud deployment. Flags copyleft licences (GPL, AGPL) that require source
disclosure, and proprietary licences with geographic or use restrictions.

**Why it matters**

Licence compliance failures can halt a migration or require emergency code removal.
AGPL licences in particular require source disclosure for any service the application
calls over a network -- a common trigger in healthcare and financial services workloads.

**Score ranges**

| Verdict | Interpretation |
|---|---|
| clear | No licence conflicts detected |
| advisory | Copyleft licences present; legal review recommended before go-live |
| blocked | Licence conflict requires remediation before migration |

---

## 8. Testing and Quality Maturity (Pass 17)

**What it measures**

Assesses the application's test coverage breadth (unit, integration, E2E), test reliability
(flakiness, skip rate), and quality gate configuration (required checks on PRs, minimum
coverage thresholds).

**Why it matters**

Migrations introduce regressions. Applications without a reliable test suite cannot validate
that the migrated version behaves identically to the original. Low test maturity raises the
risk of silent regressions on sovereign cloud -- especially for FHIR-compliant healthcare
applications where data integrity is a patient safety concern.

**Score ranges**

| Range | Status | Interpretation |
|---|---|---|
| 0.80 - 1.00 | Mature | Migration risk from regressions is low |
| 0.60 - 0.79 | Developing | Address coverage gaps in critical paths before migration |
| < 0.60 | Immature | Manual regression testing plan required; consider migration risk |

---

## Using this catalogue through Claude Desktop

The prompts below let you query any dimension from Claude Desktop once an assessment
has been run. Replace `[app]` with the application identifier and `[workspace]` with
the absolute path to the portfolio root.

### Read reports by stakeholder persona

| Persona | Dimensions emphasised | Prompt |
|---|---|---|
| Application Architect | All 8 dimensions + signal evidence | `Use swao_report for [app], view application-architect.` |
| Business Owner | 7R label, portability, legacy blockers, cost | `Use swao_report for [app], view business-owner.` |
| GRC / Compliance Officer | Compliance controls, GDPR/BSI C5/NIST gaps | `Use swao_report for [app], view grc-compliance-officer.` |
| FinOps Lead | Cost model, egress spend, landing zone sizing | `Use swao_report for [app], view finops-lead.` |
| Programme Manager | Blockers, timeline, dependencies, risk register | `Use swao_report for [app], view programme-manager.` |

### Query individual dimensions

| Dimension | Signal prefix | Prompt |
|---|---|---|
| 7R Migration Pattern | SYNTH | `Use swao_signal_detail for [app], signal_id: SYNTH-01.` |
| Portability Score | EGR | `Use swao_signals for [app], prefix_filter: EGR.` |
| Legacy Indicators | INV, STATE | `Use swao_signals for [app], prefix_filter: INV,STATE.` |
| Data Migration Feasibility | DATA, STATE | `Use swao_signals for [app], prefix_filter: DATA,STATE.` |
| CI/CD Pipeline Security | TF | `Use swao_signals for [app], prefix_filter: TF.` |
| Observability Readiness | OBS | `Use swao_signals for [app], prefix_filter: OBS.` |
| Licence Compliance | LIC, SBOM | `Use swao_signals for [app], prefix_filter: LIC,SBOM.` |
| Testing and Quality Maturity | QA | `Use swao_signals for [app], prefix_filter: QA.` |

### Drill into compliance controls per dimension

| Goal | Prompt |
|---|---|
| GDPR control verdict | `Use swao_control_detail for [app], control_id: GDPR_DEMO.ART46.` |
| All GAP controls | `Use swao_report for [app], view grc-compliance-officer.` |
| Browse GDPR controls (no assessment needed) | `Use swao_control_catalogue, framework_id: GDPR.` |
| Browse BSI C5 controls | `Use swao_control_catalogue, framework_id: BSI_C5.` |
| List all supported frameworks | `Use swao_frameworks_list.` |

### Ingest evidence that updates a dimension

| Action | Prompt |
|---|---|
| Stage a remediation plan (text) | `Use swao_ingest for [app]. Category: compliance. Filename: [name].md. Content: [text].` |
| Capture structured evidence for a signal | `Use swao_evidence_capture for [app]. Addresses: ["[signal-id]"]. Statement: [one sentence]. Type: architecture_doc. Author: [email].` |
| Override a machine verdict | `Use swao_feedback_add for [app]. Target_type: signal. Target_id: [id]. Override_outcome: RISK_ACCEPTED. Rationale: [reason]. Author: [email].` |
| Mark a control satisfied | `Use swao_feedback_add for [app]. Target_type: control. Target_id: [control-id]. Override_outcome: SATISFIED. Rationale: [reason]. Author: [email].` |
| List all overrides recorded | `Use swao_feedback_list for [app].` |

### Landing zone and cloud provider queries

| Goal | Prompt |
|---|---|
| Why was this landing zone chosen? | `Use swao_explain_landing_zone for [app].` |
| Fit app against a specific region | `Use swao_lz_fit for [app], provider: stackit, region: eu01.` |
| Provider sovereignty facts | `Use swao_cloud_provider_catalogue.` |
| LZR scoring weights | `Use swao_lzr_weights for [app].` |

Full tool reference: `docs/design/084-mcp-tool-reference-and-user-prompts.md`.
