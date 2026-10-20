# OpenSSF Security Scorecard (OPENSSF_SCORECARD)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `OPENSSF_SCORECARD` |
| Herausgeber | Open Source Security Foundation (OpenSSF), Linux Foundation |
| Version | v4.13 / v5.0-rc (2024) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 17 |
| Bewertungsmodus | In framework-meta.yaml ist `weighted` deklariert. `controls.yaml` setzt keinen `scoring_mode`, daher wird der Katalog mit dem Schema-Standard `binary` geladen; das Scorecard-Gewicht jedes Checks steht im Kontrolltitel. |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `OSS` |
| Lizenz und Weitergabe | OpenSSF Scorecard ist ein Apache-2.0-Projekt; Check-Namen und Kriterien werden unter Apache-2.0-Bedingungen wiedergegeben. |
| Zuletzt geprüft | 2026-09-21 |

## Worum es geht

Die OpenSSF Security Scorecard ist ein automatisiertes Werkzeug der Open Source Security Foundation (Linux Foundation), das die Sicherheitspraktiken von Open-Source-Projekten bewertet. Jeder Check (etwa Branch-Protection, Code-Review, Pinned-Dependencies oder Dangerous-Workflow) wird von 0 bis 10 bewertet und hat ein veröffentlichtes Gewicht. Scorecard ist keine Regulierung, sondern ein verbreitetes Maß für die Hygiene der Software-Lieferkette; CISA-Leitlinien zur Absicherung der Software-Lieferkette und das NIST SSDF (SP 800-218) verweisen darauf.

SWAO bildet die Scorecard-Checks als 17 Kontrollen in fünf Domänen ab. Der Titel jeder Kontrolle nennt den Scorecard-Check und sein Gewicht, zum Beispiel `OSS_VLN_1` No known open CVEs in dependencies (Scorecard: Vulnerabilities, weight 10).

## Wer es in SWAO nutzen sollte und wann

Setzen Sie OPENSSF_SCORECARD ein, wenn Open-Source-Software Teil des Risikobilds ist:

- die Anwendung hängt stark von Open-Source-Paketen ab, und der Kunde möchte das Lieferkettenrisiko verstehen;
- der Kunde pflegt ein Open-Source- oder Inner-Source-Projekt und benötigt einen Vergleichsmaßstab für die Sicherheitslage;
- es wird Lieferketten-Evidenz für die Lieferkettenmaßnahmen nach [NIS2](/de/frameworks/nis2) oder die Anforderungen an den Umgang mit Schwachstellen nach [EU_CRA](/de/frameworks/eu-cra) benötigt.

Das Framework ist regions- und branchenneutral. Laut Katalog soll das öffentliche Repository von SWAO selbst 8 oder mehr Punkte erreichen.

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

SWAO führt mit diesem Framework weder das Scorecard-Werkzeug aus noch fragt es die öffentliche Scorecard-API ab. Die Kontrollen werden anhand der Signale des Laufs und von Kontextdokumenten bewertet: 10 Kontrollen nennen die Lösungsarchitektur, 6 die Betriebs-Runbooks als Kontext. Sechs Kontrollen zur Repository-Governance deklarieren `assessment_type_scope: [aud]`: `OSS_INT_1`, `OSS_INT_2`, `OSS_INT_4`, `OSS_SCH_3`, `OSS_OPS_3` und `OSS_CMH_1`. Wenn Sie echte Scorecard-Ergebnisse nutzen möchten, exportieren Sie diese (etwa aus der Scorecard-CLI oder -API) und stellen Sie sie als Kontextdokumente bereit. Eine Kontrolle deklariert eine Signalfamilie:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `OSS_VLN_1` | No known open CVEs in dependencies (Scorecard: Vulnerabilities, weight 10) | `TF` ([Pass 06](/de/passes/06-tf)) |

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| OSS-INT: Code and Repository Integrity | 5 | 0 | `OSS_INT_1` Branch protection on default branch (Scorecard: Branch-Protection, weight 3); `OSS_INT_2` Code review required for all changes (Scorecard: Code-Review, weight 3); `OSS_INT_3` Signed releases (Scorecard: Signed-Releases, weight 4); `OSS_INT_4` No binary artefacts committed to repository (Scorecard: Binary-Artifacts, weight 5); `OSS_INT_5` Pinned dependencies by cryptographic hash (Scorecard: Pinned-Dependencies, weight 7) |
| OSS-VLN: Vulnerability Management | 3 | 1 | `OSS_VLN_1` No known open CVEs in dependencies (Scorecard: Vulnerabilities, weight 10); `OSS_VLN_2` Automated dependency update tool active (Scorecard: Dependency-Update-Tool, weight 10); `OSS_VLN_3` Static analysis (SAST) running in CI (Scorecard: SAST, weight 3) |
| OSS-SCH: Supply Chain Security | 4 | 0 | `OSS_SCH_1` GitHub Actions tokens use least privilege (Scorecard: Token-Permissions, weight 4); `OSS_SCH_2` No dangerous workflows with script injection risk (Scorecard: Dangerous-Workflow, weight 10); `OSS_SCH_3` Published to package registry from CI only (Scorecard: Packaging, weight 4); `OSS_SCH_4` Webhook secrets configured (Scorecard: Webhooks, weight 4) |
| OSS-OPS: Operational Security | 3 | 0 | `OSS_OPS_1` Security policy published in repository (Scorecard: Security-Policy, weight 1); `OSS_OPS_2` Project actively maintained (Scorecard: Maintained, weight 1); `OSS_OPS_3` CII Best Practices badge (Scorecard: CII-Best-Practices, weight 1) |
| OSS-CMH: Community Health | 2 | 0 | `OSS_CMH_1` Open source license file present (Scorecard: License, weight 3); `OSS_CMH_2` Diverse contributor base (Scorecard: Contributors, weight 1) |
| **Summe** | **17** | **1** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`EU_CRA`](/de/frameworks/eu-cra) | 10 |
| [`ISO_27001`](/de/frameworks/iso-27001) | 6 |
| [`NIS2`](/de/frameworks/nis2) | 6 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`EU_CRA`](/de/frameworks/eu-cra), [`NIS2`](/de/frameworks/nis2), [`ISO_27001`](/de/frameworks/iso-27001), [`GDPR`](/de/frameworks/gdpr).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `openssf-scorecard` in den Workspace nach `wsp/inputs/catalogs/community/openssf-scorecard/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes OPENSSF_SCORECARD`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [OPENSSF_SCORECARD]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/openssf-scorecard>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `openssf-scorecard` in Ihren Workspace nach `wsp/inputs/catalogs/community/openssf-scorecard/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info OPENSSF_SCORECARD` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Scorecard misst Praktiken, die in einem Quell-Repository und dessen CI-Konfiguration sichtbar sind. Über die Laufzeitsicherheit oder die Sicherheit des betriebenen Workloads sagt es wenig aus.
- Ergebnisse für private Repositories erfordern einen Lauf des Scorecard-Werkzeugs mit passenden Zugriffsrechten; SWAO übernimmt dies nicht.
