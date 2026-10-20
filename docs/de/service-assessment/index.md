# Service-Portfolio-Bewertung

![Banner Service-Portfolio-Bewertung: eine Intake-Tabelle speist ein Recherche-Radar, das eine Portfolio-Arbeitsmappe mit TIME-Quadrant erzeugt](/visuals/banner-service-portfolio.svg)

Die Service-Portfolio-Bewertung (Bewertungstyp `service`, neu in v1.4.0) bewertet die Anwendungen, die Sie **kaufen, mieten oder betreiben, aber nicht selbst entwickeln**: Drittanbieter-Software, Standardprodukte (COTS), SaaS-Dienste, Appliances und Altserver. Quellcode wird nicht benötigt. Als Eingabe dient das Anwendungsinventar, das Sie bereits als Tabelle oder CMDB-Export pflegen.

Für jede Anwendung recherchiert SWAO öffentliche Schwachstellen- und End-of-Life-Daten, analysiert bereitgestellte Installationspakete, bewertet die Anwendung in elf Portfolio-Domänen und empfiehlt eine **TIME**-Einordnung. Über das gesamte Portfolio hinweg erstellt SWAO einen Integrationsgraphen, plant Migrationswellen, zeigt Konsolidierungspotenzial bei Herstellern auf und verfolgt Veränderungen zwischen zwei Läufen.

## Was Sie damit tun können

- **Einen großen Bestand schnell sichten.** Aus einer Server- oder Anwendungsliste mit 300 Zeilen wird an einem Nachmittag eine priorisierte, belegte Portfolio-Sicht, statt wochenlanger Interviews.
- **Die dringenden Fälle finden.** Anwendungen mit einer aktiv ausgenutzten Schwachstelle (CISA KEV), kritischen CVEs oder einem Betriebssystem jenseits des Supportendes werden als **Migrate-Critical** eingestuft und nach den Stilllegungen in die erste Migrationswelle eingeplant.
- **Entscheiden, was bleibt, ausgebaut, verlagert oder abgelöst wird.** Jede Anwendung erhält eine TIME-Empfehlung mit verständlicher Begründung, neben der TIME-Einschätzung der Analystin oder des Analysten aus der Intake-Tabelle (diese wird nie überschrieben).
- **Ein Migrationsprogramm planen.** Ein Fünf-Wellen-Fahrplan ordnet Anwendungen nach Dringlichkeit und Abhängigkeiten, sodass Integrationsknoten erst nach den von ihnen abhängigen Anwendungen umziehen.
- **Souveränitäts- und Herstellerentscheidungen vorbereiten.** Jede Anwendung wird gegen den SWAO-Infrastrukturkatalog (INFRA-CAT) klassifiziert, der souveräne und Open-Source-Alternativen nennt; Hersteller werden gruppiert, um Konsolidierungschancen sichtbar zu machen.
- **Cloud-Kosten für Lift-and-Shift schätzen.** CPU, Arbeitsspeicher und Speicherplatz aus der Intake-Tabelle werden auf Azure- und AWS-VM-Größen abgebildet, standardmäßig in Euro.
- **An Stakeholder berichten.** HTML-Seiten pro Anwendung, ein Engagement-Hub mit Portfolio-Bausteinen und (Enterprise) eine Excel-Arbeitsmappe mit mehreren Blättern sowie ein Star-Schema-Export.

## Was TIME bedeutet

TIME ist das Anwendungsportfolio-Modell von Gartner. SWAO ergänzt eine zusätzliche Dringlichkeitsstufe:

| Quadrant | Bedeutung | Typischer Auslöser in SWAO |
|---|---|---|
| **Tolerate** (tolerieren) | Unverändert weiterbetreiben; keine Investition über die Wartung hinaus | Im Support, kein übergeordnetes Risiko |
| **Invest** (investieren) | Strategisch und gesund; lohnt die Weiterentwicklung | Strategische Passung, technischer Zustand und Herstellerzustand jeweils über 70 |
| **Migrate** (migrieren) | Innerhalb des Planungshorizonts auf eine neue Plattform oder einen Nachfolger verlagern | Supportende innerhalb von 36 Monaten, oder schwacher Hersteller- bzw. technischer Zustand bei guter Migrationsbereitschaft |
| **Migrate-Critical** (dringend migrieren) | Sofort verlagern; das Risiko ist bereits erheblich | CISA-KEV-Treffer, kritische CVE mit Supportende innerhalb von 12 Monaten, oder Supportende ohne erweiterten Support überschritten |
| **Eliminate** (ablösen) | Anwendung außer Betrieb nehmen | Stillgelegt, ungenutzt oder inaktiv; oder geringe strategische Passung und geringe Geschäftskritikalität |

Das vollständige Regelwerk, die Schwellenwerte und die elf Bewertungsdomänen beschreibt die [Referenz zum Rahmenwerk SWAO_APM](/de/service-assessment/framework).

## Was Sie bereitstellen müssen

