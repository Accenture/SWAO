# Migrationswellen-Generator

Nach jedem Lauf von `swao service research` setzt SWAO die TIME-Empfehlungen in einen Migrationsfahrplan mit fünf Wellen um. Jede Service-App landet in genau einer Welle. Der Fahrplan erscheint in `wsp/reports/migration-waves-YYYYMMDD.md` (und `.csv`), in `wsp/portfolio-summary.json`, im Engagement-Hub (Baustein Migration Roadmap) und im Blatt Migration Waves der Enterprise-Arbeitsmappe (`swao service export`).

## Die fünf Wellen

| Welle | Bezeichnung | Zeithorizont | Wer hierher gehört |
|---|---|---|---|
| 1 | Eliminate | Sofort | Als Eliminate eingestufte Apps: ablösen, stilllegen oder abschalten |
| 2 | Migrate: Critical | Nächste 3 Monate | Migrate-Critical-Apps sowie Migrate-Apps, deren Supportende überschritten ist oder die Gesundheitsdaten bzw. Daten nach DSGVO Art. 9 verarbeiten |
| 3 | Migrate: Standard | 3 bis 12 Monate | Alle übrigen Migrate-Apps |
| 4 | Invest | 12 bis 24 Monate | Als Invest eingestufte Apps |
| 5 | Tolerate | Beobachten | Als Tolerate eingestufte Apps; kein Aufwand eingeplant |

Der TIME-Quadrant bestimmt die Welle; siehe die [TIME-Regeln](/de/service-assessment/framework#time-einordnung). Welle 2 zieht sensible Migrate-Apps bewusst vor: Eine Anwendung jenseits des Supportendes oder mit besonderen Kategorien personenbezogener Daten soll nicht in der Standardwarteschlange warten.

## Reihenfolge innerhalb einer Welle: Blast Radius

Ein System zu verlagern, von dem viele andere abhängen, ist riskanter als ein Randsystem. SWAO baut deshalb aus dem Feld `integrations` jeder App einen Integrationsgraphen (Cluster-Mitglieder werden ihrem Cluster zugeordnet) und berechnet für jede App:

- **Fan-in**: wie viele Portfolio-Apps von ihr abhängen.
- **Blast-Radius-Wert**: `Fan-in x 10` + ein TIME-Gewicht (Migrate oder Migrate-Critical 5, Invest 3, Tolerate 1, Eliminate 0) + ein Zuschlag für das Supportende (überschritten 20, innerhalb von 18 Monaten 10).
- **Blast-Radius-Stufe**: HIGH ab 30, MEDIUM ab 10, sonst LOW.

In den Wellen 2 bis 5 werden Apps nach Fan-in sortiert, niedrigster zuerst: Integrationsknoten ziehen **zuletzt** in ihrer Welle um, nachdem die aufrufenden Systeme vorbereitet sind. In Welle 1 werden Apps nach dem Blast-Radius-Wert sortiert, niedrigster zuerst, sodass die unkritischen Stilllegungen zuerst erfolgen.

SWAO warnt, wenn die Reihenfolge einen Konflikt erzeugt:

- Eine App wird in Welle 1 abgelöst, obwohl eine andere App von ihr abhängt: zuerst die abhängige App umkonfigurieren.
- Eine App mit HIGH Blast Radius ist in einer früheren Welle eingeplant als eine von ihr abhängige App: prüfen, ob die abhängige App bereit ist.

Verweise auf IDs, die nicht im Portfolio stehen, bleiben als offene Verweise im Integrationsgraphen zur Prüfung durch die Analyse erhalten.

## Aufwandsschätzung

Jede App in den Wellen 1 bis 4 trägt einen groben Aufwand in Tagen, der pro Welle summiert wird:

| App | Tage |
|---|---|
| VDI-Cluster (`INFRA_WORKPLACE_VDI`, zusammengefasster Cluster) | 2 |
| Medizinisches System mit MDR-Klassifizierung | 15 |
| Plattformkategorie (Betriebssysteme, eigenständige Datenbanken) | 5 |
| Alles andere | 3 |

Welle 5 (Tolerate) hat keinen Aufwand. Die Werte sind Planungsanker für einen ersten Fahrplan, keine Projektschätzung.

## Beispiel

Ein fiktives Portfolio aus zehn Apps ergibt diesen Plan:

| Welle | Apps in Reihenfolge | Aufwand (Tage) |
|---|---|---|
| 1 Eliminate | `app-old-02`, `app-old-01` | 6 |
| 2 Migrate: Critical | `app-pacs-01` (KEV-Treffer), `app-lab-03` (Gesundheitsdaten), `app-print-07` (Supportende überschritten) | 9 |
| 3 Migrate: Standard | `app-crm-04`, `app-int-hub` (Fan-in 4, HIGH Blast Radius, zuletzt) | 6 |
| 4 Invest | `app-portal-05` | 3 |
| 5 Tolerate | `app-wiki-08`, `app-mail-09` | 0 |

Für diesen Plan ausgegebene Warnung: `app-old-01 is eliminated in wave 1 but app-crm-04 depends on it; reconfigure app-crm-04 before decommissioning`.

## Wo Sie den Plan sehen

- **Bericht**: `wsp/reports/migration-waves-YYYYMMDD.md` mit einer Übersichtstabelle pro Welle und eine CSV-Datei für Tabellenkalkulationen
- **Engagement-Hub**: Die Bausteine Migration Roadmap, Integration Hubs und Vendor Landscape erscheinen in `apps/engagement-hub.html`, wenn der Workspace Service-Apps enthält
- **Enterprise-Arbeitsmappe**: die Blätter Migration Waves und Migration Candidates in `swao-portfolio-YYYYMMDD.xlsx` (siehe [Befehlsreferenz](/de/service-assessment/commands#swao-service-export-enterprise))
- **Delta-Verfolgung**: Veränderungen zwischen Läufen erscheinen in `wsp/reports/portfolio-delta-YYYYMMDD.md` als Änderungen bei TIME, Supportende und Risiko

Apps ohne Service-Assessment-Lauf behalten ihre Welle, werden aber in jeder Ansicht als nicht bewertet markiert, weil ihre Welle nur auf Intake- und Recherchedaten beruht: die Spalte `Assessment` im Markdown-Bericht, die letzte CSV-Spalte `evidence` (`not_assessed`), ein Kennzeichen "Nicht bewertet" in den Bausteinen Migration Roadmap, Integration Hubs und Vendor Landscape sowie die Spalte `Evidence` in den Blättern der Arbeitsmappe (`evidence` im Sternschema).
