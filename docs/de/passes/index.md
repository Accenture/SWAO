# Analyse-Passes

Eine Bewertung in SWAO ist eine Abfolge von **Passes**. Jeder Pass beantwortet eine Frage zur Anwendung (woraus besteht sie, welche Daten hält sie, wohin sendet sie Daten, welche Kontrollen erfüllt sie), schreibt sein Ergebnis nach `wsp/runs/<zeitstempel>/passes/<NN>-<key>.yaml` und erzeugt **Signale**: kleine, belegte Befunde mit einer ID (zum Beispiel `INV-03` oder `BIN-01`), einem Schweregrad und einer Herleitung. Spätere Passes bauen auf früheren auf (siehe "Ausführungsreihenfolge" unten); der Compliance-Pass bewertet die Kontrollen der Rahmenwerke anhand der Signale aller Passes, die vor ihm gelaufen sind.

Diese Seite gibt einen Überblick. Jeder Pass hat eine eigene Detailseite mit Zweck, Eingaben, Messung, Werkzeugen von Drittanbietern, Ergebnissen und Grenzen.

## Arten von Passes

| Art | Bedeutung |
|---|---|
| Deterministisch | Regelbasierte Analyse von Dateien und Konfiguration; gleiche Eingabe, gleiches Ergebnis; kein LLM |
| LLM-gestützt | Nutzt den konfigurierten LLM-Anbieter für Klassifizierung, Begründung oder Urteile; ohne LLM übersprungen oder eingeschränkt |
| Dynamisch | Steuert einen Headless-Browser gegen die laufende Anwendung |
| Externe API | Fragt öffentliche Datenquellen über das Internet ab |

## Überblick

| Pass | Schlüssel | Art | Anwendung | Service | Welche Frage er beantwortet | Werkzeuge und Dienste von Drittanbietern |
|---|---|---|---|---|---|---|
| [00 INGEST](/de/passes/00-ingest) | (Vor-Pass) | Deterministisch | Immer | Immer | Welche Projektdateien wurden bereitgestellt, und welchen Text enthalten sie? | pdf-parse, mammoth, exceljs, adm-zip; Pulumi Cloud API (optional) |
| [01 INV](/de/passes/01-inv) | `inv` | Deterministisch | Standard | Übersprungen | Woraus besteht die Anwendung: Sprache, Frameworks, Datenbank, Laufzeit, Backing Services? | keine (SWAO-IaC-Parser) |
| [02 STATE](/de/passes/02-state) | `state` | Deterministisch | Standard | Übersprungen | Welche Komponenten halten Zustand, und wo liegen Single Points of Failure? | keine |
| [03 DATA](/de/passes/03-data) | `data` | LLM-gestützt (im Service-Modus deterministisch) | Standard | Wenn Dokumente oder Datenfelder vorliegen | Welche personenbezogenen und besonderen Daten verarbeitet sie, und welche DSGVO-Kontrollen gelten? | konfigurierter LLM-Anbieter |
| [04 CTX](/de/passes/04-ctx) | `ctx` | LLM-gestützt | Standard | Immer | Was sagen die Projektunterlagen (CMDB-Exporte, Workshop-Notizen, Architekturpapiere), und wo widersprechen sie sich? | konfigurierter LLM-Anbieter |
| [05 SBOM](/de/passes/05-sbom) | `sbom` | Deterministisch mit Online-Abfrage | Standard | Wenn eine SBOM vorliegt | Welche Abhängigkeiten haben bekannte Schwachstellen, werden nicht gewartet oder laufen auf einer Laufzeit nach Supportende? | OSV.dev API (optional) |
| [06 TF](/de/passes/06-tf) | `tf` | Deterministisch | Standard | Übersprungen | Wie cloudtauglich ist die Anwendung nach Twelve-Factor-Kriterien, und was findet der IaC-Scan? | Checkov oder KICS (optional) |
| [07 EGR](/de/passes/07-egr) | `egr` | Deterministisch | Standard | Übersprungen | Wohin sendet die Anwendung Daten, und welche Ziele verhindern Datenresidenz? | keine |
| [08 CRYPTO](/de/passes/08-crypto) | `crypto` | Deterministisch | Standard | Wenn Konfiguration oder Binärdateien vorliegen | Welche kryptografischen Primitive, Token-Signaturen und Verschlüsselung ruhender Daten werden genutzt? | keine |
| [09 SYNTH](/de/passes/09-synth) | `synth` | LLM-gestützt und deterministisch | Standard | Immer | Welche 7R-Migrationsstrategie passt, wie portabel ist die Anwendung, welche Landing Zone passt? | konfigurierter LLM-Anbieter; SWAO-Cloud-Anbieterkatalog |
| [10 DYNAMIC](/de/passes/10-dynamic) | `dynamic` | Dynamisch | Standard (benötigt ein Crawl-Ziel) | Wenn ein Portal-Crawl konfiguriert ist | Was tut die laufende Anwendung: externe Hosts, Tracker, Fehler, Login-Oberfläche, Cookie-Consent? | Playwright, Chromium; optional Vision-LLM |
| [11 COMP](/de/passes/11-comp) | `comp` | LLM-gestützt | Standard | Immer | Welche Kontrollen der gewählten Rahmenwerke sind erfüllt, teilweise erfüllt, eine Lücke, nicht anwendbar oder unbekannt? | konfigurierter LLM-Anbieter; Community-Rahmenwerke |
| [12 BLOCKS](/de/passes/12-blocks) | `blocks` | LLM-gestützt | Standard | Immer | Wie reif sind die acht betrieblichen Bausteine (Observability bis Disaster Recovery)? | konfigurierter LLM-Anbieter |
| [13 SCOPE](/de/passes/13-scope) | `scope` | Deterministisch | Standard | Immer | Welche bekannten blinden Flecken decken die Nachweise ab, und wie vollständig ist die Bewertung? | keine |
| [14 MALWARE](/de/passes/14-malware) | `malware` | Deterministisch, externe Werkzeuge | Opt-in | Wenn Binärdateien vorliegen und der Pass angefordert wird | Enthalten Quellcode oder Binärdateien Geheimnisse, verwundbare Pakete oder Schadsoftware? | Gitleaks, OSV-Scanner, ClamAV, YARA, ORT (optional) |
| [23 LZR](/de/passes/23-lzr) | `--lzr` | Deterministisch | Mit `--lzr` | Nicht verwendet | Ist die Ziel-Landing-Zone bereit, beurteilt anhand des Terraform-States oder eines JSON-Plans? | keine |
| [24 RESEARCH](/de/passes/24-research) | `swao service research` | Externe API | Nicht verwendet | Eigener Befehl | Was melden öffentliche Quellen: CVEs, aktiv ausgenutzte Schwachstellen, Warnmeldungen, Supportende, Malware-Befunde? | NVD, CISA KEV, BSI CERT-Bund, OSV.dev, endoflife.date, VirusTotal (optionaler Schlüssel) |
| [25 BINARY](/de/passes/25-binary) | (automatisch) | Deterministisch, offline | Nicht verwendet | Wenn Installationspakete vorliegen | Sind die bereitgestellten Installationspakete signiert, mit gültigen Zertifikaten, aktuellen Laufzeitumgebungen und moderner Architektur? | keine (SWAO-Parser) |

