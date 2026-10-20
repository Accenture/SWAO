# Migration wave generator

After every `swao service research` run, SWAO turns the TIME recommendations into a five-wave migration roadmap. Each service app lands in exactly one wave. The roadmap appears in `wsp/reports/migration-waves-YYYYMMDD.md` (and `.csv`), in `wsp/portfolio-summary.json`, on the engagement hub (Migration Roadmap block), and in the Migration Waves sheet of the Enterprise workbook (`swao service export`).

## The five waves

| Wave | Label | Horizon | Who goes here |
|---|---|---|---|
| 1 | Eliminate | Now | Apps classified Eliminate: retire, decommission, or switch off |
| 2 | Migrate: Critical | Next 3 months | Migrate-Critical apps, plus Migrate apps whose end of life has passed or that hold health data or GDPR Art. 9 data |
| 3 | Migrate: Standard | 3 to 12 months | All other Migrate apps |
| 4 | Invest | 12 to 24 months | Apps classified Invest |
| 5 | Tolerate | Monitor | Apps classified Tolerate; no effort planned |

The TIME quadrant decides the wave; see the [TIME rules](/service-assessment/framework#time-classification). Wave 2 deliberately pulls sensitive Migrate apps forward: an application past end of life or processing special-category data should not wait in the standard queue.

## Order within a wave: blast radius

Moving a system that many others depend on is riskier than moving a leaf system. SWAO therefore builds an integration graph from the `integrations` field of every app (cluster members are mapped to their cluster) and computes for each app:

- **Fan-in**: how many portfolio apps depend on it.
- **Blast radius score**: `fan-in x 10` + a TIME weight (Migrate or Migrate-Critical 5, Invest 3, Tolerate 1, Eliminate 0) + an end-of-life bonus (past end of life 20, within 18 months 10).
- **Blast radius tier**: HIGH from 30, MEDIUM from 10, otherwise LOW.

Inside waves 2 to 5, apps are ordered by fan-in, lowest first: integration hubs move **last** in their wave, after the systems that call them have been prepared. Inside wave 1, apps are ordered by blast radius score, lowest first, so the harmless retirements happen first.

SWAO warns when the order creates a conflict:

- An app is eliminated in wave 1 although another app depends on it: reconfigure the dependent first.
- A HIGH blast-radius app is scheduled in an earlier wave than an app that depends on it: confirm the dependent is ready.

References to IDs that are not in the portfolio are kept as dangling references in the integration graph for analyst review.

## Effort estimate

Each app in waves 1 to 4 carries a rough order-of-magnitude effort in days, summed per wave:

| App | Days |
|---|---|
| VDI cluster (`INFRA_WORKPLACE_VDI`, consolidated cluster) | 2 |
| Healthcare system with an MDR classification | 15 |
| Platform category (operating systems, standalone databases) | 5 |
| Everything else | 3 |

Wave 5 (Tolerate) carries no effort. The figures are planning anchors for a first roadmap, not a project estimate.

## Example

A fictional portfolio of ten apps produces this plan:

| Wave | Apps in order | Effort (days) |
|---|---|---|
| 1 Eliminate | `app-old-02`, `app-old-01` | 6 |
| 2 Migrate: Critical | `app-pacs-01` (KEV match), `app-lab-03` (health data), `app-print-07` (past end of life) | 9 |
| 3 Migrate: Standard | `app-crm-04`, `app-int-hub` (fan-in 4, HIGH blast radius, last) | 6 |
| 4 Invest | `app-portal-05` | 3 |
| 5 Tolerate | `app-wiki-08`, `app-mail-09` | 0 |

Warning raised for this plan: `app-old-01 is eliminated in wave 1 but app-crm-04 depends on it; reconfigure app-crm-04 before decommissioning`.

## Where to see it

- **Report**: `wsp/reports/migration-waves-YYYYMMDD.md` with a summary table per wave and a CSV for spreadsheets
- **Engagement hub**: the Migration Roadmap, Integration Hubs, and Vendor Landscape blocks appear on `apps/engagement-hub.html` when the workspace has service apps
- **Enterprise workbook**: the Migration Waves and Migration Candidates sheets of `swao-portfolio-YYYYMMDD.xlsx` (see [Command reference](/service-assessment/commands#swao-service-export-enterprise))
- **Delta tracking**: wave changes between runs show up in `wsp/reports/portfolio-delta-YYYYMMDD.md` as TIME, end-of-life, and risk changes

Apps without a service assessment run keep their wave, but every view marks them as not assessed, because their wave rests on intake and research data only: the `Assessment` column of the Markdown report, the last CSV column `evidence` (`not_assessed`), a "Not assessed" badge in the Migration Roadmap, Integration Hubs and Vendor Landscape blocks, and the `Evidence` column of the workbook sheets (`evidence` in the star schema).
