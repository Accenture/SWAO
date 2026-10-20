---
title: Erste Schritte mit SWAO
audience: Erstanwender, Beraterinnen und Berater ohne Erfahrung mit Cloud-Migrations-Assessments
version: 2026-07
related:
  - docs/assessment-dimension-catalogue.md
  - docs/runbooks/mcp-integration.md

---

<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Erste Schritte
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# Erste Schritte mit SWAO

## Für wen dieser Leitfaden gedacht ist

Dieser Leitfaden richtet sich an Beraterinnen, Berater und Engineers, die ihr
erstes SWAO-Assessment durchführen und bisher noch kein Werkzeug für
Cloud-Migrations-Assessments verwendet haben. Vorkenntnisse zu Cloud-Migration,
regulatorischer Compliance oder Assessment-Methodik werden nicht vorausgesetzt.
Jeder Fachbegriff wird bei seinem ersten Auftreten erklärt.

Am Ende dieses Leitfadens können Sie:

- erklären, was SWAO tut und warum es existiert
- einen Workspace für eine Kundenanwendung einrichten
- ein vollständiges Assessment durchführen und die Ergebnisse lesen
- einen Bericht erzeugen und jedes Finding gegenüber Stakeholdern erläutern
- einschätzen, was zu tun ist, wenn ein Ergebnis unerwartet oder unklar ist

---

## SWAO über Claude Desktop (MCP) nutzen

SWAO stellt seine vollständige Assessment-Engine als MCP-Server (Model Context
Protocol) bereit. Ist die Verbindung hergestellt, kann Claude Desktop Assessments
ausführen, Signale lesen, Nachweise einlesen und Overrides setzen, und zwar über
Eingaben in natürlicher Sprache. Eine Kommandozeile ist dafür nicht nötig.

### Connector einrichten

Fügen Sie den folgenden Eintrag in Ihre Claude-Desktop-Konfigurationsdatei ein:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
(Installation aus dem Microsoft Store: `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json`)
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Statt die Datei von Hand zu bearbeiten, können Sie `swao mcp install` ausführen
(oder den Schritt „MCP Client“ im Setup-Assistenten). Der Befehl aktualisiert jede
Claude-Desktop-Konfiguration, die den Eintrag benötigt, und führt jede geänderte
Datei auf.

```json
{
  "mcpServers": {
    "swao-mcp": {
      "command": "C:\\path\\to\\swao-enterprise-win-x64.exe",
      "args": ["mcp"]
    }
  }
}
```

Ersetzen Sie den Pfad durch den Speicherort Ihres SWAO-Binaries. Starten Sie
Claude Desktop nach dem Speichern neu. Unter „Connectors“ sollte nun „SWAO“ mit
einem Schalter erscheinen, und im Anhangsmenü steht „Add from SWAO“ zur Verfügung.

> Hinweis: Starten Sie Claude Desktop nach jeder Aktualisierung des Binaries neu,
> damit die Tool-Registry aktualisiert wird.

### Schnellstart-Prompts für Claude Desktop

Die folgende Tabelle zeigt für jeden CLI-Schritt dieses Leitfadens die
entsprechende Eingabe in Claude Desktop. Alle Prompts setzen voraus, dass der
Workspace bereits konfiguriert ist. Lassen Sie `at workspace ...` weg, wenn der
MCP-Server bereits den richtigen Workspace geladen hat.

| Schritt | CLI-Befehl | Prompt in Claude Desktop |
|---|---|---|
| Zustand prüfen | `swao health-check` | `Use swao_health_check at workspace C:\path\to\workspace.` |
| Workspace anzeigen | - (nur MCP; `swao menu` öffnet die interaktive Oberfläche) | `Use swao_workspace_inventory at workspace C:\path\to\workspace.` |
| Assessment ausführen | `swao assess --app sovereign-health` | `Use swao_assess for sovereign-health at workspace C:\path\to\workspace.` |
| Ausgewählte Passes ausführen | `swao assess --app ... --passes inv,data,egr` | `Use swao_assess for sovereign-health, passes: inv,data,egr.` |
| Bericht lesen (alle Sichten) | `swao report --app ... --view business-owner` | `Use swao_report for sovereign-health, view business-owner.` |
| Signale auflisten | - (nur MCP; der Bericht listet die Signale) | `Use swao_signals for sovereign-health.` |
| Signaldetails | - (nur MCP) | `Use swao_signal_detail for sovereign-health, signal_id: CTX-03.` |
| LZ-Auswahl erklären | - (nur MCP) | `Use swao_explain_landing_zone for sovereign-health.` |
| Challenge ausführen | `swao challenge --app ... --agent grc-compliance-officer` | `Use swao_challenge for sovereign-health, agent: grc-compliance-officer.` |
| Dokument einlesen | `swao ingest --app ...` | `Use swao_ingest for sovereign-health. Category: compliance. Filename: dpa.md. Content: [text].` |
| Verdict übersteuern | - (nur MCP) | `Use swao_feedback_add for sovereign-health. Target_type: signal. Target_id: CTX-03. Override_outcome: RISK_ACCEPTED. Rationale: [reason]. Author: you@example.com.` |
| HTML-Bericht erzeugen | `swao publish --app ...` | `Use swao_publish for sovereign-health, mode: html.` |
| Portfolio-Übersicht | `swao report --portfolio` (Enterprise) | `Use swao_portfolio_summary at workspace C:\path\to\workspace.` |

Ein Strich in der CLI-Spalte bedeutet, dass es für diesen Schritt keinen eigenen Befehl gibt; er ist nur über den MCP-Server verfügbar.

Für ein Service Portfolio Assessment (ein mit `swao service init` angelegter Workspace)
stehen zusätzlich 11 Service-Tools bereit:

- Lese-Tools: `swao_service_portfolio` (eine Zeile je Service-App), `swao_service_app`
  (alles zu einer App), `swao_service_research` (Research-Stubs einer App),
  `swao_service_waves` (Migrationswellen und Integrations-Hubs), `swao_service_vendors`
  (Anbieterkonsolidierung), `swao_service_delta` (Änderungen seit dem letzten Snapshot),
  `swao_service_scaffold` (Scaffold-Zusammenfassung) und `swao_service_runs` (Service-Runs je App).
