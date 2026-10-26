<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Katalog der Assessment-Dimensionen
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# Katalog der Assessment-Dimensionen

**Zielgruppe:** SWAO-Beraterinnen und -Berater, Engineering-Verantwortliche und Führungskräfte auf Kundenseite
**Version:** 2026-04

Dieser Katalog erläutert jede SWAO-Assessment-Dimension in einfacher Sprache. Er ist
die Referenz für Beraterinnen und Berater, die Ergebnisse vor nicht-technischen
Stakeholdern präsentieren. Für jede Dimension wird beschrieben, was sie misst, warum
sie wichtig ist, wie der Score zu interpretieren ist und welche Formulierungen sich
für Kundenworkshops empfehlen.

---

## 1. 7R-Migrationsmuster

**Was gemessen wird**

Die Dimension ordnet der empfohlenen Cloud-Migrationsstrategie des Workloads eine
Kategorie aus dem branchenüblichen 7R-Framework zu: Retire, Retain, Rehost,
Replatform, Repurchase, Refactor oder Re-architect. Das Verdict ergibt sich aus den
Signalen aller vorangegangenen Assessment-Passes und wird vom SWAO-Sprachmodell
zusammengeführt.

**Warum das wichtig ist**

Das 7R-Label ist der Anker für den Business Case des Programms. Replatform bedeutet,
dass die Anwendung mit begrenzten Codeänderungen umzieht und das Migrationsfenster in
Wochen gemessen wird. Re-architect bedeutet, dass vor Beginn der Migration erhebliche
Investitionen nötig sind, häufig 6 bis 18 Monate Refactoring. Ein falsches Label führt
entweder zu Kostenüberschreitungen (unterschätzte Komplexität) oder zu verschenktem
Nutzen (Over-Engineering eines einfachen Lift-and-Shift).

**Wie der Score ermittelt wird**

Qualitatives Verdict mit numerischem Konfidenzwert (0,0 bis 1,0). Die Konfidenz gibt
den Anteil der Signale mit hoher Konfidenz wieder, die auf dasselbe Verdict
hinauslaufen. Unter einer Konfidenz von 0,70 kennzeichnet das Assessment das Verdict
als prüfungsbedürftig durch einen Menschen.

**Wertebereiche**

| Konfidenz | Status | Interpretation |
|---|---|---|
| 0,90 bis 1,00 | Hohe Konfidenz | Mit der Migrationsplanung beginnen |
| 0,70 bis 0,89 | Belastbar | Annahmen prüfen; unter Vorbehalt fortfahren |
| 0,50 bis 0,69 | Mittel | Vor einer Festlegung zusätzlichen Kontext sammeln |
| < 0,50 | Niedrig | Manuelles Assessment erforderlich; nicht als alleinige Grundlage verwenden |

**Nachweisquellen**

Struktur des Quellcodes, Abhängigkeitsgraph, SBOM, Statefulness-Analyse,
Egress-Signale, Kontexteingaben (CMDB, FinOps, Incident-Historie).

**Typische Findings und Maßnahmen**

| Finding | Empfohlene Maßnahme |
|---|---|
| Verdict: Retain | Den Grund ermitteln (regulatorisch, Abhängigkeit, Kosten). Überprüfungstermin festlegen. |
| Verdict: Re-architect | Den Refactoring-Aufwand abgrenzen. Als Vorbedingung (Pre-Gate) aufnehmen. |
| Niedrige Konfidenz | Einen technischen Workshop ansetzen, um uneindeutige Signale zu klären. |

**Formulierungsvorschlag für die Beratung**

„Auf Grundlage des Assessments empfehlen wir für [Anwendung] einen
Replatform-Ansatz. Der Technologie-Stack ist Cloud-nativ, und es gibt keine
Legacy-Blocker. Die wichtigste Vorbedingung ist die Ablösung der Abhängigkeit von
AWS Comprehend Medical, bevor das Migrationsfenster beginnt.“

---

## 2. Portability Score

**Was gemessen wird**

