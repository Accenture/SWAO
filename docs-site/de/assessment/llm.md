# LLM-Bewertung

::: warning Demnachst verfuegbar
Die LLM-Bewertung befindet sich auf der Roadmap (Meilenstein #0045). Die folgende
Beschreibung spiegelt die geplante Funktionalitaet basierend auf der aktuellen
Designspezifikation wider.
:::

Die LLM-Bewertung wertet grosse Sprachmodelle als Gegenstand einer Souveranitaetsbewertung
aus, anstatt sie als Analysewerkzeuge zu verwenden. Sie verbindet sich gleichzeitig mit
mehreren LLM-Anbietern und bewertet jeden gegen das Community-Framework
`SWAO_LLM_ASSESS`, um einen direkten Vergleich zur Unterstuetzung von Modellauswahl-
entscheidungen fuer souveraene Workloads zu erstellen.

**Geplante CLI:** `swao assess --type llm`

**TUI:** Hauptmenue > Bewertung durchfuehren > [4] LLM-Bewertung (demnachst)

---

## Relevanz

Bevor eine KI-Anwendung in einer souveraenen Umgebung eingesetzt wird, muessen
Organisationen pruefen, ob ihr gewaehltes LLM die Anforderungen der Jurisdiktion
bezueglich Datenresidenz, Transparenz, Sicherheit und regulatorischer Compliance erfuellt.
Heute basiert dies auf Anbieteraussagen und informellen Tests. Die LLM-Bewertung macht es
strukturiert, wiederholbar und pruefungstauglich.

---

## Bewertungsgegenstaende

Das Framework `SWAO_LLM_ASSESS` umfasst sieben Bereiche:

| Bereich | Was bewertet wird |
|---|---|
| Datensouveraenetaet und -residenz | Vertragliche Datenresidenz-Garantien, Zero-Retention-Endpunkte, EU-Hosting-Optionen, DSGVO-DPA-Compliance |
| Modelltransparenz | Veroeffentlichte Modellkarte, EU-KI-Gesetz-Konformitaetsbewertung, Audit-Metadaten pro Anfrage, Lizenzbedingungen |
| Leistung und Zuverlaessigkeit | Latenz, Halluzinierungsrate, Kontextfenster, Token-Durchsatz, Kosten |
| Kulturelle und sprachliche Eignung | Sprachkenntnisse in der Zielsprache, Fachvokabular-Genauigkeit, Bekanntheit regulatorischer Behoerden |
| Sicherheit und Voreingenommenheit | BOLD/WinoBias-Benchmarks, Red-Team-Offenlegung, EU-KI-Gesetz-Verbotsnutzungstest, Prompt-Injection-Resistenz, Jailbreak-Resilienz |
| Agentische Faehigkeiten | Zuverlaessigkeit beim Tool-Aufruf, mehrstufige Orchestrierung, RAG-Grundierungstreue, Gedaechtniskohaerenz, strukturierte Ausgabe-Compliance |
| Mitarbeiter- und Teambereitschaft | LLM-Engineering-Faehigkeiten, Datenverwaltung, KI-Governance-Rollen, Lernverpflichtung |

---

## Erwartete Ergebnisse

| Ausgabe | Inhalt |
|---|---|
| Souveraenitatsbereitsschafts-Score (SRS) | Ein 0-100-Score pro Modell, gewichtet nach Bereich |
| Direktvergleichstabelle | Jede Framework-Steuerung mit RAG-Status (bestanden/teilweise/nicht bestanden) fuer jedes bewertete Modell |
| Regulatorische Eignungszusammenfassung | Welche DSGVO-verknuepften Steuerungen fuer jedes Modell bestehen |
| Benchmark-Bericht | Latenz, Durchsatz, Kostenschaetzungen und Grundierungstestergebnisse |

---

## Konfiguration

Die LLM-Bewertung wird in `.swao.yml` unter dem Block `llm_assessment:` konfiguriert,
in dem Sie angeben, welche Modelle bewertet werden sollen, Schwellenwerte, Ziel-Locale
und Budgetobergrenze. API-Schluessel werden aus Umgebungsvariablen gelesen -- niemals in
der Konfigurationsdatei gespeichert.
