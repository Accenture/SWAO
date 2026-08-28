# CI/CD-Pipeline-Integration

SWAO-Assessments lassen sich in GitHub Actions-Workflows integrieren, um Pull Requests und Release-Branches auf Sovereign-Readiness-Befunde zu prüfen. Dieses Runbook liefert ein vollständiges Workflow-Beispiel, Hinweise zum Caching und Erläuterungen zu Exit-Codes und Artefakt-Handling.

---

## Exit-Codes

| Code | Bedeutung |
|---|---|
| `0` | Assessment abgeschlossen; keine Befunde mit Blocker-Schweregrad |
| `1` | Befunde mit Blocker-Schweregrad erkannt (oder Lauf fehlgeschlagen) |
| `2` | Konfigurationsfehler (ungültiges `.swao.yml`, fehlende App-ID) |

Exit-Code `0` als Gate-Bedingung in der Pipeline verwenden. Exit-Code `1` sollte den Build fehlschlagen lassen; Code `2` zeigt ein Konfigurationsproblem an, das vor dem Assessment behoben werden muss.

---

## 1. Vollständiger GitHub Actions-Workflow

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

## 2. Umgebungsvariablen und Secrets

Den API-Key als GitHub Actions-Repository-Secret speichern:

1. Zu **Settings > Secrets and variables > Actions** navigieren.
2. Auf **New repository secret** klicken.
3. Name: `ANTHROPIC_API_KEY`, Wert: der eigene Schlüssel.

Der obige Workflow liest ihn über <code v-pre>${{ secrets.ANTHROPIC_API_KEY }}</code>. Schlüssel niemals direkt in Workflow-Dateien hinterlegen.

---

## 3. Binary cachen

Der Cache-Schlüssel verwendet den SWAO-Versionsstring. Bei einem Upgrade reicht es, `SWAO_VERSION` zu aktualisieren; der alte Cache-Eintrag wird automatisch umgangen:

::: v-pre
```yaml
key: swao-${{ env.SWAO_VERSION }}
```
:::

Die Grösse der Binary beträgt je nach Build-Target ungefähr 50--80 MB. Das Caching vermeidet einen vollständigen Download bei jedem Lauf.

---

## 4. --skip-llm für schnelles Gating verwenden

Für Pull-Request-Checks, bei denen echte LLM-Ausgaben nicht benötigt werden (z. B. Schema-Validierung oder Konfigurationsprüfung), kann `--skip-llm` eingesetzt werden, um API-Kosten und Latenzen zu vermeiden:

::: v-pre
```yaml
- name: Fast schema check (stub)
  run: swao assess --app ${{ env.SWAO_APP_ID }} --skip-llm --workspace ./portfolio
```
:::

Das vollständige LLM-Assessment nur bei Pushes auf `main` oder Release-Branches ausführen.

---

## 5. Build bei Blockern fehlschlagen lassen

SWAO beendet sich mit Code `1`, wenn Befunde mit Blocker-Schweregrad vorliegen. GitHub Actions behandelt jeden Nicht-Null-Exit-Code als Schritt-Fehler, sodass keine zusätzliche Konfiguration erforderlich ist. Einen zusammenfassenden Schritt ergänzen, der Befunde auch im Fehlerfall ausgibt:

```yaml
- name: Print assessment summary
  if: always()
  run: |
    LATEST=$(cat portfolio/wsp/latest.txt)
    cat "portfolio/wsp/runs/${LATEST}/run-manifest.json" | \
      jq '{total_signals: .total_signals_emitted, verdict: .verdict}'
```

---

## 6. Multi-App-Matrix

Mehrere Apps parallel bewerten:

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

`fail-fast: false` stellt sicher, dass alle Apps bewertet werden, auch wenn eine fehlschlägt.
