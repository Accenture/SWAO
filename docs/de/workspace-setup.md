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

Neue Workspaces enthalten vier Demo-Rahmenwerke. Weitere Community-Rahmenwerke kopieren Sie mit
`swao framework install <ID>` in den Workspace und wählen sie je App beim Ausführen einer Bewertung.

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

## Nach dem Setup

Führen Sie einen [Health Check](/de/health-check) durch, um sicherzustellen, dass alle Vorabprüfungen erfolgreich sind, bevor Sie eine Bewertung starten.

Siehe auch: [Wie SWAO funktioniert](/de/how-it-works)
