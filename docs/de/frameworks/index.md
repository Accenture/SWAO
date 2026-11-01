# Community-Rahmenwerke

Community-Rahmenwerke sind die Compliance- und Bewertungskataloge, gegen die SWAO Anwendungen prüft: Verordnungen (DSGVO, DORA, NIS2, KI-Verordnung der EU), Standards (ISO/IEC 27001, SOC 2, BSI C5), Programme für souveräne Clouds (EUCS, SecNumCloud, EC Cloud Sovereignty Framework), nationale Regelwerke (KRITIS-DE, NCA, SAMA) sowie die SWAO-eigenen Rahmenwerke für die LLM-Auswahl und das Anwendungsportfolio-Management. Jedes Rahmenwerk ist ein Ordner mit zwei Dateien: `framework-meta.yaml` (Identität, Herausgeber, Version, Bewertung) und `controls.yaml` (die Kontrollen).

SWAO liefert **25 Rahmenwerke** sowie **9 Demo-Varianten** mit einer kleinen Auswahl an Kontrollen für Workshops und Live-Präsentationen aus.

## Wie Rahmenwerke genutzt werden

1. **Erkennung (workspaceweit).** SWAO erkennt zusätzlich zum mitgelieferten Satz jeden Rahmenwerksordner in `wsp/inputs/catalogs/community/<ordner>/` automatisch. Eine Registrierung ist nicht nötig: Kopieren Sie einen Ordner hinein, und er erscheint in der Rahmenwerksauswahl der Terminal-Oberfläche.
2. **Auswahl (pro App).** Sie wählen die Rahmenwerke für eine Anwendung während einer Bewertung in der Terminal-Oberfläche oder mit `swao regime-select --app <id> --regimes GDPR,DORA`. Die Auswahl wird in `apps/<id>/.swao.yml` gespeichert:

   ```yaml
   assessment:
     regimes_active: [GDPR, DORA]
   ```

   Eine Liste `regimes_active` in der Workspace-`.swao.yml` gilt für jede App ohne eigene Liste; eine Liste in der App hat immer Vorrang.
3. **Bewertung.** [Pass 11 COMP](/de/passes/11-comp) bewertet jede Kontrolle der gewählten Rahmenwerke als SATISFIED, PARTIAL, GAP, N_A oder UNKNOWN und nutzt die Signale des Laufs als Nachweis. Die Ergebnisse erscheinen im Bericht, in der HTML-Publikation, im BI-Export und (bei Service-Apps) im Blatt Framework Compliance der Enterprise-Arbeitsmappe.

## Ein Rahmenwerk beziehen oder anpassen

Die Quellen der Rahmenwerke sind öffentlich. Sie können sie auf GitHub ansehen und kopieren:

- [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks): der Ordner mit dem Community-Katalog
- [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks): der mitgelieferte Satz, einschließlich COBIT 5, DORA, ISO/IEC 27001, SOC 2 und aller Demo-Varianten

SWAO bewertet gegen die Rahmenwerke, die im Workspace unter `wsp/inputs/catalogs/community/<ordner>/` liegen; einen eigenen Installationsschritt gibt es nicht. Innerhalb eines Workspace kopiert `swao framework install <ID>` ein mitgeliefertes Rahmenwerk in diesen Ordner, und `swao framework list` zeigt die mitgelieferten IDs (gelesen aus der `framework-meta.yaml` jedes Ordners). Um ein Rahmenwerk für ein Engagement anzupassen, bearbeiten Sie diese Kopie; die Workspace-Kopie hat Vorrang vor der mitgelieferten. Für ein eigenes Rahmenwerk legen Sie einen neuen Ordner mit denselben zwei Dateien an.

COBIT 5 wird wieder ausgeliefert, mit Control-Texten in eigenen SWAO-Formulierungen; `swao framework install COBIT_5` kopiert es wie jedes andere mitgelieferte Rahmenwerk in den Workspace. Siehe [COBIT 5](/de/frameworks/cobit-5).

## Katalog der Rahmenwerke

