# HIPAA Security Rule mit Umsetzungsleitfaden NIST SP 800-66 Revision 2 (NIST_SP_800_66R2)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `NIST_SP_800_66R2` |
| Herausgeber | U.S. Department of Health and Human Services (45 CFR Part 164 Subpart C, Security Rule); Umsetzungsleitfaden von NIST (SP 800-66 Revision 2, Februar 2024) |
| Version | NIST SP 800-66r2 / 2024-02 |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `0.1.0` |
| Anzahl Kontrollen | 49 |
| Bewertungsmodus | `binary` (deklariert). Der Katalog bildet zusätzlich die HIPAA-eigene Bewertung auf SWAO-Ergebnisse ab, siehe unten. |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | `HIPAA` |
| Lizenz und Weitergabe | NIST SP 800-66r2 ist ein Werk der US-Regierung und in den USA nicht urheberrechtlich geschützt (17 USC 105); die Security Rule ist Bundesrecht. Titel sind wörtlich übernommen, Beschreibungen sinngemäß. |
| Zuletzt geprüft | 2026-05-23 |

## Worum es geht

Die HIPAA Security Rule (45 CFR Part 164 Subpart C) ist US-Bundesrecht auf Grundlage des Health Insurance Portability and Accountability Act. Sie verpflichtet Covered Entities (Krankenversicherer, Clearingstellen und die meisten Leistungserbringer im Gesundheitswesen) und deren Business Associates, elektronische geschützte Gesundheitsinformationen (ePHI) durch administrative, physische und technische Schutzmaßnahmen zu sichern. NIST SP 800-66 Revision 2 (Februar 2024) ist der Umsetzungsleitfaden von NIST zu dieser Regel; er ist eine Empfehlung, keine Rechtsnorm.

Die Regel gliedert sich in Abschnitte, Standards und Implementation Specifications. Diese sind entweder Required (R) oder Addressable (A): Eine Addressable-Spezifikation kann durch eine gleichwertige Alternativmaßnahme erfüllt werden, wenn die Einrichtung dies begründet dokumentiert. SWAO bildet jede Implementation Specification als eine Kontrolle ab und gruppiert die Kontrollen nach den fünf Abschnitten 164.308, 164.310, 164.312, 164.314 und 164.316. Dieses Framework ersetzt den früheren HIPAA-Platzhalter mit drei Kontrollen (`replaces: HIPAA`).

## Wer es in SWAO nutzen sollte und wann

Setzen Sie NIST_SP_800_66R2 für jeden Workload ein, der ePHI für den US-Markt speichert, verarbeitet oder überträgt: elektronische Patientenakten, Gesundheitsdatenanalyse, Telemedizin, Abrechnungsverarbeitung und die Cloud-Plattformen, auf denen diese laufen. Es gilt für Covered Entities und für Business Associates wie SaaS- und Hosting-Anbieter. Es lässt sich gut mit [SOC_2](/de/frameworks/soc-2) für US-amerikanische B2B-Kunden und mit [GDPR](/de/frameworks/gdpr) kombinieren, wenn dieselbe Gesundheitsplattform auch die EU bedient.

Das Framework deklariert eine Souveränitätsanforderung (`require_certifications: [HIPAA]`), die das Landing-Zone-Assessment beim Vergleich von Zielplattformen nutzen kann.

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

Der Katalog bildet die HIPAA-eigene Bewertung auf SWAO-Ergebnisse ab (`rating_scale` in `framework-meta.yaml`):

| HIPAA-Status | SWAO-Ergebnis | Mindest-Schweregrad |
|---|---|---|
| Vollständig umgesetzt (R) / umgesetzt oder Alternativmaßnahme (A) | `SATISFIED` | |
| Teilweise umgesetzt | `PARTIAL` | |
| Nicht umgesetzt, keine Alternativmaßnahme dokumentiert (A) | `GAP` | high |
| Nicht umgesetzt (R) | `GAP` | critical |
| Nicht anwendbar | `N_A` | |

