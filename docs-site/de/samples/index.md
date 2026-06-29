# SWAO-Beispielgalerie

Screenshots aus echten Bewertungsdurchlaeufen, die CLI, Power-BI-Berichte, die Terminal-
Oberflaeche und den Claude-Desktop-MCP-Connector zeigen. Alle Aufnahmen stammen von
SWAO v0.4.8 gegen Live-Workspaces.

---

## CLI

### `swao init` -- Workspace-Strukturierung {#sample-01}

![swao init output alongside the created workspace folder](/samples/01-cli-init.png)

Ein `swao init --name <app-id>`-Durchlauf mit der Windows-Explorer-Teilansicht daneben. Der
Befehl installiert das DSGVO-Community-Framework in `wsp/inputs/catalogs/community`,
richtet die Power-BI-`.pbit`-Vorlagen in `wsp/templates/powerbi` ein und erstellt den
App-Importordner unter `apps/<app-id>/ingestion`. Der rechte Bereich zeigt den
resultierenden Workspace: drei Elemente bereit -- `ingestion/`, `wsp/` und `.swao.yml`.

**Ein Befehl, Portfolio-bereit.** Keine manuelle Ordnererstellung oder Vorlagensuche.

---

### `swao health-check` -- alle 11 Pruefungen {#sample-02}

![swao health-check with all 11 probes passing](/samples/02-cli-doctor.png)

Ausgabe von `swao health-check` gegen einen vollstaendig konfigurierten Enterprise-Workspace.
Alle 11 Pruefungen melden ihren Status:

| Pruefung | Ergebnis |
|---|---|
| Lizenz | ok -- Enterprise, 56/2000 genutzt |
| Playwright / Chromium | ok -- Chromium Build 1223 |
| SWAO-MCP | ok -- Server konfiguriert |
| Compliance-Kataloge | ok -- DSGVO-Community-Framework, 53 Steuerungen, keine Integritaetsprobleme |
| Importvorlagen | ok -- 3 Vorlagen registriert |
| Nachvollziehbarkeit | ok -- 1 App erfuellt Ziele |
| BI-Export | ok -- 21 Dateien, alle Zeilenanzahl und Hashes stimmen |
| Umfang | INFO -- wartet auf Durchlauf-13-Ausfuehrung |
| Voraussetzungen | INFO -- ssh nicht im PATH (HTTPS-Clone funktioniert weiterhin) |
| VCS-Authentifizierung | ok -- 1 von 3 Apps authentifiziert |
| Audit-Import | INFO -- kein Audit-Workspace konfiguriert |

Maschineller Fingerabdruck unten angezeigt -- wird beim Anfordern eines Lizenzschluessels
verwendet.

---

### `swao assess` -- mehrstufige Pipeline-Stromausgabe {#sample-03}

![swao assess streaming passes for sovereign-health](/samples/03-cli-assess-anthropic.png)

`swao assess --app sovereign-health` in Echtzeit stromausgabe. Durchlaeufe 01 (Inventar),
02 (Zustandsanalyse), 03 (Datenklassifizierung) und 04 (Kontextimport) sind sichtbar,
jeder mit Signalanzahl und Echtzeit bei Abschluss. Die CTX-Warnungen zeigen, dass das
Bewertungsmodul nach optionalen Kontextdateien sucht (Architekturreview, Compliance-
Richtlinie, Workshop-Notizen), die in diesem Workspace nicht vorhanden sind -- der
Durchlauf wird fortgesetzt und die Signale, die aus dem Quellcode allein abgeleitet werden
koennen, werden weiterhin ausgegeben.

**Die mehrstufige Pipeline ist das Herzstuck von SWAO.** Drei Durchlaeufe rufen das LLM auf;
alles andere ist deterministische statische Analyse.

---

## Power-BI-Berichte

### Anwendungs-Dashboard -- Uebersichtsseite {#power-bi-reports}

![Power BI Application Report dashboard page](/samples/04-powerbi-dashboard-overview.png)

Der Einzelanwendungs-Power-BI-Bericht gegen ein echtes Bewertungspaket geoeffnet. Die
Kopfzeile zeigt Auftragsmetadaten, das SWAO-Branding und den Bewertungszeitstempel. Darunter:
ein **Gesamtsignale nach Ergebnis**-Donut-Diagramm, ein **Steuerungen mit Luecke nach
Regelwerk-ID**-Balkendiagramm, das zeigt, welche Compliance-Regelwerke die meisten offenen
Luecken haben, und Zusammenfassungskarten fuer Begruendungsabdeckung und FP-Beruecksichtigungs-
rate. Die untere Tabelle zeigt den Signal-Begruendungstext, der jedes Urteil antreibt --
dies ist es, was Befunde pruefungstauglich macht.

