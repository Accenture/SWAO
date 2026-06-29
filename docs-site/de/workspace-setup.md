# Workspace Setup

Workspace Setup ist der gefuehrte Einstiegspunkt fuer jeden SWAO-Auftrag. Er fuehrt Sie
durch sieben Schritte -- von der Erstellung des Workspace-Ordners bis zur Verbindung mit
Claude Desktop -- und hinterlaesst eine vollstaendig konfigurierte Umgebung, die bereit ist,
Ihre erste Bewertung durchzufuehren.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **1**, oder starten Sie
`swao` aus Ihrem Workspace-Verzeichnis und waehlen Sie "Workspace Setup".

![SWAO Workspace Setup wizard](/samples/11-tui-workspace-setup.png)

---

## Funktion

Ein Workspace ist ein einzelner Ordner, der alles enthaelt, was SWAO fuer einen Auftrag
benoetigt: die Compliance-Framework-Kataloge, Ihre Anwendungsquell-Referenzen, importierte
Kontextdokumente, Bewertungsausgaben und das Power-BI-Exportpaket. Der Setup-Assistent
erstellt und konfiguriert diesen Ordner in einem gefuehrten Ablauf.

---

## Die sieben Schritte

### Schritt 1 -- Workspace initialisieren

Erstellt die `.swao.yml`-Konfigurationsdatei fuer einen neuen Workspace oder stellt die
Verbindung zu einem bestehenden wieder her. Geben Sie den Verzeichnispfad ein (oder druecken
Sie Enter, um das aktuelle Verzeichnis zu verwenden). Bestehende Workspaces werden
automatisch erkannt, sodass Sie dort weitermachen koennen, wo Sie aufgehoert haben.

### Schritt 2 -- LLM-Anbieter

Konfiguriert das grosse Sprachmodell, das SWAO fuer seine Analysedurchlaeufe verwendet.
Unterstuetzte Anbieter:

| Anbieter | Hinweise |
|---|---|
| Anthropic Claude | Standard. Empfohlen fuer souveraene Workloads (Zero-Retention-Endpunkt verfuegbar). |
| Azure OpenAI | Fuer Deployments innerhalb eines Azure-Mandanten mit EU-Datenresidenz. |
| OpenAI | GPT-4o und hoeher. |
| Ollama (lokal) | Vollstaendig air-gapped -- keine Daten verlassen den Rechner. |

Fuer Cloud-Anbieter benoetigen Sie einen API-Schlussel. Ollama erfordert einen lokal
laufenden Ollama-Server.

### Schritt 3 -- Anmeldeinformationen

Speichert API-Schluessel und Repository-Anmeldeinformationen sicher. Anmeldeinformationen
werden im Workspace-Credential-Store gespeichert (niemals direkt in `.swao.yml`) und werden
zur Laufzeit aufgeloest. Dieser Schritt umfasst auch die VCS-Authentifizierung fuer private
Repositories, die SWAO waehrend der Bewertung klonen wird.

### Schritt 4 -- Health Check

Fuehrt am Ende der Einrichtung automatisch den vollstaendigen Health Check mit 11 Pruefungen
durch, um zu bestaetigen, dass jede Komponente funktioniert. Jede Pruefung, die WARN oder
INFO meldet, enthaelt Anleitungen zur Behebung. Sie koennen den Health Check jederzeit
ueber Menuepunkt 2 erneut ausfuehren.

### Schritt 5 -- MCP-Client

Konfiguriert den SWAO-MCP-Server-Eintrag in Claude Desktop, damit Claude SWAO-Bewertungs-
tools direkt aus einem Gespraech heraus aufrufen kann. SWAO schreibt die
Serverkonfiguration automatisch -- Sie bestaetigen nur den Claude-Desktop-Pfad.

### Schritt 6 -- Playwright

Prueft, ob Playwright und Chromium installiert sind. Playwright wird nur fuer die
PDF-Berichterstellung und den HTML-Editor-Veroeffentlichungspfad benoetigt. Wenn Playwright
fehlt, ueberspringt SWAO diese Schritte problemlos und erzeugt weiterhin alle anderen Ausgaben.

### Schritt 7 -- Bereit

Bestaetigt, dass der Workspace vollstaendig konfiguriert ist, und zeigt die naechste
empfohlene Aktion an (in der Regel "Bewertung durchfuehren" oder "Health Check").

---

## Nach der Einrichtung

Nach Abschluss der Einrichtung enthaelt Ihr Workspace:

- `.swao.yml` -- die Workspace-Konfigurationsdatei. Oeffnen Sie diese, um Einstellungen zu
  pruefen oder zu aendern.
- `wsp/inputs/catalogs/community/` -- die installierten Compliance-Framework-YAML-Dateien.
- `wsp/templates/powerbi/` -- die Power-BI-`.pbit`-Vorlagendateien fuer Einzel- und
  Portfolio-Berichte.
- `apps/<app-id>/ingestion/` -- der Ablageordner fuer Kontextdokumente (Architekturreviews,
  CMDB-Exporte, Workshop-Transkripte).

---

## Einrichtung wiederholen

Sie koennen die Einrichtung jederzeit wiederholen. Sie erkennt bestehende Konfigurationen
und bietet an, einzelne Schritte zu aktualisieren, ohne den Rest zu ueberschreiben. Dies
ist nuetzlich, wenn Sie einen API-Schlussel rotieren, einen neuen LLM-Anbieter hinzufuegen
oder MCP nach einem Claude-Desktop-Update neu verbinden moechten.
