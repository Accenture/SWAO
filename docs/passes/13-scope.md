# Pass 13: Scope Coverage (SCOPE)

| Property | Value |
|---|---|
| Pass number | 13 |
| Key (`--passes`) | `scope` |
| Signal prefix | `SCOPE` |
| Type | Deterministic (rule engine, no LLM, no network) |
| Default | On (part of the default `--passes` list) |
| Assessment types | `application`, `service` (always runs in the service profile) |
| Tier | All tiers (no licence gate) |
| Source | `packages/@swao/module-app-assessment/src/passes/pass-13-scope.ts`, catalogue `controls/blind-spots-catalogue.yaml` |

## What it is for

Every assessment has blind spots: areas that cannot be judged from source code alone, such as network policies, SIEM rules or data processing agreements. Pass 13 answers the question: "Which of these known blind spots are covered by the evidence we supplied, and which remain out of scope?"

It makes the limits of the assessment explicit, so that a report reader can see what was assessed and what still needs input. It also tells you exactly which folder to fill to close each gap.

## What you need to provide

Nothing is mandatory. To close blind spots, place evidence files in the app's `wsp/inputs/` folders listed below. A path counts as provided when it is a non-empty file, or a folder that contains at least one non-empty file or a subfolder (hidden entries starting with `.` are ignored). Empty files and empty folders do not count, so creating a folder by accident does not close a gap.

## How it works

1. Load the blind-spots catalogue (`controls/blind-spots-catalogue.yaml`, version 1.0.0, 10 entries).
2. For each entry, check its input paths relative to `apps/<app>/`.
3. Decide the coverage:
   - **closed** if any input path is provided, or if the catalogue states that SWAO covers the area fully;
   - **partial** if no input is provided and the catalogue states that SWAO covers part of it natively;
   - **open** otherwise.
4. Emit one `SCOPE-NN` signal per entry and a `scope_coverage` block with totals and a coverage ratio.

## How it is measured

### The blind-spots catalogue

| # | Catalogue ID | Blind spot | Default severity | Native coverage | Input paths that close it | Related frameworks |
|---|---|---|---|---|---|---|
| 1 | `BS_NETWORK_POLICY` | Kubernetes / mesh network policy | high | none | `wsp/inputs/network-policies`, `wsp/inputs/platform` | BSI_C5, ISO_27001, SOC_2 |
| 2 | `BS_RUNTIME_SECRETS` | Runtime secret injection | high | partial | `wsp/inputs/secrets-strategy.md`, `wsp/inputs/secrets` | GDPR, HIPAA, PCI_DSS, BSI_C5 |
| 3 | `BS_CLOUD_FIREWALL` | Cloud-provider firewall and security groups | high | partial | `wsp/inputs/terraform` | BSI_C5, ISO_27001, SOC_2, DORA |
| 4 | `BS_SERVICE_MESH_MTLS` | Service-mesh mTLS enforcement | medium | none | `wsp/inputs/service-mesh`, `wsp/inputs/pen-test` | GDPR, HIPAA, BSI_C5 |
| 5 | `BS_SIEM_DETECTION` | SIEM / EDR detection rules | medium | none | `wsp/inputs/soc-runbook.md`, `wsp/inputs/soc` | ISO_27001, SOC_2, DORA, BSI_C5 |
| 6 | `BS_WAF_API_GATEWAY` | WAF / API gateway controls | medium | none | `wsp/inputs/edge-controls.md`, `wsp/inputs/waf`, `wsp/inputs/api-gateway` | PCI_DSS, GDPR |
| 7 | `BS_CLOUD_IAM` | Cloud IAM beyond IaC stubs | high | partial | `wsp/inputs/iam` | ISO_27001, SOC_2, BSI_C5 |
| 8 | `BS_OPERATIONAL_RUNBOOK` | Operational runbooks and manual controls | medium | none | `wsp/inputs/runbooks`, `wsp/inputs/policies`, `wsp/inputs/ops` | SOC_2, ISO_27001, DORA |
| 9 | `BS_GRANTED_EXCEPTIONS` | Documented security exceptions | low | none | `wsp/inputs/exception-register.csv`, `wsp/inputs/exceptions` | all |
| 10 | `BS_DATA_PROCESSING_AGREEMENTS` | Sub-processor and data-processing agreements | high | none | `wsp/inputs/data-processing-agreements`, `wsp/inputs/legal` | GDPR, BSI_C5 |

### Signals

`SCOPE-01` to `SCOPE-10` follow the catalogue order above. The link back to the catalogue entry is carried in the signal's `implies` field as `blind_spot_<coverage>:<catalogue ID>`.

| Coverage | Severity | Outcome | Evidence |
|---|---|---|---|
| closed | positive | positive | The input path that closed the blind spot |
| partial | medium | indeterminate | - |
| open | The entry's default severity (high, medium or low) | indeterminate | - |

Entries in the categories `process`, `governance` and `contractual` are reported under the signal category `business_processes`; all others under `infrastructure_platform`.

If the catalogue cannot be loaded, the pass emits a single informational signal `SCOPE-99` and an empty coverage block.

### Coverage ratio

```text
coverage_ratio = (closed + 0.5 x partial) / total
```

The ratio is rounded to four decimal places and is 0 when the catalogue is empty. With no inputs at all, three entries are partial and seven are open, which gives a ratio of 0.15.

## Third-party modules, tools and external services

| Name | Purpose | Licence | Bundled or optional | When missing or offline |
|---|---|---|---|---|
| Blind-spots catalogue | Defines the 10 blind spots | SWAO | Bundled | `SCOPE-99` signal, empty coverage block |
| `js-yaml`, `zod` | Parse and validate the catalogue | MIT | Bundled | - |

No external tools or network services are used.

## Outputs

| File | Content |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/13-scope.yaml` | Pass header, `SCOPE-NN` signals and `assessment.scope_coverage` |
| `wsp-plan.yaml` (via plan derivation) | `scope_coverage` as a top-level block for the auditor view and the health check |

For service assessments SWAO additionally writes `scope-coverage.json` into the run directory, listing which passes ran, which were skipped and why.

## Configuration and limitations

| Setting | Effect |
|---|---|
| `--passes` without `scope` | Skips the pass |
| Files in the input paths above | Close the corresponding blind spots |

Known limitations:

- The pass checks only that evidence exists, not what it says. A one-line file closes a blind spot just as well as a complete document. The content is assessed by Pass 04 CTX and Pass 11 COMP.
- The catalogue is fixed in this build and cannot be extended per workspace.
- In a lens or pass profile, the shorthand `lzr` does not select this pass; it refers to [Pass 23 LZR](/passes/23-lzr), which runs only with `--lzr <landingZoneId>`.

See also [Workspace setup](/workspace-setup) and [Health check](/health-check).
