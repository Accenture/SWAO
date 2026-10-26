// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { listSourceFiles } from '@swao/core';
import { scanJvmState, inProduction, EMBEDDED_DATABASE_ENGINES, type JvmStateFinding, type JvmStateKind, type JvmStateScan } from './jvm-state.js';
import { collectJvmProject } from './jvm-build-files.js';

function readFileSync_safe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  };
}

// ---------------------------------------------------------------------------
// #3422: JVM / Spring session and in-process state
// ---------------------------------------------------------------------------

const MAX_STATE_EVIDENCE = 10;

/** `file:line` evidence of the given findings, production first, at most MAX_STATE_EVIDENCE. */
function jvmEvidence(scan: JvmStateScan, kinds: readonly JvmStateKind[]): string[] {
  const rank: Record<string, number> = { prod: 0, unknown: 1, test: 2 };
  const locs = kinds
    .flatMap((k) => scan.findings.get(k)?.locations ?? [])
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (rank[a.l.path_class] ?? 1) - (rank[b.l.path_class] ?? 1) || a.i - b.i)
    .map((x) => `${x.l.file}:${x.l.line}`);
  return [...new Set(locs)].slice(0, MAX_STATE_EVIDENCE);
}

function countText(n: number): string {
  return `${n} ${n === 1 ? 'location' : 'locations'}`;
}

function testOnlyCount(f: JvmStateFinding | undefined): number {
  return f !== undefined && !inProduction(f) ? f.byClass.test : 0;
}

type JvmSessionType = 'server_session_external' | 'server_session' | 'jwt_stateless' | 'none_detected';

/** #3422: the JVM session model from production hits (test-only hits never decide it). */
function jvmSessionType(scan: JvmStateScan): JvmSessionType {
  const f = (k: JvmStateKind): JvmStateFinding | undefined => scan.findings.get(k);
  if (inProduction(f('spring_session'))) return 'server_session_external';
  if (inProduction(f('http_session')) || inProduction(f('servlet_session_config'))) return 'server_session';
  if (inProduction(f('stateless_auth'))) return 'jwt_stateless';
  return 'none_detected';
}

function jvmSessionSignal(scan: JvmStateScan, type: JvmSessionType): Signal {
  const f = (k: JvmStateKind): JvmStateFinding | undefined => scan.findings.get(k);
  const stack = scan.springBoot ? 'Spring Boot' : 'JVM';
  const stores = f('spring_session')?.stores ?? [];
  const testOnly = testOnlyCount(f('http_session')) + testOnlyCount(f('spring_session'))
    + testOnlyCount(f('servlet_session_config')) + testOnlyCount(f('stateless_auth'));
  const testNote = testOnly > 0 ? ` Session patterns seen in test code only (${countText(testOnly)}) were not counted.` : '';
  let derivation: string;
  let evidence: string[];
  switch (type) {
    case 'server_session_external':
      derivation = `${stack} service with server-side sessions in an external store via Spring Session${stores.length > 0 ? ` (store: ${stores.join(', ')})` : ''}. Instances are interchangeable; the session store is a stateful component that must be migrated, and persisted if session loss matters.`;
      evidence = jvmEvidence(scan, ['spring_session', 'http_session']);
      break;
    case 'server_session': {
      const http = f('http_session');
      const cfg = f('servlet_session_config');
      const what = [
        inProduction(http) ? `HttpSession use or session-scoped beans (${countText(http!.byClass.prod + http!.byClass.unknown)})` : '',
        inProduction(cfg) ? `server.servlet.session settings (${countText(cfg!.byClass.prod + cfg!.byClass.unknown)})` : '',
      ].filter(Boolean).join(' and ');
      const alsoStateless = inProduction(f('stateless_auth')) ? ' Stateless token authentication is configured as well; the session use still holds state.' : '';
      derivation = `${stack} service with server-side HTTP sessions in the servlet container memory: ${what}. Horizontal scaling needs sticky sessions or session replication, and a restart or node loss drops active sessions. Externalise the sessions (Spring Session with Redis or JDBC) before scaling out.${alsoStateless}`;
      evidence = jvmEvidence(scan, ['http_session', 'servlet_session_config']);
      break;
    }
    case 'jwt_stateless':
      derivation = `${stack} service with stateless authentication (SessionCreationPolicy.STATELESS or a JWT resource server). No server-side session use found. Token validation is stateless.`;
      evidence = jvmEvidence(scan, ['stateless_auth']);
      break;
    case 'none_detected':
      derivation = `${stack} service: no HttpSession use, @SessionAttributes, session-scoped beans, Spring Session or server.servlet.session settings found in ${scan.jvmCodeFiles} JVM source ${scan.jvmCodeFiles === 1 ? 'file' : 'files'} and ${scan.configFiles} Spring configuration ${scan.configFiles === 1 ? 'file' : 'files'}. No server-side session state detected by pattern scan; confirm against the runtime configuration.`;
      evidence = scan.stackEvidence ? [scan.stackEvidence] : [];
      break;
    default: {
      const never: never = type;
      throw new Error(`unknown session type ${String(never)}`);
    }
  }
  return {
    id: 'STATE-03',
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation: `${derivation}${testNote}`,
    evidence,
    confidence: type === 'none_detected' ? 'medium' : 'high',
  };
}

