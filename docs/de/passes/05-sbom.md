# Pass 05: Abhängigkeiten und Schwachstellen (SBOM)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 05 |
| Schlüssel | `sbom` |
| Pass-Name in der Ausgabe | `sbom_cve` |
| Signal-Präfix | `SBOM` |
| Typ | Deterministisch (Regel-Engine) mit optionaler Online-Schwachstellenabfrage, kein LLM |
| Standard | Aktiv |
| Assessment-Typen | `application`; `llm` (innerhalb jedes Legs); `service` (bedingt: läuft, wenn mit den Binärdateien ein CycloneDX- oder SPDX-SBOM geliefert wird). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Drittanbieter-Pakete bringen bekannte Schwachstellen und Wartungsrisiken auf jede Zielplattform mit. Pass 05 beantwortet die Frage: **„Enthalten die Abhängigkeiten der Anwendung bekannte Schwachstellen oder verwaiste Pakete, und wird die Laufzeitumgebung noch unterstützt?“**

Es handelt sich um eine schnelle Vorprüfung, nicht um eine vollständige Software-Composition-Analyse. Der Pass prüft Abhängigkeiten stichprobenartig gegen die öffentliche OSV-Schwachstellendatenbank, markiert Pakete, die als nicht mehr gewartet bekannt sind, meldet den Supportstatus der Node.js-Laufzeit und hält stets fest, dass ein vollständiger SBOM-Scan als Voraussetzung vor der Migration erforderlich ist.

## Was Sie bereitstellen müssen

- Den Quellcode der Anwendung mit einer oder mehreren `package.json`-Dateien und/oder
- einen externen SBOM direkt in `wsp/inputs/compliance/` (nicht in einem Unterordner):
  - CycloneDX-JSON: `*.cdx.json`
  - Tabellenexporte: `SBOM-*.xlsx.*.csv` (die CSV je Arbeitsblatt, die [Pass 00](/de/passes/00-ingest) aus einer direkt in `ingestion/` abgelegten Datei `SBOM-*.xlsx` erzeugt) oder `*.sbom.csv`. Die CSV benötigt eine Kopfzeile mit einer Namensspalte (`packageName`, `name` oder `component`) und optional einer Versionsspalte (`version` oder `ver`); Komma und Semikolon als Trennzeichen werden beide akzeptiert.
  Damit eine CycloneDX-Datei über [Pass 00](/de/passes/00-ingest) hierher gelangt, muss ihr Name `sbom` oder `bom` enthalten (zum Beispiel `app-sbom.cdx.json`) und sie muss direkt in `ingestion/` liegen, nicht in einem Unterordner; andernfalls landet sie in `structured/`, und dieser Pass liest sie nicht.
- oder einen SBOM im Quellbaum: CycloneDX (`*.cdx.json`, `bom.json`, `sbom.json`) oder SPDX (`*.spdx.json` oder Tag-Value `*.spdx`), bis zu drei Ordnerebenen unterhalb des Quellverzeichnisses (höchstens 20 Dateien; `node_modules` und versteckte Ordner werden übersprungen). In einem [Service Portfolio Assessment](/de/service-assessment/) ist das Quellverzeichnis der Ordner mit den Binäreingaben; ein mit den Installationspaketen gelieferter SBOM wird also dort gelesen.
- Netzwerkzugang zu `https://api.osv.dev` für die Schwachstellenabfrage oder einen erreichbaren OSV-kompatiblen Spiegel. Ohne Zugang läuft der Pass trotzdem und vermerkt, dass die Abfrage übersprungen wurde.

## Wie der Pass arbeitet

