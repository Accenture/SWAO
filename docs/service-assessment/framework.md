# SWAO_APM framework reference

SWAO_APM (SWAO Application Portfolio Management, version 2026.10, status approved) is the community framework behind Service Portfolio Assessment. It scores every application across eleven domains, combines the domain scores into a risk score, and derives a TIME recommendation. It is a SWAO synthesis of the Gartner TIME model, ISO/IEC 25010:2023, TOGAF 10, ENISA good practice, and EU sovereign cloud criteria; no third-party control text is reproduced. The general framework page is [SWAO_APM](/frameworks/swao-apm).

## The eleven domains and their weights

| Domain | Name | Default weight | What it asks |
|---|---|---|---|
| `APM-TCH` | Technical health | 20 | Is the platform in support, patched, free of critical and known-exploited vulnerabilities? |
| `APM-SEC` | Security posture | 18 | Weak cryptography, cleartext endpoints, hard-coded secrets, expired signing certificates, national advisories, malware verdicts |
| `APM-VND` | Vendor health | 12 | Is the vendor known, supporting the product, under contract, reachable? |
| `APM-DAT` | Data governance | 10 | Are classification, residency, sub-processors, and sensitive data declared? |
| `APM-REG` | Compliance obligations | 8 | Regulatory load, GDPR Art. 9, MDR classification, audit recency |
| `APM-SOV` | Sovereignty readiness | 8 | Sovereign rating, sovereign alternative available, data stored in the EU |
| `APM-MIG` | Migration readiness | 6 | Migration candidate, portable operating system, cloud-ready delivery model |
| `APM-INT` | Integration complexity | 6 | How many integrations, and are they documented? |
| `APM-HW` | Hardware and cost | 4 | Is the hardware profile known, right-sized, and costed? |
| `APM-BIZ` | Business criticality | 4 | Criticality, user base, operational status, owning department |
| `APM-STR` | Strategic fit | 4 | Analyst disposition and declared migration intent |

The weights sum to 100. They keep the ordering of Design 103 guardrail G-07 (technical health, security, vendor, data, regulatory first).

## How scores are calculated

