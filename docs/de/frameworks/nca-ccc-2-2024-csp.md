# NCA Cloud Cybersecurity Controls CCC-2:2024, Cloud-Service-Provider (NCA_CCC_CSP)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `NCA_CCC_CSP` |
| Herausgeber | National Cybersecurity Authority (NCA), Königreich Saudi-Arabien |
| Version | CCC-2:2024 (herausgegeben 2024) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 37 |
| Bewertungsmodus | `binary` (Schema-Standard; nicht deklariert) |
| Assessment-Scope (framework-meta) | `aud` |
| Signal-Präfix | `NCA_CCC_CSP` |
| Lizenz und Weitergabe | Von der NCA veröffentlicht und als öffentlich verfügbar eingestuft. Die Kontrollbeschreibungen geben den englischen Text der offiziellen Veröffentlichung sinngemäß wieder; keine Rechtsberatung. |
| Zuletzt geprüft | 2026-07-18 |

## Worum es geht

Die Cloud Cybersecurity Controls (CCC-2:2024) werden von der National Cybersecurity Authority (NCA) des Königreichs Saudi-Arabien herausgegeben. Sie sind eine verpflichtende Erweiterung der Essential Cybersecurity Controls ([NCA_ECC](/de/frameworks/nca-ecc-2-2024)) für Cloud Computing und teilen die Pflichten entlang des Modells der geteilten Verantwortung auf: ein Satz für Cloud-Service-Provider (CSP, P-Notation) und einer für Cloud-Service-Nutzer (CST, T-Notation). SWAO bildet beide Seiten als getrennte Frameworks ab.

Die CSP-Seite beschreibt, was ein Anbieter für den von ihm betriebenen Cloud Technology Stack leisten muss: Governance und Rollen, Risikomanagement, Saudisierung und Personalüberprüfung, Change Management, Mandantentrennung, Netz- und Datenschutz, Kryptografie und Schlüsselverwaltung, sichere Systementwicklung, Sicherheit von Speichermedien, Business Continuity sowie Steuerung der Lieferkette. Sie gilt für Cloud-Service-Provider, die im Königreich tätig sind oder Cloud-Dienste für saudische Behörden, Betreiber kritischer nationaler Infrastruktur (CNI) oder regulierte privatwirtschaftliche Organisationen erbringen (Beschreibung in `framework-meta.yaml`).

## Wer es in SWAO nutzen sollte und wann

Setzen Sie NCA_CCC_CSP ein, wenn die bewertete Partei der Anbieter ist: eine Hyperscaler-Region, ein lokaler Cloud-Anbieter oder ein Plattformteam, das IaaS, PaaS oder SaaS für saudische Behörden oder regulierte Kunden anbietet. Typische Engagements sind Reifeprüfungen des Anbieters vor einer NCA-Bewertung und Partner-Workshops, in denen die Kontrollen des Anbieters mit den Pflichten verglichen werden, die seine Kunden übernehmen. Für die nutzende Organisation verwenden Sie stattdessen [NCA_CCC_CST](/de/frameworks/nca-ccc-2-2024-cst) zusammen mit [NCA_ECC](/de/frameworks/nca-ecc-2-2024).

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

Die meisten CSP-Kontrollen betreffen Governance und Betrieb des Anbieters und werden anhand von Dokumenten bewertet. 30 der 37 Kontrollen deklarieren eine vom Beraterteam bereitzustellende Evidenzdatei, zum Beispiel `evidence/csp-12-tenant-isolation.md` für `NCA_CCC_CSP_12` Information Systems Configuration and Tenant Isolation. Diese Dateien werden nicht mit dem Framework ausgeliefert; das Engagement-Team sammelt sie beim Anbieter ein. Sieben Kontrollen deklarieren eine Signalfamilie als Evidenz:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `NCA_CCC_CSP_11` | Identity and Access Management for Cloud Technology Stack | `IAM` |
| `NCA_CCC_CSP_16` | Cryptographic Standards for Cloud Services | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CSP_20` | Cybersecurity Event Logs and Monitoring for Cloud Technology Stack | `OBS` |
| `NCA_CCC_CSP_24` | Key Management Policy: Identification and Documentation | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CSP_25` | Key Management Policy: Implementation | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CSP_26` | Key Management: Technical Requirements | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_CCC_CSP_27` | Key Management Policy: Periodic Review | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |

Hinweis: Dieser Katalog deklariert die Signalfamilien `IAM`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

Der Katalog folgt der Domänen- und Subdomänen-Nummerierung von CCC-2:2024. Jede Kontrolle trägt Tags auf den Achsen `domain`, `role` und `applies-to`.

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| Domain 1: Cloud Cybersecurity Governance | 9 | 0 | `NCA_CCC_CSP_01` Cybersecurity Roles and RACI for Cloud Services; `NCA_CCC_CSP_02` Cybersecurity Risk Management for Cloud Services |
| Domain 2: Cloud Cybersecurity Defense | 26 | 7 | `NCA_CCC_CSP_10` Asset Inventory and Ownership for Cloud Technology Stack; `NCA_CCC_CSP_11` Identity and Access Management for Cloud Technology Stack |
| Domain 3: Cloud Cybersecurity Resilience | 1 | 0 | `NCA_CCC_CSP_36` Cloud Business Continuity and Cybersecurity Resilience |
| Domain 4: Third-Party Cloud Cybersecurity | 1 | 0 | `NCA_CCC_CSP_37` Supply Chain and Third-Party Cybersecurity |
| **Summe** | **37** | **7** |  |

