# Analysis passes

An assessment in SWAO is a sequence of **passes**. Each pass answers one question about the application (what is it made of, which data does it hold, where does it send data, which controls does it satisfy), writes its result to `wsp/runs/<timestamp>/passes/<NN>-<key>.yaml`, and emits **signals**: small, evidence-backed findings with an ID (for example `INV-03` or `BIN-01`), a severity, and a derivation. Later passes build on earlier ones (see "Run order" below); the compliance pass rates framework controls using the signals of every pass that ran before it.

This page gives an overview. Every pass has its own detail page with purpose, inputs, measurement, third-party tools, outputs, and limitations.

## Pass types

| Type | Meaning |
|---|---|
| Deterministic | Rule-based analysis of files and configuration; same input, same result; no LLM |
| LLM-assisted | Uses the configured LLM provider for classification, rationale, or verdicts; skipped or reduced without an LLM |
| Dynamic | Drives a headless browser against the running application |
| External API | Queries public data sources over the internet |

## Overview

| Pass | Key | Type | Application | Service | What it answers | Third-party tools and services |
|---|---|---|---|---|---|---|
| [00 INGEST](/passes/00-ingest) | (pre-pass) | Deterministic | Always | Always | Which engagement files were supplied, and what text do they contain? | pdf-parse, mammoth, exceljs, adm-zip; Pulumi Cloud API (optional) |
| [01 INV](/passes/01-inv) | `inv` | Deterministic | Default | Skipped | What is the application made of: language, frameworks, database, runtime, backing services? | none (SWAO IaC parser) |
| [02 STATE](/passes/02-state) | `state` | Deterministic | Default | Skipped | Which components hold state, and where are single points of failure? | none |
| [03 DATA](/passes/03-data) | `data` | LLM-assisted (deterministic in service mode) | Default | If documents or data fields exist | Which personal and special-category data does it process, and which GDPR controls apply? | configured LLM provider |
| [04 CTX](/passes/04-ctx) | `ctx` | LLM-assisted | Default | Always | What do the engagement documents (CMDB exports, workshop notes, architecture papers) say, and where do they contradict each other? | configured LLM provider |
| [05 SBOM](/passes/05-sbom) | `sbom` | Deterministic plus online lookup | Default | If an SBOM is supplied | Which dependencies have known vulnerabilities, are unmaintained, or run on an end-of-life runtime? | OSV.dev API (optional) |
| [06 TF](/passes/06-tf) | `tf` | Deterministic | Default | Skipped | How cloud-ready is the application by twelve-factor criteria, and what does the IaC scan find? | Checkov or KICS (optional) |
| [07 EGR](/passes/07-egr) | `egr` | Deterministic | Default | Skipped | Where does the application send data, and which destinations block data residency? | none |
| [08 CRYPTO](/passes/08-crypto) | `crypto` | Deterministic | Default | If configuration or binaries exist | Which cryptographic primitives, token signing, and encryption at rest are used? | none |
| [09 SYNTH](/passes/09-synth) | `synth` | LLM-assisted plus deterministic | Default | Always | Which 7R migration strategy fits, how portable is the application, which landing zone matches? | configured LLM provider; SWAO cloud provider catalogue |
| [10 DYNAMIC](/passes/10-dynamic) | `dynamic` | Dynamic | Default (needs a crawl target) | If a portal crawl is configured | What does the running application do: external hosts, trackers, errors, login surface, cookie consent? | Playwright, Chromium; optional vision LLM |
| [11 COMP](/passes/11-comp) | `comp` | LLM-assisted | Default | Always | Which controls of the selected frameworks are satisfied, partial, a gap, not applicable, or unknown? | configured LLM provider; community frameworks |
| [12 BLOCKS](/passes/12-blocks) | `blocks` | LLM-assisted | Default | Always | How mature are the eight operational blocks (observability to disaster recovery)? | configured LLM provider |
| [13 SCOPE](/passes/13-scope) | `scope` | Deterministic | Default | Always | Which known blind spots does the evidence cover, and how complete is the assessment? | none |
| [14 MALWARE](/passes/14-malware) | `malware` | Deterministic, external tools | Opt-in | If binaries are supplied and requested | Does the source or binary contain secrets, vulnerable packages, or malware? | Gitleaks, OSV-Scanner, ClamAV, YARA, ORT (optional) |
| [23 LZR](/passes/23-lzr) | `--lzr` | Deterministic | With `--lzr` | Not used | Is the target landing zone ready, judged from Terraform state or a JSON plan? | none |
| [24 RESEARCH](/passes/24-research) | `swao service research` | External API | Not used | Separate command | What do public sources report: CVEs, known exploits, advisories, end of life, malware verdicts? | NVD, CISA KEV, BSI CERT-Bund, OSV.dev, endoflife.date, VirusTotal (optional key) |
| [25 BINARY](/passes/25-binary) | (automatic) | Deterministic, offline | Not used | When installers are supplied | Are the supplied installers signed, with valid certificates, current runtimes, and modern architecture? | none (SWAO parsers) |

