# 1. Workspace-Setup

Der **Workspace-Setup-Assistent** startet bei Auswahl von Option 1 im SWAO-Hauptmenü. Er initialisiert Ihren Engagement-Ordner und schreibt eine `.swao.yml`-Konfigurationsdatei in einem geführten Ablauf.

## Was der Assistent konfiguriert

| Schritt | Was er tut |
|---|---|
| Workspace-Name | Erstellt die Engagement-Ordnerstruktur unter Ihrem gewählten Stammverzeichnis |
| Anwendungsname | Registriert den zu bewertenden Workload |
| Compliance-Rahmenwerke | Wählt aktive Rahmenwerke aus (DSGVO vorausgewählt; 14 Community-Rahmenwerke verfügbar) |
| LLM-Anbieter | Konfiguriert den KI-Anbieter: Anthropic, OpenAI, Ollama oder deterministischer Stub |
| Zugangsdaten | Speichert API-Schlüssel und Vault-Referenzen über `swao credential set` |

## CLI-Äquivalent

```bash
swao init --name mein-engagement
swao credential set anthropic-api-key
swao framework install GDPR
```

## Nach dem Setup

Führen Sie einen [Health Check](/de/health-check) durch, um sicherzustellen, dass alle sieben Systemprüfungen erfolgreich sind, bevor Sie eine Bewertung starten.

Siehe auch: [Wie SWAO funktioniert](/de/how-it-works)