- Tools, die in den Workspace schreiben: `swao_service_init`, `swao_service_research_run` und
  `swao_service_export` (Enterprise) führen `swao service init`, `swao service research` und
  `swao service export` aus.

Beispiel: `Use swao_service_portfolio at workspace C:\path\to\workspace, time_quadrant: Migrate.`

Vollständige Tool-Referenz und erweiterte Prompts: [MCP-Integration](/de/runbooks/mcp-integration) (Abschnitt 4.1 für die Service-Tools).

---

## Teil 1: Was SWAO tut und warum

### Das Problem, das SWAO löst

Wenn ein Unternehmen eine Anwendung aus dem eigenen Rechenzentrum in eine
souveräne Cloud verlagern möchte (eine Cloud-Plattform, die europäische
Anforderungen an Datenresidenz und Regulierung erfüllt), muss vorab eine lange
Liste schwieriger Fragen beantwortet werden:

- Ist diese Anwendung technisch bereit für den Umzug?
- Nutzt sie Dienste, die in der Ziel-Cloud nicht verfügbar sind?
- Verarbeitet sie personenbezogene oder regulierte Daten auf eine Weise, die
  geändert werden muss?
- Wie lange dauert die Migration, und was kostet sie?
- Welche Community-Frameworks (GDPR, HIPAA, BSI C5) sind anwendbar, und werden
  sie erfüllt?
- Was passiert, wenn die Migration fehlschlägt?

Klassischerweise erfordert die Beantwortung dieser Fragen mehrere Beraterinnen
und Berater, mehrere Wochen manueller Code-Reviews und sieben getrennte
Ergebnisdokumente (Architektur-Review, Kostenmodell, Compliance-Assessment,
Risikoregister, Runbook, Schulungsplan, Infrastrukturdesign). Diese werden
jeweils separat erstellt und lassen sich nur schwer untereinander konsistent
halten.

SWAO ersetzt diesen manuellen Prozess durch eine einzige automatisierte
Pipeline. Es liest den Quellcode der Anwendung, ihre Abhängigkeitsliste, ihre
Infrastrukturkonfiguration, ihre Incident-Historie, ihre Cloud-Kostendaten und
die Notizen aus Stakeholder-Workshops. Daraus erzeugt es alle sieben
Ergebnisdokumente gleichzeitig, gestützt auf ein einziges maschinenlesbares
Artefakt: das Workload Sovereignty Profile (WSP).

### Wofür SWAO steht

**Sovereign Workload Assessment and Onboarding**

- **Sovereign** (souverän): Alle Kundendaten bleiben in der Umgebung des
  Kunden. Es wird kein Quellcode zu einem öffentlichen Dienst hochgeladen. Das
  Werkzeug läuft auf der Infrastruktur des Kunden oder in einem vom Kunden
  freigegebenen Container. Compliance-Anforderungen sind von Anfang an Teil des
  Assessments.
- **Workload**: Die Analyseeinheit ist jeweils eine Anwendung.
- **Assessment** (Bewertung): Jedes Finding ist auf eine nachvollziehbare
  Quelle zurückführbar. SWAO liefert keine Meinungen, sondern belegte Signale.
- **Onboarding**: Das Ergebnis des Assessments fließt direkt in die
  Cloud-Bereitstellung ein. SWAO erzeugt Terraform-Vorlagen und einen
  Servicekatalog-Eintrag, sodass der Migrationsplan tatsächliche Infrastruktur
  auslöst und nicht nur eine weitere Tabelle.

### Was SWAO nicht ist

SWAO ersetzt kein menschliches Urteilsvermögen. Es beschleunigt und
strukturiert das Assessment. Eine Beraterin oder ein Berater prüft weiterhin
die Ergebnisse, gleicht die Findings mit dem Wissen des Kunden ab und gibt die
abschließende Empfehlung. Die Aufgabe von SWAO ist es, die Nachweise
aufzubereiten, damit dieses Gespräch in Stunden statt in Wochen stattfinden kann.

---

## Teil 2: Grundbegriffe

Bevor Sie etwas ausführen, sollten Sie die folgenden sechs Begriffe kennen.
Alle weiteren Konzepte in SWAO bauen darauf auf.

### Anwendung (Workload)

Die Analyseeinheit. Eine Anwendung entspricht einem Quellcode-Repository plus
seinen Laufzeitabhängigkeiten, seinen Daten und seiner Betriebshistorie. SWAO
bewertet jeweils eine Anwendung. Eine Sammlung gemeinsam bewerteter Anwendungen
wird als Portfolio bezeichnet.

### Workspace

Ein Verzeichnis auf Ihrem Rechner, das alles enthält, was SWAO für ein
Engagement benötigt: eine oder mehrere Anwendungen mit ihren Eingaben und
Ergebnissen. Es umfasst:

- `.swao.yml`: die Workspace-Konfiguration (zum Beispiel den LLM-Anbieter)
- `apps/<app-id>/.swao.yml`: die Konfiguration einer Anwendung (Ort des
  Quellcodes, aktive Rahmenwerke, Ziel-Landing-Zone)
- `apps/<app-id>/ingestion/`: ein Ablageordner für Datendateien, die Sie vom
  Kunden erhalten (CMDB-Exporte, Incident-Berichte, Kostendaten,
  Workshop-Notizen)
- `apps/<app-id>/wsp/inputs/source/`: hier klonen oder legen Sie den Quellcode
  der Anwendung ab
- `apps/<app-id>/wsp/`: Eingaben und Ergebnisse der Anwendung; jeder Lauf wird
  nach `wsp/runs/<timestamp>/` geschrieben

Sie erstellen den Workspace mit `swao init`. Diese Ordner müssen Sie nie von
Hand anlegen.

### Signal

Ein Signal ist ein einzelnes Finding, das SWAO über die Anwendung ermittelt hat
und das durch einen konkreten Nachweis gestützt wird. Stellen Sie es sich wie
eine Notiz vor, die eine Beraterin oder ein Berater nach dem Lesen des Codes
schreiben würde: „Ich habe in Zeile 47 von data-provider.service.ts einen
AWS-spezifischen API-Aufruf gefunden. Dieser Dienst ist in europäischen
souveränen Clouds nicht verfügbar.“

