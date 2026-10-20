# LLM-Auswahl-Framework für souveräne Bereitstellung (LLM_SELECTION)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `LLM_SELECTION` |
| Herausgeber | SWAO Development Team (Accenture), Community-Framework (Design 063) |
| Version | 1.0 |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `0.1.0` |
| Anzahl Kontrollen | 34 |
| Bewertungsmodus | `binary` (Schema-Standard). Jede Kontrolle enthält zusätzlich eigene Kriterien für pass / partial / fail, und der Katalog deklariert Domänengewichte für den Sovereignty Readiness Score (SRS). |
| Assessment-Scope (framework-meta) | `llm` |
| Signal-Präfix | `LLM` |
| Lizenz und Weitergabe | Von SWAO verfasstes Framework im Apache-2.0-Community-Katalog; ein Weitergabehinweis Dritter ist nicht deklariert. |
| Zuletzt geprüft | 2026-06-30 |

## Worum es geht

LLM_SELECTION ist keine Regulierung, sondern ein von SWAO verfasstes Bewertungs-Framework. Es beurteilt einen Anbieter großer Sprachmodelle (LLM) als Kandidaten für den Betrieb souveräner Workloads. Es stellt die Fragen, die ein souveränitätsbewusster Auftraggeber vor der Modellwahl beantwortet haben muss: Wo werden Daten verarbeitet und gespeichert, wie transparent sind Modell und Anbieter, wie leistungsfähig ist das Modell in Zielsprache und Fachdomäne, wie sicher und robust ist es, kann das Team es betreiben, und wie gut unterstützt es agentische Muster wie Tool-Calling und Retrieval?

Der Katalog verweist auf die Pflichten des EU AI Act für KI-Modelle mit allgemeinem Verwendungszweck (Artikel 51 bis 55), die DSGVO-Artikel 28 sowie 44 bis 46, ISO/IEC 42001, das NIST AI RMF 1.0, NIST SP 800-218A, die OWASP LLM Top 10 und ein veröffentlichtes Analystenmodell zur LLM-Auswahl (Referenzen in `framework-meta.yaml`). Fünf Kontrollen tragen einen ausdrücklichen Verweis auf den EU AI Act, zwei auf die DSGVO und zwei auf OWASP.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie LLM_SELECTION in einem [LLM-Assessment](/de/assessment/llm) ein, wenn ein Kunde einen LLM-Anbieter für einen regulierten oder souveränitätskritischen Anwendungsfall auswählen oder die Auswahl begründen muss, etwa für einen Chatbot der öffentlichen Verwaltung, einen Dokumentationsassistenten in einem Beispielkrankenhaus oder eine interne Retrieval-gestützte Suche über vertrauliche Dokumente. Das Framework ist regionsunabhängig nutzbar; die Kontrollen zu Datenresidenz und Datentransfer sind mit Blick auf EU-Anforderungen formuliert.

Typische Zeitpunkte in einem Engagement:

- Vorauswahl von Anbietern vor einem Proof of Concept;
- Dokumentation der Auswahlbegründung für ein KI-Governance-Gremium;
- erneute Bewertung eines Anbieters nach Änderungen an Vertrag, Modell oder Hosting.

## Was SWAO prüft

Die Kontrollen werden im Compliance-Pass bewertet ([Pass 11, COMP](/de/passes/11-comp)). Für jedes Framework in `assessment.regimes_active` übergibt der Pass ID, Titel, Beschreibung und Standard-Schweregrad jeder Kontrolle zusammen mit allen zuvor im Lauf erzeugten Signalen in Blöcken zu je 20 Kontrollen an das konfigurierte LLM. Das LLM liefert je Kontrolle ein Ergebnis mit kurzer Begründung:

| Ergebnis | Bedeutung |
|---|---|
| `SATISFIED` | Die Signale bestätigen, dass die Kontrolle erfüllt ist. |
| `PARTIAL` | Einzelne Elemente sind vorhanden, es bleiben jedoch Lücken. |
| `GAP` | Die Signale zeigen, dass die Kontrolle nicht erfüllt ist. |
| `UNKNOWN` | Kein Signal spricht für oder gegen die Kontrolle. |
| `N_A` | Die Kontrolle ist für diesen Workload nicht anwendbar (mit Begründung). |

Vom LLM zitierte Signale werden gegen die tatsächlichen Signale des Laufs geprüft; Pfade zu Evidenzdateien stammen aus den zitierten Signalen, nicht vom LLM. Ist kein LLM-Provider konfiguriert, wird jede Kontrolle als `UNKNOWN` erfasst und das Framework erhält den Status `pending-llm`. Ein Sammelsignal `COMP-NN` fasst die Ergebnisse je Framework zusammen.

Jede Kontrolle im Katalog deklariert zusätzlich eine `evidence_basis`, also die Signalfamilie oder das Dokument, an dem sie gemessen werden soll. Der Evaluator filtert nicht nach diesem Feld. Es zeigt Prüfern, welche Evidenz zählt, und erscheint in der HTML-Publikation als Umfang der automatisierten Prüfung. Dokumente wie Richtlinien, Runbooks und Architekturbeschreibungen gelangen über den [Ingest-Pass](/de/passes/00-ingest) und den [Kontext-Pass](/de/passes/04-ctx) in den Lauf.

