# HTML veroeffentlichen

"HTML veroeffentlichen" generiert eine eigenstaendige HTML-Publikation aus den neuesten
Bewertungsergebnissen. Die Datei ist unter 2 MB gross, wird in jedem Browser geoeffnet,
funktioniert vollstaendig offline und kann direkt per E-Mail an den Kunden gesendet werden,
ohne dass SWAO auf dessen Seite installiert sein muss.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **5**.

![SWAO Publish HTML screen](/samples/14-tui-publish-html.png)

---

## Veroeffentlichungsoptionen

Der Veroeffentlichungsbildschirm bietet zwei aktive Pfade:

### [1] Einzelne HTML-Seite -- `swao publish --app <id>`

Generiert eine einzelne `.html`-Datei, die die vollstaendige Bewertungspublikation enthaelt.
Die Datei wird in `apps/<id>/wsp/publications/<timestamp>-<id>.html` geschrieben.

Die Publikation enthaelt:

- **Zusammenfassung fuer die Geschaeftsfuehrung** -- 7R-Migrationsurteil, Abdeckungsscore
  und Top-Risiken in einem Format, das eine fuehrende Stakeholderin oder ein fuehrender
  Stakeholder in fuenf Minuten lesen kann.
- **Compliance-Seiten** -- Steuerungen nach Framework gruppiert, jeweils mit Urteil,
  Begruendung und Evidenzlinks.
- **Risikoregister** -- interaktive Tabelle, sortierbar nach Score, Kategorie und
  Eintrittswahrscheinlichkeit.
- **Signal-Explorer** -- jedes Signal mit vollstaendiger Begruendung und Evidenz, suchbar
  nach ID oder Schluesselwort.
- **Prueferansicht** -- falsch-positiv-Analyse auf Signaleben und Begruendungsabdeckungs-
  metriken.
- **Durchlaufstatistiken** -- Durchlauf-Timing, LLM-Token-Verbrauch und Kostenzusammenfassung.

**Persona-Ansichten:** Leser koennen in der Publikation zwischen vier Ansichten wechseln --
Geschaeftsfuehrung, Technik, Pruefung und DSB -- jeweils gefiltert nach den fuer diese
Rolle relevantesten Signalen und Steuerungen.

### [2] HTML-Editor -- `swao publish --edit`

Oeffnet einen interaktiven browserbasierten Editor, in dem Sie die Publikation vor dem
Speichern der endgueltigen Datei anpassen koennen. Verwenden Sie den Editor, um:

- Beraterkommentare und Auftragskontext hinzuzufuegen.
- Signale zu unterdruecken, die als falsch positiv akzeptiert wurden.
- Den Wortlaut der Zusammenfassung fuer die Geschaeftsfuehrung fuer das jeweilige Publikum
  anzupassen.
- Persona-Ansichten vor der Uebergabe in der Vorschau zu pruefen.

Aenderungen werden in derselben workspace-seitigen Quelle gespeichert -- eine erneute
Veroeffentlichung zu einem beliebigen Zeitpunkt erstellt das HTML aus dem aktuellen
Editorstatus neu.

---

## Demnachst verfuegbare Optionen

| Option | Geplant |
|---|---|
| JSON-Datenexport | Strukturierter Export des Publikationsdatenmodells |
| HTML-Website | Mehrseitige statische Website mit Suche und Navigation |
| HTML-Portal | Mandantenfaehiges Portal mit Anwendungs- und Portfolio-Ansichten |

---

## Publikation teilen

Die HTML-Datei ist vollstaendig eigenstaendig -- keine externen Abhaengigkeiten, kein Server
erforderlich. Sie koennen:

- Sie als Anhang per E-Mail versenden.
- Sie in eine SharePoint- oder Teams-Dokumentbibliothek hochladen.
- Sie im Auftragsarchiv neben den Pruefungsnachweisen speichern.

Der Dateiname enthaelt einen Zeitstempel (`<yyyy-mm-dd-HHmm>-<app-id>.html`), sodass
mehrere Publikationen aus verschiedenen Bewertungsdurchlaeufen als Versionshistorie im
Publikationsordner gespeichert werden.
