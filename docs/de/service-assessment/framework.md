# Referenz zum Rahmenwerk SWAO_APM

SWAO_APM (SWAO Application Portfolio Management, Version 2026.10, Status freigegeben) ist das Community-Rahmenwerk hinter der Service-Portfolio-Bewertung. Es bewertet jede Anwendung in elf Domänen, verdichtet die Domänenwerte zu einem Risikowert und leitet daraus eine TIME-Empfehlung ab. Es ist eine SWAO-eigene Synthese aus dem Gartner-TIME-Modell, ISO/IEC 25010:2023, TOGAF 10, ENISA-Empfehlungen und EU-Kriterien für souveräne Clouds; Kontrolltexte Dritter werden nicht wiedergegeben. Die allgemeine Rahmenwerksseite ist [SWAO_APM](/de/frameworks/swao-apm).

## Die elf Domänen und ihre Gewichte

| Domäne | Name | Standardgewicht | Leitfrage |
|---|---|---|---|
| `APM-TCH` | Technischer Zustand | 20 | Ist die Plattform im Support, gepatcht, frei von kritischen und aktiv ausgenutzten Schwachstellen? |
| `APM-SEC` | Sicherheitslage | 18 | Schwache Kryptografie, unverschlüsselte Endpunkte, fest kodierte Geheimnisse, abgelaufene Signaturzertifikate, nationale Warnmeldungen, Malware-Befunde |
| `APM-VND` | Herstellerzustand | 12 | Ist der Hersteller bekannt, unterstützt er das Produkt, besteht ein Vertrag, ist er erreichbar? |
| `APM-DAT` | Daten-Governance | 10 | Sind Klassifizierung, Speicherort, Unterauftragsverarbeiter und sensible Daten erfasst? |
| `APM-REG` | Compliance-Pflichten | 8 | Regulatorische Last, DSGVO Art. 9, MDR-Klassifizierung, Aktualität des Audits |
| `APM-SOV` | Souveränitätsreife | 8 | Souveränitätseinstufung, verfügbare souveräne Alternative, Datenspeicherung in der EU |
| `APM-MIG` | Migrationsbereitschaft | 6 | Migrationskandidat, portables Betriebssystem, cloudfähiges Bereitstellungsmodell |
| `APM-INT` | Integrationskomplexität | 6 | Wie viele Integrationen gibt es, und sind sie dokumentiert? |
| `APM-HW` | Hardware und Kosten | 4 | Ist das Hardwareprofil bekannt, passend dimensioniert und bewertet? |
| `APM-BIZ` | Geschäftskritikalität | 4 | Kritikalität, Nutzerbasis, Betriebsstatus, verantwortlicher Fachbereich |
| `APM-STR` | Strategische Passung | 4 | Einordnung durch die Analyse und erklärte Migrationsabsicht |

Die Gewichte ergeben zusammen 100. Sie folgen der Reihenfolge der Leitplanke G-07 aus Design 103 (technischer Zustand, Sicherheit, Hersteller, Daten, Regulierung zuerst).

## Wie die Werte berechnet werden

