# NCA Cloud Cybersecurity Controls CCC-2:2024, Cloud-Service-Nutzer (Tenant) (NCA_CCC_CST)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `NCA_CCC_CST` |
| Herausgeber | National Cybersecurity Authority (NCA), Königreich Saudi-Arabien |
| Version | CCC-2:2024 (herausgegeben 2024) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 18 |
| Bewertungsmodus | `binary` (Schema-Standard; nicht deklariert) |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `NCA_CCC_CST` |
| Lizenz und Weitergabe | Von der NCA veröffentlicht und als öffentlich verfügbar eingestuft. Die Kontrollbeschreibungen geben den englischen Text der offiziellen Veröffentlichung sinngemäß wieder; keine Rechtsberatung. |
| Zuletzt geprüft | 2026-07-18 |

## Worum es geht

Die Cloud Cybersecurity Controls (CCC-2:2024) werden von der National Cybersecurity Authority (NCA) des Königreichs Saudi-Arabien herausgegeben. Sie sind eine verpflichtende Erweiterung der Essential Cybersecurity Controls ([NCA_ECC](/de/frameworks/nca-ecc-2-2024)) für Cloud Computing und teilen die Pflichten entlang des Modells der geteilten Verantwortung auf: ein Satz für Cloud-Service-Provider (CSP, P-Notation) und einer für Cloud-Service-Nutzer (CST, T-Notation). SWAO bildet beide Seiten als getrennte Frameworks ab.

Die CST-Seite beschreibt, was eine nutzende Organisation leisten muss: Cloud-Rollen und Risikomanagement, Überwachung der Compliance des Anbieters, Überprüfung von Personal in cloud-sensiblen Funktionen, ein Inventar der Cloud-Dienste, Verwaltung von Zugangsdaten und Zugriffen, Überprüfung der Trennung in Community Clouds, Schutz der Verbindung zum Anbieter, eine Exit-Strategie, Kryptografie und Schlüsselverwaltung, Schwachstellenmanagement, Protokollierung sowie Disaster Recovery für die Cloud. CSTs müssen sowohl ECC als auch CCC einhalten. CCC gilt für saudische Behörden, CNI-Betreiber und privatwirtschaftliche Organisationen, die Cloud-Dienste nutzen oder dies planen (Beschreibung in `framework-meta.yaml`).

## Wer es in SWAO nutzen sollte und wann

Setzen Sie NCA_CCC_CST ein, wenn eine NCA-beaufsichtigte Organisation eine Anwendung in die Cloud verlagert oder dort bereits betreibt, etwa ein Ministeriumsportal, ein Back-Office-System eines CNI-Betreibers oder den SaaS-Workload eines regulierten Unternehmens. Das Framework passt zu Anwendungs- und Migrations-Assessments, typischerweise kombiniert mit [NCA_ECC](/de/frameworks/nca-ecc-2-2024) und bei Finanzinstituten mit [SAMA_CSF](/de/frameworks/sama-csf-v1). Verwenden Sie [NCA_CCC_CSP](/de/frameworks/nca-ccc-2-2024-csp), wenn der Anbieter selbst bewertet wird.

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

Elf der 18 Kontrollen deklarieren eine vom Beraterteam bereitzustellende Evidenzdatei, zum Beispiel `evidence/cst-10-data-exit-strategy.md` für `NCA_CCC_CST_10` Cloud Data Exit Strategy and Secure Transfer. Diese Dateien werden nicht mit dem Framework ausgeliefert. Sieben Kontrollen deklarieren eine Signalfamilie, zu der die Analyse von Code, Konfiguration und Infrastructure-as-Code beitragen kann:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `NCA_CCC_CST_06` | Identity and Access Management for Cloud Credentials | `IAM` |
| `NCA_CCC_CST_11` | Cryptographic Standards for Cloud Data Protection | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CST_13` | Cloud Service Log Collection and Monitoring | `OBS` |
| `NCA_CCC_CST_14` | Key Management Policy: Identification and Documentation | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CST_15` | Key Management Policy: Implementation | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CST_16` | Key Management: Technical Requirements | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CST_17` | Key Management Policy: Periodic Review | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |

Hinweis: Dieser Katalog deklariert die Signalfamilien `IAM`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

