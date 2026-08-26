=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: LLM-Gateway-Connector erstellen

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/de/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Runbook: LLM-Gateway-Connector erstellen

> **Hinweis:** Dies ist eine Kurzreferenz auf Deutsch. Die vollstaendige
> englische Version befindet sich unter
> `docs/runbooks/llm-gateway-authoring.md`.

Design 090 macht die LLM-Anbindung von SWAO dateibasiert: ein YAML-Connector
pro Plattform. Dieses Runbook zeigt, wie eine beliebige LLM-Plattform ohne
Code-Aenderung oder Neubau an SWAO angebunden wird.

## 1. Drei Schritte

1. `wsp/inputs/llm-gateway/_template.yaml` (erstellt durch `swao init` /
   Setup) oder einen mitgelieferten Connector nach
   `wsp/inputs/llm-gateway/<ihre-id>.yaml` kopieren.
2. `id`, `name`, `protocol`, `base_url`, `auth` und `models.default` anpassen.
3. `swao setup` erneut ausfuehren (oder `swao assess --llm <ihre-id>` direkt
   verwenden). Der Connector wird automatisch erkannt; `swao health-check`
   Probe 14 bestaetigt die Validierung.

## 2. Protokoll waehlen

| Protokoll | Verwenden fuer |
|---|---|
| `openai` | OpenAI, Azure OpenAI, lokale OpenAI-kompatible Dienste |
| `anthropic` | Anthropic Claude (direkt oder ueber AWS Bedrock) |
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

## 4. Testen

```bash
swao health-check           # Probe 14 zeigt den Verbindungsstatus
swao assess --llm mein-connector --passes inv --app <app-id>
```

Weitere Details: englisches Runbook `docs/runbooks/llm-gateway-authoring.md`.