1. **Kontrollwert (0 bis 100, Gesundheitsskala).** 47 der 72 Kontrollen sind über `evidence_basis: [{ apm_export: <rule> }]` an eine Bewertungsregel gebunden. Eine Regel liest Nachweise, die der Service-Ablauf bereits erzeugt hat, und liefert 100 (gesund) bis 0 (hohe Bedenken). Beispiel: `os_eol_horizon` liefert 0, wenn das Supportende überschritten ist, 20 unter 12 Monaten, 40 unter 18, 70 unter 36, sonst 100.
2. **Unbekannt ist kein Fehler.** Fehlt der Nachweis (zum Beispiel weil noch nicht recherchiert wurde), liefert die Regel keinen Wert. Die Kontrolle wird als unbekannt geführt und fließt nicht in den Domänenwert ein; sie zählt nie als bestanden oder nicht bestanden. Zwei Regeln sind bewusst streng: `bsi_advisories` bewertet nur einen abgeschlossenen Abgleich mit dem Feed von BSI CERT-Bund (eine Anzahl von Warnmeldungen), und `integration_count` liest eine leere Integrationsliste nur dann als "keine Integrationen", wenn die Intake-Datei eine Integrationsspalte hatte (aufgeführt in `intake.fields` der App); andernfalls bleiben beide Kontrollen unbekannt.
3. **Domänenwert.** Der gewichtete Mittelwert der bekannten Kontrollwerte der Domäne (Kontrollgewicht aus einem optionalen Tag `apm-weight.N`, Standard 1). Eine Domäne ohne bekannte Kontrolle hat keinen Wert.
4. **Gesundheitswert.** Der gewichtete Mittelwert der verfügbaren Domänenwerte mit `domain_weights`.
5. **Risikowert.** `100 - Gesundheitswert`, also ist 100 das höchste Risiko. Der Portfolio-Risikowert ist der Mittelwert über alle Apps, die einen Wert haben und deren TIME-Label auf ausreichenden Nachweisen beruht (siehe [Nachweisgrundlage des TIME-Labels](#nachweisgrundlage-des-time-labels)).

Die übrigen 25 Kontrollen beschreiben Nachweise, die eine Analystin oder ein Analyst liefert (zum Beispiel Zertifizierungen, Penetrationstests, Auftragsverarbeitungsverträge). Sie gehören zur Vollständigkeit zum Rahmenwerk und erscheinen in den Compliance-Ergebnissen, beeinflussen aber die automatische Bewertung nicht.

## Woher die Nachweise stammen (Signalquellen)

| Domäne | Von den Regeln genutzte Nachweise |
|---|---|
| `APM-TCH` | [Pass 24 RESEARCH](/de/passes/24-research): endoflife.date, CVE-Anzahl und Patch-Status aus der NVD, CISA KEV; Betriebssystem aus dem Intake; Alter der Laufzeitumgebung aus [Pass 25 BINARY](/de/passes/25-binary) |
| `APM-SEC` | Befunde aus [Pass 08 CRYPTO](/de/passes/08-crypto) auf Binärdateien und Konfiguration (schwache Algorithmen, unverschlüsselte Endpunkte, fest kodierte Geheimnisse, abgelaufene Zertifikate); Warnmeldungen von BSI CERT-Bund und VirusTotal aus Pass 24 |
| `APM-VND` | Herstellerfelder aus dem Intake: Name, Version, Supportstatus, Vertragsende, Kennzeichen für einen Support-Kontakt |
| `APM-DAT` | Datenfelder aus dem Intake; [Pass 03 DATA](/de/passes/03-data) im Service-Modus |
| `APM-SOV` | INFRA-CAT-Klassifizierung (Souveränitätseinstufung und Alternativen); Datenspeicherort |
| `APM-BIZ` | Geschäftsfelder und Betriebsstatus aus dem Intake |
| `APM-HW` | Hardware aus dem Intake; Cloud-Kostenschätzung |
| `APM-INT` | Integrationen und Integrationsnotizen aus dem Intake |
| `APM-MIG` | Einordnung aus dem Intake; Portabilität des Betriebssystems; Bereitstellungsmodell (`vendor_type`) |
| `APM-REG` | Regulatorische Pflichten, DSGVO Art. 9, MDR-Klasse und Datum des letzten Audits aus dem Intake |
| `APM-STR` | TIME der Analyse und Migrationskandidat aus dem Intake |

## TIME-Einordnung

Die TIME-Empfehlung wird in zwei Stufen abgeleitet. Die erste zutreffende Regel gewinnt.

1. **Übersteuerungen**
   - Betriebsstatus `decommissioned`, `unused` oder `inactive`: **Eliminate**. (`restricted`, behalten aber nicht starten, ist bewusst ausgenommen.)
   - Treffer in CISA KEV: **Migrate-Critical**.
   - Mindestens eine kritische CVE und Supportende innerhalb von 12 Monaten: **Migrate-Critical**.
   - Supportende ohne erweiterten Support überschritten: **Migrate-Critical**.
2. **Schwellenwerte**
   - Supportende innerhalb von 0 bis 36 Monaten: **Migrate**. Supportende überschritten, aber erweiterter Support verfügbar: **Migrate**.
   - Herstellerzustand oder technischer Zustand unter 40 und Migrationsbereitschaft über 60: **Migrate**.
   - Strategische Passung, technischer Zustand und Herstellerzustand jeweils über 70: **Invest**.
   - Strategische Passung unter 30 und Geschäftskritikalität unter 30: **Eliminate**.
   - Sonst: **Tolerate** (im Support, kein übergeordnetes Risiko).

Jede App erhält eine verständliche Begründung (zum Beispiel "CISA KEV known-exploited vulnerability match"). Die eigene TIME-Einschätzung aus der Intake-Tabelle (`disposition.gartner_time`) bleibt daneben erhalten und wird nie überschrieben, sodass Abweichungen sichtbar sind.

### Nachweisgrundlage des TIME-Labels

Ein TIME-Label beruht auf Nachweisen, wenn SWAO den End-of-Life-Status oder den CVE-Status der App kennt. Der End-of-Life-Status ist bekannt, wenn [Pass 24 RESEARCH](/de/passes/24-research) den Supportstatus oder den Zeithorizont bis zum Supportende ermittelt hat (`is_eol` oder `months_until_eol` in `eol-status.md`). Der CVE-Status ist bekannt, wenn die NVD-Abfrage beantwortet wurde (kein Fehler, kein Überspringungsgrund und kein Hinweis im Block `cve` von `cve-summary.md`); dafür ist ein Herstellername nötig. Ist keiner von beiden bekannt und entscheidet der Betriebsstatus das Label nicht (`decommissioned`, `unused`, `inactive`), zeigt SWAO den abgeleiteten Quadranten weiterhin an, aber:

- die Begründung beginnt mit `insufficient evidence (end of life and cve status unknown);`, gefolgt von der Begründung der angewendeten Regel;
- die App fließt nicht in den Portfolio-Risikowert ein;
- die Karte im Engagement-Hub zeigt das Kennzeichen **Evidence: insufficient**.

`wsp/portfolio-summary.json` hält pro App fest:

| Schlüssel | Bedeutung |
|---|---|
| `assessed` | `true`, wenn es für die App einen Lauf der Service-Bewertung gibt (`apps/<id>/wsp/latest-service.txt`); andernfalls zeigt die Hub-Karte **Not assessed** |
| `evidence` | `sufficient` oder `insufficient` |
| `evidence_missing` | Welche von `end_of_life` und `cve` unbekannt sind |

Auf Ebene der Zusammenfassung zählt `assessed_count` die Apps mit einem Service-Lauf und `insufficient_evidence_count` die Apps, deren Label auf unzureichenden Nachweisen beruht.

## Anwendungs-Apps in der kombinierten Sicht

In einem Workspace mit Anwendungs- und Service-Apps listet `wsp/portfolio-summary.json` auch die Anwendungs-Apps (`assessment_type: application`, siehe [Portfolio-Betrieb](/de/portfolio)). Die Service-Regeln oben gelten für sie nicht, weil sie Intake-Felder und Recherche-Stubs lesen, die eine Anwendungs-App nicht hat. Stattdessen lesen sechs Regeln den letzten verwendbaren Anwendungslauf (`apps/<id>/wsp/latest-application.txt`); jede liefert unbekannt, wenn ihr Nachweis fehlt:

| Control | Domäne | Regel | Nachweis |
|---|---|---|---|
| APP-TCH-01 | APM-TCH | End of Life der Laufzeitumgebung: Active LTS 100, Maintenance LTS 70, End of Life überschritten 0 | `node_eol_status` aus Pass 01 / 05 |
| APP-TCH-02 | APM-TCH | CVEs der Abhängigkeiten: 0 betroffene Pakete 100, 1 Paket 40, mehr 10 | `critical_cves_found` aus Pass 05 (Pakete mit hohen oder kritischen CVEs; nur bei abgeschlossener Abfrage) |
| APP-SEC-01 | APM-SEC | Befunde: ein negativer kritischer Befund 10; kein negativer hoher 100; 1 bis 2 hohe 60; mehr 30 | Negative Signale aller Pass-Dateien |
| APP-REG-01 | APM-REG | Compliance: Mittelwert aus PASS 100, PARTIAL 50, GAP 0 | Compliance-Regime in `wsp-plan.yaml` |
| APP-MIG-01 | APM-MIG | Portabilität: `portability_score` x 100 | `wsp.yaml` overall |
| APP-MIG-02 | APM-MIG | Landing-Zone-Eignung: READY 100, READY_WITH_CHANGES 70, NEEDS_VERIFICATION 50, BLOCKED 0 | `wsp/latest-lz-primary.yaml` |

Domänenwerte, Health und Risiko werden mit denselben Domänengewichten wie bei Service-Apps berechnet. Der TIME-Quadrant folgt dem 7R-Urteil:

| 7R-Urteil | TIME |
|---|---|
| Retire | Eliminate |
| Retain | Tolerate |
| Rehost, Relocate, Replatform, Repurchase | Migrate |
| Refactor (Re-architect, Rebuild) | Invest |

Vorrangige Regeln: Betriebsstatus `decommissioned`, `unused` oder `inactive` in der `.swao.yml` der App ergibt **Eliminate**; eine Laufzeitumgebung jenseits des End of Life zusammen mit Paketen mit hohen oder kritischen CVEs ergibt **Migrate-Critical** (außer beim Urteil Retire). Das Evidenzlabel ist `not_assessed` ohne verwendbaren Anwendungslauf, `insufficient`, wenn das 7R-Urteil fehlt oder weder das End of Life der Laufzeitumgebung noch der CVE-Status der Abhängigkeiten bekannt ist, und sonst `sufficient`. In Anwendungsläufe wird keine `apm-score.json` geschrieben.

## Gewichte und Regeln anpassen

Kopieren Sie den gesamten mitgelieferten Rahmenwerksordner (`framework-meta.yaml` und `controls.yaml`) in den Workspace und bearbeiten Sie die Kopie. SWAO bevorzugt die Workspace-Kopie und liest beide Dateien daraus. Die Quelle kopieren Sie von GitHub unter [community-frameworks/swao-apm](https://github.com/Accenture/SWAO/tree/main/community-frameworks/swao-apm). Legen Sie die Kopie hier ab:

```text
wsp/inputs/catalogs/community/swao-apm/framework-meta.yaml
wsp/inputs/catalogs/community/swao-apm/controls.yaml
```

Auszug aus einer bearbeiteten `framework-meta.yaml` (alle übrigen Schlüssel unverändert lassen):

```yaml
framework:
  domain_weights:
    APM-TCH: 25
    APM-SEC: 20
    APM-VND: 10
    APM-DAT: 10
    APM-REG: 10
    APM-SOV: 8
    APM-MIG: 5
    APM-INT: 4
    APM-HW: 3
    APM-BIZ: 3
    APM-STR: 2
  time_rules:
    migrate:
      eol_months_min: 0
      eol_months_max: 24     # engeres Migrate-Fenster für dieses Engagement
```

`swao health-check` prüft die Kopie:

- **Probe 18 (SWAO_APM weights):** alle elf Domänen vorhanden, und die ganzen Zahlen ergeben genau 100. Eine falsche Summe ist ein Fehler; ein fehlender Schlüssel `domain_weights` ist eine Warnung (dann gelten gleiche Gewichte).
- **Probe 25 (SWAO_APM controls):** alle elf Domänen haben Kontrollen, mindestens 4 pro Domäne, jede Kontrolle hat eine ID, einen Titel und eine Nachweisgrundlage, und die IDs sind eindeutig.

## Kontrollen nach Domäne

### APM-STR: Strategische Passung

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-STR-01` | Analyst portfolio disposition recorded | `analyst_time_signal` |
| `APM-STR-02` | Migration intent declared | `migration_intent` |
| `APM-STR-03` | Business capability alignment | Nachweis durch Analyse (nicht automatisiert) |
| `APM-STR-04` | Cloud-native successor available | Nachweis durch Analyse (nicht automatisiert) |
| `APM-STR-05` | Vendor roadmap commitment | Nachweis durch Analyse (nicht automatisiert) |
| `APM-STR-06` | Functional redundancy assessed | Nachweis durch Analyse (nicht automatisiert) |

### APM-VND: Herstellerzustand

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-VND-01` | Vendor identified | `vendor_identified` |
| `APM-VND-02` | Vendor support active | `vendor_support_active` |
| `APM-VND-03` | Support contact available | `support_contact_available` |
| `APM-VND-04` | Support contract current | `contract_currency` |
| `APM-VND-05` | Product version recorded | `product_version_known` |
| `APM-VND-06` | Vendor financial stability | Nachweis durch Analyse (nicht automatisiert) |
| `APM-VND-07` | Service level agreement defined | Nachweis durch Analyse (nicht automatisiert) |
| `APM-VND-08` | Vendor security advisory practice | Nachweis durch Analyse (nicht automatisiert) |

### APM-TCH: Technischer Zustand

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-TCH-01` | Operating system in support | `os_eol_status` |
| `APM-TCH-02` | Operating system end-of-life horizon | `os_eol_horizon` |
| `APM-TCH-03` | No open critical CVEs | `cve_critical_open` |
| `APM-TCH-04` | Limited high-severity CVEs | `cve_high_open` |
| `APM-TCH-05` | No known exploited vulnerabilities | `kev_match` |
| `APM-TCH-06` | Patches available for severe CVEs | `patch_availability` |
| `APM-TCH-07` | Supported operating system family | `os_family_supported` |
| `APM-TCH-08` | Update cadence | Nachweis durch Analyse (nicht automatisiert) |
| `APM-TCH-09` | Runtime and dependency freshness | `binary_runtime_current` |

### APM-SEC: Sicherheitslage

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-SEC-01` | No weak cryptographic algorithms | `weak_crypto` |
| `APM-SEC-02` | Encrypted network endpoints | `cleartext_endpoints` |
| `APM-SEC-03` | No hard-coded credentials | `hardcoded_credentials` |
| `APM-SEC-04` | Valid code-signing certificates | `expired_certificates` |
| `APM-SEC-05` | No severe national advisories | `bsi_advisories` |
| `APM-SEC-06` | Installer not flagged as malicious | `vt_detection` |
| `APM-SEC-07` | Strong authentication | Nachweis durch Analyse (nicht automatisiert) |
| `APM-SEC-08` | Security certifications | Nachweis durch Analyse (nicht automatisiert) |
| `APM-SEC-09` | Recent penetration test | Nachweis durch Analyse (nicht automatisiert) |
| `APM-SEC-10` | Security incident history | Nachweis durch Analyse (nicht automatisiert) |

### APM-DAT: Daten-Governance

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-DAT-01` | Data classification declared | `data_classification_declared` |
| `APM-DAT-02` | Health data sensitivity | `health_data_sensitivity` |
| `APM-DAT-03` | Personal data sensitivity | `personal_data_sensitivity` |
| `APM-DAT-04` | Data flows documented | `data_flow_documented` |
| `APM-DAT-05` | Data residency declared | `data_residency_declared` |
| `APM-DAT-06` | Sub-processors declared | `subprocessors_declared` |
| `APM-DAT-07` | Data processing agreement | Nachweis durch Analyse (nicht automatisiert) |
| `APM-DAT-08` | Retention and deletion | Nachweis durch Analyse (nicht automatisiert) |

### APM-SOV: Souveränitätsreife

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-SOV-01` | Sovereign technology rating | `sovereign_rating` |
| `APM-SOV-02` | Sovereign alternative exists | `sovereign_alternative_available` |
| `APM-SOV-03` | Data stored in the EU | `data_residency_eu` |
| `APM-SOV-04` | Third-country transfer risk | Nachweis durch Analyse (nicht automatisiert) |
| `APM-SOV-05` | EU vendor entity | Nachweis durch Analyse (nicht automatisiert) |
| `APM-SOV-06` | EUCS readiness | Nachweis durch Analyse (nicht automatisiert) |

### APM-BIZ: Geschäftskritikalität

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-BIZ-01` | Business criticality recorded | `business_criticality` |
| `APM-BIZ-02` | User base | `user_base` |
| `APM-BIZ-03` | Operationally active | `operational_status_active` |
| `APM-BIZ-04` | Owning department recorded | `department_assigned` |
| `APM-BIZ-05` | Outage impact assessed | Nachweis durch Analyse (nicht automatisiert) |
| `APM-BIZ-06` | Process coverage | Nachweis durch Analyse (nicht automatisiert) |

### APM-HW: Hardware und Kosten

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-HW-01` | Hardware profile recorded | `hardware_profile_known` |
| `APM-HW-02` | Right-sized memory | `memory_utilisation` |
| `APM-HW-03` | Cloud cost estimated | `cloud_cost_estimate` |
| `APM-HW-04` | Total cost of ownership compared | Nachweis durch Analyse (nicht automatisiert) |

### APM-INT: Integrationskomplexität

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-INT-01` | Integration count | `integration_count` |
| `APM-INT-02` | Integrations documented | `integration_documented` |
| `APM-INT-03` | Modern integration protocols | Nachweis durch Analyse (nicht automatisiert) |
| `APM-INT-04` | API availability | Nachweis durch Analyse (nicht automatisiert) |
| `APM-INT-05` | Replacement coupling | Nachweis durch Analyse (nicht automatisiert) |

### APM-MIG: Migrationsbereitschaft

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-MIG-01` | Marked as migration candidate | `migration_candidate_flag` |
| `APM-MIG-02` | Portable operating system | `os_portability` |
| `APM-MIG-03` | Cloud delivery model | `vendor_type_cloud_ready` |
| `APM-MIG-04` | Sovereign cloud programme | `sovereign_cloud_programme` |
| `APM-MIG-05` | Data export capability | Nachweis durch Analyse (nicht automatisiert) |

### APM-REG: Compliance-Pflichten

| Kontrolle | Titel (Katalog) | Bewertet durch Regel |
|---|---|---|
| `APM-REG-01` | Regulatory load | `regulatory_load` |
| `APM-REG-02` | GDPR Art. 9 scope | `gdpr_art9_scope` |
| `APM-REG-03` | MDR classification known | `mdr_classification_known` |
| `APM-REG-04` | Recent security audit | `audit_recency` |
| `APM-REG-05` | Certification status current | Nachweis durch Analyse (nicht automatisiert) |

