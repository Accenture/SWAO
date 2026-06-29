# Portfolio-Operationen

Portfolio-Operationen bietet eine aggregierte Ansicht aller Anwendungen in Ihrem Workspace,
sodass Sie Befunde vergleichen, Migrationswellen planen und ein Compliance-Bild auf
Portfolio-Ebene fuer Fuehrungs- und Regulierungsorganisationen erstellen koennen.

Diese Funktion ist in der **Enterprise-Edition** verfuegbar.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **7**.

---

## Funktion

Waehrend einzelne Anwendungsbewertungen Ihnen tiefgehende Befunde fuer eine Anwendung
liefern, kombiniert Portfolio-Operationen diese zu einer einheitlichen klaeren Ansicht:

- **Aggregiertes Risikoregister** -- alle Risiken aus allen Anwendungen in einer
  priorisierten Liste.
- **Anwendungsuebergreifende Compliance-Matrix** -- jede Framework-Steuerung gegenueber
  jeder Anwendung dargestellt, sodass Sie sehen, welche Steuerungen konsistent bestehen
  und wo portfolioweite Luecken bestehen.
- **Migrationswellenplanung** -- Anwendungen werden gruppiert und sequenziert fuer die
  Migration basierend auf ihren 7R-Urteilen, Risikoscores und Abhaengigkeitsbeziehungen.
- **Portfolio-BI-Export** -- das Portfolio-Sternschema, das das Power-BI-Portfolio-Dashboard
  speist (aggregiert ueber alle Apps in `wsp/exports/latest/star/`).

---

## Portfolio-Export durchfuehren

Nachdem Sie alle Anwendungen im Workspace bewertet haben, generieren Sie den Portfolio-Export:

```
swao export --portfolio
```

Dies aggregiert die einzelnen Sternschema-Pakete zu einem einzigen Export auf
Portfolio-Ebene, der fuer die Power-BI-Portfolio-Vorlage bereit ist.

---

## Power-BI-Portfolio-Dashboard

Das Portfolio-Dashboard gibt Stakeholdern eine einheitliche Ansicht des gesamten Bestands:

| Seite | Was angezeigt wird |
|---|---|
| Portfolio-Uebersicht | Gesamtanwendungen, durchschnittliche Abdeckung, Apps mit kritischem Risiko, 7R-Verteilung |
| Compliance | Anwendungsuebergreifende Compliance-Matrix nach Framework |
| Signale | Portfolio-Signal-Browser |
| Pruefungs-Rollup | Begruendungsabdeckung pro App und anwendungsuebergreifender Compliance-Status |
| Durchlaufstatistiken | Aggregiertes Timing und LLM-Kosten |

Anweisungen zum Verbinden der Dashboard-Vorlage mit Ihrem Portfolio-Export finden Sie unter
[BI exportieren](/de/export-bi).

---

## Wellenplanung

Portfolio-Operationen gruppiert Anwendungen in Migrationswellen basierend auf:

- **Risikoscore** -- risikoreiche Anwendungen werden in der Regel zuerst behandelt.
- **7R-Urteil** -- Anwendungen mit derselben Strategie werden zusammengefasst.
- **Abhaengigkeiten** -- Anwendungen, die voneinander abhaengen, werden in dieselbe Welle
  oder in unmittelbar aufeinanderfolgende Wellen eingeteilt.

Wellenzuweisungen sind im Portfolio-Power-BI-Dashboard sichtbar und sind im
Portfolio-Exportpaket fuer die Verwendung in externen Planungstools enthalten.
