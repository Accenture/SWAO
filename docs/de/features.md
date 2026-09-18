# Funktionen & Editionen

SWAO ist in drei Editionen erhältlich. Alle Editionen teilen dieselbe Kern-Engine und
erzeugen denselben audit-konformen Output. Die Unterschiede liegen in erweiterter
Visualisierung, Portfolio-Umfang und branchenspezifischen Inhalten.

> **Bewegen Sie die Maus über einen Funktionsnamen**, um eine verständliche Beschreibung zu sehen.

---

## Bewertungstypen

SWAO unterstützt drei Bewertungsflächen, alle jetzt verfügbar.

| Bewertungstyp | Status | Was er abdeckt |
|---|---|---|
| <FeatureTooltip tip="Analysiert Anwendungsquellcode über bis zu 14 Durchläufe - Inventar, SBOM, Datenklassifizierung, Compliance-Bewertung, 7R-Migrationssynthese und mehr.">Anwendungsbewertung</FeatureTooltip> | Verfügbar | Cloud-Anwendungsquellcode |
| <FeatureTooltip tip="Vergleicht Ihre Cloud-Landing-Zone mit Souveränitätsanforderungen und erstellt einen Fit/Gap-Bericht.">Landing-Zone-Bewertung</FeatureTooltip> | Verfügbar | Cloud-Infrastrukturkonfiguration |
| <FeatureTooltip tip="Verbindet sich mit mehreren LLM-Anbietern und bewertet jeden nach Souveränitätskriterien: Datenresidenz, Transparenz, Sicherheit, kulturelle Eignung.">LLM-Bewertung</FeatureTooltip> | Verfügbar | KI-Modell-Souveränitäts-Benchmarking |

---

## Editionsvergleich

| Funktion | Community | Consultant | Enterprise |
|---|---|---|---|
| **Bewertung** | | | |
| <FeatureTooltip tip="Führt bis zu 14 Analysedurchläufe durch und erzeugt Signale, Berichte und ein BI-Exportpaket.">Anwendungsbewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Vergleicht Ihre Landing-Zone mit Souveränitätsanforderungen.">Landing-Zone-Bewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Bewertet mehrere LLM-Anbieter nach Souveränitätskriterien.">LLM-Bewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Ein zweiter LLM-Agent hinterfragt unabhaengig jede Erkenntnis; deckt Erkenntnisse mit geringer Konfidenz auf. Enterprise-Edition.">Adversarielle Challenge-Review</FeatureTooltip> | - | - | Ja |
| **Compliance-Rahmenwerke** | | | |
| <FeatureTooltip tip="11 Rahmenwerke in jeder Edition: DSGVO, KI 10 Säulen, BSI C5, BSI IT-Grundschutz 2023, HIPAA / NIST SP 800-66r2, LLM-Auswahl, NCA CCC 2024 (CSP), NCA CCC 2024 (CST), NCA ECC 2024, PCI-DSS v4, SAMA CSF v1. Download über GitHub.">Community-Rahmenwerk-Bibliothek (11 Rahmenwerke)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Eigene Compliance-Rahmenwerke als YAML-Datei hinzufügen - kein Programmieren erforderlich.">Eigene Rahmenwerke (YAML)</FeatureTooltip> | Ja | Ja | Ja |
| **Landing-Zone-Kataloge** | | | |
| <FeatureTooltip tip="10 Cloud-Anbieter enthalten: STACKIT, OTC (T-Systems), Microsoft Azure EU, Azure Local, AWS eu-central-1, AWS ESC, AWS ISO-E, Google Cloud EU, Delos Cloud, Oracle Cloud (OCI). Jeder Eintrag enthaelt Bereitschaftspruefungen (Blocker, Warnungen, Info-Punkte) abgestimmt auf das Service-Portfolio und die Souveränitätsnachweise des Anbieters.">Integrierter LZ-Katalog (10 Anbieter)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Eigenen Cloud- oder Privatcloud-Anbieter als YAML-Eintrag hinzufügen. Laeuft sofort neben den integrierten Eintraegen.">Eigene LZ-Katalog-Eintraege (YAML)</FeatureTooltip> | Ja | Ja | Ja |
| **KI & LLM** | | | |
| <FeatureTooltip tip="Anthropic Claude, OpenAI GPT, Amazon Bedrock Gateway oder selbst gehostetes Ollama-Modell. Das LLM erstellt verständliche Begründungen für jedes Signal.">Eigenes LLM mitbringen (inkl. Bedrock Gateway)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Erweiterte Modellverwaltung und benutzerdefinierte Konfiguration - Professional-Services-Engagement.">Eigene Modellkonfiguration</FeatureTooltip> | - | PS-Gebühr | Ja |
| **Ausgabe & Veröffentlichung** | | | |
| <FeatureTooltip tip="Text-, YAML-, JSON- und Markdown-Berichte nach jeder Bewertung. In jedem Editor öffenbar.">Text- und Markdown-Berichte</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Sternschema-CSV-Paket (17 Tabellen) plus NDJSON und XLSX. Für jedes BI-Tool geeignet.">BI-Exportpaket (CSV / NDJSON / XLSX)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Eigenständige HTML-Datei mit Volltextsuche, Personenansichten und Evidenzgalerie. Offline nutzbar.">HTML-Veröffentlichung</FeatureTooltip> | - | Ja | Ja |
| <FeatureTooltip tip="Interaktiver Browser-Editor zum Annotieren und Anpassen des HTML-Evidenzberichts. Ausfuehren mit: swao publish --edit">HTML-Editor (interaktiv, swao publish --edit)</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="PDF-Rendering des vollständigen Bewertungsberichts. Erfordert Playwright.">PDF-Bericht</FeatureTooltip> | - | Ja | Ja |
| <FeatureTooltip tip="Vorgefertigte Power BI Desktop-Vorlage für Einzelanwendungsbewertungen. Sechs Seiten.">PowerBI-Einzelanwendungs-Dashboard</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="Vorgefertigte Power BI Desktop-Vorlage für Multi-App-Portfolio-Bewertungen.">PowerBI-Portfolio-Dashboard</FeatureTooltip> | - | - | Roadmap |
| **Integration** | | | |
| <FeatureTooltip tip="Kontext aus CMDB, ServiceNow, FinOps-Berichten und Architekturdokumenten laden.">Kontexteinlese (CMDB / Dokumente)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="SWAO-Bewertungstools direkt Claude AI über MCP bereitstellen. Fragen in natürlicher Sprache stellen.">MCP-Integration (Claude AI)</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="Konversationelle KI-Oberfläche in SWAO. Fragen zu Bewertungsergebnissen stellen, Erkenntnisse erkunden. Verfügbar ab v1.1.0.">SWAO Chat</FeatureTooltip> | - | - | Ja |
| **Portfolio** | | | |
| <FeatureTooltip tip="Mehrere Anwendungen in einem Workspace bewerten. Aggregiertes Risikoregister und Compliance-Matrix.">Multi-App-Portfolio-Workspace</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="Branchenspezifische Migrationsrunbook-Vorlagen und Führungsbriefing-Formate.">Branchenspezifische Engagement-Vorlagen</FeatureTooltip> | - | - | Ja |
| **Erweiterte Auslieferung** | | | |
| <FeatureTooltip tip="Erzeugt Terraform-Modul-Stubs fuer die empfohlene Landing Zone, vorbefuellt aus der Landing-Zone-Bereitschaftsbewertung.">Terraform-LZ-Modul-Stubs (aus LZ-Bewertungsausgabe)</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="meshStack Developer Portal Building Block-Deployment und Cloud-Management-Portal-Integration fuer Self-Service-Provisionierungs-Workflows.">meshStack Developer Portal-Integration</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="Ersetzen oder erweitern Sie den integrierten Landing-Zone-Katalog durch den Cloud-Plattform-Konfigurationsstandard Ihrer Organisation.">Eigener LZ-Katalog-Standard (organisationsweit)</FeatureTooltip> | - | - | Roadmap |

