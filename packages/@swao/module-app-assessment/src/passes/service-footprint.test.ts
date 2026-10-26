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

// #3430: landing-zone service footprint from build files, compose, Kubernetes,
// configuration, Liquibase changelogs and documents (synthetic fixtures).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { PassContext, Signal } from '@swao/core';
import { runInvPass } from './pass-01-inv.js';
import { collectDependencyInventory } from './inv-reference-scans.js';
import {
  containsWord,
  deriveServiceFootprint,
  liquibaseDialects,
  matchesGlob,
  matchesK8sKind,
  matchesMaven,
  parseK8sDocuments,
  serviceFootprintSignals,
  type ServiceFootprint,
} from './service-footprint.js';
import { loadServiceFootprintCatalogue, ServiceFootprintCatalogueSchema } from '../catalogue/service-footprint-catalogue.js';

// An identity-management service in the shape of the field case: Spring Boot
// on Kubernetes with MariaDB Galera, Kafka and S3 object storage.
const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example.idm</groupId>
  <artifactId>idm-service</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.3.4</version></dependency>
    <dependency><groupId>org.mariadb.jdbc</groupId><artifactId>mariadb-java-client</artifactId><version>3.4.1</version></dependency>
    <dependency><groupId>org.springframework.kafka</groupId><artifactId>spring-kafka</artifactId><version>3.2.4</version></dependency>
    <dependency><groupId>software.amazon.awssdk</groupId><artifactId>s3</artifactId><version>2.28.0</version></dependency>
    <dependency><groupId>org.liquibase</groupId><artifactId>liquibase-core</artifactId><version>4.29.2</version></dependency>
    <dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId><version>5.1.0</version><scope>test</scope></dependency>
  </dependencies>
</project>
`;

const K8S = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: idm-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.org/idm/idm-service:1.0.0
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: idm
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: galera
spec:
  template:
    spec:
      containers:
        - name: db
          image: bitnami/mariadb-galera:11.4
  volumeClaimTemplates:
    - metadata:
        name: data
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: idm-config
data:
  SPRING_KAFKA_BOOTSTRAP_SERVERS: kafka:9092
`;

const LIQUIBASE = `<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog>
  <changeSet id="1" author="dev" dbms="mariadb, mysql">
    <createTable tableName="account"><column name="id" type="bigint"/></createTable>
  </changeSet>
</databaseChangeLog>
`;

const ARCH_DOC = `# Architecture

Encryption keys are held in the KMS of the platform. Sessions are signed with keys from the key management service.
Audit events go to Kafka.
`;

let root = '';

