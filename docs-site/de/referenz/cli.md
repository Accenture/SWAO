---
title: CLI-Referenz
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->


# CLI-Referenz

Alle SWAO-Befehle folgen dem Muster `swao <befehl> [flags]`.

## Befehle

### `swao doctor`

Prueft, ob die Umgebung korrekt konfiguriert ist und alle erforderlichen Abhaengigkeiten
erreichbar sind.

| Flag | Beschreibung |
|------|--------------|
| `--json` | Ausgabe als JSON statt als Tabelle |

**Beispiel:**

```bash
swao doctor
```

---

### `swao assess`

Fuehrt eine Compliance-Bewertung fuer eine konfigurierte Anwendung durch.

| Flag | Beschreibung |
|------|--------------|
| `--app <name>` | Anwendungsbezeichner gemaess `.swao.yml` |
| `--framework <id>` | Ueberschreibt das in der Konfigurationsdatei deklarierte Framework |
| `--interactive` | Startet die TUI nach Abschluss der Bewertung |
| `--output <pfad>` | Schreibt den Bericht in einen benutzerdefinierten Ausgabepfad |
| `--quiet` | Unterdrueckt Fortschrittsausgabe; gibt nur die abschliessende Zusammenfassung aus |

**Beispiel:**

```bash
swao assess --app meine-app --framework gdpr
```

---

### `swao report`

Generiert oder oeffnet erneut den HTML-Bericht der letzten Bewertung.

| Flag | Beschreibung |
|------|--------------|
| `--open` | Oeffnet den Bericht nach der Generierung im Standardbrowser |
| `--output <pfad>` | Schreibt die HTML-Datei in einen benutzerdefinierten Pfad |

**Beispiel:**

```bash
swao report --open
```

---

### `swao framework list`

Listet alle in der aktuellen Installation verfuegbaren Compliance-Frameworks auf.

| Flag | Beschreibung |
|------|--------------|
| `--json` | Ausgabe als JSON |

**Beispiel:**

```bash
swao framework list
```

---

### `swao mcp`

Startet den SWAO Model Context Protocol-Server und macht SWAO-Tools fuer kompatible
KI-Clients verfuegbar.

| Flag | Beschreibung |
|------|--------------|
| `--http` | HTTP-Transport nutzen (Standard: `http://localhost:3737`) |
| `--port <n>` | Standardport ueberschreiben |

**Beispiel:**

```bash
swao mcp --http --port 3737
```

---

## Globale Flags

Diese Flags werden von jedem Befehl akzeptiert:

| Flag | Beschreibung |
|------|--------------|
| `--help`, `-h` | Hilfe fuer den aktuellen Befehl anzeigen |
| `--version`, `-v` | SWAO-Version ausgeben und beenden |
| `--config <pfad>` | Eine andere Konfigurationsdatei als `.swao.yml` verwenden |