"Standard" bedeutet, dass der Pass in der Standardliste `--passes` von `swao assess` enthalten ist (13 Passes); "Opt-in"-Passes laufen nur auf Anforderung. Die dynamische Analyse benötigt ein konfiguriertes Crawl-Ziel und liefert ohne dieses keine sinnvollen Ergebnisse. Die Nummern 15 bis 22 sind keine eigenen Passes: Es waren die früheren Nummern der acht Bausteine, die Pass 12 heute gemeinsam bewertet.

## Ausführungsreihenfolge

Die Pass-Nummern sind Kennungen, nicht die Ausführungsreihenfolge. `swao assess` führt die gewählten Passes immer in einer festen Abfolge aus, unabhängig von der Reihenfolge in `--passes` oder in einer Linse:

1. Pass 00 INGEST (vor der Pass-Schleife)
2. `inv`, `state`, `data`, `ctx`, `sbom`, `tf`, `egr`, `crypto` (Passes 01 bis 08)
3. `dynamic` (Pass 10), `scope` (Pass 13), `malware` (Pass 14, nur auf Anforderung)
4. Pass 23 LZR (nur mit `--lzr <landingZoneId>`)
5. `comp` (Pass 11)
6. `synth` (Pass 09)
7. `blocks` (Pass 12)

Die Reihenfolge ergibt sich daraus, was jeder Pass aus dem laufenden Lauf liest:

- Pass 11 COMP sieht die Signale der statischen Passes sowie von DYNAMIC, SCOPE, MALWARE und LZR aus demselben Lauf. SYNTH und BLOCKS sieht er nicht.
- Pass 09 SYNTH läuft nach COMP, sodass sein 7R-Urteil Compliance-Lücken berücksichtigt, und er liest das Urteil von Pass 23 aus demselben Lauf.
- Pass 12 BLOCKS läuft zuletzt, damit sein Prompt das 7R-Label, den Abdeckungswert und die Begründung enthält, die SYNTH im selben Lauf geschrieben hat.

Bei der Service-Portfolio-Bewertung läuft Pass 25 BINARY als Erstes, noch vor Pass 00 und der Pass-Schleife.

## Passes auswählen

```bash
swao assess --app <id>                         # Standardliste der Passes
swao assess --app <id> --passes inv,sbom,comp  # eine Teilmenge
swao assess --app <id> --skip-llm              # kein LLM-Aufruf; ohne ctx, comp, blocks
swao assess --app <id> --lzr <landing-zone-id> # Pass 23 LZR ergänzen
```

Mit `--skip-llm` ruft SWAO überhaupt kein LLM auf: `ctx`, `comp` und `blocks` werden entfernt, `data` und `synth` bleiben im Lauf und schreiben eine Übersprung-Markierung `DATA-00` beziehungsweise `SYNTH-00` (die deterministische Service-Variante von `data` läuft normal), und der Vision-Schritt von Pass 10 ist ausgeschaltet. Die Aliasse `dyn` und `mal` werden für `dynamic` und `malware` akzeptiert. Der Name `lzr` wählt keinen Eintrag in `--passes`: Pass 23 läuft nur mit `--lzr <landingZoneId>`.

In der Terminal-Oberfläche wird das Pass-Profil vor dem Lauf pro App gewählt; dynamische Analyse und Malware-Scan sind nie vorausgewählt. Bei der Service-Portfolio-Bewertung legt das Service-Profil den Pass-Plan fest (siehe Spalte "Service"); übersprungene Passes werden als UNKNOWN geführt, nicht als Fehler.

## Weiterführende Seiten

- [Bewertung durchführen](/de/assessment/)
- [Community-Rahmenwerke](/de/frameworks/), die Pass 11 bewertet
- [Health Check](/de/health-check) für die optionalen externen Werkzeuge (Playwright, Gitleaks, OSV-Scanner, ClamAV, YARA, Checkov, KICS)
