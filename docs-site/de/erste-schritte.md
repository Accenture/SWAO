---
title: Erste Schritte
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->

# Erste Schritte

Diese Anleitung fuehrt Sie durch die Einrichtung von SWAO und die Durchfuehrung Ihrer ersten
Workload-Bewertung.

## Voraussetzungen

Stellen Sie sicher, dass Folgendes installiert ist:

- **Node.js 20 oder hoeher** -- herunterladen unter [nodejs.org](https://nodejs.org/)
- **pnpm** -- Installation mit `npm install -g pnpm`

## Installation

Binaere Downloads fuer die SWAO Community Edition sind in Phase 2 des Veroeffentlichungsprogramms
geplant. Aktuelle Informationen finden Sie auf der
[GitHub-Releases-Seite](https://github.com/Accenture/SWAO/releases).

In der Zwischenzeit koennen Sie SWAO direkt aus dem Quellcode ausfuehren:

```bash
git clone https://github.com/Accenture/SWAO.git
cd SWAO
pnpm install
pnpm build
```

## Schnellstart

Fuehren Sie diese fuenf Schritte aus, um Ihre erste Bewertung abzuschliessen:

**Schritt 1 -- Workspace initialisieren**

Erstellen Sie ein Arbeitsverzeichnis und initialisieren Sie die SWAO-Konfigurationsdatei:

```bash
mkdir meine-bewertung && cd meine-bewertung
swao init
```

Dadurch wird eine `.swao.yml`-Datei im aktuellen Verzeichnis erstellt. Bearbeiten Sie diese,
um auf Ihre Anwendungsquelle zu verweisen und ein Compliance-Framework auszuwaehlen.

**Schritt 2 -- Umgebung pruefen**

Fuehren Sie den Diagnosebefehl aus, um zu bestaetigen, dass SWAO alle erforderlichen
Abhaengigkeiten erreichen kann:

```bash
swao doctor
```

Beheben Sie alle gemeldeten Probleme, bevor Sie fortfahren.

**Schritt 3 -- Bewertung ausfuehren**

Fuehren Sie eine Compliance-Bewertung fuer Ihre konfigurierte Anwendung aus:

```bash
swao assess --app <name>
```

Ersetzen Sie `<name>` durch den in Ihrer `.swao.yml` definierten Anwendungsbezeichner. SWAO
analysiert den Quellpfad und gibt Befunde fuer jede anwendbare Kontrolle aus.

**Schritt 4 -- HTML-Bericht oeffnen**

Oeffnen Sie nach Abschluss der Bewertung den generierten HTML-Bericht im Browser:

```bash
swao report --open
```

Der Bericht enthaelt jeden Befund, seinen Evidenzlink und eine Zusammenfassung nach
Kontrolldomaene.

**Schritt 5 -- Interaktive TUI erkunden**

Fuer eine navigierbare Ansicht der Befunde direkt im Terminal starten Sie die Bewertung
im interaktiven Modus:

```bash
swao assess --interactive
```

Navigieren Sie mit den Pfeiltasten und beenden Sie mit `q`.

## Naechste Schritte

- [CLI-Referenz](/de/referenz/cli) -- vollstaendige Befehls- und Flag-Dokumentation
- [Konfiguration](/de/referenz/konfiguration) -- alle `.swao.yml`-Optionen erlaeutert
- [Frameworks](/de/frameworks/dsgvo) -- unterstuetzte Compliance-Frameworks
