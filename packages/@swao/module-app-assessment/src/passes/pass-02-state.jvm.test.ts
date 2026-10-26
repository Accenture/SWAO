// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass 02 state: JVM / Spring session and in-process state (#3422)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3422: synthetic Spring Boot fixtures only. Before #3422 Pass 02 read
// package.json alone, so every JVM fixture below produced "Session type could
// not be determined from package.json alone".

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { beginSourceScopeRun, endSourceScopeRun, isTestPath, type PassContext, type PassResult, type Signal } from '@swao/core';
import { runStatePass } from './pass-02-state.js';
import { configKeysPerLine } from './jvm-source-patterns.js';

let tmp: string;
let src: string;

function put(rel: string, content: string): void {
  const p = join(src, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { workspacePath: tmp, sourcePath: src, appId: 'jvm-app', iter: 1, assessedAt: '2026-10-24', ...overrides } as PassContext;
}

function sig(r: PassResult, id: string): Signal | undefined {
  return r.signals.find((s) => s.id === id);
}

const POM = [
  '<project>',
  '  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent>',
  '  <artifactId>account-service</artifactId>',
  '</project>',
].join('\n');

function springBootApp(): void {
  put('pom.xml', POM);
  put('src/main/java/de/acme/account/AccountApplication.java', [
    'package de.acme.account;',
    'import org.springframework.boot.autoconfigure.SpringBootApplication;',
    '@SpringBootApplication',
    'public class AccountApplication { public static void main(String[] a) {} }',
  ].join('\n'));
  put('src/main/resources/application.yml', ['server:', '  port: 8080', 'spring:', '  application:', '    name: account-service'].join('\n'));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3422-state-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('#3422 Pass 02: Spring Boot baseline', () => {
  it('a Spring Boot fixture without session use yields a baseline STATE-03, not the package.json fallback', async () => {
    springBootApp();
    const r = await runStatePass(ctx());
    const s03 = sig(r, 'STATE-03')!;
    expect(s03.derivation).not.toContain('package.json alone');
    expect(s03.derivation).toContain('Spring Boot service: no HttpSession use');
    expect(s03.derivation).toContain('1 JVM source file and 1 Spring configuration file');
    expect(s03.evidence).toEqual(['pom.xml']);
    expect(s03.confidence).toBe('medium');
    expect(r.assessment['session_type']).toBe('none_detected');
    expect(r.assessment['jvm_state']).toMatchObject({ spring_boot: true, stack_evidence: 'pom.xml', jvm_source_files: 1, spring_config_files: 1 });
  });

  it('a Node fixture without JVM files keeps the pre-#3422 output (no jvm_state, same STATE-03 text)', async () => {
    put('package.json', JSON.stringify({ name: 'web', dependencies: {} }));
    put('src/app.ts', 'export const a = 1;\n');
    const r = await runStatePass(ctx());
    expect(sig(r, 'STATE-03')!.derivation).toBe('Session type could not be determined from package.json alone.');
    expect(r.assessment['jvm_state']).toBeUndefined();
    expect(r.signals.map((s) => s.id)).toEqual(['STATE-03', 'STATE-04']);
  });
});

describe('#3422 Pass 02: session model', () => {
  it('HttpSession use and server.servlet.session settings: server_session with file:line evidence', async () => {
    springBootApp();
    put('src/main/java/de/acme/account/web/CartController.java', [
      'package de.acme.account.web;',
      'import jakarta.servlet.http.HttpSession;',
      '@Controller',
      '@SessionAttributes("cart")',
      'public class CartController {',
      '  String show(HttpSession session) { return "cart"; }',
      '}',
    ].join('\n'));
    put('src/main/resources/application-prod.yml', ['server:', '  servlet:', '    session:', '      timeout: 30m'].join('\n'));
    const r = await runStatePass(ctx());
    const s03 = sig(r, 'STATE-03')!;
    expect(r.assessment['session_type']).toBe('server_session');
    expect(s03.derivation).toContain('server-side HTTP sessions in the servlet container memory');
    expect(s03.derivation).toContain('Externalise the sessions');
    expect(s03.evidence).toEqual(expect.arrayContaining([
      'src/main/java/de/acme/account/web/CartController.java:2',
      'src/main/java/de/acme/account/web/CartController.java:4',
      'src/main/resources/application-prod.yml:4',
    ]));
    expect(s03.confidence).toBe('high');
  });

  it('Spring Session with Redis: server_session_external, session store component, STATE-02 medium', async () => {
    springBootApp();
    put('src/main/java/de/acme/account/SessionConfig.java', [
      'import org.springframework.session.data.redis.config.annotation.web.http.EnableRedisHttpSession;',
      '@Configuration',
      '@EnableRedisHttpSession',
      'public class SessionConfig {}',
    ].join('\n'));
    put('src/main/resources/application.properties', 'spring.data.redis.host=redis.internal\nspring.session.timeout=20m\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('server_session_external');
    expect(sig(r, 'STATE-03')!.derivation).toContain('Spring Session (store: redis)');
    const s02 = sig(r, 'STATE-02')!;
    expect(s02.severity).toBe('medium');
    expect(s02.evidence).toEqual(['src/main/resources/application.properties:1']);
    expect(r.assessment['stateful_components']).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'session_store', engine: 'redis' }),
      expect.objectContaining({ name: 'cache', engine: 'redis' }),
    ]));
  });

  it('a credential in a Redis URL never reaches the pass output (locations record the key)', async () => {
    springBootApp();
    put('src/main/resources/application-prod.properties', 'spring.data.redis.url=redis://svc-user:s3cret@cache.internal:6379\n');
    const r = await runStatePass(ctx());
    expect(sig(r, 'STATE-02')!.evidence).toEqual(['src/main/resources/application-prod.properties:1']);
    const out = JSON.stringify(r);
    expect(out).not.toContain('s3cret');
    expect(out).toContain('"match":"spring.data.redis.url"');
  });

  it('SessionCreationPolicy.STATELESS without session use: jwt_stateless', async () => {
    springBootApp();
    put('src/main/java/de/acme/account/SecurityConfig.java', [
      'class SecurityConfig {',
      '  SecurityFilterChain chain(HttpSecurity http) throws Exception {',
      '    return http.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).build();',
      '  }',
      '}',
    ].join('\n'));
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('jwt_stateless');
    expect(sig(r, 'STATE-03')!.evidence).toEqual(['src/main/java/de/acme/account/SecurityConfig.java:3']);
  });
});

