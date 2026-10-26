---
title: Runbook zur Integration des SWAO-MCP-Servers
status: accepted
purpose: Schritt-für-Schritt-Anleitung zur Registrierung des SWAO-MCP-Servers in Claude Desktop und anderen MCP-kompatiblen Clients, damit Berater Assessments ausführen, Berichte generieren und Challenge-Sitzungen direkt aus einer KI-Chat-Oberfläche heraus durchführen können.
authors: [Accenture/SWAO]
related:
last_updated: 2026-04-29
---

<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     MCP Integration
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# Runbook zur Integration des SWAO-MCP-Servers

## Zusammenfassung


<Badge type="warning" text="Enterprise"/> Der SWAO-MCP-Server ist Teil der Enterprise-Edition.

SWAO stellt seine Assessment-Funktionen über den STDIO-Transport des Model
Context Protocol (MCP) bereit. Nach der Registrierung kann jeder MCP-kompatible
Client (Claude Desktop, Cursor, VS Code mit einer MCP-Erweiterung usw.)
`swao_assess`, `swao_report`, `swao_health_check` und `swao_challenge` als native
Tools aufrufen und über den Einstiegspunkt `swao` den Übersichtsbildschirm des
Workflows anzeigen.

Dieses Runbook behandelt zwei Installationsmodi (Binary und Quellcode), die
Client-Konfiguration je Plattform, die Verifikation und die Fehlerbehebung.

Den kurzen Weg (ein Installationsbefehl je Client, Profile, kleine lokale Modelle und Fallstricke der
Clients) beschreibt [SWAO aus einem KI-Client nutzen](./mcp-ai-clients.md).

---

## 1. Installationsmodi

Es gibt zwei Möglichkeiten, den SWAO-MCP-Server zu betreiben. Die Wahl hängt
davon ab, ob das Repository geklont und Node.js installiert ist oder ob nur die
verteilten Binary-Dateien vorliegen.

| Modus | Was vorliegt | Node.js erforderlich |
|---|---|---|
| **Binary** | `swao-enterprise-win-x64.exe` / `swao-macos` / `swao-linux` aus `dist-bin/` | Nein |
| **Quellcode** | SWAO-Repository geklont, `dist/` gebaut | Ja (20.x) |

Beide Modi starten den Server mit demselben Unterbefehl `mcp`. Der einzige
Unterschied in der Client-Konfiguration ist das Feld `command`: direkt der Pfad
zum Binary (Binary-Modus) oder `node` mit Verweis auf `dist/index.js`
(Quellcode-Modus).

---

## 2. Binary-Modus: Dateien ablegen

Die Binary-Distribution umfasst drei ausführbare Dateien.
Alle Dateien befinden sich in `dist-bin/` des SWAO-Repositorys oder werden als
Release-Archiv ausgeliefert.

| Datei | Plattform | Zweck |
|---|---|---|
| `swao-enterprise-win-x64.exe` | Windows | Eigenständige CLI und MCP-Server |
| `swao-macos` | macOS | Eigenständige CLI und MCP-Server |
| `swao-linux` | Linux | Eigenständige CLI und MCP-Server |

### 2.1 Windows

