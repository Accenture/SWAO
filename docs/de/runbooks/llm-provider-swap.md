# LLM-Provider wechseln

SWAO verwendet standardmäßig Anthropic Claude für seine LLM-Durchläufe, unterstützt aber auch den Wechsel zu einer lokalen Ollama-Instanz, OpenAI oder den vollständigen Offline-Betrieb mit `--skip-llm`. Dieses Runbook erläutert die verfügbaren Optionen und die Konfigurationsmöglichkeiten.

---

## Unterstützte Provider

| Provider | Wert | Erforderliche Umgebungsvariable | Hinweise |
|---|---|---|---|
| Anthropic (Standard) | `anthropic` | `ANTHROPIC_API_KEY` | Claude 3.x und neuer |
| Ollama (lokal) | `ollama` | `OLLAMA_BASE_URL` (optional) | Standard: `http://localhost:11434` |
| OpenAI | `openai` | `OPENAI_API_KEY` | gpt-4o und kompatible Modelle |

---

## 1. Konfiguration per Umgebungsvariable

Die Umgebungsvariable `SWAO_LLM_PROVIDER` steuert, welchen Provider SWAO nutzt. Sie muss vor jedem `swao`-Befehl gesetzt werden:

```bash
# Use Ollama
export SWAO_LLM_PROVIDER=ollama
export OLLAMA_BASE_URL=http://localhost:11434   # optional; this is the default

swao assess --app my-app

# Use OpenAI
export SWAO_LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...

swao assess --app my-app

```

---

## 2. Konfiguration per .swao.yml

Den Provider in der `.swao.yml` des Workspaces festlegen, damit er sitzungsübergreifend erhalten bleibt:

```yaml
# .swao.yml (annotated example)
workspace:
  name: my-portfolio

llm:
  provider: ollama            # one of: anthropic, ollama, openai
  model: llama3               # provider-specific model identifier
  base_url: http://localhost:11434   # only relevant for ollama

apps:
  - id: my-app
    display_name: My Application
```

Die `.swao.yml`-Einstellung wird durch die Umgebungsvariable `SWAO_LLM_PROVIDER` überschrieben. Umgebungsvariablen haben stets Vorrang.

---

## 3. Einmaliges Überschreiben per CLI-Flag

```bash
# Run a single assessment against Ollama without changing .swao.yml
swao assess --app my-app --llm-provider ollama

# Skip LLM calls for offline or CI use
swao assess --app my-app --skip-llm
```

Verwenden Sie `--skip-llm` um LLM-Aufrufe zu überspringen (z.B. in CI-Umgebungen ohne API-Schlüssel).

---

## 4. Ollama einrichten

Ollama installieren und starten, dann ein kompatibles Modell herunterladen, bevor SWAO ausgeführt wird:

```bash
# Pull the model (first-time setup)
ollama pull llama3

# Verify Ollama is reachable
curl http://localhost:11434/api/tags

# Run SWAO with Ollama
SWAO_LLM_PROVIDER=ollama swao assess --app my-app
```

SWAO sendet strukturierte Prompt-Payloads, die mit den Endpunkten `/api/generate` und `/api/chat` von Ollama kompatibel sind. Jedes über `ollama list` aufgelistete Modell kann über das Feld `model` in `.swao.yml` oder die Umgebungsvariable `SWAO_LLM_MODEL` angegeben werden.

---

## 5. OpenAI einrichten

```bash
export OPENAI_API_KEY="sk-..."
export SWAO_LLM_PROVIDER=openai
export SWAO_LLM_MODEL=gpt-4o   # optional; gpt-4o is the default

swao assess --app my-app
```

SWAO nutzt die OpenAI Chat Completions API. Jedes Modell, auf das der API-Key Zugriff hat, kann verwendet werden.

---

## 6. LLM-Aufrufe überspringen mit --skip-llm

Verwenden Sie `--skip-llm` um LLM-Aufrufe zu überspringen (z.B. in CI-Umgebungen ohne API-Schlüssel).

```bash
swao assess --app my-app --skip-llm
```

---

## Timeouts, Wiederholungen und Parallelität (#3284)

Alle Provider nutzen dieselbe Request-Regel: 6 Versuche pro Aufruf (Wartezeiten 3,
6, 12, 24, 48 s), Wiederholung bei 408, 429 und 5xx, ein Idle-Timeout pro Versuch
und ein Concurrency-Limit auf Provider-Ebene.

| Einstellung | Standard | Hinweise |
|---|---|---|
| `SWAO_LLM_IDLE_TIMEOUT_MS` | `120000` | Idle-Timeout pro Versuch (Warten auf Header und Lücken zwischen Body-Daten). `SWAO_ANTHROPIC_IDLE_TIMEOUT_MS` bleibt als Alias erhalten. Aufrufe ohne Streaming warten mindestens 300 s auf die Header. |
| `providers.llm.max_concurrency` (`.swao.yml`) | `4` | Gleichzeitig offene LLM-Requests pro Endpunkt, gemeinsam für alle Passes. Ein Gateway-Connector kann `max_concurrency` setzen; der Wert aus `.swao.yml` hat Vorrang. |

Jeder Versuch, jede Wartezeit, jeder Timeout, jede Wiederholung, jeder HTTP-Fehler
und jedes Ergebnis wird als `provider.llm.<provider>.*` protokolliert. Siehe
[Referenz der Log-Ereignisse](/de/runbooks/log-events).

---

## 7. Verhalten bei nicht verfügbarem Provider

Wenn der konfigurierte Provider nicht erreichbar ist (fehlender API-Key, Ollama nicht aktiv, Netzwerkfehler), beendet SWAO sich mit einem Fehlercode und gibt eine Diagnosemeldung aus. Ein automatischer Fallback auf einen anderen Provider findet nicht statt, damit Assessments nicht unbemerkt an Qualität verlieren.

Mit `swao health-check` die Provider-Konnektivität vor einem vollständigen Assessment prüfen:

```bash
swao health-check
# Look for: "LLM connectivity: green" with the active provider name
```
