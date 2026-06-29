# Werkzeuge

Der Werkzeuge-Bildschirm bietet Zugang zu Hilfsprogrammen, die den SWAO-Workspace
unterstuetzen, anstatt Bewertungen direkt durchzufuehren. Dies sind Konfigurations-,
Lizenzierungs- und Diagnosefunktionen, die Sie verwenden, um den Workspace aktuell zu
halten und Probleme zu beheben.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **9**.

---

## Verfuegbare Werkzeuge

### Linsen

Linsen sind wiederverwendbare Perspektiven, die die Signal- und Compliance-Ansicht auf
einen spezifischen Winkel filtern: regulatorisch, architektonisch oder persona-basiert.

Beispiele:

| Linse | Was gefiltert wird |
|---|---|
| DSGVO / DSB | Nur Datenresidenz- und Datenhandhabungssteuerungen |
| Finanzdienstleistungen | DORA-, MAS-TRM- und SOX-relevante Steuerungen |
| Sicherheitsarchitektur | Alle sicherheitsbezogenen Signale ueber alle Durchlaeufe |
| Migrationsleitung | Nur 7R-Migrationssignale und Landing-Zone-Signale |

Wenden Sie eine Linse im Werkzeuge-Bildschirm an, um zu aendern, welche Signale in der
Publikation und im Pruefbericht erscheinen, ohne die Bewertung erneut durchzufuehren.
Linsen aendern nicht den zugrunde liegenden Signalsatz -- sie aendern die Ansicht.

---

### Lizenz

Das Lizenz-Werkzeug zeigt:

- Aktuelle Edition (Community / Consultant / Enterprise)
- Lizenzschluessel-Status und Ablaufdatum
- Durch die aktuelle Lizenz aktivierte Funktionen

So aktivieren oder aktualisieren Sie einen Lizenzschluessel:

```
swao tools license --key <your-key>
```

Wenn Sie die Community-Edition verwenden und Enterprise-Funktionen testen moechten, wenden
Sie sich an Ihren Accenture-Auftragssponsor oder stellen Sie eine Anfrage ueber den
SWAO-Servicekatalog.

---

### Anmeldeinformationen

"Anmeldeinformationen" verwaltet die Secrets, die SWAO fuer den Aufruf externer Dienste
verwendet:

| Anmeldeinformation | Verwendet fuer |
|---|---|
| LLM-Anbieter-API-Schlussel | Anwendungs- und LLM-Bewertungsdurchlaeufe |
| VCS-Token | Klonen privater Repositories fuer die Bewertung |
| Container-Registry-Token | Abrufen von Images fuer die Container-Durchlaufanalyse |
| CMDB / ServiceNow-Token | Kontextimport aus ITSM-Quellen |

Anmeldeinformationen werden verschluesselt im Workspace-Secrets-Store (`wsp/.secrets/`)
gespeichert, niemals in `.swao.yml` oder einer nachverfolgten Datei. Der Health Check
bestaetigt, dass jede Anmeldeinformation vorhanden ist und der Zieldienst antwortet,
bevor Sie eine Bewertung starten.

So legen Sie eine Anmeldeinformation fest:

```
swao tools credentials --set llm-api-key
```

SWAO fordert den Wert interaktiv an, damit er nicht im Shell-Verlauf erscheint.

---

### Hilfe

Oeffnet die kontextbezogene Hilfe fuer jeden SWAO-Befehl oder -Bildschirm. Sie koennen
auch direkt von der Befehlszeile auf die Hilfe zugreifen:

```
swao help
swao help assess
swao help publish
```

Die vollstaendige Produktdokumentation finden Sie in der
[SWAO-Projektdokumentation](https://github.com/Accenture/SWAO).
