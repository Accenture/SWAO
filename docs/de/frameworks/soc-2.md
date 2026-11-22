# SOC 2 Trust Services Criteria (SOC_2)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `SOC_2` |
| Herausgeber | American Institute of Certified Public Accountants (AICPA) |
| Version | 2017 (überarbeitete Points of Focus 2022) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `2.0.0` |
| Anzahl Kontrollen | 61 |
| Bewertungsmodus | `binary` (in framework-meta.yaml deklariert) |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `SOC2` |
| Lizenz und Weitergabe | Die Trust Services Criteria sind urheberrechtlich geschützt (AICPA), die COSO-Prinzipien ebenso (COSO). Der Katalog zitiert nur die Kriterien-IDs und beschreibt jedes Kriterium mit eigenen Worten; Kriterientext und Points of Focus werden nicht wiedergegeben. |
| Zuletzt geprüft | 2026-11-09 |

## Worum es geht

SOC 2 ist ein Prüfbericht (Attestation), weder ein Gesetz noch eine Zertifizierung. Eine zugelassene Wirtschaftsprüfungsgesellschaft (CPA) prüft die Kontrollen eines Dienstleisters gegen die AICPA Trust Services Criteria und erstellt einen Type-I-Bericht (Ausgestaltung zu einem Stichtag) oder einen Type-II-Bericht (Ausgestaltung und Wirksamkeit über einen Zeitraum). SOC-2-Berichte werden häufig von US-amerikanischen Unternehmenskunden von SaaS- und Cloud-Diensten verlangt.

Die Kriterien sind in fünf Trust Services Categories gegliedert. Die Common Criteria (CC, Sicherheit) sind in jedem SOC-2-Bericht Pflicht; Availability (A), Processing Integrity (PI), Confidentiality (C) und Privacy (P) kommen je nach den Zusagen der Organisation hinzu. Der SWAO-Katalog enthält 61 Kontrollen, eine je Kriterium: 33 CC, 3 A, 5 PI, 2 C und 18 P.

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

Jede Kontrolle trägt einen Evidenz-Tag:

| Evidenzart (Tag) | Kontrollen | Bedeutung |
|---|---|---|
| `evidence.workload` | 3 | Code-, Konfigurations- oder Infrastrukturevidenz |
| `evidence.both` | 15 | Technische Evidenz plus Dokumente, die sie vervollständigen |
| `evidence.organisational` | 43 | Nur Dokumente (`layer: governance`) |

Organisatorische Kontrollen beziehen ihre Evidenz aus dem Ingestion-Ordner der Anwendung. Legen Sie die Dokumente in `apps/<app-id>/ingestion/` ab; Pass 00 kopiert sie nach `wsp/inputs/` und extrahiert den Text, und [Pass 04 (CTX)](/de/passes/04-ctx) erzeugt daraus Signale, die die Datei zitieren. Eine Kontrolle mit `layer: governance` ist nur dann `SATISFIED` oder `PARTIAL`, wenn ein zitiertes Signal eines der erwarteten Dokumente zitiert; sonst ist sie `UNKNOWN` (nicht bewertet, unzureichende Evidenz) mit Angabe der erwarteten Dokumente. Fehlende Evidenz ist nie ein Bestehen.

Ein Dokument zählt als erwartet, wenn sein Dateiname den erwarteten Eingabenamen enthält (ohne Beachtung von Groß- und Kleinschreibung und Trennzeichen), zum Beispiel `vendor_risk_register.xlsx` oder `incident_management_procedure.pdf`. Das Framework-README listet, welches Dokument welche Kontrolle belegt. Wo DORA dasselbe Dokument erwartet, ist der Name gleich.

