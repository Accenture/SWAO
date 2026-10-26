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

// #3421: deterministic runtime evidence for Pass 06 TF-04 (Factor XI, logs)
// and TF-05 (Factor IX, disposability) on JVM / Spring Boot services, plus
// Kubernetes probes for any stack (Design 079 sections 4.5 and 4.6).
//
// Files come from the central source scope (#3428); test resources
// (src/test/resources/application.yml, logback-test.xml under src/test) are
// never evidence for the production runtime.

import { readFileSync } from 'fs';
import { loadAll } from 'js-yaml';
import { listSourceFiles, type SourceFile } from '@swao/core';
import type { JvmProject } from './jvm-build-files.js';

export interface Evidence {
  /** File relative to the source root (forward slashes). */
  file: string;
  /** What was found there. */
  detail: string;
}

export interface JvmRuntimeEvidence {
  /** Logging configuration files read (logback*.xml, log4j2*). */
  loggingConfigFiles: string[];
  /** Spring configuration files read (application*.yml / .properties, bootstrap*). */
  springConfigFiles: string[];
  /** JSON / structured log output configured (encoder, layout, Spring structured logging). */
  structuredLogging: Evidence[];
  /** Structured logging library on the classpath (build file). */
  structuredLoggingLibraries: Evidence[];
  /** Health endpoint evidence (Actuator starter, exposure, probe groups). */
  health: Evidence[];
  /** Graceful shutdown configured or implied by the Spring Boot version. */
  gracefulShutdown: Evidence | null;
}

const MAX_CONFIG_BYTES = 1_000_000;
const MAX_MANIFEST_BYTES = 512_000;
const MAX_CONFIG_FILES = 60;
const MAX_YAML_FILES = 400;

const LOGBACK_RE = /^logback.*\.(xml|groovy)$/i;
const LOG4J2_RE = /^log4j2.*\.(xml|ya?ml|json|properties)$/i;
const SPRING_CONFIG_RE = /^(application|bootstrap)([-.][\w.-]+)?\.(ya?ml|properties)$/i;

/** Encoder / layout class names that produce JSON log lines. */
const JSON_LOG_CONFIG_RE = /\b(LogstashEncoder|LogstashAccessEncoder|LoggingEventCompositeJsonEncoder|LogstashLayout|EcsEncoder|EcsLayout|JsonTemplateLayout|JsonLayout|ch\.qos\.logback\.classic\.encoder\.JsonEncoder|JsonEncoder)\b/;

const STRUCTURED_LOG_LIBRARIES: ReadonlyArray<{ group: string; artifact?: string; label: string }> = [
  { group: 'net.logstash.logback', artifact: 'logstash-logback-encoder', label: 'logstash-logback-encoder' },
  { group: 'co.elastic.logging', label: 'ECS logging (co.elastic.logging)' },
  { group: 'org.apache.logging.log4j', artifact: 'log4j-layout-template-json', label: 'log4j2 JsonTemplateLayout' },
  { group: 'ch.qos.logback.contrib', artifact: 'logback-json-classic', label: 'logback-json-classic' },
];

const ACTUATOR = 'org.springframework.boot:spring-boot-starter-actuator';

/** Health endpoints of other JVM frameworks (exposed by default once on the classpath). */
const OTHER_JVM_HEALTH: ReadonlyArray<{ ga: string; label: string }> = [
  { ga: 'io.quarkus:quarkus-smallrye-health', label: 'quarkus-smallrye-health' },
  { ga: 'io.micronaut:micronaut-management', label: 'micronaut-management' },
  { ga: 'io.helidon.health:helidon-health', label: 'helidon-health' },
  { ga: 'io.dropwizard.metrics:metrics-healthchecks', label: 'dropwizard metrics-healthchecks' },
];

function read(f: SourceFile, cap: number): string | null {
  if (f.sizeBytes > cap) return null;
  try { return readFileSync(f.abs, 'utf-8'); } catch { return null; }
}

/** Flatten Spring configuration into lower-cased dotted keys (relaxed: dashes dropped). */
export function flattenSpringConfig(name: string, content: string): Map<string, string> {
  const out = new Map<string, string>();
  const norm = (k: string): string => k.toLowerCase().replace(/-/g, '');
  if (/\.properties$/i.test(name)) {
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('!')) continue;
      const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(t);
      if (m) out.set(norm(m[1]!), m[2]!.trim());
    }
    return out;
  }
  const walk = (node: unknown, prefix: string): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) { out.set(prefix, node.map((v) => String(v)).join(',')); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, prefix ? `${prefix}.${norm(k)}` : norm(k));
      return;
    }
    out.set(prefix, String(node));
  };
  try {
    for (const doc of loadAll(content)) walk(doc, '');
  } catch { /* malformed YAML: no evidence from this file */ }
  return out;
}

/** Spring Boot 3.4 made graceful shutdown the default (server.shutdown). */
function bootDefaultsToGraceful(version: string | null): boolean {
  if (!version) return false;
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const major = parseInt(m[1]!, 10);
  const minor = parseInt(m[2]!, 10);
  return major > 3 || (major === 3 && minor >= 4);
}