Vom Katalog abgedeckte Subdomänen:

| Subdomäne | Kontrollen | Kontroll-IDs |
|---|---|---|
| 1-1 Cybersecurity Roles and Responsibilities | 1 | `NCA_CCC_CSP_01` |
| 1-2 Cybersecurity Risk Management | 1 | `NCA_CCC_CSP_02` |
| 1-3 Compliance with Cybersecurity Standards, Laws, and Regulations | 1 | `NCA_CCC_CSP_03` |
| 1-4 Cybersecurity in Human Resources | 2 | `NCA_CCC_CSP_04`, `NCA_CCC_CSP_05` |
| 1-5 Cybersecurity in Change Management | 4 | `NCA_CCC_CSP_06`, `NCA_CCC_CSP_07`, `NCA_CCC_CSP_08`, `NCA_CCC_CSP_09` |
| 2-1 Asset Management | 1 | `NCA_CCC_CSP_10` |
| 2-2 Identity and Access Management | 1 | `NCA_CCC_CSP_11` |
| 2-3 Information System and Information Processing Facilities Protection | 1 | `NCA_CCC_CSP_12` |
| 2-4 Networks Security Management | 1 | `NCA_CCC_CSP_13` |
| 2-5 Mobile Devices Security | 1 | `NCA_CCC_CSP_14` |
| 2-6 Data and Information Protection | 1 | `NCA_CCC_CSP_15` |
| 2-7 Cryptography | 1 | `NCA_CCC_CSP_16` |
| 2-8 Backup and Recovery Management | 1 | `NCA_CCC_CSP_17` |
| 2-9 Vulnerabilities Management | 1 | `NCA_CCC_CSP_18` |
| 2-10 Penetration Testing | 1 | `NCA_CCC_CSP_19` |
| 2-11 Cybersecurity Event Logs and Monitoring Management | 1 | `NCA_CCC_CSP_20` |
| 2-12 Cybersecurity Incident and Threat Management | 1 | `NCA_CCC_CSP_21` |
| 2-13 Physical Security | 1 | `NCA_CCC_CSP_22` |
| 2-14 Web Application Security | 1 | `NCA_CCC_CSP_23` |
| 2-15 Key Management | 4 | `NCA_CCC_CSP_24`, `NCA_CCC_CSP_25`, `NCA_CCC_CSP_26`, `NCA_CCC_CSP_27` |
| 2-16 System Development Security | 4 | `NCA_CCC_CSP_28`, `NCA_CCC_CSP_29`, `NCA_CCC_CSP_30`, `NCA_CCC_CSP_31` |
| 2-17 Storage Media Security | 4 | `NCA_CCC_CSP_32`, `NCA_CCC_CSP_33`, `NCA_CCC_CSP_34`, `NCA_CCC_CSP_35` |
| 3-1 Cybersecurity Resilience Aspects of Business Continuity Management (BCM) | 1 | `NCA_CCC_CSP_36` |
| 4-1 Supply Chain and Third-Party Cybersecurity | 1 | `NCA_CCC_CSP_37` |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 35 |
| [`NCA_ECC`](/de/frameworks/nca-ecc-2-2024) | 25 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`NCA_ECC`](/de/frameworks/nca-ecc-2-2024), [`NCA_CCC_CST`](/de/frameworks/nca-ccc-2-2024-cst), [`ISO_27001`](/de/frameworks/iso-27001), [`SOC_2`](/de/frameworks/soc-2), [`BSI_C5`](/de/frameworks/bsi-c5).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `nca-ccc-2-2024-csp` in den Workspace nach `wsp/inputs/catalogs/community/nca-ccc-2-2024-csp/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. Dieses Framework deklariert ausschließlich `assessment_type_scope: [aud]`. Die TUI-Auswahl für [Anwendungs-Assessments](/de/assessment/application) zeigt es daher nicht an; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks. Der direkte Eintrag der ID in `.swao.yml` funktioniert in jedem Fall.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes NCA_CCC_CSP`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [NCA_CCC_CSP]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nca-ccc-2-2024-csp>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `nca-ccc-2-2024-csp` in Ihren Workspace nach `wsp/inputs/catalogs/community/nca-ccc-2-2024-csp/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info NCA_CCC_CSP` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Für die Auslegung von NCA-Veröffentlichungen ist die arabische Fassung maßgeblich; der Katalog gibt den englischen Text sinngemäß wieder.
- Kontrollen zu Saudisierung, physischer Sicherheit und Personal lassen sich nicht aus Code oder Konfiguration belegen.
- Der Katalog bildet die Haupt-P-Kontrollen ab; den vollständigen Kontrolltext und etwaige Unterkontrollen entnehmen Sie der offiziellen Veröffentlichung.
