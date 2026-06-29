# LLM Assessment

::: warning Coming soon
LLM Assessment is on the roadmap (milestone #0045). The description below reflects the
planned capability based on the current design specification.
:::

LLM Assessment evaluates large language models as the subject of a sovereignty assessment,
rather than using them as analysis tools. It connects to multiple LLM providers
simultaneously and benchmarks each against the `SWAO_LLM_ASSESS` community framework,
producing a side-by-side comparison to support model selection decisions for sovereign
workloads.

**Planned CLI:** `swao assess --type llm`

**TUI:** Main Menu > Run Assessment > [4] LLM Assessment (coming soon)

---

## Why it matters

Before deploying any AI application to a sovereign environment, organisations must
evaluate whether their chosen LLM meets the jurisdiction's requirements for data
residency, transparency, safety, and regulatory compliance. Today this relies on vendor
claims and informal testing. LLM Assessment makes it structured, repeatable, and
auditor-defensible.

---

## What it assesses

The `SWAO_LLM_ASSESS` framework covers seven domains:

| Domain | What it evaluates |
|---|---|
| Data sovereignty and residency | Contractual data residency guarantees, zero-retention endpoints, EU hosting options, GDPR DPA compliance |
| Model transparency | Published model card, EU AI Act conformity assessment, per-call audit metadata, licensing terms |
| Performance and reliability | Latency, hallucination rate, context window, token throughput, cost |
| Cultural and language fit | Target-language fluency, domain vocabulary accuracy, regulatory body awareness |
| Safety and bias | BOLD/WinoBias benchmarks, red-team disclosure, EU AI Act prohibited-use test, prompt injection resistance, jailbreak resilience |
| Agentic capabilities | Tool calling reliability, multi-step orchestration, RAG grounding fidelity, memory coherence, structured output compliance |
| People and team readiness | LLM engineering skills, data management, AI governance roles, continuous learning commitment |

---

## What it produces

| Output | What it contains |
|---|---|
| Sovereignty Readiness Score (SRS) | A 0-100 score per model, weighted by domain |
| Side-by-side comparison table | Each framework control with RAG status (pass/partial/fail) for every assessed model |
| Regulatory fit summary | Which GDPR-linked controls pass for each model |
| Benchmark report | Latency, throughput, cost estimates, and grounding test results |

---

## Configuration

LLM Assessment is configured in `.swao.yml` under the `llm_assessment:` block, where you
specify which models to assess, thresholds, target locale, and budget ceiling. API keys
are read from environment variables -- never stored in the configuration file.