Jedes Signal hat:
- eine ID (z. B. `EGR-01`), die angibt, welcher Assessment-Pass es erzeugt hat
- ein Label (eine kurze, gut lesbare Beschreibung des Findings)
- eine Konfidenzstufe (wie sicher sich SWAO ist)
- eine Nachweisreferenz (die genaue Quelldatei, Zeile oder das Dokument, das
  das Finding belegt)

Signale sind die Bausteine des gesamten Assessments. Alles andere (Scores,
Berichte, Migrationspläne) wird aus Signalen abgeleitet.

### Pass

Ein Pass ist ein Kapitel des Assessments. Standardmäßig führt `swao assess`
13 Passes aus, von denen sich jeder auf einen anderen Aspekt der Anwendung
konzentriert. Die Passes laufen nacheinander, weil spätere Passes auf den
Ergebnissen früherer aufbauen. Pass 00 (INGEST) läuft vorab und bereitet die
gelieferten Dokumente auf.

| Pass | Was untersucht wird |
|---|---|
| 01 INV (Inventory) | Was in der Codebasis steckt: Sprachen, Frameworks, Docker, Datenbanken |
| 02 STATE (Statefulness) | Speichert die Anwendung Daten? Wie? Ist sie zustandsbehaftet oder zustandslos? |
| 03 DATA (Datenklassen) | Welche Datenkategorien verarbeitet die Anwendung? (personenbezogen, medizinisch, finanziell) |
| 04 CTX (Kontext) | Was sagen die Datendateien (CMDB, Incidents, Kostenberichte, Workshop-Notizen)? |
| 05 SBOM (Abhängigkeiten) | Welche Open-Source-Bibliotheken nutzt sie? Sind welche verwundbar oder nicht mehr gepflegt? |
| 06 TF (Twelve-Factor) | Folgt die Anwendung Cloud-nativen Designprinzipien? |
| 07 EGR (Egress) | Welche externen Dienste ruft die Anwendung auf? Sind sie in der Ziel-Cloud verfügbar? |
| 08 CRYPTO (Kryptografie) | Wie geht die Anwendung mit Verschlüsselung, Schlüsseln und Token-Signaturen um? |
| 09 SYNTH (Synthese) | Fasst alle Signale zu einem Migrations-Verdict und einem Portabilitäts-Score zusammen |
| 10 DYNAMIC | Was tut die laufende Anwendung tatsächlich? (Browser-Crawl mit Playwright; benötigt ein Crawl-Ziel) |
| 11 COMP (Compliance) | Welche Kontrollen der ausgewählten Rahmenwerke sind erfüllt? |
| 12 BLOCKS | Wie reif sind die acht operativen Blöcke: Observability, Lizenzen, Tests, Architektur, Datenbanken, Integrationen, Identität, Disaster Recovery? |
| 13 SCOPE | Welche bekannten blinden Flecken deckt die Evidenz ab, und wie vollständig ist das Assessment? |

Zwei weitere Passes laufen nur auf Anforderung: Pass 14 MALWARE (Malware- und
Secret-Scan) und Pass 23 LZR (Landing-Zone-Bereitschaft, mit `--lzr`). Die
Nummern bezeichnen die Passes; die Ausführungsreihenfolge weicht leicht ab,
weil COMP, SYNTH und BLOCKS zuletzt laufen und so die Ergebnisse aller übrigen
Passes sehen. Die [Pass-Übersicht](/de/passes/) beschreibt jeden Pass.

Für den Einstieg müssen Sie nicht jeden Pass verstehen. INV, STATE, DATA, EGR
und SYNTH sind die fünf Kern-Passes, die das primäre Verdict bestimmen.

### Workload Sovereignty Profile (WSP)

Das WSP ist das zentrale Ergebnis eines Assessments. Es ist ein strukturiertes
Verzeichnis von Dateien (kein einzelnes Dokument), das alles festhält, was SWAO
über die Anwendung erfahren hat: jedes Signal, jede Nachweisreferenz, den
Migrationsplan, das Risikoregister, die Compliance-Lage und das abschließende
Verdict. Es liegt im Ordner `wsp/` Ihres Workspace.

Das WSP ist maschinenlesbar und kann daher ohne manuelle Übergabe direkt in
Werkzeuge zur Plattformbereitstellung (Terraform, meshStack) einfließen.

### Dimension

Eine Dimension ist ein übergeordneter Score, der eine Gruppe von Signalen zu
einer einzigen Zahl oder einem Verdict zusammenfasst, das auch nicht-technische
Stakeholder verstehen. SWAO erzeugt acht Dimensionen:

1. 7R-Migrationsmuster (welche Art von Migration empfohlen wird)
2. Portability Score (welcher Anteil der Dienste in die Ziel-Cloud umziehen kann)
3. Legacy-Indikatoren (gibt es alte Technologien, die die Migration blockieren?)
4. Machbarkeit der Datenmigration (lassen sich die Daten im verfügbaren
   Zeitfenster übertragen?)
5. CI/CD-Pipeline-Sicherheit (wie sicher ist die Delivery-Pipeline?)
6. Observability-Reife (lässt sich die Anwendung in der Ziel-Cloud überwachen?)
7. Lizenz-Compliance (gibt es Probleme mit Open-Source-Lizenzen?)
8. Test- und Qualitätsreife (ist die Testsuite stark genug, um
   Migrationsregressionen zu erkennen?)

Die Dimensionen werden in Teil 5 dieses Leitfadens ausführlich erläutert.

---

## Teil 3: Ihr erstes Assessment Schritt für Schritt

### Schritt 0: Prüfen, ob alles funktioniert

Führen Sie vor jedem Assessment den Health Check aus:

```
swao health-check
```

oder, wenn Sie SWAO über Claude Desktop nutzen:

```
Use swao_health_check at workspace C:\path\to\workspace.
```

`swao health-check` prüft, ob alle Komponenten, die SWAO benötigt, verfügbar
und konfiguriert sind:

- LLM-Anbieter: das Sprachmodell, mit dem SWAO über Code schlussfolgert
- Credential Store: der Ort, an dem API-Schlüssel abgelegt sind
- Playwright: das Browser-Automatisierungswerkzeug für die dynamische Analyse
- Workspace-Struktur: ob die Ordnerstruktur korrekt ist
- Lizenz: ob Ihre SWAO-Lizenz gültig ist