**Erste Seite, die ein Berater mit einem Kunden oeffnet.** Signale, Luecken und Begruendung
in einer Ansicht.

---

### Compliance-Matrix -- Steuerung-fuer-Steuerung-Status {#sample-05}

![Power BI Compliance page with GDPR control matrix](/samples/05-powerbi-compliance-matrix.png)

Die Compliance-Seite mit der vollstaendigen DSGVO-Steuerungsmatrix. Oberste Karten zeigen:
**5 Steuerungen erfuellt**, **15 Steuerungen mit Luecke**, **1 informativ**. Die Haupttabelle
listet jede DSGVO-Steuerung nach ID mit ihrem Schweregrad und Urteil (SATISFIED / PARTIAL /
UNKNOWN). Das unterstuetzende Evidenzfeld rechts verknuepft jedes Urteil mit den
Quellsignalen und Evidenz-URLs, die es erzeugt haben.

**Pruefungsqualitaet Nachvollziehbarkeit.** Jede Zelle drillt auf die Evidenz herunter, die
sie begruendet hat.

---

### Risikoseite -- Risikoregister mit Bewertung {#sample-06}

![Power BI Risks page with risk register and charts](/samples/06-powerbi-risks.png)

Die Risikoseite mit drei Bereichen. Das **Risikoregister** oben zeigt jeden Risikoeintrag
mit Eintrittswahrscheinlichkeit, Auswirkung, einer vollstaendigen Ausloser-Beschreibung und
einer Massnahme -- der oberste Eintrag (RR-001, Score 6) identifiziert PII-Felder, die
ohne Verschluesselung auf Datenbankebene gespeichert werden. Das horizontale Balkendiagramm
**Risikoscore nach risk\_id** ordnet alle Risiken nach Score an, farbkodiert rot/orange/
gruen. Das **Anzahl der risk\_id nach Kategorie**-Donut unterteilt das Register nach Bereich:
Anwendung (60 %), Geschaeftsprozesse (20 %), Infrastrukturplattform (13 %), Enablement (7 %).

**Risikoregister, das Pruefende erkennen.** Score, Ausloser, Massnahme und Verantwortliche
in einer Ansicht.

---

### Pruefungsseite -- Begruendung auf Signalebene {#sample-07}

![Power BI Auditor page with block-level and signal-level assessments](/samples/07-powerbi-auditor.png)

Die Pruefungsseite mit vier Zusammenfassungskarten: **Begruendungsabdeckung 1,00**, **FP-
Beruecksichtigungsrate 0,21**, **10 negative Signale**, **1 Steuerung mit Luecke**. Das
**Bewertungen auf Blockebene**-Balkendiagramm gruppiert Signale nach Codeblock und Score.
Darunter zeigt die **Falsch-Positiv-Tabelle auf Signalebene** jedes Signal mit seinem
`false_positive_considered`-Flag und dem LLM-generierten `overall_rationale`-Text. Dies ist
die Seite, die ein externer Pruefer oeffnet, um zu verifizieren, dass jeder Befund eine
dokumentierte Ableitung hat.

**Jedes Urteil traegt eine nachvollziehbare Begruendung** -- `rule_engine` oder `llm`, mit
angezeigter Begruendung.

---

### Portfolio-Uebersicht -- Multi-App-Dashboard {#sample-08}

![Power BI Portfolio Report overview page with four apps](/samples/08-powerbi-portfolio-overview.png)

Der Portfolio-Power-BI-Bericht mit vier bewerteten Anwendungen. Oberste Karten: **4
Anwendungen gesamt**, **4 Apps mit kritischem Risiko**, **Durchschnittliche Abdeckung
24,75 %**. Das **Anwendungen gesamt nach 7R**-Donut zeigt die Migrationsstrategie-Verteilung
ueber das Portfolio. Die Portfolio-Tabelle darunter ordnet Anwendungen nach Portabilitaet,
Abdeckung, negativen Signalen und gewichtetem Risiko ein -- was es einfach macht, zu
priorisieren, welche App als erstes Aufmerksamkeit benoetigt.

**Wenn das Portfolio auf 20 oder 50 Apps skaliert, wird diese Seite das primaere Dashboard.**

---

### Portfolio-Pruefungs-Rollup -- anwendungsuebergreifende Compliance-Ansicht {#sample-09}

![Power BI Portfolio Auditor Roll-up page](/samples/09-auditor-md-excerpt.png)