| Eingabe | Erforderlich | Zweck |
|---|---|---|
| Intake-Arbeitsmappe (`.xlsx`) | Ja | Eine Zeile pro Anwendung oder Server, abgelegt in `wsp/inputs/service-intake/` des Workspace (oder mit `--from` übergeben). Zwingend nötig sind nur eine ID-Spalte und eine Betriebssystem-Spalte; jede weitere Spalte verbessert das Ergebnis. Siehe [Spaltenzuordnung](/de/service-assessment/column-mapping). |
| Spaltenzuordnung (YAML) | Nur wenn die Erkennung über die Kopfzeile nicht ausreicht | Teilt SWAO mit, welche Tabellenspalte welches Feld enthält; wird automatisch verwendet, wenn sie neben der Arbeitsmappe in `wsp/inputs/service-intake/` liegt |
| Internetzugang zu öffentlichen Quellen | Empfohlen | NVD, endoflife.date, CISA KEV, BSI CERT-Bund, OSV.dev. Ohne Zugang bleiben die Recherchefelder leer, und die Bewertung stützt sich auf die Intake-Daten. |
| API-Schlüssel für NVD und VirusTotal | Optional | Schnellere NVD-Recherche; VirusTotal-Abfrage der Hashwerte von Installationspaketen. Siehe [Optionale API-Schlüssel](/de/service-assessment/api-keys). |
| Installationspakete oder Binärdateien pro Anwendung | Optional | In `apps/<id>/ingestion/` abgelegt: Analyse von Signatur, Zertifikat, Laufzeitumgebung und Architektur (Pass 25 BINARY), Kryptografie- und Malware-Prüfungen, VirusTotal-Abfrage des Hashwerts |
| Verträge, Zertifikate, Handbücher, Datenflussdiagramme, SBOMs | Optional | In `apps/<id>/ingestion/` abgelegt (in beliebigen Unterordnern oder direkt); Pass 00 INGEST extrahiert den Text und leitet die Dateien an die kontextbasierten Passes weiter. Siehe [Dokumente und Installationspakete ablegen](#dokumente-und-installationspakete-ablegen). |

Spalten mit Ansprechpartner, Telefonnummer und E-Mail-Adresse werden **nie als Werte gespeichert**. SWAO hält nur fest, ob ein Support-Kontakt vorhanden ist (wahr oder falsch). Dies wird beim Intake erzwungen und durch `swao health-check` sowie in Support-Bundles erneut geprüft.

## Schnellstart

```bash
# 1. Intake-Arbeitsmappe (und optional eine Spaltenzuordnung) in den Workspace legen:
#    wsp/inputs/service-intake/portfolio.xlsx

# 2. Pro Intake-Zeile einen App-Ordner anlegen (legt bei Bedarf den Workspace an)
swao service init                  # oder: swao service init --from portfolio.xlsx

# 3. Workspace prüfen (Service-Probes 17 bis 25)
swao health-check

# 4. CVEs, Supportende und Warnmeldungen recherchieren; erstellt die Portfolio-Zusammenfassung
swao service research

# 5. Optional: Apps nach Risiko auflisten und das Service-Pass-Profil für die ersten ausführen
swao service rank --top 20
swao assess --app hosapp200 --type service

# 6. HTML veröffentlichen (Consultant) und Arbeitsmappe exportieren (Enterprise)
swao publish --app hosapp200
swao service export
```

Legen Sie den Ordner `wsp/inputs/service-intake/` selbst an; SWAO erstellt ihn nicht. Ohne `--from` verwendet `swao service init` die einzige `.xlsx`-Datei in diesem Ordner. Kein Befehl des Service-Ablaufs fragt nach Eingaben, daher laufen dieselben Befehle unbeaufsichtigt in CI.

In der Terminal-Oberfläche wählen Sie **Bewertung durchführen** und dann **2. Service Portfolio Assessment**. Der Bildschirm stellt drei Fragen: nach der Intake-Arbeitsmappe (vorausgefüllt, wenn eine in `wsp/inputs/service-intake/` liegt), nach der Spaltenzuordnung (vorausgefüllt, wenn eine neben der Arbeitsmappe liegt; mit Enter erkennt SWAO die Spalten aus der Kopfzeile) und nach dem Umfang: die 20 Apps mit dem höchsten Risiko bewerten, alle Apps bewerten oder nur anlegen und recherchieren. Danach laufen das Scaffold, die Recherche aller Apps, die Bewertung der gewählten Apps und (mit einer Enterprise-Lizenz) der Portfolio-Export ohne weitere Rückfragen. Fortschrittsbalken zeigen die Phase, den Fortschritt der Recherche und die aktuelle App mit verstrichener Zeit und geschätzter Restdauer. Esc bricht ab; bereits bewertete Apps bleiben erhalten.

## Dokumente und Installationspakete ablegen

`swao service init` legt pro App genau einen leeren Ablageordner an, `apps/<id>/ingestion/`, und keine weiteren Ordner. Legen Sie dort alles ab, was Sie zu der Anwendung haben, in beliebigen Unterordnern oder direkt:

- **Dokumente** (PDF, Word, Excel, PowerPoint, Markdown, Text, CSV, JSON, YAML) übernimmt [Pass 00 INGEST](/de/passes/00-ingest) zu Beginn der nächsten Service-Bewertung. Pass 00 vergleicht den SHA-256-Hashwert jeder Datei mit `ingestion/ingestion-manifest.json`, kopiert neue oder geänderte Dateien nach `wsp/inputs/<kategorie>/` (die Kategorie ergibt sich aus Dateiname und Dateityp), extrahiert den Text von PDF-, DOCX-, XLSX- und PPTX-Dateien und meldet `N new, M changed, K unchanged document(s) in ingestion/`.
- **Installationspakete und andere Pakete** (`.exe`, `.msi`, `.msp`, `.msix`, `.appx`, `.dll`, `.sys`, `.jar`, `.war`, `.ear`, `.so`, `.dylib`, `.cab`, `.pkg`, `.dmg`, `.deb`, `.rpm`) werden überall unter `ingestion/` erkannt. Sie werden nicht kopiert. [Pass 25 BINARY](/de/passes/25-binary) analysiert PE-Dateien und MSI-Pakete an Ort und Stelle und führt MSIX-, APPX-, JAR-, ELF-, DEB-, RPM-, DMG- und PKG-Dateien als nicht unterstützt auf; andere Formate (zum Beispiel `.msp`, `.cab`, `.dylib`) werden nur referenziert.

Hinweisordner wie `ingestion/binary/` oder `ingestion/data-flow/`, die frühere Versionen angelegt haben, funktionieren weiterhin.

| Was Sie in `ingestion/` ablegen | Wofür es genutzt wird |
|---|---|
| Installationspakete und ausführbare Dateien, die Pass 25 auswertet (PE-Dateien wie `.exe`, `.dll`, `.sys`; `.msi`-Pakete) | Pass 25 BINARY (Signatur, Zertifikat, Laufzeitumgebung, Architektur), Pass 08 CRYPTO im Service-Modus, Pass 14 MALWARE auf Anforderung und die VirusTotal-Abfrage des Hashwerts in `swao service research` |
| Andere Pakete (`.msix`, `.appx`, `.jar`, `.so`) | Von Pass 25 als `unsupported_files` aufgeführt (kein Hashwert, daher keine VirusTotal-Abfrage); Pass 14 MALWARE prüft sie auf Anforderung |
| SBOM (`*.cdx.json`, `*.spdx.json`, `*.spdx`, `bom.json`, `sbom.json`) | Pass 05 SBOM |
| Konfigurationsdateien (zum Beispiel `.ini`, `.xml`, `.conf`, `.config`, `.properties`) neben einem Installationspaket oder einer SBOM | Pass 08 CRYPTO im Service-Modus (schwache Algorithmen, unverschlüsselte Endpunkte, fest eingetragene Zugangsdaten) |
| Datenflussdiagramme, Verträge, Zertifikate, Handbücher und andere Dokumente | Pass 03 DATA im Service-Modus sowie Kontext für Pass 04 CTX, dessen Signale Pass 11 COMP als Nachweis für Rahmenwerkskontrollen verwendet |

Führen Sie nach dem Ablegen `swao assess --app <id> --type service` erneut aus. Um zusätzlich die öffentlichen Quellen neu abzufragen, zum Beispiel nachdem Sie einen Herstellernamen eingetragen haben, führen Sie `swao service research --app <id> --refresh` aus.

## Was Sie erhalten

| Ergebnis | Ablageort |
|---|---|
| Eine Konfiguration pro App | `apps/<id>/.swao.yml` (`assessment.type: service`) |
| Scaffold-Signale (Duplikate, Cluster, unbekannte Kategorien, bereinigte PII-Spalten) | `wsp/signals/scaffold-signals.json` |
| Recherche-Stubs pro Thema mit Konfidenz und Herkunft | `apps/<id>/wsp/inputs/research/*.md`, `confidence.json` |
| Portfolio-Zusammenfassung: TIME, Risikowert, Domänenwerte, Wellen, Hersteller | `wsp/portfolio-summary.json` |
| Integrationsgraph | `wsp/inputs/integration-graph.json` |
| Bericht zu den Migrationswellen | `wsp/reports/migration-waves-YYYYMMDD.md` und `.csv` |
| Delta-Bericht und Snapshots | `wsp/reports/portfolio-delta-YYYYMMDD.md`, `wsp/snapshots/` |
| HTML-Publikation pro App (Consultant) | `apps/<id>/wsp/publications/latest-service.html` |
| Enterprise-Arbeitsmappe und Star-Schema | `wsp/reports/swao-portfolio-YYYYMMDD.xlsx`, `wsp/star-schema/portfolio-*.json` |

## Lizenzstufen

Die Service-Portfolio-Bewertung selbst ist **Community**-Stufe: `swao service init`, `swao service research` (einschließlich VirusTotal mit eigenem Schlüssel), das Rahmenwerk SWAO_APM und die Ergebnisse pro App benötigen keine kostenpflichtige Lizenz. Umfangreichere Ausgaben folgen dem üblichen Stufenmodell: HTML-Publikation ab Consultant, Excel-Arbeitsmappe und Portfolio-Star-Schema ab Enterprise.

## Weiterführende Seiten

- [Befehlsreferenz](/de/service-assessment/commands)
- [Leitfaden zur Spaltenzuordnung](/de/service-assessment/column-mapping)
- [INFRA-CAT-Referenz](/de/service-assessment/infra-cat)
- [Konfigurationsreferenz](/de/service-assessment/configuration)
- [Optionale API-Schlüssel](/de/service-assessment/api-keys)
- [Referenz zum Rahmenwerk SWAO_APM](/de/service-assessment/framework)
- [Migrationswellen-Generator](/de/service-assessment/migration-waves)
- [Analyse-Passes](/de/passes/), insbesondere [Pass 24 RESEARCH](/de/passes/24-research) und [Pass 25 BINARY](/de/passes/25-binary)
