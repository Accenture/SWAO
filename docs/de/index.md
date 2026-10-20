---
layout: home

hero:
  name: SWAO
  text: Sovereign Workload Assessment and Onboarding
  tagline: Audit-konforme Cloud-Workload-Bewertungen in einem einzigen Befehl. Keine Telemetrie. Kein Call-home. Ihre Daten bleiben auf Ihrem Rechner.
  image:
    src: /swao-icon-512.png
    alt: SWAO-Logo
  actions:
    - theme: brand
      text: Schnellstart (5 Min.)
      link: /de/quick-start
    - theme: alt
      text: Funktionen & Editionen
      link: /de/features
    - theme: alt
      text: Wie es funktioniert
      link: /de/how-it-works

features:
  - title: Vier Bewertungstypen
    details: Anwendungs-, Service-Portfolio-, Landing-Zone-Katalog- und LLM-Bewertung. Jeder Bewertungstyp läuft in jeder Edition.
  - title: Eigenes LLM mitbringen
    details: Anthropic Claude, OpenAI, Ollama, oder mit `--skip-llm` starten, um LLM-Passes für vollständig offline Assessments zu überspringen. LLM-Zugriff ist in jeder Edition enthalten.
  - title: Audit-konforme Nachvollziehbarkeit
    details: Jedes Signal enthält Ergebnis, Ableitung, Bewerteridentität, Falsch-Positiv-Betrachtung und Zeitstempel. Vertretbar gegenüber externen Prüfern.
  - title: HTML-Veröffentlichung
    details: Eine eigenständige HTML-Datei mit Führungs-, Fach-, Compliance- und Prüferansichten. Funktioniert offline, in abgeschotteten Umgebungen und per E-Mail. Consultant- und Enterprise-Edition.
  - title: PowerBI-Dashboards
    details: Sternschema-Export für jedes BI-Tool in jeder Edition; vorgefertigte Power-BI-Vorlagen in der Consultant- und Enterprise-Edition.
  - title: MCP-Integration
    details: Stellen Sie Claude AI Fragen zu Ihren Bewertungsergebnissen in natürlicher Sprache über das Model Context Protocol. Enterprise-Edition.
---

<div class="swao-release-banner">

