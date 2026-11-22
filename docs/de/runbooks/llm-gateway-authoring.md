# Runbook: LLM-Gateway-Connector erstellen

> **Hinweis:** Dies ist eine Kurzreferenz auf Deutsch. Die vollständige
> englische Version befindet sich unter
> `docs/runbooks/llm-gateway-authoring.md`.

Die LLM-Anbindung von SWAO ist dateibasiert: ein YAML-Connector pro Plattform. Dieses Runbook zeigt, wie eine beliebige LLM-Plattform ohne
Code-Änderung oder Neubau an SWAO angebunden wird.

## 1. Drei Schritte

1. `wsp/inputs/llm-gateway/_template.yaml` (erstellt durch `swao init` /
   Setup) oder einen mitgelieferten Connector nach
   `wsp/inputs/llm-gateway/<ihre-id>.yaml` kopieren.
2. `id`, `name`, `protocol`, `base_url`, `auth` und `models.default` anpassen.
3. `swao setup` erneut ausführen (oder `swao assess --llm <ihre-id>` direkt
   verwenden). Der Connector wird automatisch erkannt; `swao health-check`
   Probe 14 bestätigt die Validierung.

## 2. Protokoll wählen

| Protokoll | Verwenden für |
|---|---|
| `openai` | OpenAI, Azure OpenAI, lokale OpenAI-kompatible Dienste |
| `anthropic` | Anthropic Claude (direkt oder über AWS Bedrock) |
| `ollama` | Lokaler Ollama-Server |
| `custom` | Beliebige REST-API mit eigenem Adapter |

## 3. Pflichtfelder

```yaml
id: mein-connector          # Eindeutiger Bezeichner (Kleinbuchstaben, Bindestriche)
name: Mein LLM-Dienst       # Anzeigename
protocol: openai            # Siehe Tabelle oben
base_url: https://...       # API-Endpunkt
auth:
  type: bearer_token
  env: MEIN_API_SCHLUESSEL  # Name der Umgebungsvariable -- kein Klartext-Token
models:
  default: gpt-4o
```

Modellabfrage: Öffnet sich eine Modellauswahl (Setup, LLM Assessment) oder läuft `swao llm models --connector <id>`, fragt SWAO die angebotenen Modelle mit einem GET und dem Connector-Schlüssel live bei der Plattform ab (gleiche Proxy- und TLS-Einstellungen wie die Aufrufe, 5 Sekunden Zeitlimit) und schreibt sie in die Workspace-Kopie des Connectors. Für eine abgeschottete Plattform oder eine ohne Modellliste `models.discovery: false` setzen; dann sendet SWAO keine Abfrage.

## 4. Testen

```bash
swao health-check           # Probe 14 zeigt den Verbindungsstatus
swao assess --llm mein-connector --passes inv --app <app-id>
```

Weitere Details: englisches Runbook `docs/runbooks/llm-gateway-authoring.md`.