---

## Landing-Zone-Kataloge

SWAO wird mit einem kuratierten Katalog von Cloud-Anbietern ausgeliefert. Waehrend einer
Landing-Zone-Bewertung waehlt SWAO den passenden Anbieter-Eintrag aus und validiert
Bereitschaftspruefungen - Blocker, Warnungen und Info-Punkte - gegen die Signale Ihres
Workloads und das Service-Portfolio der Ziel-Cloud.

### Enthaltene Anbieter

| Anbieter | Typ | Souveraenitaet |
|---|---|---|
| STACKIT (Schwarz Group) | Dedizierte souveraene Cloud | DE / EU |
| Open Telekom Cloud (T-Systems) | Dedizierte souveraene Cloud | DE / EU |
| Microsoft Azure (EU-Regionen) | Hyperscaler EU-Region | EU |
| Azure Local (vor Ort) | Souveraene On-Premises-Cloud | Kundenkontrolle |
| AWS eu-central-1 | Hyperscaler EU-Region | EU |
| AWS ESC (European Sovereign Cloud) | Hyperscaler souveraen | EU |
| AWS ISO-E | Hyperscaler souveraener Sektor | EU |
| Google Cloud (EU-Regionen) | Hyperscaler EU-Region | EU |
| Delos Cloud (SAP / Arvato) | Dedizierte souveraene Cloud | DE |
| Oracle Cloud Infrastructure (OCI) | Hyperscaler EU / souveraen | EU |

### Anpassbar

Der Katalog ist eine einfache YAML-Datei. Fuegen Sie Ihren eigenen Anbieter hinzu -
Privatcloud, verwaltetes Hosting oder interne Plattform - mit demselben Prüfschema wie
die integrierten Anbieter. SWAO liest Ihren Eintrag sofort; keine Neukompilierung erforderlich.

Kataloge herunterladen:
[github.com/Accenture/SWAO/tree/main/lz-catalogues](https://github.com/Accenture/SWAO/tree/main/lz-catalogues)

---

## Community-Rahmenwerke

Rahmenwerke direkt von GitHub herunterladen und im Workspace unter
`catalogs/community/<slug>/` ablegen:
[github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

---

## LLM-Gateway-Konfigurationen

Vorgefertigte LLM-Gateway-YAML-Dateien für Anthropic, OpenAI, Bedrock, Ollama,
OpenRouter und vLLM zum Download:
[github.com/Accenture/SWAO/tree/main/llm-gateway](https://github.com/Accenture/SWAO/tree/main/llm-gateway)

---

## Lizenz

- **Community** - Apache 2.0. Kostenlos nutzbar, veränderbar und verteilbar. Beiträge willkommen. Community-Rahmenwerke und LZ-Kataloge in jeder Edition enthalten.
- **Consultant** - Proprietär (SWAO Premium Edition). Enthält HTML-Veröffentlichung, PDF-Bericht und erweiterte Ausgabeformate.
- **Enterprise** - Proprietär (SWAO Premium Edition). Enthält Portfolio-Dashboard, MCP-Integration, SWAO Chat, Sector-Engagement-Vorlagen und weitere exklusive Funktionen.

Fragen oder Lizenzanfragen: Starten Sie eine [GitHub-Diskussion](https://github.com/Accenture/SWAO/discussions) oder [eröffnen Sie ein Issue](https://github.com/Accenture/SWAO/issues).
