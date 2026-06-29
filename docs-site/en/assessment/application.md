# Application Assessment

Application Assessment is SWAO's core capability. It analyses a cloud application from its
source code, configuration files, and operational context documents, then produces a
comprehensive set of compliance signals, a migration readiness verdict, and a full
publication package.

**CLI:** `swao assess --app <app-id>`

**TUI:** Main Menu > Run Assessment > [1] Application Assessment

---

## What it produces

After a complete assessment run you receive:

| Output | Where to find it | What it contains |
|---|---|---|
| Signals | `apps/<id>/wsp/signals/` | Every finding with ID, severity, control mapping, rationale, and evidence |
| Auditor report | `apps/<id>/wsp/auditor.md` | Full signal list in Markdown -- printable, emailable |
| BI export bundle | `apps/<id>/wsp/exports/` | 17-table star schema (CSV + NDJSON + XLSX) for Power BI or Tableau |
| HTML publication | `apps/<id>/wsp/publications/` | Self-contained HTML file with search, persona views, and evidence gallery |

---

## Analysis passes

SWAO runs up to 14 analysis passes, each targeting a specific aspect of the application.
Passes that do not require an LLM are always included; LLM-dependent passes require a
configured provider.

| Pass | What it analyses | LLM? |
|---|---|---|
| Inventory | File types, tech stack, dependency manifest detection | No |
| State analysis | Runtime configuration, environment variables, secrets hygiene | No |
| Data classification | PII and sensitive data fields in schemas and source code | No |
| Context ingestion | Documents you place in `apps/<id>/ingestion/` (CMDB, architecture reviews, transcripts) | Yes |
| Compliance evaluation | Source code against active framework controls (GDPR, BSI C5, etc.) | Yes |
| SBOM | Software Bill of Materials from dependency manifests | No |
| Cryptography | Cipher suite usage, certificate management, key handling | No |
| 7R synthesis | Migration strategy recommendation (Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Replace) | Yes |
| Landing zone readiness | Sovereign cloud target compatibility check | No |
| Risk register | Derived risk entries from signal aggregation | No |

Passes that cannot run (missing source, missing credentials, LLM not configured) are skipped
gracefully -- SWAO reports which passes ran and which were skipped at the end of each run.

---

## Compliance frameworks

Assessment evaluates signals against whichever frameworks are active in your workspace.
You can install and activate frameworks with:

```
swao framework list
swao framework install <id>
```

Nine community frameworks are available out of the box: GDPR, AI 10 Pillars, COBIT 5,
NIST SP 800-66 R2, ISO 27001, PCI DSS, SOC 2, BSI C5, DORA.
Custom frameworks (your own YAML) are also supported in all editions.

---

## Context ingestion

Place supporting documents in `apps/<app-id>/ingestion/` before running assessment to
give SWAO operational context that is not visible from source code alone:

- Architecture diagrams (PDF, DOCX, MD)
- CMDB / ServiceNow exports (CSV, XLSX, JSON)
- Workshop transcripts or interview notes (DOCX, MD, TXT)
- Terraform or IaC state files
- Existing audit findings or risk registers

SWAO reads these during the Context Ingestion pass and fuses the findings with
source-derived signals. Evidence extracted from context documents is attributed separately
in the output so auditors can trace every finding to its source.

---

## Running time

A complete run against a medium-sized application (50 000 lines, 3 LLM passes) typically
takes 3 to 8 minutes depending on the LLM provider's response time. Subsequent runs that
use cached results for unchanged files are significantly faster.
