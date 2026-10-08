# CI/CD Sovereignty Gate

Block deployments that introduce sovereignty violations by running SWAO as a pipeline step
and failing the build on critical findings. This runbook covers the exit-code contract,
the `--fail-on` flag, and integration patterns for common CI systems.

---

## Exit-code contract

| Exit code | Meaning | Gate action |
|---|---|---|
| `0` | Assessment completed; no findings matched `--fail-on` condition | Pass |
| `1` | General runtime error (unhandled exception, unexpected state) | Fail (conservative) |
| `2` | Configuration or lock error (invalid `.swao.yml`, missing app ID, workspace locked) | Fail (conservative) |
| `4` | LZ sovereignty gate blocked (SOVEREIGNTY_BLOCKED verdict) | Fail |
| `5` | Malware or forbidden binary detected in source | Fail |
| `6` | `--fail-on` condition matched (one or more signals met the threshold) | Fail |

Always treat non-zero as a gate failure. Exit code `2` indicates a configuration problem
that must be fixed before the assessment can run at all.

---

## `--fail-on` flag

```
swao assess --app <id> --fail-on severity=<level>
```

After all passes complete, SWAO checks accumulated signals against the condition. If any
signal matches, it prints the matching signal IDs and exits with code `6`.

Supported conditions:

| Condition | Example | Meaning |
|---|---|---|
| `severity=<level>` | `severity=critical` | Exit 6 if any signal has this severity |

Severity levels (low to high): `informational`, `low`, `medium`, `high`, `critical`.

The check runs after the malware gate (exit 5). If `--fail-on` matches, exit 6 takes
precedence over a clean exit 0.

---

## `--skip-llm` flag

Use `--skip-llm` for fast CI runs (static passes only, approximately 30s). This disables
the LLM assessment leg, which requires a configured LLM gateway and can take 15-60 minutes.

```
swao assess --app platform --passes static,compliance --skip-llm --fail-on severity=critical
```

---

## GitHub Actions workflow

```yaml
# .github/workflows/swao-gate.yml
name: SWAO Sovereignty Gate

on:
  pull_request:
    branches: [main]

jobs:
  sovereignty-gate:
    name: Sovereignty Assessment
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download SWAO binary
        env:
          GH_TOKEN: ${{ secrets.SWAO_RELEASE_TOKEN }}
        run: |
          VERSION=v1.3.0
          gh release download $VERSION \
            --repo Accenture/SWAO \
            --pattern "swao-enterprise-linux-x64" \
            --output swao
          chmod +x swao

      - name: Run sovereignty gate
        run: |
          ./swao assess \
            --app ${{ env.APP_ID }} \
            --passes static,compliance \
            --skip-llm \
            --fail-on severity=critical
        env:
          APP_ID: my-app

      - name: Upload SWAO run artefacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: swao-run-${{ github.sha }}
          path: wsp/runs/
          retention-days: 30
```

---

## GitLab CI snippet

```yaml
# .gitlab-ci.yml
swao-gate:
  stage: test
  image: ubuntu:24.04
  before_script:
    - apt-get update -qq && apt-get install -y -qq gh
    - |
      gh release download v1.3.0 \
        --repo Accenture/SWAO \
        --pattern "swao-enterprise-linux-x64" \
        --output swao
    - chmod +x swao
  script:
    - ./swao assess --app $APP_ID --passes static,compliance --skip-llm --fail-on severity=critical
  artifacts:
    when: always
    paths:
      - wsp/runs/
    expire_in: 30 days
  variables:
    APP_ID: my-app
```

---

## BA internal runner (PowerShell, Windows)

```powershell
# Run before kilo.ai generates new Terraform
kilo --auto --task "update terraform for eu-central-1 migration"

# Gate: block if any critical sovereignty signal
.\swao-enterprise-win-x64.exe assess `
    --app platform `
    --passes static,compliance `
    --skip-llm `
    --fail-on severity=critical

if ($LASTEXITCODE -ne 0) {
    Write-Error "Sovereignty gate FAILED (exit $LASTEXITCODE)"
    exit 1
}
Write-Host "Sovereignty gate PASSED"
```

Note: Always check `$LASTEXITCODE` explicitly. SWAO can print `[error]` to stdout but
still exit 0 for non-fatal warnings. Only the exit code is authoritative.

---

## Related

- `swao/docs/runbooks/cicd-pipeline.md` -- general CI pipeline integration
- `swao/docs/integrations/kilo-ai/ci-gate.md` -- BA-specific kilo.ai gate configuration
- Memory: `feedback-swao-error-exit-zero.md` -- SWAO [error] exits zero; always check $LASTEXITCODE
