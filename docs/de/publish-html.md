# 5. HTML veröffentlichen

Wählen Sie Option 5 im Hauptmenü (oder führen `swao publish` aus), um eine **eigenständige HTML-Datei** aus Ihren Bewertungsergebnissen zu erstellen. Die Datei funktioniert offline, in luftgespalteten Umgebungen und als E-Mail-Anhang -- kein Server erforderlich.

## Was die Veröffentlichung enthält

| Ansicht | Zielgruppe | Inhalt |
|---|---|---|
| Führungsübersicht | Programmsponsor / CISO | 7R-Urteil, Abdeckungspunktzahl, wichtigste Risiken |
| Technische Erkenntnisse | Architekt / Entwickler | Alle Signale mit Begründung und Evidenzlinks |
| Compliance-Ansicht | DSB / Compliance-Beauftragter | Rahmenwerkspezifische Kontrolltabelle |
| Prüferansicht | Externer / interner Prüfer | Prüfprotokoll mit Zeitstempeln und Bewerteridentität |
| Evidenzgalerie | Prüfer | Screenshots und Artefakte aus der dynamischen Analyse |
| Laufprotokoll | Consultant | Dauer, LLM-Kosten, Durchlauf-Aufschlüsselung |

Die Veröffentlichung enthält einen Volltextsuchindex, der zur Generierungszeit erstellt wird -- kein externer Suchdienst.

## CLI

```bash
swao publish --app meine-app
# Ausgabe: wsp/publications/latest/index.html
```

## Edition

Verfügbar in **Consultant** und **Enterprise** Editionen.

Siehe auch: [Bericht erstellen](/de/generate-report) | [BI exportieren](/de/export-bi)