Der Katalog folgt der Domänen- und Subdomänen-Nummerierung von CCC-2:2024. Die Beschreibung in `framework-meta.yaml` nennt vier Domänen; der Katalog enthält Kontrollen für die Domänen 1 bis 3 und keine für Domäne 4 (Third-Party Cloud Cybersecurity). Jede Kontrolle trägt Tags auf den Achsen `domain`, `role` und `applies-to`.

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| Domain 1: Cloud Cybersecurity Governance | 4 | 0 | `NCA_CCC_CST_01` Cybersecurity Roles and RACI for Cloud Services; `NCA_CCC_CST_02` Cybersecurity Risk Management for Cloud Services |
| Domain 2: Cloud Cybersecurity Defense | 13 | 7 | `NCA_CCC_CST_05` Inventory of Cloud Services and Related Technology Assets; `NCA_CCC_CST_06` Identity and Access Management for Cloud Credentials |
| Domain 3: Cloud Cybersecurity Resilience | 1 | 0 | `NCA_CCC_CST_18` Cloud Disaster Recovery and Business Continuity |
| **Summe** | **18** | **7** |  |

Vom Katalog abgedeckte Subdomänen:

| Subdomäne | Kontrollen | Kontroll-IDs |
|---|---|---|
| 1-1 Cybersecurity Roles and Responsibilities | 1 | `NCA_CCC_CST_01` |
| 1-2 Cybersecurity Risk Management | 1 | `NCA_CCC_CST_02` |
| 1-3 Compliance with Cybersecurity Standards, Laws, and Regulations | 1 | `NCA_CCC_CST_03` |
| 1-4 Cybersecurity in Human Resources | 1 | `NCA_CCC_CST_04` |
| 2-1 Asset Management | 1 | `NCA_CCC_CST_05` |
| 2-2 Identity and Access Management | 1 | `NCA_CCC_CST_06` |
| 2-3 Information System and Information Processing Facilities Protection | 1 | `NCA_CCC_CST_07` |
| 2-4 Networks Security Management | 1 | `NCA_CCC_CST_08` |
| 2-5 Mobile Devices Security | 1 | `NCA_CCC_CST_09` |
| 2-6 Data and Information Protection | 1 | `NCA_CCC_CST_10` |
| 2-7 Cryptography | 1 | `NCA_CCC_CST_11` |
| 2-9 Vulnerabilities Management | 1 | `NCA_CCC_CST_12` |
| 2-11 Cybersecurity Event Logs and Monitoring Management | 1 | `NCA_CCC_CST_13` |
| 2-15 Key Management | 4 | `NCA_CCC_CST_14`, `NCA_CCC_CST_15`, `NCA_CCC_CST_16`, `NCA_CCC_CST_17` |
| 3-1 Cybersecurity Resilience Aspects of Business Continuity Management (BCM) | 1 | `NCA_CCC_CST_18` |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 16 |
| [`NCA_ECC`](/de/frameworks/nca-ecc-2-2024) | 18 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`NCA_ECC`](/de/frameworks/nca-ecc-2-2024), [`NCA_CCC_CSP`](/de/frameworks/nca-ccc-2-2024-csp), [`ISO_27001`](/de/frameworks/iso-27001), [`SAMA_CSF`](/de/frameworks/sama-csf-v1).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `nca-ccc-2-2024-cst` in den Workspace nach `wsp/inputs/catalogs/community/nca-ccc-2-2024-cst/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes NCA_CCC_CST`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [NCA_CCC_CST]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nca-ccc-2-2024-cst>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `nca-ccc-2-2024-cst` in Ihren Workspace nach `wsp/inputs/catalogs/community/nca-ccc-2-2024-cst/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info NCA_CCC_CST` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Für die Auslegung von NCA-Veröffentlichungen ist die arabische Fassung maßgeblich; der Katalog gibt den englischen Text sinngemäß wieder.
- Pflichten des Nutzers, die vom Anbieter abhängen (etwa die Trennung in einer Community Cloud), erfordern Nachweise des Anbieters; SWAO kann die Plattform des Anbieters nicht einsehen.
- Der Katalog bildet die Haupt-T-Kontrollen ab; den vollständigen Kontrolltext entnehmen Sie der offiziellen Veröffentlichung.