1. Einen dauerhaften Ordner für das Binary anlegen, zum Beispiel `C:\tools\swao\`.
   `Downloads` oder andere Ordner, die geleert werden könnten, vermeiden.
2. `swao-enterprise-win-x64.exe` in diesen Ordner kopieren.
3. Optional `C:\tools\swao\` zum `PATH` hinzufügen, um `swao` aus jedem
   Terminal ausführen zu können. Für MCP ist das nicht erforderlich.

Vor der Registrierung bei einem Client prüfen, ob das Binary funktioniert:

```
C:\tools\swao\swao-enterprise-win-x64.exe mcp --help
```

Erwartete erste Zeile:

```
Start the SWAO MCP server (stdio transport). ...
```

### 2.2 macOS

1. `swao-macos` an einen dauerhaften Speicherort kopieren, zum Beispiel
   `/usr/local/bin/swao` oder `~/bin/swao`.
2. Als ausführbar markieren:

```bash
chmod +x /usr/local/bin/swao
```

3. Prüfen:

```bash
/usr/local/bin/swao mcp --help
```

### 2.3 Linux

Dieselben Schritte wie unter macOS. Empfohlener Speicherort: `/usr/local/bin/swao` oder `~/bin/swao`.

---

## 3. Quellcode-Modus: dist bauen

Diesen Abschnitt überspringen, wenn das Binary verwendet wird.

### 3.1 Voraussetzungen

- Node.js 20.x (Prüfung mit `node --version`)
- SWAO-Repository geklont

### 3.2 Build

```bash
cd packages/swao
npx tsc --project tsconfig.json
```

Keine Ausgabe bedeutet, dass der Build fehlerfrei ist. Der Einstiegspunkt des
Servers liegt unter `packages/swao/dist/index.js`.

### 3.3 Prüfen

```bash
node packages/swao/dist/index.js mcp --help
```

Erwartete erste Zeile:

```
Start the SWAO MCP server (stdio transport). ...
```

---

## 4. Funktionsweise des MCP-Servers

Der Client startet den SWAO-Prozess als Unterprozess über die Standard-Ein- und
-Ausgabe. Client und Server tauschen einen JSON-RPC-Handshake aus, danach kann
der Client bei Bedarf Tools aufrufen. Der Serverprozess bleibt für die Dauer der
Client-Sitzung aktiv.

Unten stehen die zentralen Workflow-Tools; die vollständige Liste hängt vom Profil ab (Abschnitt 4.3, `full` listet 53
Tools), `swao mcp profiles` zeigt sie:

| Tool | Zweck |
|---|---|
| `swao` | Willkommensbildschirm: Workflow-Übersicht, Tool-Liste, Schnellstartanleitung. Als Einstiegspunkt verwenden. |
| `swao_assess` | Souveränitäts-Assessment für eine Anwendung ausführen (Quellcode-Scan, SBOM, Egress, TF, Krypto, LZR). |
| `swao_report` | Bericht aus einem vorhandenen Assessment generieren. Unterstützt Rollenansichten: exec, compliance, finops, migration-manager, lzr. |
| `swao_health_check` | Health-Check: LLM-Konnektivität, Credential Store, Workspace-Struktur, Verfügbarkeit von Playwright, Lizenzstatus. |
| `swao_challenge` | Stakeholder-Challenge-Sitzung gegen ein WSP ausführen. Fünf Agentenperspektiven verfügbar. |

Die Tools `swao_assess` und `swao_report` benötigen zwei zentrale Parameter:

- `app_id`: der Name des Anwendungsordners unter `portfolio/apps/`
- `workspace_path`: absoluter Pfad zum Portfolio-Stammverzeichnis, das die `.swao.yml` enthält (optional;
  bei fixiertem Server-Workspace nicht angeboten, Abschnitt 4.2)

### 4.1 Tools für das Service Portfolio Assessment

Für einen mit `swao service init` angelegten Workspace (Design 103) stellt der
Server die Service-Ergebnisse direkt bereit. Die Lese-Tools folgen
`FEATURE_GATES['service-assessment']` (Community, also keine Sperre über die
Lizenz des MCP-Servers hinaus; `swao_service_export` erfordert zusätzlich
Enterprise), liefern JSON,
akzeptieren `workspace_path` (außer bei Fixierung) und begrenzen lange Listen (`limit` / `offset`).
Kontakt, Telefon und E-Mail aus der Intake-Datei werden nur als
Vorhanden-Kennzeichen (Boolean) ausgegeben; Notiztexte aus der Intake-Datei
und Analystentexte in Research-Stubs werden nie zurückgegeben. Fehlgeschlagene,
abgebrochene und laufende Runs (`run-status.json`) werden aufgelistet, aber nie
gelesen.

| Tool | Zweck |
|---|---|
| `swao_service_portfolio` | Eine Zeile je Anwendungs- oder Service-App aus `wsp/portfolio-summary.json` (kombinierte Portfolio-Sicht): `assessment_type`, 7R-Urteil der Anwendungs-Apps, TIME-Quadrant und Begründung, Risiko, Health, Evidenz, bewertet, Welle, Blast Radius, End-of-Life-Signal und Datum, CVE-Anzahlen, KEV, Standort, Kosten. Filter: `assessment_type`, `time_quadrant`, `wave`, `site`, `infra_category`, `operational_status`, `evidence`, `assessed`, `eol_signal`, `eol_within_months`, `min_risk`, `kev_match`; `sort_by` risk, eol_date, fan_in oder wave. |
| `swao_service_app` | Alles zu einer Service-App: Intake-Felder, Klassifizierung, Cluster, Kostenschätzung, Integrationen, TIME und Domänen-Scores, SWAO_APM-Scores je Control (`apm-score.json`), letzter verwendbarer Run und Run-Historie, Scope Coverage mit übersprungenen Passes, Research- und Binary-Zusammenfassung. Für eine Anwendungs-App der kombinierten Portfolio-Sicht: ihre Portfolio-Zeile und Integrationen. |
| `swao_service_research` | Research-Stubs einer App, optional ein `topic`: CVE-IDs (begrenzt), KEV, BSI, OSV, End of Life, VirusTotal sowie die LLM-Themen (vendor-profile, certifications, data-residency, breach-history) mit Status, Grund für das Überspringen, auf medium begrenzter Konfidenz und Quellen, die als vom Modell zitiert und nicht von SWAO geprüft gekennzeichnet sind. |
| `swao_service_waves` | Migrationswellen (Bezeichnung, Zeithorizont, Apps, Aufwand in Tagen) und Integrations-Hubs (Fan-in, Blast Radius) beider App-Typen; jedes Wellenmitglied und jeder Hub trägt `assessment_type`, `evidence` und `not_assessed`. |
| `swao_service_vendors` | Gruppen zur Anbieterkonsolidierung mit Opportunity-Score und -Stufe. |
| `swao_service_delta` | Letzter Delta-Bericht gegenüber dem vorherigen Snapshot: neue, entfernte und geänderte Apps, TIME- und Risikoänderungen. |
| `swao_service_scaffold` | Scaffold-Zusammenfassung: gelesene Zeilen, Apps, Cluster, SCAFFOLD-Signale je Code, nicht klassifizierte Apps, erkannte Spalten, PII-Spaltenbuchstaben. |
| `swao_service_runs` | Service-Runs je App mit ihrem Status aus `run-status.json` und dem letzten verwendbaren Run. |
| `swao_service_init` | Führt `swao service init` aus (`from`, `mapping`, `refresh`). Schreibt in den Workspace. |
| `swao_service_research_run` | Führt `swao service research` für alle Apps, eine App (`app_id`) oder eine Liste (`apps`) aus; `refresh`, `dry_run`. Schreibt in den Workspace. Jeder CLI-Aufruf endet nach 5 Minuten; ein unvollständiger Lauf wird mit `[incomplete]` gekennzeichnet. |
| `swao_service_export` | Enterprise: führt `swao service export` aus (Portfolio-Arbeitsmappe und Sternschema). |

`swao_assess` akzeptiert `assessment_type: service`; `swao_publish` publiziert
eine Service-App mit den Service-Blöcken; `swao_signals` und
`swao_signal_detail` enthalten die RESEARCH-, BINARY- und SCAFFOLD-Signale einer
Service-App; `swao_portfolio_summary` und `swao_portfolio_stats` ergänzen einen
Service-Abschnitt mit Verweis auf `swao_service_portfolio`.

Beispielfragen:

- "Welche Apps erreichen innerhalb von 12 Monaten ihr End of Life?" (ruft
  `swao_service_portfolio` mit `eol_within_months: 12`, `sort_by: eol_date` auf)
- "Zeige die Apps der Welle 1" (ruft `swao_service_waves` mit `wave: 1` auf)
- "Was weiß SWAO über `<app>`?" (ruft `swao_service_app` und für Details
  `swao_service_research` auf)

### 4.2 Workspace-Auflösung

Jedes Tool, jeder Prompt, jede Vervollständigung und jede Ressource ermittelt den
Workspace in dieser Reihenfolge (Design 116 REQ-02):

1. `swao mcp --workspace <pfad>`
2. die Umgebungsvariable `SWAO_WORKSPACE` (gleiche Bedeutung wie das Flag)
3. der Workspace, der vom Arbeitsverzeichnis des Servers aus gefunden wird
4. der von `swao setup` gespeicherte Standard-Workspace

Ein Workspace aus dem Flag oder der Umgebungsvariable ist *fixiert*. Bei einem
fixierten Server bietet `tools/list` den Parameter `workspace_path` nicht an, und
ein Aufruf, der ihn trotzdem übergibt, muss den fixierten Ordner nennen; jeder
andere Wert (auch `/`) schlägt mit `isError` fehl. Ohne Fixierung bleibt
`workspace_path` optional: leer lassen, um den Workspace des Servers zu nutzen.
Seit dem Release nach 1.4.2 hat `--workspace` Vorrang vor dem Arbeitsverzeichnis
(vorher ignorierte ein Server, der in einem Workspace gestartet wurde,
`--workspace` für einen anderen).

Für kleine lokale Modelle den Server fixiert starten: Die Tool-Liste ist dann
etwa 2.000 Tokens kürzer, und das Modell kann keinen falschen Pfad raten.

### 4.3 Tool-Profile

Jeder MCP-Client sendet die vollständige Tool-Liste mit jeder Modellanfrage. Kleine lokale Modelle
(8k bis 32k Kontext) brauchen eine kürzere Liste, daher bietet der Server Profile an (Design 116 REQ-08):

| Profil | Tools | Für |
|---|---|---|
| `starter` | `swao`, `swao_health_check`, `swao_workspace_inventory`, `swao_frameworks_list`, `swao_passes` | Erster Kontakt, Demos, lokale Modelle mit 8k bis 16k |
| `assess` | `starter` plus `swao_assess`, `swao_report`, `swao_signals`, `swao_signal_detail`, `swao_control_detail`, `swao_risks`, `swao_publish`, `swao_explain_landing_zone`, `swao_costs` | Assessment einer Anwendung mit lokalen Modellen von 16k bis 32k |
| `full` (Standard) | alle gelisteten Tools | Gehostete Modelle, Portfolio- und Service-Arbeit |

Ein Profil mit `swao mcp --profile <name>` wählen oder exakte Tools mit
`swao mcp --tools swao,swao_health_check` angeben (nicht beides). Ohne Flag liest der Server
`SWAO_MCP_PROFILE` / `SWAO_MCP_TOOLS`, dann den `mcp:`-Block der Workspace-`.swao.yml`, sonst gilt `full`.
Ein unbekanntes Profil oder ein unbekannter Tool-Name beendet den Server mit Exit-Code 2 und der Liste
der gültigen Werte. `swao mcp profiles` zeigt jedes Profil mit Tools, gemessener Größe und Token-Budget.

Ein Tool außerhalb des Profils wird nicht gelistet, und ein Aufruf schlägt mit `isError` fehl. Das Profil
`starter` bietet die drei statischen Ressourcen, aber keine Ressourcen-Templates; der Prompt
`swao_evidence_interview` wird nur angeboten, wenn `swao_evidence_capture` aktiv ist. SWAO Chat startet
den Server immer mit `--profile full`.

### 4.4 Der Start-Prompt

Der Server bietet in jedem Profil den MCP-Prompt `start` (Titel "Start SWAO") an. Er liefert das
SWAO-Hauptmenü mit einem Satz pro Eintrag, den typischen ersten Durchlauf und die Fragen, die als Nächstes
möglich sind (nur für Tools des aktiven Profils), und weist das Modell an, ihn unverändert und ohne
Tool-Aufruf auszugeben. Clients zeigen Prompts als Slash-Befehle: Claude Code `/mcp__swao__start` (oder
`/mcp__SWAO__start`, wenn der Server als `SWAO` registriert ist), Kilo `/swao:start`; andere Clients
führen ihn in ihrem Prompt-Menü.

---

## 5. Client-Konfiguration

Jeder der folgenden Abschnitte zeigt sowohl die Binary- als auch die
Quellcode-Variante. Die Variante verwenden, die zum Installationsmodus passt.

### 5.1 Claude Desktop, Windows (Store-Installation)

Pfad der Konfigurationsdatei:

```
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