| Rahmenwerk | ID für `regimes_active` | Herausgeber | Kontrollen | Demo-Variante (Kontrollen) |
|---|---|---|---|---|
| [10 Säulen sicherer KI-Systeme](/de/frameworks/ai-10-pillars) | `AI_10_PILLARS` | Alok Sharan (Konzept) | 11 | `AI_10_PILLARS_DEMO` (11) |
| [BSI C5:2020](/de/frameworks/bsi-c5) | `BSI_C5` | BSI | 62 | keine |
| [BSI IT-Grundschutz-Kompendium 2023](/de/frameworks/bsi-grundschutz-2023) | `BSI_GRUNDSCHUTZ_2023` | BSI | 105 | `BSI_GRUNDSCHUTZ_2023_DEMO` (11) |
| [BSI Grundschutz++](/de/frameworks/bsi-grundschutz-plus-plus) | `BSI_GRUNDSCHUTZ_PP` | BSI | 1000 | keine |
| [COBIT 5](/de/frameworks/cobit-5) | `COBIT_5` | ISACA | 37 | keine |
| [Verordnung über die digitale operationale Resilienz (DORA)](/de/frameworks/dora) | `DORA` | Europäische Union (Verordnung 2022/2554) | 31 | `DORA_DEMO` (12) |
| [Cloud-Souveränitätsrahmen der Europäischen Kommission v1.2.1](/de/frameworks/ec-csf) | `EC_CSF` | Europäische Kommission (DIGIT) | 34 | keine |
| [KI-Verordnung der EU](/de/frameworks/eu-ai-act) | `EU_AI_ACT` | Europäische Union (Verordnung 2024/1689) | 37 | keine |
| [Cyberresilienzverordnung der EU](/de/frameworks/eu-cra) | `EU_CRA` | Europäische Union (Verordnung 2024/2847) | 35 | keine |
| [EU-Zertifizierungsschema für Cloud-Dienste (EUCS)](/de/frameworks/eucs) | `EUCS` | ENISA | 66 | keine |
| [Datenschutz-Grundverordnung (DSGVO)](/de/frameworks/gdpr) | `GDPR` | Europäisches Parlament und Rat (Verordnung 2016/679) | 53 | `GDPR_DEMO` (11) |
| [ISO/IEC 27001:2022](/de/frameworks/iso-27001) | `ISO_27001` | ISO/IEC | 93 | `ISO_27001_DEMO` (12) |
| [KRITIS-DE](/de/frameworks/kritis-de) | `KRITIS_DE` | BSI | 40 | keine |
| [Rahmenwerk zur LLM-Auswahl](/de/frameworks/llm-selection) | `LLM_SELECTION` | SWAO Development Team | 34 | keine |
| [NCA Cloud Cybersecurity Controls: CSP](/de/frameworks/nca-ccc-2-2024-csp) | `NCA_CCC_CSP` | National Cybersecurity Authority, Saudi-Arabien | 37 | keine |
| [NCA Cloud Cybersecurity Controls: CST](/de/frameworks/nca-ccc-2-2024-cst) | `NCA_CCC_CST` | National Cybersecurity Authority, Saudi-Arabien | 18 | keine |
| [NCA Essential Cybersecurity Controls](/de/frameworks/nca-ecc-2-2024) | `NCA_ECC` | National Cybersecurity Authority, Saudi-Arabien | 28 | `NCA_ECC_DEMO` (20) |
| [NIS2-Richtlinie](/de/frameworks/nis2) | `NIS2` | Europäische Union (Richtlinie 2022/2555) | 46 | keine |
| [HIPAA Security Rule (NIST SP 800-66r2)](/de/frameworks/nist-sp-800-66r2-hipaa) | `NIST_SP_800_66R2` | U.S. Department of Health and Human Services | 49 | `NIST_SP_800_66R2_DEMO` (12), `NIST_HIPAA_DEMO` (12) |
| [OpenSSF Scorecard](/de/frameworks/openssf-scorecard) | `OPENSSF_SCORECARD` | Open Source Security Foundation | 17 | keine |
| [PCI DSS v4.0](/de/frameworks/pci-dss) | `PCI_DSS` | PCI Security Standards Council | 5 | keine |
| [SAMA Cyber Security Framework](/de/frameworks/sama-csf-v1) | `SAMA_CSF` | Saudi Arabian Monetary Authority (SAMA) | 30 | keine |
| [SecNumCloud v3.2](/de/frameworks/secnumcloud) | `SECNUMCLOUD` | ANSSI | 59 | keine |
| [SOC 2 Trust Services Criteria](/de/frameworks/soc-2) | `SOC_2` | AICPA | 64 | `SOC_2_DEMO` (12) |
| [SWAO Application Portfolio Management](/de/frameworks/swao-apm) | `SWAO_APM` | SWAO Development Team | 72 | keine |

Die Anzahl der Kontrollen stammt aus der jeweiligen `controls.yaml`. `PCI_DSS` ist ein Einstiegskatalog mit 5 Kontrollen. `SWAO_APM` nutzt die [Service-Portfolio-Bewertung](/de/service-assessment/), `LLM_SELECTION` die [LLM-Bewertung](/de/assessment/llm).

## Demo-Varianten

Demo-Varianten (`*_DEMO`) enthalten 11 bis 20 repräsentative Kontrollen ihres Rahmenwerks. Sie sind für Workshops, Schulungen und Live-Präsentationen gedacht, bei denen ein vollständiger Katalog einen Lauf unnötig verlängern würde. Verwenden Sie eine Demo-Variante nicht für eine formale Gap-Analyse.

## Wichtige Hinweise

- SWAO automatisiert die Sammlung von Nachweisen und eine erste Compliance-Bewertung. Es ersetzt weder ein Audit noch eine Zertifizierung oder eine Rechtsberatung.
- Kontrollen, die organisatorische oder Audit-Nachweise erfordern, bleiben häufig UNKNOWN, bis eine Analystin oder ein Analyst Dokumente in den Ingestion-Ordnern der App bereitstellt.