interface JvmDatabase {
  /** Single engine in the Prisma provider vocabulary, or 'unknown' (none named, or several server engines). */
  primary: string;
  /** Every engine named by production hits, sorted. */
  engines: string[];
  orm: 'jpa' | 'jdbc';
  signal: Signal;
}

/**
 * #3485: STATE-01 for a JVM service from JDBC / JPA production hits, or null
 * when there are none (test-only hits never produce the signal).
 */
function jvmDatabase(scan: JvmStateScan): JvmDatabase | null {
  const jdbc = scan.findings.get('jdbc');
  const jpa = scan.findings.get('jpa');
  if (!inProduction(jdbc) && !inProduction(jpa)) return null;
  const stack = scan.springBoot ? 'Spring Boot' : 'JVM';
  const engines = [...new Set([...(jdbc?.stores ?? []), ...(jpa?.stores ?? [])])].sort();
  const server = engines.filter((e) => !EMBEDDED_DATABASE_ENGINES.has(e));
  const primary = server.length === 1 ? server[0]! : server.length === 0 && engines.length === 1 ? engines[0]! : 'unknown';
  const orm: 'jpa' | 'jdbc' = inProduction(jpa) ? 'jpa' : 'jdbc';
  const prodCount = (f: JvmStateFinding | undefined): number => (f ? f.byClass.prod + f.byClass.unknown : 0);
  const what = [
    inProduction(jpa) ? `JPA entities, repositories or settings (${countText(prodCount(jpa))})` : '',
    inProduction(jdbc) ? `JDBC datasource settings, drivers or JdbcTemplate use (${countText(prodCount(jdbc))})` : '',
  ].filter(Boolean).join(' and ');
  let engineText: string;
  if (primary !== 'unknown') {
    engineText = `engine ${primary}${server.length === 1 && engines.length > 1 ? ` (embedded ${engines.filter((e) => e !== primary).join(', ')} also referenced)` : ''}`;
  } else if (server.length > 1) {
    engineText = `engines ${server.join(', ')}; the primary engine cannot be decided from source`;
  } else if (engines.length > 1) {
    engineText = `embedded engines ${engines.join(', ')}; the primary engine cannot be decided from source`;
  } else {
    engineText = 'engine not named in source (no JDBC URL, driver class, dialect or driver dependency found)';
  }
  const embeddedOnly = engines.length > 0 && server.length === 0;
  const embeddedNote = !embeddedOnly
    ? ''
    : engines.length === 1
      ? ' The only engine found is embedded: its state lives in the JVM process or on local disk and is lost with the instance unless a file is persisted.'
      : ' All engines found are embedded: their state lives in the JVM process or on local disk and is lost with the instance unless a file is persisted.';
  return {
    primary,
    engines,
    orm,
    signal: {
      id: 'STATE-01',
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: 'informational',
      derivation: `Primary stateful store: relational database used by the ${stack} service through ${what}; ${engineText}. The database needs a data migration and a cut-over plan.${embeddedNote}`,
      evidence: jvmEvidence(scan, ['jdbc', 'jpa']),
      confidence: primary !== 'unknown' ? 'high' : 'medium',
    },
  };
}

