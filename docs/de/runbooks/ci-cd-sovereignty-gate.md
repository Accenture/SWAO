# CI/CD-Souveränitäts-Gate

Verhindern Sie Deployments, die Souveränitätsverstöße einführen, indem Sie SWAO als
Pipeline-Schritt ausführen und den Build bei kritischen Findings fehlschlagen lassen.
Dieses Runbook beschreibt die Vereinbarung zu den Exit-Codes, das Flag `--fail-on` und
Integrationsmuster für gängige CI-Systeme.

---

## Vereinbarung zu den Exit-Codes

| Exit-Code | Bedeutung | Gate-Aktion |
|---|---|---|
| `0` | Assessment abgeschlossen; kein Finding erfüllt die `--fail-on`-Bedingung | Bestanden |
| `1` | Allgemeiner Laufzeitfehler (nicht behandelte Ausnahme, unerwarteter Zustand) | Fehlgeschlagen (vorsichtshalber) |
| `2` | Konfigurations- oder Sperrfehler (ungültige `.swao.yml`, fehlende App-ID, Workspace gesperrt) | Fehlgeschlagen (vorsichtshalber) |
| `4` | LZ-Souveränitäts-Gate blockiert (Verdict SOVEREIGNTY_BLOCKED) | Fehlgeschlagen |
| `5` | Malware oder unzulässiges Binary im Quellcode erkannt | Fehlgeschlagen |
| `6` | `--fail-on`-Bedingung erfüllt (mindestens ein Signal hat den Schwellenwert erreicht) | Fehlgeschlagen |

Werten Sie jeden Exit-Code ungleich null als fehlgeschlagenes Gate. Exit-Code `2`
weist auf ein Konfigurationsproblem hin, das behoben werden muss, bevor das Assessment
überhaupt laufen kann.

---

## Flag `--fail-on`

```
swao assess --app <id> --fail-on severity=<level>
```

Nach Abschluss aller Passes prüft SWAO die gesammelten Signale gegen die Bedingung.
Erfüllt ein Signal die Bedingung, gibt SWAO die IDs der betreffenden Signale aus und
endet mit Exit-Code `6`.

Unterstützte Bedingungen:

| Bedingung | Beispiel | Bedeutung |
|---|---|---|
| `severity=<level>` | `severity=critical` | Exit 6, wenn ein Signal diesen Schweregrad hat |

Schweregrade (von niedrig nach hoch): `informational`, `low`, `medium`, `high`, `critical`.

Die Prüfung erfolgt nach dem Malware-Gate (Exit 5). Ist die `--fail-on`-Bedingung
erfüllt, hat Exit 6 Vorrang vor einem sauberen Exit 0.

---

## Flag `--skip-llm`

Verwenden Sie `--skip-llm` für schnelle CI-Läufe (nur statische Passes, ungefähr 30
Sekunden). Damit wird der LLM-Teil des Assessments deaktiviert, der ein konfiguriertes
LLM-Gateway voraussetzt und 15 bis 60 Minuten dauern kann.

```
swao assess --app platform --passes inv,sbom,egr,crypto --skip-llm --fail-on severity=critical
```

---

## Workflow für GitHub Actions

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
            --passes inv,sbom,egr,crypto \
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

## Ausschnitt für GitLab CI

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
    - ./swao assess --app $APP_ID --passes inv,sbom,egr,crypto --skip-llm --fail-on severity=critical
  artifacts:
    when: always
    paths:
      - wsp/runs/
    expire_in: 30 days
  variables:
    APP_ID: my-app
```

---

## Interner Runner (PowerShell, Windows)

```powershell
# Dieses Gate ausführen, nachdem Ihr KI-Coding-Assistent Terraform erzeugt oder
# aktualisiert hat, und vor terraform plan/apply.

# Gate: blockieren, wenn ein kritisches Souveränitätssignal vorliegt
.\swao-enterprise-win-x64.exe assess `
    --app platform `
    --passes inv,sbom,egr,crypto `
    --skip-llm `
    --fail-on severity=critical

if ($LASTEXITCODE -ne 0) {
    Write-Error "Sovereignty gate FAILED (exit $LASTEXITCODE)"
    exit 1
}
Write-Host "Sovereignty gate PASSED"
```

Hinweis: Prüfen Sie `$LASTEXITCODE` immer ausdrücklich. SWAO kann bei nicht fatalen
Warnungen `[error]` auf stdout ausgeben und trotzdem mit Exit-Code 0 enden.
Maßgeblich ist allein der Exit-Code.

---

## Siehe auch

- [CI/CD-Pipeline-Integration](/de/runbooks/cicd-pipeline): allgemeine Einbindung in CI-Pipelines
- SWAO kann `[error]` ausgeben und dennoch mit Exit-Code 0 enden; prüfen Sie daher immer `$LASTEXITCODE`.
