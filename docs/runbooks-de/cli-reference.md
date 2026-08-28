# CLI-Referenz

Schnellreferenz für alle SWAO-Befehle. Jeder Abschnitt enthält die Syntax, wichtige Flags und ein Beispielaufruf.

---

## Befehlsübersicht

| Befehl | Beschreibung |
|---|---|
| `swao health-check` | Gesundheitsprüfung -- verifiziert Umgebung, Konfiguration und Konnektivität |
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

Prüft vor einem Assessment, ob die Umgebung korrekt konfiguriert ist. Führt eine Reihe von Prüfpunkten aus und meldet für jeden den Status Bestanden/Nicht bestanden.

```
swao health-check [--verbose]
```

| Flag | Beschreibung |
|---|---|
| `--verbose` | Detaillierte Prüfpunkt-Ausgabe einschliesslich Teilprüfungen ausgeben |

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
| `--app <id>` | App-ID gemäss `.swao.yml` (erforderlich) |
| `--workspace <path>` | Pfad zum Workspace-Stammverzeichnis |
| `--skip-llm` | Stub-LLM verwenden (Offline-Modus; kein API-Key erforderlich) |
| `--llm-provider <name>` | LLM-Provider für diesen Lauf überschreiben |
| `--passes <list>` | Kommagetrennte Liste der auszuführenden Passes (z. B. `static,compliance`) |
| `--stats` | Zeitmesstabelle pro Pass nach Abschluss ausgeben |
| `--output <path>` | Ausgabe-Stammverzeichnis überschreiben |

```bash
# Assess a single app
swao assess --app sovereign-health

# Assess with stub LLM and timing output
swao assess --app sovereign-health --skip-llm --stats

# Run only the static and compliance passes
swao assess --app sovereign-health --passes static,compliance
```

---

## swao report

Einen Bericht aus einem bestehenden Assessment-Lauf generieren. Wird kein `--run-id` angegeben, wird der aktuellste Lauf verwendet.

```
swao report --app <id> [options]
```

| Flag | Beschreibung |
|---|---|
| `--app <id>` | App-ID (erforderlich) |
| `--format <fmt>` | Ausgabeformat: `pdf`, `html`, `json` (Standard: `pdf`) |
| `--run-id <ts>` | Zeitstempel eines bestimmten Laufs; Standard: aktuellster Lauf |
| `--output <path>` | Verzeichnis, in das die Berichtsdatei geschrieben wird |

```bash
# Generate PDF from latest run
swao report --app sovereign-health

# Generate HTML from a specific run
swao report --app sovereign-health --format html --run-id 2026-06-15T09-22-00
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

Einen neuen Workspace scaffolden oder eine neue App zu einem bestehenden Workspace hinzufügen.

```
swao init [--app <id>] [--workspace <path>]
```

| Flag | Beschreibung |
|---|---|
| `--app <id>` | Neues App-Verzeichnis mit einer Starter-Konfiguration scaffolden |
| `--workspace <path>` | Zielverzeichnis (Standard: aktuelles Verzeichnis) |
| `--interactive` | Interaktiven TUI-Setup-Assistenten starten |

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

Den SWAO-MCP-HTTP-Server für die Integration mit KI-Assistenten starten.

```
swao mcp --http [options]
```

| Flag | Beschreibung |
|---|---|
| `--http` | HTTP-Transport verwenden (erforderlich; stdio-Transport nicht verfügbar) |
| `--port <n>` | Listening-Port (Standard: 3737) |
| `--log-level <l>` | Log-Ausführlichkeit: `debug`, `info`, `warn`, `error` |

```bash
swao mcp --http
swao mcp --http --port 8080 --log-level debug
```

Den vollständigen Einrichtungsleitfaden findet sich unter [MCP-Server-Integration](./mcp-integration.md).

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