LLM_SELECTION wird fast ausschließlich aus Dokumenten beantwortet, nicht aus Code. Die `evidence_basis` der 34 Kontrollen verweist auf drei Arten von Eingaben:

| Evidenzquelle (deklariert) | Kontrollen |
|---|---|
| Anbieterdokumentation, deklariert als `imports/` (Model Cards, Konformitätsbewertungen, Preisblätter, Benchmark-Ergebnisse) | 25 |
| LLM-Intake-Fragebogen `ingestion/llm-intake-questionnaire.docx` | 5 |
| Unterlagen zu Personal und Kompetenzen unter `wsp/ingest/people/` | 4 |

Ist LLM_SELECTION aktiv und enthält `apps/<app-id>/context/` keine Dateien, erzeugt der Compliance-Pass ein informatives `COMP`-Signal mit dem Hinweis, dass die Kontrollen als unbestätigt erscheinen werden. Legen Sie Model Card, Auftragsverarbeitungsvertrag und Konformitätsunterlagen des Anbieters vor dem Lauf dort ab.

Jede Kontrolle definiert eigene `scoring`-Kriterien für pass, partial und fail. Beispiel `DSR-01` Data residency guarantee: Für pass ist eine verbindliche vertragliche Zusicherung für die Zielregion mit überprüfbarem Endpunkt erforderlich. Die README des Frameworks beschreibt `DSR-01` und `DSR-02` als harte Eignungskriterien.

`DSR-02` Zero-retention endpoint verified ist die einzige Kontrolle, deren Evidenzbasis zusätzlich zum Fragebogen eine automatisierte SWAO-Prüfung deklariert.

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `DSR-02` | Zero-retention endpoint verified | Kontext `ingestion/llm-intake-questionnaire.docx`, deklarierte SWAO-Prüfung |

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| DSR: Data sovereignty and residency | 5 | 1 | `DSR-01` Data residency guarantee; `DSR-02` Zero-retention endpoint verified |
| MT: Model transparency | 5 | 0 | `MT-01` Model card published; `MT-02` GPAI conformity assessment published |
| PR: Performance and reliability | 7 | 0 | `PR-01` Latency SLA for sovereign payloads; `PR-02` Hallucination rate within threshold |
| CLF: Cultural and language fit | 3 | 0 | `CLF-01` Target-language fluency; `CLF-02` Domain-vocabulary accuracy in target language |
| SB: Safety and bias | 5 | 0 | `SB-01` Bias benchmark within acceptable bounds; `SB-02` Red-team or adversarial evaluation results published |
| PEO: People and team readiness | 4 | 0 | `PEO-01` AI and LLM engineering skills present; `PEO-02` Data management skills for LLM pipelines |
| AC: Agentic capabilities | 5 | 0 | `AC-01` Tool and function calling reliability; `AC-02` Multi-step orchestration and chaining |
| **Summe** | **34** | **1** |  |

Der Katalog deklariert in `framework-meta.yaml` (`srs_weights`) Gewichte je Domäne für den Sovereignty Readiness Score (SRS):

| Domäne | DSR | MT | PR | CLF | SB | AC | PEO |
|---|---|---|---|---|---|---|---|
| SRS-Gewicht | 0.20 | 0.17 | 0.17 | 0.12 | 0.15 | 0.16 | 0.03 |

Laut README des Frameworks ist der SRS der gewichtete Mittelwert der Domänenwerte (pass = 1.0, partial = 0.5, fail = 0.0, nicht bewertet = ausgeschlossen); PEO entfällt aus dem Nenner, wenn `wsp/ingest/people/` leer ist.

## Querverweise auf andere Frameworks


Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`GDPR`](/de/frameworks/gdpr), [`AI_10_PILLARS`](/de/frameworks/ai-10-pillars), [`ISO_27001`](/de/frameworks/iso-27001).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `llm-selection` in den Workspace nach `wsp/inputs/catalogs/community/llm-selection/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. Dieses Framework deklariert `assessment_type_scope: [llm]`. Die TUI zeigt es in der Framework-Auswahl des [LLM-Assessments](/de/assessment/llm); die Auswahl für Anwendungs-Assessments zeigt es nicht.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes LLM_SELECTION`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [LLM_SELECTION]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/llm-selection>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `llm-selection` in Ihren Workspace nach `wsp/inputs/catalogs/community/llm-selection/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info LLM_SELECTION` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- SWAO führt mit diesem Framework keinen eigenen Benchmark des Modells durch. Kontrollen zu Leistung, Halluzinationen und Bias werden anhand der vom Anbieter oder Kunden gelieferten Evidenz bewertet.
- Anbieterdokumentation ändert sich häufig. Halten Sie die verwendeten Dokumentversionen fest und wiederholen Sie das Assessment bei Änderungen.
- Die SRS-Gewichte sind im Katalog deklariert; diese Version ermittelt Compliance-Ergebnisse je Kontrolle über den Compliance-Pass.
