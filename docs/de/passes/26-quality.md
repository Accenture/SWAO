# Pass 26: Code Health (QUALITY)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 26 |
| Schlüssel (`--passes`) | `quality` |
| Signal-Präfix | `QUAL` |
| Typ | Deterministisch (eingebaute Metriken, kein LLM, kein Netzwerk); optionale Anreicherung mit lizard / jscpd, standardmäßig aus |
| Standard | An (Teil der Standardliste `--passes`) |
| Bewertungsarten | `application` (in Service-Bewertungen übersprungen: kein Quellcode) |
| Lizenzstufe | Alle Stufen (keine Lizenzsperre) |
| Quelle | `packages/@swao/module-app-assessment/src/passes/pass-26-quality.ts`, `code-health-metrics.ts`, `code-health-tools.ts`; Endpunkt-Scanner `packages/@swao/core/src/endpoint-scanner.ts`; Werkzeugsuche und Prozessstart `packages/@swao/core/src/code-health-tools.ts`, `tool-runner.ts` |

## Wofür er da ist

Pass 26 beantwortet die Frage: "Welche Dateien sollten Entwickler zuerst überarbeiten, und wie gesund ist der Code insgesamt?" Er erzeugt eine Arbeitsliste je Datei, sortiert nach einem nachvollziehbaren Gesamtwert, die direkt an ein Entwicklungsteam übergeben werden kann, sowie vier Kennzahlen je Anwendung, die der Portfolio Engagement Hub zwischen Anwendungen vergleicht.

Gleiche Eingabe, gleiche Werte: Der Pass liest nur die Quelldateien und nutzt weder Uhrzeit, Gebietsschema noch LLM. Externe Werkzeuge laufen nur, wenn Sie sie ausdrücklich einschalten (siehe "Optionale Werkzeug-Anreicherung"); ihre Ergebnisse werden getrennt abgelegt und ändern die eingebauten Werte nie.

## Was Sie bereitstellen müssen

Nur den Quellcode. Enthält das Repository eine `CODEOWNERS`-Datei (`.github/`, Wurzelverzeichnis, `docs/` oder `.gitlab/`), nennt jeder Eintrag der Arbeitsliste das verantwortliche Team.

