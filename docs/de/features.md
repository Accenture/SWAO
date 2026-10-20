# Funktionen & Editionen

SWAO ist in drei Editionen erhältlich. Alle Editionen teilen dieselbe Kern-Engine und
erzeugen denselben audit-konformen Output. Die Unterschiede liegen in erweiterter
Visualisierung, Portfolio-Umfang und branchenspezifischen Inhalten.

> **Bewegen Sie die Maus über einen Funktionsnamen**, um eine verständliche Beschreibung zu sehen.

---

## Bewertungstypen

SWAO unterstützt vier Bewertungstypen, alle jetzt verfügbar.

| Bewertungstyp | Status | Was er abdeckt |
|---|---|---|
| <FeatureTooltip tip="Analysiert Anwendungsquellcode über 13 Standard-Passes - Inventar, SBOM, Datenklassifizierung, Compliance-Bewertung, 7R-Migrationssynthese und mehr.">Anwendungsbewertung</FeatureTooltip> | Verfügbar | Cloud-Anwendungsquellcode |
| <FeatureTooltip tip="Vergleicht Ihre Cloud-Landing-Zone mit Souveränitätsanforderungen und erstellt einen Fit/Gap-Bericht.">Landing-Zone-Bewertung</FeatureTooltip> | Verfügbar | Cloud-Infrastrukturkonfiguration |
| <FeatureTooltip tip="Verbindet sich mit mehreren LLM-Anbietern und bewertet jeden nach Souveränitätskriterien: Datenresidenz, Transparenz, Sicherheit, kulturelle Eignung.">LLM-Bewertung</FeatureTooltip> | Verfügbar | KI-Modell-Souveränitäts-Benchmarking |
| <FeatureTooltip tip="Bewertet gekaufte, gemietete und betriebene Anwendungen (Drittanbieter-Software, COTS, SaaS, Legacy-Server) aus einer Tabellen-Erfassung ohne Quellcode. Recherchiert Schwachstellen und Lebenszyklusende, bewertet elf Portfolio-Domänen und empfiehlt eine TIME-Einstufung und Migrationswellen.">Service Portfolio Assessment</FeatureTooltip> | Verfügbar | Portfolio aus Drittanbieter-, COTS- und SaaS-Anwendungen |

---

## Editionsvergleich