Bei den technischen Schutzmaßnahmen hilft Evidenz aus Code und Konfiguration am meisten: 7 der 9 technischen Kontrollen deklarieren eine Signalfamilie, eine weitere (`HIPAA-TEC-03`) einen lokalen regulären Ausdruck. Administrative, physische und Dokumentations-Kontrollen stützen sich auf Dokumente. Zehn Kontrollen deklarieren einen manuellen Fragebogen, etwa `HIPAA-ADM-07` Workforce Clearance Procedure; der Framework-Ordner enthält unter `evidence/` acht Evidenzvorlagen (vier Markdown-Vorlagen und vier Fragebögen). 16 Kontrollen deklarieren automatisierte Evidenz:

| Kontrolle | Titel | Deklarierte Evidenzbasis |
|---|---|---|
| `HIPAA-ADM-04` | Information System Activity Review (Required), 164.308(a)(1)(ii)(D) | `OBS` |
| `HIPAA-ADM-10` | Access Authorisation (Addressable), 164.308(a)(4)(ii)(B) | `IAM` |
| `HIPAA-ADM-11` | Access Establishment and Modification (Addressable), 164.308(a)(4)(ii)(C) | `IAM` |
| `HIPAA-ADM-14` | Log-in Monitoring (Addressable), 164.308(a)(5)(ii)(C) | `OBS` |
| `HIPAA-ADM-15` | Password Management (Addressable), 164.308(a)(5)(ii)(D) | `IAM` |
| `HIPAA-ADM-17` | Data Backup Plan (Required), 164.308(a)(7)(ii)(A) | `DR` |
| `HIPAA-ADM-18` | Disaster Recovery Plan (Required), 164.308(a)(7)(ii)(B) | `DR` |
| `HIPAA-PHY-10` | Data Backup and Storage (Addressable), 164.310(d)(2)(iv) | `DR` |
| `HIPAA-TEC-01` | Unique User Identification (Required), 164.312(a)(2)(i) | `IAM` |
| `HIPAA-TEC-03` | Automatic Logoff (Addressable), 164.312(a)(2)(iii) | local_signal_regex |
| `HIPAA-TEC-04` | Encryption and Decryption at Rest (Addressable), 164.312(a)(2)(iv) | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `HIPAA-TEC-05` | Audit Controls (Required), 164.312(b) | `OBS` |
| `HIPAA-TEC-06` | Integrity Mechanism for ePHI (Addressable), 164.312(c)(2) | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `HIPAA-TEC-07` | Person or Entity Authentication (Required), 164.312(d) | `IAM` |
| `HIPAA-TEC-08` | Integrity Controls in Transit (Addressable), 164.312(e)(2)(i) | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |
| `HIPAA-TEC-09` | Encryption in Transit (Addressable), 164.312(e)(2)(ii) | `CRYPTO` ([Pass 08](/de/passes/08-crypto)) |

Hinweis: Dieser Katalog deklariert die Signalfamilien `DR`, `IAM`, `OBS`. Kein Pass der aktuellen Version erzeugt Signale mit diesen Präfixen. Die betroffenen Kontrollen werden daher in der Praxis anhand verwandter Signale (etwa Terraform-, Egress- oder Kryptografie-Befunde) und anhand von Kontextdokumenten bewertet.

## Aufbau der Kontrollen

Jede Kontrolle ist auf den Achsen `section`, `family`, `requirement` und `applies-to` getaggt. Nach `requirement`-Tag sind 22 Kontrollen Required, 22 Addressable und 5 Kontrollen auf Standard-Ebene ohne eigene Implementation Specification (`HIPAA-ADM-05`, `HIPAA-ADM-22`, `HIPAA-PHY-05`, `HIPAA-PHY-06`, `HIPAA-PND-01`).

| Domäne / Säule | Kontrollen | Deklarierte automatisierte Evidenz | Beispielkontrollen |
|---|---|---|---|
| Administrative Safeguards | 23 | 7 | `HIPAA-ADM-01` Risk Analysis (Required), 164.308(a)(1)(ii)(A); `HIPAA-ADM-02` Risk Management (Required), 164.308(a)(1)(ii)(B) |
| Physical Safeguards | 10 | 1 | `HIPAA-PHY-01` Contingency Operations (Addressable), 164.310(a)(2)(i); `HIPAA-PHY-02` Facility Security Plan (Addressable), 164.310(a)(2)(ii) |
| Technical Safeguards | 9 | 8 | `HIPAA-TEC-01` Unique User Identification (Required), 164.312(a)(2)(i); `HIPAA-TEC-02` Emergency Access Procedure (Required), 164.312(a)(2)(ii) |
| Organisational Requirements | 3 | 0 | `HIPAA-ORG-01` Business Associate Contracts (Required), 164.314(a)(2)(i); `HIPAA-ORG-02` Other Arrangements (Required), 164.314(a)(2)(ii) |
| Policies and Procedures and Documentation | 4 | 0 | `HIPAA-PND-01` Policies and Procedures: 164.316(a); `HIPAA-PND-02` Documentation Time Limit (Required), 164.316(b)(2)(i) |
| **Summe** | **49** | **16** |  |