describe('#3422 Pass 02: in-process state and session affinity', () => {
  it('in-memory cache and static mutable collections yield STATE-05; an immutable Map.of does not', async () => {
    springBootApp();
    put('src/main/java/de/acme/account/CacheConfig.java', [
      'class CacheConfig {',
      '  CacheManager cacheManager() { return new ConcurrentMapCacheManager("accounts"); }',
      '  private static final Map<String, Account> CACHE = new ConcurrentHashMap<>();',
      '  private static final Map<String, String> CODES = Map.of("A", "B");',
      '}',
    ].join('\n'));
    const r = await runStatePass(ctx());
    const s05 = sig(r, 'STATE-05')!;
    expect(s05.severity).toBe('low');
    expect(s05.evidence).toEqual(['src/main/java/de/acme/account/CacheConfig.java:2', 'src/main/java/de/acme/account/CacheConfig.java:3']);
    expect(s05.derivation).toContain('static mutable collections at 1 location');
  });

  it('ingress cookie affinity yields STATE-06 medium', async () => {
    springBootApp();
    put('deploy/k8s/ingress.yaml', [
      'apiVersion: networking.k8s.io/v1',
      'kind: Ingress',
      'metadata:',
      '  annotations:',
      '    nginx.ingress.kubernetes.io/affinity: "cookie"',
    ].join('\n'));
    const r = await runStatePass(ctx());
    const s06 = sig(r, 'STATE-06')!;
    expect(s06.severity).toBe('medium');
    expect(s06.evidence).toEqual(['deploy/k8s/ingress.yaml:5']);
  });
});

describe('#3422 Pass 02: source scope and test-code setting (#3428, #3403)', () => {
  function testOnlySession(): void {
    springBootApp();
    put('src/test/java/de/acme/account/CartControllerTest.java', [
      'class CartControllerTest {',
      '  void t() { MockHttpSession session = new MockHttpSession(); HttpSession s = session; }',
      '}',
    ].join('\n'));
  }

  it('session use in test code only never decides the model and is named as test-only', async () => {
    testOnlySession();
    beginSourceScopeRun();
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('none_detected');
    expect(sig(r, 'STATE-03')!.derivation).toContain('Session patterns seen in test code only (1 location) were not counted.');
  });

  it('exclude: test files are not listed, so no test path is cited and no test-only note appears', async () => {
    testOnlySession();
    beginSourceScopeRun({ testCode: 'exclude' });
    const r = await runStatePass(ctx({ testCode: 'exclude' }));
    expect(sig(r, 'STATE-03')!.derivation).not.toContain('test code');
    const cited = r.signals.flatMap((s) => s.evidence);
    expect(cited.filter((p) => isTestPath(p.replace(/:\d+$/, '')))).toEqual([]);
  });

  it('build output folders (target/) are outside the central source scope', async () => {
    springBootApp();
    put('target/classes/application.yml', 'server:\n  servlet:\n    session:\n      timeout: 5m\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('none_detected');
  });
});

describe('#3422 configKeysPerLine', () => {
  it('YAML: dotted paths from indentation, list items inherit the parent key', () => {
    const lines = ['spring:', '  kafka:', '    bootstrap-servers:', '      - broker1:9092', '  datasource:', '    url: x', '# c', 'server:', '  port: 1'];
    expect(configKeysPerLine({ name: 'application.yml', ext: '.yml' }, lines)).toEqual([
      'spring', 'spring.kafka', 'spring.kafka.bootstrap-servers', 'spring.kafka.bootstrap-servers', 'spring.datasource', 'spring.datasource.url', null, 'server', 'server.port',
    ]);
  });

  it('properties: the key of each line; comments are null', () => {
    expect(configKeysPerLine({ name: 'application.properties', ext: '.properties' }, ['a.b=1', '# x', 'c.d: 2'])).toEqual(['a.b', null, 'c.d']);
  });
});
