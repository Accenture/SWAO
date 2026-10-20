# Payment Card Industry Data Security Standard v4.0 (PCI_DSS)

## Auf einen Blick

| Merkmal | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `PCI_DSS` |
| Herausgeber | PCI Security Standards Council (PCI SSC) |
| Version | 4.0 |
| Status | In den Katalog-Metadaten nicht angegeben |
| SWAO-Katalogversion | `0.1.0` (`regime_meta` in controls.yaml nennt `1.0.0`) |
| Anzahl Kontrollen | 5 |
| Bewertungsmodus | `binary` (in framework-meta.yaml deklariert) |
| Assessment-Scope (framework-meta) | `app`, `aud` |
| Signal-Präfix | - |
| Lizenz und Weitergabe | Ein Weitergabehinweis ist nicht deklariert. Der Standard wird vom PCI Security Standards Council in seiner Dokumentenbibliothek veröffentlicht. |
| Zuletzt geprüft | 2026-05-24 |

## Worum es geht

PCI DSS ist der weltweite Sicherheitsstandard des PCI Security Standards Council, der von den großen Kartenorganisationen gegründet wurde. Er gilt für jede Organisation, die Karteninhaberdaten oder sensible Authentifizierungsdaten speichert, verarbeitet oder überträgt. Er ist kein Gesetz, sondern wird vertraglich über Acquirer und Kartenorganisationen durchgesetzt. Version 4.0 gilt seit dem 31. März 2024, mit voller Durchsetzung ab dem 31. März 2025 (Beschreibung in `framework-meta.yaml`), und führte den Customized Approach als Alternative zum Defined Approach ein.

Der SWAO-Katalog ist eine schlanke Umsetzung in Proof-of-Concept-Tiefe: Er enthält fünf Kontrollen zu den Anforderungen 3.4, 4.1, 6.2, 8.3 und 10, die den für Code und Infrastruktur relevanten Kern des Standards abdecken. Er bildet die zwölf PCI-DSS-Anforderungen nicht vollständig ab.

## Wer es in SWAO nutzen sollte und wann

Setzen Sie PCI_DSS als schnelle technische Prüfung für Anwendungen in oder nahe einer Cardholder Data Environment (CDE) ein: E-Commerce-Checkouts, Zahlungs-Backends, Card-on-File-Dienste und Plattformen, die mit Zahlungsdaten im Scope in eine souveräne Cloud migriert werden. Kombinieren Sie es mit [ISO_27001](/de/frameworks/iso-27001) oder [SOC_2](/de/frameworks/soc-2) für eine breitere Kontrollabdeckung. Für einen formalen Report on Compliance oder Self-Assessment Questionnaire arbeiten Sie mit einem Qualified Security Assessor und dem vollständigen Standard.

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

Alle fünf Kontrollen deklarieren Signal-Evidenz. Kryptografie-Befunde ([Pass 08](/de/passes/08-crypto)) und Datenklassifizierung ([Pass 03](/de/passes/03-data)) fließen in `PCI_DSS_3.4` (PAN unlesbar machen) ein, Kryptografie- und Terraform-Befunde in `PCI_DSS_4.1` (starke Kryptografie bei der Übertragung) und SBOM-Befunde ([Pass 05](/de/passes/05-sbom)) in `PCI_DSS_6.2` (sichere Softwareentwicklung). Die vollständige Zuordnung steht in der Tabelle unter Aufbau der Kontrollen.

## Aufbau der Kontrollen

Die fünf Kontrollen haben keine Säule; sie sind nach PCI-DSS-Anforderung aufgeführt.

| Anforderung | Kontrolle | Titel | Standard-Schweregrad | Deklarierte Evidenzbasis |
|---|---|---|---|---|
| 3.4 | `PCI_DSS_3.4` | Render PAN unreadable wherever it is stored | critical | `CRYPTO` ([Pass 08](/de/passes/08-crypto)), `DATA` ([Pass 03](/de/passes/03-data)) |
| 4.1 | `PCI_DSS_4.1` | Strong cryptography for transmission of cardholder data | high | `CRYPTO` ([Pass 08](/de/passes/08-crypto)), `TF` ([Pass 06](/de/passes/06-tf)) |
| 6.2 | `PCI_DSS_6.2` | Secure software development | medium | `PP`, `QA`, `SBOM` ([Pass 05](/de/passes/05-sbom)) |
| 8.3-8.5 | `PCI_DSS_8.3` | Multi-factor authentication for non-console access | high | `IAM`, Kontext `solution_arch` |
| 10 | `PCI_DSS_10` | Log and monitor all access to system components and cardholder data | high | `OBS`, Kontext `ops_runbooks` |

