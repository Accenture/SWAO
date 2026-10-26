---
description: Which programming languages each SWAO Application Assessment pass analyses, deterministically, through the LLM or not at all.
---

# Supported languages

The [Application Assessment](/assessment/application) reads an application's source
code and build manifests. Not every pass understands every language: some checks are
written for a specific stack, others read any file. This page shows, per language,
how each pass that reads source files or manifests covers it, so you know before a run
which findings to expect and where the evidence will be thin.

The same matrix is part of every run. [Pass 01 (INV)](/passes/01-inv) counts the lines
of code per language in the application (signal `INV-90`), records the coverage of the
languages it found in `passes/01-inv.yaml` and raises `INV-91` when more than half of
the production code is in languages that no code-analysis pass reads deterministically.
The publication shows the result as the language coverage block.

## What the values mean

- **deterministic**: a rule-based check reads the language's source files or build
  manifests. The result is repeatable and every finding points at the file it came from.
- **LLM**: the pass puts the language's source files into the language-model prompt, but
  no rule-based check reads them. Today this applies to the data classification
  ([Pass 03 DATA](/passes/03-data)) only. The quality of the result depends on the model
  and on which files fit into the prompt.
- **none**: the pass does not read files of this language. Absence of a finding from this
  pass says nothing about code in that language.

Inventory (INV), code health (QUALITY) and the secret scan (SECRETS) do not count as
language-specific code analysis for the `INV-91` warning: the inventory only detects
manifests, code health measures quality rather than sovereignty, and the secret scan is
a pattern scan over every file (when Gitleaks is installed). Passes that reason over
signals and supplied documents rather than source code (CTX, COMP, SYNTH, BLOCKS) and
passes that read no source code (DYNAMIC, SCOPE) are not columns.

## Coverage by language and pass

The table is generated from the scan lists the passes use, so it always matches the
shipped code.

<!-- generated:language-coverage:start -->

| Language | Inventory (INV) | State (STATE) | Data (DATA) | Dependencies (SBOM) | Twelve-factor (TF) | Egress (EGR) | Cryptography (CRYPTO) | Code health (QUALITY) | Secrets (SECRETS) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C | none | none | none | none | none | none | none | deterministic | deterministic |
| C# | deterministic | none | deterministic | none | deterministic | none | deterministic | deterministic | deterministic |
| C++ | none | none | none | none | none | none | none | deterministic | deterministic |
| COBOL | none | none | none | none | none | none | none | none | deterministic |
| Dart | none | none | none | none | none | none | none | none | deterministic |
| F# | deterministic | none | none | none | none | none | none | none | deterministic |
| Go | deterministic | none | deterministic | none | none | none | deterministic | deterministic | deterministic |
| Groovy | deterministic | none | none | deterministic | none | deterministic | none | deterministic | deterministic |
| Java | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic |
| JavaScript | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic |
| Kotlin | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic |
| PHP | deterministic | none | none | none | none | none | none | deterministic | deterministic |
| PowerShell | none | none | none | none | none | none | none | deterministic | deterministic |
| Python | deterministic | none | deterministic | none | deterministic | none | deterministic | deterministic | deterministic |
| Ruby | deterministic | none | LLM | none | none | none | none | deterministic | deterministic |
| Rust | deterministic | none | deterministic | none | deterministic | none | none | deterministic | deterministic |
| Scala | deterministic | none | none | deterministic | none | deterministic | none | deterministic | deterministic |
| Shell | none | none | none | none | none | none | none | deterministic | deterministic |
| SQL | none | none | deterministic | none | none | none | none | deterministic | deterministic |
| Swift | none | none | none | none | none | none | none | deterministic | deterministic |
| TypeScript | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic | deterministic |
| VB.NET | deterministic | none | none | none | none | none | none | deterministic | deterministic |

<!-- generated:language-coverage:end -->

## Package ecosystems

The inventory recognises build manifests at any depth for the ecosystems below. The
software bill of materials ([Pass 05 SBOM](/passes/05-sbom)) looks up known
vulnerabilities in [OSV](https://osv.dev) for the ecosystems marked in the last column.

<!-- generated:package-ecosystems:start -->

| Package ecosystem | Languages | Build manifests read (INV) | Vulnerability lookup in OSV (SBOM) |
| --- | --- | --- | --- |
| crates.io | Rust | yes | no |
| Go | Go | yes | no |
| Maven | Groovy, Java, Kotlin, Scala | yes | yes |
| npm | JavaScript, TypeScript | yes | yes |
| NuGet | C#, F#, VB.NET | yes | no |
| Packagist | PHP | yes | no |
| PyPI | Python | yes | no |
| RubyGems | Ruby | yes | no |

<!-- generated:package-ecosystems:end -->

## Languages with little or no coverage

If the dominant language of your application shows mostly **none**, the assessment
still runs: the inventory, the census, the secret scan and every pass that works on your
supplied context (architecture documents, CMDB extracts, operational data) produce
results. Compensate for the missing code analysis by adding context documents to
`wsp/inputs/` and by reviewing the `INV-91` warning in the report. For applications
without accessible source code, use the
[Service Portfolio Assessment](/service-assessment/).

---

## Further reading

- [Application Assessment](/assessment/application) and the [pass reference](/passes/)
- [Pass 01 (INV): Inventory](/passes/01-inv), language census and coverage matrix
