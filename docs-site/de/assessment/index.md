# Bewertung durchfuehren

SWAO unterstuetzt fuenf Bewertungstypen, die jeweils ein anderes Thema ansprechen. Zwei sind
heute verfuegbar; drei befinden sich auf der Roadmap.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **3** und waehlen Sie
dann den Bewertungstyp.

![SWAO assessment type selection](/samples/13-tui-run-assessment.png)

| Nr. | Bewertungstyp | Status | Thema |
|---|---|---|---|
| [1] | [Anwendungsbewertung](/de/assessment/application) | Verfuegbar | Cloud-Anwendungsquellcode |
| [2] | [Audit-Bewertung](/de/assessment/audit) | Demnachst | Menschlich gefuehrte Compliance-Pruefung |
| [3] | [Landing-Zone-Bewertung](/de/assessment/landing-zone) | Verfuegbar | Cloud-Infrastrukturkonfiguration |
| [4] | [LLM-Bewertung](/de/assessment/llm) | Demnachst | KI-Modell-Souveranitaets-Benchmarking |
| [5] | [Hybridbewertung](/de/assessment/hybrid) | Demnachst | Kombinierte Quell- und menschliche Evidenz |

---

## Wie Bewertungen funktionieren

Alle Bewertungstypen teilen dieselbe Pipeline:

1. **Eingabe lesen** -- SWAO liest Ihren Anwendungsquellcode, Konfigurationsdateien und alle
   Kontextdokumente, die Sie im Importordner abgelegt haben.
2. **Durchlaeufe ausfuehren** -- eine Folge von Analysedurchlaeufen wird gegen die Eingabe
   ausgefuehrt. Einige Durchlaeufe verwenden statische Analyse (deterministisch, kein LLM
   erforderlich); andere rufen Ihr konfiguriertes LLM auf, um Befunde abzuleiten, die
   Sprachverstaendnis erfordern.
3. **Signale ausgeben** -- jeder Durchlauf gibt Signale aus: strukturierte Befunde mit einer
   Signal-ID, Schweregrad, Compliance-Steuerungszuordnung, Begruendungstext und
   Evidenzreferenzen.
4. **Ausgabe generieren** -- Signale werden im Workspace-Signal-Pack (WSP) aggregiert, aus
   dem SWAO Berichte, das BI-Exportpaket und die HTML-Veroffentlichung generiert.

Alle Ausgaben werden in `apps/<app-id>/wsp/` gespeichert und koennen jederzeit aus
demselben Signalsatz neu generiert werden, ohne die Bewertung erneut durchfuehren zu
muessen.

---

## Nach der Bewertung

Sobald die Bewertung abgeschlossen ist, verwenden Sie die anderen TUI-Menuepunkte, um die
Ergebnisse in Arbeitsergebnisse umzuwandeln:

- **[4] Bericht erstellen** -- Text- und Markdown-Pruefbericht
- **[5] HTML veroeffentlichen** -- eigenstaendige HTML-Publikation
- **[6] BI exportieren** -- Sternschema-Paket fuer Power BI oder Tableau
