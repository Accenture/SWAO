=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: CI/CD Pipeline Integration

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# CI/CD Pipeline Integration

Integrate SWAO assessments into your GitHub Actions workflow to gate pull requests and release branches on sovereign-readiness findings. This runbook provides a complete workflow example, caching guidance, and notes on exit codes and artefact handling.

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Assessment completed; no blocker-severity findings |
| `1` | Blocker-severity findings detected (or run failed) |
| `2` | Configuration error (invalid `.swao.yml`, missing app ID) |

Use exit code `0` as the gate condition in your pipeline. Exit code `1` should fail the build; code `2` indicates a configuration problem that must be fixed before the assessment can run.

---

## 1. Complete GitHub Actions workflow

::: v-pre
```yaml
# .github/workflows/swao-assess.yml
name: SWAO Assessment

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  assess:
    name: Sovereign Readiness Assessment
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Restore SWAO binary cache
        id: cache-swao
        uses: actions/cache@v4
        with:
          path: ~/.local/bin/swao
          key: swao-${{ env.SWAO_VERSION }}

      - name: Download SWAO binary
        if: steps.cache-swao.outputs.cache-hit != 'true'
        env:
          SWAO_VERSION: "0.5.1"
        run: |
          mkdir -p ~/.local/bin
          curl -Lo ~/.local/bin/swao \
            "https://github.com/Accenture/SWAO/releases/download/v${SWAO_VERSION}/swao-linux-x64"
          chmod +x ~/.local/bin/swao
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"

      - name: Add SWAO to PATH (cache hit)
        if: steps.cache-swao.outputs.cache-hit == 'true'
        run: echo "$HOME/.local/bin" >> "$GITHUB_PATH"

      - name: Verify SWAO binary
        run: swao --version

      - name: Run doctor
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: swao health-check

      - name: Run assessment
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          swao assess \
            --app ${{ env.SWAO_APP_ID }} \
            --workspace ./portfolio

      - name: Upload WSP artefact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: wsp-${{ github.run_number }}
          path: portfolio/wsp/runs/
          retention-days: 30
```
:::

---

## 2. Environment variables and secrets

Store the API key as a GitHub Actions repository secret:

1. Go to **Settings > Secrets and variables > Actions**.
2. Click **New repository secret**.
3. Name: `ANTHROPIC_API_KEY`, value: your key.

The workflow reads it via <code v-pre>${{ secrets.ANTHROPIC_API_KEY }}</code>. Never hard-code keys in workflow files.

---

## 3. Caching the binary

The cache key uses the SWAO version string. When you upgrade, update `SWAO_VERSION` and the old cache entry is automatically bypassed:

::: v-pre
```yaml
key: swao-${{ env.SWAO_VERSION }}
```
:::

Binary size is approximately 50--80 MB depending on the build target. Caching it avoids a full download on every run.

---

## 4. Using --llm-stub for fast gating

For pull request checks where real LLM output is not required (e.g., schema validation or configuration checks), use `--llm-stub` to eliminate API costs and latency:

::: v-pre
```yaml
- name: Fast schema check (stub)
  run: swao assess --app ${{ env.SWAO_APP_ID }} --llm-stub --workspace ./portfolio
```
:::

Run the full LLM assessment only on pushes to `main` or release branches.

---

## 5. Failing the build on blockers

SWAO exits with code `1` when blocker-severity findings are present. GitHub Actions treats any non-zero exit code as a step failure, so no additional configuration is needed. Add a summary step to print findings even on failure:

```yaml
- name: Print assessment summary
  if: always()
  run: |
    LATEST=$(cat portfolio/wsp/latest.txt)
    cat "portfolio/wsp/runs/${LATEST}/run-manifest.json" | \
      jq '{total_signals: .total_signals_emitted, verdict: .verdict}'
```

---

## 6. Multi-app matrix

To assess multiple apps in parallel:

::: v-pre
```yaml
strategy:
  matrix:
    app_id: [app-one, app-two, app-three]
  fail-fast: false

steps:
  # ... setup steps ...
  - name: Assess ${{ matrix.app_id }}
    run: swao assess --app ${{ matrix.app_id }} --workspace ./portfolio
```
:::

`fail-fast: false` ensures all apps are assessed even if one fails.