Alle Prüfungen sollten mit einem grünen Haken angezeigt werden. Schlägt eine
Prüfung fehl, beheben Sie das Problem, bevor Sie fortfahren. Der häufigste
Fehler ist ein fehlender oder abgelaufener LLM-API-Schlüssel. Aktualisieren Sie
ihn mit `swao credential set anthropic-api-key <key>`.

### Schritt 1: Workspace einrichten

Legen Sie einen neuen Workspace für die zu bewertende Anwendung an:

```
swao init <workspace-folder> --name <app-id>
```

Ersetzen Sie `<app-id>` durch eine kurze Kennung der Anwendung, die nur
Buchstaben, Ziffern und Bindestriche enthält, zum Beispiel `sovereign-health`
oder `app-crm-01`. Alternativ führt `swao setup` Sie als geführter Assistent
durch dieselben Schritte.

Dadurch entsteht der Workspace-Ordner mit, unter anderem, folgendem Inhalt:

```
<workspace-folder>/
├── .swao.yml                    # Workspace-Konfiguration
└── apps/
    └── <app-id>/
        ├── .swao.yml            # die App-Konfiguration, die Sie bearbeiten
        ├── ingestion/           # hier legen Sie die Datendateien des Kunden ab
        └── wsp/
            └── inputs/
                └── source/      # hier legen Sie den Quellcode der Anwendung ab
```

### Schritt 2: Quellcode bereitstellen

Klonen oder kopieren Sie den Quellcode der Anwendung in den Ordner `source/`
der App:

```
cd <workspace-folder>/apps/<app-id>/wsp/inputs
git clone <client-repository-url> source
```

Wenn Ihnen keine Git-URL vorliegt, kopieren Sie die Quelldateien manuell nach
`source/`. Alternativ tragen Sie `source.vcs.url` in die `.swao.yml` der App
ein; SWAO klont das Repository dann selbst. SWAO liest den Quellcode, schreibt aber nie hinein und lädt ihn nie
hoch.

### Schritt 3: Kundendaten in ingestion/ ablegen

Im Ordner `ingestion/` der App legen Sie alle Daten ab, die Sie vom Kunden
erhalten haben. SWAO liest sie, um das Assessment mit echtem Betriebskontext
anzureichern. Keine dieser Dateien ist zwingend erforderlich, denn das
Assessment läuft auch ohne sie. Jede einzelne verbessert jedoch die Qualität
der Findings.

Häufig verwendete Dateien:

| Datei | Inhalt | Bezugsquelle |
|---|---|---|
| `cmdb.csv` oder `cmdb.xlsx` | Liste der Server, Datenbanken und Dienste der Anwendung | IT- oder Configuration-Management-Team des Kunden |
| `incidents.csv` | P1/P2-Incident-Historie der letzten 6 Monate | ServiceNow-Export des Kunden |
| `cloudability.csv` | Monatliche Cloud-Kosten nach Dienst | FinOps-Team oder Cloud-Abrechnungsportal |
| `arch-<date>.md` | Architekturdokument oder Designnotizen | Engineering-Team des Kunden |
| `workshops/<date>-<topic>.md` | Notizen oder Transkript eines Discovery-Workshops | Ihre eigenen Notizen |

Legen Sie die Dateien in den Ordner `apps/<app-id>/ingestion/`. Pass 00
(INGEST) erkennt sie automatisch und ordnet sie in `wsp/inputs/` ein.

### Schritt 4: .swao.yml konfigurieren

Öffnen Sie `apps/<app-id>/.swao.yml` in einem Texteditor. Die Datei ist
bereits mit einer Vorlage befüllt. Eine minimale Konfiguration sieht so aus:

```yaml
app_id: sovereign-health

source:
  path: wsp/inputs/source/

assessment:
  regimes_active: [GDPR]          # zu bewertende Rahmenwerke (siehe Übersicht der Rahmenwerke)
  landing_zone:
    provider: stackit             # die Ziel-Cloud (stackit, azure, aws usw.)
    region: eu01                  # die Zielregion
```

URL und Anmeldedaten einer laufenden Testinstanz (für den Browser-Crawl) stehen
nicht in `.swao.yml`; sie werden im Credential Vault gespeichert.

Belassen Sie alle übrigen Werte vorerst auf ihren Standardeinstellungen. Nach
dem ersten Assessment-Lauf können Sie sie verfeinern.

### Schritt 5: Zugangsdaten hinterlegen

SWAO benötigt einen API-Schlüssel für das Sprachmodell, mit dem es über Code
schlussfolgert. Legen Sie ihn im Credential Store ab (nicht in `.swao.yml`):

```
swao credential set anthropic-api-key <ihr-api-schluessel>
```

Der Wert wird nicht angezeigt. Er wird verschlüsselt gespeichert und nie in
eine Datei geschrieben, die Sie versehentlich weitergeben könnten.
`swao setup` fragt den Schlüssel interaktiv ab.

### Schritt 6: Assessment ausführen

```
swao assess --app <app-id>
```

Oder über einen KI-Assistenten:

```
Run swao_assess for app sovereign-health at workspace /path/to/workspace
```

SWAO führt alle Assessment-Passes nacheinander aus. Je nach Größe der
Anwendung dauert das 5 bis 30 Minuten. Für jeden abgeschlossenen Pass sehen Sie
eine Fortschrittsausgabe.

Nach Abschluss des Assessments enthält der Ordner `wsp/` in Ihrem Workspace die
vollständigen Ergebnisse.

### Schritt 7: Bericht lesen

Erzeugen Sie aus den Assessment-Ergebnissen einen verständlichen Bericht:

```
swao report --app <app-id>
```

Oder über einen KI-Assistenten:

```
Run swao_report for app sovereign-health
```

Der Bericht zeigt:

- das Migrations-Verdict (das 7R-Label und seine Bedeutung)
- die drei wichtigsten Blocker (Findings, die vor der Migration gelöst werden
  müssen)
- die zentralen Scores (Portabilität, Coverage, Machbarkeit der Datenmigration)
- empfohlene nächste Schritte
- eine Zusammenfassung des Risikoregisters

Sie können auch einen Bericht für eine bestimmte Zielgruppe anfordern:

```
swao report --app <app-id> --view business-owner
```

Verfügbare Sichten:

| Sicht-ID | Zielgruppe | Schwerpunkt | Prompt in Claude Desktop |
|---|---|---|---|
| `application-architect` (Standard) | Technische Leitung | Alle Findings mit vollständigen Nachweisen | `Use swao_report for [app], view application-architect.` |
| `business-owner` | Business Owner / Programmsponsor | Geschäftliche Auswirkungen, Kosten, Zeitplan | `Use swao_report for [app], view business-owner.` |
| `grc-compliance-officer` | GRC-Verantwortliche | Compliance-Verdicts, Kontrolllücken | `Use swao_report for [app], view grc-compliance-officer.` |
| `finops-lead` | FinOps-Verantwortliche | Kostenmodell, Umschichtung von Ausgaben | `Use swao_report for [app], view finops-lead.` |
| `programme-manager` | Programmmanagement | Workstream-Plan, Abhängigkeiten, Risiken | `Use swao_report for [app], view programme-manager.` |

---

## Teil 4: Signale verstehen

### Eine Signal-ID lesen

Jedes Signal hat eine ID, aus der hervorgeht, welcher Pass es erzeugt hat und
welche laufende Nummer das Finding innerhalb dieses Passes trägt. Beispiel:
`EGR-01`

- `EGR` ist das Pass-Präfix (Egress-Analyse)
- `01` ist die laufende Nummer innerhalb dieses Passes

Die Signal-Präfixe, die Ihnen am häufigsten begegnen:

| Präfix | Pass | Inhalt |
|---|---|---|
| `INV` | Inventory | Sprachen, Frameworks, Docker-Images, Datenbank-Clients |
| `STATE` | Statefulness | Zustandsbehaftete Komponenten, Session-Management, Nutzung von Redis/Queues |
| `DATA` | Datenklassen | In der Codebasis gefundene personenbezogene, medizinische und Finanzdaten |
| `EGR` | Egress | Externe API-Aufrufe, Cloud-anbieterspezifische Dienste |
| `CRYPTO` | Kryptografie | Verschlüsselungsstärke, Schlüsselverwaltung, JWT-Konfiguration |
| `SBOM` | Abhängigkeiten | Verwundbare Pakete, Laufzeitumgebungen am Ende ihres Lebenszyklus, Lizenzhinweise |
| `TF` | Twelve-Factor | Konfiguration, Logging, Port-Binding, Prozessmodell |
| `CTX` | Kontext | Signale aus CMDB, Incident-Historie, Kostendaten, Workshops |
| `SYNTH` | Synthese | Abschließendes 7R-Verdict, Coverage-Score, wesentliche Lücken |
| `DYN` | Dynamisch | Laufzeitverhalten aus dem Browser-Crawl |
| `COMP` | Compliance | Ergebnisse des Compliance-Passes, zum Beispiel ein fehlender Framework-Katalog |
| `SCOPE` | Scope | Abdeckung bekannter blinder Flecken und Vollständigkeit des Assessments |
| `LZR` | Landing Zone | Bereitschaft der Ziel-Cloud: Quotas, Policies, Netzwerk (nur mit `--lzr`) |
| `MAL` | Malware | Secrets, verwundbare Pakete, Malware (nur wenn Pass 14 angefordert wird) |

Pass 12 (BLOCKS) bewertet Observability, Lizenzen, Tests, Architektur,
Datenbanken, Integrationen, Identität und Disaster Recovery als Blöcke. Das
Ergebnis wird im Assessment festgehalten; eigene Signale erzeugt der Pass
nicht.

### Konfidenzstufen von Signalen

Jedes Signal trägt eine Konfidenzstufe:

| Stufe | Bedeutung |
|---|---|
| `high` | SWAO hat einen direkten Nachweis im Code gefunden. Das Finding ist belastbar. |
| `medium` | SWAO hat aus indirekten Nachweisen geschlossen (z. B. lässt ein Paketname auf einen Dienst schließen). Vor der Präsentation prüfen. |
| `low` | Nur Mustererkennung; die Kontextnachweise sind uneindeutig. Als zu untersuchende Hypothese behandeln. |

Signale mit niedriger Konfidenz sind nicht falsch, sondern Anlässe für eine
menschliche Prüfung. Bei niedriger Konfidenz kennzeichnet SWAO das Signal als
Datenlücke und empfiehlt, mehr Kontext zu sammeln (einen Workshop, einen
CMDB-Eintrag, einen Export von Netzwerkflüssen).

### Was tun, wenn ein Signal Sie überrascht

Erscheint ein Signal, das falsch wirkt (SWAO meldet beispielsweise einen
AWS-Dienst, den der Kunde nach eigener Aussage nicht mehr nutzt), löschen Sie
das Signal nicht. Gehen Sie stattdessen so vor:

1. Prüfen Sie die Nachweisreferenz im Signal (Datei und Zeilennummer).
2. Fragen Sie das Engineering-Team des Kunden, ob die Referenz aktiver oder
   toter Code ist.
3. Ist das Finding als inaktiv bestätigt, legen Sie im Workspace einen
   `context_override` an, um diese Entscheidung mit Begründung festzuhalten.

So bleibt der Audit-Trail erhalten, während das Assessment korrekt angepasst
wird.

---

## Teil 5: Die acht Assessment-Dimensionen verstehen

Die Dimensionen sind die Scores, die oben in jedem Bericht erscheinen. Sie
übersetzen die rohe Signalliste in Zahlen und Verdicts, auf deren Grundlage
Stakeholder handeln können.

### Dimension 1: 7R-Migrationsmuster

**Welche Frage sie beantwortet:** Welche Art von Migration wird für diese
Anwendung empfohlen?

Das 7R-Framework ist das branchenübliche Vokabular für Entscheidungen zur
Cloud-Migration. SWAO vergibt eines von sieben Labels:

| Label | Bedeutung in einfachen Worten |
|---|---|
| Retire | Die Anwendung wird nicht mehr benötigt. Stilllegen statt migrieren. |
| Retain | Die Anwendung kann noch nicht migriert werden. On-Premises belassen und einen Überprüfungstermin festlegen. |
| Rehost | Die Anwendung ohne Änderungen in die Cloud verlagern. Auch als Lift-and-Shift bezeichnet. |
| Replatform | Mit kleineren Änderungen verlagern (zum Beispiel Wechsel von einer verwalteten Datenbank zu einem Cloud-nativen Äquivalent). |
| Repurchase | Die Anwendung durch ein kommerzielles SaaS-Produkt ersetzen. |
| Refactor | Teile der Anwendung vor der Migration Cloud-nativ neu schreiben. |
| Re-architect | Vor Beginn der Migration ist eine umfassende Neugestaltung erforderlich. |

