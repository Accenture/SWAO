=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Run Assessment -- Overview

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Run Assessment

SWAO supports five assessment types. Each type targets a different surface and produces
a distinct set of artefacts. All types share the same workspace layout and write output
to the `wsp/` folder.

---

## Assessment types

| Type | Command | What it analyses |
|---|---|---|
| [Application](./application) | `swao assess --app <id>` | Application source code -- up to 14 analysis passes |
| [Landing Zone](./landing-zone) | `swao assess --type landing-zone-catalog --app <id>` | Cloud provider service catalogue against sovereignty controls |
| [LLM](./llm) | `swao assess --type llm --app <id>` | Multiple LLM providers benchmarked against sovereignty criteria side by side |
| [Audit](./audit) | `swao assess --type audit --app <id>` | Consultant-led checklist and evidence (in development) |
| [Hybrid](./hybrid) | `swao assess --type hybrid --app <id>` | Combined source analysis and consultant audit evidence (in development) |

---

## Choosing a type

- **Start with Application Assessment.** It is the foundation: static analysis, compliance
  mapping, migration synthesis, and dynamic crawl. All other types build on its outputs.
- **Add Landing Zone Assessment** when you need a cloud infrastructure fit/gap report.
  It can run standalone or inline alongside an Application Assessment.
- **Add LLM Assessment** when the engagement includes a sovereignty evaluation of the
  AI provider stack. It requires a completed Application Assessment and at least two
  LLM-Gateway connectors configured.
- **Audit and Hybrid** are in development. They will be available in a future release.

---

## Common flags

| Flag | Description |
|---|---|
| `--app <id>` | Application ID within the workspace (required for all single-app types) |
| `--type <type>` | Assessment type. Default: `application` |
| `--workspace <path>` | Portfolio workspace directory. Default: current working directory |
| `--passes <list>` | Comma-separated pass keys to run (Application type only) |
| `--no-crawl` | Skip dynamic analysis (Playwright) |

Run `swao assess --help` for the full option list.
