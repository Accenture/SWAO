# Verordnung über die digitale operationale Resilienz im Finanzsektor (DORA)

Diese Seite beschreibt das Community-Rahmenwerk `DORA`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `DORA` |
| Herausgeber | Europäische Union (Verordnung (EU) 2022/2554) |
| Version | 2025-01-17 (Geltungsbeginn) |
| Abgedeckte Level-2-Rechtsakte | Delegierte Verordnungen (EU) 2024/1774, 2024/1772, 2024/1773, 2025/301, 2025/532, 2025/1190; Durchführungsverordnungen (EU) 2024/2956, 2025/302 |
| SWAO-Katalogversion | 2.0.0 |
| Controls gesamt | 55 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud`, `lz` |
| Lizenz und Weiterverbreitung | DORA und die Level-2-Rechtsakte sind EU-Rechtsakte und gemäß den EUR-Lex-Bedingungen weiterverwendbar. Die Control-Beschreibungen geben den Rechtstext sinngemäß wieder und sind keine Rechtsberatung; ziehen Sie Rechtsberatung und Ihre zuständige Aufsichtsbehörde hinzu. |
| Zuletzt geprüft | 2026-11-06 |
| Ordner | `dora` |

## Worum es geht

DORA (Verordnung (EU) 2022/2554) ist eine EU-Verordnung zur digitalen operationalen Resilienz des Finanzsektors. Sie ist am 16. Januar 2023 in Kraft getreten, gilt seit dem 17. Januar 2025 und ist in allen Mitgliedstaaten unmittelbar verbindlich. Sie umfasst IKT-Risikomanagement, Behandlung und Meldung IKT-bezogener Vorfälle, Tests der digitalen operationalen Resilienz, das IKT-Drittparteienrisiko und den Informationsaustausch. Acht Level-2-Rechtsakte regeln die Einzelheiten; der SWAO-Katalog zitiert sie dort, wo sie gelten.

Jedes Control zitiert Artikel, Absatz und Buchstaben der DORA (`regulatory_basis`, `official_control_id`) und, wo einschlägig, den Artikel des Level-2-Rechtsakts. Die IDs nennen den Artikel (`DORA_Art_<Artikel>_<n>`); die Zahl am Ende ist eine laufende Nummer, nicht der Absatz.

## Wer es in SWAO einsetzt und wann

- Banken, Versicherer, Wertpapierfirmen, Zahlungsinstitute und andere Finanzunternehmen in der EU (Hinweise im Katalog: `financial_services`, `banking`, `insurance`, `payment_institution`, `investment_firm`).
- IKT-Drittdienstleister, die EU-Finanzunternehmen bedienen und die Übereinstimmung mit den DORA-Pflichten ihrer Kunden zeigen müssen.
- DORA-Readiness- und Gap-Analysen für Workloads, die in die Cloud wechseln, und für deren Landing Zone.

## Was SWAO prüft

Die Controls werden in [Pass 11 (Compliance-Bewertung)](/de/passes/11-comp) bewertet. Der Pass liest `assessment.regimes_active` aus der `.swao.yml` der App, lädt den Katalog und sendet die Controls in Paketen zu je 20 zusammen mit den Signalen des Laufs an das konfigurierte LLM. Je Control ergibt sich `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` oder `N_A`. Controls, deren `applies_when` nicht zum `framework_context` der App passt, sind per Regel N/A.

### Nachweise: Workload, Landing Zone und organisatorische Dokumente

| Nachweisart (Tag) | Controls | Bedeutung |
|---|---|---|
| `evidence.workload` | 2 | Code-, Konfigurations- oder Landing-Zone-Nachweise |
| `evidence.both` | 18 | Technische Nachweise, ergänzt durch Dokumente |
| `evidence.organisational` | 35 | Nur Dokumente (`layer: governance`) |

Organisatorische Controls beziehen ihre Nachweise aus dem Ingestion-Ordner der App. Legen Sie die Dokumente in `apps/<app-id>/ingestion/` ab; Pass 00 kopiert sie nach `wsp/inputs/` und extrahiert den Text, und [Pass 04 (CTX)](/de/passes/04-ctx) macht daraus Signale, die die Datei zitieren. Ein Control mit `layer: governance` ist nur dann `SATISFIED` oder `PARTIAL`, wenn ein zitiertes Signal eines der Dokumente zitiert, die das Control erwartet; sonst ist es `UNKNOWN` (nicht bewertet, unzureichende Nachweise) mit der Liste der erwarteten Dokumente. Fehlende Nachweise ergeben nie ein Bestanden.

Ein Dokument gilt als erwartet, wenn sein Dateiname den Namen des erwarteten Inputs enthält, unabhängig von Groß- und Kleinschreibung und Trennzeichen, zum Beispiel `incident_classification_policy.pdf` oder `register_of_information.xlsx`. Die README des Rahmenwerks listet, welches Dokument welches Control erfüllt (`ict_risk_management_framework`, `incident_reporting_procedure`, `register_of_information`, `exit_plan`, `tlpt_plan_and_attestation` und weitere).

### Referenzierte Signalbereiche

| Präfix | Controls |
|---|---|
| `TF` | 16 |
| `STATE` | 4 |
| `LZR` | 4 |
| `INV` | 3 |
| `SBOM` | 3 |
| `IAM` | 2 |
| `CRYPTO` | 2 |
| `MAL` | 2 |
| `EGR`, `QUAL`, `DYN`, `SYNTH` | je 1 |

### Landing-Zone-Assessments

DORA steht im Landing Zone Live Assessment zur Verfügung (`swao assess --type landing-zone-live --frameworks DORA`). Dort wird es je Service über `service-controls.yaml` bewertet: 18 Controls sind Capability-Tags zugeordnet (Verschlüsselung, Schlüssel und Zertifikate, Identitäten, Protokollierung und Überwachung, Netzsegmentierung, Backup und Wiederherstellung, Redundanz, Orte der Datenverarbeitung, Patching und Härtung, Änderungsmanagement, Exit). Die 8 organisatorischen Controls mit Bewertungstyp `lz` (DORA_Art_5_1, 5_2, 6, 6_3, 9_7, 11_1, 11_4, 16_1) werden aus den Dokumenten im Ingestion-Ordner der Landing Zone entschieden, `landing-zones/<lz-id>/ingestion/`, benannt nach den erwarteten Inputs wie bei einer App. Die Entscheidung beruht auf Namen und Lesbarkeit der Dokumente, nicht auf dem Inhalt: dokumentiert, teilweise dokumentiert oder nicht bewertet (siehe [Organisatorische Kontrollen](/de/assessment/landing-zone-live#organisatorische-kontrollen-ingestion-ordner)). Ein Application Assessment prüft den Inhalt und entscheidet die übrigen 27 organisatorischen Controls, die Anwendungs- und Audit-Bewertungen zugeordnet sind. Die 64 Zuordnungszeilen wurden am 2026-11-06 von einem Menschen geprüft (`confidence: curated`), einschließlich der KI-Capability-Tags `ml_training` und `ml_inference`.

## Aufbau der Controls

| Säule | Artikel | Controls |
|---|---|---|
| IKT-Risikomanagement | Art. 5 bis 16 | 32 |
| Behandlung und Meldung IKT-bezogener Vorfälle | Art. 17 bis 23 | 8 |
| Tests der digitalen operationalen Resilienz | Art. 24 bis 27 | 4 |
| IKT-Drittparteienrisiko | Art. 28 bis 44 | 10 |
| Informationsaustausch | Art. 45 | 1 |
| **Gesamt** | | **55** |

Standard-Schweregrade: hoch 38, mittel 16, niedrig 1.

Zahlen in den Controls stammen aus dem Rechtstext, zum Beispiel die Meldefristen der Delegierten Verordnung (EU) 2025/301 Art. 5 (Erstmeldung binnen 4 Stunden nach Einstufung als schwerwiegend und spätestens 24 Stunden nach Kenntnis, Zwischenmeldung binnen 72 Stunden, Abschlussmeldung binnen eines Monats nach der letzten Zwischenmeldung). Wo DORA einen Wert dem Unternehmen überlässt (Aufbewahrung von Protokollen, Backup-Häufigkeit, Patch-Fristen, RTO und RPO, Tests der Exit-Pläne), fragt das Control nach dem dokumentierten Wert des Unternehmens.

### Verhältnismäßigkeit

Drei Gruppen von Controls gelten nur für bestimmte Unternehmen und sind N/A, solange `framework_context` in der `.swao.yml` der App nichts anderes sagt:

```yaml
framework_context:
  dora_simplified_framework: "true"   # Unternehmen nach Art. 16 Abs. 1: DORA_Art_16_1
  dora_tlpt_required: "true"          # zu TLPT verpflichtete Unternehmen: DORA_Art_26, DORA_Art_27_1
  dora_payment_entity: "true"         # Kredit-, Zahlungs-, Kontoinformations- und E-Geld-Institute: DORA_Art_23_1
