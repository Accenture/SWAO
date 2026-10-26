# 1. Workspace-Setup

Der **Workspace-Setup-Assistent** startet bei Auswahl von Option 1 im SWAO-Hauptmenü. Er initialisiert Ihren Engagement-Ordner und schreibt eine `.swao.yml`-Konfigurationsdatei in einem geführten Ablauf.

## Was der Assistent konfiguriert

| Schritt | Was er tut |
|---|---|
| Workspace | Engagement-Name, Kundenkürzel, verantwortliche Person und Verzeichnis; erstellt die Engagement-Ordnerstruktur |
| LLM-Anbieter | Konfiguriert den KI-Anbieter: Anthropic, OpenAI, Amazon Bedrock Gateway, Ollama |
| Zugangsdaten | Speichert API-Schlüssel und Vault-Referenzen über `swao credential set` |
| LZ-Ziele | Optional: Anbieter aus dem Landing-Zone-Katalog wählen, dann je Anbieter eine oder mehrere Geografien (zum Beispiel `europe`, angezeigt mit ihrer Standardregion) oder Regions-IDs. Schreibt `assessment.landing_zone.targets` in die Workspace-`.swao.yml`; jeder Anwendungslauf prüft danach diese Ziele. Mit `S` überspringen |
| Health Check | Führt die Vorabprüfungen einmal aus |
| Claude Desktop, Playwright | Optionale Integrationen: MCP-Server-Konfiguration und Browser für die dynamische Analyse |
| Testcode | Wie Bewertungen Testcode behandeln: gesamten Code analysieren (Standard), gesamten Code analysieren und Testcode-Befunde kennzeichnen, oder Testcode ausschließen. Schreibt `assessment.test_code.mode` in die Workspace-`.swao.yml`. Mit `Esc` bleibt die bisherige Einstellung |

Neue Workspaces enthalten vier Demo-Rahmenwerke. Weitere Community-Rahmenwerke kopieren Sie mit
`swao framework install <ID>` in den Workspace und wählen sie je App beim Ausführen einer Bewertung.

![Workspace-Setup-Assistent in der Terminaloberfläche bei Schritt 1 von 7 mit der Abfrage des Workspace-Verzeichnisses](../samples/11-tui-workspace-setup.png)
*Der Workspace-Setup-Assistent bei Schritt 1 (Init). Die Fortschrittspunkte zeigen die folgenden Schritte. Aufgenommen mit einer früheren SWAO-Version; der aktuelle Assistent bietet zusätzlich den Schritt LZ-Ziele.*

## CLI-Äquivalent

```bash
swao init mein-engagement --name app-crm-01
swao credential set anthropic-api-key <ihr-api-schluessel>
swao framework install GDPR
swao regime-select --app app-crm-01 --regimes GDPR
# LZ-Ziele: je Lauf übergeben oder assessment.landing_zone.targets in der .swao.yml setzen
swao assess --app app-crm-01 --lz-cat-targets azure:europe,stackit:eu01
```

Eine App-`.swao.yml` und `--lz-cat-targets` haben Vorrang vor den Workspace-Zielen. Eine Geografie wird zur Laufzeit in ihre Standardregion aufgelöst; der Anwendungslauf hält angeforderte, aufgelöste und übersprungene Ziele in `run-status.json` fest, und ein übersprungenes Ziel kennzeichnet den Lauf als `partial`. Der Textbericht (`swao report`) zeigt sie unter **Landing Zone Catalogue Fit**.

## Testcode

Standardmäßig analysiert SWAO Testcode wie Produktivcode. Bei gemischten Codebasen lässt sich Testcode aus den Befunden heraushalten:

```yaml
assessment:
  exclude_test_code: true      # Kurzform; false (Standard) analysiert alles
  # oder die erweiterte Form:
  test_code:
    mode: tag                  # include (Standard) | tag | exclude
    extra_patterns: ["systemtest/**", "**/e2e/**"]
    keep_patterns: []
```

- `include`: Alles wird analysiert; die Ergebnisse bleiben unverändert.
- `tag`: Alles wird analysiert; Befunde, die nur auf Testcode beruhen, werden als `test_code` gekennzeichnet und um eine Schweregradstufe abgesenkt (der ursprüngliche Schweregrad bleibt erhalten).
- `exclude`: Testdateien werden nicht gelesen. Der Secret-Scan deckt sie weiterhin ab: Ein Passwort im Testcode bleibt ein Befund, gekennzeichnet als Testcode.

Testcode wird über eingebaute Regeln erkannt (`src/test/`, `test/`, `tests/`, `__tests__/`, `systemtest/`, `e2e/`, `mock/`, `*.test.ts`, `*.spec.js`, `*Test.java`, `*IT.java`, `*ITest.java`, ...) sowie über die Testordner, die in `pom.xml`, Gradle-Source-Sets und der vitest- / jest-Konfiguration deklariert sind. `keep_patterns` hat Vorrang vor allen Regeln. Eine App-`.swao.yml` hat Vorrang vor der Workspace-Einstellung. Der Abschnitt **Assessment Scope** der Publikation zeigt den Modus, die Zahl der Testdateien und die gekennzeichneten Befunde.

## Nach dem Setup

Führen Sie einen [Health Check](/de/health-check) durch, um sicherzustellen, dass alle Vorabprüfungen erfolgreich sind, bevor Sie eine Bewertung starten.

Siehe auch: [Wie SWAO funktioniert](/de/how-it-works)