**Binary-Variante** (Pfad durch den Speicherort von `swao-enterprise-win-x64.exe` ersetzen):

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "C:\\tools\\swao\\swao-enterprise-win-x64.exe",
      "args": ["mcp"]
    }
  }
}
```

**Quellcode-Variante** (`<repo-root>` durch den absoluten Pfad zum geklonten
Repository ersetzen, z. B. `C:\src\swao`):

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "<repo-root>\\packages\\swao\\dist\\index.js",
        "mcp"
      ]
    }
  }
}
```

Enthält die Konfiguration bereits einen `preferences`-Block, `mcpServers` als
gleichrangigen Schlüssel hinzufügen:

```json
{
  "preferences": { ... },
  "mcpServers": {
    "SWAO": { ... }
  }
}
```

Claude Desktop vollständig über das Symbol im Infobereich beenden (Beenden,
nicht nur das Fenster schließen) und wieder öffnen.

### 5.2 Claude Desktop, Windows (direkte .exe-Installation)

Pfad der Konfigurationsdatei:

```
%APPDATA%\Claude\claude_desktop_config.json
```

Der JSON-Block ist identisch mit Abschnitt 5.1. Der einzige Unterschied ist der
Speicherort der Datei.

**Beide Installationen auf einem Rechner.** Ein Rechner, auf dem sowohl eine
Store-Installation (MSIX) als auch eine direkte .exe-Installation vorhanden war,
hat beide Konfigurationsdateien. Claude Desktop liest den Store-Pfad, wenn er
existiert. Der Setup-Assistent (Schritt „MCP Client“), `swao init --mcp` und
`swao mcp install` aktualisieren die Konfiguration, die Claude Desktop liest,
sowie jede weitere Konfiguration, die bereits einen SWAO-Eintrag enthält, und
führen jede Datei mit ihrem Ergebnis auf. Eine Konfiguration ohne SWAO-Eintrag
wird weder angelegt noch geändert. Alle drei registrieren denselben Eintrag:
für ein SWAO-Release-Binary eine stabile Kopie im Ordner des Binarys
mit dem Namen der eigenen Edition (`swao-<tier>-<os>-<arch>[.exe]`, also
`swao-enterprise-win-x64.exe` für das Enterprise-Binary unter Windows; ein
Binary einer Edition überschreibt nie das Binary einer anderen) mit `args`
`["mcp"]`; für eine Ausführung aus dem Quellcode den absoluten Pfad zu `node`
mit dem Skriptpfad und `mcp` als `args` (die Quellcode-Variante oben), wobei
keine Kopie angelegt wird. Die Registrierung ist nur mit Enterprise möglich:
Community- und Consultant-Binary oder eine niedrigere Lizenz erhalten die
`[LICENSE]`-Meldung (Exit-Code 1), und es wird nichts kopiert oder geschrieben. `swao health-check` (Probe 3, SWAO-MCP) warnt, wenn
ein SWAO-Eintrag in einer der beiden Dateien auf ein Binary verweist, das nicht
mehr existiert oder nicht das laufende SWAO-Binary ist.