## Querverweise auf andere Frameworks

Mappings je Kontrolle in `controls.yaml` (`maps_to`), gezählt nach Ziel-Framework:

| Ziel-Framework | Kontrollen mit mindestens einem `maps_to`-Verweis |
|---|---|
| [`ISO_27001`](/de/frameworks/iso-27001) | 43 |
| [`SOC_2`](/de/frameworks/soc-2) | 29 |

Deklarierte Querverweis-Hinweise in `framework-meta.yaml` (auf Framework-Ebene, nicht je Kontrolle): [`ISO_27001`](/de/frameworks/iso-27001), [`SOC_2`](/de/frameworks/soc-2), [`COBIT_5`](/de/frameworks/cobit-5), [`GDPR`](/de/frameworks/gdpr), [`DORA`](/de/frameworks/dora), `NIST_CSF_2`, `NIST_800_53R5`, `HITRUST_CSF`, [`PCI_DSS`](/de/frameworks/pci-dss), `ISO_27799`.

## Demo-Variante

Es gibt zwei Teilmengen in Demo-Größe. Beide enthalten dieselben 12 Kontrollen mit denselben IDs (`HIPAA_DEMO.ADM_01` und ähnlich): sechs administrative und fünf technische Schutzmaßnahmen sowie eine organisatorische Anforderung, ausgewählt für Querbezüge zu `GDPR_DEMO`, `AI_10_PILLARS_DEMO` und `BSI_GRUNDSCHUTZ_2023_DEMO`.

| Framework-ID | Ordner | Kontrollen | Hinweise |
|---|---|---|---|
| `NIST_SP_800_66R2_DEMO` | `nist-sp-800-66r2-demo` | 12 | Wird von `swao init` in jeden neuen Workspace übernommen und von `swao framework list` angezeigt. |
| `NIST_HIPAA_DEMO` | `nist-hipaa-demo` | 12 | Gleicher Inhalt unter anderer ID; die `framework-meta.yaml` setzt `listed: false`, daher zeigt `swao framework list` es nicht an, und es wird nicht automatisch angelegt. |

Aktivieren Sie in einer Anwendung nur eine der beiden Varianten, da sie dieselben Kontrollen bewerten. Für Kundenergebnisse verwenden Sie das vollständige `NIST_SP_800_66R2`.

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `nist-sp-800-66r2-hipaa` in den Workspace nach `wsp/inputs/catalogs/community/nist-sp-800-66r2-hipaa/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes NIST_SP_800_66R2`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [NIST_SP_800_66R2]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nist-sp-800-66r2-hipaa>
- Demo-Variante `NIST_SP_800_66R2_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/nist-sp-800-66r2-demo>
- Demo-Variante `NIST_HIPAA_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/nist-hipaa-demo>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `nist-sp-800-66r2-hipaa` in Ihren Workspace nach `wsp/inputs/catalogs/community/nist-sp-800-66r2-hipaa/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info NIST_SP_800_66R2` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- `HIPAA-TEC-03` Automatic Logoff deklariert einen lokalen regulären Ausdruck über Quell- und Konfigurationsdateien (Session- oder Idle-Timeout-Einstellungen). Der Compliance-Pass führt diesen Ausdruck nicht selbst aus; die Kontrolle wird wie alle anderen anhand der Signale des Laufs bewertet.
- Business Associate Agreements, Sanktionen gegenüber Beschäftigten und Kontrollen der Einrichtungen erfordern Dokumente des Kunden.
- Über die Einhaltung der HIPAA entscheidet die Covered Entity und im Vollzug das Office for Civil Rights des HHS; SWAO-Ergebnisse dienen der Vorbereitung.