function write(rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function setup(): { ws: string; src: string } {
  root = mkdtempSync(join(tmpdir(), 'swao-footprint-'));
  mkdirSync(join(root, 'ws', 'wsp', 'inputs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  return { ws: join(root, 'ws'), src: join(root, 'src') };
}

function catalogue() {
  const cat = loadServiceFootprintCatalogue();
  if (!cat.ok) throw new Error(cat.reason);
  return cat.data;
}

function footprintOf(src: string, ws?: string, prior: Signal[] = []): ServiceFootprint {
  return deriveServiceFootprint({
    sourcePath: src,
    workspacePath: ws,
    inventory: collectDependencyInventory(src),
    priorSignals: prior,
    catalogue: catalogue(),
  });
}

function ctx(ws: string, src: string): PassContext {
  return { appId: 'demo-app', iter: 1, assessedAt: '2026-10-24', sourcePath: src, workspacePath: ws, passesDir: root };
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('service footprint catalogue (#3430)', () => {
  it('the bundled catalogue loads and validates', () => {
    const cat = loadServiceFootprintCatalogue();
    expect(cat.ok).toBe(true);
  });

  it('rejects a duplicate capability id and an unknown detection key', () => {
    const cap = { id: 'kubernetes', label: 'K', category: 'compute', detect: {} };
    const base = { version: '1', capabilities: [cap, cap] };
    expect(ServiceFootprintCatalogueSchema.safeParse(base).success).toBe(false);
    const badKey = { version: '1', capabilities: [{ id: 'kafka', label: 'K', category: 'messaging', detect: { regex: ['.*'] } }] };
    expect(ServiceFootprintCatalogueSchema.safeParse(badKey).success).toBe(false);
  });
});

describe('linear matchers (#3430)', () => {
  it('glob, maven, word and kind matching', () => {
    expect(matchesGlob('bitnami/kafka', '*/kafka')).toBe(true);
    expect(matchesGlob('kafka', '*/kafka')).toBe(false);
    expect(matchesGlob('mcr.microsoft.com/mssql/server', 'mcr.microsoft.com/mssql/*')).toBe(true);
    expect(matchesMaven({ group: 'org.springframework.kafka', name: 'spring-kafka' }, 'org.springframework.kafka:*')).toBe(true);
    expect(matchesMaven({ group: 'org.apache.kafka', name: 'kafka-clients' }, 'org.apache.kafka:kafka-streams')).toBe(false);
    expect(containsWord('audit events go to kafka.', 'Kafka')).toBe(true);
    expect(containsWord('kafkaesque prose', 'Kafka')).toBe(false);
    expect(containsWord('aws s3 bucket', 'S3')).toBe(true);
    expect(matchesK8sKind('Kafka', 'kafka.strimzi.io/v1beta2', 'Kafka@kafka.strimzi.io')).toBe(true);
    expect(matchesK8sKind('Kafka', 'example.org/v1', 'Kafka@kafka.strimzi.io')).toBe(false);
  });

  it('Liquibase dialects skip negated values', () => {
    expect(liquibaseDialects('<changeSet dbms="mariadb, !oracle">')).toEqual(['mariadb']);
    expect(liquibaseDialects('--changeset dev:1 dbms:postgresql')).toEqual(['postgresql']);
  });

  it('Helm templates fall back to line scans', () => {
    const { docs, templateImages } = parseK8sDocuments('apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: {{ .Values.replicas }}\n  containers:\n    - image: bitnami/redis:7\n');
    expect(docs.map((d) => d.kind)).toEqual(['Deployment']);
    expect(templateImages).toEqual(['bitnami/redis:7']);
  });
});

describe('deriveServiceFootprint (#3430)', () => {
  it('Maven + Kubernetes + Liquibase + docs fixture: kubernetes, mariadb, kafka, object_storage, key_vault with provenance', () => {
    const { ws, src } = setup();
    write('src/pom.xml', POM);
    write('src/deploy/k8s/app.yaml', K8S);
    write('src/src/main/resources/db/changelog/db.changelog-master.xml', LIQUIBASE);
    write('ws/wsp/inputs/architecture/overview.md', ARCH_DOC);
    const fp = footprintOf(src, ws);
    const byCap = new Map(fp.entries.map((e) => [e.capability, e]));
    for (const cap of ['kubernetes', 'mariadb', 'kafka', 'object_storage', 'key_vault']) {
      expect(byCap.has(cap), cap).toBe(true);
      expect(byCap.get(cap)!.sources.length, cap).toBeGreaterThan(0);
    }
    expect(byCap.get('mariadb')!.source_kinds).toEqual(expect.arrayContaining(['build_file', 'kubernetes', 'db_migration']));
    expect(byCap.get('mariadb')!.sources.some((s) => s.path === 'pom.xml' && s.detail.includes('mariadb-java-client'))).toBe(true);
    expect(byCap.get('kafka')!.source_kinds).toEqual(expect.arrayContaining(['build_file', 'config', 'docs']));
    expect(byCap.get('kafka')!.confidence).toBe('high');
    expect(byCap.get('object_storage')!.sources[0]!.detail).toContain('software.amazon.awssdk:s3');
    expect(byCap.get('kubernetes')!.sources.some((s) => s.path === 'deploy/k8s/app.yaml')).toBe(true);
    expect(byCap.get('load_balancer')!.source_kinds).toEqual(['kubernetes']);
    expect(byCap.get('block_storage')!.sources.some((s) => s.detail.includes('volumeClaimTemplates'))).toBe(true);
    // KMS only from documents: low confidence, documentation only.
    const kms = byCap.get('key_vault')!;
    expect(kms.documentation_only).toBe(true);
    expect(kms.confidence).toBe('low');
    expect(kms.sources[0]!.path).toBe('wsp/inputs/architecture/overview.md');
    // Test-scoped jedis does not make Redis a requirement.
    expect(byCap.has('redis')).toBe(false);
  });

  it('compose service images map to capabilities', () => {
    const { src } = setup();
    write('src/docker-compose.yml', 'services:\n  db:\n    image: mariadb:11.4\n  broker:\n    image: bitnami/kafka:3.7\n  cache:\n    image: redis:7-alpine\n');
    const fp = footprintOf(src);
    const caps = fp.entries.filter((e) => e.source_kinds.includes('compose')).map((e) => e.capability).sort();
    expect(caps).toEqual(['kafka', 'mariadb', 'redis']);
    expect(fp.files_scanned.compose).toBe(1);
  });

  it('target-role inputs and catalogue folders never contribute (#3429)', () => {
    const { ws, src } = setup();
    write('ws/wsp/inputs/infra/target/stackit-offer.md', 'The target platform offers Kafka and Redis.');
    write('ws/wsp/inputs/catalogs/notes.md', 'Kafka Redis MariaDB');
    const fp = footprintOf(src, ws);
    expect(fp.entries).toEqual([]);
  });

  it('an existing service_dep signal joins as inventory_signal and keeps its id', () => {
    const { src } = setup();
    write('src/package.json', JSON.stringify({ name: 'x', dependencies: { pg: '8.0.0' } }));
    const prior: Signal[] = [{ id: 'INV-02', source: 'static_analysis', category: 'application', severity: 'informational', derivation: 'db', evidence: ['package.json'], confidence: 'high', implies: ['service_dep:postgresql'] }];
    const fp = footprintOf(src, undefined, prior);
    const pg = fp.entries.find((e) => e.capability === 'postgresql')!;
    expect(pg.signal_id).toBe('INV-02');
    expect(pg.source_kinds).toEqual(['build_file', 'inventory_signal']);
    let n = 10;
    expect(serviceFootprintSignals(fp, () => `INV-${n++}`)).toEqual([]);
  });

  it('signals: one per deterministic capability, one aggregated low-confidence signal for documents', () => {
    const { ws, src } = setup();
    write('src/pom.xml', POM);
    write('ws/wsp/inputs/architecture/overview.md', ARCH_DOC);
    const fp = footprintOf(src, ws);
    let n = 10;
    const sigs = serviceFootprintSignals(fp, () => `INV-${n++}`);
    const docSig = sigs.find((s) => s.confidence === 'low')!;
    expect(docSig.implies).toEqual(['service_dep:key_vault']);
    expect(docSig.evidence).toEqual(['key_vault: wsp/inputs/architecture/overview.md']);
    expect(sigs.filter((s) => s.confidence === 'low')).toHaveLength(1);
    const kafka = sigs.find((s) => s.implies?.includes('service_dep:kafka'))!;
    expect(kafka.confidence).toBe('high');
    expect(kafka.evidence).toContain('pom.xml');
  });
});

describe('pass 01 integration (#3430)', () => {
  it('emits service_dep for the Maven footprint and records assessment.service_footprint', async () => {
    const { ws, src } = setup();
    write('src/pom.xml', POM);
    write('src/deploy/k8s/app.yaml', K8S);
    write('ws/wsp/inputs/architecture/overview.md', ARCH_DOC);
    const result = await runInvPass(ctx(ws, src));
    const deps = new Set(result.signals.flatMap((s) => s.implies ?? []).filter((t) => t.startsWith('service_dep:')));
    for (const cap of ['kubernetes', 'mariadb', 'kafka', 'object_storage', 'key_vault', 'load_balancer', 'block_storage']) {
      expect(deps.has(`service_dep:${cap}`), cap).toBe(true);
    }
    const fp = result.assessment!['service_footprint'] as ServiceFootprint;
    expect(fp.catalogue).toBe('loaded');
    expect(fp.entries.every((e) => typeof e.signal_id === 'string')).toBe(true);
    for (const s of result.signals.filter((x) => x.implies?.some((t) => t.startsWith('service_dep:')))) {
      expect(s.id).toMatch(/^INV-(1\d|[2-8]\d)$/);
    }
  });

  it('Node fixture: INV-02 / INV-03 keep their ids and no duplicate service_dep is emitted', async () => {
    const { ws, src } = setup();
    write('src/package.json', JSON.stringify({ name: 'n', version: '1.0.0', dependencies: { '@prisma/client': '5.0.0', ioredis: '5.0.0' } }));
    write('src/prisma/schema.prisma', 'datasource db {\n  provider = "postgresql"\n}\n');
    const result = await runInvPass(ctx(ws, src));
    const inv02 = result.signals.find((s) => s.id === 'INV-02')!;
    const inv03 = result.signals.find((s) => s.id === 'INV-03')!;
    expect(inv02.implies).toEqual(['service_dep:postgresql']);
    expect(inv03.implies).toEqual(['STATE-02', 'service_dep:redis']);
    const tags = result.signals.flatMap((s) => s.implies ?? []).filter((t) => t.startsWith('service_dep:'));
    expect(tags.filter((t) => t === 'service_dep:redis')).toHaveLength(1);
    expect(tags.filter((t) => t === 'service_dep:postgresql')).toHaveLength(1);
  });
});
