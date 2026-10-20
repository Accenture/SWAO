# NIS-2-Richtlinie, Netz- und Informationssicherheit (NIS2)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `NIS2` |
| Herausgeber | Europäische Union (Richtlinie (EU) 2022/2555) |
| Version | 2022-12-27 (Veröffentlichung im Amtsblatt) |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `1.0.0` |
| Anzahl Kontrollen | 46 |
| Bewertungsmodus | `binary` (in framework-meta.yaml deklariert) |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `NIS2` |
| Lizenz und Weitergabe | EU-Rechtsakt, nachnutzbar nach den EUR-Lex-Bedingungen. Die Beschreibungen geben die Richtlinie sinngemäß wieder; nationale Umsetzungsgesetze weichen voneinander ab. |
| Zuletzt geprüft | 2026-09-21 |

## Worum es geht

NIS2 ist die Richtlinie (EU) 2022/2555 über Maßnahmen für ein hohes gemeinsames Cybersicherheitsniveau in der Union. Sie hat die erste NIS-Richtlinie abgelöst, war von den Mitgliedstaaten bis zum 17. Oktober 2024 umzusetzen und wirkt über nationales Recht (etwa das im Katalog referenzierte deutsche NIS-2-Umsetzungsgesetz). Sie erfasst mittlere und große wesentliche Einrichtungen (EE) und wichtige Einrichtungen (IE) in 18 Sektoren, darunter Energie, Verkehr, Bankwesen, Finanzmarktinfrastruktur, Gesundheit, Trink- und Abwasser, digitale Infrastruktur, verwaltete IKT-Dienste, öffentliche Verwaltung und Weltraum.

Die Kernpflichten stehen in Artikel 20 (Verantwortung und Schulung der Leitungsorgane), Artikel 21 (zehn Mindestmaßnahmen des Cybersicherheits-Risikomanagements, Art. 21 Abs. 2 Buchst. a bis j) und Artikel 23 (Meldepflichten: Frühwarnung binnen 24 Stunden, Meldung binnen 72 Stunden, Abschlussbericht binnen eines Monats). Der SWAO-Katalog bildet dies als 46 Kontrollen in 10 Domänen ab.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie NIS2 für Anwendungen und Plattformen von Organisationen ein, die wesentliche oder wichtige Einrichtungen sind oder werden könnten: Versorger, Krankenhäuser, Banken, Verkehrsbetreiber, Cloud- und Rechenzentrumsanbieter, Managed Service Provider, DNS-Anbieter und öffentliche Verwaltung. NIS2 ist die Standard-Basis der EU für souveräne Cloud-Migrationsprogramme und lässt sich gut mit [ISO_27001](/de/frameworks/iso-27001) (gemeinsames Kontrollvokabular), [DORA](/de/frameworks/dora) für Finanzunternehmen, [KRITIS_DE](/de/frameworks/kritis-de) für deutsche KRITIS-Betreiber und [BSI_GRUNDSCHUTZ_2023](/de/frameworks/bsi-grundschutz-2023) bei Anwendung der BSI-Methodik kombinieren.

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

