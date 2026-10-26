# Pass 02: State Analysis (STATE)

| Property | Value |
|---|---|
| Pass number | 02 |
| Key | `state` |
| Pass name in output | `state_analysis` |
| Signal prefix | `STATE` |
| Type | Deterministic (rule engine), no LLM |
| Default | On |
| Assessment types | `application`; `llm` (inside each leg). Skipped for `service` (no stateful code analysis without source). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Stateless components can be moved by redeploying them. Stateful components (databases, queues, session stores) need a data migration, a cut-over plan and attention to recovery objectives. Pass 02 answers: **"What state does this application hold, and where is the single point of failure?"**

It identifies the primary database, Redis cache and job queue usage, the session model (stateless tokens or server-side sessions) and whether the deployment topology is a single-node setup that conflicts with operational resilience requirements such as DORA. For JVM services (Java, Kotlin, Spring Boot) it also finds the relational database (JDBC and JPA), server-side HTTP sessions, Spring Session stores, in-process caches and static mutable state (including Kotlin `object` state), and session affinity (sticky sessions).

## What you need to provide

- The application source tree (`source.path`, `source.vcs.url` or `--source-path`).
- The pass reads: `package.json` and `prisma/schema.prisma` at the source root, `docker-compose.yml` at the root or in `docker/`, and the `k8s/` and `helm/` directories at the root. For JVM services it also reads, through the central source scope (build output such as `target/` excluded): JVM source files (`.java`, `.kt`, `.kts`, `.groovy`, `.scala`), Spring configuration (`application*.yml|yaml|properties`, `bootstrap*`, any `.properties`), `pom.xml` / `build.gradle(.kts)` (with their scope-resolved dependencies), and YAML, `.conf`, `.cfg`, `.xml` and `.toml` files for session affinity and database URLs. Files of an Android (mobile) app are skipped: everything under an `android/` folder (React Native, Flutter, Capacitor), Android modules with an `AndroidManifest.xml`, and build files that apply the Android Gradle plugin. A repository whose only Java or Kotlin files belong to such an app therefore keeps the `package.json` checks.

No credentials and no LLM are needed.

## How it works