| Funktion | Community | Consultant | Enterprise |
|---|---|---|---|
| **Bewertung** | | | |
| <FeatureTooltip tip="Führt 13 Standard-Analyse-Passes durch und erzeugt Signale, Berichte und ein BI-Exportpaket.">Anwendungsbewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Vergleicht Ihre Landing-Zone mit Souveränitätsanforderungen.">Landing-Zone-Bewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Bewertet mehrere LLM-Anbieter nach Souveränitätskriterien.">LLM-Bewertung</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Bewertet Drittanbieter-, COTS- und SaaS-Anwendungen aus einer Excel-Erfassung. Die HTML-Veröffentlichung erfordert Consultant, Portfolio-Arbeitsmappe und Sternschema erfordern Enterprise.">Service Portfolio Assessment</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Recherchiert Schwachstellen (CVE) und Lebenszyklusende jedes Service; mit konfiguriertem LLM auch Herstellerprofil, Zertifizierungen, Datenresidenz und Sicherheitsvorfälle. Ausführen mit: swao service research">Service-Recherche (inkl. LLM-Recherche)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Ein zweiter LLM-Agent hinterfragt unabhängig jede Erkenntnis; deckt Erkenntnisse mit geringer Konfidenz auf. Enterprise-Edition.">Adversarielle Challenge-Review</FeatureTooltip> | - | - | Ja |
| **Compliance-Rahmenwerke** | | | |
| <FeatureTooltip tip="21 Rahmenwerke im öffentlichen Verzeichnis community-frameworks: 10 Pillars of Secure AI Systems, BSI C5, BSI IT-Grundschutz 2023, COBIT 5, EC Cloud Sovereignty Framework, EU AI Act, EU Cyber Resilience Act, EUCS, DSGVO, KRITIS-DE, LLM-Auswahl, NCA CCC 2024 (CSP), NCA CCC 2024 (CST), NCA ECC 2024, NIS2, HIPAA / NIST SP 800-66r2, OpenSSF Scorecard, PCI-DSS v4, SAMA CSF v1, SecNumCloud, SWAO APM. In den Workspace kopieren mit swao framework install oder Download über GitHub.">Community-Rahmenwerk-Bibliothek (21 Rahmenwerke)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Eigene Compliance-Rahmenwerke als YAML-Datei hinzufügen - kein Programmieren erforderlich.">Eigene Rahmenwerke (YAML)</FeatureTooltip> | Ja | Ja | Ja |
| **Landing-Zone-Kataloge** | | | |
| <FeatureTooltip tip="10 Cloud-Anbieter enthalten: STACKIT, OTC (T-Systems), Microsoft Azure EU, Azure Local, AWS eu-central-1, AWS ESC, AWS ISO-E, Google Cloud EU, Delos Cloud, Oracle Cloud (OCI). Jeder Eintrag enthält Bereitschaftsprüfungen (Blocker, Warnungen, Info-Punkte) abgestimmt auf das Service-Portfolio und die Souveränitätsnachweise des Anbieters.">Integrierter LZ-Katalog (10 Anbieter)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Aktualisiert den Landing-Zone-Servicekatalog eines Cloud-Anbieters (Services, Regionen, VM-Preise) aus den öffentlichen Quellen des Anbieters vor einem Engagement. Ausführen mit: swao lz catalogue update">LZ-Katalog-Aktualisierung</FeatureTooltip> | - | Ja | Ja |
| <FeatureTooltip tip="Einen integrierten Anbieterkatalog mit swao lz catalogue copy in den Workspace kopieren oder mit swao lz catalogue new einen neuen Anbieter anlegen und die JSON-Datei bearbeiten. Workspace-Kopien werden anstelle der integrierten Einträge verwendet.">Eigene LZ-Katalog-Einträge (JSON)</FeatureTooltip> | Ja | Ja | Ja |
| **KI & LLM** | | | |
| <FeatureTooltip tip="Anthropic Claude, OpenAI GPT, Amazon Bedrock Gateway oder selbst gehostetes Ollama-Modell. Das LLM erstellt verständliche Begründungen für jedes Signal.">Eigenes LLM mitbringen (inkl. Bedrock Gateway)</FeatureTooltip> | Ja | Ja | Ja |
| **Ausgabe & Veröffentlichung** | | | |
| <FeatureTooltip tip="Text-, YAML-, JSON- und Markdown-Berichte nach jeder Bewertung. In jedem Editor zu öffnen.">Text- und Markdown-Berichte</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Sternschema-CSV-Paket (17 Tabellen) plus NDJSON und XLSX. Für jedes BI-Tool geeignet.">BI-Exportpaket (CSV / NDJSON / XLSX)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="Eigenständige HTML-Datei mit Volltextsuche, Personenansichten und Evidenzgalerie. Offline nutzbar. Ausführen mit: swao publish --app oder swao report --format html">HTML-Veröffentlichung</FeatureTooltip> | - | Ja | Ja |
| <FeatureTooltip tip="Interaktiver Browser-Editor zum Annotieren und Anpassen des HTML-Evidenzberichts. Ausführen mit: swao publish --edit">HTML-Editor (interaktiv, swao publish --edit)</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="PDF-Rendering des vollständigen Bewertungsberichts. Erfordert Playwright.">PDF-Bericht</FeatureTooltip> | - | Ja | Ja |
| <FeatureTooltip tip="Vorgefertigte Power BI Desktop-Vorlage (.pbit) für Einzelanwendungsbewertungen, von swao export neben dem Sternschema abgelegt. Sechs Seiten.">PowerBI-Einzelanwendungs-Dashboard</FeatureTooltip> | - | Ja | Ja |
| <FeatureTooltip tip="Vorgefertigte Power BI Desktop-Vorlage für Multi-App-Portfolio-Bewertungen. Benötigt den Portfolio-BI-Export (swao export --portfolio, Enterprise).">PowerBI-Portfolio-Dashboard</FeatureTooltip> | - | - | Ja |
| **Integration** | | | |
| <FeatureTooltip tip="Kontext aus CMDB, ServiceNow, FinOps-Berichten und Architekturdokumenten laden.">Kontexteinlese (CMDB / Dokumente)</FeatureTooltip> | Ja | Ja | Ja |
| <FeatureTooltip tip="SWAO-Bewertungstools direkt Claude AI über MCP bereitstellen. Fragen in natürlicher Sprache stellen.">MCP-Integration (Claude AI)</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="Konversationelle KI-Oberfläche in SWAO. Fragen zu Bewertungsergebnissen stellen, Erkenntnisse erkunden. Verfügbar ab v1.1.0.">SWAO Chat</FeatureTooltip> | - | - | Ja |
| **Portfolio** | | | |
| <FeatureTooltip tip="Mehrere Anwendungen in einem Workspace bewerten. Aggregiertes Risikoregister und Compliance-Matrix. Ausführen mit: swao assess --portfolio, swao report --portfolio, swao export --portfolio">Multi-App-Portfolio-Workspace</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="Portfolio-Arbeitsmappe und BI-Paket einer Service Portfolio Assessment. Ausführen mit: swao service export">Service-Portfolio-Export</FeatureTooltip> | - | - | Ja |
| <FeatureTooltip tip="Branchenspezifische Migrationsrunbook-Vorlagen und Führungsbriefing-Formate.">Branchenspezifische Engagement-Vorlagen</FeatureTooltip> | - | - | Ja |
| **Erweiterte Auslieferung** | | | |
| <FeatureTooltip tip="Erzeugt Terraform-Modul-Stubs für die empfohlene Landing Zone, vorbefüllt aus der Landing-Zone-Bereitschaftsbewertung.">Terraform-LZ-Modul-Stubs (aus LZ-Bewertungsausgabe)</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="meshStack Developer Portal Building Block-Deployment und Cloud-Management-Portal-Integration für Self-Service-Provisionierungs-Workflows.">meshStack Developer Portal-Integration</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="Ersetzen oder erweitern Sie den integrierten Landing-Zone-Katalog durch den Cloud-Plattform-Konfigurationsstandard Ihrer Organisation.">Eigener LZ-Katalog-Standard (organisationsweit)</FeatureTooltip> | - | - | Roadmap |

