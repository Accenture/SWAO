# Pass 01: Inventory (INV)

| Property | Value |
|---|---|
| Pass number | 01 |
| Key | `inv` |
| Pass name in output | `inventory` |
| Signal prefix | `INV` |
| Type | Deterministic (rule engine), no LLM |
| Default | On (part of the default `--passes` list) |
| Assessment types | `application`; `llm` (inside each leg). Skipped for `service` (no source tree). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Pass 01 answers the first question of every migration conversation: **"What is this application made of?"** It identifies the programming language, the main frameworks, the database, cache and queue technology, how the application is packaged and deployed, and which backing services (PostgreSQL, Redis, object storage and so on) the deployed infrastructure declares.

The result is the factual baseline for everything that follows. In particular, the backing services found here become the list of services a target landing zone must offer.

## What you need to provide

- **Application source tree.** Configured with `source.path` or `source.vcs.url` in the app `.swao.yml`, or overridden with `swao assess --source-path <path>`.
- **Optional: Terraform or OpenTofu state** as JSON (`*.tfstate`) in `wsp/inputs/terraform/` (Pass 00 routes `.tfstate` files there) or at the root of the source tree. Both the classic state format and the output of `terraform show -json` are understood.
- **Optional: Pulumi stack exports** (`*.json`) in `wsp/inputs/pulumi/`, either placed by hand or downloaded by [Pass 00](/passes/00-ingest) from Pulumi Cloud.

No credentials and no LLM are needed.

## How it works

1. **Node.js and TypeScript projects.** If `package.json` exists at the source root, the pass reads `dependencies` and `devDependencies`:
   - Language: TypeScript when `tsconfig.json` exists or `typescript` is a dependency, otherwise JavaScript.
   - Frameworks: NestJS, Angular, Next.js, Fastify, Express, React and Nx, recognised by their package names.
   - Version and Node.js engine constraint from `version` and `engines.node`.
   - Database: the `provider` in `prisma/schema.prisma`, or MongoDB when `mongoose` or `mongodb` is a dependency.
   - Cache and queue: Redis via `@keyv/redis`, `ioredis` or `redis`; Bull or BullMQ via `bull`, `@nestjs/bull` or `bullmq`.
   - Node.js support status from the engine constraint: major version 22 or later is `active_lts`, 20 to 21 is `maintenance_lts`, below 20 is `eol`, no constraint is `unknown`.
