# SWAO -- Schnellstart

**Lesezeit:** 5 Minuten. **Von der Installation zur ersten Bewertung:** ca. 15 Minuten.

SWAO ist eine souveräne Workload-Bewertungsplattform. Aus einer Cloud-Anwendung erstellt es:
einen audit-konformen Bewertungsbericht, ein PowerBI-Dashboard, eine HTML-Veröffentlichung
und ein 7R-Migrationsurteil -- mit vollständiger Nachvollziehbarkeit für jedes Signal.

---

## Voraussetzungen

- Windows / macOS / Linux mit **Node.js >= 20**
- Einen zu bewertenden Workload (eigenes Repository oder mitgelieferter Beispiel-Workspace)
- Optional: **Anthropic-API-Schlüssel** für echte LLM-Analyse. Ohne ihn: `--skip-llm`.
- Optional: **Power BI Desktop** (nur Windows).

---

## Installation

```bash
cd packages/swao
npm install
npm run build
npm link
```

Verifizieren:

```bash
swao --version
# SWAO -- Sovereign Workload Assessment & Onboarding v0.11.2 (Community)
```

---

## Erste Bewertung -- über die geführte Oberfläche

Starten Sie SWAO ohne Argumente:

```bash
swao
```

Das Hauptmenü erscheint:

```
SWAO -- Sovereign Workload Assessment and Onboarding
Community  v0.11.2

  1  Workspace Setup       Init + LLM + Zugangsdaten-Assistent
  2  Health Check          swao health-check
  3  Run Assessment        Anwendung / Landing Zone / LLM + mehr
  4  Generate Report       swao report (Text / PDF)
  5  Publish HTML          swao publish -- eigenständige HTML-Datei
  6  Export BI             Sternschema / PowerBI / Tableau
  7  Portfolio Operations  Multi-App-Aggregation (Enterprise)
  8  Generate TF Modules   swao generate-tf
  9  Tools                 Linsen / Lizenz / Zugangsdaten / Hilfe
  0  Exit
```

> Siehe auch: [Beispielgalerie -- TUI-Hauptmenü](/samples/#sample-10)

### Schritt 1: Workspace-Setup-Assistent

Wählen Sie **1. Workspace Setup**. Der Assistent stellt vier Fragen:

1. **Workspace-Name** (z.B. `mein-engagement`)
2. **Anwendungsname** (z.B. `meine-app`)
3. **Compliance-Rahmenwerke** -- DSGVO ist vorausgewählt; weitere per `swao framework install`
4. **LLM-Anbieter** -- Anthropic, OpenAI, Ollama oder Offline-Stub

### Schritt 2: Health Check

Wählen Sie **2. Health Check**. Alle sieben Prüfungen grün: Sie sind bereit.

> Siehe auch: [Beispielgalerie -- Health Check](/samples/#sample-12)

### Schritt 3: Bewertung

Wählen Sie **3. Run Assessment** > **Application Assessment**. SWAO läuft automatisch.

| Workload-Größe | Dauer | Kosten |
|---|---|---|
| Klein (<100 Dateien) | ca. 30 Sek. | ca. 0,02 USD |
| Mittel (~1.000 Dateien) | 3-5 Min. | ca. 0,10 USD |
| Groß (~10.000 Dateien) | 10-15 Min. | ca. 0,50 USD |

### Schritt 4: Ergebnisse

Öffnen Sie die HTML-Veröffentlichung:

```
wsp/publications/latest/index.html
```

---

## Das PowerBI-Dashboard

Vorlage in Ihrem Workspace:

```
wsp/templates/powerbi/swao-report.pbit
```

In Power BI Desktop öffnen, `SWAOExportPath` auf den `star/`-Ordner setzen, **Laden** klicken.

---

## Alternativ: über die Befehlszeile

```bash
swao init --name meine-app
swao credential set anthropic-api-key
swao framework install GDPR
swao health-check
swao assess --app meine-app
swao export --app meine-app --formats csv,ndjson,xlsx
```

---

## Hilfe

```bash
swao --help
swao <befehl> --help
```

SWAO ist **ausschließlich dateibasiert** -- keine Telemetrie, kein Call-home.
