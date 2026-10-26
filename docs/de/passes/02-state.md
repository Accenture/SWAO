# Pass 02: Zustandsanalyse (STATE)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 02 |
| Schlüssel | `state` |
| Pass-Name in der Ausgabe | `state_analysis` |
| Signal-Präfix | `STATE` |
| Typ | Deterministisch (Regel-Engine), kein LLM |
| Standard | Aktiv |
| Assessment-Typen | `application`; `llm` (innerhalb jedes Legs). Bei `service` übersprungen (ohne Quellcode keine Zustandsanalyse). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Zustandslose Komponenten lassen sich durch erneutes Deployment umziehen. Zustandsbehaftete Komponenten (Datenbanken, Queues, Session-Speicher) erfordern eine Datenmigration, einen Umstellungsplan und Aufmerksamkeit für Wiederherstellungsziele. Pass 02 beantwortet die Frage: **„Welchen Zustand hält diese Anwendung, und wo liegt der Single Point of Failure?“**

Er ermittelt die primäre Datenbank, die Nutzung von Redis als Cache und Job-Queue, das Session-Modell (zustandslose Tokens oder serverseitige Sessions) und ob die Bereitstellungstopologie ein Einzelknoten-Setup ist, das Anforderungen an die operative Resilienz wie DORA widerspricht. Für JVM-Dienste (Java, Kotlin, Spring Boot) findet er zusätzlich die relationale Datenbank (JDBC und JPA), serverseitige HTTP-Sessions, Spring-Session-Speicher, prozessinterne Caches und statischen veränderlichen Zustand (einschließlich Zustand in Kotlin-`object`-Deklarationen) sowie Session-Affinität (Sticky Sessions).

## Was Sie bereitstellen müssen

- Den Quellcode der Anwendung (`source.path`, `source.vcs.url` oder `--source-path`).
- Der Pass liest: `package.json` und `prisma/schema.prisma` im Wurzelverzeichnis, `docker-compose.yml` im Wurzelverzeichnis oder in `docker/` sowie die Verzeichnisse `k8s/` und `helm/` im Wurzelverzeichnis. Für JVM-Dienste liest er zusätzlich über den zentralen Quellcode-Scope (Build-Ausgaben wie `target/` ausgenommen): JVM-Quelldateien (`.java`, `.kt`, `.kts`, `.groovy`, `.scala`), Spring-Konfiguration (`application*.yml|yaml|properties`, `bootstrap*`, beliebige `.properties`), `pom.xml` / `build.gradle(.kts)` (mit ihren nach Scope aufgelösten Abhängigkeiten) sowie YAML-, `.conf`-, `.cfg`-, `.xml`- und `.toml`-Dateien für die Session-Affinität und Datenbank-URLs. Dateien einer Android-App (Mobilanwendung) werden übersprungen: alles unterhalb eines Ordners `android/` (React Native, Flutter, Capacitor), Android-Module mit einer `AndroidManifest.xml` und Build-Dateien, die das Android-Gradle-Plugin anwenden. Ein Repository, dessen einzige Java- oder Kotlin-Dateien zu einer solchen App gehören, behält daher die Prüfungen über `package.json`.

Es werden weder Zugangsdaten noch ein LLM benötigt.

## Wie der Pass arbeitet

