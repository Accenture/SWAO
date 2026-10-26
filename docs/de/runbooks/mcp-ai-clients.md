---
title: SWAO aus einem KI-Client nutzen
status: accepted
purpose: SWAO über MCP mit einem KI-Client verbinden (Claude Code, Kilo, Claude Desktop, Cursor, VS Code), ein Tool-Profil wählen, Client-Eintrag und schlanken Agenten mit einem Befehl installieren, SWAO für kleine lokale Modelle dimensionieren und die bekannten Client-Fallstricke vermeiden.
authors: [Accenture/SWAO]
related: [de/runbooks/mcp-integration.md]
last_updated: 2026-10-24
---

<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     SWAO aus einem KI-Client nutzen
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# SWAO aus einem KI-Client nutzen

<Badge type="warning" text="Enterprise"/> Der SWAO-MCP-Server ist Teil der Enterprise-Edition.

Diese Seite ist der kurze Weg: Transport und Profil wählen, einen Installationsbefehl für den Client
ausführen, prüfen und loslegen. Das [Runbook zum MCP-Server](./mcp-integration.md) enthält die vollständige
Referenz (Installationsmodi, alle Tools, manuelle Konfiguration, Fehlerbehebung).

## 1. stdio oder HTTP

| Transport | Start | Einsatz |
|---|---|---|
| stdio (Standard) | der Client startet `swao mcp` selbst | Claude Desktop, Kilo, Cursor, VS Code auf demselben Rechner |
| HTTP | Sie starten `swao mcp --http` und lassen es laufen | Claude Code in einer verwalteten Umgebung, Clients in Containern, mehrere Clients gleichzeitig |

HTTP-Optionen:

- `--port <port>`: Port, Standard `3737`. Die Client-URL ist `http://localhost:3737/mcp`.
- `--host <addr>`: Bind-Adresse, Standard `localhost` (IPv4- und IPv6-Loopback). Eine Adresse außerhalb
  von Loopback braucht `--allow-remote`; der Server hat keine Authentifizierung.
- `--replace`: den SWAO-MCP-Server, der bereits auf dem Port läuft, beenden und an seiner Stelle starten.
  Ein Prozess, der kein SWAO-MCP-Server ist, wird nie beendet. Ohne die Option endet ein belegter Port mit
  Exit-Code 1.
- `--workspace <path>`: Workspace festlegen (auch `SWAO_WORKSPACE`). Ein festgelegter Server blendet den
  Tool-Parameter `workspace_path` aus.

Clients mit HTTP starten den Server nicht: zuerst `swao mcp --http` starten, dann den Client.

## 2. Profile

Jeder MCP-Client sendet die vollständige Tool-Liste mit jeder Modellanfrage. Das Profil bestimmt daher,
wie viel vom Kontext des Modells SWAO belegt.

| Profil | Tools | Einsatz |
|---|---|---|
| `starter` | 5: Übersicht, Health Check, Workspace-Inventar, Frameworks, Passes | Erster Kontakt, Demos, lokale Modelle mit 8k bis 16k Kontext |
| `assess` | 14: `starter` plus Assessment, Report, Signale, Controls, Risiken, Veröffentlichung, Landing-Zone-Erklärung, Kosten | Assessment einer Anwendung auf lokalen Modellen mit 16k bis 32k |
| `full` | alle Tools | Gehostete Modelle, Portfolio- und Service-Arbeit |

Auswahl mit `swao mcp --profile <name>` oder einer exakten Liste mit `swao mcp --tools <names>`. Ohne Flag
liest der Server `SWAO_MCP_PROFILE` oder `SWAO_MCP_TOOLS`, dann die `.swao.yml` des Workspace:

```yaml
mcp:
  profile: starter        # starter | assess | full
```

und verwendet sonst `full`. `swao mcp profiles` zeigt jedes Profil mit seinen Tools und der gemessenen
Größe. Ein Tool außerhalb des Profils wird nicht gelistet; ein Aufruf liefert einen Fehler, der das Profil
nennt.

## 3. Installation für Ihren Client

