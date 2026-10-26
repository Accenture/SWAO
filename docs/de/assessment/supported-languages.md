---
description: Welche Programmiersprachen jeder Pass der SWAO-Anwendungsbewertung analysiert, deterministisch, über das LLM oder gar nicht.
---

# Unterstützte Sprachen

Die [Anwendungsbewertung](/de/assessment/application) liest den Quellcode und die
Build-Manifeste einer Anwendung. Nicht jeder Pass versteht jede Sprache: Manche Prüfungen
sind für einen bestimmten Technologie-Stack geschrieben, andere lesen jede Datei. Diese
Seite zeigt je Sprache, wie jeder Pass, der Quelldateien oder Manifeste liest, sie
abdeckt. So wissen Sie schon vor einem Lauf, welche Befunde zu erwarten sind und wo die
Beweislage dünn sein wird.

Dieselbe Matrix ist Teil jedes Laufs. [Pass 01 (INV)](/de/passes/01-inv) zählt die
Codezeilen je Sprache der Anwendung (Signal `INV-90`), hält die Abdeckung der gefundenen
Sprachen in `passes/01-inv.yaml` fest und meldet `INV-91`, wenn mehr als die Hälfte des
Produktionscodes in Sprachen geschrieben ist, die kein Codeanalyse-Pass deterministisch
liest. Die Publikation zeigt das Ergebnis im Block zur Sprachabdeckung.

## Bedeutung der Werte

- **deterministisch**: Eine regelbasierte Prüfung liest die Quelldateien oder
  Build-Manifeste der Sprache. Das Ergebnis ist reproduzierbar, und jeder Befund verweist
  auf die Datei, aus der er stammt.
- **LLM**: Der Pass gibt die Quelldateien der Sprache in den Prompt des Sprachmodells,
  aber keine regelbasierte Prüfung liest sie. Das betrifft heute nur die
  Datenklassifizierung ([Pass 03 DATA](/de/passes/03-data)). Die Qualität des Ergebnisses
  hängt vom Modell ab und davon, welche Dateien in den Prompt passen.
- **keine**: Der Pass liest keine Dateien dieser Sprache. Fehlt ein Befund dieses Passes,
  sagt das nichts über den Code in dieser Sprache aus.

Inventar (INV), Codezustand (QUALITY) und der Secret-Scan (SECRETS) zählen für die
Warnung `INV-91` nicht als sprachspezifische Codeanalyse: Das Inventar erkennt nur
Manifeste, der Codezustand misst Qualität statt Souveränität, und der Secret-Scan ist
eine Musterprüfung über alle Dateien (sofern Gitleaks installiert ist). Passes, die über
Signale und bereitgestellte Dokumente statt über Quellcode urteilen (CTX, COMP, SYNTH,
BLOCKS), und Passes, die keinen Quellcode lesen (DYNAMIC, SCOPE), sind keine Spalten.

## Abdeckung nach Sprache und Pass

Die Tabelle wird aus den Scan-Listen der Passes erzeugt und stimmt deshalb immer mit dem
ausgelieferten Code überein.

<!-- generated:language-coverage:start -->

| Sprache | Inventar (INV) | Zustand (STATE) | Daten (DATA) | Abhängigkeiten (SBOM) | Twelve-Factor (TF) | Egress (EGR) | Kryptografie (CRYPTO) | Codezustand (QUALITY) | Secrets (SECRETS) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C | keine | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |
| C# | deterministisch | keine | deterministisch | keine | deterministisch | keine | deterministisch | deterministisch | deterministisch |
| C++ | keine | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |
| COBOL | keine | keine | keine | keine | keine | keine | keine | keine | deterministisch |
| Dart | keine | keine | keine | keine | keine | keine | keine | keine | deterministisch |
| F# | deterministisch | keine | keine | keine | keine | keine | keine | keine | deterministisch |
| Go | deterministisch | keine | deterministisch | keine | keine | keine | deterministisch | deterministisch | deterministisch |
| Groovy | deterministisch | keine | keine | deterministisch | keine | deterministisch | keine | deterministisch | deterministisch |
| Java | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch |
| JavaScript | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch |
| Kotlin | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch |
| PHP | deterministisch | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |
| PowerShell | keine | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |
| Python | deterministisch | keine | deterministisch | keine | deterministisch | keine | deterministisch | deterministisch | deterministisch |
| Ruby | deterministisch | keine | LLM | keine | keine | keine | keine | deterministisch | deterministisch |
| Rust | deterministisch | keine | deterministisch | keine | deterministisch | keine | keine | deterministisch | deterministisch |
| Scala | deterministisch | keine | keine | deterministisch | keine | deterministisch | keine | deterministisch | deterministisch |
| Shell | keine | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |
| SQL | keine | keine | deterministisch | keine | keine | keine | keine | deterministisch | deterministisch |
| Swift | keine | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |
| TypeScript | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch | deterministisch |
| VB.NET | deterministisch | keine | keine | keine | keine | keine | keine | deterministisch | deterministisch |

<!-- generated:language-coverage:end -->

## Paket-Ökosysteme

Das Inventar erkennt Build-Manifeste in beliebiger Tiefe für die folgenden Ökosysteme.
Die Software-Stückliste ([Pass 05 SBOM](/de/passes/05-sbom)) fragt bekannte
Schwachstellen für die in der letzten Spalte markierten Ökosysteme in
[OSV](https://osv.dev) ab.

<!-- generated:package-ecosystems:start -->

| Paket-Ökosystem | Sprachen | Build-Manifeste gelesen (INV) | Schwachstellenabfrage in OSV (SBOM) |
| --- | --- | --- | --- |
| crates.io | Rust | ja | nein |
| Go | Go | ja | nein |
| Maven | Groovy, Java, Kotlin, Scala | ja | ja |
| npm | JavaScript, TypeScript | ja | ja |
| NuGet | C#, F#, VB.NET | ja | nein |
| Packagist | PHP | ja | nein |
| PyPI | Python | ja | nein |
| RubyGems | Ruby | ja | nein |

<!-- generated:package-ecosystems:end -->

## Sprachen mit geringer oder fehlender Abdeckung

Zeigt die dominante Sprache Ihrer Anwendung überwiegend **keine**, läuft die Bewertung
trotzdem: Das Inventar, der Sprachzensus, der Secret-Scan und alle Passes, die mit Ihrem
bereitgestellten Kontext arbeiten (Architekturdokumente, CMDB-Auszüge, Betriebsdaten),
liefern Ergebnisse. Gleichen Sie die fehlende Codeanalyse aus, indem Sie
Kontextdokumente in `wsp/inputs/` ablegen und die Warnung `INV-91` im Bericht prüfen.
Für Anwendungen ohne zugänglichen Quellcode verwenden Sie die
[Service-Portfolio-Bewertung](/de/service-assessment/).

---

## Weiterführende Seiten

- [Anwendungsbewertung](/de/assessment/application) und die [Pass-Referenz](/de/passes/)
- [Pass 01 (INV): Inventar](/de/passes/01-inv), Sprachzensus und Abdeckungsmatrix
