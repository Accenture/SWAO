# Hybrid Assessment

::: warning Coming soon
Hybrid Assessment is on the roadmap. The description below reflects the planned capability.
:::

Hybrid Assessment combines Application Assessment passes with Audit evidence to produce
the highest-fidelity compliance picture available. It merges LLM-derived signals from
source code analysis with consultant-authored findings from structured interviews and
document review, delivering a unified publication that satisfies both technical and
human-evidence requirements.

**Planned CLI:** `swao assess --type hybrid`

**TUI:** Main Menu > Run Assessment > [5] Hybrid Assessment (coming soon)

---

## When to use Hybrid Assessment

Use Hybrid Assessment when:

- The application has source code available **and** a consultant has conducted interviews
  or document review that adds evidence not visible from code alone.
- A regulatory submission requires both automated analysis evidence and human-attestation
  sign-off on the same set of controls.
- You want the highest possible rationale coverage rate (signals substantiated by both
  automated and human evidence carry stronger weight in an audit).

---

## How it will work

1. Run an **Application Assessment** to produce the source-derived signal set.
2. Run an **Audit Assessment** to produce the consultant-authored evidence set.
3. Run `swao assess --type hybrid` to merge both signal sets. SWAO resolves any
   conflicts between automated and human verdicts using a configurable precedence rule
   (by default, human attestation overrides automated findings when both cover the
   same control).
4. Generate the combined publication and BI export.

The merged output clearly attributes each signal to its source -- `source_code`, `context_doc`,
or `consultant_attestation` -- so auditors can distinguish the evidence types.
