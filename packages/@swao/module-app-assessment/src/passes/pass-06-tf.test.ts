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

// #3421: Pass 06 TF-04 (structured logging) and TF-05 (health endpoint) for
// Spring Boot services and Kubernetes probes. Synthetic fixtures only.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import type { PassContext, Signal } from '@swao/core';
import { runTfPass } from './pass-06-tf.js';
import { flattenSpringConfig } from './tf-runtime-evidence.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-tf-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content, 'utf-8');
  }
  return root;
}

async function run(files: Record<string, string>): Promise<{ tf04: Signal; tf05: Signal; factors: Array<{ factor: string; status: string }> }> {
  const sourcePath = tree(files);
  const r = await runTfPass({ sourcePath, workspacePath: sourcePath, appId: 'tf', iter: 1, assessedAt: '2026-10-24' } as PassContext);
  return {
    tf04: r.signals.find((s) => s.id === 'TF-04')!,
    tf05: r.signals.find((s) => s.id === 'TF-05')!,
    factors: (r.assessment as { factor_scores: Array<{ factor: string; status: string }> }).factor_scores,
  };
}

const status = (factors: Array<{ factor: string; status: string }>, prefix: string): string | undefined =>
  factors.find((f) => f.factor.startsWith(prefix))?.status;

function pom(deps: string[], bootVersion = '3.2.5'): string {
  return `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>${bootVersion}</version><relativePath/></parent>
  <groupId>de.example</groupId><artifactId>svc</artifactId><version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
${deps.join('\n')}
  </dependencies>
</project>`;
}

const ACTUATOR = '    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency>';
const LOGSTASH = '    <dependency><groupId>net.logstash.logback</groupId><artifactId>logstash-logback-encoder</artifactId><version>7.4</version></dependency>';

const LOGBACK_JSON = `<configuration>
  <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
  </appender>
  <root level="INFO"><appender-ref ref="JSON"/></root>
</configuration>`;

const LOGBACK_PLAIN = `<configuration>
  <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder><pattern>%d %-5level %logger - %msg%n</pattern></encoder>
  </appender>
  <root level="INFO"><appender-ref ref="CONSOLE"/></root>
</configuration>`;

describe('#3421 AC1: Spring Boot with Actuator and JSON logging', () => {
  it('TF-04 and TF-05 are positive (logstash encoder, actuator exposure, graceful shutdown)', async () => {
    const { tf04, tf05, factors } = await run({
      'pom.xml': pom([ACTUATOR, LOGSTASH]),
      'src/main/resources/logback-spring.xml': LOGBACK_JSON,
      'src/main/resources/application.yml': [
        'server:',
        '  shutdown: graceful',
        'management:',
        '  endpoints:',
        '    web:',
        '      exposure:',
        '        include: health,info,prometheus',
        '  endpoint:',
        '    health:',
        '      probes:',
        '        enabled: true',
      ].join('\n'),
    });
    expect(tf04.severity).toBe('positive');
    expect(tf04.derivation).toContain('LogstashEncoder in src/main/resources/logback-spring.xml');
    expect(tf04.evidence).toContain('src/main/resources/logback-spring.xml');
    expect(status(factors, 'XI')).toBe('pass');

    expect(tf05.severity).toBe('positive');
    expect(tf05.derivation).toContain('spring-boot-starter-actuator (pom.xml)');
    expect(tf05.derivation).toContain('management.endpoints.web.exposure.include=health,info,prometheus');
    expect(tf05.derivation).toContain('server.shutdown=graceful');
    expect(tf05.evidence).toEqual(expect.arrayContaining(['pom.xml', 'src/main/resources/application.yml']));
    expect(status(factors, 'IX')).toBe('pass');
  });

  it('Spring Boot 3.4+ structured logging and the 3.4 graceful-shutdown default count (Gradle catalog build)', async () => {
    const { tf04, tf05 } = await run({
      'gradle/libs.versions.toml': '[versions]\nboot = "3.4.1"\n[libraries]\nactuator = { module = "org.springframework.boot:spring-boot-starter-actuator" }\n[plugins]\nboot = { id = "org.springframework.boot", version.ref = "boot" }\n',
      'build.gradle.kts': 'plugins { alias(libs.plugins.boot) }\ndependencies {\n    implementation(libs.actuator)\n}\n',
      'src/main/resources/application.properties': 'logging.structured.format.console=ecs\n',
    });
    expect(tf04.severity).toBe('positive');
    expect(tf04.derivation).toContain('logging.structured.format.console=ecs');
    expect(tf05.severity).toBe('positive');
    expect(tf05.derivation).toContain('Spring Boot 3.4.1');
  });

  it('Actuator without graceful shutdown on Boot 3.2 is health-present / partial (low)', async () => {
    const { tf05, factors } = await run({ 'pom.xml': pom([ACTUATOR]) });
    expect(tf05.severity).toBe('low');
    expect(tf05.derivation).toContain('spring-boot-starter-actuator (pom.xml)');
    expect(tf05.derivation).toContain('not confirmed');
    expect(status(factors, 'IX')).toBe('partial');
  });
});