### 5.3 Claude Desktop, macOS

Pfad der Konfigurationsdatei:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Binary-Variante:**

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "/usr/local/bin/swao",
      "args": ["mcp"]
    }
  }
}
```

**Quellcode-Variante** (den korrekten Node-Pfad mit `which node` ermitteln;
übliche Speicherorte: `/usr/local/bin/node` für Homebrew auf Intel,
`/opt/homebrew/bin/node` für Apple Silicon, `~/.nvm/versions/node/<v>/bin/node`
für nvm):

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "/usr/local/bin/node",
      "args": [
        "/path/to/swao/packages/swao/dist/index.js",
        "mcp"
      ]
    }
  }
}
```

Den vollständigen absoluten Pfad zu `node` verwenden. Der PATH der App
unterscheidet sich von dem der Shell.

### 5.4 Cursor

Cursor liest die MCP-Konfiguration aus `.cursor/mcp.json` im
Projekt-Stammverzeichnis oder global aus `~/.cursor/mcp.json`.

**Binary-Variante:**

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "/usr/local/bin/swao",
      "args": ["mcp"]
    }
  }
}
```

**Quellcode-Variante:**

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "node",
      "args": [
        "/path/to/swao/packages/swao/dist/index.js",
        "mcp"
      ]
    }
  }
}
```

