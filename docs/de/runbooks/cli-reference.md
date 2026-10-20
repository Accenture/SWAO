# CLI-Referenz

Schnellreferenz für alle SWAO-Befehle. Jeder Abschnitt enthält die Syntax, wichtige Flags und ein Beispielaufruf.

---

## Befehlsübersicht

| Befehl | Beschreibung |
|---|---|
| `swao health-check` | Gesundheitsprüfung: verifiziert Umgebung, Konfiguration und Konnektivität |
| `swao assess` | Vollständiges oder teilweises Workload-Assessment ausführen |
| `swao report` | Bericht aus einem bestehenden Assessment-Lauf generieren |
| `swao publish` | Berichtsgalerie im Browser öffnen oder als HTML exportieren |
| `swao init` | Neuen Workspace oder neue App scaffolden |
| `swao mcp` | MCP-HTTP-Server starten |
| `swao license` | Lizenzschlüssel und Stufenstatus verwalten |
| `swao migrate-config` | `.swao.yml` auf eine neuere Schema-Version migrieren |

Globale Flags, die für alle Befehle verfügbar sind:

| Flag | Beschreibung |
|---|---|
| `--version` | Installierte SWAO-Version ausgeben |
| `--help` | Befehlshilfe ausgeben |
| `--verbose` | Log-Ausführlichkeit erhöhen |
| `--workspace <path>` | Workspace-Pfad überschreiben (Standard: aktuelles Verzeichnis) |

---

## swao health-check

Prüft vor einem Assessment, ob die Umgebung korrekt konfiguriert ist. Führt eine Reihe von Prüfpunkten aus und meldet für jeden den Status Bestanden/Nicht bestanden. Ein fehlender Credential-Tresor ist eine Warnung (noch keine Zugangsdaten gespeichert, der Normalfall in einem neuen Workspace); ein Tresor, der sich nicht entschlüsseln lässt, ist ein Fehler.

```
swao health-check [--verbose]
```

| Flag | Beschreibung |
|---|---|
| `--verbose` | Detaillierte Prüfpunkt-Ausgabe einschließlich Teilprüfungen ausgeben |

```bash
# Basic health check
swao health-check

# With expanded probe output
swao health-check --verbose
```

Eine vollständige Erklärung der einzelnen Prüfpunkte findet sich unter [Doctor-Ausgabe verstehen](./doctor-output.md).

---

## swao assess

Ein Sovereign-Readiness-Assessment gegen eine oder mehrere Apps im Workspace ausführen.

```
swao assess --app <id> [options]
```

| Flag | Beschreibung |
|---|---|
| `--app <id>` | App-ID gemäß `.swao.yml` (erforderlich) |
| `--workspace <path>` | Pfad zum Workspace-Stammverzeichnis |
| `--skip-llm` | LLM-Passes überspringen (kein LLM-Anbieter erforderlich) |
| `--llm-provider <name>` | LLM-Provider für diesen Lauf überschreiben |
| `--passes <list>` | Kommagetrennte Liste der auszuführenden Passes (z. B. `static,compliance`) |
| `--stats` | Zeitmesstabelle pro Pass nach Abschluss ausgeben |
| `--output <path>` | Ausgabe-Stammverzeichnis überschreiben |

```bash
# Assess a single app
swao assess --app sovereign-health

# Assessment ohne LLM (--skip-llm)
swao assess --app sovereign-health --skip-llm --stats

# Run only the static and compliance passes
swao assess --app sovereign-health --passes static,compliance
```

---

## swao report

Einen Bericht aus einem bestehenden Assessment-Lauf generieren. Wird kein `--run` angegeben, wird der aktuellste Lauf verwendet.

```
swao report --app <id> [options]
```

| Flag | Beschreibung |
|---|---|
| `--app <id>` | App-ID (erforderlich) |
| `--format <fmt>` | Ausgabeformat: `text` (Standard), `yaml`, `json` (alle Stufen), `pdf`, `html` (Consultant oder Enterprise) |
| `--run <ts>` | Zeitstempel eines bestimmten Laufs (auch `runs/<ts>`); gilt für Application- und `--type landing-zone-catalog`-Berichte. Eine ungültige oder unbekannte Lauf-ID oder ein Lauf eines anderen Assessment-Typs beendet mit Exit-Code 1. Standard: aktuellster Lauf |
| `--output <path>` | Verzeichnis, in das die Berichtsdatei geschrieben wird |

