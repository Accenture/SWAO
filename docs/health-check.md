# 2. Health Check

Run `swao health-check` (or select option 2 from the main menu) to verify that your workspace is ready for an assessment. All seven checks must be green before running.

## Checks

| Check | What it verifies |
|---|---|
| Licence | Edition detected and valid |
| Playwright | Browser engine ready for dynamic analysis |
| MCP | Model Context Protocol server configuration |
| Compliance catalogues | Framework YAML files present and parseable |
| Import templates | Context ingestion folder structure in place |
| Traceability | Audit-grade signal fields enabled |
| BI export bundle | Integrity of the last export (skipped on first run) |

## Interpreting results

- **Green** -- check passed; no action needed.
- **Yellow / warning** -- advisory; assessment can proceed but a non-critical component is missing.
- **Red / blocker** -- assessment will fail or produce incomplete output until resolved. The check output includes a remediation hint.

## CLI

```bash
swao health-check
swao health-check --verbose
```

See also: [Workspace Setup](/workspace-setup) | [Troubleshooting runbook](/runbooks/troubleshooting)