## Aktivierung

1. **Erkennung.** Kopieren Sie den Ordner `pci-dss` in den Workspace nach `wsp/inputs/catalogs/community/pci-dss/` (siehe nächster Abschnitt). Jeder Framework-Ordner dort wird automatisch erkannt; eine Registrierung ist nicht nötig. Die Framework-Auswahl der TUI (Run Assessment, dann der Framework-Schritt der Anwendung) bietet ihn an, und der Compliance-Pass löst Kataloge aus diesem Workspace-Ordner auf. In der TUI zeigt die Framework-Auswahl für [Anwendungs-Assessments](/de/assessment/application) installierte Frameworks, deren `assessment_type_scope` den Wert `app` enthält. Dieses Framework deklariert `app` und `aud` und erscheint dort; die Auswahl für [Landing-Zone-Assessments](/de/assessment/landing-zone) zeigt alle installierten Frameworks.
2. **Auswahl.** Die gewählten Frameworks werden je Anwendung in `apps/<app-id>/.swao.yml` als `assessment.regimes_active` gespeichert, und der Compliance-Pass bewertet genau diese Liste. Die TUI schreibt den Eintrag für Sie; auf der Kommandozeile verwenden Sie `swao regime-select --app <app-id> --regimes PCI_DSS`. Alternativ bearbeiten Sie die `.swao.yml` der Anwendung von Hand:

   ```yaml
   assessment:
     regimes_active: [PCI_DSS]
   ```

   Mehrere Frameworks lassen sich in einer Liste kombinieren. Sollen mehrere Anwendungen gegen dasselbe Framework geprüft werden, tragen Sie die ID bei jeder Anwendung ein.
3. **Workspace-Ebene.** Eine Liste `regimes_active` in der `.swao.yml` des Workspaces gilt für jede Anwendung ohne eigene Liste. Eine Liste in der App hat immer Vorrang.
4. **Prüfung.** Führen Sie [`swao health-check`](/de/health-check) aus: Der Check meldet IDs in `regimes_active`, für die kein Katalog installiert ist.

## Framework beziehen oder anpassen

Die Quelle des Frameworks (`framework-meta.yaml`, `controls.yaml` und ggf. weitere Dateien) ist öffentlich. Sie können sie auf GitHub ansehen und per Kopieren und Einfügen übernehmen:

- Framework-Quelle: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/pci-dss>
- Übersicht aller Community-Frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

Um das Framework für ein einzelnes Engagement anzupassen, kopieren Sie den Ordner `pci-dss` in Ihren Workspace nach `wsp/inputs/catalogs/community/pci-dss/` und bearbeiten Sie dort die Kopie, etwa um Schweregrade anzupassen oder engagementspezifische Kontrollen zu ergänzen. SWAO liest diesen Workspace-Ordner; das mit SWAO ausgelieferte Original bleibt unverändert. Legen Sie die Kopie direkt unter `community/` ab, denn Ordner, deren Name mit einem Punkt beginnt, werden übersprungen. Halten Sie `regime_meta.id` eindeutig: Deklarieren zwei Workspace-Ordner dieselbe ID, wird nur einer davon geladen. `swao framework info PCI_DSS` zeigt die mitgelieferten Metadaten an.

## Grenzen und Hinweise

- SWAO erstellt eine evidenzbasierte Voreinschätzung. Sie ist weder eine Zertifizierung noch ein Prüfungsurteil oder eine Rechtsberatung. Prüfen Sie jedes Ergebnis `SATISFIED` und `GAP`, bevor Sie sich darauf stützen, und ziehen Sie für formale Compliance-Aussagen qualifizierte Prüfer oder Rechtsberater hinzu.
- Die Ergebnisse hängen von der im Lauf verfügbaren Evidenz (Code, Konfiguration, Infrastructure-as-Code, eingelesene Dokumente) und von der Bewertung durch das LLM ab. Spricht kein Signal eine Kontrolle an, ist das LLM angewiesen, `UNKNOWN` statt `GAP` zu liefern.
- Organisatorische, physische und vertragliche Kontrollen lassen sich nicht aus Code belegen. Dafür werden vom Kunden bereitgestellte Dokumente benötigt.
- Fünf Kontrollen können keine PCI-DSS-Konformität begründen. Scoping der CDE, Segmentierungstests, physische Sicherheit (Anforderung 9), Malware-Schutz (Anforderung 5), Sicherheitstests (Anforderung 11) und das Richtlinienprogramm (Anforderung 12) sind nicht abgedeckt.
- `framework-meta.yaml` nennt die Katalogversion `0.1.0`, `regime_meta` in `controls.yaml` dagegen `1.0.0`.
