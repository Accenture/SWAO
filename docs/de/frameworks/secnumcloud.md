# SecNumCloud v3.2, ANSSI-Qualifizierung für souveräne Clouds (SECNUMCLOUD)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `SECNUMCLOUD` |
| Herausgeber | ANSSI, Agence nationale de la sécurité des systèmes d'information (Frankreich) |
| Version | 3.2 |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 59 |
| Bewertungsmodus | `binary` (in framework-meta.yaml deklariert) |
| Assessment-Scope (framework-meta) | `lz`, `aud` |
| Signal-Präfix | `SECNUM` |
| Lizenz und Weitergabe | Von der ANSSI veröffentlicht; die englische Übersetzung v3.2.a stellt ITIF bereit. Die Beschreibungen geben die Anforderungen sinngemäß wieder und sind keine Rechtsberatung. |
| Zuletzt geprüft | 2026-09-22 |

**Bekanntes Problem:** In dieser Version besteht der SECNUMCLOUD-Katalog die Schemavalidierung von SWAO nicht und wird vom Compliance-Pass nicht geladen. Siehe Grenzen und Hinweise.

## Worum es geht

SecNumCloud ist das Qualifizierungsverfahren der ANSSI, der französischen nationalen Cybersicherheitsbehörde, für Cloud-Anbieter, die sensible Daten verarbeiten. Ein Anbieter erhält die Qualifizierung nach einem Audit durch eine akkreditierte Prüfstelle; die ANSSI veröffentlicht die Liste der qualifizierten Anbieter. Über klassische Sicherheitskontrollen hinaus verlangt SecNumCloud Immunität gegenüber extraterritorialem Recht, Betrieb und Support aus der EU, Reversibilität und Transparenz. Damit ist es ein Bezugspunkt für Anforderungen an souveräne Clouds in Europa.

Der SWAO-Katalog gliedert 59 Kontrollen in 19 Kapitel, von Governance und Personal bis zu Datensouveränität, Transparenz und Umweltmanagement.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie SECNUMCLOUD in [Landing-Zone-Assessments](/de/assessment/landing-zone) ein, wenn die Zielplattform französische oder europäische Erwartungen an eine souveräne Cloud erfüllen muss: Workloads der französischen öffentlichen Verwaltung, Daten der Stufe Diffusion Restreinte oder vergleichbar sowie EU-regulierte Workloads, die Schutz vor extraterritorialem Zugriff erfordern. Hilfreich ist es auch beim Vergleich eines Anbieterangebots mit den Erwartungen an [EUCS](/de/frameworks/eucs) auf hohem Vertrauensniveau oder mit [BSI_C5](/de/frameworks/bsi-c5).

Der Katalog bewertet Anbieter und Plattform, nicht Anwendungscode: 18 Kontrollen haben den Scope `lz`, 32 `aud` und 9 beide.

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

