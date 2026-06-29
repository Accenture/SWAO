# Run Assessment

SWAO supports five assessment types, each targeting a different subject. Two are available
today; three are on the roadmap.

Access from the TUI main menu by pressing **3**, then select the assessment type.

![SWAO assessment type selection](/samples/13-tui-run-assessment.png)

| # | Assessment type | Status | Subject |
|---|---|---|---|
| [1] | [Application Assessment](/en/assessment/application) | Available | Cloud application source code |
| [2] | [Audit Assessment](/en/assessment/audit) | Coming soon | Human-led compliance audit |
| [3] | [Landing Zone Assessment](/en/assessment/landing-zone) | Available | Cloud infrastructure configuration |
| [4] | [LLM Assessment](/en/assessment/llm) | Coming soon | AI model sovereignty benchmarking |
| [5] | [Hybrid Assessment](/en/assessment/hybrid) | Coming soon | Combined source + human evidence |

---

## How assessment works

Every assessment type shares the same pipeline:

1. **Input reading** -- SWAO reads your application source, configuration files, and any
   context documents you have placed in the ingestion folder.
2. **Pass execution** -- a sequence of analysis passes runs against the input. Some passes
   use static analysis (deterministic, no LLM required); others invoke your configured LLM
   to derive findings that require language understanding.
3. **Signal emission** -- each pass emits signals: structured findings with a signal ID,
   severity, compliance control mapping, rationale text, and evidence references.
4. **Output generation** -- signals are aggregated into the Workspace Signal Pack (WSP),
   from which SWAO generates reports, the BI export bundle, and the HTML publication.

All outputs are stored in `apps/<app-id>/wsp/` and can be regenerated at any time from
the same signal set without re-running the assessment.

---

## After assessment

Once assessment completes, use the other TUI menu items to turn results into deliverables:

- **[4] Generate Report** -- text and Markdown audit report
- **[5] Publish HTML** -- self-contained HTML publication for the client
- **[6] Export BI** -- star schema bundle for Power BI or Tableau
