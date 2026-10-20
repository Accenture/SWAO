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

It identifies the primary database, Redis cache and job queue usage, the session model (stateless tokens or server-side sessions) and whether the deployment topology is a single-node setup that conflicts with operational resilience requirements such as DORA.

## What you need to provide

- The application source tree (`source.path`, `source.vcs.url` or `--source-path`).
- The pass reads only: `package.json` and `prisma/schema.prisma` at the source root, `docker-compose.yml` at the root or in `docker/`, and the `k8s/` and `helm/` directories at the root.

No credentials and no LLM are needed.

## How it works

1. **Primary database.** If `prisma/schema.prisma` exists, the `provider` value is taken as the database engine and the Prisma version is read from `package.json`. If only the Prisma client is a dependency, the pass reports that the database type cannot be confirmed.
2. **Cache and queue.** Redis is recognised through `@keyv/redis`, `ioredis` or `redis`; a job queue through `bull`, `@nestjs/bull` or `bullmq`. When a queue runs on Redis, Redis persistence (AOF plus RDB) is flagged as required.
3. **Session model.** `@nestjs/jwt`, `jsonwebtoken` or `jose` without a session library means stateless JWT authentication. `express-session` or `koa-session` means server-side sessions, which must be migrated as stateful components.
4. **Topology.** `k8s/` or `helm/` at the root means Kubernetes with horizontal scaling. A `docker-compose.yml` at the root or in `docker/` without Kubernetes manifests is treated as a single-node Compose deployment, which is a single point of failure.

## How it is measured

| Signal | Emitted when | Severity | Meaning |
|---|---|---|---|
| `STATE-01` | Prisma schema present, or Prisma client in dependencies | informational | Primary stateful store and ORM (confidence high with schema, medium without) |
| `STATE-02` | Redis or Bull/BullMQ dependency found | medium (queue on Redis), low (cache only) | Queue jobs are lost on a Redis restart unless AOF plus RDB persistence is enabled; this is a recovery point objective (RPO) risk |
| `STATE-03` | Always | informational | Session model: `jwt_stateless`, `server_session` or `unknown` |
| `STATE-04` | Always | high (single-node Compose), informational (Kubernetes or unknown) | Single point of failure assessment for resilience requirements |

Outcomes follow the severity: `informational` signals are `neutral`, `low` to `high` signals are `negative`.

**How results feed later passes.** [Pass 01 (INV)](/passes/01-inv) points to `STATE-02` and `STATE-04` through its `implies` tags. `STATE-04` at high severity is a typical input for resilience controls evaluated by Pass 11 (COMP) when frameworks such as DORA are active in `assessment.regimes_active`, and for the 7R reasoning in [Pass 09 (SYNTH)](/passes/09-synth). High-severity signals also become entries in the derived findings and risk register.

The `assessment` block records `primary_db`, `orm`, `cache_engine`, `queue_engine`, `redis_persistence_configured` (always `false`: the pass cannot see runtime configuration), `session_type`, `deployment_type` (`kubernetes`, `single_node_compose`, `unknown`), `spof_risk` and a `stateful_components` list.

## Third-party modules and tools

None. The pass uses built-in file reading, JSON parsing and regular expressions.

## Outputs

- `wsp/runs/<ts>/passes/02-state.yaml` with header (`id: 2`, `name: state_analysis`, `signal_prefix: STATE`), signals and the `assessment` block.

## Configuration and limitations

**Configuration**

- Source location keys as for [Pass 01](/passes/01-inv); `--passes state` runs the pass alone.

**Limitations and known gaps**

- Detection is limited to the Node.js ecosystem (`package.json`) and Prisma. Stateful components in other languages or ORMs are not recognised.
- `STATE-04` checks only two fixed Compose paths (`docker-compose.yml` and `docker/docker-compose.yml`). [Pass 01](/passes/01-inv) searches three directory levels and more file name patterns, so the two passes can disagree on whether Compose is present.
- Redis persistence settings are not read; `redis_persistence_configured` is always `false`.
- Object storage, file shares and other stateful infrastructure are covered by Pass 01 service detection, not by this pass.