"Default" means the pass is in the default `--passes` list of `swao assess` (13 passes); "Opt-in" passes run only when requested. Dynamic analysis needs a configured crawl target and does nothing useful without one. Numbers 15 to 22 are not passes of their own: they were the former numbers of the eight blocks that Pass 12 now evaluates together.

## Run order

The pass numbers are identifiers, not the execution order. `swao assess` always runs the selected passes in one fixed sequence, whatever order you give in `--passes` or in a lens:

1. Pass 00 INGEST (before the pass loop)
2. `inv`, `state`, `data`, `ctx`, `sbom`, `tf`, `egr`, `crypto` (Passes 01 to 08)
3. `dynamic` (Pass 10), `scope` (Pass 13), `malware` (Pass 14, only when requested)
4. Pass 23 LZR (only with `--lzr <landingZoneId>`)
5. `comp` (Pass 11)
6. `synth` (Pass 09)
7. `blocks` (Pass 12)

The order follows what each pass reads from the current run:

- Pass 11 COMP sees the signals of the static passes and of DYNAMIC, SCOPE, MALWARE and LZR from the same run. It does not see SYNTH or BLOCKS.
- Pass 09 SYNTH runs after COMP, so its 7R verdict takes compliance gaps into account, and it reads the Pass 23 verdict of the same run.
- Pass 12 BLOCKS runs last, so its prompt contains the 7R label, coverage score and rationale that SYNTH wrote in the same run.

For Service Portfolio Assessment, Pass 25 BINARY runs first, before Pass 00 and the pass loop.

## Choosing passes

```bash
swao assess --app <id>                         # default pass list
swao assess --app <id> --passes inv,sbom,comp  # a subset
swao assess --app <id> --skip-llm              # no LLM call; without ctx, comp, blocks
swao assess --app <id> --lzr <landing-zone-id> # add Pass 23 LZR
```

With `--skip-llm` SWAO makes no LLM call at all: `ctx`, `comp` and `blocks` are removed, `data` and `synth` stay in the run and record a `DATA-00` or `SYNTH-00` skip marker (the deterministic service variant of `data` runs normally), and the vision step of Pass 10 is off. The aliases `dyn` and `mal` are accepted for `dynamic` and `malware`. The name `lzr` selects no `--passes` entry: Pass 23 runs only with `--lzr <landingZoneId>`.

In the terminal interface the pass profile is chosen per app before the run; dynamic analysis and malware scanning are never pre-selected. For Service Portfolio Assessment the pass plan is fixed by the service profile (see the "Service" column) and recorded as UNKNOWN, not as failure, for skipped passes.

## Where to go next

- [Run an assessment](/assessment/)
- [Community frameworks](/frameworks/) evaluated by Pass 11
- [Health check](/health-check) for the optional external tools (Playwright, Gitleaks, OSV-Scanner, ClamAV, YARA, Checkov, KICS)