```

### Korrigierte IDs (Katalog 1.0.0 zu 2.0.0)

Sieben IDs des Katalogs 1.0.0 nannten den falschen Artikel. Sie wurden korrigiert; die neuen Controls führen die alte ID in `replaces:`, sodass Publikationen früherer Assessments sie weiter auflösen: `DORA_Art_7_2` zu `DORA_Art_9_4`, `DORA_Art_11_2` zu `DORA_Art_12_3`, `DORA_Art_15` zu `DORA_Art_17_1`, `DORA_Art_16` zu `DORA_Art_18_1`, `DORA_Art_17` zu `DORA_Art_19_1`, `DORA_Art_19` zu `DORA_Art_20_1`, `DORA_Art_31` zu `DORA_Art_30_2`.

## Cross-Mapping

54 von 55 Controls tragen `maps_to`-Verweise. Alle Ziele existieren als Controls in den mitgelieferten Katalogen.

| Ziel-Rahmenwerk | Verweise | Verschiedene Ziel-Controls |
|---|---|---|
| `BSI_C5` | 55 | 40 |
| `NIS2` | 48 | 38 |
| `EUCS` | 46 | 37 |
| `GDPR` | 10 | 7 |
| `ISO_27001` (Anhang A; nicht im öffentlichen Download) | 56 | 39 |

In der Gegenrichtung verweist `COBIT_5` auf `DORA_Art_6` und `DORA_Art_30`.

## Demo-Variante

| Eigenschaft | Wert |
|---|---|
| Framework-ID | `DORA_DEMO` |
| Ordner | `dora-demo` |
| Controls | 12 |
| In neuen Workspaces vorinstalliert | Nein |

Die Demo-Variante ist eine Auswahl von 12 Controls für Live-Präsentationen; sie verwendet noch IDs des Katalogs 1.0.0. Für echte Assessments verwenden Sie das vollständige DORA-Rahmenwerk.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Kopieren Sie den Ordner `dora` aus dem [GitHub-Repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) nach `wsp/inputs/catalogs/community/dora/`. SWAO liest Kataloge aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei und prüfen Sie die Kopie mit dem [Health Check](/de/health-check).

## Aktivieren

1. Kopieren Sie den Ordner `dora` aus dem GitHub-Repository nach `wsp/inputs/catalogs/community/dora/` im Workspace.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [DORA]
   ```

3. Legen Sie die organisatorischen Dokumente, benannt nach den erwarteten Inputs, in `apps/<app-id>/ingestion/` ab.
4. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus. Für eine Landing Zone führen Sie das Landing Zone Live Assessment mit `--frameworks DORA` aus.

## Grenzen und Hinweise

- Jede Fundstelle wurde am 2026-11-06 gegen den EUR-Lex-Text der Verordnung und ihrer acht Level-2-Rechtsakte geprüft.
- In Landing-Zone-Läufen werden organisatorische Controls nur nach Namen und Lesbarkeit der Dokumente entschieden (`landing-zones/<lz-id>/ingestion/`); den Inhalt prüft das Application Assessment.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer der amtliche Rechtstext.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