Das Label wird mit einem Konfidenzwert (0,0 bis 1,0) ausgegeben. Eine Konfidenz
unter 0,70 bedeutet, dass SWAO nicht genügend Nachweise für eine sichere
Aussage hat. Sammeln Sie in diesem Fall mehr Kontext und führen Sie das
Assessment erneut aus.

**Was das für das Programm bedeutet:**

- Rehost und Replatform: Die Migration kann innerhalb von Wochen beginnen.
  Geringes Risiko.
- Refactor: 2 bis 6 Monate Engineering-Aufwand vor der Migration.
- Re-architect: 6 bis 18 Monate. An das Architecture Board eskalieren.
- Retain: Den konkreten Blocker identifizieren (regulatorisch, technisch,
  kostenbedingt). Einen Überprüfungstermin festlegen. Retain darf nicht ohne
  Entscheidung zum Dauerzustand werden.

---

### Dimension 2: Portability Score

**Welche Frage sie beantwortet:** Welcher Anteil der von dieser Anwendung
genutzten Dienste ist in der souveränen Ziel-Cloud verfügbar?

Ein Portability Score von 1,0 bedeutet, dass es für jeden externen Dienst, den
die Anwendung aufruft, ein Äquivalent in der souveränen Cloud gibt. Ein Score
von 0,0 bedeutet, dass es für keinen davon eines gibt.

**Schwellenwerte:**

| Score | Status | Vorgehen |
|---|---|---|
| 0,85 und höher | Souveränitätsbereit | Die Migration kann starten |
| 0,70 bis 0,84 | Bedingt | Ein oder zwei Dienste müssen validiert oder ersetzt werden |
| 0,50 bis 0,69 | Gefährdet | Mehrere Dienste müssen vor der Migration ersetzt werden |
| Unter 0,50 | Blockiert | Erheblicher Nachbesserungsbedarf |

**Typisches Finding mit niedriger Portabilität:**

Die Anwendung ruft einen AWS-spezifischen KI-Dienst auf (zum Beispiel Amazon
Comprehend Medical zur Analyse medizinischer Texte). Auf europäischen
souveränen Clouds gibt es dafür kein direktes Äquivalent. Entweder muss der
Dienst durch eine in der EU gehostete Alternative ersetzt werden, oder die
davon abhängige Funktion muss deaktiviert werden, bis eine Alternative
verfügbar ist. Beide Wege kosten das Programm Zeit und Geld.

**So sprechen Sie mit dem Kunden darüber:**

„Der Portability Score von 0,56 bedeutet, dass 44 % der externen Dienste, die
Ihre Anwendung aufruft, kein direktes Äquivalent in der souveränen Cloud haben.
Die gute Nachricht: Zwei davon sind in der Produktion möglicherweise inaktiv.
Sobald wir das mit Ihrem Team bestätigt haben, steigt der Score auf 0,75, und
die Anwendung liegt im bedingten Bereich. Dann bleibt ein einziger Dienst zu
klären, und das ist gut beherrschbar.“

---

### Dimension 3: Legacy-Indikatoren

**Welche Frage sie beantwortet:** Gibt es in dieser Anwendung alte
Technologien, die eine Migration verhindern oder erheblich erschweren würden?

SWAO ordnet Legacy-Findings drei Stufen zu:

| Stufe | Label | Auswirkung auf die Migration |
|---|---|---|
| Tier 1 | Blocker | Kein Äquivalent in der souveränen Cloud. Vollständiger Ersatz vor Beginn der Migration erforderlich. Typischerweise 12 bis 24 Monate Engineering-Aufwand. |
| Tier 2 | Erschwernis | Es gibt eine souveräne Alternative, die Migration erfordert jedoch erheblichen Aufwand (30 bis 90 Tage pro Komponente). |
| Tier 3 | Beherrschbar | Erhöht Kosten und Zeitaufwand, ändert aber das Gesamt-Verdict der Migration nicht. |

**Typische Tier-1-Blocker:**

- IBM MQ (Message Broker ohne Äquivalent in der souveränen Cloud)
- Oracle SOA Suite (Middleware-Plattform)
- TIBCO BusinessWorks (Integrationsplattform)
- COM/DCOM-Abhängigkeiten unter Windows (in einem Linux-Container nicht lauffähig)

**Wenn keine Legacy-Blocker gefunden werden:** Halten Sie das ausdrücklich
fest. „Legacy-frei“ ist für eine Kundenanwendung ein positives
Unterscheidungsmerkmal, denn die Migration wird nicht durch technische Schulden
ausgebremst.

---

### Dimension 4: Machbarkeit der Datenmigration

**Welche Frage sie beantwortet:** Lassen sich die Daten der Anwendung innerhalb
des vereinbarten Wartungsfensters in die Ziel-Cloud übertragen?

SWAO schätzt das Datenvolumen (aus CMDB-, FinOps- oder STATE-Signalen) und
teilt es durch eine realistische Übertragungsrate. Daraus ergibt sich ein
Machbarkeitsverhältnis.

| Machbarkeitsverhältnis | Verdict | Konsequenz |
|---|---|---|
| Unter 1,0 | Machbar | Eine Umstellung in einem einzigen Fenster ist erreichbar |
| 1,0 bis 2,0 | Grenzwertig | Ein Fenster außerhalb der Spitzenzeiten oder ein inkrementelles Vorgehen erwägen |
| 2,0 bis 5,0 | Phasenweise Migration erforderlich | Eine Change-Data-Capture-Brücke wird benötigt |
| Über 5,0 | Großes Datenmigrationsprogramm | Ein eigener Workstream für die Datenmigration wird benötigt |

**Was eine phasenweise Migration in der Praxis bedeutet:**

Statt alle Daten in der Nacht auf Sonntag zu kopieren und am Sonntagmorgen
umzuschalten, hält eine CDC-Brücke ein Replikat der Datenbank fortlaufend mit
der Quelle synchron. Die eigentliche Umstellung (der Moment, in dem die
Anwendung von der alten auf die neue Datenbank wechselt) dauert dann Minuten
statt Stunden, weil die Daten bereits vorhanden sind.

---

