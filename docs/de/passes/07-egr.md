# Pass 07: Egress-Analyse (EGR)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 07 |
| Schlüssel | `egr` |
| Pass-Name in der Ausgabe | `egress` |
| Signal-Präfix | `EGR` |
| Typ | Deterministisch (Regel-Engine), kein LLM |
| Standard | Aktiv |
| Assessment-Typen | `application`; `llm` (innerhalb jedes Legs). Bei `service` übersprungen (ohne Quellcode kein Egress-Graph). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Ein Workload ist nur so souverän wie die Dienste, die er aufruft. Der Umzug in eine souveräne Landing Zone hilft wenig, wenn die Anwendung weiterhin Daten an eine API in den USA sendet. Pass 07 beantwortet die Frage: **„An welche externen Dienste außerhalb des Zielrechtsraums sendet diese Anwendung Daten, und welche davon stehen einer Anforderung an die Datenresidenz entgegen?“**

Er ermittelt ausgehende Ziele anhand bekannter Client-Pakete und anhand von Domainnamen im Quellcode, hält ihren Rechtsraum fest und ob Standardvertragsklauseln (SCC) bestehen, und markiert Ziele, die eine reine DE- oder EU-Residenz verhindern. Für JVM-Dienste listet er zusätzlich jeden fest codierten Host in Java-Code und Spring-Konfiguration (HTTP-Basis-URLs, JDBC-URLs, Kafka-Bootstrap-Server), sodass auch Endpunkte außerhalb der Kataloge sichtbar werden.

## Was Sie bereitstellen müssen

- Den Quellcode der Anwendung: `package.json` und JavaScript- oder TypeScript-Dateien, oder JVM-Quellen (`.java`, `.kt`, `.kts`, `.groovy`, `.scala`) mit Spring-Konfiguration (`application*.yml|yaml|properties`, `bootstrap*`, beliebige `.properties`). Die Dateien kommen aus dem zentralen Quellcode-Scope, Build-Ausgaben (`target/`, `build/`, `node_modules/`) werden also nie gelesen, und die Testcode-Einstellung gilt.

Es werden weder Zugangsdaten noch Netzwerkzugang oder ein LLM benötigt.

## Wie der Pass arbeitet

1. **Paketprüfung.** `dependencies` und `devDependencies` der `package.json` im Wurzelverzeichnis werden mit drei bekannten Client-Paketen verglichen:

   | Paket | Ziel |
   |---|---|
   | `alphavantage` | `api.alphavantage.co` |
   | `yahoo-finance2` | `query1.finance.yahoo.com` |
   | `@aws-sdk/client-comprehendmedical` | `comprehendmedical.amazonaws.com` |

2. **Quellcode-Scan.** Alle Dateien mit den Endungen `.ts`, `.js`, `.mjs`, `.cjs`, `.java`, `.kt`, `.kts`, `.groovy` und `.scala` sowie die Spring-Konfigurationsdateien werden nach den sieben katalogisierten Domainnamen durchsucht:

   | Domain | Rechtsraum | SCC | Verhindert DE-only / EU-only |
   |---|---|---|---|
   | `api.alphavantage.co` | US | nein | ja |
   | `query1.finance.yahoo.com` | US | nein | ja |
   | `query2.finance.yahoo.com` | US | nein | ja |
   | `api.rapidapi.com` | US | nein | ja |
   | `comprehendmedical.amazonaws.com` | US | nein | ja |
   | `s3.amazonaws.com` | US (regionsabhängig) | nein | nein |
   | `api.coingecko.com` | unklar | nein | nein |

   Eine auf beiden Wegen gefundene Domain wird einmal gemeldet, mit dem Paket und der Quelldatei als Evidenz.
