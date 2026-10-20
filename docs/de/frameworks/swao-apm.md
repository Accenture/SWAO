# SWAO Application Portfolio Management (SWAO_APM)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `SWAO_APM` |
| Herausgeber | SWAO Development Team; Synthese aus Gartner TIME, ISO/IEC 25010:2023, TOGAF 10, ENISA-Leitlinien und EU-Kriterien für souveräne Clouds |
| Version | 2026.10 |
| Status | `approved` |
| SWAO-Katalogversion | `0.1.0` |
| Anzahl Kontrollen | 72 |
| Bewertungsmodus | `score` (in `regime_meta` deklariert): Gesundheitswert 0 bis 100 je Kontrolle und Domäne, gewichteter Risikowert je Anwendung |
| Assessment-Scope (framework-meta) | `service` |
| Signal-Präfix | `APM` |
| Lizenz und Weitergabe | Eigene SWAO-Synthese; es wird kein Kontrolltext Dritter wiedergegeben. Apache-2.0 zusammen mit dem Community-Framework-Katalog. |
| Zuletzt geprüft | 2026-10-10 |

## Worum es geht

SWAO_APM ist das eigene Application-Portfolio-Management-Framework von SWAO und keine Regulierung. Es bewertet Drittanbieter-, SaaS- und Standardsoftware-Anwendungen (COTS) in elf Domänen, von Hersteller- und technischer Gesundheit über Data Governance und Souveränitätsreife bis zur Compliance-Last, und leitet daraus eine Portfolio-Entscheidung nach dem TIME-Modell ab: Tolerate, Invest, Migrate oder Eliminate.

Das Framework ist die Bewertungsgrundlage des [Service Portfolio Assessments](/de/service-assessment/). Es stützt sich auf das Gartner-TIME-Modell, die Qualitätsmerkmale nach ISO/IEC 25010:2023, den Application Portfolio Catalogue von TOGAF 10 und die Application-Security-Empfehlungen der ENISA (Referenzen in `framework-meta.yaml`). In den Katalog-Metadaten hat es den Status `approved`.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie SWAO_APM immer dann ein, wenn Sie ein [Service Portfolio Assessment](/de/service-assessment/) durchführen: typischerweise zu Beginn eines Programms für eine souveräne Cloud oder einen Rechenzentrumsausstieg, wenn ein Kunde eine Server- oder Anwendungsliste übergibt und wissen muss, welche Anwendungen er behalten, modernisieren, zuerst migrieren oder abschalten soll. Das Framework ist branchen- und regionsunabhängig; einige Kontrollen (etwa die Sensibilität von Gesundheitsdaten, `APM-DAT-02`, und die MDR-Klassifizierung, `APM-REG-03`) sind besonders für Portfolios im Gesundheitswesen relevant.

## Was SWAO prüft

SWAO_APM wird vom Service-Assessment-Modul deterministisch bewertet, nicht durch ein LLM. Jede Kontrolle kann über einen `apm_export`-Eintrag in ihrer `evidence_basis` an eine benannte Bewertungsregel gebunden sein. Eine Regel liest Evidenz, die der Service-Ablauf bereits erzeugt hat (Intake-Felder, Recherchedaten wie CVE-, End-of-Life-, Malware-Scan- und nationale Warnmeldungs-Ergebnisse sowie `DATA`- und `CRYPTO`-Signale aus dem Service-Lauf), und liefert einen Wert von 0 bis 100 auf einer Gesundheitsskala, wobei 100 gesund bzw. unbedenklich bedeutet.

- 47 der 72 Kontrollen sind an eine Regel gebunden, zum Beispiel `APM-TCH-03` No open critical CVEs (`cve_critical_open`) oder `APM-SEC-03` No hard-coded credentials (`hardcoded_credentials`).
- Findet eine Regel keine Evidenz, liefert sie keinen Wert. Die Kontrolle gilt dann als unbekannt und wird aus dem Domänenwert ausgeschlossen; sie wird nie pauschal als bestanden oder nicht bestanden gewertet.
- Die übrigen 25 Kontrollen nennen nur eine Kontextquelle (etwa `APM-VND-06` Vendor financial stability, `APM-SOV-04` Third-country transfer risk). Sie haben in dieser Version keine Regel und bleiben daher unbekannt und ausgeschlossen.