Die meisten Kontrollen stützen sich auf Dokumente: Compliance-Dokumentation (24 Kontrollen), Lösungsarchitektur (17) und Betriebs-Runbooks (12). Sieben Kontrollen nennen statt einer Signalfamilie ein bestimmtes Signal als Evidenz:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `SECNUM_IAM_01` | Privileged access management and least-privilege | Signal `IAM_PRIVILEGED_ACCESS`, Kontext `solution_arch` |
| `SECNUM_IAM_02` | Multi-factor authentication for privileged and remote access | Signal `IAM_MFA_ENABLED` |
| `SECNUM_CRY_01` | Encryption at rest for customer data | Signal `ENCRYPT_AT_REST` |
| `SECNUM_CRY_02` | Encryption in transit using approved protocols | Signal `ENCRYPT_IN_TRANSIT` |
| `SECNUM_VUL_01` | Vulnerability scanning and management process | Signal `VULN_SCAN_ENABLED`, Kontext `ops_runbooks` |
| `SECNUM_LOG_01` | Security event logging coverage | Signal `STATE_LOG_ENABLED` |
| `SECNUM_LOG_03` | Log retention period | Signal `STATE_LOG_RETENTION_DAYS` |

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| Chapter 1: Governance and Risk Management | 3 | 0 | `SECNUM_GOV_01` Information security governance structure; `SECNUM_GOV_02` Risk assessment and treatment process |
| Chapter 2: Human Resources Security | 3 | 0 | `SECNUM_HRS_01` Background screening for security-sensitive roles; `SECNUM_HRS_02` Security awareness and training programme |
| Chapter 3: Physical and Environmental Security | 3 | 0 | `SECNUM_PHY_01` Secure perimeter and access control for data centres; `SECNUM_PHY_02` Environmental controls for infrastructure protection |
| Chapter 4: Asset Management and Lifecycle | 3 | 0 | `SECNUM_AST_01` Hardware asset inventory and lifecycle management; `SECNUM_AST_02` Secure disposal of storage media |
| Chapter 5: Access Control and Authentication | 4 | 2 | `SECNUM_IAM_01` Privileged access management and least-privilege; `SECNUM_IAM_02` Multi-factor authentication for privileged and remote access |
| Chapter 6: Cryptography | 3 | 2 | `SECNUM_CRY_01` Encryption at rest for customer data; `SECNUM_CRY_02` Encryption in transit using approved protocols |
| Chapter 7: Network Security and Filtering | 4 | 0 | `SECNUM_NET_01` Network segmentation and tenant isolation; `SECNUM_NET_02` Firewall and network filtering controls |
| Chapter 8: Secure Development | 3 | 0 | `SECNUM_DEV_01` Secure software development lifecycle (SSDLC); `SECNUM_DEV_02` Code review and security testing |
| Chapter 9: Patch Management and Vulnerability Management | 3 | 1 | `SECNUM_VUL_01` Vulnerability scanning and management process; `SECNUM_VUL_02` Patch management and deployment cadence |
| Chapter 10: Incident Management | 3 | 0 | `SECNUM_INC_01` Security incident response process; `SECNUM_INC_02` Security incident notification to customers |
| Chapter 11: Business Continuity | 3 | 0 | `SECNUM_BCM_01` Business continuity and disaster recovery plan; `SECNUM_BCM_02` Geographic redundancy and data replication |
| Chapter 12: Compliance and Legal Requirements | 2 | 0 | `SECNUM_CPL_01` French and EU legal framework compliance; `SECNUM_CPL_02` Intellectual property and licence compliance |
| Chapter 13: Audit and Logging | 4 | 2 | `SECNUM_LOG_01` Security event logging coverage; `SECNUM_LOG_02` Log integrity and tamper protection |
| Chapter 14: Cloud Configuration Management | 3 | 0 | `SECNUM_CFG_01` Hardened configuration baselines; `SECNUM_CFG_02` Change management for infrastructure components |
| Chapter 15: Supply Chain and Third-Party Management | 3 | 0 | `SECNUM_SCM_01` Third-party supplier security assessment; `SECNUM_SCM_02` EU-based subprocessor requirement |
| Chapter 16: Reversibility and Portability | 3 | 0 | `SECNUM_REV_01` Customer data export capability; `SECNUM_REV_02` Service termination and data deletion |
| Chapter 17: Data Sovereignty and Extraterritoriality | 3 | 0 | `SECNUM_SOV_01` No extraterritorial law exposure for customer data; `SECNUM_SOV_02` EU-based support staff access restrictions |
| Chapter 18: Transparency and Certification | 3 | 0 | `SECNUM_TRS_01` SecNumCloud qualification maintenance; `SECNUM_TRS_02` Security transparency report |
| Chapter 19: Environmental and Energy Management | 3 | 0 | `SECNUM_ENV_01` Power usage effectiveness (PUE) target; `SECNUM_ENV_02` Renewable energy sourcing |
| **Summe** | **59** | **7** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 38 |
| [`NIS2`](/de/frameworks/nis2) | 13 |
| [`GDPR`](/de/frameworks/gdpr) | 8 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`EUCS`](/de/frameworks/eucs), [`BSI_C5`](/de/frameworks/bsi-c5), [`ISO_27001`](/de/frameworks/iso-27001), [`GDPR`](/de/frameworks/gdpr), [`NIS2`](/de/frameworks/nis2).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `secnumcloud` in den Workspace nach `wsp/inputs/catalogs/community/secnumcloud/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. Dieses Framework deklariert `assessment_type_scope: [lz, aud]`. Die TUI-Auswahl für [Anwendungs-Assessments](/de/assessment/application) zeigt es daher nicht an; es ist für das [Landing-Zone-Assessment](/de/assessment/landing-zone) gedacht, dessen Auswahl alle installierten Frameworks zeigt. Beachten Sie das unter Grenzen und Hinweise beschriebene Schemaproblem: In dieser Version wird der Katalog nicht geladen.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes SECNUMCLOUD`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [SECNUMCLOUD]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/secnumcloud>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `secnumcloud` in Ihren Workspace nach `wsp/inputs/catalogs/community/secnumcloud/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info SECNUMCLOUD` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Bekanntes Problem in dieser Version: Die sieben `signal:`-Einträge entsprechen keinem der Evidenztypen, die das Katalogschema von SWAO akzeptiert; der Katalog besteht daher die Validierung beim Laden nicht. Der Compliance-Pass meldet dann, dass für `SECNUMCLOUD` kein Katalog gefunden wurde. Prüfen Sie das Ergebnis von `swao health-check` und die `COMP`-Signale Ihres Laufs, bevor Sie sich auf dieses Framework stützen. Kein Pass der aktuellen Version erzeugt die in diesen Einträgen genannten Signal-IDs.
- Die SecNumCloud-Qualifizierung erteilt die ANSSI nach einem Audit durch eine akkreditierte Stelle. SWAO kann einen Anbieter weder qualifizieren noch vorqualifizieren.
