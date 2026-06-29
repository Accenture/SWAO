# Hybridbewertung

::: warning Demnachst verfuegbar
Die Hybridbewertung befindet sich auf der Roadmap. Die folgende Beschreibung spiegelt die
geplante Funktionalitaet wider.
:::

Die Hybridbewertung kombiniert Anwendungsbewertungs-Durchlaeufe mit Audit-Evidenz, um das
hoechstmoegliche Compliance-Bild zu erstellen. Sie fuegt LLM-abgeleitete Signale aus der
Quellcodeanalyse mit beraterischen Befunden aus strukturierten Interviews und
Dokumentenpruefungen zusammen und liefert eine einheitliche Publikation, die sowohl
technische als auch menschliche Evidenzanforderungen erfuellt.

**Geplante CLI:** `swao assess --type hybrid`

**TUI:** Hauptmenue > Bewertung durchfuehren > [5] Hybridbewertung (demnachst)

---

## Anwendungsfaelle

Verwenden Sie die Hybridbewertung, wenn:

- Die Anwendung ueber verfuegbaren Quellcode verfuegt **und** ein Berater Interviews oder
  Dokumentenpruefungen durchgefuehrt hat, die Evidenz hinzufuegen, die allein aus dem Code
  nicht sichtbar ist.
- Eine regulatorische Einreichung sowohl automatisierte Analyseevidenz als auch menschliche
  Attestierungs-Genehmigung fuer denselben Steuerungssatz erfordert.
- Sie die hoechstmoegliche Begruendungsabdeckungsrate anstreben moechten (Signale, die durch
  automatisierte und menschliche Evidenz begruendet werden, haben staerkeres Gewicht bei
  einer Pruefung).

---

## Geplante Funktionsweise

1. Fuehren Sie eine **Anwendungsbewertung** durch, um den quellabgeleiteten Signalsatz zu
   erstellen.
2. Fuehren Sie eine **Audit-Bewertung** durch, um den beraterischen Evidenzsatz zu erstellen.
3. Fuehren Sie `swao assess --type hybrid` aus, um beide Signalsaetze zusammenzufuehren.
   SWAO loest alle Konflikte zwischen automatisierten und menschlichen Urteilen mithilfe
   einer konfigurierbaren Praezedenzregel auf (standardmaessig ueberschreibt die menschliche
   Attestierung automatisierte Befunde, wenn beide dieselbe Steuerung abdecken).
4. Generieren Sie die kombinierte Publikation und den BI-Export.

Die zusammengefuehrte Ausgabe attributiert jedes Signal eindeutig seiner Quelle --
`source_code`, `context_doc` oder `consultant_attestation` -- sodass Pruefende die
Evidenztypen unterscheiden koennen.