---

## Landing-Zone-Kataloge

SWAO wird mit einem kuratierten Katalog von Cloud-Anbietern ausgeliefert. Während einer
Landing-Zone-Bewertung wählt SWAO den passenden Anbieter-Eintrag aus und validiert
Bereitschaftsprüfungen - Blocker, Warnungen und Info-Punkte - gegen die Signale Ihres
Workloads und das Service-Portfolio der Ziel-Cloud.

### Enthaltene Anbieter

| Anbieter | Typ | Souveränität |
|---|---|---|
| STACKIT (Schwarz Group) | Dedizierte souveräne Cloud | DE / EU |
| Open Telekom Cloud (T-Systems) | Dedizierte souveräne Cloud | DE / EU |
| Microsoft Azure (EU-Regionen) | Hyperscaler EU-Region | EU |
| Azure Local (vor Ort) | Souveräne On-Premises-Cloud | Kundenkontrolle |
| AWS eu-central-1 | Hyperscaler EU-Region | EU |
| AWS ESC (European Sovereign Cloud) | Hyperscaler souverän | EU |
| AWS ISO-E | Hyperscaler souveräner Sektor | EU |
| Google Cloud (EU-Regionen) | Hyperscaler EU-Region | EU |
| Delos Cloud (SAP / Arvato) | Dedizierte souveräne Cloud | DE |
| Oracle Cloud Infrastructure (OCI) | Hyperscaler EU / souverän | EU |

### Anpassbar

Jeder Anbieterkatalog ist eine einfache JSON-Datei. `swao lz catalogue copy <provider>`
kopiert einen integrierten Katalog zur Bearbeitung in den Workspace, und
`swao lz catalogue new <provider>` legt einen leeren Katalog für Ihren eigenen Anbieter an:
Privatcloud, verwaltetes Hosting oder interne Plattform. SWAO verwendet die Workspace-Kopie
beim nächsten Lauf; keine Neukompilierung erforderlich.

Kataloge herunterladen:
[github.com/Accenture/SWAO/tree/main/lz-catalogues](https://github.com/Accenture/SWAO/tree/main/lz-catalogues)

---

## Community-Rahmenwerke

SWAO bewertet gegen die Rahmenwerke im Workspace unter `wsp/inputs/catalogs/community/<ordner>/`.
Ein mitgeliefertes Rahmenwerk mit `swao framework install <ID>` dorthin kopieren oder
Rahmenwerke direkt von GitHub herunterladen und dort ablegen:
[github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

---

## LLM-Gateway-Konfigurationen

Vorgefertigte LLM-Gateway-YAML-Dateien für Anthropic, OpenAI, Bedrock, Ollama,
OpenRouter und vLLM zum Download:
[github.com/Accenture/SWAO/tree/main/llm-gateway](https://github.com/Accenture/SWAO/tree/main/llm-gateway)

---

## Lizenz

- **Community** - Apache 2.0. Kostenlos nutzbar, veränderbar und verteilbar. Beiträge willkommen. Community-Rahmenwerke und LZ-Kataloge in jeder Edition enthalten.
- **Consultant** - Proprietär (SWAO Premium Edition). Enthält HTML-Veröffentlichung, PDF-Bericht, Power-BI-Dashboard-Vorlagen und LZ-Katalog-Aktualisierung.
- **Enterprise** - Proprietär (SWAO Premium Edition). Enthält Portfolio-Bewertung, -Bericht und -BI-Export, Service-Portfolio-Export, adversarielle Challenge-Review, HTML-Editor, MCP-Integration, SWAO Chat, Sector-Engagement-Vorlagen und die Roadmap-Funktionen (Terraform-Modul-Stubs, meshStack-Integration).

Fragen oder Lizenzanfragen: Starten Sie eine [GitHub-Diskussion](https://github.com/Accenture/SWAO/discussions) oder [eröffnen Sie ein Issue](https://github.com/Accenture/SWAO/issues).