`swao mcp install --client <name>` schreibt den SWAO-Eintrag in die Konfiguration des Clients und für Kilo
und Claude Code zusätzlich eine schlanke Agentendatei. Der Befehl kann gefahrlos wiederholt werden:

- eine Datei, die kein gültiges JSON ist (auch JSON mit Kommentaren), wird nie neu geschrieben: der Befehl
  nennt Datei und Fehler und endet mit Exit-Code 2;
- nur der SWAO-Eintrag ändert sich; andere Server, Schlüssel und das Dateilayout bleiben unverändert;
- ein vorhandener Eintrag `swao` oder `SWAO` wird unter seinem eigenen Namen aktualisiert;
- vor jedem Schreiben wird das Original nach `<file>.swao-backup-<timestamp>` kopiert;
- ein zweiter identischer Lauf meldet "no change";
- `--dry-run` zeigt die Änderung als Diff und schreibt nichts;
- `--uninstall` entfernt genau den SWAO-Eintrag (und die erzeugte Agentendatei), mit Backup.

Optionen (`--profile` und `--workspace` sind Optionen von `swao mcp` und gelten auch hier):

| Option | Bedeutung |
|---|---|
| `--client <name>` | `claude-code`, `kilo`, `claude-desktop`, `cursor` oder `vscode` |
| `--scope user` oder `--scope project` | Benutzerkonfiguration (Standard) oder die Konfiguration im aktuellen Ordner |
| `--transport stdio` oder `--transport http` | Standard `http` für Claude Code, sonst `stdio` |
| `--url <url>` | mit `--transport http`: Server-URL, Standard `http://localhost:3737/mcp` |
| `--agent`, `--no-agent` | schlanke Agentendatei schreiben (Standard für Kilo und Claude Code) oder nicht |
| `--profile <name>` | Standard `starter` mit Agent, `full` ohne |
| `--workspace <path>` | Workspace für stdio-Einträge (Standard: der Workspace, den SWAO findet) |
| `--dry-run` | Diff zeigen, nichts schreiben |
| `--uninstall` | SWAO-Eintrag und erzeugte Agentendatei entfernen |

Ohne `--client` verhält sich `swao mcp install` wie bisher und aktualisiert die Konfiguration von Claude
Desktop. Der MCP-Schritt des Setup-Assistenten bietet dieselbe Auswahl (Claude Desktop, Claude Code, Kilo).

### 3.1 Claude Code

```bash
swao mcp install --client claude-code
swao mcp --http --profile starter
```

Der erste Befehl führt `claude mcp add --transport http --scope user swao http://localhost:3737/mcp` aus,
wenn das `claude`-CLI im PATH liegt (ein vorhandener Eintrag `SWAO` wird unter seinem Namen ersetzt), und
schreibt `~/.claude/agents/swao.md`. Ohne `claude`-CLI oder mit `--scope project` schreibt er stattdessen
die Projektdatei `.mcp.json` und `.claude/agents/swao.md`. Der zweite Befehl startet den Server; lassen Sie
ihn laufen. In einer verwalteten Umgebung akzeptiert Claude Code nur HTTP-Server unter `http://localhost`
(ADR-0045); `--transport stdio` nur auf einem nicht verwalteten Rechner verwenden.

### 3.2 Kilo

```bash
swao mcp install --client kilo
```

Schreibt `~/.config/kilo/kilo.json` (Projekt: `./kilo.json` oder `.kilo/kilo.json`) mit einem lokalen
Eintrag, der das SWAO-Binary mit absolutem Pfad und `mcp --workspace <path> --profile starter` startet,
sowie die Agentendatei `~/.config/kilo/agents/swao.md` (Projekt: `.kilo/agents/swao.md`). Für Kilo in einem
Container `--transport http --url http://<gateway address>:3737/mcp` verwenden und `swao mcp --http` auf
dem Host starten.

### 3.3 Claude Desktop

```bash
swao mcp install --client claude-desktop --profile starter
```

Aktualisiert die Konfiguration von Claude Desktop (Store- und direkte Installation, sofern vorhanden) und
ergänzt `--profile` nur, wenn Sie es angeben. Claude Desktop hat keine Agentendatei.

