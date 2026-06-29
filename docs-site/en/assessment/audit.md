# Audit Assessment

::: warning Coming soon
Audit Assessment is on the roadmap. The description below reflects the planned capability.
:::

Audit Assessment supports consultant-led compliance reviews where no application source
code is available. A consultant records findings from interviews, document review, and
on-site inspection using structured checklists. SWAO produces a deterministic compliance
verdict without any LLM processing.

**Planned CLI:** `swao audit init` / `swao assess --type audit`

**TUI:** Main Menu > Run Assessment > [2] Audit Assessment (coming soon)

---

## What it will produce

| Output | What it contains |
|---|---|
| Compliance verdict | Each framework control: SATISFIED / GAP / PARTIAL / NOT ASSESSED |
| Evidence log | Documents, interview notes, and on-site findings attributed per control |
| Auditor report | Full Markdown report suitable for regulatory submission |

---

## How it will work

1. **Initialise** -- `swao audit init` creates the checklist structure in `wsp/inputs/audit/`
   based on the active compliance frameworks.
2. **Fill in checklists** -- the consultant records findings directly in the YAML checklist
   files or via a guided TUI form.
3. **Attach evidence** -- PDFs, DOCXs, and screenshots are placed in `wsp/inputs/audit/evidence/`
   and referenced in the checklist entries.
4. **Run** -- `swao assess --type audit` reads the completed checklists and evidence,
   evaluates each control deterministically, and generates the output package.

No LLM is required -- this is a fully offline, deterministic assessment path designed for
highly regulated environments where LLM usage is restricted.