```bash
# Generate PDF from latest run
swao report --app sovereign-health

# Generate HTML from a specific run
swao report --app sovereign-health --format html --run 2026-06-15T09-22-00
```

---

## swao publish

Die Berichtsgalerie im Standard-Browser öffnen oder als eigenständige HTML-Site exportieren.

```
swao publish [--app <id>] [--export <path>]
```

| Flag | Beschreibung |
|---|---|
| `--app <id>` | Galerie auf eine einzelne App beschränken |
| `--export <path>` | Galerie in ein Verzeichnis schreiben statt Browser zu öffnen |
| `--port <n>` | Lokaler Server-Port beim Öffnen im Browser (Standard: 4000) |

```bash
# Open gallery in browser
swao publish

# Export gallery to a directory
swao publish --export ./dist/gallery
```

---

## swao init

Einen neuen Workspace scaffolden oder eine neue App zu einem bestehenden Workspace hinzufügen. Die `.swao.yml` im Workspace-Stammverzeichnis (sie kennzeichnet den Workspace für `swao assess` und `swao report`) wird angelegt, wenn sie fehlt, und nie überschrieben.

```
swao init [--app <id>] [--workspace <path>]
```

| Flag | Beschreibung |
|---|---|
| `--app <id>` | Neues App-Verzeichnis mit einer Starter-Konfiguration scaffolden |
| `--workspace <path>` | Zielverzeichnis (Standard: aktuelles Verzeichnis) |
| `--interactive` | Interaktiven TUI-Setup-Assistenten starten |
| `--reconfigure` | Workspace-Scaffolds auffrischen (Community-Framework-Spiegel, Power-BI-Vorlagen sofern lizenziert, `.gitignore`); ohne `--name` bleibt `apps/` unverändert und es wird keine App angelegt. Mit `--name <app-id>` wird zusätzlich das Scaffold dieser App aufgefrischt, ohne ihre `.swao.yml` zu überschreiben |

```bash
# Scaffold a new workspace in the current directory
swao init

# Add a new app to an existing workspace
swao init --app my-new-app

# Launch interactive setup wizard
swao init --interactive
```

---

## swao mcp

Den SWAO-MCP-Server starten, standardmäßig über den stdio-Transport. Stellt
`swao_assess`, `swao_report`, `swao_health_check` und `swao_challenge` als
MCP-Tools für Claude Desktop, Claude.ai im Web oder jeden anderen
MCP-kompatiblen Client bereit.

