# Bericht erstellen

"Bericht erstellen" erzeugt Text- und Markdown-Berichte aus den neuesten Bewertungsergebnissen.
Berichte geben Ihnen eine portable, lesbare Version der Befunde, die mit Gutachtern geteilt
werden koennen, die weder SWAO noch Power BI installiert haben.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **4**, oder ueber die
Befehlszeile:

```
swao report --app <app-id>
```

---

## Beispielausgabe

Der Pruefbericht ist ein strukturiertes Markdown-Dokument, das Sie in einem beliebigen
Editor oeffnen, per E-Mail versenden oder direkt in GitHub oder Confluence rendern koennen.

![Auditor report excerpt](/samples/09-auditor-md-excerpt.png)

---

## Berichtsformate

| Format | Datei | Am besten geeignet fuer |
|---|---|---|
| **Markdown-Pruefbericht** | `apps/<id>/wsp/auditor.md` | Compliance-Pruefer, die Text bevorzugen; Drucken; E-Mail-Anhang |
| **YAML-Signalpaket** | `apps/<id>/wsp/signals/*.yaml` | Nachgelagerte Tools; Import in andere Systeme |
| **JSON-Zusammenfassung** | `apps/<id>/wsp/summary.json` | API-Verbraucher; benutzerdefinierte Dashboards |
| **PDF** | `apps/<id>/wsp/reports/<id>.pdf` | Formelle Einreichung; erfordert Playwright |

---

## Inhalte des Pruefberichts

Der Markdown-Pruefbericht (`auditor.md`) ist die menschenlesbare Version der vollstaendigen
Bewertung. Er enthaelt:

- **Zusammenfassungsblock** -- Workload-Identitaet, 7R-Migrationsurteil, Abdeckungsscore,
  aktive Frameworks, Signalausgabe-Zaehlung.
- **Compliance-Status nach Framework** -- jede Steuerung mit ihrem Urteil (SATISFIED / GAP /
  PARTIAL / NOT ASSESSED) und dem erzeugenden Begruendungstext.
- **Risikoregister** -- abgeleitete Risiken mit Eintrittswahrscheinlichkeit, Auswirkung,
  Ausloser und Massnahme.
- **Signaldetailansicht** -- jedes Signal mit ID, Schweregrad, Evidenzreferenz und dem
  Flag `false_positive_considered`.
- **Durchlaufstatistiken** -- welche Durchlaeufe ausgefuehrt wurden, wie viele Signale jeder
  produziert hat, Echtzeit und LLM-Token-Verbrauch.

---

## PDF-Generierung

Die PDF-Ausgabe erfordert eine Playwright-Installation (siehe Health-Check-Pruefung 2). Wenn
Playwright vorhanden ist, rendert SWAO die HTML-Publikation automatisch zu PDF, wenn Sie
den Parameter `--format pdf` hinzufuegen:

```
swao report --app <app-id> --format pdf
```

Das PDF ist eine originalgetreue Wiedergabe der HTML-Publikation einschliesslich aller
Diagramme und Tabellen in einem Format, das fuer die formelle Einreichung bei einer
Regulierungsbehoerde oder einem externen Pruefer geeignet ist.

---

## Berichte neu generieren

Berichte werden immer aus dem gespeicherten Signalsatz generiert -- sie erfordern keinen
neuen Bewertungsdurchlauf. Wenn Sie ein Kontextdokument aktualisieren oder die aktiven
Frameworks aendern und die Auswirkungen sehen moechten, fuehren Sie zuerst die Bewertung
erneut durch, und generieren Sie dann die Berichte neu.
