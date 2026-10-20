# NCA Essential Cybersecurity Controls ECC-2:2024 (NCA_ECC)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `NCA_ECC` |
| Herausgeber | National Cybersecurity Authority (NCA), Königreich Saudi-Arabien |
| Version | ECC-2:2024 (herausgegeben 2024) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 28 |
| Bewertungsmodus | `binary` (Schema-Standard; nicht deklariert) |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `NCA_ECC` |
| Lizenz und Weitergabe | Von der NCA herausgegeben, eingestuft als TLP:White / öffentlich. Die Beschreibungen geben den Subdomänen-Text sinngemäß wieder; maßgeblich ist die arabische Fassung. Keine Rechtsberatung. |
| Zuletzt geprüft | 2026-07-18 |

## Worum es geht

Die Essential Cybersecurity Controls (ECC-2:2024) sind die verpflichtende Mindest-Sicherheitsbasis der National Cybersecurity Authority (NCA) des Königreichs Saudi-Arabien. Sie gelten für Organisationen unter NCA-Aufsicht, darunter Behörden und Organisationen kritischer Sektoren, und bilden die Grundlage für sektor- und themenspezifische NCA-Kontrollen wie die Cloud-Kontrollen [NCA_CCC_CST](/de/frameworks/nca-ccc-2-2024-cst) und [NCA_CCC_CSP](/de/frameworks/nca-ccc-2-2024-csp).

ECC-2:2024 umfasst vier Hauptdomänen: Cybersecurity Governance (10 Subdomänen), Cybersecurity Defense (15), Cybersecurity Resilience (1) sowie Third-Party and Cloud Computing Cybersecurity (2). Der SWAO-Katalog bildet je Subdomäne eine Kontrolle ab, insgesamt 28 (Beschreibung in `framework-meta.yaml`).

## Wer es in SWAO nutzen sollte und wann

Setzen Sie NCA_ECC für jeden Workload einer Organisation unter NCA-Aufsicht ein: Behördensysteme, kritische Infrastruktur, Finanzdienstleistungen und Cloud-Workloads (Anwendbarkeitshinweise im Katalog). Es ist das naheliegende erste Framework für Engagements in Saudi-Arabien und wird meist mit [NCA_CCC_CST](/de/frameworks/nca-ccc-2-2024-cst) für Cloud-Workloads und [SAMA_CSF](/de/frameworks/sama-csf-v1) für SAMA-regulierte Finanzinstitute kombiniert.

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

24 der 28 Kontrollen stützen sich auf vom Beraterteam bereitzustellende Evidenzdateien, zum Beispiel `evidence/gov-01-cybersecurity-strategy.md` für `NCA_ECC_GOV_01` Cybersecurity Strategy. Vier Defense-Kontrollen deklarieren eine automatisierte Signalfamilie:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `NCA_ECC_DEF_02` | Identity and Access Management | `IAM` |
| `NCA_ECC_DEF_08` | Cryptography | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NCA_ECC_DEF_09` | Backup and Recovery Management | `INFRA` |
| `NCA_ECC_DEF_12` | Cybersecurity Event Logs and Monitoring Management | `OBS` |

Hinweis: Dieser Katalog deklariert die Signalfamilien `IAM`, `INFRA`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

Jede Kontrolle trägt Tags auf den Achsen `domain`, `applies-to`, `mechanism` und `evidence`.

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| Cybersecurity Governance | 10 | 0 | `NCA_ECC_GOV_01` Cybersecurity Strategy; `NCA_ECC_GOV_02` Cybersecurity Management |
| Cybersecurity Defense | 15 | 4 | `NCA_ECC_DEF_01` Asset Management; `NCA_ECC_DEF_02` Identity and Access Management |
| Cybersecurity Resilience | 1 | 0 | `NCA_ECC_RES_01` Cybersecurity Resilience Aspects of Business Continuity Management (BCM) |
| Third-Party and Cloud Computing Cybersecurity | 2 | 0 | `NCA_ECC_TPC_01` Third-Party Cybersecurity; `NCA_ECC_TPC_02` Cloud Computing and Hosting Cybersecurity |
| **Summe** | **28** | **4** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| `NIST_CSF` | 28 |
| [`ISO_27001`](/de/frameworks/iso-27001) | 28 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`ISO_27001`](/de/frameworks/iso-27001), `NIST_CSF`, [`SAMA_CSF`](/de/frameworks/sama-csf-v1), [`NCA_CCC_CSP`](/de/frameworks/nca-ccc-2-2024-csp), [`NCA_CCC_CST`](/de/frameworks/nca-ccc-2-2024-cst).

## Demo-Variante

| Merkmal | Wert |
|---|---|
| Framework-ID | `NCA_ECC_DEMO` |
| Ordner | `nca-ecc-demo` |
| Kontrollen | 20 (Governance 5, Defense 12, Resilience 1, Third-Party and Cloud 2) |
| Assessment-Scope | `app` |
| Kontroll-IDs | `NCA_ECC_DEMO.GOV_01` und ähnlich |

Die Demo-Variante ist eine Teilmenge für Live-Präsentationen und erste Läufe. Bei der Auswahl wurden Kontrollen mit automatisierter Signal-Evidenz und Kontrollen mit Querverweisen auf die anderen Demo-Frameworks (`GDPR_DEMO`, `BSI_GRUNDSCHUTZ_2023_DEMO`, `NIST_SP_800_66R2_DEMO`, `AI_10_PILLARS_DEMO`) bevorzugt. Sie wird von `swao init` nicht automatisch angelegt; kopieren Sie sie wie jedes andere Framework in den Workspace. Für Kundenergebnisse verwenden Sie das vollständige `NCA_ECC`.

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `nca-ecc-2-2024` in den Workspace nach `wsp/inputs/catalogs/community/nca-ecc-2-2024/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes NCA_ECC`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [NCA_ECC]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nca-ecc-2-2024>
- Demo-Variante `NCA_ECC_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/nca-ecc-demo>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `nca-ecc-2-2024` in Ihren Workspace nach `wsp/inputs/catalogs/community/nca-ecc-2-2024/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info NCA_ECC` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Eine Kontrolle je Subdomäne ist eine Vereinfachung. Der offizielle ECC-Text enthält je Subdomäne mehrere nummerierte Anforderungen; ziehen Sie ihn für die Prüfungsvorbereitung heran.
- Für die Auslegung ist die arabische Fassung maßgeblich.