Nach dem Speichern das Cursor-Fenster neu laden.

### 5.5 VS Code mit einer MCP-Erweiterung

Die Konfiguration je nach Erweiterung in `.vscode/mcp.json` im
Workspace-Stammverzeichnis oder in den globalen Benutzereinstellungen unter
`mcp.servers` ablegen. Das Format von command und args ist identisch mit den
obigen Beispielen.

### 5.6 Andere MCP-kompatible Clients

Jeder Client, der den STDIO-Transport unterstützt, kann SWAO ausführen. Es gilt:

- **Binary-Modus:** `command` ist der absolute Pfad zu `swao-enterprise-win-x64.exe` / `swao-macos` / `swao-linux`; `args` ist `["mcp"]`
- **Quellcode-Modus:** `command` ist der absolute Pfad zu `node`; `args` ist `["<absolute-path>/dist/index.js", "mcp"]`
- **Transport:** stdio (nicht SSE oder HTTP)

Der Servername-Schlüssel (`"SWAO"`) ist nur eine Anzeigebezeichnung; einen
Namen wählen, der in der Client-Oberfläche gut erkennbar ist.

### 5.7 HTTP-Transport (`swao mcp --http`)

Claude Code in der von Accenture verwalteten Umgebung akzeptiert nur
`http://localhost*`-Server (ADR-0045); SWAO Chat nutzt denselben Transport.
Den Server vor dem Client starten:

```
swao mcp --http [--port 3737] [--host localhost] [--allow-remote] [--workspace <path>] [--replace]
```

**Bind-Adresse (Design 116 REQ-03.1 bis REQ-03.3, #3468).** Der Standard
`--host localhost` lauscht auf `127.0.0.1` und `::1` am selben Port, sodass
`http://localhost:3737/mcp` funktioniert, egal ob der Client `localhost` zu
IPv4 oder IPv6 auflöst. Ist `::1` nicht verfügbar, warnt der Server und
bedient nur IPv4. Das Banner nennt die tatsächlich gebundenen Adressen, zum
Beispiel `http://localhost:3737/mcp (127.0.0.1, ::1)`. Eine andere
Loopback-Adresse (`--host 127.0.0.1`, `--host ::1`) bindet nur sich selbst.
Eine Nicht-Loopback-Adresse (`0.0.0.0`, `::`, eine LAN-Adresse oder ein
Hostname) endet mit Exit-Code 2, außer `--allow-remote` ist gesetzt; dann gibt
der Server eine Warnung aus, weil er keine Authentifizierung hat. Das nur in
einem vertrauenswürdigen Netz verwenden, zum Beispiel für einen Client im
Container.

**Port-Behandlung (Design 116 REQ-03.4 bis REQ-03.6, #3461).** Der Server
beendet nie einen anderen Prozess, um seinen Port frei zu bekommen:

- Port frei: Der Server startet und schreibt seine PID nach
  `swao-mcp-<port>.pid` im temporären Systemordner.
- Port von einem anderen SWAO-MCP-Server belegt: Exit-Code 1 mit
  `a SWAO MCP server is already running on port 3737 (pid <n>); use --replace to restart it`.
  SWAO Chat wertet das als Erfolg und verbindet sich mit dem laufenden Server;
  beim Schließen der TUI läuft dieser Server weiter.
- Port von einem beliebigen anderen Prozess belegt: Exit-Code 1 mit
  `port 3737 is in use; stop the other process or start with --port <n>`.
- `--replace` startet einen laufenden SWAO-Server neu. Es beendet nur die PID
  aus der PID-Datei, und nur nachdem dieser Prozess eine `initialize`-Probe als
  `swao` beantwortet und dieselbe PID im Antwort-Header `X-SWAO-MCP-PID`
  genannt hat (ein Server bis SWAO 1.4.2 sendet diesen Header nicht; dann muss
  die PID-Datei einen laufenden Prozess nennen). Andernfalls verweigert es,
  beendet nichts und endet mit Exit-Code 1.

**Sitzungen (REQ-07.4, REQ-07.5, #3462).** Eine Anfrage, die der Client
mitten im Body abbricht, wird mit 400 beantwortet; ein Fehler im Transport
mit 500. Beides beendet den Server nicht. Eine Sitzung ohne Anfrage seit
30 Minuten wird geschlossen; der Client erhält dafür 404 und startet eine
neue Sitzung.

**Lange Tool-Aufrufe (REQ-18, #3463).** Tools, die die SWAO-CLI ausführen
(zum Beispiel `swao_publish`, `swao_report`, `swao_health_check`,
`swao_challenge`), blockieren den Server nicht mehr: Andere Sitzungen und die
Probe von SWAO Chat werden währenddessen beantwortet. Jeder Aufruf behält das
Limit von 5 Minuten. Bricht der Client den Aufruf ab, werden der CLI-Prozess
und seine Unterprozesse beendet. `swao_challenge`, `swao_publish` und
`swao_service_research_run` senden Fortschrittsmeldungen (Start, alle
5 Sekunden, Ende), wenn der Client Fortschritt anfordert.

**Host- und Origin-Prüfung (REQ-19, #3464).** Der Server beantwortet nur
Anfragen an `localhost`, `127.0.0.1` oder `[::1]` auf seinem eigenen Port.
Eine Anfrage mit einem anderen `Host`-Header oder mit einem `Origin`-Header,
der eine andere Website nennt, erhält 403. Das verhindert, dass eine Webseite
im Browser den Server über DNS-Rebinding erreicht. Native Clients senden kein
`Origin` und sind nicht betroffen.

**Anfrage-Log (REQ-07, #3471).** Beide Transporte schreiben ein Log im
JSON-Lines-Format:

- Ort: `<workspace>/wsp/logs/mcp-server.log`; ohne aufgelösten Workspace
  `wsp/logs/mcp-server.log` im Ordner, der das SWAO-Binary enthält.
  `--log-file <path>` schreibt an einen anderen Ort; `--log-file -` schreibt
  nur nach stderr. Der stdio-Transport schreibt das Log nie nach stdout.
- Rotation bei 10 MB; fünf Dateien bleiben erhalten (`mcp-server.log` und
  `.1` bis `.4`).
- `--log-level error|warn|info|debug` (Standard `info`).
- Jede beantwortete Anfrage ist eine Zeile mit `ts`, `level`, `session`,
  `client`, `method`, `tool`, `duration_ms`, `status` (`ok`, `error` oder
  `cancelled`) und `error`. Tool-Argumente und Ergebnisse werden nie
  protokolliert; Fehlertexte laufen durch den Secret-Guard. Start, Stopp,
  abgebrochene und abgewiesene Anfragen, abgelaufene Sitzungen, unbehandelte
  Rejections und nicht abgefangene Exceptions werden ebenfalls protokolliert.
- Das `--http`-Banner nennt den Log-Pfad.

**Server beenden (REQ-07.6, #3471).** `Strg+C` (SIGINT) oder SIGTERM nimmt
keine neuen Verbindungen mehr an, lässt laufende Anfragen bis zu 5 Sekunden
fertig werden, beendet laufende CLI-Unterprozesse, entfernt die PID-Datei und
endet mit Exit-Code 0.

---

## 6. Verifikation

Nach dem Neustart des Clients:

1. Eine neue Konversation öffnen.
2. Eingeben: `swao`
3. Der Client ruft das Tool `swao` auf und gibt den SWAO-Übersichtsbildschirm
   des Workflows mit Tool-Liste und Schnellstartanleitung zurück.

Erscheint der Willkommensbildschirm, ist der Server verbunden und alle Tools
sind verfügbar. Zur gezielten Prüfung der Assessment-Tools eingeben:

```
Run swao_health_check
```

Erwartet: ein Health-Bericht, der die Probes für LLM, Credentials, Workspace und
Lizenz jeweils mit Bestanden/Fehlgeschlagen-Status auflistet.


![Claude Desktop beantwortet eine DSGVO-Frage mit Befunden aus dem SWAO-Signal-Tool](../../samples/16-mcp-deep-dive-question.png)
*Nach der Verbindung beantwortet der Client Fragen aus den Signalen des Workspace. Hier nennt Claude Desktop die wichtigsten DSGVO-Risiken der Demo-Anwendung Sovereign Health mit ihren Signal-IDs.*

---

## 7. Fehlerbehebung

### 7.1 Tools erscheinen nach dem Neustart nicht

Das Log des MCP-Servers prüfen. Bei einer Windows-Store-Installation:

```
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\mcp-server-SWAO.log
```

Unter macOS:

```
~/Library/Logs/Claude/mcp-server-SWAO.log
```

Ein erfolgreicher Start endet mit:

```
Server started and connected successfully
```

gefolgt von einem `tools/list`-Austausch, der die Tools des aktiven Profils auflistet.

### 7.2 „command not found“ oder Spawn-Fehler

**Binary-Modus:** prüfen, ob der Pfad zu `swao-enterprise-win-x64.exe` / `swao-macos` korrekt ist
und die Datei existiert. Zuerst direkt in einem Terminal ausführen (Abschnitt 2).

**Quellcode-Modus:** den vollständigen absoluten Pfad zu `node` verwenden. Ein
bloßes `node` im Feld command funktioniert nur, wenn der Client einen PATH
erbt, der es enthält, was auf keiner Plattform garantiert ist. Den Pfad mit
`where node` (Windows) oder `which node` (macOS/Linux) ermitteln.

### 7.3 Binary beendet sich sofort ohne Fehlermeldung

Das kann passieren, wenn das Binary in `Downloads` oder einem anderen Ordner mit
eingeschränkter Ausführungsrichtlinie liegt. Es an einen dauerhaften
Speicherort verschieben (z. B. `C:\tools\swao\`) und erneut versuchen. Unter
macOS muss eventuell das Quarantäne-Flag entfernt werden:
`xattr -d com.apple.quarantine /usr/local/bin/swao`.

### 7.4 Build-Fehler oder fehlende dist/index.js (nur Quellcode-Modus)

Aus `packages/swao/` neu bauen:

```bash
npx tsc --project tsconfig.json
```

TypeScript-Fehler beheben, bevor ein neuer Versuch erfolgt.

### 7.5 Server startet, aber Tools laufen in ein Timeout

Die SWAO-CLI startet für jeden Tool-Aufruf Unterprozesse. Laufen `swao_assess`
oder `swao_report` in ein Timeout, ist die häufigste Ursache ein fehlender oder
nicht erreichbarer LLM-Provider. Zuerst `swao_health_check` ausführen, um die
Konnektivität zu prüfen, und anschließend die Credentials in einem Terminal über
`swao credential set` setzen.

### 7.6 JSON-Parse-Fehler in der Konfigurationsdatei

Die Konfigurationsdatei muss gültiges JSON sein. Häufige Fehler: nachgestellte
Kommas, einfache Anführungszeichen, fehlendes Komma zwischen einem vorhandenen
Block und dem neuen `mcpServers`-Block. Mit einem beliebigen JSON-Linter
validieren oder mit:

```
node -e "JSON.parse(require('fs').readFileSync('<path-to-config>', 'utf8'))"
```

Keine Ausgabe bedeutet, dass die Datei gültig ist.

---

## 8. Neu bauen nach Quellcode-Änderungen (nur Quellcode-Modus)

Jede Änderung am MCP-Server oder an Dateien, die er importiert, erfordert einen
neuen Build:

```bash
cd packages/swao
npx tsc --project tsconfig.json
```

Nach dem Build den Client vollständig neu starten. MCP-Server werden einmalig
beim Start des Clients gestartet; bei einer erneuten Verbindung werden sie nicht
neu geladen.