1. **Externe SBOMs lesen** aus der obersten Ebene von `wsp/inputs/compliance/` sowie die CycloneDX- und SPDX-Dateien im Quellbaum, und Komponentennamen sowie Versionen sammeln.
2. **`package.json`-Dateien finden.** Liegt eine im Wurzelverzeichnis, wird nur diese verwendet. Andernfalls sucht der Pass bis zu vier Verzeichnisebenen tief (ohne `node_modules` und versteckte Ordner) und verwendet höchstens fünf Dateien; damit sind typische Monorepos abgedeckt.
3. **Abhängigkeiten zusammenführen.** `dependencies` und `devDependencies` aller Dateien werden zusammengeführt; die Laufzeit-`dependencies` werden separat gehalten. Externe SBOM-Komponenten werden der zusammengeführten Liste hinzugefügt.
4. **Schwachstellen stichprobenartig prüfen.** Die **ersten zehn Laufzeitabhängigkeiten** werden einzeln bei der OSV-API abgefragt (`POST /v1/query`, Ökosystem `npm`, Version ohne Bereichspräfixe wie `^` oder `~`, 3 Sekunden Timeout je Abfrage). Externe SBOM-Komponenten werden nicht abgefragt, um ökosystemfremde Abfragen zu vermeiden. Jeder OSV-Eintrag wird anschließend nach Schweregrad eingestuft: zuerst nach der Bewertung der Advisory-Datenbank (`CRITICAL`, `HIGH`, `MODERATE`, `LOW`), sonst nach einem numerischen Wert, sonst durch Berechnung des Basiswerts aus einem CVSS-v3-Vektor (ab 9,0 critical, ab 7,0 high, ab 4,0 medium, über 0 low). Ein Eintrag ohne diese Angaben gilt als `unknown`.
5. **Auf nicht gewartete Pakete prüfen**: Die zusammengeführte Liste wird mit einer eingebauten Liste von sechs Paketen abgeglichen: `alphavantage`, `left-pad`, `event-stream`, `node-uuid`, `csurf`, `request`.
6. **Laufzeit bewerten** anhand des ersten gefundenen Werts von `engines.node`: Hauptversion 22 oder höher ist `active_lts`, 20 bis 21 ist `maintenance_lts`, unter 20 ist `eol`.

## Wie gemessen wird

| Signal | Wird erzeugt, wenn | Schweregrad | Bedeutung |
|---|---|---|---|
| `SBOM-01` (vorzeitiger Abbruch) | Keine `package.json` und kein externer SBOM | high | Abhängigkeitsscan nicht möglich; der Pass endet hier mit `scan_type: skipped` |
| `SBOM-00` | Mindestens eine Abhängigkeit sollte abgefragt werden, und OSV war für keine davon erreichbar oder `SWAO_OSV_OFFLINE=true` ist gesetzt | low | CVE-Daten nicht verifiziert; vor dem Produktivbetrieb ist ein manueller SBOM-Scan erforderlich |
| `SBOM-01` | Normaler Lauf | high, wenn ein geprüftes Paket mindestens einen OSV-Eintrag mit Schweregrad high oder critical hat; medium, wenn Pakete nur niedrigere oder nicht eingestufte Einträge haben; informational, wenn keine Laufzeitabhängigkeit geprüft wurde (zum Beispiel bei reiner SBOM-Eingabe), weil nichts verifiziert wurde; sonst positive | Ergebnis der Stichprobe: Anzahl geprüfter Abhängigkeiten, Abfragestatus, Anzahl betroffener Pakete, Hinweis, dass ein vollständiger Scan Voraussetzung vor der Migration ist |
| `SBOM-02` und folgende | Je gefundenem nicht gewartetem Paket | medium | Paket wird nicht mehr gewartet (CWE-1104, Nutzung nicht gewarteter Drittkomponenten); vor dem Produktivbetrieb ersetzen |
| Nächste Nummer nach den nicht gewarteten Paketen | Bei jedem normalen Lauf | high (`eol`), low (`maintenance_lts`), sonst positive | Supportstatus der Node.js-Laufzeit |

Die Nummerierung ist dynamisch: Bei zwei nicht gewarteten Paketen heißen diese `SBOM-02` und `SBOM-03`, das Laufzeitsignal ist dann `SBOM-04`.