/**
 * #3421: read the logging and Spring configuration of a JVM service and the
 * build-file dependencies (from collectJvmProject).
 */
export function collectJvmRuntimeEvidence(sourcePath: string, jvm: JvmProject): JvmRuntimeEvidence {
  const ev: JvmRuntimeEvidence = {
    loggingConfigFiles: [], springConfigFiles: [], structuredLogging: [], structuredLoggingLibraries: [],
    health: [], gracefulShutdown: null,
  };
  const files = listSourceFiles(sourcePath, { purpose: 'config', maxDepth: 10 })
    .filter((f) => !f.isTest && (LOGBACK_RE.test(f.name) || LOG4J2_RE.test(f.name) || SPRING_CONFIG_RE.test(f.name)))
    .slice(0, MAX_CONFIG_FILES);

  let shutdownSetting: { value: string; file: string } | null = null;
  for (const f of files) {
    const content = read(f, MAX_CONFIG_BYTES);
    if (content === null) continue;
    if (LOGBACK_RE.test(f.name) || LOG4J2_RE.test(f.name)) {
      ev.loggingConfigFiles.push(f.rel);
      const m = JSON_LOG_CONFIG_RE.exec(content);
      if (m) ev.structuredLogging.push({ file: f.rel, detail: m[1]! });
      continue;
    }
    ev.springConfigFiles.push(f.rel);
    const cfg = flattenSpringConfig(f.name, content);
    for (const target of ['console', 'file']) {
      const fmt = cfg.get(`logging.structured.format.${target}`);
      if (fmt) ev.structuredLogging.push({ file: f.rel, detail: `logging.structured.format.${target}=${fmt}` });
    }
    const exposure = cfg.get('management.endpoints.web.exposure.include');
    if (exposure && /(^|,)\s*(health|\*)\s*(,|$)/.test(exposure)) {
      ev.health.push({ file: f.rel, detail: `management.endpoints.web.exposure.include=${exposure}` });
    }
    for (const key of ['management.endpoint.health.probes.enabled', 'management.health.probes.enabled']) {
      if (cfg.get(key) === 'true') ev.health.push({ file: f.rel, detail: `${key}=true` });
    }
    const shutdown = cfg.get('server.shutdown');
    if (shutdown && !shutdownSetting) shutdownSetting = { value: shutdown.toLowerCase(), file: f.rel };
  }

  for (const d of jvm.dependencies) {
    if (!d.direct || d.scope === 'test') continue;
    const ga = `${d.group}:${d.artifact}`;
    if (ga === ACTUATOR && !ev.health.some((h) => h.detail === 'spring-boot-starter-actuator' && h.file === d.manifest)) {
      // The Actuator health endpoint is web-exposed by default (/actuator/health).
      ev.health.unshift({ file: d.manifest, detail: 'spring-boot-starter-actuator' });
    }
    const other = OTHER_JVM_HEALTH.find((h) => h.ga === ga);
    if (other && !ev.health.some((h) => h.detail === other.label)) ev.health.push({ file: d.manifest, detail: other.label });
    const lib = STRUCTURED_LOG_LIBRARIES.find((l) => l.group === d.group && (!l.artifact || l.artifact === d.artifact));
    if (lib && !ev.structuredLoggingLibraries.some((e) => e.detail === lib.label)) {
      ev.structuredLoggingLibraries.push({ file: d.manifest, detail: lib.label });
    }
  }

  if (shutdownSetting?.value === 'graceful') {
    ev.gracefulShutdown = { file: shutdownSetting.file, detail: 'server.shutdown=graceful' };
  } else if (!shutdownSetting && bootDefaultsToGraceful(jvm.springBootVersion)) {
    const manifest = jvm.manifests[0] ?? 'build file';
    ev.gracefulShutdown = { file: manifest, detail: `Spring Boot ${jvm.springBootVersion} (graceful shutdown is the default from 3.4)` };
  }
  return ev;
}

const PROBE_RE = /^[ \t]*(livenessProbe|readinessProbe|startupProbe)[ \t]*:/m;

/**
 * #3421: Kubernetes liveness / readiness / startup probes in YAML manifests
 * (plain manifests, Helm templates, Kustomize), for any stack.
 */
export function findKubernetesProbes(sourcePath: string): Evidence[] {
  const probes: Evidence[] = [];
  const files = listSourceFiles(sourcePath, { purpose: 'config', maxDepth: 10, extensions: ['.yaml', '.yml'] })
    .filter((f) => !f.isTest && !SPRING_CONFIG_RE.test(f.name))
    .slice(0, MAX_YAML_FILES);
  for (const f of files) {
    const content = read(f, MAX_MANIFEST_BYTES);
    if (content === null) continue;
    const m = PROBE_RE.exec(content);
    if (m) probes.push({ file: f.rel, detail: m[1]! });
  }
  return probes;
}