describe('#3421 AC2: Spring Boot without Actuator and JSON logging gives definite negatives with file evidence', () => {
  it('TF-04 partial (medium) and TF-05 fail (medium), naming the inspected files', async () => {
    const { tf04, tf05, factors } = await run({
      'pom.xml': pom([]),
      'src/main/resources/logback-spring.xml': LOGBACK_PLAIN,
      'src/main/resources/application.properties': 'server.port=8080\n',
      // Test resources are not production evidence.
      'src/test/resources/application.yml': 'management:\n  endpoints:\n    web:\n      exposure:\n        include: health\n',
      'src/test/resources/logback-test.xml': LOGBACK_JSON,
    });
    expect(tf04.derivation).not.toMatch(/not performed/);
    expect(tf04.severity).toBe('medium');
    expect(tf04.evidence).toEqual(expect.arrayContaining(['pom.xml', 'src/main/resources/logback-spring.xml']));
    expect(tf04.derivation).toContain('src/main/resources/logback-spring.xml');
    expect(status(factors, 'XI')).toBe('partial');

    expect(tf05.derivation).not.toMatch(/status unknown/);
    expect(tf05.severity).toBe('medium');
    expect(tf05.derivation).toContain('spring-boot-starter-actuator not declared in pom.xml');
    expect(tf05.evidence).toEqual(expect.arrayContaining(['pom.xml', 'src/main/resources/application.properties']));
    expect(tf05.evidence).not.toContain('src/test/resources/application.yml');
    expect(status(factors, 'IX')).toBe('fail');
  });

  it('a non-Spring JVM service: Quarkus health counts; nothing found stays unknown (no false fail)', async () => {
    const quarkus = await run({
      'pom.xml': '<project><groupId>g</groupId><artifactId>q</artifactId><version>1</version><dependencies><dependency><groupId>io.quarkus</groupId><artifactId>quarkus-smallrye-health</artifactId><version>3.15.1</version></dependency></dependencies></project>',
    });
    expect(quarkus.tf05.derivation).toContain('quarkus-smallrye-health (pom.xml)');
    expect(status(quarkus.factors, 'IX')).toBe('partial');
    const plain = await run({ 'pom.xml': '<project><groupId>g</groupId><artifactId>p</artifactId><version>1</version></project>' });
    expect(status(plain.factors, 'IX')).toBe('unknown');
    expect(plain.tf05.severity).toBe('low');
  });

  it('an encoder library without a configuration that uses it is partial (low)', async () => {
    const { tf04 } = await run({ 'pom.xml': pom([LOGSTASH]), 'src/main/resources/logback-spring.xml': LOGBACK_PLAIN });
    expect(tf04.severity).toBe('low');
    expect(tf04.derivation).toContain('logstash-logback-encoder in pom.xml');
  });
});

