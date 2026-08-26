=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Audit Assessment

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Audit Assessment

Audit Assessment is a consultant-led assessment type. It combines structured checklists,
document review, on-site findings, and a deterministic compliance verdict -- without
requiring access to application source code.

This page is a placeholder. Audit Assessment is in development and will be documented
fully when the feature ships.

---

## What it will cover

- Structured checklist workflow with evidence upload
- Document review integration (attach meeting notes, architecture diagrams, DPA extracts)
- Deterministic compliance verdict derived from manual findings
- Merge path into Hybrid Assessment for source-plus-audit combined reports
- No LLM required -- suitable for air-gapped and offline engagements

---

## Current status

Audit Assessment is not yet available. The assessment engine prints a notice when
invoked with `--type audit`.

For consultant-led evidence collection today, use the context ingestion pass of an
[Application Assessment](./application). Place structured documents
(meeting notes, architecture records, workshop outputs) in `wsp/inputs/ingestion/`
and they will be read by Pass 4 (context ingestion) during the next run.

---

## Planned command

```bash
swao assess --type audit --app my-app
```

Watch the [GitHub releases](https://github.com/Accenture/SWAO/releases) and
[community discussions](https://github.com/Accenture/SWAO/discussions) for updates.