1. **Primäre Datenbank.** Existiert `prisma/schema.prisma`, wird der Wert von `provider` als Datenbank-Engine übernommen und die Prisma-Version aus `package.json` gelesen. Ist nur der Prisma-Client als Abhängigkeit vorhanden, meldet der Pass, dass der Datenbanktyp nicht bestätigt werden kann. Ohne Prisma ermittelt ein JVM-Dienst seine Datenbank über die JDBC- und JPA-Muster aus Schritt 5 (#3485).
2. **Cache und Queue.** Redis wird über `@keyv/redis`, `ioredis` oder `redis` erkannt, eine Job-Queue über `bull`, `@nestjs/bull` oder `bullmq`. Läuft eine Queue auf Redis, wird Redis-Persistenz (AOF plus RDB) als erforderlich markiert.
3. **Session-Modell.** `@nestjs/jwt`, `jsonwebtoken` oder `jose` ohne Session-Bibliothek bedeutet zustandslose JWT-Authentifizierung. `express-session` oder `koa-session` bedeutet serverseitige Sessions, die als zustandsbehaftete Komponente migriert werden müssen.
4. **Topologie.** `k8s/` oder `helm/` im Wurzelverzeichnis bedeutet Kubernetes mit horizontaler Skalierung. Eine `docker-compose.yml` im Wurzelverzeichnis oder in `docker/` ohne Kubernetes-Manifeste gilt als Einzelknoten-Compose-Bereitstellung und damit als Single Point of Failure.
5. **JVM-Session- und Zustandsmuster (#3422).** Liegt eine JVM-Build-Datei oder JVM-Quelldatei im Scope, gleicht der Pass deterministische Muster zeilenweise ab (gemeinsamer Katalog-Matcher, Bezeichnergrenzen, lineare reguläre Ausdrücke) und liest Spring-Konfiguration über ihren gepunkteten Schlüssel (`spring.session.store-type`, auch in verschachtelter YAML-Form):

   | Befund | Erkannt an |
   |---|---|
   | Container-Sessions (im Speicher) | `HttpSession`, `.getSession()`, `@SessionAttributes`, `@SessionAttribute`, `@SessionScope`, `@Scope("session")`, `SCOPE_SESSION`; Einstellungen `server.servlet.session.*` / `server.reactive.session.*` |
   | Spring Session (externer Speicher) | `@EnableRedisHttpSession`, `@EnableJdbcHttpSession`, `@EnableMongoHttpSession`, `@EnableHazelcastHttpSession` und ähnliche; Schlüssel `spring.session.*`; `spring-session-data-redis`, `spring-session-jdbc` und ähnliche in der Build-Datei |
   | Zustandslose Authentifizierung | `SessionCreationPolicy.STATELESS`, `.oauth2ResourceServer(`, `JwtDecoder`, `io.jsonwebtoken`, `com.auth0.jwt` |
   | Redis | `RedisConnectionFactory`, `LettuceConnectionFactory`, `RedisTemplate` und ähnliche; `spring.redis.host`, `spring.data.redis.host` (auch `url`, `cluster.nodes`); der Redis-Starter in der Build-Datei |
   | Caches im Speicher | `ConcurrentMapCacheManager`, `CaffeineCacheManager`, `Caffeine.newBuilder`, Guava `CacheBuilder.newBuilder`, Ehcache; `spring.cache.type` `simple`, `caffeine`, `jcache` oder `ehcache` |
   | Statischer veränderlicher Zustand | `static`-Feld eines veränderlichen JDK-Collection-Typs, das mit `new` initialisiert wird (`static final Map<..> X = new ConcurrentHashMap<>()`); unveränderliche `Map.of` / `List.of` zählen nicht |
   | Zustand in Kotlin-Objekten (#3485) | In `.kt`-Dateien ein direktes Mitglied eines `object` oder `companion object` oder eine Deklaration auf oberster Ebene, die ein `var` ist oder ein `val` mit einer veränderlichen Collection oder einem Atomic (`mutableMapOf`, `MutableList<..>`, `ConcurrentHashMap`, `AtomicInteger` und ähnliche); erfasst wird nur der Deklarationskopf (`val handlers`) |
   | Session-Affinität | `nginx.ingress.kubernetes.io/affinity`, `session-cookie-name`, `sessionAffinity: ClientIP`, `stickiness.enabled=true`, `stickysession`, `jvmRoute`, Traefik `loadbalancer.sticky` |
   | JDBC (#3485) | `spring.datasource.url` (auch `spring.datasource.hikari.jdbc-url`, `spring.r2dbc.url`, `spring.flyway.url`, `spring.liquibase.url`) und `spring.datasource.driver-class-name`; eine URL `jdbc:<engine>:` unter beliebigem Schlüssel in YAML, `.properties` oder XML (Helm-Values, Datasources von Anwendungsservern); `JdbcTemplate`, `NamedParameterJdbcTemplate`, `JdbcClient`, `HikariDataSource`, `DataSourceBuilder`, `DriverManager.getConnection`; JDBC-Starter und -Treiber im Build (PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, Db2, H2, HSQLDB, Derby, SQLite), ohne Test-Scope |
   | JPA (#3485) | `@Entity`, `@EnableJpaRepositories`, `@PersistenceContext`, `EntityManager`, `JpaRepository<..>`, `JpaSpecificationExecutor<..>`, `R2dbcRepository<..>`; Einstellungen `spring.jpa.*`; `persistence.xml`; `hibernate.dialect`; `spring-boot-starter-data-jpa`, `spring-data-jpa` und `hibernate-core` im Build |

   Die Datenbank-Engine ergibt sich nur aus Treffern im Produktivcode: aus dem Subprotokoll der JDBC-URL, der Treiberklasse, dem Hibernate-Dialekt oder `spring.jpa.database` oder aus einer Treiberabhängigkeit. Eine Fundstelle mit JDBC-URL erfasst nur das Präfix `jdbc:<engine>`, eine Konfigurationsfundstelle nur ihren Schlüssel; Hosts und Zugangsdaten gelangen daher nie in die Pass-Ausgabe.

   Das Session-Modell ergibt sich nur aus Treffern im Produktivcode: Spring Session ergibt `server_session_external`, Container-Sessions `server_session`, zustandslose Authentifizierung ohne Session-Nutzung `jwt_stateless` und keines davon `none_detected` (die Spring-Boot-Basislinie). Treffer im Testcode werden getrennt gezählt und im Signal genannt; unter `assessment.test_code.mode: exclude` werden Testdateien gar nicht gelesen.

## Wie gemessen wird

| Signal | Wird erzeugt, wenn | Schweregrad | Bedeutung |
|---|---|---|---|
| `STATE-01` | Prisma-Schema vorhanden oder Prisma-Client in den Abhängigkeiten; ohne Prisma ein JVM-Dienst mit JDBC- oder JPA-Treffern im Produktivcode | informational | Primärer zustandsbehafteter Speicher und ORM (Konfidenz hoch mit Schema, mittel ohne). Bei JVM-Diensten: die Engine (eingebettete H2, HSQLDB, Derby oder SQLite als prozesslokaler Zustand gekennzeichnet), der Datenzugriff (JPA oder JDBC) und Evidenz als `Datei:Zeile`; Konfidenz hoch, wenn genau eine Server-Engine genannt ist, sonst mittel. Treffer nur im Testcode erzeugen kein Signal |
| `STATE-02` | Redis- oder Bull/BullMQ-Abhängigkeit gefunden; bei JVM-Diensten eine Spring-Data-Redis-Verbindung oder -Konfiguration | medium (Queue auf Redis oder Spring Session in Redis), low (nur Cache) | Queue-Jobs (bzw. aktive Sessions) gehen bei einem Redis-Neustart verloren, sofern keine AOF-plus-RDB-Persistenz aktiv ist; ein Risiko für das Recovery Point Objective (RPO) |
| `STATE-03` | Immer | informational | Session-Modell: `jwt_stateless`, `server_session` oder `unknown`; bei JVM-Diensten `server_session_external`, `server_session`, `jwt_stateless` oder `none_detected`, mit Evidenz als `Datei:Zeile` (Konfidenz hoch, mittel bei `none_detected`) |
| `STATE-04` | Immer | high (Einzelknoten-Compose), informational (Kubernetes oder unbekannt) | Bewertung des Single Point of Failure im Hinblick auf Resilienzanforderungen |
| `STATE-05` | JVM-Dienst mit Caches im Speicher, statischen veränderlichen Collections oder Zustand in Kotlin-Objekten | low (informational bei Vorkommen nur im Testcode) | Jede Replik hält ihre eigene Kopie: Caches laufen auseinander und statischer Zustand geht beim Neustart verloren; horizontale Skalierung braucht einen gemeinsamen Cache oder die Bestätigung, dass der Zustand eine reine Nachschlagetabelle ist |
| `STATE-06` | JVM-Dienst mit konfigurierter Session-Affinität | medium (informational bei Vorkommen nur im Testcode) | Instanzen sind nicht austauschbar; fällt ein Knoten aus, gehen die an ihn gebundenen Sessions verloren |

Die Outcomes folgen dem Schweregrad: `informational`-Signale sind `neutral`, Signale von `low` bis `high` sind `negative`.

**Wie die Ergebnisse in spätere Passes einfließen.** [Pass 01 (INV)](/de/passes/01-inv) verweist über seine `implies`-Tags auf `STATE-02` und `STATE-04`. `STATE-04` mit hohem Schweregrad ist ein typischer Input für Resilienz-Controls, die Pass 11 (COMP) bewertet, wenn Frameworks wie DORA in `assessment.regimes_active` aktiv sind, sowie für die 7R-Bewertung in [Pass 09 (SYNTH)](/de/passes/09-synth). Signale mit hohem Schweregrad werden außerdem zu Einträgen in den abgeleiteten Findings und im Risikoregister.

Der `assessment`-Block enthält `primary_db`, `orm`, `cache_engine`, `queue_engine`, `redis_persistence_configured` (immer `false`, da der Pass keine Laufzeitkonfiguration sieht), `session_type`, `deployment_type` (`kubernetes`, `single_node_compose`, `unknown`), `spof_risk` und eine Liste `stateful_components` (bei JVM-Diensten mit Spring Session zusätzlich ein Eintrag `session_store` und bei JDBC oder JPA ein Eintrag `database`). Für eine JVM-Datenbank ist `primary_db` eine Engine im Vokabular der Prisma-Provider (`postgresql`, `mysql`, `sqlserver`, `sqlite`, sonst `mariadb`, `oracle`, `db2`, `h2`, `hsqldb`, `derby`) oder `unknown`, wenn keine oder mehrere Server-Engines genannt sind; `orm` ist `jpa` oder `jdbc`, und `database_engines` listet alle gefundenen Engines sortiert auf. JVM-Dienste ergänzen `jvm_state`: `spring_boot`, `stack_evidence`, `jvm_source_files`, `spring_config_files`, `android_files_excluded` (nur wenn Dateien einer Android-App übersprungen wurden) und je Befund (`http_session`, `spring_session`, `servlet_session_config`, `stateless_auth`, `in_memory_cache`, `static_mutable_state`, `redis`, `sticky_session`, `jdbc`, `jpa`, `kotlin_object_state`) `total`, `production`, `test`, `unclassified`, `stores` (Spring-Session-Speicher bzw. die Datenbank-Engines von `jdbc` / `jpa`) und bis zu 20 `locations` (Datei, Zeile, Pfadklasse), Produktivcode zuerst.

## Drittanbieter-Module und Werkzeuge

Keine. Der Pass nutzt eingebautes Dateilesen, JSON-Parsing, reguläre Ausdrücke und für die JVM-Muster den gemeinsamen Katalog-Matcher (`catalogue-matcher.ts`).

## Ausgaben

- `wsp/runs/<ts>/passes/02-state.yaml` mit Kopf (`id: 2`, `name: state_analysis`, `signal_prefix: STATE`), Signalen und dem `assessment`-Block.

## Konfiguration und Einschränkungen

**Konfiguration**

- Schlüssel für den Quellcode-Ort wie bei [Pass 01](/de/passes/01-inv); `--passes state` führt den Pass allein aus.

**Einschränkungen und bekannte Lücken**

- Datenbanken werden über Prisma und bei JVM-Diensten über JDBC und JPA erkannt. Python-, .NET- und Go-Dienste sind nicht abgedeckt, und Node.js-Datenbank-Clients außer Prisma (etwa `pg`, `mysql2`, TypeORM) erzeugen kein `STATE-01`. Nicht relationale Speicher von JVM-Diensten (MongoDB, Cassandra, Elasticsearch) werden nicht als primäre Datenbank gemeldet; generische Spring-Data-Repositories (`CrudRepository`) zählen nicht als JPA, weil Redis und MongoDB sie ebenfalls nutzen.
- Eine Datenbank-URL, die nur über eine Umgebungsvariable oder einen Platzhalter (`${DB_URL}`) gesetzt wird, nennt keine Engine; ohne Treiberklasse, Dialekt oder Treiberabhängigkeit ist die Engine `unknown`. Werden mehrere Server-Engines gefunden (etwa eine Reporting-Datenbank neben der Hauptdatenbank), ist `primary_db` `unknown` und `database_engines` listet sie auf; der Pass entscheidet nicht, welche die primäre ist.
- Die JVM-Muster lesen Quelltext, nicht die Laufzeitkonfiguration: Eine Session, die eine Bibliothek startet oder die über Umgebungsvariablen gesetzt wird, bleibt unsichtbar, und `none_detected` ist ein Musterergebnis, kein Nachweis von Zustandslosigkeit. Zustand in Kotlin-Objekten wird über die Einrückung erkannt: Mitglieder eines einzeilig deklarierten Objekts (`object X { var y = 0 }`) und ungewöhnliche Formatierung bleiben unsichtbar, und ein `var`, das nur beim Start geschrieben wird, zählt trotzdem.
- Der Android-Ausschluss beruht auf Pfaden und Build-Dateien: Java- oder Kotlin-Servercode, der in einem Ordner `android/` liegt, wird ebenfalls übersprungen.
- `STATE-05` und `STATE-06` werden nur für JVM-Dienste erzeugt; Session-Affinität in einem Node.js-Repository wird nicht gemeldet.
- `STATE-04` prüft nur zwei feste Compose-Pfade (`docker-compose.yml` und `docker/docker-compose.yml`). [Pass 01](/de/passes/01-inv) sucht drei Verzeichnisebenen tief und nach mehr Dateinamensmustern; die beiden Passes können daher zu unterschiedlichen Ergebnissen kommen, ob Compose vorhanden ist.
- Redis-Persistenzeinstellungen werden nicht gelesen; `redis_persistence_configured` ist immer `false`.
- Objektspeicher, Dateifreigaben und andere zustandsbehaftete Infrastruktur deckt die Diensterkennung von Pass 01 ab, nicht dieser Pass.
