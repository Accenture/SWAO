# SOC 2 Trust Services Criteria (SOC_2)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `SOC_2` |
| Herausgeber | American Institute of Certified Public Accountants (AICPA) |
| Version | 2017-revised |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 64 |
| Bewertungsmodus | `binary` (in framework-meta.yaml deklariert) |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `SOC2` |
| Lizenz und Weitergabe | Die Kriterien werden vom AICPA öffentlich zusammengefasst; der vollständige Leitfaden AT-C Abschnitt 205 ist kostenpflichtig. Die Beschreibungen geben die Kriterien sinngemäß wieder; AICPA-Text wird nicht wiedergegeben. |
| Zuletzt geprüft | 2026-09-21 |

## Worum es geht

SOC 2 ist ein Prüfbericht (Attestation), weder ein Gesetz noch eine Zertifizierung. Eine zugelassene Wirtschaftsprüfungsgesellschaft (CPA) prüft die Kontrollen eines Dienstleisters gegen die AICPA Trust Services Criteria und erstellt einen Type-I-Bericht (Ausgestaltung zu einem Stichtag) oder einen Type-II-Bericht (Ausgestaltung und Wirksamkeit über einen Zeitraum). SOC-2-Berichte werden häufig von US-amerikanischen Unternehmenskunden von SaaS- und Cloud-Diensten verlangt.

Die Kriterien sind in fünf Trust Services Categories gegliedert. Die Common Criteria (CC, Sicherheit) sind in jedem SOC-2-Bericht Pflicht; Availability (A), Processing Integrity (PI), Confidentiality (C) und Privacy (P) kommen je nach den Zusagen der Organisation hinzu. Der SWAO-Katalog enthält 64 Kontrollen: 36 CC, 3 A, 5 PI, 2 C und 18 P.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie SOC_2 für SaaS-Plattformen, cloudbasierte B2B-Dienste, Managed Service Provider und Auftragsverarbeiter ein, die an US-amerikanische Unternehmenskunden verkaufen oder sich auf eine erste SOC-2-Prüfung vorbereiten. Es eignet sich als Reifeprüfung vor der Beauftragung eines Wirtschaftsprüfers und lässt sich mit [ISO_27001](/de/frameworks/iso-27001) für internationale Kunden und mit [GDPR](/de/frameworks/gdpr) für die Privacy-Kategorie kombinieren.

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

