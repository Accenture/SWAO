# SAMA Cyber Security Framework v1.0 (SAMA_CSF)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `SAMA_CSF` |
| Herausgeber | Saudi Arabian Monetary Authority (SAMA) |
| Version | CSF v1.0 (erstmals veröffentlicht 2017) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 30 |
| Bewertungsmodus | `binary` (Schema-Standard). Der Katalog deklariert eine sechsstufige Reifegradskala (0 bis 5) mit regulatorischem Minimum Stufe 3 und setzt `maturity_model: true` in `regime_meta`, aber keinen `scoring_mode: maturity`. |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `SAMA_CSF` |
| Lizenz und Weitergabe | Herausgegeben von der Saudi Arabian Monetary Authority. Die Beschreibungen geben den offiziellen Text sinngemäß wieder; maßgeblich ist die offizielle SAMA-Veröffentlichung. |
| Zuletzt geprüft | 2026-07-18 |

## Worum es geht

Das SAMA Cyber Security Framework (CSF) v1.0 ist das verpflichtende Cybersicherheits-Framework der Saudi Arabian Monetary Authority für die von ihr beaufsichtigten Finanzunternehmen: Banken, Versicherungen, Finanzierungsgesellschaften, Zahlungsdienstleister und weitere SAMA-regulierte Einrichtungen. Es wurde erstmals 2017 veröffentlicht (Versionshinweis in `framework-meta.yaml`).

Anders als die meisten Frameworks im SWAO-Katalog bewertet SAMA CSF Kontrollen über ein Prozess-Reifegradmodell:

| Stufe | Bedeutung |
|---|---|
| 0 | Incomplete: Prozess nicht umgesetzt oder erfüllt seinen Zweck nicht |
| 1 | Initial: Prozess umgesetzt, aber nicht gesteuert |
| 2 | Managed: Prozess geplant, überwacht und angepasst |
| 3 | Defined: Prozess aus einem organisationsweiten Standard abgeleitet (regulatorisches Minimum) |
| 4 | Quantitatively managed: Prozess mit statistischen Methoden gesteuert |
| 5 | Optimising: kontinuierliche Verbesserung der Prozessleistung |

Der SWAO-Katalog deckt alle fünf Domänen des Frameworks mit 30 Kontrollen auf Ebene der Domänenbereiche ab.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie SAMA_CSF für Anwendungen und Plattformen SAMA-regulierter Finanzinstitute im Königreich Saudi-Arabien ein, etwa für Kernbanken-, Zahlungs-, Versicherungsverwaltungs- oder Digitalkanal-Workloads, die auf eine Cloud-Plattform wechseln. Kombinieren Sie es mit [NCA_ECC](/de/frameworks/nca-ecc-2-2024), das für dieselben Einrichtungen gilt, und mit [NCA_CCC_CST](/de/frameworks/nca-ccc-2-2024-cst) für die Cloud-Nutzung.

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

SWAO liefert die üblichen Ergebnisse (`SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN`, `N_A`); einen Reifegrad berechnet es nicht. Nutzen Sie Ergebnisse und Begründungen als Grundlage für die Reifegradbewertung, die das Institut oder sein Prüfer vornimmt. 27 der 30 Kontrollen deklarieren eine vom Beraterteam bereitzustellende Evidenzdatei, zum Beispiel `evidence/SAMA_CSF_GOV_01-strategy-governance-framework.md`. Vier Betriebs-Kontrollen deklarieren eine Signalfamilie:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `SAMA_CSF_OPS_02` | Identity and Access Management | `IAM` |
| `SAMA_CSF_OPS_05` | Cryptography and Key Management | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `SAMA_CSF_OPS_07` | Cybersecurity Event Monitoring and SIEM | `OBS` |
| `SAMA_CSF_OPS_08` | Cyber Incident Management and Response | Kontext `evidence/SAMA_CSF_OPS_08-incident-management.md`, `OBS` |

Hinweis: Dieser Katalog deklariert die Signalfamilien `IAM`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| Domain 1: Leadership and Governance | 6 | 0 | `SAMA_CSF_GOV_01` Cyber Security Strategy and Governance Framework; `SAMA_CSF_GOV_02` Cyber Security Management Structure and Ownership |
| Domain 2: Risk Management and Compliance | 4 | 0 | `SAMA_CSF_RISK_01` Cyber Risk Management Process; `SAMA_CSF_RISK_02` Third-Party Cyber Risk Assessment |
| Domain 3: Cybersecurity Operations | 12 | 4 | `SAMA_CSF_OPS_01` Asset Management and Classification; `SAMA_CSF_OPS_02` Identity and Access Management |
| Domain 4: Third-Party Cybersecurity | 4 | 0 | `SAMA_CSF_3P_01` Third-Party and Outsourcing Cyber Security Governance; `SAMA_CSF_3P_02` Cloud Computing Adoption Policy and Due Diligence |
| Domain 5: Cyber Resilience | 4 | 0 | `SAMA_CSF_RES_01` Business Continuity Management and Cyber Integration; `SAMA_CSF_RES_02` Disaster Recovery Planning and Testing |
| **Summe** | **30** | **4** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 30 |
| `NIST_CSF` | 29 |
| [`COBIT_5`](/de/frameworks/cobit-5) | 16 |
| [`NCA_ECC`](/de/frameworks/nca-ecc-2-2024) | 8 |
| [`SOC_2`](/de/frameworks/soc-2) | 4 |
| [`PCI_DSS`](/de/frameworks/pci-dss) | 2 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`NCA_ECC`](/de/frameworks/nca-ecc-2-2024), [`ISO_27001`](/de/frameworks/iso-27001), `NIST_CSF`, [`COBIT_5`](/de/frameworks/cobit-5), [`PCI_DSS`](/de/frameworks/pci-dss), [`SOC_2`](/de/frameworks/soc-2).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `sama-csf-v1` in den Workspace nach `wsp/inputs/catalogs/community/sama-csf-v1/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes SAMA_CSF`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [SAMA_CSF]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/sama-csf-v1>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `sama-csf-v1` in Ihren Workspace nach `wsp/inputs/catalogs/community/sama-csf-v1/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info SAMA_CSF` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Der Reifegrad und das regulatorische Minimum der Stufe 3 lassen sich nicht aus Code ableiten. Dafür sind Interviews und Prozessnachweise erforderlich.
- SAMA hat über CSF v1.0 hinaus weitere Vorgaben veröffentlicht; prüfen Sie das aktuelle SAMA-Regelwerk für die vollständigen Pflichten des Instituts.