2. **Build manifests at any depth (#3423).** The pass lists every build manifest up to four folder levels below the source root through the central source scope (dependency and build-output folders are skipped): `pom.xml`, `build.gradle` and `build.gradle.kts`, `build.sbt`, `package.json`, `pyproject.toml`, `requirements*.txt`, `setup.py`, `setup.cfg` and `Pipfile`, `go.mod`, `*.csproj`, `*.vbproj`, `*.fsproj` and `*.sln`, `Cargo.toml`, `Gemfile` and `composer.json`. A manifest in test code (for example `systemtest/package.json`) is tagged as such.
3. **Other languages.** If there is no root `package.json`, `INV-01` names the languages of the production manifests (test-only manifests count only when there is no production manifest), for example "Java (Maven service/pom.xml)", and the primary language (`assessment.language`) is the one with the most production lines in the census. Without any manifest the census languages are reported ("no build manifest"). With a root `package.json`, `INV-01` stays the Node.js description and names the further production manifests.
4. **Language census (#3423).** Every source file with a known programming-language extension (Java, Kotlin, Scala, Groovy, TypeScript, JavaScript, Python, Go, C#, VB.NET, F#, Rust, Ruby, PHP, C, C++, Swift, Dart, COBOL, Shell including `.ksh`, PowerShell, SQL) is counted: files and non-blank lines per language, split into production and test code by the source scope's test classification. Generated or minified files and files above 2 MB are excluded from the counts and reported as numbers. Markup and data formats (HTML, CSS, XML, YAML, JSON) are not counted.
5. **Language coverage matrix (#3423).** For each language in the census the pass records how each default pass that reads source files or manifests (inv, state, data, sbom, tf, egr, crypto, secrets) covers it: `deterministic` (a rule-based check reads the language's files or manifests), `llm` (the pass puts the language's source files into a language-model prompt; today the data classification for TypeScript, JavaScript, Java, Kotlin, Python, Go, C#, Rust and Ruby) or `none`. Context ingestion, compliance evaluation, synthesis and block assessments reason over signals and supplied documents, not source files, and are not part of the matrix. The cells are derived from the extension sets and package ecosystems the passes actually scan (for example the egress source scan reads `.ts`, `.js`, `.mjs` and `.cjs` only; the crypto catalogue scan also reads `.java`, `.py`, `.cs`, `.go` and `.kt`), so the matrix follows the code. A language counts as deterministically analysed when at least one code-analysis pass (state, data, sbom, tf, egr, crypto) covers it.
6. **Rust backing services.** For Rust projects the pass reads `Cargo.toml` (and the member crates of a `[workspace]` manifest) and recognises PostgreSQL, MySQL or SQLite through `sqlx`, `diesel` or `sea-orm` features, Redis through `redis`, `fred` or `deadpool-redis`, and MongoDB through `mongodb`.
7. **Container and orchestration.** The pass searches up to three directory levels for `docker-compose*.yml`, `compose*.yml` and `Dockerfile` or `Dockerfile.*`, and checks for `k8s/` or `helm/` directories at the root. For a Compose file it counts the declared services.
8. **Infrastructure state.** It reads every `.tfstate` file from `wsp/inputs/terraform/` and the source root (duplicates created by ingestion numbering are collapsed) and maps resources to backing services:
   - `docker_container` images such as `postgres`, `redis`, `mongo`, `mysql`, `mariadb`, `minio`, `rabbitmq` or `kafka` (12 image patterns), with fallbacks to environment variables, command or resource name when only an image digest is stored.
   - 98 cloud resource types across AWS, Azure, Google Cloud, STACKIT, Hetzner Cloud, OpenStack, DigitalOcean and others, plus attribute checks (for example a database engine attribute).
9. **Pulumi state.** It reads every `.json` file in `wsp/inputs/pulumi/` and maps 58 Pulumi resource types to backing services in the same way.
10. Services already detected from source code are not repeated from infrastructure state.
11. **Reference catalogue scans (#3160).** The pass walks the source tree (up to four folder levels; `node_modules`, `dist`, `build`, `target`, `vendor`, `bin`, `obj`, `out`, virtual environments and hidden folders are skipped) and reads every dependency manifest it finds, in all languages: `package.json` (npm), `requirements*.txt`, `pyproject.toml` and `Pipfile` (Python), `Cargo.toml` (Rust), `pom.xml`, `build.gradle` and `build.gradle.kts` (Maven group and artifact), `*.csproj` and `packages.config` (NuGet). It also reads container images from Compose files and Dockerfiles, and file names. The result is matched against three catalogues in `controls/`:
   - **`vendor-sdk-catalogue.yaml`** (21 vendor SDKs, for example AWS, Google Cloud, Firebase and Azure SDKs, IBM MQ, TIBCO EMS, Oracle, SQL Server and Db2 clients, Stripe, Sentry, Twilio, SendGrid). Package patterns are exact or, with a trailing `*`, prefix matches; Maven patterns are matched against the group ID; Python names are compared after PEP 503 normalisation. Emits `INV-09`.
   - **`legacy-indicators-catalogue.yaml`** (20 indicators in three tiers: tier 1 blockers such as IBM MQ, TIBCO, Oracle SOA, BizTalk, COM, SAP RFC and Progress OpenEdge; tier 2 complicators such as Oracle, SQL Server, Db2, COBOL, Oracle AQ JMS, Sybase and Informix (a dependency on the JMS API alone or on an open-source broker is not flagged); tier 3 manageable patterns such as XSLT, NTLM, log4j 1.x and native libraries). Dependency, container image and file name rules are applied. A rule that the catalogue qualifies with a note (for example `pyodbc`, `lxml`, or the Rust `windows` crate for COM) yields low confidence. Emits `INV-08`.
   - **`db-compatibility-catalogue.yaml`** (18 rows for PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Oracle, SQL Server, Db2 and Elasticsearch by version range; versions past upstream end of life, such as PostgreSQL 12 and 13 or MySQL 5.7, are rated `migration_required`). Engines come from `assessment.database_engine`, from `service_dep:` tags of earlier INV signals (with the version when IaC state records one, for example `postgresql@16`), from container images (the version is read from the image tag, for example `postgres:11-alpine`), from database client libraries, and from the Oracle, SQL Server and Db2 vendor SDK matches. Emits `INV-07`.
12. **Service footprint (#3430).** Last, the pass derives the backing services a landing zone must provide, using `controls/service-footprint-catalogue.yaml`: Maven, Gradle, npm and pip dependencies (test scope excluded, for example `spring-kafka` to Kafka, `mariadb-java-client` to MariaDB, the S3 SDK to object storage), Compose service images, Kubernetes manifests (workloads to Kubernetes, Ingress or a `LoadBalancer` Service to a load balancer, persistent volume claims to block storage, container images, Helm chart dependencies, ConfigMap entries), configuration files (`application*`, `bootstrap*`, Helm `values*`: JDBC URLs, broker endpoints, issuer URIs), Liquibase `dbms` dialects and whole-word mentions in README, CHANGELOG, `docs/` and the prose documents in `wsp/inputs/` (target-role inputs excluded). Each service carries its evidence paths and source kinds; a service named only in documents has low confidence. The result is `assessment.service_footprint`, and services no earlier signal names get a `service_dep` signal, so the landing zone fit checks them against the target catalogue.

## How it is measured

| Signal | Emitted when | Severity | Meaning |
|---|---|---|---|
| `INV-00` | No language indicator at all (no build manifest at any depth and no source file in a recognised language) | high (outcome negative) | Source directory is empty or points at the wrong folder; static passes cannot analyse. Fix `source.path` or `source.vcs.url`. |
| `INV-01` | Always when a language is found | informational | Language, frameworks, version and Node.js constraint (Node projects, plus further build manifests), or the detected languages with their manifest paths (other stacks); evidence lists the manifests found |
| `INV-02` | Prisma schema, Prisma or Mongoose/MongoDB dependency found | informational | Primary database engine and ORM. Adds `service_dep:postgresql`, `service_dep:mysql` or `service_dep:mongodb` |
| `INV-03` | Redis or Bull/BullMQ dependency found | informational | Cache and queue technology. Points to `STATE-02`; adds `service_dep:redis` when Redis is used |
| `INV-04` | `package.json` present | informational | Application version and Node.js support status (`active_lts`, `maintenance_lts`, `eol`, `unknown`) |
| `INV-05` | Always | informational (Kubernetes), medium (Compose or Dockerfile only), high (no container configuration) | Runtime and deployment pattern. Points to `STATE-04` when containers are used without Kubernetes |
| `INV-06` | `.tf` files at the source root but no state file | informational | Guidance: run `terraform show -json > terraform.tfstate` and place the output in `wsp/inputs/terraform/` |
| `INV-07` | A database engine in `db-compatibility-catalogue.yaml` is found | worst over the engines: informational (sovereign availability `available`), medium (`partial`), high (`vm_only`), critical (`not_available`); low when the version is unknown and the catalogue rows of the engine disagree. Confidence high when every engine version is known, medium when some are, low when none are | Per engine and version: compatibility, effort and sovereign availability from the catalogue; asks to pin the version when it is unknown |
| `INV-08` | A legacy indicator in `legacy-indicators-catalogue.yaml` is found | worst over the indicators: high (tier 1), medium (tier 1 with low confidence only, or tier 2), low (tier 3). Carries `legacy_tier` set to the worst tier | Counts per tier and the indicators found; low-confidence matches say "inspect usage" |
| `INV-09` | A vendor SDK in `vendor-sdk-catalogue.yaml` is found | worst over the SDKs: high (`sovereign_impact: blocks_migration`), medium (`partial`), low (`manageable`), informational (`none`) | The SDKs with lock-in level and sovereign impact; names the SDKs that block a sovereign migration |
| `INV-10` to `INV-89` | One per backing service found in Rust manifests, Terraform/OpenTofu state or Pulumi state; then one per service footprint capability with build, Compose, Kubernetes, configuration or changelog evidence, and one aggregated signal (low confidence) for the services named only in documents | informational | Names the service and the evidence; adds `service_dep:<service>` |
| `INV-90` | The census counted at least one source file | informational | Language census: LOC per language with the test share and file count, totals for production and test, exclusions, dominant language. Evidence lists the build manifests |
| `INV-91` | More than 50% of the production lines are in languages that no deterministic code-analysis pass reads | medium (outcome negative) | Names the languages and their share; apart from the secret scan, that code is analysed only where an LLM prompt includes it, or not at all |

**How results feed later passes.** The `service_dep:<service>` tags are the "required services" list. They are used by the landing zone matching in [Pass 09 (SYNTH)](/passes/09-synth), by the inline landing zone catalogue fit, and by Pass 23 (LZR). The `assessment.language` value written by this pass tells [Pass 06 (TF)](/passes/06-tf) which logging checks to apply. All INV signals are part of the evidence that Pass 11 (COMP) and Pass 09 (SYNTH) reason over. Pass 12 (BLOCKS) receives every signal of the run, so `INV-07`, `INV-08` and `INV-09` are evidence for its database, legacy and portability blocks without any change to its prompt.

The `assessment` block records: `language`, `framework`, `app_version`, `node_version_constraint`, `node_eol_status`, `database_engine`, `orm`, `cache_engine`, `queue_engine`, `runtime_type` (`kubernetes`, `container`, `unknown`), `docker_compose`, `dockerfile`, `k8s_manifests`, `compose_service_count`, for non-Node stacks `detected_languages`, and always `language_census` (method, totals, `languages` with files, LOC and test share per language, `manifests` with path, kind, ecosystem, depth and test flag, at most 200, and `manifests_total`) and `language_coverage` (`passes`, `rows` with one cell per pass, `dominant_language`, `uncovered_loc_share`, `warning`). The publication renders both in the "Language Coverage" section. The reference catalogue scans add `vendor_sdks` (catalogue ID, name, vendor, `lock_in_level`, `sovereign_impact`, `sovereign_alternative`, evidence), `legacy_indicators` (catalogue ID, name, tier, confidence, `sovereign_alternative`, `migration_effort_weeks`, evidence), `database_compatibility` (engine, version or null, the applicable catalogue rows, severity, evidence) and `reference_catalogue_checks` (`vendor_sdk`, `legacy_indicators`, `db_compatibility`: `matched`, `no_match` or `skipped: <reason>` when a catalogue is missing or invalid).

## Third-party modules and tools

| Name | Purpose in this pass | Licence (package metadata) | Bundled or external | When missing |
|---|---|---|---|---|
| `@swao/module-iac-scan` (SWAO internal) | Terraform/OpenTofu state parsing, Pulumi state parsing, resource-to-service maps | SWAO internal package | Bundled | Not applicable |

No external command-line tool is invoked. Parsing of `package.json`, `Cargo.toml`, `go.mod`, Prisma schemas and the manifests read by the reference catalogue scans uses built-in JSON parsing and regular expressions. The three reference catalogues are YAML files in `controls/` that ship with SWAO; each is validated against a schema when loaded.

## Outputs

- `wsp/runs/<ts>/passes/01-inv.yaml`: pass header (`id: 1`, `name: inventory`, `signal_prefix: INV`, `status`), the signal list and the `assessment` block. Every signal carries `assessor: rule_engine` and a provenance block.

## Configuration and limitations

**Configuration**

- `source.path` or `source.vcs.url` in the app `.swao.yml`; `--source-path <path>` on the command line.
- `swao assess --app <id> --passes inv` runs only this pass.
- `assessment.lenses` (a pass filter, not a framework selector) can remove the pass from a run; frameworks are chosen separately with `assessment.regimes_active`.

**Limitations and known gaps**

- Framework, database and cache detection is implemented for Node.js and TypeScript (via `package.json`) and, for backing services, Rust. Python, Go, Java and C# are recognised by language only.
- The census counts non-blank lines; comment lines are included, so figures can sit slightly above tools that count code lines only. `scc` or `tokei` are not used.
- The coverage matrix states which pass reads a language, not how deep the rules go: Java counts as covered by the crypto pass through catalogue import tokens, which is far narrower than the TypeScript primitive scan.
- Database detection reads only `prisma/schema.prisma` and Mongoose/MongoDB packages; other ORMs (for example TypeORM or Sequelize) are not recognised.
- `INV-06` and Kubernetes detection look only at the source root (`k8s/`, `helm/`, `*.tf`).
- Infrastructure state is matched against fixed resource maps; unmapped resource types produce no signal.
- Service signal numbers are capped at `INV-89` (`INV-90` and `INV-91` are the census and coverage warning).
- The reference catalogue scans match declared dependencies, image names and file names only. They do not apply the catalogue `code_pattern`, `sql_pattern` or `jar_patterns` rules of the legacy indicators (source text patterns such as `NTLM` or `FIND FIRST` are too unspecific without a parser), and they ignore the file patterns `*.p`, `*.i`, `*.cls`, `*.df`, `*.process`, `*.wsdl`, `*.so` and `*.dll`, which collide with common non-legacy files. A dependency proves presence, not use: confirm low-confidence and tier 1 findings in the code.
- Some technologies appear in more than one catalogue (for example IBM MQ, TIBCO, Oracle and SQL Server clients are both vendor SDKs in `INV-09` and legacy indicators in `INV-08`, and Oracle also drives `INV-07`). The signals describe different aspects and are not deduplicated.
- Go modules are not read by the reference catalogue scans; the catalogues contain no Go rules.