Alle 18 Privacy-Kontrollen (`SOC_2_P1.1` bis `SOC_2_P8.1`) deklarieren `assessment_type_scope: [aud]`: Sie erfordern Audit-Evidenz wie Datenschutzhinweise, Einwilligungsnachweise und Verfahren für Betroffenenanfragen. Im gesamten Katalog nennen 29 Kontrollen die Lösungsarchitektur und 27 die Betriebs-Runbooks als Kontext. `SOC_2_CC6.4` Physical access restrictions ist als `csp_inherited: true` gekennzeichnet; die Kontrolle wird also üblicherweise aus dem eigenen Prüfbericht des Cloud-Anbieters übernommen. 18 Kontrollen deklarieren eine Signalfamilie:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `SOC_2_CC4.1` | Ongoing evaluations of internal controls | `OBS`, Kontext `ops_runbooks` |
| `SOC_2_CC5.1` | Selection and development of control activities to mitigate risks | `TF` ([Pass 06](/de/passes/06-tf)), Kontext `solution_arch` |
| `SOC_2_CC5.2` | Selection and development of general technology controls | `TF` ([Pass 06](/de/passes/06-tf)), `IAM` |
| `SOC_2_CC6.1` | Logical access security controls | `IAM` |
| `SOC_2_CC6.2` | Access provisioning and removal | `IAM` |
| `SOC_2_CC6.3` | Access removal on role change or termination | `IAM` |
| `SOC_2_CC6.5` | Encryption of data at rest and in transit | `CRYPTO` ([Pass 08](/de/passes/08-crypto)), `EGR` ([Pass 07](/de/passes/07-egr)) |
| `SOC_2_CC6.6` | Protection against threats from outside system boundaries | `EGR` ([Pass 07](/de/passes/07-egr)), `OBS` |
| `SOC_2_CC6.7` | Protection and transmission of confidential information | `EGR` ([Pass 07](/de/passes/07-egr)), `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `SOC_2_CC6.8` | Detection of unauthorised changes to infrastructure | `TF` ([Pass 06](/de/passes/06-tf)), `OBS` |
| `SOC_2_CC7.1` | Detection and monitoring of new vulnerabilities | `OBS`, Kontext `cmdb_export` |
| `SOC_2_CC7.2` | Monitoring for anomalous activity | `OBS` |
| `SOC_2_CC7.3` | Evaluation of security incidents | Kontext `ops_runbooks`, `OBS` |
| `SOC_2_CC8.1` | Managed infrastructure, data, software, and procedure changes | Kontext `ops_runbooks`, `TF` ([Pass 06](/de/passes/06-tf)) |
| `SOC_2_A1.1` | Availability commitments and system requirements | `OBS`, Kontext `ops_runbooks` |
| `SOC_2_PI1.3` | System processing is complete, accurate, timely, and authorised | Kontext `solution_arch`, `OBS` |
| `SOC_2_PI1.5` | Detection and correction of processing errors | Kontext `ops_runbooks`, `OBS` |
| `SOC_2_P6.7` | Personal information disclosed only through secure means | `CRYPTO` ([Pass 08](/de/passes/08-crypto)), `EGR` ([Pass 07](/de/passes/07-egr)) |

Hinweis: Dieser Katalog deklariert die Signalfamilien `IAM`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| CC1: Control Environment | 5 | 0 | `SOC_2_CC1.1` Integrity and ethical values; `SOC_2_CC1.2` Board independence and oversight of information security |
| CC2: Communication and Information | 3 | 0 | `SOC_2_CC2.1` Relevant, quality information to support internal controls; `SOC_2_CC2.2` Internal communication of information security objectives and responsibilities |
| CC3: Risk Assessment | 4 | 0 | `SOC_2_CC3.1` Specification of objectives; `SOC_2_CC3.2` Risk identification and analysis |
| CC4: Monitoring Activities | 2 | 1 | `SOC_2_CC4.1` Ongoing evaluations of internal controls; `SOC_2_CC4.2` Communication of internal control deficiencies |
| CC5: Control Activities | 3 | 2 | `SOC_2_CC5.1` Selection and development of control activities to mitigate risks; `SOC_2_CC5.2` Selection and development of general technology controls |
| CC6: Logical and Physical Access Controls | 8 | 7 | `SOC_2_CC6.1` Logical access security controls; `SOC_2_CC6.2` Access provisioning and removal |
| CC7: System Operations | 5 | 3 | `SOC_2_CC7.1` Detection and monitoring of new vulnerabilities; `SOC_2_CC7.2` Monitoring for anomalous activity |
| CC8: Change Management | 4 | 1 | `SOC_2_CC8.1` Managed infrastructure, data, software, and procedure changes; `SOC_2_CC8.2` Software acquisition and development controls |
| CC9: Risk Mitigation | 2 | 0 | `SOC_2_CC9.1` Risk mitigation activities including transfer; `SOC_2_CC9.2` Assessment of vendor and business partner risk |
| A: Availability | 3 | 1 | `SOC_2_A1.1` Availability commitments and system requirements; `SOC_2_A1.2` Environmental threats and recovery planning |
| PI: Processing Integrity | 5 | 2 | `SOC_2_PI1.1` Complete, accurate, and timely processing; `SOC_2_PI1.2` System inputs are complete, accurate, and authorised |
| C: Confidentiality | 2 | 0 | `SOC_2_C1.1` Identification and maintenance of confidential information; `SOC_2_C1.2` Disposal of confidential information |
| P: Privacy | 18 | 1 | `SOC_2_P1.1` Privacy notice provided to data subjects; `SOC_2_P2.1` Choice and consent for personal information collection |
| **Summe** | **64** | **18** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 43 |
| [`GDPR`](/de/frameworks/gdpr) | 11 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`ISO_27001`](/de/frameworks/iso-27001), [`BSI_C5`](/de/frameworks/bsi-c5), [`GDPR`](/de/frameworks/gdpr), [`EUCS`](/de/frameworks/eucs), [`NIS2`](/de/frameworks/nis2).

## Demo-Variante

| Merkmal | Wert |
|---|---|
| Framework-ID | `SOC_2_DEMO` |
| Ordner | `soc-2-demo` |
| Kontrollen | 12 (CC1.1, CC2.1, CC3.2, CC4.1, CC5.2, CC6.1, CC6.5, CC7.2, CC7.4, CC8.1, CC9.2, A1.2) |
| Bewertungsmodus | `binary` (deklariert) |
| Katalogversion | `0.1.0` |

Die Demo-Variante ist eine Stichprobe der CC-Sicherheitsbasis plus einer Availability-Kontrolle und für Live-Präsentationen gedacht. Ihre Kontroll-IDs entsprechen denen des vollständigen Frameworks (`SOC_2_CC1.1` usw.); aktivieren Sie daher in einer Anwendung entweder `SOC_2` oder `SOC_2_DEMO`, nicht beides. Sie wird von `swao init` nicht automatisch angelegt. Für produktive Assessments verwenden Sie das vollständige `SOC_2`.

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `soc-2` in den Workspace nach `wsp/inputs/catalogs/community/soc-2/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes SOC_2`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [SOC_2]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/soc-2>
- Demo-Variante `SOC_2_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/soc-2-demo>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `soc-2` in Ihren Workspace nach `wsp/inputs/catalogs/community/soc-2/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info SOC_2` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Einen SOC-2-Bericht kann nur eine zugelassene Wirtschaftsprüfungsgesellschaft erstellen. SWAO prüft nicht die Wirksamkeit über einen Zeitraum, die den Kern eines Type-II-Berichts bildet.
- Welche Kategorien gelten, hängt von den Leistungszusagen der Organisation ab; entfernen Sie nicht relevante Kategorien in einer Workspace-Kopie oder behandeln Sie deren Ergebnisse als `N_A`.