1. **Control score (0 to 100, health scale).** 47 of the 72 controls are bound to a scoring rule through `evidence_basis: [{ apm_export: <rule> }]`. A rule reads evidence the service flow already produced and returns 100 (healthy) to 0 (high concern). Example: `os_eol_horizon` returns 0 when end of life has passed, 20 under 12 months, 40 under 18, 70 under 36, otherwise 100.
2. **Unknown is not failure.** When the evidence is missing (for example no research yet), the rule returns no value. The control is reported as unknown and left out of its domain score; it is never counted as pass or fail. Two rules are deliberately strict: `bsi_advisories` scores only a completed BSI CERT-Bund feed match (an advisory count), and `integration_count` reads an empty integration list as "no integrations" only when the intake had an integration column (listed in `intake.fields` of the app); otherwise both controls stay unknown.
3. **Domain score.** The weighted mean of the domain's known control scores (control weight from an optional `apm-weight.N` tag, default 1). A domain with no known control has no score.
4. **Health score.** The weighted mean of the available domain scores, using `domain_weights`.
5. **Risk score.** `100 - health score`, so 100 is the highest risk. The portfolio risk score is the mean over all apps that have a score and whose TIME label rests on sufficient evidence (see [Evidence behind the TIME label](#evidence-behind-the-time-label)).

The remaining 25 controls describe evidence an analyst provides (for example certifications, penetration tests, data processing agreements). They are part of the framework for completeness and appear in compliance results, but do not affect the automated score.

## Where the evidence comes from (signal sources)

| Domain | Evidence used by the rules |
|---|---|
| `APM-TCH` | [Pass 24 RESEARCH](/passes/24-research): endoflife.date, NVD CVE counts and patch status, CISA KEV; intake OS; [Pass 25 BINARY](/passes/25-binary) runtime age |
| `APM-SEC` | [Pass 08 CRYPTO](/passes/08-crypto) findings on binaries and configuration (weak algorithms, cleartext endpoints, hard-coded secrets, expired certificates); BSI CERT-Bund advisories and VirusTotal from Pass 24 |
| `APM-VND` | Intake vendor fields: name, version, support status, contract expiry, support contact presence flag |
| `APM-DAT` | Intake data fields; [Pass 03 DATA](/passes/03-data) run in service mode |
| `APM-SOV` | INFRA-CAT classification (sovereign rating and alternatives); data residency |
| `APM-BIZ` | Intake business fields and operational status |
| `APM-HW` | Intake hardware; cloud cost estimate |
| `APM-INT` | Intake integrations and integration notes |
| `APM-MIG` | Intake disposition; OS portability; delivery model (`vendor_type`) |
| `APM-REG` | Intake regulatory obligations, GDPR Art. 9, MDR class, last audit date |
| `APM-STR` | Intake analyst TIME and migration candidate flag |

## TIME classification

The TIME recommendation is derived in two layers. The first rule that applies wins.

1. **Overrides**
   - Operational status `decommissioned`, `unused`, or `inactive`: **Eliminate**. (`restricted`, keep but do not start, is deliberately excluded.)
   - CISA KEV match: **Migrate-Critical**.
   - At least one critical CVE and end of life within 12 months: **Migrate-Critical**.
   - End of life passed without extended support: **Migrate-Critical**.
2. **Thresholds**
   - End of life within 0 to 36 months: **Migrate**. End of life passed but extended support available: **Migrate**.
   - Vendor health or technical health below 40 and migration readiness above 60: **Migrate**.
   - Strategic fit, technical health, and vendor health all above 70: **Invest**.
   - Strategic fit below 30 and business criticality below 30: **Eliminate**.
   - Otherwise: **Tolerate** (in support, no overriding risk).

Every app receives a reason in plain language (for example "CISA KEV known-exploited vulnerability match"). The analyst's own TIME judgement from the intake (`disposition.gartner_time`) is kept alongside and never overwritten, so differences are visible.

### Evidence behind the TIME label

A TIME label rests on evidence when SWAO knows the end-of-life status or the CVE status of the app. The end-of-life status is known when [Pass 24 RESEARCH](/passes/24-research) found the end-of-life state or horizon (`is_eol` or `months_until_eol` in `eol-status.md`). The CVE status is known when the NVD query answered (no error, skip reason, or note in the `cve` block of `cve-summary.md`), which needs a vendor name. When neither is known and the operational status does not decide the label (`decommissioned`, `unused`, `inactive`), SWAO still shows the derived quadrant, but:

- the reason starts with `insufficient evidence (end of life and cve status unknown);`, followed by the reason of the rule that applied;
- the app is left out of the portfolio risk score;
- the engagement hub card shows the badge **Evidence: insufficient**.

`wsp/portfolio-summary.json` records per app:

| Key | Meaning |
|---|---|
| `assessed` | `true` when the app has a service assessment run (`apps/<id>/wsp/latest-service.txt`); otherwise the hub card shows **Not assessed** |
| `evidence` | `sufficient` or `insufficient` |
| `evidence_missing` | Which of `end_of_life` and `cve` are unknown |

At summary level, `assessed_count` counts the apps with a service run and `insufficient_evidence_count` the apps whose label rests on insufficient evidence.

## Application apps in the combined view

In a workspace that holds application and service apps, `wsp/portfolio-summary.json` also lists the application apps (`assessment_type: application`, see [Portfolio Operations](/portfolio)). The service rules above are not applied to them, because they read intake fields and research stubs an application app does not have. Instead, six rules read the latest usable application run (`apps/<id>/wsp/latest-application.txt`), each returning unknown when its evidence is absent:

| Control | Domain | Rule | Evidence |
|---|---|---|---|
| APP-TCH-01 | APM-TCH | Runtime end of life: active LTS 100, maintenance LTS 70, past end of life 0 | Pass 01 / 05 `node_eol_status` |
| APP-TCH-02 | APM-TCH | Dependency CVEs: 0 vulnerable packages 100, 1 package 40, more 10 | Pass 05 `critical_cves_found` (packages with high or critical CVEs; only when the lookup completed) |
| APP-SEC-01 | APM-SEC | Findings: any negative critical 10; no negative high 100; 1 to 2 high 60; more 30 | Negative signals of all pass files |
| APP-REG-01 | APM-REG | Compliance: mean of PASS 100, PARTIAL 50, GAP 0 | `wsp-plan.yaml` compliance regimes |
| APP-MIG-01 | APM-MIG | Portability: `portability_score` x 100 | `wsp.yaml` overall |
| APP-MIG-02 | APM-MIG | Landing zone fit: READY 100, READY_WITH_CHANGES 70, NEEDS_VERIFICATION 50, BLOCKED 0 | `wsp/latest-lz-primary.yaml` |

Domain scores, health and risk are aggregated with the same domain weights as service apps. The TIME quadrant follows the 7R verdict:

| 7R verdict | TIME |
|---|---|
| Retire | Eliminate |
| Retain | Tolerate |
| Rehost, Relocate, Replatform, Repurchase | Migrate |
| Refactor (Re-architect, Rebuild) | Invest |

Overrides, applied first: operational status `decommissioned`, `unused` or `inactive` in the app `.swao.yml` gives **Eliminate**; a runtime past end of life together with packages with high or critical CVEs gives **Migrate-Critical** (unless the verdict is Retire). The evidence label is `not_assessed` without a usable application run, `insufficient` when the 7R verdict is missing or neither the runtime end of life nor the dependency CVE status is known, and `sufficient` otherwise. No `apm-score.json` is written into application runs.

## Customising weights and rules

Copy the whole bundled framework folder (`framework-meta.yaml` and `controls.yaml`) into the workspace and edit the copy. SWAO prefers the workspace copy and reads both files from it. Copy the source from GitHub at [community-frameworks/swao-apm](https://github.com/Accenture/SWAO/tree/main/community-frameworks/swao-apm). Place the copy at:

```text
wsp/inputs/catalogs/community/swao-apm/framework-meta.yaml
wsp/inputs/catalogs/community/swao-apm/controls.yaml
```

Excerpt of an edited `framework-meta.yaml` (keep all other keys as they are):

```yaml
framework:
  domain_weights:
    APM-TCH: 25
    APM-SEC: 20
    APM-VND: 10
    APM-DAT: 10
    APM-REG: 10
    APM-SOV: 8
    APM-MIG: 5
    APM-INT: 4
    APM-HW: 3
    APM-BIZ: 3
    APM-STR: 2
  time_rules:
    migrate:
      eol_months_min: 0
      eol_months_max: 24     # tighter Migrate window for this engagement
```

`swao health-check` validates the copy:

- **Probe 18 (SWAO_APM weights):** all eleven domains present and the integers sum to exactly 100. A wrong sum is an error; a missing `domain_weights` key is a warning (equal weights are then assumed).
- **Probe 25 (SWAO_APM controls):** all eleven domains have controls, at least 4 per domain, every control has an ID, a title, and an evidence basis, and IDs are unique.

## Controls by domain
### APM-STR: Strategic fit

| Control | Title | Scored by rule |
|---|---|---|
| `APM-STR-01` | Analyst portfolio disposition recorded | `analyst_time_signal` |
| `APM-STR-02` | Migration intent declared | `migration_intent` |
| `APM-STR-03` | Business capability alignment | analyst evidence (not automated) |
| `APM-STR-04` | Cloud-native successor available | analyst evidence (not automated) |
| `APM-STR-05` | Vendor roadmap commitment | analyst evidence (not automated) |
| `APM-STR-06` | Functional redundancy assessed | analyst evidence (not automated) |

### APM-VND: Vendor health

| Control | Title | Scored by rule |
|---|---|---|
| `APM-VND-01` | Vendor identified | `vendor_identified` |
| `APM-VND-02` | Vendor support active | `vendor_support_active` |
| `APM-VND-03` | Support contact available | `support_contact_available` |
| `APM-VND-04` | Support contract current | `contract_currency` |
| `APM-VND-05` | Product version recorded | `product_version_known` |
| `APM-VND-06` | Vendor financial stability | analyst evidence (not automated) |
| `APM-VND-07` | Service level agreement defined | analyst evidence (not automated) |
| `APM-VND-08` | Vendor security advisory practice | analyst evidence (not automated) |

### APM-TCH: Technical health

| Control | Title | Scored by rule |
|---|---|---|
| `APM-TCH-01` | Operating system in support | `os_eol_status` |
| `APM-TCH-02` | Operating system end-of-life horizon | `os_eol_horizon` |
| `APM-TCH-03` | No open critical CVEs | `cve_critical_open` |
| `APM-TCH-04` | Limited high-severity CVEs | `cve_high_open` |
| `APM-TCH-05` | No known exploited vulnerabilities | `kev_match` |
| `APM-TCH-06` | Patches available for severe CVEs | `patch_availability` |
| `APM-TCH-07` | Supported operating system family | `os_family_supported` |
| `APM-TCH-08` | Update cadence | analyst evidence (not automated) |
| `APM-TCH-09` | Runtime and dependency freshness | `binary_runtime_current` |

### APM-SEC: Security posture

| Control | Title | Scored by rule |
|---|---|---|
| `APM-SEC-01` | No weak cryptographic algorithms | `weak_crypto` |
| `APM-SEC-02` | Encrypted network endpoints | `cleartext_endpoints` |
| `APM-SEC-03` | No hard-coded credentials | `hardcoded_credentials` |
| `APM-SEC-04` | Valid code-signing certificates | `expired_certificates` |
| `APM-SEC-05` | No severe national advisories | `bsi_advisories` |
| `APM-SEC-06` | Installer not flagged as malicious | `vt_detection` |
| `APM-SEC-07` | Strong authentication | analyst evidence (not automated) |
| `APM-SEC-08` | Security certifications | analyst evidence (not automated) |
| `APM-SEC-09` | Recent penetration test | analyst evidence (not automated) |
| `APM-SEC-10` | Security incident history | analyst evidence (not automated) |

### APM-DAT: Data governance

| Control | Title | Scored by rule |
|---|---|---|
| `APM-DAT-01` | Data classification declared | `data_classification_declared` |
| `APM-DAT-02` | Health data sensitivity | `health_data_sensitivity` |
| `APM-DAT-03` | Personal data sensitivity | `personal_data_sensitivity` |
| `APM-DAT-04` | Data flows documented | `data_flow_documented` |
| `APM-DAT-05` | Data residency declared | `data_residency_declared` |
| `APM-DAT-06` | Sub-processors declared | `subprocessors_declared` |
| `APM-DAT-07` | Data processing agreement | analyst evidence (not automated) |
| `APM-DAT-08` | Retention and deletion | analyst evidence (not automated) |

### APM-SOV: Sovereignty readiness

| Control | Title | Scored by rule |
|---|---|---|
| `APM-SOV-01` | Sovereign technology rating | `sovereign_rating` |
| `APM-SOV-02` | Sovereign alternative exists | `sovereign_alternative_available` |
| `APM-SOV-03` | Data stored in the EU | `data_residency_eu` |
| `APM-SOV-04` | Third-country transfer risk | analyst evidence (not automated) |
| `APM-SOV-05` | EU vendor entity | analyst evidence (not automated) |
| `APM-SOV-06` | EUCS readiness | analyst evidence (not automated) |

### APM-BIZ: Business criticality

| Control | Title | Scored by rule |
|---|---|---|
| `APM-BIZ-01` | Business criticality recorded | `business_criticality` |
| `APM-BIZ-02` | User base | `user_base` |
| `APM-BIZ-03` | Operationally active | `operational_status_active` |
| `APM-BIZ-04` | Owning department recorded | `department_assigned` |
| `APM-BIZ-05` | Outage impact assessed | analyst evidence (not automated) |
| `APM-BIZ-06` | Process coverage | analyst evidence (not automated) |

### APM-HW: Hardware and cost

| Control | Title | Scored by rule |
|---|---|---|
| `APM-HW-01` | Hardware profile recorded | `hardware_profile_known` |
| `APM-HW-02` | Right-sized memory | `memory_utilisation` |
| `APM-HW-03` | Cloud cost estimated | `cloud_cost_estimate` |
| `APM-HW-04` | Total cost of ownership compared | analyst evidence (not automated) |

### APM-INT: Integration complexity

| Control | Title | Scored by rule |
|---|---|---|
| `APM-INT-01` | Integration count | `integration_count` |
| `APM-INT-02` | Integrations documented | `integration_documented` |
| `APM-INT-03` | Modern integration protocols | analyst evidence (not automated) |
| `APM-INT-04` | API availability | analyst evidence (not automated) |
| `APM-INT-05` | Replacement coupling | analyst evidence (not automated) |

### APM-MIG: Migration readiness

| Control | Title | Scored by rule |
|---|---|---|
| `APM-MIG-01` | Marked as migration candidate | `migration_candidate_flag` |
| `APM-MIG-02` | Portable operating system | `os_portability` |
| `APM-MIG-03` | Cloud delivery model | `vendor_type_cloud_ready` |
| `APM-MIG-04` | Sovereign cloud programme | `sovereign_cloud_programme` |
| `APM-MIG-05` | Data export capability | analyst evidence (not automated) |

### APM-REG: Compliance obligations

| Control | Title | Scored by rule |
|---|---|---|
| `APM-REG-01` | Regulatory load | `regulatory_load` |
| `APM-REG-02` | GDPR Art. 9 scope | `gdpr_art9_scope` |
| `APM-REG-03` | MDR classification known | `mdr_classification_known` |
| `APM-REG-04` | Recent security audit | `audit_recency` |
| `APM-REG-05` | Certification status current | analyst evidence (not automated) |