### Dimension 5: CI/CD-Pipeline-Sicherheit

**Welche Frage sie beantwortet:** Wie sicher ist die Build- und
Deployment-Pipeline der Anwendung? (Das ist während der Migration wichtig, weil
die Pipeline angepasst wird, neue Zugangsdaten bereitgestellt werden und sich
der Deployment-Pfad ändert.)

SWAO prüft acht Sicherheitsregeln (PP-R-01 bis PP-R-08):

| Regel | Was geprüft wird |
|---|---|
| PP-R-01 | GitHub Actions sind auf einen bestimmten SHA festgelegt (kein beweglicher Versions-Tag) |
| PP-R-02 | Workflow-Berechtigungen sind auf das notwendige Minimum beschränkt |
| PP-R-03 | Secrets werden über OIDC oder einen Secret Manager eingebracht (nicht hartcodiert) |
| PP-R-04 | Self-hosted Runner sind netzwerkseitig isoliert |
| PP-R-05 | Actions von Drittanbietern stammen von verifizierten Herausgebern |
| PP-R-06 | Der Geltungsbereich von OIDC-Tokens ist eingeschränkt |
| PP-R-07 | Build-Container laufen nicht privilegiert |
| PP-R-08 | Secrets werden nie in Logs ausgegeben |

Die Ergebnisse werden als Anzahl der Findings je Schweregrad (critical, high,
medium, low) ausgewiesen. Es gibt keinen Gesamt-Score. Die Verteilung der
Schweregrade bestimmt die Empfehlung.

---

### Dimension 6: Observability-Reife

**Welche Frage sie beantwortet:** Lässt sich die Anwendung in der Ziel-Cloud
überwachen?

Eine Anwendung, die in der Produktion nicht beobachtet werden kann, lässt sich
nicht sicher migrieren. Geht während oder nach der Migration etwas schief, muss
das Team es sofort erfahren. SWAO prüft acht Bereiche der Instrumentierung:

1. HTTP-Schicht (Request-Traces, Fehlerraten, Latenz)
2. Hintergrund-Job-Queues (Erfolgs- und Fehlerraten der Jobs)
3. Performance von Datenbankabfragen
4. Aufrufe externer Dienste (Timeouts, Fehlerraten je Abhängigkeit)
5. Fehlertracking (Sentry oder vergleichbar)
6. Distributed Tracing (Verknüpfung einer Anfrage über mehrere Dienste hinweg)
7. Eigene Geschäftsmetriken (anwendungsspezifische KPIs)
8. Strukturierte Log-Ausgabe (maschinenlesbare Logs statt Freitext)

**Schwellenwert:** 0,60 (mindestens 5 von 8 Bereichen abgedeckt) ist das
empfohlene Minimum, bevor eine Migration live geht. Darunter kann das Team
Regressionen nicht zuverlässig erkennen.

---

### Dimension 7: Lizenz-Compliance

**Welche Frage sie beantwortet:** Gibt es im Abhängigkeitsbaum der Anwendung
Open-Source-Lizenzen, die rechtliche Probleme verursachen könnten?

Das häufigste Finding ist die AGPL (GNU Affero General Public License). Wer
AGPL-lizenzierte Software verändert und Nutzern die Interaktion damit über ein
Netzwerk ermöglicht, muss diesen Nutzern den Quellcode der veränderten
Fassung einschließlich der Änderungen anbieten. Bei einem Deployment in einer
vom Kunden betriebenen souveränen Cloud kann das Verpflichtungen auslösen, mit
denen der Kunde nicht gerechnet hat.

Verdicts:

| Verdict | Bedeutung |
|---|---|
| clear | Keine Lizenzkonflikte gefunden |
| advisory | Copyleft-Lizenzen vorhanden; rechtliche Prüfung vor dem Go-live empfohlen |
| blocked | Ein Lizenzkonflikt muss vor der Migration behoben werden |

---

### Dimension 8: Test- und Qualitätsreife

**Welche Frage sie beantwortet:** Hat die Anwendung eine Testsuite, die stark
genug ist, um durch die Migration verursachte Regressionen zu erkennen?

Migrationen verändern Infrastruktur, Umgebungsvariablen, Datenbank-Engines und
Netzwerktopologie. Ohne zuverlässige Testsuite lässt sich nicht nachweisen,
dass sich die migrierte Version genauso verhält wie das Original.

| Score | Status | Interpretation |
|---|---|---|
| 0,80 und höher | Ausgereift | Das Regressionsrisiko der Migration ist gering |
| 0,60 bis 0,79 | Im Aufbau | Abdeckungslücken in kritischen Pfaden vor der Migration schließen |
| Unter 0,60 | Unausgereift | Ein manueller Regressionstestplan ist erforderlich |

---

## Teil 6: Häufige Fragen

**F: Das Assessment ergibt das 7R-Verdict Retain. Was bedeutet das für das
Engagement?**

Es bedeutet, dass SWAO mindestens einen Blocker gefunden hat, der die Migration
verhindert. Den konkreten Grund finden Sie im Risikoregister des Berichts.
Häufige Gründe sind eine Tier-1-Legacy-Abhängigkeit, ein Portability Score
unter 0,50 oder eine regulatorische Einschränkung (Daten, die eine bestimmte
Rechtsordnung rechtlich nicht verlassen dürfen). Das Verdict Retain ist keine
Sackgasse, sondern ein klar abgegrenztes Problem. Lösen Sie gemeinsam mit dem
Kunden den konkreten Blocker und führen Sie das Assessment erneut aus.

**F: Ein Signal hat hohe Konfidenz, aber der Kunde sagt, es sei falsch. Was
tue ich?**

Prüfen Sie zuerst die Nachweisreferenz (die konkrete Datei und Zeile in der
Codebasis). Ist der Nachweis im Code echt, hat sich die Lage aber geändert
(der Kunde hat die gemeldete Bibliothek beispielsweise bereits ersetzt),
erfassen Sie in `.swao.yml` einen Context Override mit Begründung. Ist die
Nachweisreferenz ein False Positive (SWAO hat den Code falsch gelesen),
erstellen Sie eine Gap Note. Ignorieren Sie das Signal nicht, ohne eine
Entscheidung zu dokumentieren.

**F: Der Coverage-Score liegt unter 0,75. Ist das ein Problem?**