Wie leicht sich der Workload in eine souveräne Cloud verlagern lässt. Ein Score von 1,0
bedeutet, dass jeder benötigte Backing Service von mindestens zwei souveränen Providern
angeboten wird, kein proprietäres SDK den Code an einen Anbieter bindet, der Workload
containerisiert und als Code beschrieben ist und seine Egress-Dienste souveräne
Äquivalente haben; 0,0 bedeutet das Gegenteil in jeder Komponente. SWAO berechnet den
Score im Code (#3431); das LLM setzt ihn nicht und darf ihn nur kommentieren.

**Warum das wichtig ist**

Der Score sagt das Migrationsrisiko durch Vendor Lock-in voraus. Dienste ohne
souveränes Äquivalent sind Vorbedingungen der Migration: Die Funktion muss
deaktiviert, selbst gehostet oder ersetzt werden, bevor das Migrationsfenster
beginnt. Wird ein Portabilitäts-Blocker spät entdeckt, verzögert sich ein
Migrationsprogramm typischerweise um 3 bis 6 Monate, und es entstehen ungeplante
Kosten.

**Wie der Score ermittelt wird**

```
portability_score = sum(weight_c * value_c) / sum(weight_c)   über die Komponenten mit Daten
```

| Komponente | Gewicht | Wert |
|---|---|---|
| Dienstverfügbarkeit | 0,35 | Anteil der benötigten Dienste (`service_dep:<capability>`), die mindestens 2 souveräne Provider in den Landing-Zone-Katalogen anbieten |
| Vendor Lock-in | 0,25 | 1 minus 0,5 je blockierendem, 0,25 je teilweisem und 0,1 je beherrschbarem proprietären SDK (INV-09), nicht unter 0 |
| Container | 0,15 | Kubernetes- oder Helm-Manifeste 1,0; Dockerfile oder Compose 0,75; keine 0 |
| Infrastructure as Code | 0,10 | Terraform / OpenTofu, Pulumi-State oder Helm-Chart vorhanden 1,0; fehlt 0 |
| Egress | 0,15 | Urteile des Katalogs souveräner Dienste: `available` 1,0, `partial` 0,5, `unavailable` 0; ohne Urteile fest codierte Produktions-Hosts: privat 0,5, öffentlich 0 |

Ein souveräner Provider hat mindestens eine Katalogregion, die von einer EU-Gesellschaft
betrieben wird und deren Fakten keine Exposition gegenüber US CLOUD Act oder FISA 702
ausweisen. Eine Komponente ohne Eingangsdaten (etwa ohne Egress-Ziel oder bei
übersprungenem Vendor-SDK-Scan) entfällt, und die übrigen Gewichte werden neu
normiert; `wsp.yaml` `overall.portability` führt jede Komponente mit `used` und Grund,
sodass fehlende Daten sichtbar sind statt eines Standardwerts von 0,5. Gewichte:
`controls/migration-scores-catalogue.yaml`.

**Wertebereiche**

| Bereich | Status | Interpretation |
|---|---|---|
| 0,85 bis 1,00 | Souveränitätsbereit | Die Migration kann starten; partielle Verdicts prüfen |
| 0,70 bis 0,84 | Bedingt | Ein oder zwei Dienste müssen validiert oder ersetzt werden |
| 0,50 bis 0,69 | Gefährdet | Mehrere Dienste müssen vor der Migration ersetzt werden |
| < 0,50 | Blockiert | Erheblicher Nachbesserungsbedarf; die Migration kann so nicht stattfinden |

**Nachweisquellen**

Pass 01 (Service-Footprint, Vendor-SDKs, Container-Dateien, Terraform- und
Pulumi-State), Pass 06 (Terraform-Wurzeln, Helm- und Kubernetes-Stacks), Pass 07
(Urteile zu souveränen Diensten, fest codierte Endpunkte) und die Landing-Zone-Kataloge
(`lz-catalogues/`).

**Typische Findings und Maßnahmen**

| Finding | Empfohlene Maßnahme |
|---|---|
| Verdict `unavailable` mit `blocks_migration: true` | Vor der Migrations-Vorbedingung ersetzen oder deaktivieren |
| Verdict `partial` | Vom Anbieter eine vertragliche Zusicherung zur Datenverarbeitung in der EU einholen |
| Score unter 0,50 | An das Architecture Board eskalieren; die Einstufung Re-architect prüfen |

**Formulierungsvorschlag für die Beratung**

„Der Portability Score von 0,56 zeigt, dass 44 % der Dienste, die Medplum aufruft,
kein direktes Äquivalent in der souveränen Cloud haben. Die gute Nachricht: Zwei
davon (AWS Textract) sind in der Produktion möglicherweise inaktiv. Sobald wir das
bestätigt haben, steigt der Score auf 0,75, und die Anwendung rückt in den
bedingten Bereich; dann bleibt ein Dienst zu klären.“

---

## 3. Legacy-Indikatoren

**Was gemessen wird**

Erkennt Legacy-Middleware aus dem Unternehmensumfeld, proprietäre Datenbank-Clients
und native Binärabhängigkeiten, die eine Migration in die souveräne Cloud verhindern
oder erschweren. Die Findings werden nach ihrer Auswirkung auf die Migration in drei
Stufen eingeteilt.

**Warum das wichtig ist**

Legacy-Technologie ist die häufigste Einzelursache für festgefahrene
Migrationsprogramme. Tier-1-Blocker (IBM MQ, TIBCO, Oracle SOA Suite) haben kein
Äquivalent in der souveränen Cloud und müssen vor Beginn der Migration vollständig
ersetzt werden. Das ist oft schon für sich ein Engineering-Programm von 12 bis 24
Monaten. Eine frühe Erkennung verhindert überraschende Ausweitungen des Umfangs.

**Wie der Score ermittelt wird**

Qualitatives Verdict (clear / advisory / blocked) mit Anzahl je Stufe. Es gibt keinen
numerischen Score: Schon ein einziger Tier-1-Blocker verschiebt die 7R-Einstufung
unabhängig von allen anderen Scores in Richtung Retain oder Re-architect.

**Definition der Stufen**

| Stufe | Label | Auswirkung auf die Migration |
|---|---|---|
| Tier 1 | Blocker | Kein souveränes Äquivalent; vollständiger Ersatz erforderlich |
| Tier 2 | Erschwernis | Souveräne Alternative vorhanden; erheblicher Migrationsaufwand (30 bis 90 Tage) |
| Tier 3 | Beherrschbar | Erhöht die Migrationskosten; ändert die 7R-Einstufung nicht |

**Nachweisquellen**

Abhängigkeitsmanifeste (package.json, pom.xml, requirements.txt, Cargo.toml),
Dateimuster (.bts, .cbl), Images aus Docker Compose, SQL-Migrationsdateien.

**Typische Findings und Maßnahmen**

| Finding | Empfohlene Maßnahme |
|---|---|
| IBM MQ (Tier 1) | Cloud-natives Messaging prüfen (Azure Service Bus in souveräner Ausprägung oder selbst gehostetes ActiveMQ) |
| Oracle DB mit Stored Procedures > 500 Zeilen (Tier 1) | Den Migrationsaufwand für die Stored Procedures abgrenzen, bevor ein Zeitplan zugesagt wird |
| .NET Framework mit Windows-APIs (Tier 2) | Auf .NET 8+ portieren; Containerisierung validieren |

**Formulierungsvorschlag für die Beratung**

„Medplum ist legacy-frei: Es wurden keine Tier-1-Blocker erkannt. Das ist ein
positives Unterscheidungsmerkmal, denn die Migration wird nicht durch technische
Schulden ausgebremst. Im Gegensatz dazu finden wir in Workloads aus dem
Gesundheitswesen häufig IBM MQ oder Oracle SOA, was das Programm um 12 bis 18 Monate
verlängert.“

---

## 4. Machbarkeit der Datenmigration

**Was gemessen wird**

Bewertet, ob sich das zustandsbehaftete Datenvolumen der Anwendung bei realistischer
Übertragungsrate innerhalb des vereinbarten Recovery Time Objective (RTO) migrieren
lässt. Ein Machbarkeitsverhältnis über 1,0 bedeutet, dass eine Umstellung in einem
einzigen Fenster nicht erreichbar ist.

**Warum das wichtig ist**

Die Datenmigration ist die komplexeste und risikoreichste Phase einer
Cloud-Migration. Eine Datenbank mit 800 GB, deren Übertragung 8 Stunden dauert, lässt
sich nicht in einem zweistündigen Wartungsfenster am Wochenende migrieren. Wird das
spät erkannt, bleibt nur eine längere Ausfallzeit (Geschäftsrisiko) oder eine
ungeplante Investition in CDC- bzw. Replikationsinfrastruktur.

**Wie der Score ermittelt wird**

```
feasibility_ratio = estimated_transfer_hours / rto_hours
```

Verhältnis < 1,0 = machbar (einmalige Umstellung). Verhältnis > 1,0 = phasenweise
Migration erforderlich.

**Wertebereiche**

| Verhältnis | Verdict | Konsequenz |
|---|---|---|
| < 1,0 | Machbar | Migration in einem einzigen Fenster ist erreichbar |
| 1,0 bis 2,0 | Grenzwertig | Ein Fenster außerhalb der Spitzenzeiten oder ein inkrementelles Vorgehen erwägen |
| 2,0 bis 5,0 | Phasenweise Migration erforderlich | CDC-Brücke oder logische Replikation erforderlich |
| > 5,0 | Großes Datenmigrationsprogramm | Eigener Workstream für die Datenmigration erforderlich |

**Nachweisquellen**

Kontexteingaben: FinOps-Daten (Speicherkosten als Grundlage der Volumenschätzung),
CMDB (Datenbank-Engine und Größe), Statefulness-Signale (STATE-Pass).

**Formulierungsvorschlag für die Beratung**

„Bei 828 GB FHIR-Daten und einem RTO von 2 Stunden ist eine direkte Umstellung nicht
möglich. Wir empfehlen eine Debezium-CDC-Brücke, die das Replikat in der souveränen
Cloud synchron hält. Dadurch verkürzt sich das eigentliche Umstellungsfenster auf
unter 30 Minuten, während die Anwendung Patientinnen und Patienten während der
Migration weiter versorgt.“

---

## 5. CI/CD-Pipeline-Sicherheit

**Was gemessen wird**

Bewertet die Angriffsfläche der Lieferkette in der CI/CD-Pipeline der Anwendung
anhand eines Katalogs von acht Sicherheitsregeln (PP-R-01 bis PP-R-08). Diese decken
das Pinning von GitHub Actions, die Verwaltung von Zugangsdaten, die Einbindung von
SAST, das Dependency Review und die Build-Provenienz ab.

**Warum das wichtig ist**

Supply-Chain-Angriffe (SolarWinds, XZ Utils, der Vorfall um tj-actions) haben ihren
Ursprung häufig in CI/CD-Pipelines. Eine Migration in die souveräne Cloud ist eine
Phase erhöhten Risikos: Pipelines werden angepasst, neue Zugangsdaten werden
bereitgestellt, und Deployment-Pfade ändern sich. Eine gehärtete Pipeline verringert
die Angriffsfläche in der verwundbarsten Phase.

**Wie der Score ermittelt wird**

Anzahl der Findings je Schweregrad (critical, high, medium, low). Positive Kontrollen
werden separat erfasst. Es gibt keinen Gesamt-Score; die Verteilung der Schweregrade
bestimmt die Empfehlung.

**Nachweisquellen**

Workflow-Dateien von GitHub Actions (.github/workflows/),
package-lock.json/pnpm-lock.yaml (Integrität der Abhängigkeiten),
SAST-Werkzeugkonfiguration.

**Typische Findings und Maßnahmen**

| Finding | Empfohlene Maßnahme |
|---|---|
| Nicht gepinnte GitHub Actions (uses: action@v3) | Auf SHA pinnen: `uses: action@sha256:...` |
| Statische Deployment-Zugangsdaten | Durch kurzlebige, OIDC-basierte Tokens ersetzen |
| Kein SAST im PR-Gate | CodeQL oder ein vergleichbares Werkzeug als erforderlichen Status-Check aufnehmen |
| Keine SBOM-Attestierung | Einen Schritt `attest-build-provenance` in den Release-Workflow aufnehmen |

**Formulierungsvorschlag für die Beratung**

„Die Produktions-Pipeline von Medplum ist gut gehärtet: Actions mit SHA-Pinning,
OIDC-Authentifizierung und CodeQL aktiv in Pull Requests. Die vier Findings mit
Schweregrad medium betreffen nachgelagerte Workflows ohne Berührung zur Produktion.
Wir empfehlen, sie vor dem Migrationsfenster zu beheben, um während der Umstellung
jede Angriffsfläche auszuschließen.“

---

## 6. Observability-Reife

**Was gemessen wird**

Die Abdeckung der Monitoring-Instrumentierung über acht Anwendungskomponenten:
HTTP-Schicht, Hintergrund-Job-Queues, Performance von Datenbankabfragen, Aufrufe
externer Dienste, Fehlertracking, Distributed Tracing, eigene Geschäftsmetriken und
strukturierte Log-Ausgabe.

**Warum das wichtig ist**

Eine Anwendung, die in der Produktion nicht beobachtet werden kann, lässt sich nicht
sicher migrieren. Fehlen in der souveränen Cloud Metriken oder Traces, bleibt ein
Fehler während oder nach der Migration unentdeckt, bis ein Kunde ihn meldet.
Observability-Lücken gehören zu den häufigsten Ursachen gescheiterter
Cloud-Migrationen.

**Wie der Score ermittelt wird**

```
observability_score = instrumented_components / 8
```

Schwellenwert: 0,60 (mindestens 5 von 8 Komponenten instrumentiert, bevor eine
Migration empfohlen wird).

**Wertebereiche**

| Bereich | Status | Interpretation |
|---|---|---|
| 0,75 bis 1,00 | Souveränitätsbereit | Die Migration kann starten; die Konfiguration des OTel-Endpunkts prüfen |
| 0,60 bis 0,74 | Bedingt | Verbleibende Lücken vor dem Go-live der Migration schließen |
| < 0,60 | Nicht bereit | Nicht migrieren, bevor die Observability-Lücken geschlossen sind |

**Typische Findings und Maßnahmen**

| Finding | Empfohlene Maßnahme |
|---|---|
| Queue nicht instrumentiert | OTel-Spans in die Job-Prozessoren von Bull/BullMQ aufnehmen |
| Kein Distributed Tracing | `@opentelemetry/sdk-node` mit Propagierung des W3C-Trace-Kontexts einführen |
| Logs nicht strukturiert | `console.log` durch JSON-Ausgabe mit pino/winston ersetzen |

---

## 7. Lizenz-Compliance

**Was gemessen wird**

Durchsucht die SBOM nach OSS-Lizenzen, die mit kommerzieller Verbreitung oder einem
Deployment in der souveränen Cloud nicht vereinbar sind. Markiert werden
Copyleft-Lizenzen (GPL, AGPL), die eine Offenlegung des Quellcodes verlangen, sowie
proprietäre Lizenzen mit geografischen oder nutzungsbezogenen Einschränkungen.

**Warum das wichtig ist**

Verstöße gegen Lizenzbedingungen können eine Migration stoppen oder eine kurzfristige
Entfernung von Code erzwingen. Insbesondere AGPL-Lizenzen betreffen die Dienste, die die Anwendung selbst über ein
Netzwerk bereitstellt: Wird AGPL-Code verändert, muss Nutzern, die mit diesem Dienst
über das Netzwerk interagieren, der zugehörige Quellcode angeboten werden. Der Aufruf
eines fremden AGPL-Dienstes löst diese Pflicht nicht aus. Das ist in Workloads aus dem
Gesundheitswesen und der Finanzbranche ein häufiger Auslöser.

**Wertebereiche**

| Verdict | Interpretation |
|---|---|
| clear | Keine Lizenzkonflikte erkannt |
| advisory | Copyleft-Lizenzen vorhanden; rechtliche Prüfung vor dem Go-live empfohlen |
| blocked | Ein Lizenzkonflikt muss vor der Migration behoben werden |

---

## 8. Test- und Qualitätsreife

**Was gemessen wird**

Bewertet die Breite der Testabdeckung der Anwendung (Unit, Integration, E2E), die
Zuverlässigkeit der Tests (Flakiness, Anteil übersprungener Tests) und die
Konfiguration der Quality Gates (erforderliche Checks in Pull Requests,
Mindestabdeckung).

**Warum das wichtig ist**

Migrationen verursachen Regressionen. Ohne zuverlässige Testsuite lässt sich nicht
nachweisen, dass sich die migrierte Version genauso verhält wie das Original. Eine
geringe Testreife erhöht das Risiko unbemerkter Regressionen in der souveränen Cloud,
insbesondere bei FHIR-konformen Anwendungen im Gesundheitswesen, bei denen
Datenintegrität eine Frage der Patientensicherheit ist.

**Wertebereiche**

| Bereich | Status | Interpretation |
|---|---|---|
| 0,80 bis 1,00 | Ausgereift | Das Regressionsrisiko der Migration ist gering |
| 0,60 bis 0,79 | Im Aufbau | Abdeckungslücken in kritischen Pfaden vor der Migration schließen |
| < 0,60 | Unausgereift | Manueller Regressionstestplan erforderlich; Migrationsrisiko berücksichtigen |

---

## Diesen Katalog über Claude Desktop nutzen

Mit den folgenden Prompts können Sie jede Dimension aus Claude Desktop abfragen,
sobald ein Assessment durchgeführt wurde. Ersetzen Sie `[app]` durch die Kennung der
Anwendung und `[workspace]` durch den absoluten Pfad zum Portfolio-Stammverzeichnis.

### Berichte nach Stakeholder-Persona lesen

| Persona | Schwerpunkt-Dimensionen | Prompt |
|---|---|---|
| Application Architect | Alle 8 Dimensionen plus Signalnachweise | `Use swao_report for [app], view application-architect.` |
| Business Owner | 7R-Label, Portabilität, Legacy-Blocker, Kosten | `Use swao_report for [app], view business-owner.` |
| GRC- / Compliance-Verantwortliche | Compliance-Kontrollen, Lücken zu GDPR/BSI C5/NIST | `Use swao_report for [app], view grc-compliance-officer.` |
| FinOps-Verantwortliche | Kostenmodell, Egress-Kosten, Dimensionierung der Landing Zone | `Use swao_report for [app], view finops-lead.` |
| Programmmanagement | Blocker, Zeitplan, Abhängigkeiten, Risikoregister | `Use swao_report for [app], view programme-manager.` |

### Einzelne Dimensionen abfragen

| Dimension | Signal-Präfix | Prompt |
|---|---|---|
| 7R-Migrationsmuster | SYNTH | `Use swao_signal_detail for [app], signal_id: SYNTH-01.` |
| Portability Score | EGR | `Use swao_signals for [app], prefix_filter: EGR.` |
| Legacy-Indikatoren | INV, STATE | `Use swao_signals for [app], prefix_filter: INV,STATE.` |
| Machbarkeit der Datenmigration | DATA, STATE | `Use swao_signals for [app], prefix_filter: DATA,STATE.` |
| CI/CD-Pipeline-Sicherheit | TF | `Use swao_signals for [app], prefix_filter: TF.` |
| Observability-Reife | OBS | `Use swao_signals for [app], prefix_filter: OBS.` |
| Lizenz-Compliance | LIC, SBOM | `Use swao_signals for [app], prefix_filter: LIC,SBOM.` |
| Test- und Qualitätsreife | QA | `Use swao_signals for [app], prefix_filter: QA.` |

### Compliance-Kontrollen je Dimension vertiefen

| Ziel | Prompt |
|---|---|
| Verdict einer GDPR-Kontrolle | `Use swao_control_detail for [app], control_id: GDPR_DEMO.ART46.` |
| Alle Kontrollen mit Status GAP | `Use swao_report for [app], view grc-compliance-officer.` |
| GDPR-Kontrollen durchsuchen (kein Assessment nötig) | `Use swao_control_catalogue, framework_id: GDPR.` |
| BSI-C5-Kontrollen durchsuchen | `Use swao_control_catalogue, framework_id: BSI_C5.` |
| Alle unterstützten Frameworks auflisten | `Use swao_frameworks_list.` |

### Nachweise einlesen, die eine Dimension aktualisieren

| Aktion | Prompt |
|---|---|
| Einen Maßnahmenplan bereitstellen (Text) | `Use swao_ingest for [app]. Category: compliance. Filename: [name].md. Content: [text].` |
| Strukturierten Nachweis für ein Signal erfassen | `Use swao_evidence_capture for [app]. Addresses: ["[signal-id]"]. Statement: [one sentence]. Type: architecture_doc. Author: [email].` |
| Ein maschinelles Verdict übersteuern | `Use swao_feedback_add for [app]. Target_type: signal. Target_id: [id]. Override_outcome: RISK_ACCEPTED. Rationale: [reason]. Author: [email].` |
| Eine Kontrolle als erfüllt markieren | `Use swao_feedback_add for [app]. Target_type: control. Target_id: [control-id]. Override_outcome: SATISFIED. Rationale: [reason]. Author: [email].` |
| Alle erfassten Overrides auflisten | `Use swao_feedback_list for [app].` |

### Abfragen zu Landing Zone und Cloud-Anbietern

| Ziel | Prompt |
|---|---|
| Warum wurde diese Landing Zone gewählt? | `Use swao_explain_landing_zone for [app].` |
| Passung der Anwendung zu einer bestimmten Region | `Use swao_lz_fit for [app], provider: stackit, region: eu01.` |
| Fakten zur Souveränität der Anbieter | `Use swao_cloud_provider_catalogue.` |
| Gewichtungen des LZR-Scorings | `Use swao_lzr_weights for [app].` |

Die vollständige Tool-Referenz finden Sie unter [MCP-Integration](/de/runbooks/mcp-integration).
