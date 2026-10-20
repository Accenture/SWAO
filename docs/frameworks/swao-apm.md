# SWAO Application Portfolio Management (SWAO_APM)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `SWAO_APM` |
| Authority / publisher | SWAO Development Team; synthesis of Gartner TIME, ISO/IEC 25010:2023, TOGAF 10, ENISA guidance and EU sovereign cloud criteria |
| Version | 2026.10 |
| Status | `approved` |
| SWAO catalogue version | `0.1.0` |
| Total controls | 72 |
| Scoring mode | `score` (declared in `regime_meta`): 0 to 100 health score per control and domain, weighted risk score per application |
| Assessment scope (framework-meta) | `service` |
| Signal prefix | `APM` |
| Licence and redistribution | Original SWAO synthesis; no third-party control text is reproduced. Apache-2.0 with the community framework catalogue. |
| Last reviewed | 2026-10-10 |

## What it is

SWAO_APM is SWAO's own Application Portfolio Management framework. It is not a regulation. It rates third-party, SaaS and commercial off-the-shelf (COTS) applications across eleven domains, from vendor and technical health to data governance, sovereignty readiness and compliance load, and turns the result into a portfolio decision using the TIME model: Tolerate, Invest, Migrate or Eliminate.

The framework is the scoring basis of the [Service Portfolio Assessment](/service-assessment/). It draws on the Gartner TIME model, ISO/IEC 25010:2023 quality characteristics, the TOGAF 10 application portfolio catalogue and ENISA application security good practices (`framework-meta.yaml` references). Its status in the catalogue metadata is `approved`.

## Who should use it in SWAO and when

Use SWAO_APM whenever you run a [Service Portfolio Assessment](/service-assessment/): typically at the start of a sovereign cloud or data centre exit programme, when a client hands over a server or application list and needs to know which applications to keep, modernise, migrate first or retire. It applies to any sector and region; several controls (for example health data sensitivity, `APM-DAT-02`, and MDR classification, `APM-REG-03`) are particularly relevant for healthcare portfolios.

## What SWAO checks

SWAO_APM is scored deterministically by the service assessment module, not by LLM judgement. Each control can bind to a named scoring rule through an `apm_export` entry in its `evidence_basis`. A rule reads evidence that the service flow has already produced (intake fields, research data such as CVE, end-of-life, malware-scan and national advisory results, and `DATA` and `CRYPTO` signals from the service run) and returns a score from 0 to 100 on a health scale, where 100 means healthy or low concern.

- 47 of the 72 controls are bound to a rule, for example `APM-TCH-03` No open critical CVEs (`cve_critical_open`) or `APM-SEC-03` No hard-coded credentials (`hardcoded_credentials`).
- When a rule finds no evidence it returns no score. The control is then unknown and is excluded from its domain score; it is never defaulted to pass or fail.
- The remaining 25 controls name only a context source (for example `APM-VND-06` Vendor financial stability, `APM-SOV-04` Third-country transfer risk). They have no rule in this release and therefore stay unknown and excluded.

Domain scores roll up into a weighted risk score per application using `domain_weights`, and `time_rules` in `framework-meta.yaml` derive the TIME recommendation (overrides first, for example decommissioned applications or known exploited vulnerabilities). The exact scoring and TIME rules are described in [Framework and scoring](/service-assessment/framework).

## Control structure

The risk weights come from `domain_weights` in `framework-meta.yaml` and must sum to 100; `swao health-check` validates the sum. Edit them per engagement in a workspace copy.

| Domain | Controls | Bound to a scoring rule | Risk weight | Example controls |
|---|---|---|---|---|
| APM-STR: Strategic fit | 6 | 2 | 4 | `APM-STR-01` Analyst portfolio disposition recorded; `APM-STR-02` Migration intent declared |
| APM-VND: Vendor health | 8 | 5 | 12 | `APM-VND-01` Vendor identified; `APM-VND-02` Vendor support active |
| APM-TCH: Technical health | 9 | 8 | 20 | `APM-TCH-01` Operating system in support; `APM-TCH-02` Operating system end-of-life horizon |
| APM-SEC: Security posture | 10 | 6 | 18 | `APM-SEC-01` No weak cryptographic algorithms; `APM-SEC-02` Encrypted network endpoints |
| APM-DAT: Data governance | 8 | 6 | 10 | `APM-DAT-01` Data classification declared; `APM-DAT-02` Health data sensitivity |
| APM-SOV: Sovereignty readiness | 6 | 3 | 8 | `APM-SOV-01` Sovereign technology rating; `APM-SOV-02` Sovereign alternative exists |
| APM-BIZ: Business criticality | 6 | 4 | 4 | `APM-BIZ-01` Business criticality recorded; `APM-BIZ-02` User base |
| APM-HW: Hardware and cost | 4 | 3 | 4 | `APM-HW-01` Hardware profile recorded; `APM-HW-02` Right-sized memory |
| APM-INT: Integration complexity | 5 | 2 | 6 | `APM-INT-01` Integration count; `APM-INT-02` Integrations documented |
| APM-MIG: Migration readiness | 5 | 4 | 6 | `APM-MIG-01` Marked as migration candidate; `APM-MIG-02` Portable operating system |
| APM-REG: Compliance obligations | 5 | 4 | 8 | `APM-REG-01` Regulatory load; `APM-REG-02` GDPR Art. 9 scope |
| **Total** | **72** | **47** | **100** |  |

## How to enable

You normally do not enable SWAO_APM by hand. When the service intake creates the application folders, it writes the following block into each application's `.swao.yml`:

```yaml
assessment:
  type: service
  regimes_active: [SWAO_APM]
```

The service assessment loads the framework from the workspace copy at `wsp/inputs/catalogs/community/swao-apm/` if one exists, and otherwise from the copy bundled with SWAO. See the [Service Portfolio Assessment commands](/service-assessment/commands) and [configuration](/service-assessment/configuration).

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/swao-apm> (published at this location from v1.4.0)
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `swao-apm` into your workspace at `wsp/inputs/catalogs/community/swao-apm/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info SWAO_APM` prints the bundled metadata.

## Limitations and notes

- SWAO_APM results are decision support for portfolio planning. They are not an audit, a certification or legal advice.
- Scores are only as good as the intake, research and scan data behind them. Controls without evidence are excluded, so a domain score based on few controls deserves extra scrutiny.
- TIME recommendations are decision support for portfolio owners. They depend on the completeness of the intake data; review applications with many unknown controls before acting on their recommendation.
- Research data (CVE, end-of-life, advisories) reflects the time of collection. Re-run the research step before decisions.