describe('#3421 AC3: Kubernetes probes are health evidence for any stack', () => {
  const DEPLOYMENT = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'spec:',
    '  template:',
    '    spec:',
    '      containers:',
    '        - name: api',
    '          livenessProbe:',
    '            httpGet: { path: /healthz, port: 8080 }',
  ].join('\n');

  it('Node service with a Deployment probe: TF-05 health detected (was "unknown")', async () => {
    const { tf05, factors } = await run({
      'package.json': JSON.stringify({ name: 'api', dependencies: { express: '4.21.0' } }),
      'deploy/k8s/deployment.yaml': DEPLOYMENT,
    });
    expect(tf05.derivation).toContain('livenessProbe (deploy/k8s/deployment.yaml)');
    expect(tf05.evidence).toEqual(['deploy/k8s/deployment.yaml']);
    expect(status(factors, 'IX')).toBe('partial');
  });

  it('a stack without any manifest (Helm chart only) also counts the probe', async () => {
    const { tf05 } = await run({ 'charts/api/templates/deployment.yaml': DEPLOYMENT.replace('livenessProbe', 'readinessProbe') });
    expect(tf05.derivation).toContain('readinessProbe (charts/api/templates/deployment.yaml)');
  });
});

describe('#3421 AC4: Node and Rust behaviour unchanged', () => {
  it('Node: pino detection and the handler-file health wording are as before', async () => {
    const { tf04, tf05 } = await run({
      'package.json': JSON.stringify({ name: 'api', dependencies: { pino: '9.0.0' } }),
      'src/app/health.controller.ts': 'export class HealthController {}',
    });
    expect(tf04.derivation).toBe('Structured logging library detected (pino). Factor XI satisfied.');
    expect(tf04.evidence).toEqual(['package.json']);
    expect(tf05.derivation).toBe('Health endpoint detected at src/app/health.controller.ts. Disposability (Factor IX) partially satisfied. Graceful SIGTERM shutdown hooks not confirmed from static analysis.');
    expect(tf05.severity).toBe('low');
    expect(tf05.evidence).toEqual(['src/app/health.controller.ts']);
  });

  it('Node without logger or health: unchanged partial / unknown', async () => {
    const { tf04, tf05, factors } = await run({ 'package.json': JSON.stringify({ name: 'api', dependencies: {} }) });
    expect(tf04.severity).toBe('medium');
    expect(tf05.derivation).toBe('No health endpoint detected from static analysis. Factor IX (Disposability) status unknown.');
    expect(tf05.evidence).toEqual([]);
    expect(status(factors, 'IX')).toBe('unknown');
  });

  it('Rust: tracing crate detection unchanged', async () => {
    const { tf04 } = await run({ 'Cargo.toml': '[dependencies]\ntracing = "0.1"\n' });
    expect(tf04.derivation).toBe('Rust structured logging crate detected (tracing). Factor XI satisfied.');
  });

  it('a Node service with a pom.xml in a subfolder stays on the Node branch', async () => {
    const { tf04 } = await run({
      'package.json': JSON.stringify({ name: 'web', dependencies: { winston: '3.0.0' } }),
      'backend/pom.xml': pom([]),
    });
    expect(tf04.derivation).toContain('winston');
  });
});

describe('#3421 flattenSpringConfig', () => {
  it('flattens YAML (multi-document, relaxed keys) and properties', () => {
    const y = flattenSpringConfig('application.yml', 'management:\n  endpoints:\n    web:\n      exposure:\n        include: [health, info]\n---\nserver:\n  shut-down: graceful\n');
    expect(y.get('management.endpoints.web.exposure.include')).toBe('health,info');
    expect(y.get('server.shutdown')).toBe('graceful');
    const p = flattenSpringConfig('application.properties', '# c\nmanagement.endpoint.health.probes.enabled=true\n');
    expect(p.get('management.endpoint.health.probes.enabled')).toBe('true');
  });
});
