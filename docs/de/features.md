=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Funktionen und Editionen

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Funktionen & Editionen

SWAO ist in drei Editionen erhältlich. Alle Editionen teilen dieselbe Kern-Engine und
erzeugen denselben audit-konformen Output. Die Unterschiede liegen in erweiterter
Visualisierung, Portfolio-Umfang und branchenspezifischen Inhalten.

> **Bewegen Sie die Maus über einen Funktionsnamen**, um eine verständliche Beschreibung zu sehen.

---

## Bewertungstypen

SWAO unterstützt fünf Bewertungsflächen. Drei sind jetzt verfügbar; zwei sind auf der Roadmap.

| Bewertungstyp | Status | Was er abdeckt |
|---|---|---|
| <FeatureTooltip tip="Analysiert Anwendungsquellcode über bis zu 14 Durchläufe -- Inventar, SBOM, Datenklassifizierung, Compliance-Bewertung, 7R-Migrationssynthese und mehr.">Anwendungsbewertung</FeatureTooltip> | Verfügbar | Cloud-Anwendungsquellcode |
| <FeatureTooltip tip="Vergleicht Ihre Cloud-Landing-Zone mit Souveränitätsanforderungen und erstellt einen Fit/Gap-Bericht.">Landing-Zone-Bewertung</FeatureTooltip> | Verfügbar | Cloud-Infrastrukturkonfiguration |
| <FeatureTooltip tip="Verbindet sich mit mehreren LLM-Anbietern und bewertet jeden nach Souveränitätskriterien: Datenresidenz, Transparenz, Sicherheit, kulturelle Eignung.">LLM-Bewertung</FeatureTooltip> | Verfügbar | KI-Modell-Souveränitäts-Benchmarking |
| <FeatureTooltip tip="Consultant-geführt: strukturierte Checklisten, Dokumentenprüfung, Vor-Ort-Erkenntnisse, deterministisches Compliance-Urteil. Kein Quellcode erforderlich.">Audit-Bewertung</FeatureTooltip> | Roadmap | Menschgeführtes Compliance-Audit |
| <FeatureTooltip tip="Kombiniert Anwendungsbewertungs-Durchläufe mit Audit-Evidenz für das präziseste Compliance-Bild.">Hybrid-Bewertung</FeatureTooltip> | Roadmap | Kombinierte Quell- und menschliche Evidenz |

---

## Editionsvergleich

| Funktion | Community | Consultant | Enterprise |
|---|---|---|---|
| **Bewertung** | | | |
| <FeatureTooltip tip="Führt bis zu 14 Analysedurchläufe durch und erzeugt Signale, Berichte und ein BI-Exportpaket.">Anwendungsbewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Vergleicht Ihre Landing-Zone mit Souveränitätsanforderungen.">Landing-Zone-Bewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Menschgeführtes Audit mit strukturierten Checklisten. Kein LLM erforderlich.">Audit-Bewertung</FeatureTooltip> | Roadmap | Roadmap | Roadmap |
| <FeatureTooltip tip="Bewertet mehrere LLM-Anbieter nach Souveränitätskriterien.">LLM-Bewertung</FeatureTooltip> | Ja | Ja | Ja |
| **Compliance-Rahmenwerke** | | | |
| <FeatureTooltip tip="14 Rahmenwerke in jeder Edition: DSGVO, KI 10 Säulen, BSI C5, BSI IT-Grundschutz 2023, DORA, HIPAA / NIST SP 800-66r2, ISO 27001:2022, LLM-Auswahl, NCA CCC 2024 (CSP), NCA CCC 2024 (CST), NCA ECC 2024, PCI-DSS v4, SAMA CSF v1, SOC 2 Typ II. Installation mit: swao framework install.">Community-Rahmenwerk-Bibliothek (14 Rahmenwerke)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Eigene Compliance-Rahmenwerke als YAML-Datei hinzufügen -- kein Programmieren erforderlich.">Eigene Rahmenwerke (YAML)</FeatureTooltip> | Ja | Ja | Ja |
| **KI & LLM** | | | |
| <FeatureTooltip tip="Anthropic Claude, OpenAI GPT oder selbst gehostetes Ollama-Modell. Das LLM erstellt verständliche Begründungen für jedes Signal.">Eigenes LLM mitbringen</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Erweiterte Modellverwaltung und benutzerdefinierte Konfiguration -- Professional-Services-Engagement.">Eigene Modellkonfiguration</FeatureTooltip> | -- | PS-Gebühr | Ja |
| **Ausgabe & Veröffentlichung** | | | |
| <FeatureTooltip tip="Eigenständige HTML-Datei mit Volltextsuche, Personenansichten und Evidenzgalerie. Offline nutzbar.">HTML-Veröffentlichung</FeatureTooltip> | -- | Ja | Ja |
| <FeatureTooltip tip="Text-, YAML-, JSON- und Markdown-Berichte nach jeder Bewertung. In jedem Editor öffenbar.">Text- und Markdown-Berichte</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Sternschema-CSV-Paket (17 Tabellen) plus NDJSON und XLSX. Für jedes BI-Tool geeignet.">BI-Exportpaket (CSV / NDJSON / XLSX)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="PDF-Rendering des vollständigen Bewertungsberichts. Erfordert Playwright.">PDF-Bericht</FeatureTooltip> | -- | Ja | Ja |
| <FeatureTooltip tip="Vorgefertigte Power BI Desktop-Vorlage für Einzelanwendungsbewertungen. Sechs Seiten.">PowerBI-Einzelanwendungs-Dashboard</FeatureTooltip> | -- | Ja | Ja |
| <FeatureTooltip tip="Vorgefertigte Power BI Desktop-Vorlage für Multi-App-Portfolio-Bewertungen.">PowerBI-Portfolio-Dashboard</FeatureTooltip> | -- | -- | Ja |
| **Integration** | | | |
| <FeatureTooltip tip="SWAO-Bewertungstools direkt Claude AI über MCP bereitstellen. Fragen in natürlicher Sprache stellen.">MCP-Integration (Claude AI)</FeatureTooltip> | -- | -- | Ja |
| <FeatureTooltip tip="Kontext aus CMDB, ServiceNow, FinOps-Berichten und Architekturdokumenten laden.">Kontexteinlese (CMDB / Dokumente)</FeatureTooltip> | Ja | Ja | Ja |
| **Portfolio** | | | |
| <FeatureTooltip tip="Mehrere Anwendungen in einem Workspace bewerten. Aggregiertes Risikoregister und Compliance-Matrix.">Multi-App-Portfolio-Workspace</FeatureTooltip> | -- | Ja | Ja |
| <FeatureTooltip tip="Branchenspezifische Migrationsrunbook-Vorlagen und Führungsbriefing-Formate.">Branchenspezifische Engagement-Vorlagen</FeatureTooltip> | -- | -- | Ja |

---

## Lizenz

- **Community** -- Apache 2.0. Kostenlos nutzbar, veränderbar und verteilbar. Beiträge willkommen.
- **Consultant** -- Proprietär. Kontaktieren Sie uns, um Zugang für Ihr Engagement anzufordern.
- **Enterprise** -- Proprietär. Enthält vollständige Compliance- und benutzerdefinierte Bibliothek, Portfolio-Dashboards und Brancheninhalte.

Fragen oder Lizenzanfragen: Starten Sie eine [GitHub-Diskussion](https://github.com/Accenture/SWAO/discussions) oder [eröffnen Sie ein Issue](https://github.com/Accenture/SWAO/issues).
