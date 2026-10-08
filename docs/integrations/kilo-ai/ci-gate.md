# kilo.ai CI/CD Sovereignty Gate

Integrate the SWAO sovereignty gate into BA internal CI runners to block kilo.ai-generated
Terraform and IaC changes that introduce sovereignty violations.

See `swao/docs/runbooks/ci-cd-sovereignty-gate.md` for the full exit-code contract and
generic CI snippets.

---

## BA deployment context

BA uses on-premise kilo.ai with PREME DEV Qwen as the inference backend. CI runners are
Windows-based (PowerShell). The gate runs static and compliance passes only (`--skip-llm`)
for speed; full LLM assessment is run manually before major releases.

---

## Recommended gate configuration

```powershell
# ci-sovereignty-gate.ps1
# Run this step AFTER kilo.ai generates IaC, BEFORE Terraform plan/apply.

$APP_ID   = "platform"           # SWAO app ID for the platform workspace
$SWAO_EXE = ".\swao-enterprise-win-x64.exe"
$THRESHOLD = "severity=critical"

& $SWAO_EXE assess `
    --app $APP_ID `
    --passes static,compliance `
    --skip-llm `
    --fail-on $THRESHOLD

if ($LASTEXITCODE -ne 0) {
    Write-Error "Sovereignty gate FAILED (exit code $LASTEXITCODE)"
    Write-Error "Review wsp/runs/ for signal details before proceeding."
    exit 1
}

Write-Host "[ok] Sovereignty gate PASSED"
```

---

## Exit codes

| Code | Action |
|---|---|
| 0 | Continue to Terraform plan |
| 6 | Block: critical sovereignty signal matched |
| 4 | Block: LZ verdict SOVEREIGNTY_BLOCKED |
| 5 | Block: malware detected |
| 1 or 2 | Block: assessment error (fix config before retrying) |

---

## Fast-gate pass duration

With `--skip-llm --passes static,compliance`:

- Static pass: approximately 8s
- Compliance pass (EU_AI_ACT + BSI_GRUNDSCHUTZ_2023): approximately 5s
- Total gate time: approximately 15-20s per app

---

## Setting up the kilo.ai assessment workspace

Before using the gate, set up the SWAO kilo.ai workspace once:

1. Copy `swao/docs/integrations/kilo-ai/workspace/` into the BA SWAO workspace root.
2. Add kilo.ai's `package.json` and SBOM (`sbom.cdx.json` if available from kilo.ai releases)
   to `apps/kilo-ai/wsp/inputs/`.
3. Update `apps/kilo-ai/wsp/inputs/architecture-description.md` with actual PREME endpoint URLs.
4. Run `swao assess --app kilo-ai` once manually to verify the assessment completes.
5. Link the run ID from the first passing assessment in Design 107 as the formal attestation.

---

## Related

- `swao/docs/runbooks/ci-cd-sovereignty-gate.md` -- full runbook with GitHub Actions + GitLab snippets
- `swao/docs/integrations/kilo-ai/SWAO-Kilo-Install-Guide.md` -- kilo.ai setup and MCP integration
- Design 107, section 3.4: CI/CD gate specification
