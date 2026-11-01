# Befehlsreferenz

Alle Befehle der Service-Portfolio-Bewertung arbeiten auf einem SWAO-Workspace: einem Ordner mit einer Workspace-`.swao.yml` und einem Ordner `apps/`. Ohne `--workspace` verwendet SWAO die nächstgelegene `.swao.yml` oberhalb des aktuellen Verzeichnisses. Keiner der Befehle fragt nach Eingaben; fehlt etwas oder ist es nicht eindeutig, brechen sie mit einer Fehlermeldung ab und eignen sich daher für CI.

## swao service init

Legt pro Intake-Zeile einen App-Ordner an.

```bash
swao service init [--from <intake.xlsx>] [--mapping <column-map.yaml>] [--workspace <dir>] [--refresh] [--replace | --keep] [--cluster-threshold <n>] [--json]
```

| Option | Bedeutung |
|---|---|
| `--from <xlsx>` | Intake-Arbeitsmappe. Ohne diese Option verwendet SWAO die einzige `.xlsx`-Datei in `wsp/inputs/service-intake/` des Workspace; Excel-Sperrdateien (`~$...`) werden ignoriert. Liegt dort keine oder mehr als eine Arbeitsmappe, bricht der Befehl mit einer Fehlermeldung ab, die das Gefundene nennt. |
| `--mapping <yaml>` | Spaltenzuordnung für einen Aufbau, den die Erkennung über die Kopfzeile nicht abdeckt. Ohne diese Option, und wenn `--from` fehlt, verwendet SWAO eine Spaltenzuordnung neben der Arbeitsmappe in `wsp/inputs/service-intake/` (eine `.yaml`- oder `.yml`-Datei, deren Name `column-map` oder `columnmap` enthält), sofern genau eine vorhanden ist; andernfalls erkennt SWAO die Spalten aus der Kopfzeile. Siehe [Spaltenzuordnung](/de/service-assessment/column-mapping). |
| `--workspace <dir>` | Workspace-Wurzel. Fehlt dort eine `.swao.yml`, wird sie angelegt. |
| `--refresh` | Bestehende Service-Apps aus der Arbeitsmappe aktualisieren. Nur die in `generated_fields` jeder App aufgeführten Schlüssel werden neu geschrieben; Ihre manuellen Änderungen an anderer Stelle bleiben erhalten. Siehe [Sicher bearbeiten](/de/service-assessment/configuration#sicher-bearbeiten). |
| `--replace` | Der Workspace enthält bereits Service-Apps aus einer anderen Intake-Arbeitsmappe: Diese App-Ordner werden nach `parked-apps/<Zeitstempel>/` verschoben (nichts wird gelöscht), danach wird diese Arbeitsmappe angelegt. |
| `--keep` | Der Workspace enthält bereits Service-Apps aus einer anderen Intake-Arbeitsmappe: Die Apps dieser Arbeitsmappe werden daneben angelegt. Services, die beide Arbeitsmappen beschreiben, erscheinen dann doppelt. |
| `--cluster-threshold <n>` | Mindestanzahl identischer Zeilen, die einen Cluster bilden (Standard 3, oder `service_portfolio.cluster_threshold`). |
| `--json` | Maschinenlesbares Ergebnis. Enthält keine personenbezogenen Werte. |

Ablauf in dieser Reihenfolge:

1. Liest alle Tabellenblätter, ermittelt den Spaltenaufbau und wandelt Werte um (Zahlen, Wahrheitswerte, Kapazitätsangaben wie `16 GB`).
2. Bereinigt personenbezogene Daten: Spalten mit Ansprechpartner, Telefon und E-Mail werden auf Wahr/Falsch-Kennzeichen reduziert; Herstellernamen, die wie ein Personenname aussehen, werden geschwärzt.
3. Bricht mit einem Fehler ab, wenn zwei Zeilen dieselbe App-ID tragen (es wird kein Ordner geschrieben).
4. Bricht mit einem Fehler ab, wenn der Workspace bereits Service-Apps aus einer anderen Intake-Arbeitsmappe enthält (es wird kein Ordner geschrieben). Die Meldung nennt die andere Arbeitsmappe, die Anzahl der Apps und die Optionen `--replace`, `--keep` oder einen neuen Workspace. Das gilt auch für `--refresh`. Eine Arbeitsmappe mit demselben Dateinamen (eine bearbeitete Fassung) oder demselben Inhalt (eine umbenannte Kopie) gilt als dieselbe Arbeitsmappe. Jede App hält ihre Arbeitsmappe in `intake.source` (nur Dateiname) und `intake.source_sha256` fest.
5. Klassifiziert jede Zeile gegen SWAO-INFRA-CAT und fasst identische Zeilen clusterfähiger Kategorien (zum Beispiel VDI-Worker) zu einer Cluster-App zusammen.
6. Schätzt die Cloud-Kosten für Lift-and-Shift aus den Hardware-Spalten.
7. Schreibt `apps/<id>/.swao.yml`, pro App einen leeren Ablageordner `apps/<id>/ingestion/` (ohne weitere Unterordner), `wsp/signals/scaffold-signals.json` und den Block `service_portfolio:` in der Workspace-`.swao.yml`.

Die Zusammenfassung nennt pro Blatt die erkannten Spalten (Feld und Spaltenbuchstabe sowie die Herkunft: Erkennung über die Kopfzeile oder Spaltenzuordnung) und warnt, wenn keine Spalte für das Betriebssystem (End-of-Life-Recherche), den App-Namen (CVE- und Warnmeldungsrecherche) oder den Hersteller (CVE-Recherche) gefunden wurde. Danach nennt sie die SCAFFOLD-Signale und jede App, die SWAO nicht klassifizieren konnte; ordnen Sie dort `infra_category` manuell zu.

Bestehende Service-Apps, die diese Intake-Datei nicht mehr erzeugt, werden aufgelistet und nicht verändert. Das geschieht, wenn Zeilen aus der Arbeitsmappe entfernt wurden oder eine neuere SWAO-Version die App-IDs anders ableitet (siehe [Wie SWAO die ID-Zelle liest](/de/service-assessment/column-mapping#wie-swao-die-id-zelle-liest)). Löschen Sie diese App-Ordner oder legen Sie die Apps in einem neuen Workspace an, damit das Portfolio nur eine Generation von Apps enthält.

## swao service research

Führt Pass 24 RESEARCH für alle Service-Apps (oder eine) aus und erstellt anschließend die Portfolio-Zusammenfassung neu.

```bash
swao service research [--app <id>] [--workspace <dir>] [--refresh] [--dry-run] [--skip-llm] [--json]
```

| Option | Bedeutung |
|---|---|
| `--app <id>` | Nur eine App recherchieren |
| `--refresh` | Alle Quellen erneut abfragen, auch wenn zwischengespeicherte Ergebnisse noch aktuell sind. Von einer Analystin oder einem Analysten als geprüft markierte Stubs werden nie überschrieben. |
| `--dry-run` | Zeigt, welche Stubs angelegt oder aktualisiert würden; keine Anfragen, keine Schreibvorgänge |
| `--skip-llm` | Die vier LLM-Themen in diesem Lauf überspringen: kein LLM-Aufruf, und der konfigurierte Provider wird nicht aufgebaut. Themen ohne frühere Erkenntnisse werden als `skipped` mit `skipped_by_user` geschrieben; frühere LLM-Erkenntnisse für denselben Hersteller, dasselbe Produkt und dieselbe Version bleiben erhalten. Die Terminal-Oberfläche stellt dieselbe Frage vor der Frage nach dem Umfang. |
| `--json` | Ergebnis als JSON ausgeben |

Quellen und Cache-Dauer: NVD (7 Tage), CISA KEV (1 Tag), OSV.dev (7 Tage), BSI CERT-Bund (1 Tag), endoflife.date (30 Tage), VirusTotal (7 Tage), Workspace-LLM (30 Tage). Details unter [Pass 24 RESEARCH](/de/passes/24-research). API-Schlüssel: [Optionale API-Schlüssel](/de/service-assessment/api-keys).

Nach der Recherche gibt SWAO die Verteilung der Gesamtkonfidenz aus (das schwächste Thema pro App; Apps ohne recherchierbare Angaben werden gesondert gezählt), eine Zeile pro Thema (`cve-summary`, `eol-status`, `virustotal` und die vier LLM-Themen, wenn ein LLM sie recherchiert hat), den verwendeten LLM-Provider und das Modell (oder warum die LLM-Themen übersprungen wurden) und die Anzahl der RESEARCH-Signale. Danach erstellt SWAO `wsp/portfolio-summary.json`, den Integrationsgraphen und den Wellenbericht neu, nennt die wichtigsten Integrationsknoten und schreibt einen Delta-Bericht gegenüber dem vorherigen Snapshot.

Ein Thema ohne recherchierbare Angaben (CVE-Recherche ohne Hersteller, Produktname und OSV-Paket; End-of-Life-Recherche ohne Betriebssystem) wird als `skipped` festgehalten, nicht als Ergebnis mit niedriger Konfidenz. Die CVE-Recherche in der NVD benötigt einen Herstellernamen: Hat die Intake-Datei keine Herstellerspalte, tragen Sie `vendor.name` in `apps/<id>/.swao.yml` ein (siehe [Sicher bearbeiten](/de/service-assessment/configuration#sicher-bearbeiten)) und führen Sie `swao service research --app <id> --refresh` aus.

**LLM-gestützte Recherche (alle Tiers).** Ist für den Workspace ein LLM konfiguriert (`providers.llm` in `.swao.yml` oder `SWAO_LLM_CONNECTOR` / `SWAO_LLM_PROVIDER`, wie bei `swao assess`), recherchiert der Befehl zusätzlich `vendor-profile`, `certifications`, `data-residency` und `breach-history`. Jede Erkenntnis enthält die vom Modell genannten Quell-URLs, als nicht verifiziert markiert, und eine Konfidenz; die Konfidenz des Themas ist höchstens `medium`, bis eine Analystin oder ein Analyst den Stub geprüft hat. Gesendet werden nur Herstellername, Produktname, Version und die INFRA-CAT-Kategorie, und der Prompt durchläuft dieselbe PII-Redaktion wie jeder andere LLM-Aufruf. Ohne LLM werden diese Themen als `skipped` mit `no_llm_configured` geschrieben, mit `--skip-llm` als `skipped_by_user`. Erkenntnisse aus `breach-history`, die einen Vorfall melden, erzeugen das RESEARCH-Signal `RES-09` (`VENDOR.BREACH_HISTORY`); explizite Fakten aus Prompt-Version 1.1 erzeugen `RES-10` bis `RES-14` (langsamer Patch-Rhythmus, keine EU-Gesellschaft, kein DSGVO-Art.-9-AVV, MDR-Klasse nicht veröffentlicht, nicht in der BfArM-Datenbank), alle höchstens medium und als vom Modell genannt und nicht verifiziert gekennzeichnet. Stubs aus Prompt-Version 1.0 erhalten diese Fakten nach `--refresh` oder wenn sie ablaufen. Siehe [Pass 24 RESEARCH](/de/passes/24-research).

In abgeschotteten Umgebungen lassen sich die Quell-Endpunkte mit `SWAO_NVD_BASE_URL`, `SWAO_EOL_BASE_URL`, `SWAO_KEV_URL`, `SWAO_BSI_RSS_URL`, `SWAO_OSV_BASE_URL` und `SWAO_VT_BASE_URL` auf interne Spiegel umleiten.

## swao service rank

Listet die Service-Apps in der Reihenfolge auf, in der sie bewertet werden sollten. Nur lesend.

```bash
swao service rank [--top <n>] [--workspace <dir>] [--json]
```

| Option | Bedeutung |
|---|---|
| `--top <n>` | Nur die ersten n Apps |
| `--json` | Die gereihten Apps (ID, Name, Risikowert, Fan-in, TIME-Quadrant, Betriebsstatus, Evidenz) als JSON ausgeben |

Die Reihenfolge: höchster SWAO_APM-Risikowert zuerst (Apps ohne Wert zuletzt), dann der höhere Integrations-Fan-in, dann die App-ID. Apps ohne Service-Assessment-Lauf behalten ihren Platz, sind aber mit `[not assessed]` markiert (JSON: `evidence: not_assessed`): Ihr Risikowert und ihr TIME-Quadrant stammen nur aus Intake und Recherche. Apps mit dem Betriebsstatus `decommissioned`, `unused` oder `inactive` werden ausgelassen; sie sind Eliminate-Kandidaten ohne Bewertung. Die Reihung liest `wsp/portfolio-summary.json` und ist daher nach `swao service research` aussagekräftig; ohne Zusammenfassung werden alle Service-Apps in ID-Reihenfolge aufgeführt. Die Terminal-Oberfläche verwendet dieselbe Reihung für ihren Umfang "top 20". In CI durchlaufen Sie das Ergebnis und führen für jede App `swao assess --app <id> --type service` aus:

```bash
for id in $(swao service rank --top 20 --json | jq -r '.apps[].id'); do
  swao assess --app "$id" --type service
done
```

## swao assess --type service

Führt das Service-Pass-Profil für eine App aus (oder mit `--portfolio` für alle Apps, Enterprise).

```bash
swao assess --app <id> --type service
```

Quellcode-Passes werden übersprungen und in der Scope-Abdeckung als UNKNOWN geführt, nicht als Fehler. Pass 25 BINARY läuft zuerst, wenn Installationspakete vorhanden sind; Daten, Kryptografie (auf Binärdateien und Konfiguration), Compliance und Bausteinbewertung laufen wie in einer Anwendungsbewertung. Der Lauf aktualisiert `apps/<id>/wsp/latest-service.txt` und die Portfolio-Zusammenfassung. Eine Anwendungsbewertung (`swao assess --app <id>`) erstellt `wsp/portfolio-summary.json` ebenfalls neu, sodass Anwendungs-Apps mit ihrem letzten Lauf in der kombinierten Portfolio-Sicht erscheinen. Die Neuerstellung folgt auf einen Lauf, der vollständig oder teilweise abgeschlossen wurde; schlägt sie fehl, gibt SWAO eine Warnung aus und das Ergebnis des Laufs bleibt unverändert. Welche Passes im Service-Modus laufen, zeigt die [Pass-Übersicht](/de/passes/).

Nachdem Sie Dokumente oder Installationspakete in `apps/<id>/ingestion/` abgelegt haben, führen Sie den Befehl erneut aus: Pass 00 INGEST übernimmt neue und geänderte Dateien und meldet, wie viele Dokumente neu, geändert oder unverändert sind. Siehe [Dokumente und Installationspakete ablegen](/de/service-assessment/#dokumente-und-installationspakete-ablegen).

## swao service export (Enterprise)

```bash
swao service export [--workspace <dir>] [--json]
```

Erstellt die Portfolio-Zusammenfassung neu und schreibt:

- `wsp/reports/swao-portfolio-YYYYMMDD.xlsx`: 14 Blätter (Portfolio Overview, Hardware Inventory, CVE Register, EoL Calendar, Framework Compliance, Data Register, Cost vs Risk, Integration Map, Migration Candidates, Migration Waves, Vendor Consolidation, Action Register, DORA ICT Register, Source Data)
- `wsp/star-schema/portfolio-*.json`: 9 Tabellen für BI-Werkzeuge

Erfordert eine Enterprise-Lizenz (Funktionen `service-excel` und `bi-export`). Die PowerBI-Vorlagen in SWAO decken nur Daten der Anwendungsbewertung ab; für Service-Portfolio-Daten nutzen Sie die Arbeitsmappe oder das Star-Schema.

## swao health-check

Die Probes 17 bis 25 prüfen einen Service-Workspace: Intake-Zuordnung, SWAO_APM-Gewichte, Workspace-Struktur, Aktualität der Recherche, Tier-2-Katalog, Cluster, eine PII-Prüfung, Snapshots und den Kontrollsatz von SWAO_APM. Siehe [Health Check](/de/health-check).

## swao support-bundle

In einem Service-Workspace enthält das Support-Bundle zusätzlich Scaffold-Signale, die Portfolio-Zusammenfassung, die Spaltenzuordnung, Tier-2-Katalogdateien, die Front-Matter der Recherche-Stubs, Konfidenzdateien und die Binäranalyse, nach einem zweiten Bereinigungsdurchgang für personenbezogene Daten, der in `redaction-log.txt` dokumentiert wird.