### 3.4 Cursor

```bash
swao mcp install --client cursor --profile assess
```

Schreibt `~/.cursor/mcp.json` (Projekt: `.cursor/mcp.json`). Das Profil begrenzt die Tools, die Cursor sieht.

### 3.5 VS Code

```bash
swao mcp install --client vscode --scope project --profile assess
```

Schreibt `.vscode/mcp.json` im aktuellen Ordner. Nur `--scope project` wird unterstützt; ein Chat-Modus
oder eine Agentendatei wird nicht geschrieben.

## 4. Prüfen

- Claude Code: `claude mcp list` zeigt `swao` (oder `SWAO`) als verbunden, solange `swao mcp --http` läuft.
- Kilo: `kilo mcp list` zeigt `swao`.
- Claude Desktop, Cursor, VS Code: Client neu starten und die SWAO-Tools in der Tool- oder MCP-Ansicht suchen.
- Fragen Sie "show the swao welcome screen". Die Antwort muss die SWAO-Build-Version zeigen.

## 5. Kleine lokale Modelle

- `--profile starter` und den schlanken Agenten verwenden (Standard der Installation). Zusammen zielen sie
  auf weniger als 4.000 Prompt-Tokens je Anfrage (Design 116 Abschnitt 8.3); der Standard-Coding-Agent
  eines Clients kann allein 14.000 bis 15.000 Tokens kosten (Design 116 F-12).
- Mit dem Prompt `start` beginnen: Claude Code `/mcp__swao__start`, Kilo `/swao:start`. Er liefert das
  SWAO-Hauptmenü ohne Tool-Aufruf.
- Exakte Fragen stellen, die ein Tool benennen: "run the swao health check", "list the swao compliance
  frameworks". Offene Fragen lassen ein kleines Modell raten.
- Für ein Assessment zu `assess` wechseln, mit einem gehosteten Modell zu `full`.

## 6. Request-Log

`swao mcp` protokolliert jede Anfrage als eine JSON-Zeile (Methode, Tool-Name, Dauer, Status; nie
Argumente oder Ergebnisse) in `<workspace>/wsp/logs/mcp-server.log`; ohne gefundenen Workspace in
`wsp/logs/` neben dem SWAO-Binary. Das Log rotiert bei 10 MB und behält fünf Dateien. `--log-file <path>`
wählt eine andere Datei (`-` schreibt nur in den Fehlerkanal), `--log-level` setzt `error`, `warn`,
`info` (Standard) oder `debug`.

## 7. Fallstricke der Clients

- **Kilo: eine `tools`-Map blendet MCP-Tools aus.** `tools: {"*": false, ...}` entfernt die SWAO-Tools aus
  der Anfrage, auch wenn die Berechtigungsansicht sie als erlaubt zeigt. Tools mit `permission:` begrenzen:
  `"*": deny`, danach ein `allow` je Tool, wie im erzeugten Agenten.
- **Kilo-Berechtigungsregeln: die letzte passende Regel gewinnt.** Breite Muster zuerst, spezifische danach.
- **Kilo-Tool-Namen** lauten `<server name>_<tool>`, zum Beispiel `swao_swao_health_check`.
- **Kilo zeigt Abschneiden nur als Kontext "101%"** in der Seitenleiste; sichtbar wird es daran, dass SWAO
  die falsche Frage beantwortet. Ein kleineres Profil verwenden.
- **Kilo-Skills kosten einen Umlauf und Kontext.** Statt eines Skills mit dem Menü den Prompt `start`
  verwenden.
- **Clients in Containern** können das Host-Binary nicht über stdio starten. `--transport http` mit einer
  URL verwenden, die der Container erreicht (Host-Netzwerk oder Gateway-Adresse des Containers mit `--url`).
- **Claude Code in einer verwalteten Umgebung** akzeptiert nur Server unter `http://localhost` und blockiert
  stdio-Server anhand des Namens (ADR-0045). `swao mcp --http` vor der Nutzung starten; Claude Code startet
  ihn nicht.