Der Coverage-Score misst, welcher Anteil der Signale durch Nachweise mit hoher
Konfidenz gestützt wird. Unter 0,75 stützt sich das Assessment stark auf
Schlussfolgerungen statt auf direkte Nachweise. Das ist zu Beginn eines
Engagements üblich, wenn Kontextdateien (CMDB, Incidents) noch nicht vorliegen.
Legen Sie die fehlenden Kontextdateien in `apps/<app-id>/ingestion/` ab und
führen Sie das Assessment erneut aus, um den Score zu verbessern.

**F: Das Assessment erwähnt DORA-Compliance. Was ist DORA?**

DORA (Digital Operational Resilience Act) ist eine Verordnung der Europäischen
Union für Unternehmen der Finanzbranche. Sie verlangt, dass kritische IT-Systeme
getestete Disaster-Recovery-Pläne, definierte Wiederherstellungszeitziele und
ein dokumentiertes Management von Drittparteienrisiken haben. Fällt die
Anwendung in den Geltungsbereich von DORA, meldet SWAO Lücken in den Passes DR
und IAM.

**F: Was ist eine Landing Zone, und warum ist der LZR-Pass wichtig?**

Eine Landing Zone ist die Cloud-Umgebung, die für die Aufnahme der migrierten
Anwendung vorbereitet wurde: das virtuelle Netzwerk, die
Identitätskonfiguration, die Ressourcen-Quotas, die Sicherheits-Policies. Der
LZR-Pass prüft, ob diese Umgebung tatsächlich bereit ist. Ein grünes
LZR-Ergebnis bedeutet, dass das Team mit der Bereitstellung beginnen kann. Ein
blockiertes LZR-Ergebnis bedeutet, dass an der Zielumgebung noch gearbeitet
werden muss, bevor die Anwendung umziehen kann.

**F: Ich habe nach dem Assessment swao_challenge ausgeführt. Was macht das?**

Die Challenge-Sitzung führt fünf KI-Agenten aus, die jeweils die Perspektive
eines Stakeholders einnehmen. Die fünf kanonischen Persona-IDs:

| CLI- / MCP-ID | Stakeholder | Prompt in Claude Desktop |
|---|---|---|
| `application-architect` | Technische Leitung | `Use swao_challenge for [app], agent: application-architect.` |
| `business-owner` | Business Owner / Sponsor | `Use swao_challenge for [app], agent: business-owner.` |
| `grc-compliance-officer` | GRC- / Compliance-Verantwortliche | `Use swao_challenge for [app], agent: grc-compliance-officer.` |
| `finops-lead` | FinOps-Verantwortliche | `Use swao_challenge for [app], agent: finops-lead.` |
| `programme-manager` | Migrations- / Programmmanagement | `Use swao_challenge for [app], agent: programme-manager.` |

Dieselben fünf IDs steuern auch `swao report --view <id>`. Die älteren Aliasse
(`technical`, `exec`, `compliance`, `finops`, `migration-manager`) werden
weiterhin akzeptiert, geben aber eine Deprecation-Warnung aus.

Jeder Agent liest das WSP und formuliert die härtesten Fragen, die der
jeweilige Stakeholder in einem Review-Meeting stellen würde. So kann sich das
Beratungsteam auf Einwände des Kunden vorbereiten, bevor sie auftreten. Das ist
besonders hilfreich, bevor Sie Ergebnisse vor einem skeptischen oder technisch
sehr versierten Kundenteam präsentieren.

**F: Wie lange dauert ein Assessment?**

Ersteinrichtung (Workspace anlegen, Zugangsdaten, Quellcode): 15 bis 30
Minuten. Assessment-Lauf (alle Passes): 5 bis 30 Minuten, abhängig von der
Größe der Anwendung und der Geschwindigkeit des LLM-Anbieters.
Berichtserstellung: unter einer Minute. Aktive Gesamtzeit für ein erstes
Assessment: 1 bis 2 Stunden. Weitere Iterationen (nach Ergänzung von
Kontextdaten): jeweils 15 bis 30 Minuten.

---

## Teil 7: Was nach Ihrem ersten Assessment zu tun ist

1. **Lesen Sie zuerst die Blocker.** Der Bericht listet die wichtigsten
   Findings nach Schweregrad. Beginnen Sie mit den Punkten mit Schweregrad
   critical und high. Das sind die Themen, die die Migration verzögern oder
   blockieren, wenn sie nicht angegangen werden.

2. **Besprechen Sie die Executive-Sicht mit dem Sponsor auf Kundenseite.**
   Führen Sie `swao report --app <name> --view business-owner` aus und gehen Sie den Bericht mit dem
   Business Owner durch. Vermeiden Sie Fachjargon. Beginnen Sie mit dem
   7R-Verdict, den Auswirkungen auf den Zeitplan und den zwei oder drei
   wichtigsten Risiken.

3. **Planen Sie einen technischen Deep-Dive zu den Findings.** Der technische
   Standardbericht ist die Grundlage für eine Sitzung mit dem
   Engineering-Team des Kunden. Gehen Sie die Portabilitäts-Blocker und
   Legacy-Indikatoren gemeinsam durch. Das Team hat oft Kontextwissen, mit dem
   sich Signale niedriger Konfidenz klären lassen.

4. **Ergänzen Sie Kontextdaten und iterieren Sie.** Bitten Sie den Kunden nach
   dem ersten Gespräch um die fehlenden Datendateien (CMDB, Incidents, FinOps).
   Legen Sie sie in `apps/<app-id>/ingestion/` ab und führen Sie das Assessment erneut aus.
   Beobachten Sie, wie der Coverage-Score mit jeder ergänzten Datei steigt.

5. **Führen Sie die Challenge-Sitzung vor der Abschlusspräsentation aus.**
   Nutzen Sie `swao challenge --app <name> --agent grc-compliance-officer` (und weitere
   Agenten), um die Findings aus der Perspektive jedes Stakeholders auf die
   Probe zu stellen, bevor Sie mit ihnen am Tisch sitzen.

6. **Erzeugen Sie die Terraform-Vorlagen, sobald der Plan feststeht.** Ist das
   7R-Verdict bestätigt und das Risikoregister abgestimmt, erzeugen Sie mit
   `swao generate-tf` die Infrastructure-as-Code-Vorlagen für die Ziel-Landing-Zone.
