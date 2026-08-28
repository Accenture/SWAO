# MCP-Server-Integration

SWAO stellt seine Assessment-Funktionen als MCP-Server (Model Context Protocol) bereit, sodass KI-Assistenten wie Claude Code SWAO-Tools direkt aus einer Konversation heraus aufrufen können. Dieses Runbook beschreibt das Starten des Servers, die Konfiguration von Claude Code für die Verbindung, die verfügbaren Tools und Sicherheitshinweise.

SWAO uses HTTP transport on `localhost:3737` because Accenture security policy restricts stdio-based MCP connections by process name.

---

## Funktionsweise

`swao mcp --http` startet einen lokalen HTTP-Server auf Port 3737. MCP-Clients verbinden sich mit diesem Server und erhalten eine Übersicht der verfügbaren Tools. Wird ein Tool aufgerufen, führt SWAO den entsprechenden Vorgang aus (Assessment, Berichtgenerierung, App-Auflistung) und gibt strukturierte Ergebnisse an den Client zurück.

---

## 1. MCP-Server starten

```bash
# Start in the foreground (Ctrl+C to stop)
swao mcp --http

# Specify a custom port
swao mcp --http --port 3737

# Start with verbose logging
swao mcp --http --log-level debug
```

Erwartete Ausgabe:

```
SWAO MCP server listening on http://localhost:3737
Available tools: assess, generate-report, list-apps
Press Ctrl+C to stop.
```

Der Server muss laufen, bevor Claude Code oder ein anderer MCP-Client versucht, eine Verbindung herzustellen.

---

## 2. Claude Code für die Verbindung konfigurieren

Den SWAO-MCP-Server zur Konfigurationsdatei von Claude Code hinzufügen. Auf den meisten Systemen ist das `~/.claude.json`:

```json
{
  "mcpServers": {
    "swao": {
      "type": "http",
      "url": "http://localhost:3737"
    }
  }
}
```

Nach dem Speichern der Konfiguration Claude Code neu starten oder die MCP-Server-Liste neu laden. SWAO-Tools erscheinen mit dem Präfix `swao__` im Panel der verfügbaren Tools.

---

## 3. Verfügbare MCP-Tools

| Tool-Name | Beschreibung |
|---|---|
| `swao__assess` | Vollständiges Assessment gegen eine benannte App im aktiven Workspace ausführen |
| `swao__generate-report` | PDF- oder HTML-Bericht aus dem aktüllsten Lauf generieren |
| `swao__list-apps` | Alle in der Workspace-`.swao.yml` definierten Apps auflisten |

### swao__assess

Parameter:

| Parameter | Typ | Erforderlich | Beschreibung |
|---|---|---|---|
| `app` | string | Ja | App-ID gemäss `.swao.yml` |
| `llm_stub` | boolean | Nein | Stub-LLM verwenden (Offline-Modus) |
| `workspace` | string | Nein | Pfad zum Workspace; Standard: aktülles Verzeichnis |

### swao__generate-report

Parameter:

| Parameter | Typ | Erforderlich | Beschreibung |
|---|---|---|---|
| `app` | string | Ja | App-ID |
| `format` | string | Nein | `pdf` oder `html`; Standard: `pdf` |
| `run_id` | string | Nein | Zeitstempel eines bestimmten Laufs; Standard: aktüllster Lauf |

### swao__list-apps

Keine Pflichtparameter. Gibt die Liste der App-IDs und Anzeigenamen aus dem Workspace zurück.

---

## 4. Sicherheitshinweise

Der MCP-Server bindet standardmässig nur an `localhost`. Port 3737 nicht ohne zusätzliche Authentifizierung und Netzwerkkontrollen nach aussen freigeben:

- Auf gemeinsam genutzten Rechnern nicht an `0.0.0.0` binden.
- Port 3737 nicht ohne Bewertung der Vertraünsgrenze per SSH-Tunnel an entfernte Clients weiterleiten.
- Der Server erbt die Umgebung des startenden Prozesses, einschliesslich eines eventüll vorhandenen `ANTHROPIC_API_KEY`-Wertes. Die Terminal-Sitzung entsprechend absichern.

Die Bindung an localhost genügt für Einzel-Nutzer-Workstation-Deployments. Für Server-Deployments, bei denen mehrere Nutzer Zugriff benötigen, den Docker-Deployment-Ansatz (siehe [Docker-Deployment](./docker-deployment.md)) verwenden und den MCP-Server hinter einen Reverse Proxy mit Authentifizierung stellen.

---

## 5. Als Hintergrundprozess betreiben

```bash
# Linux/macOS -- background with nohup
nohup swao mcp --http > ~/.swao/mcp.log 2>&1 &
echo $! > ~/.swao/mcp.pid

# Stop it later
kill $(cat ~/.swao/mcp.pid)
```

Für persistente Server-Deployments die systemd-Unit aus dem Runbook [Linux: SWAO installieren](./linux-install.md) verwenden und `swao mcp --http` als `ExecStart`-Befehl einsetzen.

---

## 6. Konnektivität prüfen

```bash
# Check that the server is responding
curl -s http://localhost:3737/health

# List available tools
curl -s http://localhost:3737/tools | jq '.tools[].name'
```

Erwartete Health-Response: `{"status":"ok","version":"<version>"}`.