Alle 18 Privacy-Kontrollen (`SOC_2_P1.1` bis `SOC_2_P8.1`) deklarieren `assessment_type_scope: [aud]`: Sie erfordern Audit-Evidenz wie Datenschutzhinweise, Einwilligungsnachweise und Verfahren für Betroffenenanfragen. `SOC_2_CC6.4` und `SOC_2_CC6.5` sind als `csp_inherited: true` gekennzeichnet; diese physischen Kontrollen werden üblicherweise aus dem Prüfbericht des Cloud-Anbieters übernommen. 18 Kontrollen deklarieren eine Signalfamilie:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `SOC_2_CC4.1` | Ongoing and separate evaluations of controls | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `ict_internal_audit_plan` |
| `SOC_2_CC5.2` | General controls over technology | `TF` ([Pass 06](/de/passes/06-tf)), `IAM`, Kontext `configuration_baseline` |
| `SOC_2_CC6.1` | Logical access security, authentication and encryption of protected assets | `IAM`, `CRYPTO` ([Pass 08](/de/passes/08-crypto)), Kontext `access_management_policy` |
| `SOC_2_CC6.2` | User registration and authorisation before credentials are issued | `IAM`, Kontext `access_management_policy` |
| `SOC_2_CC6.3` | Role-based access, least privilege and segregation of duties | `IAM`, Kontext `access_management_policy` |
| `SOC_2_CC6.6` | Protection against threats from outside the system boundary | `EGR` ([Pass 07](/de/passes/07-egr)), `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)) |
| `SOC_2_CC6.7` | Controlled and protected transmission and movement of data | `EGR` ([Pass 07](/de/passes/07-egr)), `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `SOC_2_CC6.8` | Prevention and detection of unauthorised or malicious software | `SBOM` ([Pass 05](/de/passes/05-sbom)), `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)) |
| `SOC_2_CC7.1` | Detection of vulnerabilities and insecure configuration changes | `SBOM` ([Pass 05](/de/passes/05-sbom)), `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `patch_management_policy` |
| `SOC_2_CC7.2` | Monitoring for anomalies that point to attacks, failures or errors | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `monitoring_and_alerting_runbook` |
| `SOC_2_CC7.3` | Evaluation of security events as incidents | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `incident_classification_policy` |
| `SOC_2_CC8.1` | Controlled changes to infrastructure, data, software and procedures | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `change_management_procedure` |
| `SOC_2_A1.1` | Capacity management | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `capacity_management_plan` |
| `SOC_2_A1.2` | Environmental protection, backup and recovery infrastructure | `TF` ([Pass 06](/de/passes/06-tf)), Kontext `backup_policy` |
| `SOC_2_PI1.2` | Complete and accurate system inputs | `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `processing_specification` |
| `SOC_2_PI1.3` | Complete, accurate and timely processing | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `processing_specification` |
| `SOC_2_PI1.5` | Complete and accurate storage of inputs, work in progress and outputs | `TF` ([Pass 06](/de/passes/06-tf)), `CTX` ([Pass 04](/de/passes/04-ctx)), Kontext `processing_specification` |
| `SOC_2_C1.1` | Identification and protection of confidential information | `CRYPTO` ([Pass 08](/de/passes/08-crypto)), Kontext `data_classification_policy` |

Hinweis: Dieser Katalog deklariert die Signalfamilie `IAM`. Kein Pass der aktuellen Version erzeugt Signale mit diesem Präfix; die betroffenen Kontrollen werden in der Praxis anhand verwandter Signale (etwa Terraform- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| CC1: Control environment | 5 | 0 | `SOC_2_CC1.1` Integrity and ethical values; `SOC_2_CC1.2` Independent oversight of internal control by the governing body |
| CC2: Communication and information | 3 | 0 | `SOC_2_CC2.1` Quality information for running internal control; `SOC_2_CC2.2` Internal communication of control objectives and duties |
| CC3: Risk assessment | 4 | 0 | `SOC_2_CC3.1` Objectives clear enough to assess risk against; `SOC_2_CC3.2` Risk identification and analysis |
| CC4: Monitoring activities | 2 | 1 | `SOC_2_CC4.1` Ongoing and separate evaluations of controls; `SOC_2_CC4.2` Reporting and correcting control deficiencies |
| CC5: Control activities | 3 | 1 | `SOC_2_CC5.1` Control activities chosen to reduce risk; `SOC_2_CC5.2` General controls over technology |
| CC6: Logical and physical access controls | 8 | 6 | `SOC_2_CC6.1` Logical access security, authentication and encryption of protected assets; `SOC_2_CC6.2` User registration and authorisation before credentials are issued |
| CC7: System operations | 5 | 3 | `SOC_2_CC7.1` Detection of vulnerabilities and insecure configuration changes; `SOC_2_CC7.2` Monitoring for anomalies that point to attacks, failures or errors |
| CC8: Change management | 1 | 1 | `SOC_2_CC8.1` Controlled changes to infrastructure, data, software and procedures |
| CC9: Risk mitigation | 2 | 0 | `SOC_2_CC9.1` Mitigation of business disruption risk; `SOC_2_CC9.2` Vendor and business partner risk |
| A: Availability | 3 | 2 | `SOC_2_A1.1` Capacity management; `SOC_2_A1.2` Environmental protection, backup and recovery infrastructure |
| PI: Processing Integrity | 5 | 3 | `SOC_2_PI1.1` Processing specifications and data definitions; `SOC_2_PI1.2` Complete and accurate system inputs |
| C: Confidentiality | 2 | 1 | `SOC_2_C1.1` Identification and protection of confidential information; `SOC_2_C1.2` Disposal of confidential information |
| P: Privacy | 18 | 0 | `SOC_2_P1.1` Privacy notice to data subjects; `SOC_2_P2.1` Choice and consent |
| **Summe** | **61** | **18** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 39 |
| [`BSI_C5`](/de/frameworks/bsi-c5) | 32 |
| [`GDPR`](/de/frameworks/gdpr) | 18 |
| [`DORA`](/de/frameworks/dora) | 7 |

Jedes Mapping wurde am 2026-11-09 auf denselben Gegenstand auf beiden Seiten geprüft (#4061). Die sieben DORA-Paare gelten in beide Richtungen und stehen mit dem verbindenden ISO/IEC-27001-Control im DORA-README. Die Mappings nach ISO/IEC 27001 und BSI C5 gelten in eine Richtung; diese Kataloge verweisen nicht zurück auf SOC 2. Keine Entsprechung haben `SOC_2_CC3.3` (Betrugsrisiko) und `SOC_2_PI1.1` bis `SOC_2_PI1.5`.

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`ISO_27001`](/de/frameworks/iso-27001), [`BSI_C5`](/de/frameworks/bsi-c5), [`GDPR`](/de/frameworks/gdpr), [`DORA`](/de/frameworks/dora).

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
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `soc-2` in Ihren Workspace nach `wsp/inputs/catalogs/community/soc-2/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework list` listet die Rahmenwerke im Workspace.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Einen SOC-2-Bericht kann nur eine zugelassene Wirtschaftsprüfungsgesellschaft erstellen. SWAO prüft nicht die Wirksamkeit über einen Zeitraum, die den Kern eines Type-II-Berichts bildet.
- Welche Kategorien gelten, hängt von den Leistungszusagen der Organisation ab; entfernen Sie nicht relevante Kategorien in einer Workspace-Kopie oder behandeln Sie deren Ergebnisse als `N_A`.
