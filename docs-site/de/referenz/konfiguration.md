---
title: Konfiguration
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->

# Konfiguration

SWAO wird ueber eine `.swao.yml`-Datei im Workspace-Stammverzeichnis konfiguriert.

## Speicherort

Standardmaessig sucht SWAO im aktuellen Arbeitsverzeichnis nach `.swao.yml`. Sie koennen
dies mit dem globalen Flag `--config <pfad>` bei jedem Befehl ueberschreiben.

## Wichtige Felder

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| `app` | Ja | Ein kurzer Bezeichner fuer die zu bewertende Anwendung. Wird in Berichtsdateinamen und der TUI-Kopfzeile verwendet. |
| `framework` | Ja | Das Compliance-Framework, gegen das bewertet werden soll. Verfuegbare Werte erhalten Sie mit `swao framework list`. |
| `sourcePath` | Ja | Pfad (relativ zu `.swao.yml`) zu den Anwendungsquelldateien, die SWAO analysieren soll. |
| `outputPath` | Nein | Verzeichnis, in das HTML-Berichte geschrieben werden. Standard: `./swao-output`. |
| `llm.model` | Nein | LLM-Modellbezeichner. Standard: die eingebundenen Community-Edition-Modelleinstellungen. |
| `llm.maxTokens` | Nein | Ueberschreibt das maximale Token-Budget pro LLM-Aufruf. |

## Beispielkonfiguration

```yaml
app: zahlungsdienst

framework: gdpr

sourcePath: ./src

outputPath: ./berichte

llm:
  maxTokens: 4096
```

## Umgebungsvariablen

Umgebungsvariablen haben Vorrang vor Werten in `.swao.yml`, wenn beide vorhanden sind.

| Variable | Beschreibung |
|----------|--------------|
| `SWAO_LLM_KEY` | API-Schluessel fuer den konfigurierten LLM-Anbieter. Nicht in die Versionskontrolle aufnehmen. |
| `SWAO_OUTPUT_DIR` | Ueberschreibt `outputPath` ohne Bearbeitung der Konfigurationsdatei. Nuetzlich in CI-Pipelines. |

## Hinweise

- Speichern Sie `.swao.yml` in der Versionskontrolle neben Ihrer Anwendung, damit
  Bewertungseinstellungen reproduzierbar sind.
- Commit Sie niemals `SWAO_LLM_KEY` oder andere Secrets. Fuegen Sie `.env` zu Ihrer
  `.gitignore` hinzu.
- Fuehren Sie `swao doctor` nach jeder Aenderung an der Konfiguration aus, um zu bestaetigen,
  dass der Workspace noch gueltig ist.