Die Portfolio-Pruefungs-Rollup-Seite aggregiert den Compliance-Status aller Apps im
Portfolio. Oberste Karten zeigen Portfolio-Metriken: **Durchschnittliche Abdeckung 1,00**,
**FP-Beruecksichtigungsrate 0,50**, **31 negative Signale**, **61 Signale gesamt**. Die
**Pruefungs-Rollup**-Tabelle listet jede App mit ihrer individuellen Abdeckung und FP-Rate.
Die **Compliance-Status**-Matrix zeigt jede DSGVO-Steuerung (d-10-Ansicht) mit ihrem
App-bezogenen Urteil nebeneinander. Die **Unterstuetzende Evidenz**-Tabelle unten verknuepft
jedes Urteil mit Quellsignalen und Evidenzpfaden.

**Portfolio-Governance auf einer Seite.** Compliance-Beauftragte koennen anwendungsuebergreifende
Musterluecken sofort erkennen.

---

## Terminal-Oberflaeche (TUI)

### Hauptmenue {#terminal-interface-tui}

![SWAO TUI main menu v0.4.8](/samples/10-tui-main-menu.png)

Die SWAO-Terminaloberflaeche ohne Argumente gestartet -- `swao` aus einem beliebigen
Verzeichnis. Die Enterprise-Lizenzstatusleiste zeigt `57/2000 genutzt, laeuft ab am
2027-06-30`. Alle neun nummerierten Optionen sind mit ihren Beschreibungen sichtbar:

| Taste | Option | Funktion |
|---|---|---|
| 1 | Workspace Setup | Init + LLM + Anmeldeinformationen-Assistent |
| 2 | Health Check | swao doctor |
| 3 | Bewertung durchfuehren | Anwendung / Audit / Landing Zone und mehr |
| 4 | Bericht erstellen | swao report (Text / PDF) |
| 5 | HTML veroeffentlichen | swao publish -- eigenstaendige HTML-Datei |
| 6 | BI exportieren | Sternschema / PowerBI / Tableau |
| 7 | Portfolio-Operationen | Multi-App-Aggregat (Enterprise) |
| 8 | TF-Module generieren | swao generate-tf |
| 9 | Werkzeuge | Linsen / Lizenz / Anmeldeinformationen / Hilfe |
| s | Shell hier oeffnen | Eingabeaufforderung im Workspace oeffnen |
| 0 | Beenden | |

Das Anleitungsfeld unten aktualisiert sich mit einer Beschreibung des hervorgehobenen
Elements. Druecken Sie `Ctrl+G`, um es zu minimieren.

---

### Workspace-Setup-Assistent {#sample-11}

![SWAO TUI Workspace Setup wizard step 1 of 7](/samples/11-tui-workspace-setup.png)

Der Workspace-Setup-Assistent (Menuepunkt 1) bei **Schritt 1 von 7**. Die Fortschrittspunkte
oben zeigen den vollstaendigen Ablauf: Init, LLM, Anmeldeinformationen, Health Check,
MCP-Client, Playwright, Bereit. Schritt 1 fragt nach dem Workspace-Verzeichnis -- Druecken
von Enter akzeptiert das aktuelle Verzeichnis; bestehende Workspaces werden automatisch
erkannt und wiederverwendet. Das Anleitungsfeld (Ctrl+G zum Minimieren) erklaert jedes Feld.
Escape kehrt jederzeit zum Hauptmenue zurueck.

**Der Assistent ist die empfohlene Ersterfahrung.** Er konfiguriert den Workspace, den
LLM-Anbieter, Anmeldeinformationen und den MCP-Connector in einem einzigen gefuehrten Ablauf.

---

### Health Check -- TUI-Ansicht {#sample-12}

![SWAO TUI Health Check screen with 11 probes](/samples/12-tui-health-check.png)

Der Health-Check-Bildschirm (Menuepunkt 2) mit allen 11 aufgelisteten Pruefungen. Sieben
Pruefungen zeigen **OK** in Gruen; Umfang und Audit-Import zeigen **INFO** in Cyan;
Voraussetzungen zeigt **INFO**. Das Anleitungsfeld unten beschreibt die ausgewaehlte
Pruefung im Detail -- druecken Sie `Ctrl+G`, um es zu minimieren. "Alle Pruefungen bestanden."
bestaetigt, dass der Workspace bereit fuer die Bewertung ist. Druecken Sie Enter oder Escape,
um zum Hauptmenue zurueckzukehren.

---

### Bewertung durchfuehren -- Typauswahl {#sample-13}

![SWAO TUI assessment type selection screen](/samples/13-tui-run-assessment.png)

Der Bildschirm **Bewertung durchfuehren** (Menuepunkt 3) zeigt die fuenf Bewertungsoberflaechen.
Zwei sind aktiv und sofort verwendbar; drei sind demnachst verfuegbar:

