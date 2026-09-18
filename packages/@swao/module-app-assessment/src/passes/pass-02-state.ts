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

export async function runStatePass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const assessment: Record<string, unknown> = {};
  const statefulComponents: Array<Record<string, unknown>> = [];

  // --- STATE-01: primary stateful store from Prisma schema ---
  const prismaContent = readFileSync_safe(join(sourcePath, 'prisma', 'schema.prisma'));
  const pkg = readJson(join(sourcePath, 'package.json'));
  const deps = pkg ? allDeps(pkg) : {};

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
  }

  // --- STATE-03: session type (JWT stateless) ---
  const hasJwt = '@nestjs/jwt' in deps || 'jsonwebtoken' in deps || 'jose' in deps;
  const hasSession = 'express-session' in deps || 'koa-session' in deps;

  assessment.session_type = hasJwt && !hasSession ? 'jwt_stateless' : hasSession ? 'server_session' : 'unknown';
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