Die Domänenwerte werden über `domain_weights` zu einem gewichteten Risikowert je Anwendung verdichtet, und `time_rules` in `framework-meta.yaml` leiten die TIME-Empfehlung ab (Übersteuerungen zuerst, etwa für stillgelegte Anwendungen oder bekannte ausgenutzte Schwachstellen). Die genauen Bewertungs- und TIME-Regeln beschreibt [Framework und Bewertung](/de/service-assessment/framework).

## Aufbau der Kontrollen

Die Risikogewichte stammen aus `domain_weights` in `framework-meta.yaml` und müssen in Summe 100 ergeben; `swao health-check` prüft die Summe. Passen Sie sie je Engagement in einer Workspace-Kopie an.

| Domäne | Kontrollen | An eine Bewertungsregel gebunden | Risikogewicht | Beispielkontrollen |
|---|---|---|---|---|
| APM-STR: Strategic fit | 6 | 2 | 4 | `APM-STR-01` Analyst portfolio disposition recorded; `APM-STR-02` Migration intent declared |
| APM-VND: Vendor health | 8 | 5 | 12 | `APM-VND-01` Vendor identified; `APM-VND-02` Vendor support active |
| APM-TCH: Technical health | 9 | 8 | 20 | `APM-TCH-01` Operating system in support; `APM-TCH-02` Operating system end-of-life horizon |
| APM-SEC: Security posture | 10 | 6 | 18 | `APM-SEC-01` No weak cryptographic algorithms; `APM-SEC-02` Encrypted network endpoints |
| APM-DAT: Data governance | 8 | 6 | 10 | `APM-DAT-01` Data classification declared; `APM-DAT-02` Health data sensitivity |
| APM-SOV: Sovereignty readiness | 6 | 3 | 8 | `APM-SOV-01` Sovereign technology rating; `APM-SOV-02` Sovereign alternative exists |
| APM-BIZ: Business criticality | 6 | 4 | 4 | `APM-BIZ-01` Business criticality recorded; `APM-BIZ-02` User base |
| APM-HW: Hardware and cost | 4 | 3 | 4 | `APM-HW-01` Hardware profile recorded; `APM-HW-02` Right-sized memory |
| APM-INT: Integration complexity | 5 | 2 | 6 | `APM-INT-01` Integration count; `APM-INT-02` Integrations documented |
| APM-MIG: Migration readiness | 5 | 4 | 6 | `APM-MIG-01` Marked as migration candidate; `APM-MIG-02` Portable operating system |
| APM-REG: Compliance obligations | 5 | 4 | 8 | `APM-REG-01` Regulatory load; `APM-REG-02` GDPR Art. 9 scope |
| **Summe** | **72** | **47** | **100** |  |

## Aktivierung

SWAO_APM müssen Sie normalerweise nicht von Hand aktivieren. Wenn der Service-Intake die Anwendungsordner anlegt, schreibt er folgenden Block in die `.swao.yml` jeder Anwendung:

```yaml
assessment:
  type: service
  regimes_active: [SWAO_APM]
```

Das Service Assessment lädt das Framework aus der Workspace-Kopie unter `wsp/inputs/catalogs/community/swao-apm/`, sofern vorhanden, und andernfalls aus der mit SWAO ausgelieferten Kopie. Siehe [Befehle des Service Portfolio Assessments](/de/service-assessment/commands) und [Konfiguration](/de/service-assessment/configuration).

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/swao-apm> (an diesem Ort ab v1.4.0 veröffentlicht)
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `swao-apm` in Ihren Workspace nach `wsp/inputs/catalogs/community/swao-apm/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info SWAO_APM` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- Die Ergebnisse von SWAO_APM sind Entscheidungshilfen für die Portfolioplanung. Sie sind weder ein Audit noch eine Zertifizierung oder Rechtsberatung.
- Die Werte sind nur so gut wie die zugrunde liegenden Intake-, Recherche- und Scan-Daten. Kontrollen ohne Evidenz werden ausgeschlossen; ein Domänenwert, der auf wenigen Kontrollen beruht, verdient daher besondere Prüfung.
- TIME-Empfehlungen sind Entscheidungshilfen für Portfolio-Verantwortliche. Sie hängen von der Vollständigkeit der Intake-Daten ab; prüfen Sie Anwendungen mit vielen unbekannten Kontrollen, bevor Sie auf Basis ihrer Empfehlung handeln.
- Recherchedaten (CVE, End-of-Life, Warnmeldungen) geben den Stand zum Erhebungszeitpunkt wieder. Wiederholen Sie den Recherche-Schritt vor Entscheidungen.
