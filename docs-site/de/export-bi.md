# BI exportieren

"BI exportieren" generiert ein Sternschema-Datenpaket aus den neuesten Bewertungsergebnissen
und bereitet es fuer den Ladevorgang in Power BI, Tableau oder ein anderes BI-Tool vor, das
CSV oder JSON lesen kann. Fuer Power-BI-Nutzer liefert SWAO vorgefertigte
`.pbit`-Dashboard-Vorlagen mit, die sich sofort mit diesem Paket verbinden.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **6**, oder ueber die
Befehlszeile:

```
swao export --app <app-id>
```

Fuer einen Portfolio-Export, der alle Anwendungen aggregiert:

```
swao export --portfolio
```

---

## Dashboard-Vorschau

Das Power-BI-Dashboard fuer einzelne Anwendungen gibt Ihnen einen sofortigen visuellen
Ueberblick ueber die Bewertung: Urteil, Abdeckungsscore, Compliance-Matrix, Risikoregister
und vollstaendige Signaldetails -- alles filterbar und mit Drilldown.

![Power BI dashboard overview](/samples/04-powerbi-dashboard-overview.png)

![Power BI compliance matrix](/samples/05-powerbi-compliance-matrix.png)

---

## Inhalt des Exportpakets

Jeder Export erzeugt einen konsistenten Satz von Dateien in
`apps/<id>/wsp/exports/latest/`:

| Datei | Inhalt |
|---|---|
| `dim_app.csv` | Anwendungsmetadaten: Name, Stack, 7R-Urteil, Abdeckungsscore |
| `dim_control.csv` | Framework-Steuerungen mit ID, Domaine und Beschreibung |
| `dim_evidence.csv` | Evidenzposten mit Quellpfad und Typ |
| `dim_signal.csv` | Alle Signale mit ID, Schweregrad, Steuerungszuordnung und Begruendung |
| `fact_pass_runs.csv` | Durchlauf-Statistiken pro Durchlauf: Echtzeit, Signalanzahl, LLM-Token-Verbrauch, Kosten |
| `fact_signals.csv` | Compliance-Urteil auf Signalebene (SATISFIED / GAP / PARTIAL) |
| `link_signal_evidence.csv` | Many-to-Many-Verknuepfung zwischen Signalen und Evidenzposten |
| `link_control_evidence.csv` | Many-to-Many-Verknuepfung zwischen Steuerungen und Evidenz |
| ... + 9 weitere Dimensions- und Faktentabellen | Vollstaendiges Sternschema fuer erweitertes Reporting |

Eine NDJSON-Spiegelung jeder Tabelle wird neben den CSV-Dateien fuer Tools generiert, die
JSON-Eingaben bevorzugen. Ein XLSX-Uebersichtsblatt ist ebenfalls fuer die schnelle
Pruefung in Excel ohne Laden der vollstaendigen Power-BI-Vorlage enthalten.

---

## Power-BI-Vorlagen

SWAO liefert zwei vorgefertigte Power-BI-Vorlagen (`.pbit`-Dateien) mit, die sich
automatisch mit dem Exportpaket verbinden, sobald Sie den Workspace-Pfad-Parameter
festlegen.

### Dashboard fuer einzelne Anwendungen

Sechs Berichtsseiten fuer eine Anwendung:

| Seite | Was angezeigt wird |
|---|---|
| Dashboard | 7R-Urteil, Abdeckungsscore, Signal-Ergebnis-Donut, Regelwerk-Luecken-Balkendiagramm |
| Compliance | Steuerungen-nach-Regelwerk-Matrix mit Farbkodierung fuer SATISFIED / GAP / PARTIAL |
| Signale | Vollstaendige Signalliste mit Schweregradfilter, Begruendungstext und Evidenzlinks |
| Risiken | Risikoregister-Tabelle, Risikoscore-Balkendiagramm, Kategorie-Donut |
| Pruefung | Falsch-positiv-Analyse auf Signalebene, Begruendungsabdeckungsmetriken, blockbasierte Bewertungen |
| Durchlaufstatistiken | Durchlauf-Timing, LLM-Kosten und Token-Aufschluesselung pro Durchlauf |

### Portfolio-Dashboard

Fuenf Berichtsseiten fuer alle Anwendungen im Workspace (Enterprise):

| Seite | Was angezeigt wird |
|---|---|
| Portfolio-Uebersicht | Anwendungsanzahl, kritische Risikoanzahl, durchschnittliche Abdeckung, 7R-Verteilungs-Donut, risikosortierte Tabelle |
| Compliance | Anwendungsuebergreifende Compliance-Matrix mit jeder Steuerung nach Framework und Anwendung |
| Signale | Portfolio-Signal-Browser |
| Pruefungs-Rollup | Aggregierte Begruendungsabdeckung, FP-Beruecksichtigungsrate, anwendungsuebergreifender Compliance-Status |
| Durchlaufstatistiken | Portfolio-Timing und Kostenzusammenfassung |

---

## Unterstuetzte Editionen

| Funktion | Community | Consultant | Enterprise |
|---|---|---|---|
| Sternschema CSV / NDJSON Export | Ja | Ja | Ja |
| Power-BI-Dashboard fuer einzelne Anwendungen | -- | Ja | Ja |
| Power-BI-Portfolio-Dashboard | -- | -- | Ja |

---

## Vorlagenanleitungen

Ausfuehrliche Anweisungen zum Verbinden der `.pbit`-Vorlagen mit Ihrem Exportpaket,
zur Parametrisierung von Abfragen und zur Datenaktualisierung finden Sie in der
Vorlagendokumentation:

- [Erstellungsanleitung -- Einzelanwendung](/de/exporte/powerbi)
