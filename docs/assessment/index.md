# Run Assessment

SWAO supports three assessment types. Each type targets a different surface and produces
a distinct set of artefacts. All types share the same workspace layout and write output
to the `wsp/` folder.

---

## Assessment types

| Type | Command | What it analyses |
|---|---|---|
| [Application](./application) | `swao assess --app <id>` | Application source code -- up to 14 analysis passes |
| [Landing Zone](./landing-zone) | `swao assess --type landing-zone-catalog --app <id>` | Cloud provider service catalogue against sovereignty controls |
| [LLM](./llm) | `swao assess --type llm --app <id>` | Multiple LLM providers benchmarked against sovereignty criteria side by side |

---

## Choosing a type

- **Start with Application Assessment.** It is the foundation: static analysis, compliance
  mapping, migration synthesis, and dynamic crawl. All other types build on its outputs.
- **Add Landing Zone Assessment** when you need a cloud infrastructure fit/gap report.
  It can run standalone or inline alongside an Application Assessment.
- **Add LLM Assessment** when the engagement includes a sovereignty evaluation of the
  AI provider stack. It requires a completed Application Assessment and at least two
  LLM-Gateway connectors configured.

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
