=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Hybrid Assessment

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Hybrid Assessment

Hybrid Assessment combines the source-derived signals of an Application Assessment
with the consultant-gathered evidence of an Audit Assessment. The merged result
produces the highest-fidelity compliance picture available in SWAO -- every control
is backed by both automated analysis and human-verified evidence.

This page is a placeholder. Hybrid Assessment is in development and will be documented
fully when the feature ships.

---

## What it will cover

- Combined pipeline: Application Assessment passes plus Audit evidence
- Signal merging strategy: source-derived signals take precedence; audit evidence fills gaps
- Unified HTML publication with combined evidence gallery
- Full traceability: every merged signal carries both automated and manual provenance
- Compliance verdict reflects the combined evidence set

---

## Current status

Hybrid Assessment is not yet available. The assessment engine prints a notice when
invoked with `--type hybrid`.

For combined coverage today, run an Application Assessment and supplement the context
ingestion pass (Pass 4) with structured documents in `wsp/inputs/ingestion/`. The
context pass fuses operational context with code analysis, which approximates the
hybrid evidence model.

---

## Planned command

```bash
swao assess --type hybrid --app my-app
```

Watch the [GitHub releases](https://github.com/Accenture/SWAO/releases) and
[community discussions](https://github.com/Accenture/SWAO/discussions) for updates.