Tools für das Service Portfolio Assessment (#3213): `swao_service_portfolio`,
`swao_service_app`, `swao_service_research`, `swao_service_waves`,
`swao_service_vendors`, `swao_service_delta`, `swao_service_scaffold`,
`swao_service_runs` (lesend; Sperre `service-assessment`, Community) sowie
`swao_service_init`, `swao_service_research_run` und `swao_service_export`
(Export: Enterprise), die
MCP-Gegenstücke zu `swao service`. Siehe MCP-Integrations-Runbook, Abschnitt 4.1.

```
swao mcp [options]
swao mcp install
```

| Flag | Beschreibung |
|---|---|
| `--http` | HTTP-Transport statt stdio verwenden (optional) |
| `--port <port>` | Listening-Port (Standard: 3737, nur mit `--http`) |
| `--workspace <path>` | Workspace-Stammverzeichnis festlegen |

Typische Verwendung: wird von Betreibern nicht direkt aufgerufen, sondern von
Claude Desktop anhand des `mcpServers`-Eintrags in dessen Konfigurationsdatei
gestartet. Der Status erscheint in `health-check` unter `SWAO-MCP`.

```bash
# Typically auto-launched by Claude Desktop (stdio transport)
swao mcp

# HTTP transport on a specific port
swao mcp --http --port 3737
```

### Claude-Desktop-Konfiguration (`swao mcp install`)

Speicherorte der Claude-Desktop-Konfiguration unter Windows:

- Installation aus dem Microsoft Store (MSIX):
  `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json`
  (nur berücksichtigt, wenn dieser Ordner existiert, also nachdem Claude Desktop
  mindestens einmal gestartet wurde)
- Direkte .exe-Installation (klassisch):
  `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop liest die Store-Konfiguration (MSIX), wenn sie existiert, sonst
die Konfiguration unter `%APPDATA%`. Unter macOS liegt die Konfiguration unter
`~/Library/Application Support/Claude/claude_desktop_config.json`.

**SWAO registrieren.** `swao mcp install`, `swao init --mcp` und der Schritt
„MCP Client“ im Setup-Assistenten wenden dieselbe Regel an: Sie aktualisieren
die Konfiguration, die Claude Desktop liest (bei Bedarf neu angelegt), sowie
jede weitere Konfiguration, die bereits einen SWAO-Eintrag enthält, und führen
jede Datei mit ihrem Ergebnis auf. Eine Konfiguration ohne SWAO-Eintrag wird
nicht angelegt oder geändert, solange Claude Desktop die Store-Konfiguration
liest. Alle drei registrieren dasselbe Binary: eine stabile Kopie im Ordner des
laufenden Binarys, damit ein Rebuild oder Upgrade des heruntergeladenen Binarys
nicht daran scheitert, dass Claude Desktop die registrierte Datei geöffnet
hält. Der Name der Kopie trägt auf jeder Plattform die Edition des laufenden
Binarys (`swao-<tier>-<os>-<arch>[.exe]`; das Enterprise-Binary unter Windows
registriert `swao-enterprise-win-x64.exe`), sodass ein Release-Binary unter
seinem eigenen Namen registriert wird und ein Binary einer Edition nie das
Binary einer anderen Edition überschreibt. Die MCP-Registrierung ist eine
Enterprise-Funktion: Aus dem Community- oder Consultant-Binary oder ohne
Enterprise-Lizenz lehnen alle drei mit der `[LICENSE]`-Meldung ab (die CLI
endet mit Exit-Code 1), bevor etwas kopiert oder geschrieben wird. Die Kopie wird nur angelegt, wenn das laufende Binary
ein SWAO-Release-Binary ist: Läuft SWAO aus dem Quellcode (`node dist/index.js`),
wird nichts kopiert, und der Eintrag registriert `node` mit dem Skriptpfad und
`mcp` als Argumenten. Ein vorhandener SWAO-Eintrag wird unter jedem Schlüssel
erkannt, ob er ein SWAO-Binary oder `node` mit einem SWAO-Skript registriert,
und an Ort und Stelle aktualisiert. Beenden Sie Claude Desktop nach jedem Upgrade vollständig
über das Symbol im Infobereich (Beenden, nicht nur das Fenster schließen),
führen Sie `swao mcp install` aus und starten Sie Claude Desktop anschließend
wieder. Solange Claude Desktop läuft, hält es die stabile Kopie geöffnet, sodass
sie nicht aktualisiert werden kann: `swao mcp install` gibt dann eine Warnung
aus und lässt die bisherige Kopie registriert.

```bash
# Write or refresh the SWAO entry in the Claude Desktop config(s)
swao mcp install
```

Den vollständigen Einrichtungsleitfaden finden Sie unter [MCP-Server-Integration](./mcp-integration.md).

---

## swao license

Lizenzschlüssel verwalten und Stufenstatus prüfen.

```
swao license <subcommand> [options]
```

| Unterbefehl | Beschreibung |
|---|---|
| `status` | aktuelle Stufe, Ablaufdatum und aktivierte Funktionen ausgeben |
| `request` | Lizenzanfrage-Token generieren |
| `activate <key>` | Lizenzschlüssel aktivieren |
| `export` | aktuelle Lizenz für Offline-Übertragung exportieren |
| `import <file>` | Lizenzdatei importieren |

```bash
swao license status
swao license request
swao license activate ABC123-DEF456-GHI789
```

Den vollständigen Workflow findet sich unter [Lizenzverwaltung](./licence-management.md).

---

## swao migrate-config

Eine `.swao.yml`-Datei von einer älteren Schema-Version auf die aktuelle Version migrieren.

```
swao migrate-config [--workspace <path>] [--dry-run]
```

| Flag | Beschreibung |
|---|---|
| `--dry-run` | Migrierte Konfiguration ausgeben ohne sie zu schreiben |
| `--workspace <path>` | Pfad zum Workspace-Stammverzeichnis |

```bash
# Preview the migration
swao migrate-config --dry-run

# Apply the migration
swao migrate-config
```