| Taste | Typ | Status |
|---|---|---|
| [1] | Anwendungsbewertung | Aktiv -- `swao assess`, statische + LLM-Durchlaufsuite |
| [2] | Audit-Bewertung | Demnachst -- Checkliste + Evidenz + Urteil |
| [3] | Landing-Zone-Bewertung | Aktiv -- `swao assess --type landing-zone`, CSP-Fit-/Gap-Bericht |
| [4] | LLM-Bewertung | Demnachst -- Multi-LLM-Souveraenitatsbenchmarking |
| [5] | Hybridbewertung | Demnachst -- Quelle + menschliche Evidenz kombiniert |

Das Anleitungsfeld beschreibt den hervorgehobenen Typ vollstaendig. Die Anwendungsbewertung
ist der primaere Einstiegspunkt: Sie fuehrt bis zu 14 Analysedurchlaeufe ueber Inventar,
SBOM, Kryptografie, Compliance, 7R-Synthese, Landing-Zone-Bereitschaft durch und erzeugt
Signale, Berichte, ein BI-Paket und eine HTML-Publikation.

---

### HTML-Veroeffentlichungs-Bildschirm {#sample-14}

![SWAO TUI Publish HTML screen](/samples/14-tui-publish-html.png)

Der Veroeffentlichungsbildschirm (Menuepunkt 5) mit zwei aktiven Veroeffentlichungsoptionen
und drei demnachst verfuegbaren Eintraegen:

- **[1] Einzelne HTML-Seite** (`swao publish --app`) -- generiert eine einzelne eigenstaendige
  HTML-Datei aus dem letzten Bewertungsdurchlauf, Ausgabe nach
  `apps/<id>/wsp/publications/<ts>-<id>.html` (unter 2 MB, E-Mail-bereit).
- **[2] HTML-Editor** (`swao publish --edit`) -- oeffnet den interaktiven browserbasierten
  Editor zur Anpassung der Publikation vor dem Speichern.

Das Anleitungsfeld beschreibt den Ausgabepfad und das Format fuer die ausgewaehlte Option.

---

## MCP-Connector

### SWAO verbunden in Claude Desktop {#mcp-connector}

![SWAO MCP connector active in Claude Desktop connectors menu](/samples/15-mcp-connector-claude-desktop.png)

Claude Desktop mit geoeffnetem Connectors-Panel, das den **aktivierten SWAO-Connector**
(blaue Umschaltflaeche) zeigt. Das Menue zeigt "Von SWAO hinzufuegen"- und "Tool-Zugriff"-
Eintraege neben den Standard-Connector-Verwaltungsoptionen. Der SWAO-Connector ist Teil der
ACN General Availability Bereitstellung -- keine manuelle Konfiguration fuer Operatoren auf
diesem Mandanten erforderlich.

Nach der Verbindung kann Claude SWAO-MCP-Tools direkt aus jedem Gespraech heraus aufrufen:
Workspace-Signale lesen, Compliance-Luecken abfragen und strukturierte Bewertungsbefunde
zurueckgeben, die in den tatsaechlichen Workspace-Daten verankert sind.

---

### MCP: Compliance-Challenge in natuerlicher Sprache {#sample-16}

![Claude answering a GDPR risk question using live SWAO signals](/samples/16-mcp-deep-dive-question.png)

Ein Claude-Desktop-Gespraech im Projekt **Starting SWAO**. Der Operator fragt:
_"what are the key GDPR risks and how to overcome them?"_ Claude ruft das **Swao signals**
MCP-Tool auf und gibt eine strukturierte, signalbasierte Antwort zurueck:

- **Hoch -- DATA-01:** PII ohne Datenbankverschluesselung gespeichert. Patientenfelder
  (E-Mail, Telefon, Notizen, Transkripte) verlassen sich nur auf App-Schicht-Verschluesselung;
  ein DB-Dump oder Backup legt sie im Klartext bloss. Massnahme: TDE oder spaltenbasierte
  Verschluesselung auf dem souveraenen Ziel aktivieren.
- **Hoch -- DATA-07:** Externe Bezeichner (`stripe_customer_id`, `affiliate_code`) fehlt
  eine Loeschrichtlinie und sind nicht durch die bestehende `purge_user()`-Routine abgedeckt.
  Massnahme: `purge_user()` erweitern oder die rechtliche Aufbewahrungsgrundlage im ROPA
  dokumentieren.
- **Hoch -- DATA-10:** Art.-17-Bereinigungsroutine unvollstaendig -- die Funktion
  `cron_hard_purge()` ist im gescannten Quellcode abgeschnitten.

Jeder Befund stammt direkt aus dem Workspace-Signalspeicher -- keine Halluzination, keine
generischen Ratschlaege. Die Antwort verwendet dieselben Signal-IDs und Begruendungstexte,
die auf der Power-BI-Pruefungsseite und in der HTML-Publikation erscheinen.

**Dies ist der "Wow"-Moment.** Eine Frage in natuerlicher Sprache; eine strukturierte,
pruefungstaugliche Antwort, verankert im tatsaechlichen Codebase.