**Aktuelles Release:** Die aktuellen Binärdateien und die Release Notes finden Sie auf der [SWAO-Release-Seite auf GitHub](https://github.com/Accenture/SWAO/releases/latest).

</div>

## Was Sie erhalten

<div class="swao-outputs">
<div class="swao-output">

![SWAO-HTML-Veröffentlichung einer LLM-Bewertung für die Demo-Anwendung sovereign-health](/home/html-publication.png)

### HTML-Veröffentlichung

Eine einzige eigenständige HTML-Datei mit Führungs-, Fach-, Compliance- und Prüferansichten. Sie öffnen sie in jedem Browser, versenden sie per E-Mail oder nutzen sie offline.

<span class="swao-edition">Consultant und Enterprise</span>

[HTML veröffentlichen](/de/publish-html)

</div>
<div class="swao-output">

![SWAO-Power-BI-Bericht, Seite Risiken, für die Demo-Anwendung sovereign-health](/home/power-bi-dashboard.png)

### Power-BI-Dashboards

Vorgefertigte Power-BI-Vorlagen auf Basis des Sternschema-Exports: Übersicht, Compliance, Signale, Risiken und Prüferseiten. Das Sternschema selbst ist in jeder Edition enthalten.

<span class="swao-edition">Consultant und Enterprise</span>

[BI exportieren](/de/export-bi)

</div>
<div class="swao-output">

![Ein KI-Assistent beantwortet über den SWAO-MCP-Server eine Frage zu den DSGVO-Befunden der Demo-Anwendung sovereign-health](/home/mcp-chat.png)

### MCP und SWAO Chat

Stellen Sie Fragen zu Ihren Bewertungsergebnissen in natürlicher Sprache, aus einem KI-Assistenten über das Model Context Protocol oder im eingebauten SWAO Chat.

<span class="swao-edition">Enterprise</span>

[MCP-Server](/de/runbooks/mcp-integration)

</div>
</div>

---

## Editionen im Überblick

| | Community | Consultant | Enterprise |
|---|---|---|---|
| Alle vier Bewertungstypen, unbegrenzte Einzelanwendungsläufe | Ja | Ja | Ja |
| Eigenes LLM mitbringen oder vollständig offline arbeiten | Ja | Ja | Ja |
| Text- und Markdown-Berichte, BI-Exportpaket (Sternschema) | Ja | Ja | Ja |
| HTML-Veröffentlichung, PDF-Bericht, Power-BI-Vorlagen | - | Ja | Ja |
| Portfolio-Bewertung, -Berichte und -BI-Export | - | - | Ja |
| MCP-Server, SWAO Chat, adversariale Challenge-Prüfung | - | - | Ja |

Community steht unter Apache 2.0 und braucht keine Aktivierung. Den vollständigen Vergleich finden Sie unter [Funktionen & Editionen](/de/features).

---

## Was ist SWAO?

SWAO analysiert Cloud-Anwendungen und -Infrastruktur und erstellt einen audit-konformen
Bewertungsbericht. Es kombiniert statische Code-Analyse, LLM-gestützte Compliance-Bewertung
und Kontexteinlese aus Ihrem CMDB und Betriebsdokumenten, und liefert eine vollständige
Rückverfolgungskette von Quellevidenz bis zum Compliance-Urteil.

**Nur Dateien auf der Festplatte.** Keine Telemetrie, kein gehosteter Endpunkt, kein Call-home.
Ihr Quellcode und Ihre Bewertungsdaten verlassen Ihren Rechner nicht. Bringen Sie Ihren eigenen
LLM-Anbieter mit.

---

## Bewertungstypen

| Typ | Status | Was Sie erhalten |
|---|---|---|
| [Anwendungsbewertung](/de/assessment/application) | Verfügbar | Analyse-Passes über den Quellcode der Anwendung und ihren betrieblichen Kontext; jeder Befund ist bis zu Datei, Ableitung und Bewerter rückverfolgbar. Sie erhalten Compliance-Urteile je Control für Ihre aktiven Rahmenwerke, eine 7R-Migrationsempfehlung und eine Landing-Zone-Eignung. |
| [Service-Portfolio-Bewertung](/de/service-assessment/) | Verfügbar | Bewertet gekaufte, gemietete und betriebene Anwendungen (Drittanbieter-Software, COTS, SaaS, Legacy-Server) aus einer Tabellen-Erfassung, ohne Quellcode. Jede Anwendung erhält recherchierte Schwachstellen und Lebenszyklusende, Bewertungen in elf Portfolio-Domänen und eine TIME-Empfehlung; das Portfolio erhält Migrationswellen und Anbieterkonsolidierung. |
| [Landing-Zone-Katalogbewertung](/de/assessment/landing-zone) | Verfügbar | Prüft, ob eine oder mehrere Regionen von Cloud-Anbietern die Anwendung unter den Souveränitätsanforderungen Ihrer aktiven Rahmenwerke betreiben können. Sie erhalten ein Fit/Gap-Urteil je Dienst und ein Gesamturteil je Ziel; die Bewertung ist deterministisch und ruft kein LLM auf. |
| [LLM-Bewertung](/de/assessment/llm) | Verfügbar | Führt eine abgeschlossene Anwendungsbewertung mit 2 bis 5 LLM-Modellen nebeneinander erneut aus, um das Modell zu finden, das die Bewertungsarbeit von SWAO an Ihrer Anwendung am besten leistet. Sie erhalten einen Vergleich von Qualität, Zuverlässigkeit, Geschwindigkeit, Kosten und Sicherheitsverhalten, eine gewichtete Rangfolge und ein Befundprotokoll. |

---

## Fragen und Lizenzanfragen

Starten Sie eine [GitHub-Diskussion](https://github.com/Accenture/SWAO/discussions) oder [eröffnen Sie ein Issue](https://github.com/Accenture/SWAO/issues).
Für Lizenzanfragen schreiben Sie an [swao-tool@accenture.com](mailto:swao-tool@accenture.com?subject=SWAO%20Lizenzanfrage).
