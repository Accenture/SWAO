# Pass 01: Inventarisierung (INV)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 01 |
| Schlüssel | `inv` |
| Pass-Name in der Ausgabe | `inventory` |
| Signal-Präfix | `INV` |
| Typ | Deterministisch (Regel-Engine), kein LLM |
| Standard | Aktiv (Teil der Standardliste von `--passes`) |
| Assessment-Typen | `application`; `llm` (innerhalb jedes Legs). Bei `service` übersprungen (kein Quellcode). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Pass 01 beantwortet die erste Frage jedes Migrationsgesprächs: **„Woraus besteht diese Anwendung?“** Er ermittelt die Programmiersprache, die wichtigsten Frameworks, Datenbank-, Cache- und Queue-Technologie, die Art der Paketierung und Bereitstellung sowie die Backing Services (PostgreSQL, Redis, Objektspeicher usw.), die in der bereitgestellten Infrastruktur deklariert sind.

Das Ergebnis ist die faktische Grundlage für alles Weitere. Insbesondere werden die hier gefundenen Backing Services zur Liste der Dienste, die eine Ziel-Landing-Zone anbieten muss.

## Was Sie bereitstellen müssen

- **Quellcode der Anwendung.** Konfiguriert über `source.path` oder `source.vcs.url` in der App-`.swao.yml` oder überschrieben mit `swao assess --source-path <path>`.
- **Optional: Terraform- oder OpenTofu-State** als JSON (`*.tfstate`) in `wsp/inputs/terraform/` (Pass 00 leitet `.tfstate`-Dateien dorthin) oder im Wurzelverzeichnis des Quellcodes. Sowohl das klassische State-Format als auch die Ausgabe von `terraform show -json` werden verstanden.
- **Optional: Pulumi-Stack-Exporte** (`*.json`) in `wsp/inputs/pulumi/`, von Hand abgelegt oder von [Pass 00](/de/passes/00-ingest) aus Pulumi Cloud geladen.

Es werden weder Zugangsdaten noch ein LLM benötigt.

## Wie der Pass arbeitet

1. **Node.js- und TypeScript-Projekte.** Gibt es im Wurzelverzeichnis eine `package.json`, liest der Pass `dependencies` und `devDependencies`:
   - Sprache: TypeScript, wenn `tsconfig.json` existiert oder `typescript` eine Abhängigkeit ist, sonst JavaScript.
   - Frameworks: NestJS, Angular, Next.js, Fastify, Express, React und Nx, erkannt an ihren Paketnamen.
   - Version und Node.js-Engine-Vorgabe aus `version` und `engines.node`.
   - Datenbank: der `provider` in `prisma/schema.prisma` oder MongoDB, wenn `mongoose` oder `mongodb` eine Abhängigkeit ist.
   - Cache und Queue: Redis über `@keyv/redis`, `ioredis` oder `redis`; Bull bzw. BullMQ über `bull`, `@nestjs/bull` oder `bullmq`.
   - Node.js-Supportstatus aus der Engine-Vorgabe: Hauptversion 22 oder höher ist `active_lts`, 20 bis 21 ist `maintenance_lts`, unter 20 ist `eol`, ohne Vorgabe `unknown`.