Optionale Einstellungen in der `.swao.yml` (#3487; je Schlüssel zuerst die App-Datei, danach die Workspace-Datei):

```yaml
assessment:
  code_health:
    top_n: 25                     # Länge der Arbeitsliste, 1 bis 500 (Standard 25)
    endpoint_allowlist:           # Hosts, die nicht als fest codierte Endpunkte zählen
      - api.partner.example       # exakter Host
      - .corp.example             # die Domain und alle Subdomains
      - 10.20.30.40               # IPv4- oder IPv6-Literal
    tools: [lizard, jscpd]        # optionale Werkzeug-Anreicherung (Standard: keine)
    tool_timeout_seconds: 300     # Obergrenze je Werkzeuglauf (Standard 300)
```

Die Allowlist gilt nur für Pass 26; Pass 07 (Egress) und die TF-01-Konfigurationsevidenz melden Hosts auf der Allowlist weiterhin.

## Wie er arbeitet

1. Die Produktivdateien des zentralen Quell-Scopes auflisten (Test- und generierte Dateien werden gezählt, nicht gemessen; Build-Ausgaben, Abhängigkeiten und Punkt-Verzeichnisse werden nie gelistet).
2. Jede Code-Datei messen: Zeilen ohne Kommentar (NLOC), Entscheidungspunkte, Verschachtelungstiefe, TODO-, FIXME-, HACK- und XXX-Marker.
3. Duplikate erkennen: sechs aufeinanderfolgende normalisierte Code-Zeilen, die in der Anwendung mehrfach vorkommen.
4. Code und Konfiguration (Java, TS/JS, YAML inkl. Helm-Values, `.properties`, Dockerfiles, `.env`, Terraform) nach fest codierten IP-Adressen und URLs durchsuchen.
5. Jede Datei bewerten, die Arbeitsliste sortieren, die Kennzahlen berechnen und die `QUAL`-Signale ausgeben.

## Wie gemessen wird

### Bestandteile des Dateiwerts (0 bis 100, höher = dringender)

| Bestandteil | Formel |
|---|---|
| Komplexität | max(Entscheidungspunkte x 100 / 150, 20 x (Verschachtelungstiefe - 3)) |
| Größe | (NLOC - 200) x 100 / 800, also 0 bei 200 NLOC und 100 bei 1.000 NLOC |
| Duplikation | Anteil der Zeilen der Datei in einem wiederholten 6-Zeilen-Block in % |
| Fest codierte Endpunkte | 20 je IP-Adresse + 10 je URL |
| Marker | 10 je TODO / FIXME / HACK / XXX |

Arbeitslisten-Wert = 0,30 Komplexität + 0,25 Größe + 0,20 Duplikation + 0,15 Endpunkte + 0,10 Marker (gerundet). Die 25 Dateien mit den höchsten Werten werden gelistet (`assessment.code_health.top_n` ändert die Länge); bei Gleichstand entscheidet der Pfad. Die Gewichte sind vorläufig, bis der Product Owner sie bestätigt.

### Kennzahlen je Anwendung (0 bis 100, höher = gesünder)

| Kennzahl | Formel |
|---|---|
| Komplexität | 100 - 4 x (Entscheidungspunkte je 100 NLOC - 15) |
| Wartbarkeit | 100 - Anteil der NLOC in Hotspot-Dateien in % (Wert 50 oder mehr, oder über 1.000 NLOC) - min(20, 2 x Marker je 1.000 NLOC) |
| Duplikation | 100 - 2 x Anteil duplizierter Zeilen in % |
| Konfigurationshygiene | 100 - 10 x (URLs + 2 x IP-Adressen) je 1.000 NLOC |
| Gesamt | Mittelwert der vier |

### Was als fest codierter Endpunkt zählt

Ausgenommen: Loopback (`127.x`, `::1`, `localhost`), `0.0.0.0`, Link-Local-Adressen, Dokumentationsbereiche (RFC 5737, RFC 3849), reservierte Namen (`example.com`, `.test`, `.invalid`), XML-Namespace- und Lizenz-URLs, Platzhalter (`${DB_HOST}`, <code v-pre>{{ .Values.host }}</code>), Netzmasken, vierteilige Versionsnummern und reine Kommentarzeilen (Lizenzköpfe, Javadoc, YAML-Kommentare). Ein fester Standardwert in einem Platzhalter (`${DB_HOST:10.0.0.1}`) zählt dennoch. Hosts auf der Allowlist des Betreibers (`assessment.code_health.endpoint_allowlist`) zählen nicht.

## Optionale Werkzeug-Anreicherung

Wenn `assessment.code_health.tools` sie aufführt, liefern zwei externe Werkzeuge Details, die die eingebauten Näherungen nicht bieten:

| Werkzeug | Ergänzt | Unterstützte Version | Installation |
|---|---|---|---|
| lizard | zyklomatische Komplexität je Funktion (CCN), Funktionen über CCN 15 | 1.17.x | `pip install "lizard>=1.17,<1.18"` |
| jscpd | tokenbasierte Klonerkennung: Klonpaare, duplizierte Zeilen, Top-Dateien | 4.x | `npm install -g jscpd@4` |

- lizard liest genau die Produktivdateien, die Pass 26 gemessen hat; jscpd durchsucht das Quellverzeichnis, und seine Ergebnisse werden auf dieselben Dateien gefiltert (Klone zwischen zwei Produktivdateien).
- Beide laufen ohne Shell, mit fester Argumentliste, in einem temporären Arbeitsverzeichnis und mit einer Zeitgrenze, die den gesamten Prozessbaum beendet. Konfigurationsdateien im untersuchten Repository (`.jscpd.json`, `whitelizard.txt`) werden nicht gelesen.
- Die Ergebnisse stehen unter `assessment.code_health.tools` und werden in `QUAL-08` zusammengefasst. Eingebaute Metriken, Kennzahlen, Arbeitsliste und `QUAL-01` bis `QUAL-07` sind mit und ohne Werkzeugergebnisse identisch. Code-Fragmente aus jscpd werden nie gespeichert.
- Ein fehlendes Werkzeug, eine Version außerhalb des unterstützten Bereichs, ein Fehler oder eine Zeitüberschreitung wird festgehalten (`absent`, `unsupported_version`, `failed`, `timed_out`) und in `QUAL-08` mit dem Installationsbefehl genannt. Der Lauf geht weiter. Eine nicht unterstützte Version wird nicht gestartet, weil ein ungetestetes Ausgabeformat falsch gelesen werden könnte.
- `swao health-check` führt beide Werkzeuge unter Prerequisites mit Version, "unsupported" oder "not found" auf; sie ändern den Status der Prüfung nie.

## Ergebnisse

- `passes/26-quality.yaml`: `assessment.code_health` mit `kpis`, `totals`, `languages`, `owner_source`, `weights`, `top_n`, `worklist` (standardmäßig Top 25) und `hardcoded_endpoints` (die ersten 200); `endpoint_allowlist` (`hosts`, `allowlisted_hits`) und `tools` (`requested`, `lizard`, `jscpd`) nur, wenn konfiguriert.
- Signale: `QUAL-01` Kennzahlen-Übersicht; `QUAL-02` Komplexitäts-Hotspots; `QUAL-03` sehr große Dateien; `QUAL-04` Duplikation; `QUAL-05` fest codierte IP-Adressen; `QUAL-06` fest codierte URLs; `QUAL-07` TODO-Marker; `QUAL-08` Zusammenfassung der Werkzeug-Anreicherung (informativ, nur mit konfigurierten `tools`); `QUAL-00`, wenn kein messbarer Produktivcode vorliegt. Jedes Signal nennt `Datei:Zeile` als Nachweis; der Schweregrad ist höchstens mittel.
- Pass 12 (`blocks`): `architecture_assessment` und `testing_maturity` nutzen `assessment.code_health` als Nachweis (Kontext im Prompt und ein Objekt `code_health_evidence`).
- Publikation: Abschnitt "Code Health" mit Kennzahl-Kacheln, der Arbeitsliste (sortierbar, CSV-Export, Detailansicht je Datei) und der Endpunkt-Tabelle (CSV-Export); die Formeln stehen im Methodik-Abschnitt.
- `wsp/portfolio-summary.json`: `code_health`-Kennzahlen je Anwendung, angezeigt in der Portfolio-Tabelle des Engagement Hubs.

## Einschränkungen

- Die eingebaute Komplexität ist eine Näherung auf Dateiebene (Summe der Entscheidungspunkte und Verschachtelungstiefe), keine zyklomatische Komplexität je Funktion; die eingebaute Duplikation beruht auf Zeilenfenstern, nicht auf tokenbasierter Klonerkennung. Die optionale Anreicherung mit lizard und jscpd ergänzt beides, ohne die eingebauten Werte zu ändern.
- PMD (CPD und Regeltreffer) ist nicht angebunden; es braucht eine Java-Laufzeit und folgt in einer späteren Runde.
- Gemessene Sprachen: Java, Kotlin, Groovy, Scala, TypeScript, JavaScript, Vue, Svelte, Go, C#, C, C++, Rust, Swift, PHP, Python, Ruby, Shell, PowerShell, SQL, VB.NET. Der Block `languages` zeigt, was gemessen wurde, damit Lücken sichtbar sind.
- Dateien über 1 MiB werden nicht gelesen; sie zählen als sehr groß.
- Eine gespeicherte `assessment.pass_profile` ohne `quality` lässt den Pass aus; die Publikation listet ihn dann unter "Nicht ausgeführte Durchläufe".

Design: Design 117 (`docs/design/117-code-health-pass-and-endpoint-scanner.md`).