Der `assessment`-Block enthält `scan_type` (`osv_spot_check` oder `static_analysis`), `cve_lookup` (`completed` oder `skipped`), `full_scan_required: true`, `full_scan_gate: pre_migration`, `critical_cves_found` (Anzahl geprüfter Pakete mit mindestens einem OSV-Eintrag mit Schweregrad high oder critical), `vulnerable_packages_found` (geprüfte Pakete mit irgendeinem OSV-Eintrag), `known_vulnerabilities_found` (Gesamtzahl der OSV-Einträge), `dependency_count`, `unmaintained_packages`, `external_sbom_files`, `external_sbom_component_count`, `runtime`, `node_constraint` und `node_eol_status`.

**Wie die Ergebnisse in spätere Passes einfließen.** SBOM-Signale sind Evidenz für Controls zu Lieferkette und Schwachstellenmanagement, die Pass 11 (COMP) bewertet (zum Beispiel unter NIS2, DORA oder dem EU Cyber Resilience Act, wenn diese in `assessment.regimes_active` aktiv sind), sowie für [Pass 09 (SYNTH)](/de/passes/09-synth). Ein `SBOM-01` mit Schweregrad high wird zu einem abgeleiteten Sicherheits-Finding. Für einen vollständigen Schwachstellen- und Secret-Scan nutzen Sie den optionalen Malware-Pass, beschrieben unter [Malware-Scan](/de/malware-scanning).

## Drittanbieter-Module und Werkzeuge

| Name | Zweck in diesem Pass | Lizenz (Paket-Metadaten) | Gebündelt oder extern | Verhalten bei Fehlen |
|---|---|---|---|---|
| OSV-API (`api.osv.dev`) | Schwachstellenabfrage für die ersten zehn Laufzeitabhängigkeiten | Externer Dienst; Lizenz im Repository nicht erfasst | Extern, Netzwerkzugang | `SBOM-00` (low) wird erzeugt; `cve_lookup: skipped` |

Der Pass nutzt das in Node.js eingebaute `fetch` sowie eigene Leser für CSV, CycloneDX-JSON und SPDX (JSON und Tag-Value). Er ruft weder OSV-Scanner noch Syft, Trivy oder ein anderes Kommandozeilenwerkzeug auf.

## Ausgaben

- `wsp/runs/<ts>/passes/05-sbom.yaml` mit Kopf (`id: 5`, `name: sbom_cve`), Signalen und `assessment`.
- Ein Eintrag `assess.pass.sbom.external-inputs-found` im App-Ereignisprotokoll, wenn externe SBOM-Dateien geladen wurden.

## Konfiguration und Einschränkungen

**Konfiguration**

| Einstellung | Wirkung |
|---|---|
| `SWAO_OSV_BASE_URL` | Basis-URL eines OSV-kompatiblen Spiegels für abgeschottete oder souveräne Umgebungen (Standard `https://api.osv.dev`) |
| `SWAO_OSV_OFFLINE=true` | Alle OSV-Abfragen überspringen; `SBOM-00` erläutert dies |
| `--passes sbom` | Pass allein ausführen |

**Einschränkungen und bekannte Lücken**

- Geprüft werden nur zehn Laufzeitabhängigkeiten und nur im npm-Ökosystem. Das ist eine Stichprobe, kein vollständiger Scan; der Pass weist in jedem Ergebnis darauf hin.
- Externe SBOM-Komponenten werden nur gegen die Liste nicht gewarteter Pakete geprüft, nicht gegen OSV. Manifeste für Python, Java, Go oder Rust werden nicht gelesen.
- Das Laufzeitsignal setzt Node.js voraus. Fehlt eine Vorgabe `engines.node`, ist der Status `unknown`, der Schweregrad des Signals aber `positive`; lesen Sie in diesem Fall den Ableitungstext statt des Schweregrads.
- SPDX-Dateien werden nur aus dem Quellbaum gelesen; in `wsp/inputs/compliance/` werden nur CycloneDX-JSON und die CSV-Exporte gelesen.
- Dieser Pass nimmt keine Lizenzklassifizierung vor.
