# SWAO Examples

Reference material showing what SWAO produces and how to operate it.

| Folder | What it is |
|---|---|
| `publications/` | HTML publication files generated from the Sovereign Health reference workspace -- one for each assessment type (Application, Landing Zone, LLM) plus the Engagement Hub. Open directly in a browser; no server needed. |
| `batch-samples/` | Ready-to-edit scripts for the common operator workflow: assess N apps then emit the portfolio BI bundle in one run. Windows (`.cmd`) and POSIX (`.sh`) variants. Copy into your workspace and edit the three variables at the top. |
| `helm/` | Helm chart for running SWAO as a Kubernetes batch job. Mount your portfolio workspace as a volume and pass credentials via Helm values. Useful for CI/CD and scheduled assessments in a cluster. |

More samples will be added in upcoming releases covering additional assessment types,
provider integrations, and deployment patterns.
