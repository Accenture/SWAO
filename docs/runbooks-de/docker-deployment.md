# Docker-Deployment

SWAO lässt sich in einem Docker-Container betreiben, um reproduzierbare Assessments, Air-Gap-Umgebungen oder gemeinsam genutzte Team-Infrastruktur zu unterstützen. Dieses Runbook beschreibt den einfachen `docker run`-Aufruf, ein Docker Compose-Setup mit Named Volumes sowie den Offline-Betrieb mit `--skip-llm`.

---

## Voraussetzungen

- Docker Engine 24.x oder neür (oder Docker Desktop 4.x)
- Docker Compose v2 (für das Compose-Beispiel)
- Ein Workspace-Verzeichnis auf dem Host-Rechner

---

## 1. Einfacher docker run

```bash
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -v "$(pwd)/workspace:/workspace" \
  -v "$(pwd)/output:/output" \
  ghcr.io/accenture/swao:latest \
  assess --app sovereign-health --workspace /workspace --output /output
```

Wichtige Flags:

| Flag | Zweck |
|---|---|
| `--rm` | Container nach Beendigung entfernen |
| `-e ANTHROPIC_API_KEY` | LLM-API-Key aus der Host-Umgebung übergeben |
| `-v workspace:/workspace` | SWAO-Workspace in den Container einbinden |
| `-v output:/output` | Assessment-Ausgabe in ein Host-Verzeichnis schreiben |

---

## 2. Umgebungsvariablen

| Variable | Erforderlich | Beschreibung |
|---|---|---|
| `ANTHROPIC_API_KEY` | Ja (ausser bei `--skip-llm`) | Anthropic-API-Key für Claude |
| `SWAO_LLM_PROVIDER` | Nein | Standard-LLM-Provider überschreiben (`anthropic`, `ollama`, `openai`) |
| `SWAO_LOG_LEVEL` | Nein | Log-Ausführlichkeit: `debug`, `info`, `warn`, `error` |
| `SWAO_WORKSPACE` | Nein | Standard-Workspace-Pfad innerhalb des Containers |

---

## 3. Doctor vor assess ausführen

```bash
# Check all probes before running a full assessment
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  ghcr.io/accenture/swao:latest \
  doctor
```

---

## 4. Docker Compose-Beispiel

Für persistente Named Volumes und einfachere Mehrfachnutzung:

```yaml
# docker-compose.yml
version: "3.9"

services:
  swao:
    image: ghcr.io/accenture/swao:latest
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SWAO_LOG_LEVEL=info
    volumes:
      - workspace:/workspace
      - output:/output
    command: assess --app sovereign-health --workspace /workspace --output /output

  swao-mcp:
    image: ghcr.io/accenture/swao:latest
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    ports:
      - "3737:3737"
    command: mcp --http --port 3737
    restart: unless-stopped

volumes:
  workspace:
  output:
```

MCP-Server im Hintergrund starten und ein einmaliges Assessment ausführen:

```bash
docker compose up -d swao-mcp
docker compose run --rm swao
```

---

## 5. Workspace-Volume befullen

So werden Daten aus einem lokalen Verzeichnis in das Named Volume `workspace` kopiert:

```bash
# Copy workspace files into the named volume
docker run --rm \
  -v "$(pwd)/my-workspace:/src" \
  -v "swao_workspace:/workspace" \
  alpine sh -c "cp -r /src/. /workspace/"
```

Alternativ kann ein Host-Verzeichnis direkt als Bind-Mount eingebunden werden (den `workspace:`-Volume-Verweis durch einen absoluten Host-Pfad ersetzen):

```yaml
volumes:
  - /path/to/my-workspace:/workspace
```

---

## 6. Air-Gap-Betrieb mit --skip-llm

In Umgebungen ohne Internet-Zugang kann `--skip-llm` verwendet werden, um Assessments mit einem deterministischen Stub-LLM durchzuführen. Ein API-Key ist nicht erforderlich.

```bash
docker run --rm \
  -v "$(pwd)/workspace:/workspace" \
  -v "$(pwd)/output:/output" \
  ghcr.io/accenture/swao:latest \
  assess --app sovereign-health --skip-llm --workspace /workspace --output /output
```

Der Stub liefert feste Antworten für jeden LLM-Aufruf. Ausgabedateien werden genauso erstellt wie in einem echten Lauf, was diesen Modus für Pipeline-Tests und Schema-Validierung ohne API-Kosten nützlich macht.

---

## 7. Image-Versionen festschreiben

Den Tag `:latest` in Produktions-Pipelines vermeiden. Stattdessen auf ein bestimmtes Release festschreiben:

```bash
docker pull ghcr.io/accenture/swao:0.5.1
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/accenture/swao:0.5.1 \
  assess --app sovereign-health --workspace /workspace
```

Aktülle Release-Tags sind unter `https://github.com/Accenture/SWAO/releases` aufgelistet.