2. **Build-Manifeste in beliebiger Tiefe (#3423).** Der Pass listet über den zentralen Source Scope jedes Build-Manifest bis zu vier Ordnerebenen unter dem Quellcode-Wurzelverzeichnis (Abhängigkeits- und Build-Ausgabeordner werden übersprungen): `pom.xml`, `build.gradle` und `build.gradle.kts`, `build.sbt`, `package.json`, `pyproject.toml`, `requirements*.txt`, `setup.py`, `setup.cfg` und `Pipfile`, `go.mod`, `*.csproj`, `*.vbproj`, `*.fsproj` und `*.sln`, `Cargo.toml`, `Gemfile` und `composer.json`. Ein Manifest im Testcode (etwa `systemtest/package.json`) wird als solches markiert.
3. **Andere Sprachen.** Fehlt eine `package.json` im Wurzelverzeichnis, nennt `INV-01` die Sprachen der produktiven Manifeste (reine Test-Manifeste zählen nur, wenn es kein produktives Manifest gibt), etwa "Java (Maven service/pom.xml)"; die Hauptsprache (`assessment.language`) ist die mit den meisten produktiven Zeilen im Zensus. Ohne Manifest werden die Sprachen des Zensus gemeldet ("no build manifest"). Mit einer `package.json` im Wurzelverzeichnis bleibt `INV-01` die Node.js-Beschreibung und nennt die weiteren produktiven Manifeste.
4. **Sprachzensus (#3423).** Jede Quelldatei mit einer bekannten Programmiersprachen-Endung (Java, Kotlin, Scala, Groovy, TypeScript, JavaScript, Python, Go, C#, VB.NET, F#, Rust, Ruby, PHP, C, C++, Swift, Dart, COBOL, Shell einschließlich `.ksh`, PowerShell, SQL) wird gezählt: Dateien und nicht leere Zeilen je Sprache, getrennt in Produktiv- und Testcode nach der Testklassifizierung des Source Scope. Generierte oder minifizierte Dateien und Dateien über 2 MB werden nicht mitgezählt und nur als Anzahl ausgewiesen. Auszeichnungs- und Datenformate (HTML, CSS, XML, YAML, JSON) werden nicht gezählt.
5. **Sprachabdeckungsmatrix (#3423).** Für jede Sprache im Zensus hält der Pass fest, wie jeder Standard-Pass, der Quelldateien oder Manifeste liest (inv, state, data, sbom, tf, egr, crypto, secrets), sie abdeckt: `deterministic` (eine regelbasierte Prüfung liest die Dateien oder Manifeste der Sprache), `llm` (der Pass gibt Quelldateien der Sprache in einen Sprachmodell-Prompt; derzeit die Datenklassifizierung für TypeScript, JavaScript, Java, Kotlin, Python, Go, C#, Rust und Ruby) oder `none`. Kontextaufnahme, Compliance-Bewertung, Synthese und Block-Bewertungen werten Signale und bereitgestellte Dokumente aus, keine Quelldateien, und sind nicht Teil der Matrix. Die Zellen werden aus den Dateiendungen und Paket-Ökosystemen abgeleitet, die die Passes tatsächlich lesen (etwa liest der Egress-Quelltextscan nur `.ts`, `.js`, `.mjs` und `.cjs`; der Krypto-Katalogscan liest zusätzlich `.java`, `.py`, `.cs`, `.go` und `.kt`), die Matrix folgt also dem Code. Eine Sprache gilt als deterministisch analysiert, wenn mindestens ein Codeanalyse-Pass (state, data, sbom, tf, egr, crypto) sie abdeckt.
6. **Rust-Backing-Services.** Bei Rust-Projekten liest der Pass `Cargo.toml` (und die Member-Crates eines `[workspace]`-Manifests) und erkennt PostgreSQL, MySQL oder SQLite über Features von `sqlx`, `diesel` oder `sea-orm`, Redis über `redis`, `fred` oder `deadpool-redis` sowie MongoDB über `mongodb`.
7. **Container und Orchestrierung.** Der Pass sucht bis zu drei Verzeichnisebenen tief nach `docker-compose*.yml`, `compose*.yml` sowie `Dockerfile` oder `Dockerfile.*` und prüft das Wurzelverzeichnis auf `k8s/`- oder `helm/`-Verzeichnisse. Bei einer Compose-Datei zählt er die deklarierten Services.
8. **Infrastruktur-State.** Er liest jede `.tfstate`-Datei aus `wsp/inputs/terraform/` und dem Quellcode-Wurzelverzeichnis (durch die Ingestion-Nummerierung entstandene Duplikate werden zusammengefasst) und ordnet Ressourcen Backing Services zu:
   - `docker_container`-Images wie `postgres`, `redis`, `mongo`, `mysql`, `mariadb`, `minio`, `rabbitmq` oder `kafka` (12 Image-Muster), mit Rückfall auf Umgebungsvariablen, Kommando oder Ressourcenname, wenn nur ein Image-Digest gespeichert ist.
   - 98 Cloud-Ressourcentypen von AWS, Azure, Google Cloud, STACKIT, Hetzner Cloud, OpenStack, DigitalOcean und weiteren Anbietern, ergänzt um Attributprüfungen (zum Beispiel ein Datenbank-Engine-Attribut).
9. **Pulumi-State.** Er liest jede `.json`-Datei in `wsp/inputs/pulumi/` und ordnet 58 Pulumi-Ressourcentypen auf dieselbe Weise Backing Services zu.
10. Bereits aus dem Quellcode erkannte Dienste werden aus dem Infrastruktur-State nicht erneut gemeldet.
11. **Abgleich mit Referenzkatalogen (#3160).** Der Pass durchläuft den Quellbaum (bis zu vier Ordnerebenen; `node_modules`, `dist`, `build`, `target`, `vendor`, `bin`, `obj`, `out`, virtuelle Umgebungen und versteckte Ordner werden übersprungen) und liest jedes gefundene Abhängigkeitsmanifest, sprachunabhängig: `package.json` (npm), `requirements*.txt`, `pyproject.toml` und `Pipfile` (Python), `Cargo.toml` (Rust), `pom.xml`, `build.gradle` und `build.gradle.kts` (Maven-Gruppe und -Artefakt), `*.csproj` und `packages.config` (NuGet). Zusätzlich liest er Container-Images aus Compose-Dateien und Dockerfiles sowie Dateinamen. Das Ergebnis wird mit drei Katalogen in `controls/` abgeglichen:
   - **`vendor-sdk-catalogue.yaml`** (21 Hersteller-SDKs, etwa SDKs von AWS, Google Cloud, Firebase und Azure, Clients für IBM MQ, TIBCO EMS, Oracle, SQL Server und Db2, Stripe, Sentry, Twilio, SendGrid). Paketmuster gelten exakt oder, mit abschließendem `*`, als Präfix; Maven-Muster werden mit der Group-ID verglichen; Python-Namen nach PEP-503-Normalisierung. Erzeugt `INV-09`.
   - **`legacy-indicators-catalogue.yaml`** (20 Indikatoren in drei Stufen: Stufe 1 Blocker wie IBM MQ, TIBCO, Oracle SOA, BizTalk, COM, SAP RFC und Progress OpenEdge; Stufe 2 Erschwernisse wie Oracle, SQL Server, Db2, COBOL, Oracle AQ JMS, Sybase und Informix (eine Abhängigkeit nur auf die JMS-API oder auf einen Open-Source-Broker wird nicht gemeldet); Stufe 3 beherrschbare Muster wie XSLT, NTLM, log4j 1.x und native Bibliotheken). Angewendet werden Regeln zu Abhängigkeiten, Container-Images und Dateinamen. Eine Regel, die der Katalog mit einem Hinweis einschränkt (etwa `pyodbc`, `lxml` oder das Rust-Crate `windows` für COM), ergibt niedrige Konfidenz. Erzeugt `INV-08`.
   - **`db-compatibility-catalogue.yaml`** (18 Zeilen für PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Oracle, SQL Server, Db2 und Elasticsearch nach Versionsbereich; Versionen nach dem Upstream-Supportende, etwa PostgreSQL 12 und 13 oder MySQL 5.7, sind als `migration_required` eingestuft). Engines stammen aus `assessment.database_engine`, aus `service_dep:`-Tags früherer INV-Signale (mit Version, wenn der IaC-State eine enthält, etwa `postgresql@16`), aus Container-Images (die Version wird aus dem Image-Tag gelesen, etwa `postgres:11-alpine`), aus Datenbank-Client-Bibliotheken und aus den Hersteller-SDK-Treffern für Oracle, SQL Server und Db2. Erzeugt `INV-07`.
12. **Service-Footprint (#3430).** Zuletzt leitet der Pass mit `controls/service-footprint-catalogue.yaml` die Backing Services ab, die eine Landing Zone bereitstellen muss: Maven-, Gradle-, npm- und pip-Abhängigkeiten (ohne Test-Scope, etwa `spring-kafka` zu Kafka, `mariadb-java-client` zu MariaDB, das S3-SDK zu Object Storage), Images der Compose-Services, Kubernetes-Manifeste (Workloads zu Kubernetes, Ingress oder ein Service vom Typ `LoadBalancer` zu einem Load Balancer, Persistent Volume Claims zu Block Storage, Container-Images, Abhängigkeiten von Helm-Charts, ConfigMap-Einträge), Konfigurationsdateien (`application*`, `bootstrap*`, Helm-`values*`: JDBC-URLs, Broker-Endpunkte, Issuer-URIs), Liquibase-`dbms`-Dialekte sowie Nennungen als ganzes Wort in README, CHANGELOG, `docs/` und den Prosadokumenten in `wsp/inputs/` (ohne Eingaben mit Rolle Ziel). Jeder Dienst trägt seine Evidenzpfade und Quellarten; ein nur in Dokumenten genannter Dienst hat niedrige Konfidenz. Das Ergebnis steht in `assessment.service_footprint`, und Dienste, die kein früheres Signal nennt, erhalten ein `service_dep`-Signal, sodass der Landing-Zone-Abgleich sie gegen den Zielkatalog prüft.

## Wie gemessen wird

| Signal | Wird erzeugt, wenn | Schweregrad | Bedeutung |
|---|---|---|---|
| `INV-00` | Überhaupt kein Sprachindikator (kein Build-Manifest in beliebiger Tiefe und keine Quelldatei in einer erkannten Sprache) | high (Outcome negative) | Das Quellverzeichnis ist leer oder zeigt auf den falschen Ordner; statische Passes können nicht analysieren. Korrigieren Sie `source.path` oder `source.vcs.url`. |
| `INV-01` | Immer, wenn eine Sprache gefunden wird | informational | Sprache, Frameworks, Version und Node.js-Vorgabe (Node-Projekte, dazu weitere Build-Manifeste) bzw. die erkannten Sprachen mit ihren Manifestpfaden (andere Stacks); die Nachweise nennen die gefundenen Manifeste |
| `INV-02` | Prisma-Schema, Prisma- oder Mongoose/MongoDB-Abhängigkeit gefunden | informational | Primäre Datenbank-Engine und ORM. Ergänzt `service_dep:postgresql`, `service_dep:mysql` oder `service_dep:mongodb` |
| `INV-03` | Redis- oder Bull/BullMQ-Abhängigkeit gefunden | informational | Cache- und Queue-Technologie. Verweist auf `STATE-02`; ergänzt `service_dep:redis`, wenn Redis genutzt wird |
| `INV-04` | `package.json` vorhanden | informational | Anwendungsversion und Node.js-Supportstatus (`active_lts`, `maintenance_lts`, `eol`, `unknown`) |
| `INV-05` | Immer | informational (Kubernetes), medium (nur Compose oder Dockerfile), high (keine Container-Konfiguration) | Laufzeit und Bereitstellungsmuster. Verweist auf `STATE-04`, wenn Container ohne Kubernetes genutzt werden |
| `INV-06` | `.tf`-Dateien im Wurzelverzeichnis, aber keine State-Datei | informational | Hinweis: `terraform show -json > terraform.tfstate` ausführen und die Ausgabe in `wsp/inputs/terraform/` ablegen |
| `INV-07` | Eine Datenbank-Engine aus `db-compatibility-catalogue.yaml` wird gefunden | schwerster Wert über die Engines: informational (souveräne Verfügbarkeit `available`), medium (`partial`), high (`vm_only`), critical (`not_available`); low, wenn die Version unbekannt ist und die Katalogzeilen der Engine voneinander abweichen. Konfidenz high, wenn alle Engine-Versionen bekannt sind, medium, wenn einige bekannt sind, low, wenn keine bekannt ist | Je Engine und Version: Kompatibilität, Aufwand und souveräne Verfügbarkeit laut Katalog; fordert bei unbekannter Version dazu auf, sie festzulegen |
| `INV-08` | Ein Legacy-Indikator aus `legacy-indicators-catalogue.yaml` wird gefunden | schwerster Wert über die Indikatoren: high (Stufe 1), medium (Stufe 1 nur mit niedriger Konfidenz, oder Stufe 2), low (Stufe 3). Trägt `legacy_tier` mit der schwersten Stufe | Anzahl je Stufe und die gefundenen Indikatoren; Treffer mit niedriger Konfidenz tragen den Hinweis „inspect usage“ |
| `INV-09` | Ein Hersteller-SDK aus `vendor-sdk-catalogue.yaml` wird gefunden | schwerster Wert über die SDKs: high (`sovereign_impact: blocks_migration`), medium (`partial`), low (`manageable`), informational (`none`) | Die SDKs mit Lock-in-Stufe und souveräner Auswirkung; nennt die SDKs, die eine souveräne Migration verhindern |
| `INV-10` bis `INV-89` | Je gefundenem Backing Service aus Rust-Manifesten, Terraform/OpenTofu-State oder Pulumi-State; danach je Service-Footprint-Fähigkeit mit Build-, Compose-, Kubernetes-, Konfigurations- oder Changelog-Nachweis sowie ein zusammengefasstes Signal (niedrige Konfidenz) für die nur in Dokumenten genannten Dienste | informational | Nennt den Dienst und den Nachweis; ergänzt `service_dep:<service>` |
| `INV-90` | Der Zensus hat mindestens eine Quelldatei gezählt | informational | Sprachzensus: LOC je Sprache mit Testanteil und Dateianzahl, Summen für Produktiv- und Testcode, Ausschlüsse, dominante Sprache. Die Nachweise nennen die Build-Manifeste |
| `INV-91` | Mehr als 50 % der produktiven Zeilen sind in Sprachen, die kein deterministischer Codeanalyse-Pass liest | medium (Outcome negative) | Nennt die Sprachen und ihren Anteil; abgesehen vom Secret-Scan wird dieser Code nur analysiert, wo ein LLM-Prompt ihn enthält, oder gar nicht |

**Wie die Ergebnisse in spätere Passes einfließen.** Die Tags `service_dep:<service>` bilden die Liste der benötigten Dienste. Sie werden vom Landing-Zone-Abgleich in [Pass 09 (SYNTH)](/de/passes/09-synth), vom integrierten Landing-Zone-Katalogabgleich und von Pass 23 (LZR) genutzt. Der hier geschriebene Wert `assessment.language` legt fest, welche Logging-Prüfungen [Pass 06 (TF)](/de/passes/06-tf) anwendet. Alle INV-Signale gehören zur Evidenz, auf deren Basis Pass 11 (COMP) und Pass 09 (SYNTH) urteilen. Pass 12 (BLOCKS) erhält alle Signale des Laufs; `INV-07`, `INV-08` und `INV-09` sind damit Evidenz für seine Blöcke zu Datenbank, Legacy und Portabilität, ohne dass sein Prompt geändert wird.

Der `assessment`-Block enthält: `language`, `framework`, `app_version`, `node_version_constraint`, `node_eol_status`, `database_engine`, `orm`, `cache_engine`, `queue_engine`, `runtime_type` (`kubernetes`, `container`, `unknown`), `docker_compose`, `dockerfile`, `k8s_manifests`, `compose_service_count`, bei Nicht-Node-Stacks `detected_languages` und immer `language_census` (Methode, Summen, `languages` mit Dateien, LOC und Testanteil je Sprache, `manifests` mit Pfad, Art, Ökosystem, Tiefe und Testkennzeichen, höchstens 200, und `manifests_total`) sowie `language_coverage` (`passes`, `rows` mit einer Zelle je Pass, `dominant_language`, `uncovered_loc_share`, `warning`). Die Publikation zeigt beides im Abschnitt "Sprachabdeckung". Der Abgleich mit Referenzkatalogen ergänzt `vendor_sdks` (Katalog-ID, Name, Hersteller, `lock_in_level`, `sovereign_impact`, `sovereign_alternative`, Nachweise), `legacy_indicators` (Katalog-ID, Name, Stufe, Konfidenz, `sovereign_alternative`, `migration_effort_weeks`, Nachweise), `database_compatibility` (Engine, Version oder null, die zutreffenden Katalogzeilen, Schweregrad, Nachweise) und `reference_catalogue_checks` (`vendor_sdk`, `legacy_indicators`, `db_compatibility`: `matched`, `no_match` oder `skipped: <Grund>`, wenn ein Katalog fehlt oder ungültig ist).

## Drittanbieter-Module und Werkzeuge

| Name | Zweck in diesem Pass | Lizenz (Paket-Metadaten) | Gebündelt oder extern | Verhalten bei Fehlen |
|---|---|---|---|---|
| `@swao/module-iac-scan` (SWAO-intern) | Parsen von Terraform/OpenTofu- und Pulumi-State, Zuordnung Ressource zu Dienst | Internes SWAO-Paket | Gebündelt | Entfällt |

Es wird kein externes Kommandozeilenwerkzeug aufgerufen. `package.json`, `Cargo.toml`, `go.mod`, Prisma-Schemata und die vom Katalogabgleich gelesenen Manifeste werden mit eingebautem JSON-Parsing und regulären Ausdrücken ausgewertet. Die drei Referenzkataloge sind YAML-Dateien in `controls/`, die mit SWAO ausgeliefert werden; jeder wird beim Laden gegen ein Schema geprüft.

## Ausgaben

- `wsp/runs/<ts>/passes/01-inv.yaml`: Pass-Kopf (`id: 1`, `name: inventory`, `signal_prefix: INV`, `status`), die Signalliste und der `assessment`-Block. Jedes Signal trägt `assessor: rule_engine` und einen Provenienz-Block.

## Konfiguration und Einschränkungen

**Konfiguration**

- `source.path` oder `source.vcs.url` in der App-`.swao.yml`; `--source-path <path>` auf der Kommandozeile.
- `swao assess --app <id> --passes inv` führt nur diesen Pass aus.
- `assessment.lenses` (ein Pass-Filter, keine Framework-Auswahl) kann den Pass aus einem Lauf entfernen; Frameworks werden getrennt über `assessment.regimes_active` gewählt.

**Einschränkungen und bekannte Lücken**

- Die Erkennung von Frameworks, Datenbank und Cache ist für Node.js und TypeScript (über `package.json`) und, für Backing Services, für Rust umgesetzt. Python, Go, Java und C# werden nur als Sprache erkannt.
- Der Zensus zählt nicht leere Zeilen einschließlich Kommentarzeilen; Werte können daher leicht über denen von Werkzeugen liegen, die nur Codezeilen zählen. `scc` oder `tokei` werden nicht verwendet.
- Die Abdeckungsmatrix sagt, welcher Pass eine Sprache liest, nicht wie tief die Regeln gehen: Java gilt für den Krypto-Pass über Katalog-Importmuster als abgedeckt, was deutlich schmaler ist als der TypeScript-Primitivscan.
- Die Datenbankerkennung liest nur `prisma/schema.prisma` und Mongoose/MongoDB-Pakete; andere ORMs (etwa TypeORM oder Sequelize) werden nicht erkannt.
- `INV-06` und die Kubernetes-Erkennung betrachten nur das Wurzelverzeichnis (`k8s/`, `helm/`, `*.tf`).
- Infrastruktur-State wird gegen feste Zuordnungstabellen geprüft; nicht zugeordnete Ressourcentypen erzeugen kein Signal.
- Die Nummern der Dienst-Signale enden bei `INV-89` (`INV-90` und `INV-91` sind Zensus und Abdeckungswarnung).
- Der Abgleich mit Referenzkatalogen prüft nur deklarierte Abhängigkeiten, Image-Namen und Dateinamen. Die Katalogregeln `code_pattern`, `sql_pattern` und `jar_patterns` der Legacy-Indikatoren werden nicht angewendet (Quelltextmuster wie `NTLM` oder `FIND FIRST` sind ohne Parser zu unspezifisch), und die Dateimuster `*.p`, `*.i`, `*.cls`, `*.df`, `*.process`, `*.wsdl`, `*.so` und `*.dll` werden ignoriert, weil sie mit verbreiteten Nicht-Legacy-Dateien kollidieren. Eine Abhängigkeit belegt das Vorhandensein, nicht die Nutzung: Bestätigen Sie Funde mit niedriger Konfidenz und Funde der Stufe 1 im Code.
- Manche Technologien stehen in mehr als einem Katalog (etwa sind Clients für IBM MQ, TIBCO, Oracle und SQL Server sowohl Hersteller-SDKs in `INV-09` als auch Legacy-Indikatoren in `INV-08`, und Oracle fließt zusätzlich in `INV-07` ein). Die Signale beschreiben unterschiedliche Aspekte und werden nicht dedupliziert.
- Go-Module werden beim Katalogabgleich nicht gelesen; die Kataloge enthalten keine Go-Regeln.