Der Katalog trennt technische Maßnahmen, die durch Code- und Infrastruktur-Evidenz gestützt werden können, von Governance-Pflichten, die Dokumente erfordern. 12 Kontrollen deklarieren `assessment_type_scope: [aud]` (nur Audit-Evidenz): `NIS2_GOV_1` bis `NIS2_GOV_4`, `NIS2_RSK_6`, `NIS2_INC_3` bis `NIS2_INC_5` (die Meldefristen), `NIS2_BCM_3`, `NIS2_SCM_3`, `NIS2_NSC_4` und `NIS2_HRS_2`. Die meisten übrigen Kontrollen nennen Betriebs-Runbooks (25 Kontrollen) oder die Lösungsarchitektur (13 Kontrollen) als Kontext. 14 Kontrollen deklarieren eine Signalfamilie:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `NIS2_INC_1` | Incident detection and classification process | `OBS`, Kontext `ops_runbooks` |
| `NIS2_SCM_4` | Software supply chain security and SBOM | `SBOM` ([Pass 05](/de/passes/05-sbom)) |
| `NIS2_NSC_1` | Network security management and segmentation | `EGR` ([Pass 07](/de/passes/07-egr)), `TF` ([Pass 06](/de/passes/06-tf)) |
| `NIS2_NSC_2` | Endpoint security and patch management | `TF` ([Pass 06](/de/passes/06-tf)) |
| `NIS2_NSC_3` | Security monitoring and anomaly detection | `OBS` |
| `NIS2_NSC_5` | Security configuration management and hardening | `TF` ([Pass 06](/de/passes/06-tf)) |
| `NIS2_CRY_2` | Encryption of data at rest and in transit | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NIS2_CRY_3` | Cryptographic key management | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `NIS2_HRS_3` | Access control based on least privilege | `IAM` |
| `NIS2_HRS_4` | Privileged access management | `IAM` |
| `NIS2_HRS_5` | Identity lifecycle and offboarding procedures | `IAM` |
| `NIS2_MFA_1` | MFA for critical systems and remote access | `IAM` |
| `NIS2_VHR_1` | Vulnerability identification and risk-based assessment | `TF` ([Pass 06](/de/passes/06-tf)) |
| `NIS2_VHR_2` | Patch and vulnerability remediation timescales | `TF` ([Pass 06](/de/passes/06-tf)), Kontext `ops_runbooks` |

Hinweis: Dieser Katalog deklariert die Signalfamilien `IAM`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| NIS2-GOV: Governance and Management Body Accountability | 4 | 0 | `NIS2_GOV_1` Management body oversight and accountability for cybersecurity; `NIS2_GOV_2` Management body cybersecurity training |
| NIS2-RSK: Risk Analysis and Security Policies | 6 | 0 | `NIS2_RSK_1` Cybersecurity risk management framework; `NIS2_RSK_2` Cybersecurity risk assessment |
| NIS2-INC: Incident Handling | 6 | 1 | `NIS2_INC_1` Incident detection and classification process; `NIS2_INC_2` Significant incident determination criteria |
| NIS2-BCM: Business Continuity | 5 | 0 | `NIS2_BCM_1` Business continuity plan for network and information systems; `NIS2_BCM_2` Disaster recovery planning and geographic redundancy |
| NIS2-SCM: Supply Chain Security | 5 | 1 | `NIS2_SCM_1` Supply chain security policy; `NIS2_SCM_2` Supplier security assessment and due diligence |
| NIS2-NSC: Network and Information System Security | 5 | 4 | `NIS2_NSC_1` Network security management and segmentation; `NIS2_NSC_2` Endpoint security and patch management |
| NIS2-CRY: Cryptography and Encryption | 3 | 2 | `NIS2_CRY_1` Encryption policy and approved cryptographic algorithms; `NIS2_CRY_2` Encryption of data at rest and in transit |
| NIS2-HRS: Human Resources Security and Access Control | 5 | 3 | `NIS2_HRS_1` Cybersecurity awareness training for management and staff; `NIS2_HRS_2` Personnel security screening |
| NIS2-MFA: Multi-factor Authentication and Secure Communications | 3 | 1 | `NIS2_MFA_1` MFA for critical systems and remote access; `NIS2_MFA_2` Secured voice, video, and text communications |
| NIS2-VHR: Vulnerability Management | 4 | 2 | `NIS2_VHR_1` Vulnerability identification and risk-based assessment; `NIS2_VHR_2` Patch and vulnerability remediation timescales |
| **Summe** | **46** | **14** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 42 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`ISO_27001`](/de/frameworks/iso-27001), [`DORA`](/de/frameworks/dora), [`GDPR`](/de/frameworks/gdpr), [`EU_CRA`](/de/frameworks/eu-cra), [`KRITIS_DE`](/de/frameworks/kritis-de), [`BSI_GRUNDSCHUTZ_2023`](/de/frameworks/bsi-grundschutz-2023), [`EUCS`](/de/frameworks/eucs).

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `nis2` in den Workspace nach `wsp/inputs/catalogs/community/nis2/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes NIS2`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [NIS2]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nis2>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `nis2` in Ihren Workspace nach `wsp/inputs/catalogs/community/nis2/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info NIS2` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Die Pflichten unterscheiden sich je nach nationaler Umsetzung und Einrichtungsklasse (EE oder IE). Klären Sie das anwendbare nationale Recht und die Einstufung der Einrichtung mit Rechtsberatern.
- Die Meldefristen von 24 Stunden, 72 Stunden und einem Monat sind Prozesspflichten; SWAO kann prüfen, ob Verfahren dokumentiert sind, nicht, ob sie in der Praxis eingehalten werden.