function findingYaml(f: JvmStateFinding): Record<string, unknown> {
  return {
    total: f.total,
    production: f.byClass.prod,
    test: f.byClass.test,
    unclassified: f.byClass.unknown,
    ...(f.stores ? { stores: f.stores } : {}),
    locations: f.locations,
  };
}

export async function runStatePass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const assessment: Record<string, unknown> = {};
  const statefulComponents: Array<Record<string, unknown>> = [];

  // --- STATE-01: primary stateful store from Prisma schema ---
  const prismaContent = readFileSync_safe(join(sourcePath, 'prisma', 'schema.prisma'));
  const pkg = readJson(join(sourcePath, 'package.json'));
  const deps = pkg ? allDeps(pkg) : {};
  // #3422: JVM / Spring patterns through the central source scope (#3428).
  // Without JVM evidence (no build file, no JVM source) every signal below is
  // exactly the pre-#3422 output.
  // #3485: build dependencies are scope-resolved (collectJvmProject), so a
  // test-scoped driver never names the database engine.
  const jvm = existsSync(sourcePath)
    ? scanJvmState(listSourceFiles(sourcePath, { purpose: 'code' }), { dependencies: collectJvmProject(sourcePath).dependencies })
    : null;
  const jvmScan = jvm !== null && jvm.jvm ? jvm : null;

  if (prismaContent) {
    const providerMatch = prismaContent.match(/provider\s*=\s*"([^"]+)"/);
    const dbEngine = providerMatch ? providerMatch[1] : 'unknown';
    const hasPrisma = '@prisma/client' in deps || 'prisma' in deps;
    const prismaVersion = deps['prisma'] ?? deps['@prisma/client'] ?? 'unknown';

    statefulComponents.push({
      name: 'database',
      engine: dbEngine,
      orm: hasPrisma ? `prisma@${prismaVersion}` : 'unknown',
    });

    assessment.primary_db = dbEngine;
    assessment.orm = hasPrisma ? 'prisma' : 'unknown';

    signals.push({
      id: 'STATE-01',
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: 'informational',
      derivation: `Primary stateful store: ${dbEngine} (ORM: ${hasPrisma ? 'Prisma' : 'none'}). Prisma version: ${prismaVersion}.`,
      evidence: ['prisma/schema.prisma'],
      confidence: 'high',
    });
  } else if ('@prisma/client' in deps || 'prisma' in deps) {
    signals.push({
      id: 'STATE-01',
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: 'informational',
      derivation: `Prisma client found in dependencies but schema.prisma not present. Database type cannot be confirmed from source.`,
      evidence: ['package.json'],
      confidence: 'medium',
    });
  } else if (jvmScan) {
    // #3485: JDBC / JPA in a JVM service.
    const db = jvmDatabase(jvmScan);
    if (db) {
      statefulComponents.push({ name: 'database', engine: db.primary, orm: db.orm });
      assessment.primary_db = db.primary;
      assessment.orm = db.orm;
      assessment.database_engines = db.engines;
      signals.push(db.signal);
    }
  }

  // --- STATE-02: Redis / queue ---
  const hasRedis = '@keyv/redis' in deps || 'ioredis' in deps || 'redis' in deps;
  const hasBull = 'bull' in deps || '@nestjs/bull' in deps || 'bullmq' in deps;

  if (hasRedis || hasBull) {
    statefulComponents.push({
      name: 'cache',
      engine: 'redis',
      persistence: hasBull ? 'aof_rdb_recommended' : 'none_required',
    });
    assessment.cache_engine = 'redis';
    assessment.queue_engine = hasBull ? 'bull' : null;
    assessment.redis_persistence_configured = false;

    signals.push({
      id: 'STATE-02',
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: hasBull ? 'medium' : 'low',
      derivation: hasBull
        ? `Redis used for both cache (@keyv/redis or ioredis) and Bull job queue. Queue loss on Redis restart without AOF+RDB persistence. RPO risk if persistence not enabled.`
        : `Redis used for caching. Persistence not required unless sessions stored.`,
      evidence: ['package.json'],
      confidence: 'high',
    });
  } else if (jvmScan && inProduction(jvmScan.findings.get('redis'))) {
    // #3422: Spring Data Redis in a JVM service.
    const sessionsInRedis = (jvmScan.findings.get('spring_session')?.stores ?? []).includes('redis')
      && inProduction(jvmScan.findings.get('spring_session'));
    statefulComponents.push({ name: 'cache', engine: 'redis', persistence: sessionsInRedis ? 'aof_rdb_recommended' : 'none_required' });
    assessment.cache_engine = 'redis';
    assessment.queue_engine = null;
    assessment.redis_persistence_configured = false;
    signals.push({
      id: 'STATE-02',
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: sessionsInRedis ? 'medium' : 'low',
      derivation: sessionsInRedis
        ? `Redis used by the JVM service (Spring Data Redis) and as the Spring Session store. Active sessions are lost on a Redis restart without AOF+RDB persistence.`
        : `Redis used by the JVM service (Spring Data Redis connection or configuration). Persistence not required unless sessions or queues are stored.`,
      evidence: jvmEvidence(jvmScan, ['redis']),
      confidence: 'high',
    });
  }

  // --- STATE-03: session type (JWT stateless) ---
  const hasJwt = '@nestjs/jwt' in deps || 'jsonwebtoken' in deps || 'jose' in deps;
  const hasSession = 'express-session' in deps || 'koa-session' in deps;

  const nodeSessionType = hasJwt && !hasSession ? 'jwt_stateless' : hasSession ? 'server_session' : 'unknown';
  const jvmType = jvmScan ? jvmSessionType(jvmScan) : null;
  // #3422: the JVM session model decides unless it found nothing and the
  // package.json check did (a Node front end next to a JVM back end).
  if (jvmScan && jvmType && !(jvmType === 'none_detected' && nodeSessionType !== 'unknown')) {
    assessment.session_type = jvmType;
    signals.push(jvmSessionSignal(jvmScan, jvmType));
    if (jvmType === 'server_session_external') {
      const stores = jvmScan.findings.get('spring_session')?.stores ?? [];
      statefulComponents.push({ name: 'session_store', engine: stores.length > 0 ? stores.join(', ') : 'unknown', via: 'spring_session' });
    }
  } else {
    assessment.session_type = nodeSessionType;
    signals.push({
      id: 'STATE-03',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: hasJwt && !hasSession
        ? `JWT-based stateless auth (@nestjs/jwt / jsonwebtoken). No server-side session store required. Token validation is stateless.`
        : hasSession
          ? `Server-side session detected. Session store must be migrated as a stateful component.`
          : `Session type could not be determined from package.json alone.`,
      evidence: ['package.json'],
      confidence: hasJwt || hasSession ? 'high' : 'low',
    });
  }

  // --- STATE-04: SPOF risk from single-node compose ---
  const hasCompose =
    existsSync(join(sourcePath, 'docker', 'docker-compose.yml')) ||
    existsSync(join(sourcePath, 'docker-compose.yml'));
  const hasK8s = existsSync(join(sourcePath, 'k8s')) || existsSync(join(sourcePath, 'helm'));

  assessment.deployment_type = hasK8s ? 'kubernetes' : hasCompose ? 'single_node_compose' : 'unknown';
  assessment.spof_risk = hasCompose && !hasK8s;

  signals.push({
    id: 'STATE-04',
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: hasCompose && !hasK8s ? 'high' : 'informational',
    derivation: hasK8s
      ? `Kubernetes manifests present. Horizontal scaling supported. No single-node SPOF.`
      : hasCompose
        ? `Single-node Docker Compose deployment. No horizontal scaling configuration. Represents a single-point-of-failure for DORA resilience requirements.`
        : `Deployment topology unknown. Cannot assess SPOF risk.`,
    evidence: hasK8s
      ? ['k8s/']
      : hasCompose
        ? [existsSync(join(sourcePath, 'docker', 'docker-compose.yml')) ? 'docker/docker-compose.yml' : 'docker-compose.yml']
        : [],
    confidence: hasCompose || hasK8s ? 'high' : 'low',
  });

  // --- #3422: STATE-05 in-process state, STATE-06 session affinity (JVM services) ---
  if (jvmScan) {
    const cache = jvmScan.findings.get('in_memory_cache');
    const statics = jvmScan.findings.get('static_mutable_state');
    const kotlinObjects = jvmScan.findings.get('kotlin_object_state');
    if (cache || statics || kotlinObjects) {
      const prod = inProduction(cache) || inProduction(statics) || inProduction(kotlinObjects);
      const parts = [
        cache ? `in-memory caches (ConcurrentMapCacheManager, Caffeine, Guava, Ehcache or spring.cache.type simple) at ${countText(cache.total)}` : '',
        statics ? `static mutable collections at ${countText(statics.total)}` : '',
        kotlinObjects ? `mutable properties of Kotlin objects or top-level declarations at ${countText(kotlinObjects.total)}` : '',
      ].filter(Boolean).join('; ');
      signals.push({
        id: 'STATE-05',
        source: 'static_analysis',
        category: 'application',
        severity: prod ? 'low' : 'informational',
        derivation: `In-process state in the JVM service: ${parts}. Every replica holds its own copy: caches diverge between instances and static state is lost on restart, so horizontal scaling needs a shared cache (for example Redis) or confirmation that the state is a read-only lookup.${prod ? '' : ' Seen in test code only.'}`,
        evidence: jvmEvidence(jvmScan, ['in_memory_cache', 'static_mutable_state', 'kotlin_object_state']),
        confidence: prod ? 'medium' : 'low',
      });
    }
    const sticky = jvmScan.findings.get('sticky_session');
    if (sticky) {
      const prod = inProduction(sticky);
      signals.push({
        id: 'STATE-06',
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: prod ? 'medium' : 'informational',
        derivation: `Session affinity (sticky sessions) configured at ${countText(sticky.total)} (ingress affinity, Service sessionAffinity, load-balancer stickiness or jvmRoute). Instances are not interchangeable: a node loss drops the sessions pinned to it and load spreads unevenly. Usually a sign of in-memory session state.${prod ? '' : ' Seen in test code only.'}`,
        evidence: jvmEvidence(jvmScan, ['sticky_session']),
        confidence: prod ? 'high' : 'low',
      });
    }
    assessment.jvm_state = {
      spring_boot: jvmScan.springBoot,
      stack_evidence: jvmScan.stackEvidence,
      jvm_source_files: jvmScan.jvmCodeFiles,
      spring_config_files: jvmScan.configFiles,
      // #3485: present only when Android (mobile) app files were skipped.
      ...(jvmScan.androidFilesExcluded > 0 ? { android_files_excluded: jvmScan.androidFilesExcluded } : {}),
      findings: Object.fromEntries([...jvmScan.findings.entries()].map(([k, f]) => [k, findingYaml(f)])),
    };
  }

  assessment.stateful_components = statefulComponents;

  return {
    pass: {
      id: 2,
      name: 'state_analysis',
      signal_prefix: 'STATE',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment,
  };
}