1. **Primary database.** If `prisma/schema.prisma` exists, the `provider` value is taken as the database engine and the Prisma version is read from `package.json`. If only the Prisma client is a dependency, the pass reports that the database type cannot be confirmed. Without Prisma, a JVM service gets its database from the JDBC and JPA patterns of step 5 (#3485).
2. **Cache and queue.** Redis is recognised through `@keyv/redis`, `ioredis` or `redis`; a job queue through `bull`, `@nestjs/bull` or `bullmq`. When a queue runs on Redis, Redis persistence (AOF plus RDB) is flagged as required.
3. **Session model.** `@nestjs/jwt`, `jsonwebtoken` or `jose` without a session library means stateless JWT authentication. `express-session` or `koa-session` means server-side sessions, which must be migrated as stateful components.
4. **Topology.** `k8s/` or `helm/` at the root means Kubernetes with horizontal scaling. A `docker-compose.yml` at the root or in `docker/` without Kubernetes manifests is treated as a single-node Compose deployment, which is a single point of failure.
5. **JVM session and state patterns (#3422).** When a JVM build file or JVM source file is in scope, the pass matches deterministic patterns line by line (shared catalogue matcher, identifier boundaries, linear regexes) and reads Spring configuration by its dotted key (`spring.session.store-type`, also in nested YAML form):

   | Finding | Recognised by |
   |---|---|
   | Container (in-memory) sessions | `HttpSession`, `.getSession()`, `@SessionAttributes`, `@SessionAttribute`, `@SessionScope`, `@Scope("session")`, `SCOPE_SESSION`; `server.servlet.session.*` / `server.reactive.session.*` settings |
   | Spring Session (external store) | `@EnableRedisHttpSession`, `@EnableJdbcHttpSession`, `@EnableMongoHttpSession`, `@EnableHazelcastHttpSession` and similar; `spring.session.*` keys; `spring-session-data-redis`, `spring-session-jdbc` and similar in the build file |
   | Stateless authentication | `SessionCreationPolicy.STATELESS`, `.oauth2ResourceServer(`, `JwtDecoder`, `io.jsonwebtoken`, `com.auth0.jwt` |
   | Redis | `RedisConnectionFactory`, `LettuceConnectionFactory`, `RedisTemplate` and similar; `spring.redis.host`, `spring.data.redis.host` (also `url`, `cluster.nodes`); the Redis starter in the build file |
   | In-memory caches | `ConcurrentMapCacheManager`, `CaffeineCacheManager`, `Caffeine.newBuilder`, Guava `CacheBuilder.newBuilder`, Ehcache; `spring.cache.type` `simple`, `caffeine`, `jcache` or `ehcache` |
   | Static mutable state | `static` field of a mutable JDK collection type initialised with `new` (`static final Map<..> X = new ConcurrentHashMap<>()`); immutable `Map.of` / `List.of` do not count |
   | Kotlin object state (#3485) | In `.kt` files, a direct member of an `object` or `companion object`, or a top-level declaration, that is a `var` or a `val` holding a mutable collection or atomic (`mutableMapOf`, `MutableList<..>`, `ConcurrentHashMap`, `AtomicInteger` and similar); only the declaration head (`val handlers`) is recorded |
   | Session affinity | `nginx.ingress.kubernetes.io/affinity`, `session-cookie-name`, `sessionAffinity: ClientIP`, `stickiness.enabled=true`, `stickysession`, `jvmRoute`, Traefik `loadbalancer.sticky` |
   | JDBC (#3485) | `spring.datasource.url` (also `spring.datasource.hikari.jdbc-url`, `spring.r2dbc.url`, `spring.flyway.url`, `spring.liquibase.url`) and `spring.datasource.driver-class-name`; a `jdbc:<engine>:` URL under any key in YAML, `.properties` or XML (Helm values, app-server datasources); `JdbcTemplate`, `NamedParameterJdbcTemplate`, `JdbcClient`, `HikariDataSource`, `DataSourceBuilder`, `DriverManager.getConnection`; JDBC starters and drivers in the build (PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, Db2, H2, HSQLDB, Derby, SQLite), test scope excluded |
   | JPA (#3485) | `@Entity`, `@EnableJpaRepositories`, `@PersistenceContext`, `EntityManager`, `JpaRepository<..>`, `JpaSpecificationExecutor<..>`, `R2dbcRepository<..>`; `spring.jpa.*` settings; `persistence.xml`; `hibernate.dialect`; `spring-boot-starter-data-jpa`, `spring-data-jpa` and `hibernate-core` in the build |

   The database engine comes from production hits only: the JDBC URL sub-protocol, the driver class, the Hibernate dialect or `spring.jpa.database`, or a driver dependency. A JDBC URL location records only its `jdbc:<engine>` prefix and a configuration location only its key, so hosts and credentials never reach the pass output.

   The session model comes from production hits only: Spring Session gives `server_session_external`, container sessions `server_session`, stateless authentication without session use `jwt_stateless`, and none of these `none_detected` (the Spring Boot baseline). Hits in test code are counted separately and named in the signal; under `assessment.test_code.mode: exclude` test files are not read at all.

## How it is measured

| Signal | Emitted when | Severity | Meaning |
|---|---|---|---|
| `STATE-01` | Prisma schema present, or Prisma client in dependencies; without Prisma, a JVM service with JDBC or JPA hits in production code | informational | Primary stateful store and ORM (confidence high with schema, medium without). For JVM services: the engine (embedded H2, HSQLDB, Derby or SQLite flagged as process-local state), the data access (JPA or JDBC) and `file:line` evidence; confidence high when exactly one server engine is named, medium otherwise. Hits in test code only produce no signal |
| `STATE-02` | Redis or Bull/BullMQ dependency found; for JVM services a Spring Data Redis connection or configuration | medium (queue on Redis, or Spring Session stored in Redis), low (cache only) | Queue jobs (or active sessions) are lost on a Redis restart unless AOF plus RDB persistence is enabled; this is a recovery point objective (RPO) risk |
| `STATE-03` | Always | informational | Session model: `jwt_stateless`, `server_session` or `unknown`; for JVM services `server_session_external`, `server_session`, `jwt_stateless` or `none_detected`, with `file:line` evidence (confidence high, medium for `none_detected`) |
| `STATE-04` | Always | high (single-node Compose), informational (Kubernetes or unknown) | Single point of failure assessment for resilience requirements |
| `STATE-05` | JVM service with in-memory caches, static mutable collections or Kotlin object state | low (informational when seen in test code only) | Every replica holds its own copy: caches diverge and static state is lost on restart; horizontal scaling needs a shared cache or confirmation that the state is a read-only lookup |
| `STATE-06` | JVM service with session affinity configured | medium (informational when seen in test code only) | Instances are not interchangeable; a node loss drops the sessions pinned to it |

Outcomes follow the severity: `informational` signals are `neutral`, `low` to `high` signals are `negative`.

**How results feed later passes.** [Pass 01 (INV)](/passes/01-inv) points to `STATE-02` and `STATE-04` through its `implies` tags. `STATE-04` at high severity is a typical input for resilience controls evaluated by Pass 11 (COMP) when frameworks such as DORA are active in `assessment.regimes_active`, and for the 7R reasoning in [Pass 09 (SYNTH)](/passes/09-synth). High-severity signals also become entries in the derived findings and risk register.

The `assessment` block records `primary_db`, `orm`, `cache_engine`, `queue_engine`, `redis_persistence_configured` (always `false`: the pass cannot see runtime configuration), `session_type`, `deployment_type` (`kubernetes`, `single_node_compose`, `unknown`), `spof_risk` and a `stateful_components` list (for JVM services also a `session_store` entry when Spring Session is used, and a `database` entry from JDBC or JPA). For a JVM database `primary_db` is one engine in the Prisma provider vocabulary (`postgresql`, `mysql`, `sqlserver`, `sqlite`, otherwise `mariadb`, `oracle`, `db2`, `h2`, `hsqldb`, `derby`) or `unknown` when none or several server engines are named, `orm` is `jpa` or `jdbc`, and `database_engines` lists every engine found, sorted. JVM services add `jvm_state`: `spring_boot`, `stack_evidence`, `jvm_source_files`, `spring_config_files`, `android_files_excluded` (only when Android app files were skipped) and per finding (`http_session`, `spring_session`, `servlet_session_config`, `stateless_auth`, `in_memory_cache`, `static_mutable_state`, `redis`, `sticky_session`, `jdbc`, `jpa`, `kotlin_object_state`) `total`, `production`, `test`, `unclassified`, `stores` (Spring Session store, or the database engines of `jdbc` / `jpa`) and up to 20 `locations` (file, line, path class), production first.

## Third-party modules and tools

None. The pass uses built-in file reading, JSON parsing, regular expressions and the shared catalogue matcher (`catalogue-matcher.ts`) for the JVM patterns.

## Outputs

- `wsp/runs/<ts>/passes/02-state.yaml` with header (`id: 2`, `name: state_analysis`, `signal_prefix: STATE`), signals and the `assessment` block.

## Configuration and limitations

**Configuration**

- Source location keys as for [Pass 01](/passes/01-inv); `--passes state` runs the pass alone.

**Limitations and known gaps**

- Databases are recognised through Prisma and, for JVM services, through JDBC and JPA. Python, .NET and Go services are not covered, and Node.js database clients other than Prisma (for example `pg`, `mysql2`, TypeORM) do not produce `STATE-01`. Non-relational stores of JVM services (MongoDB, Cassandra, Elasticsearch) are not reported as the primary database; generic Spring Data repositories (`CrudRepository`) do not count as JPA because Redis and MongoDB use them too.
- A database URL set only through an environment variable or a placeholder (`${DB_URL}`) names no engine; without a driver class, dialect or driver dependency the engine is `unknown`. When several server engines are found (for example a reporting database next to the main one), `primary_db` is `unknown` and `database_engines` lists them; the pass does not decide which one is primary.
- The JVM patterns read source text, not the runtime configuration: a session started by a library or set through environment variables is not seen, and `none_detected` is a pattern result, not a proof of statelessness. Kotlin `object` state is found by indentation: members of an object declared on one line (`object X { var y = 0 }`) and unusual formatting are not seen, and a `var` holding a value that is only written at start-up still counts.
- The Android exclusion is path and build-file based: Java or Kotlin server code placed inside an `android/` folder is skipped as well.
- `STATE-05` and `STATE-06` are emitted for JVM services only; session affinity in a Node.js repository is not reported.
- `STATE-04` checks only two fixed Compose paths (`docker-compose.yml` and `docker/docker-compose.yml`). [Pass 01](/passes/01-inv) searches three directory levels and more file name patterns, so the two passes can disagree on whether Compose is present.
- Redis persistence settings are not read; `redis_persistence_configured` is always `false`.
- Object storage, file shares and other stateful infrastructure are covered by Pass 01 service detection, not by this pass.