3. **Allowlist-Schutz.** Existiert der Ordner `apps/api/src/services/data-provider/`, prüft der Pass `data-provider.service.ts` auf eine Allowlist oder Blocklist (`allowlist`, `allowedDomains`, `sovereignProviders`, `blocklist`). Ein fehlender Schutz wird gemeldet, weil sonst neue Provider ohne Souveränitätskontrolle hinzugefügt werden könnten.
4. **Souveräne Verfügbarkeit von Diensten.** Der Pass liest `controls/sovereign-service-catalogue.yaml` (31 SaaS- und Cloud-Dienste, jeweils mit einem `portability_verdict` `available`, `partial` oder `unavailable`, einer Evidenzklasse `sovereign_evidence`, einer `verdict_confidence` `verified` oder `unverified`, den öffentlichen Quellen (`sources`) der Bewertung mit Prüfdatum und einem Flag `blocks_migration`). Der Kopf des Katalogs legt eine Bewertungsregel für alle Einträge fest: Ein Anbieter mit US-Muttergesellschaft (Zugriff nach US CLOUD Act) ist nie `available`; mit dokumentierter EU-Datenresidenz ist er `partial`, ohne sie `unavailable`. `blocks_migration` ist genau dann gesetzt, wenn eine Bewertung `unavailable` und `verified` ist. Ein Dienst gilt als genutzt, wenn eines seiner Client-Pakete in einer `package.json`, `requirements*.txt`, `pyproject.toml` oder `Pipfile` irgendwo im Quellbaum vorkommt (bis zu vier Ordnerebenen; `node_modules`, `dist`, `build`, `target`, `vendor` und virtuelle Umgebungen werden übersprungen) oder einer seiner API-Hostnamen in einer JavaScript- oder TypeScript-Datei steht. Beispiele: `@sentry/*` oder `sentry.io` (Sentry), `stripe` (Stripe), `firebase` oder `firebaseio.com` (Firebase), `@anthropic-ai/sdk` oder `api.anthropic.com` (Anthropic API), `@slack/*` oder `hooks.slack.com` (Slack), `@aws-sdk/client-cognito-identity-provider` (AWS Cognito). Die Zuordnung von Paketen und Hostnamen zu Katalogeinträgen ist im Pass festgelegt (`SOVEREIGN_SERVICE_DETECTION`); die Bewertungen stammen aus dem Katalog. Hostnamen werden in denselben Dateien wie in Schritt 2 gesucht, ein Host in Java-Code oder in `application.yml` zählt also.
5. **Fest codierte Endpunkte in JVM-Quellen und Spring-Konfiguration (#3422).** JVM-Quelldateien, Spring-Konfiguration und `.properties`-Dateien liest der gemeinsame Scanner für fest codierte Endpunkte (Design 117 Abschnitt 3): Netzwerk-URLs (http(s), JDBC, LDAP, AMQP, Redis, Kafka und die übrigen erkannten Schemata) und IPv4-Literale. Zwei Formen ohne `://` ergänzt der Pass: Kafka-Bootstrap-Listen (`spring.kafka.bootstrap-servers: host1:9092,host2:9092`, `bootstrap.servers=...`, `ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "host:9092"`, auch als YAML-Liste) und Oracle-Thin-JDBC-URLs (`jdbc:oracle:thin:@host:1521:SID`, `@//host:1521/service`). Es zählen nur meldefähige Hosts: `public` und `private` (interne Namen wie `kafka.internal`, einteilige Dienstnamen, RFC-1918-Adressen); Loopback, Dokumentationsnamen, XML-Namespaces und Platzhalter (`${DB_HOST}`) werden nicht gemeldet. Jede Fundstelle hält den HTTP-Client fest, in dem sie steht (`RestTemplate`, `WebClient`, `RestClient`, `Feign`, `OkHttp`, `JDK HttpClient`, `java.net`, `JDBC`; die Zeile selbst oder die Zeile darüber, wenn der Treffer eine Builder-Kette oder eine offene Argumentliste fortsetzt), in der Konfiguration ihren gepunkteten Schlüssel (`spring.datasource.url`). Hosts, die der Egress-Katalog oder der Katalog souveräner Dienste bereits meldet, werden übersprungen; ein Dienst wird nie doppelt gemeldet.

## Wie gemessen wird

| Signal | Wird erzeugt, wenn | Schweregrad | Bedeutung |
|---|---|---|---|
| `EGR-01` und folgende | Je gefundenem Ziel | critical (verhindert DE-only- oder EU-only-Residenz), medium (Rechtsraum unklar), high (sonstige) | Ziel, Rechtsraum, SCC-Status, Erkennungsweg; verhindernde Ziele nennen `blocks_migration: true` für DE-only- und EU-only-Residenz |
| Nächste Nummer | Data-Provider-Ordner existiert ohne Allowlist oder Blocklist | high | Keine Souveränitäts-Allowlist für Provider und kein geografischer Routing-Schutz |
| Nächste Nummern | Je gefundenem Eintrag des Katalogs souveräner Dienste (Schritt 4), der nicht schon oben ein Egress-Ziel ist | verifizierte Bewertungen: critical (`unavailable` und `blocks_migration: true`), high (`unavailable`), medium (`partial`), low (`available`); nicht verifizierte Bewertungen: höchstens medium und nie verhindernd; Konfidenz hoch bei Fund über ein Paket, mittel bei Fund über einen Hostnamen | Dienst, Anbieter, Katalogbewertung und deren Konfidenz, Evidenzklasse, Prüfdatum und `blocks_migration`, mit dem Hinweis, die konfigurierte Region und den Vertrag zu prüfen; `implies: sovereign_service:<id>` |
| Nächste Nummern | Der JVM-Endpunkt-Scan (Schritt 5) hat öffentliche und/oder private Hosts gefunden; ein Signal je Klasse | public: medium; private: low; eine Klasse, deren Hosts alle nur im Testcode stehen: informational, Konfidenz niedrig | Hosts mit Kanal (`http`, `database`, `messaging`, `cache`, `directory`, `mail`, `network`) und Client oder Schlüssel, Produktiv- und reine Test-Hosts getrennt aufgeführt, bis zu 10 Fundstellen als `Datei:Zeile` mit Produktivcode zuerst; bei öffentlichen Hosts ist der Rechtsraum unbekannt und zu prüfen, private Hosts sind interne Abhängigkeiten, die die Ziel-Landing-Zone erreichen muss |
| `EGR-01` (Rückfall) | Nichts gefunden | informational, Konfidenz niedrig | Keine bekannten Egress-Domains oder -Pakete erkannt; manuelle Prüfung empfohlen |

Der `assessment`-Block enthält:

- `egress_destinations`: ein Eintrag je Ziel mit `domain`, `jurisdiction`, `scc`, `blocks_migration`, `detected_via` (`package` oder `source_scan`) und `signal_ref`; oder `note: none_detected`
- `migration_blockers`: Anzahl der Ziele, die DE-only- oder EU-only-Residenz verhindern
- `sovereignty_claim_verified`: immer `false` (statische Analyse kann vertragliche Zusagen oder Routing nicht verifizieren)
- `sovereign_services`: ein Eintrag je gefundenem Katalogdienst mit `service_id`, `name`, `category`, `portability_verdict`, `verdict_confidence`, `sovereign_evidence`, `blocks_migration` (der wirksame Wert: false bei nicht verifizierter Bewertung), `detected_via`, `last_reviewed` und `signal_ref`; `merged_with_egress_destination` nennt die Egress-Domain, wenn der Dienst im Signal dieses Ziels gemeldet wurde
- `sovereign_service_blockers`: Anzahl der gefundenen Dienste mit wirksamem `blocks_migration: true` (getrennt von `migration_blockers` gezählt)
- `sovereign_services_merged_with_egress`: Anzahl der Dienste, die im Signal eines Egress-Ziels statt in einem eigenen Signal gemeldet wurden
- `sovereign_service_check`: `matched`, `no_match` oder `skipped: <Grund>`, wenn der Katalog fehlt oder ungültig ist
- `hardcoded_endpoints` (nur vorhanden, wenn Schritt 5 einen Host gefunden hat): `files_scanned` und je Host `host`, `classification` (`public` oder `private`), `channels`, `via`, `total`, `production`, `test`, `unclassified` und bis zu 20 `locations` (Datei, Zeile, Pfadklasse, Client oder Schlüssel), Produktivcode zuerst; diese Hosts zählen weder zu `egress_destinations` noch zu `migration_blockers`

**Wie die Ergebnisse in spätere Passes einfließen.** EGR-Signale werden im Prompt von [Pass 09 (SYNTH)](/de/passes/09-synth) ausdrücklich aufgeführt. Dessen `portability_score` ist definiert als Anteil der Egress-Ziele mit souveränem Cloud-Äquivalent: (verfügbar + 0,5 × teilweise) / Egress gesamt, mit 0,70 als Schwelle für Souveränitätsreife. EGR-Signale sind außerdem Evidenz für Controls zu Datenübermittlung und Drittländern in Pass 11 (COMP), etwa unter der DSGVO, wenn diese in `assessment.regimes_active` aktiv ist. Kritische Signale fließen in die abgeleiteten Findings ein; der Schweregrad critical kennzeichnet ein Finding dort als migrationsverhindernd.

## Drittanbieter-Module und Werkzeuge

Keine. Der Katalog aus Egress-Domains und -Paketen ist im Pass eingebaut; die Bewertungen souveräner Dienste werden aus `controls/sovereign-service-catalogue.yaml` gelesen, das mit SWAO ausgeliefert wird. Domainnamen werden ohne Beachtung der Groß- und Kleinschreibung als ganze Hostnamen über den gemeinsamen Katalog-Matcher abgeglichen (`bucket.s3.amazonaws.com` trifft `s3.amazonaws.com`, `mys3.amazonaws.com` nicht); generierte oder minifizierte Dateien, Base64-Folgen und `data:`-URIs werden übersprungen.

## Ausgaben

- `wsp/runs/<ts>/passes/07-egr.yaml` mit Kopf (`id: 7`, `name: egress`), Signalen und `assessment`.

## Konfiguration und Einschränkungen

**Konfiguration**

- `--passes egr` führt den Pass allein aus. Pass-spezifische Einstellungen gibt es nicht.

**Einschränkungen und bekannte Lücken**

- Der Egress-Katalog ist klein und fest im Code hinterlegt: sieben Domains und drei Pakete. Darüber hinaus werden nur die 31 Dienste des Katalogs souveräner Dienste erkannt (Schritt 4); jeder andere externe Dienst (etwa eine SaaS-API, ein Telemetrie-Endpunkt oder eine LLM-API) nicht. Verstehen Sie ein unauffälliges Ergebnis als „nichts aus der bekannten Liste“, nicht als „kein Egress“.
- Katalogisierte Hostnamen werden in JavaScript-, TypeScript- und JVM-Quelldateien sowie in Spring-Konfiguration gesucht; andere Sprachen, Umgebungsvorlagen und allgemeine Konfigurationsdateien nicht. Pakete souveräner Dienste werden nur aus npm- und Python-Manifesten gelesen (Maven- und Gradle-Koordinaten werden nicht zugeordnet).
- Der Scan fest codierter Endpunkte (Schritt 5) deckt nur JVM-Quellen und Spring-Konfiguration ab. Ein Host, der zur Laufzeit gebaut, aus einer Umgebungsvariablen gelesen wird oder als Platzhalter ohne Literal-Standardwert steht, bleibt unsichtbar. Multi-Host-JDBC-URLs von MySQL, MariaDB und PostgreSQL (`jdbc:mysql://h1:3306,h2:3306/db`, auch `jdbc:mysql:replication://` und `jdbc:mysql:loadbalance://`) melden jeden Host (#3485); die MySQL-Form `address=(host=...)` und Failover-Listen anderer Datenbanken (etwa die SQL-Server-Eigenschaft `failoverPartner`) werden nicht aufgeteilt. Ein IPv4-Host in einer solchen Liste behält den Kanal `network` des Treffers aus dem gemeinsamen Scanner.
- Ein Signal zu einem souveränen Dienst gibt die Katalogbewertung wieder, nicht die Konfiguration der Anwendung: Ein Dienst mit EU-Regionsoption (etwa Sentry oder Datadog) wird mit seiner Katalogbewertung gemeldet, gleich ob die EU-Region genutzt wird. Prüfen Sie `last_reviewed` im Signal; die Bewertungen sind nur so aktuell wie der Katalog.
- Nennen ein Egress-Ziel und ein Eintrag des Katalogs souveräner Dienste denselben Dienst (etwa AWS Comprehend Medical), erzeugt der Pass ein Signal: Das Egress-Signal trägt die Katalogbewertung, und eine verifizierte Bewertung bestimmt seinen Schweregrad und `blocks_migration`. Beide Signalarten tragen `implies: sovereign_service:<id>`, und derive-plan behält je Dienst ein Security-Finding und ein Risiko, auch für Läufe, die vor dieser Regel geschrieben wurden (#3296).
- Die Kennzeichnung als verhindernd stammt aus dem Katalogeintrag; der Pass liest die Residenzanforderung der Anwendung nicht.
- Die Allowlist-Prüfung gilt nur für eine bestimmte Ordnerstruktur (`apps/api/src/services/data-provider/`).
- Laufzeitverkehr wird nicht beobachtet. Für ein vollständigeres Bild nutzen Sie [Pass 10 (dynamische Analyse)](/de/passes/10-dynamic) und Kontextdokumente.
