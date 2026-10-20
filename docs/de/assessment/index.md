# Bewertung durchführen

SWAO bietet vier Bewertungstypen. Jeder Typ beantwortet eine andere Frage, benötigt
andere Eingaben und liefert eigene Ergebnisse. Alle vier nutzen dasselbe
Workspace-Layout (ein Portfolio-Workspace mit einem Ordner je Anwendung unter `apps/`),
dieselben Community-Rahmenwerke sowie dieselben Werkzeuge für Publikation und Export.

Diese Seite gibt Ihnen den Überblick: Wofür ist welcher Typ gedacht, was müssen Sie
bereitstellen, was erhalten Sie, und wie lassen sich die Typen in einem typischen
Projekt kombinieren?

---

## Die vier Bewertungstypen im Überblick

| | [Anwendungsbewertung](/de/assessment/application) | [Service-Portfolio-Bewertung](/de/service-assessment/) | [Landing-Zone-Katalogbewertung](/de/assessment/landing-zone) | [LLM-Bewertung für SWAO](/de/assessment/llm) |
|---|---|---|---|---|
| **Typ-ID** | `application` (Standard) | `service` | `landing-zone-catalog` | `llm` |
| **Beantwortete Frage** | Wie steht diese Anwendung bei Souveränität, Compliance und Migrationsfähigkeit da? | Was tun wir mit jeder Fremd-, SaaS- oder Standardsoftware in diesem Portfolio? | Kann diese Cloud-Region diese Anwendung unter den aktiven Rahmenwerken betreiben? | Welches LLM erledigt die Bewertungsarbeit von SWAO für meine Anwendung am besten? |
| **Was Sie bereitstellen** | Quellcode (lokaler Pfad oder Git-Repository), optional Kontextdokumente, optional eine erreichbare URL für den Crawl | Eine Excel-Inventarliste der Anwendungen (eine Zeile je Anwendung), optional Binärdateien, SBOMs und Konfigurationsdateien | Zielanbieter und Region aus den mitgelieferten Katalogen sowie idealerweise eine abgeschlossene Anwendungsbewertung | Eine abgeschlossene Anwendungsbewertung und 2 bis 5 Paare aus LLM-Konnektor und Modell |
| **Wichtigste Ergebnisse** | Signale je Pass, Compliance-Bewertungen, 7R-Migrationsempfehlung, Run-Manifest, HTML-Publikation, BI-Export | Eine angelegte App je Zeile, Recherche-Dateien (CVE, End of Life, Herstellerstatus), TIME-Quadrant, Risiko- und Health-Scores, Migrationswellen, Enterprise-Portfolio-Arbeitsmappe | Fit/Gap-Bewertung je Dienst, Gesamturteil je Ziel, LZ-Signale, Zusammenfassungen in Klartext | Modellvergleich nach Dimensionen (Qualität, Performance, Kosten, Zuverlässigkeit, Reasoning, Sicherheit), gewichtetes Gesamtranking, Befundprotokoll |
| **Befehl** | `swao assess --app <id>` | `swao service init`, `swao service research`, `swao assess --app <id>`, `swao service export` | `swao assess --type landing-zone-catalog --app <id> ...` | `swao assess --type llm --app <id>` |
| **LLM** | Empfohlen. Statische Passes laufen ohne; `data`, `ctx`, `synth`, `comp` und `blocks` benötigen eines | Empfohlen für Kontext-, Synthese- und Compliance-Pass; Erfassung, Recherche und Scoring sind deterministisch | Nicht verwendet. Die Bewertung ist vollständig deterministisch | Erforderlich: Die verglichenen LLMs sind Gegenstand der Bewertung |
| **Lizenzstufe** | Alle Stufen. Workspace-weite Läufe (`--portfolio`) erfordern Enterprise | Alle Stufen. Die Portfolio-Arbeitsmappe (`swao service export`) erfordert Enterprise | Alle Stufen. `swao lz catalogue update` ab Consultant | Alle Stufen (siehe [LLM-Seite](/de/assessment/llm#lizenzstufe)) |

SWAO nennt für keinen Typ feste Laufzeiten. Die Dauer hängt von der Größe des
Quellcodes oder Portfolios, den gewählten Passes, dem LLM-Anbieter und dessen
Ratenlimits ab. `swao assess --stats` gibt nach jedem Lauf eine Zeittabelle je Pass aus,
mit der Sie Folgeläufe planen können.

---

## Welche Bewertung brauche ich?

Gehen Sie die Fragen der Reihe nach durch.

1. **Liegt Ihnen der Quellcode der Anwendung vor?**
   - Ja: Beginnen Sie mit der [Anwendungsbewertung](/de/assessment/application). Sie ist
     die Grundlage für die Landing-Zone- und die LLM-Bewertung.
   - Nein, es handelt sich um ein Herstellerprodukt, einen SaaS-Dienst oder eine
     installierte Software: Nutzen Sie die [Service-Portfolio-Bewertung](/de/service-assessment/).
2. **Bewerten Sie viele Anwendungen auf Basis einer Inventarliste?**
   - Ja: Die Service-Portfolio-Bewertung legt je Tabellenzeile eine Workspace-App an
     und fasst alles in einer Portfoliosicht mit Migrationswellen zusammen.
3. **Müssen Sie wissen, ob ein bestimmter Cloud-Anbieter und eine bestimmte Region die
   Anwendung unter Ihren Souveränitätsanforderungen betreiben können?**
   - Ja: Ergänzen Sie eine [Landing-Zone-Katalogbewertung](/de/assessment/landing-zone).
     Sie läuft eigenständig oder direkt im Rahmen der Anwendungsbewertung.
4. **Müssen Sie entscheiden, welches LLM Sie für SWAO-Bewertungen einsetzen (etwa ein
   selbst betriebenes Modell gegenüber einer Cloud-API)?**
   - Ja: Führen Sie die [LLM-Bewertung für SWAO](/de/assessment/llm) aus, sobald für die
     Anwendung mindestens eine abgeschlossene Anwendungsbewertung vorliegt.

---

## Wie die Typen zusammenspielen

**Anwendung plus Landing Zone (das typische Migrationsprojekt).** Führen Sie zuerst die
Anwendungsbewertung durch. Sie erkennt, welche Plattformfähigkeiten die Anwendung
benötigt (zum Beispiel Kubernetes, Objektspeicher, Schlüsselverwaltung). Die
Landing-Zone-Katalogbewertung prüft diese Anforderungen anschließend gegen eine oder
mehrere Anbieterregionen und gegen die Souveränitätsanforderungen Ihrer aktiven
Rahmenwerke. Beides geht in einem Befehl, indem Sie `swao assess --app <id>` um
`--lz-cat-targets` ergänzen.

**Service-Portfolio für Anwendungen ohne Quellcode.** Krankenhäuser, Behörden und große
Unternehmen betreiben viele Fremdprodukte: klinische Systeme, Dokumentenmanagement,
Herstellerportale, SaaS-Werkzeuge. Deren Quellcode können Sie nicht scannen, aber Sie
können sie anhand eines Inventarexports, von Herstellerdokumentation, installierten
Binärdateien und öffentlichen Schwachstellendaten bewerten. Die
Service-Portfolio-Bewertung nutzt dieselbe Pass-Engine und dieselben Rahmenwerke,
überspringt die Passes, die Quellcode benötigen, und ergänzt Internetrecherche und
Binäranalyse.

**Gemischte Portfolios.** Ein Workspace kann beide Arten von Anwendungen nebeneinander
enthalten. Eigenentwicklungen werden mit `type: application` bewertet, Herstellerprodukte
mit `type: service`. Die Portfoliosichten (Enterprise) fassen beide zusammen.

**LLM-Bewertung als Abstimmungsschritt.** Die LLM-Bewertung verändert Ihre
Anwendungsergebnisse nicht. Sie führt die Bewertung einer Anwendung in isolierten Kopien
des Workspace mit mehreren Modellen erneut aus und zeigt, welches Modell das beste
Verhältnis aus Qualität, Kosten, Geschwindigkeit und Zuverlässigkeit bietet. Nutzen Sie
sie vor einem großen Projekt, um das Modell für die übrigen Läufe festzulegen.

---

## Die Service-Portfolio-Bewertung in Kürze

Die Service-Portfolio-Bewertung (neu in v1.4.0) ist für Portfolios aus Fremd-, SaaS- und
COTS-Anwendungen (Standardsoftware) gedacht, für die kein Quellcode vorliegt. Die
ausführlichen Seiten finden Sie unter [Service-Portfolio-Bewertung](/de/service-assessment/).

**Was Sie bereitstellen.** Eine Excel-Arbeitsmappe mit einer Zeile je Anwendung: Name,
Hersteller, Produkt, Version, Betriebssystem, Betriebsmodell, Kritikalität und
vergleichbare Spalten. Ein abweichendes Layout lässt sich über eine Spaltenzuordnung in
YAML abbilden ([Spaltenzuordnung](/de/service-assessment/column-mapping)). Optional
legen Sie je Anwendung Installationsdateien, SBOMs, Konfigurationsdateien oder
Herstellerdokumente ab.

**Was SWAO tut.**

1. `swao service init --from <arbeitsmappe.xlsx>` liest die Arbeitsmappe und legt je
   Zeile eine Workspace-App mit `assessment.type: service` an. Kontakt-, Telefon- und
   E-Mail-Spalten werden bereits bei der Erfassung bereinigt: SWAO speichert nur ein
   Vorhandensein-Kennzeichen (zum Beispiel `support_email_present: true`) und schreibt
   die personenbezogenen Werte nie in den Workspace. Jede Anwendung wird dem SWAO-Katalog
   für IT-Infrastruktur zugeordnet ([SWAO-INFRA-CAT](/de/service-assessment/infra-cat)),
   und Gruppen identischer Zeilen werden als Cluster erkannt (Standardschwelle: 3 Zeilen).
2. `swao service research` (Pass 24, [RESEARCH](/de/passes/24-research)) fragt für jede
   Anwendung öffentliche Quellen ab: die NIST-NVD-CVE-API, endoflife.date, den
   CISA-Feed der aktiv ausgenutzten Schwachstellen (KEV), OSV.dev, den
   Sicherheitshinweis-Feed von BSI CERT-Bund und optional VirusTotal für die Hashwerte
   von Installationsdateien (erfordert einen API-Schlüssel; siehe
   [API-Schlüssel](/de/service-assessment/api-keys)). Ausgehende Anfragen enthalten nur
   Hersteller, Produkt, Version, Betriebssystem und Hashwerte, niemals App-IDs,
   Standorte oder andere Erfassungsdaten. Die Ergebnisse werden als Recherche-Dateien
   abgelegt, die Analystinnen und Analysten prüfen und freigeben können.
3. `swao assess --app <id>` führt das Service-Pass-Profil aus. Passes, die Quellcode
   benötigen ([Inventar](/de/passes/01-inv), [Zustand](/de/passes/02-state),
   [Twelve-Factor](/de/passes/06-tf), [Egress](/de/passes/07-egr)), werden mit Angabe des
   Grundes übersprungen. [Kontext](/de/passes/04-ctx), [Synthese](/de/passes/09-synth),
   [Compliance](/de/passes/11-comp), [Blocks](/de/passes/12-blocks) und
   [Scope](/de/passes/13-scope) laufen immer. [Daten](/de/passes/03-data),
   [SBOM](/de/passes/05-sbom), [Kryptografie](/de/passes/08-crypto),
   [Dynamik](/de/passes/10-dynamic) und [Malware](/de/passes/14-malware) laufen nur,
   wenn Sie die passenden Eingaben bereitstellen. Pass 25 ([BINARY](/de/passes/25-binary))
   analysiert bereitgestellte Installations- und Binärdateien vor der eigentlichen
   Pass-Schleife.
4. Die Bewertung gegen das SWAO-Rahmenwerk für das Anwendungsportfolio
   ([SWAO_APM](/de/frameworks/swao-apm), 72 Kontrollen in 11 Domänen: strategische
   Passung, Herstellerstabilität, technischer Zustand, Sicherheitslage, Data Governance,
   Souveränitätsreife, Geschäftskritikalität, Hardware und Kosten,
   Integrationskomplexität, Migrationsreife, Compliance-Pflichten) liefert einen
   Health-Score je Domäne, einen gewichteten Risiko-Score und einen TIME-Quadranten je
   Anwendung. Siehe die [Rahmenwerkseite](/de/service-assessment/framework).
5. Die Anwendungen werden fünf [Migrationswellen](/de/service-assessment/migration-waves)
   zugeordnet. `swao service export` (Enterprise) schreibt die Portfolio-Arbeitsmappe
   (`wsp/reports/swao-portfolio-YYYYMMDD.xlsx`) und ein Sternschema.

---

## Zwei Entscheidungsmodelle: TIME und 7R

SWAO verwendet zwei etablierte Modelle. Sie beantworten unterschiedliche Fragen und
bilden keine gemeinsame Skala.

### TIME (Portfolio-Disposition)

TIME ist das Gartner-Modell für die Entscheidung, wie mit einer Anwendung im Portfolio
verfahren wird. Die Service-Portfolio-Bewertung ordnet jeder Service-App anhand der
Befunde genau einen TIME-Quadranten zu:

| Quadrant | Bedeutung in Klartext | Typischer Auslöser in SWAO |
|---|---|---|
| **Tolerate** (Tolerieren) | Weiterbetreiben, beobachten, nicht investieren | Herstellersupport besteht, kein überwiegendes Risiko |
| **Invest** (Investieren) | Strategisch wichtig und gesund: weiterentwickeln | Aktiv, strategisch bedeutsam, technisch solide, starker Hersteller |
| **Migrate** (Migrieren) | In einem geplanten Zeitfenster auf eine neue Plattform oder Version überführen | End of Life absehbar (zum Beispiel innerhalb von 18 Monaten) |
| **Migrate-Critical** (Dringend migrieren) | SWAO-Erweiterung: kurzfristig migrieren | Treffer im CISA-KEV-Katalog, kritische CVE bei End of Life innerhalb von 12 Monaten oder End of Life bereits überschritten ohne erweiterten Support |
| **Eliminate** (Eliminieren) | Außer Betrieb nehmen | Stillgelegt, ungenutzt oder inaktiv |

Die Quadranten bestimmen die Migrationswellen: Welle 1 Eliminate (sofort), Welle 2
Migrate-Critical (nächste 3 Monate), Welle 3 Migrate (3 bis 12 Monate), Welle 4 Invest
(12 bis 24 Monate), Welle 5 Tolerate (beobachten). Eine Migrate-Anwendung, die
Gesundheitsdaten oder besondere Kategorien personenbezogener Daten verarbeitet oder
deren End-of-Life-Signal blockiert ist, rückt in Welle 2 vor. Der TIME-Wert, den das
Projektteam in der Arbeitsmappe angegeben hat, bleibt als Eingabe für die strategische
Passung erhalten und wird nie überschrieben. Details: [TIME-Rahmenwerk](/de/service-assessment/framework).

### 7R (Migrationsstrategie)

Das 7R-Modell beschreibt, *wie* eine Anwendung auf die Zielplattform gelangt. Der
[Synthese-Pass](/de/passes/09-synth) der Anwendungsbewertung gibt je Anwendung genau ein
7R-Label aus:

| Strategie | Bedeutung in Klartext |
|---|---|
| **Retire** | Abschalten; die Funktion wird nicht mehr benötigt |
| **Retain** | Vorerst am bisherigen Ort belassen |
| **Rehost** | Lift and Shift: unverändert auf neue Infrastruktur verschieben |
| **Replatform** | Mit gezielten Plattformanpassungen verschieben (zum Beispiel verwaltete Datenbank) |
| **Repurchase** | Durch ein anderes Produkt ersetzen, oft SaaS |
| **Refactor** | Den Code so ändern, dass er die Zielplattform richtig nutzt |
| **Re-architect** | Die Architektur grundlegend neu gestalten |

Neben dem 7R-Label hält der Synthese-Pass eine strategische Disposition fest
(`modernization_position`, zum Beispiel `invest_modernize_now`, `migrate_stabilize`,
`tolerate_contain`, `retire_replace`) sowie einen Portabilitäts-Score. Meldet die
Landing-Zone-Bereitschaftsprüfung (Pass 23, [LZR](/de/passes/23-lzr)) das Ziel als
blockiert, wird die 7R-Empfehlung angepasst und die Anpassung protokolliert. Alle Passes
finden Sie in der [Pass-Referenz](/de/passes/).

---

## Gemeinsame Optionen

| Option | Gilt für | Beschreibung |
|---|---|---|
| `--app <id>` | alle Einzel-App-Läufe | Anwendungs-ID unter `apps/` im Workspace |
| `--type <typ>` | alle | `application` (Standard), `service`, `landing-zone-catalog`, `llm`. Überschreibt `assessment.type` in `.swao.yml`. `landing-zone` wird als veralteter Alias akzeptiert |
| `--workspace <pfad>` | alle | Portfolio-Workspace (Standard: wird ab dem aktuellen Verzeichnis aufwärts gesucht) |
| `--passes <liste>` | application, service | Kommagetrennte Pass-Schlüssel (Standard: die 13 Standard-Passes) |
| `--skip-llm` | application, service | Lässt die Passes `ctx`, `comp` und `blocks` weg |
| `--no-crawl` | application | Überspringt den Playwright-Crawl |
| `--portfolio` | application, service | Bewertet alle Anwendungen im Workspace (Enterprise) |
| `--force` | alle | Läuft auch, wenn für die Anwendung ein abgenommener Lauf gesperrt ist |
| `--stats` | application, service | Gibt eine Zeittabelle je Pass aus |

Mit `swao assess --help` erhalten Sie alle Optionen; siehe auch die
[CLI-Referenz](/de/runbooks/cli-reference).

---

## In der Terminaloberfläche (TUI)

Starten Sie `swao` ohne Argumente und wählen Sie **3 Run Assessment**. Das Typmenü zeigt
die vier Bewertungsarten in dieser Reihenfolge:

```
  [1] Application Assessment            swao assess - static + LLM pass suite
  [2] Service Portfolio Assessment      swao service - third-party apps, SaaS, COTS from an Excel intake
  [3] Landing Zone Catalog Assessment   swao assess --type landing-zone-catalog - CSP service catalog fit/gap
  [4] LLM Assessment for SWAO           swao assess --type llm - compare up to 5 LLMs on your assessed app
```

Zu jedem Eintrag zeigt die TUI vor der Bestätigung eine kurze Erläuterung. Die
einzelnen TUI-Schritte beschreiben die Seiten der jeweiligen Bewertungstypen.

---

## Weiterführende Seiten

- [Workspace einrichten](/de/workspace-setup) und [Workspace konfigurieren](/de/runbooks/workspace-config)
- [Health Check](/de/health-check): den Workspace vor dem ersten Lauf prüfen
- [Bericht erstellen](/de/generate-report), [HTML publizieren](/de/publish-html), [BI-Export](/de/export-bi)
- [Portfolio-Operationen](/de/portfolio) (Enterprise)
- [Community-Rahmenwerke](/de/frameworks/) und [Katalog der Bewertungsdimensionen](/de/assessment-dimension-catalogue)
- [Funktionen und Editionen](/de/features)
