// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass 07 egress: JVM source and Spring configuration (#3422)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3422: synthetic Java / Spring fixtures only. Hosts are invented and
// public-looking on purpose: documentation names (example.com, .test) and
// loopback are not reportable, so a fixture using them would pass for the
// wrong reason. Before #3422 Pass 07 read .ts/.js files only and every fixture
// below produced "No known egress domains or packages detected".

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { beginSourceScopeRun, endSourceScopeRun, type PassContext, type PassResult, type Signal } from '@swao/core';
import { runEgrPass } from './pass-07-egr.js';
import { hostMatchesCatalogueDomain } from './egress-endpoints.js';

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

type HostYaml = { host: string; classification: string; channels: string[]; via: string[]; total: number; production: number; test: number; locations: Array<{ file: string; line: number; path_class: string; via?: string }> };

function hosts(r: PassResult): HostYaml[] {
  const block = r.assessment['hardcoded_endpoints'] as { hosts: HostYaml[] } | undefined;
  return block?.hosts ?? [];
}

function host(r: PassResult, name: string): HostYaml | undefined {
  return hosts(r).find((h) => h.host === name);
}

function endpointSignals(r: PassResult): Signal[] {
  return r.signals.filter((s) => s.derivation.startsWith('Hard-coded endpoints in JVM source'));
}

const APPLICATION_YML = [
  'spring:',
  '  datasource:',
  '    url: jdbc:postgresql://db01.partner-cloud.de:5432/accounts',
  '    password: ${DB_PASSWORD}',
  '  kafka:',
  '    bootstrap-servers: kafka1.internal:9092,kafka2.internal:9092',
  'partner:',
  '  payments:',
  '    base-url: https://api.partner-payments.eu/v2',
  '  templated: https://${PARTNER_HOST}/v1',
  '  local: http://localhost:8081/health',
].join('\n');

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3422-egr-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('#3422 Pass 07: hosts in application.yml', () => {
  it('finds the JDBC, Kafka and HTTP hosts with file:line; placeholders and loopback are not reported', async () => {
    put('src/main/resources/application.yml', APPLICATION_YML);
    const r = await runEgrPass(ctx());
    expect(r.signals.some((s) => s.derivation.startsWith('No known egress domains'))).toBe(false);
    expect(hosts(r).map((h) => h.host)).toEqual(['api.partner-payments.eu', 'db01.partner-cloud.de', 'kafka1.internal', 'kafka2.internal']);
    expect(host(r, 'db01.partner-cloud.de')).toMatchObject({
      classification: 'public', channels: ['database'], via: ['spring.datasource.url'],
      locations: [{ file: 'src/main/resources/application.yml', line: 3, path_class: 'prod', via: 'spring.datasource.url' }],
    });
    expect(host(r, 'kafka1.internal')).toMatchObject({ classification: 'private', channels: ['messaging'], via: ['spring.kafka.bootstrap-servers'] });
    expect(host(r, 'api.partner-payments.eu')).toMatchObject({ channels: ['http'], via: ['partner.payments.base-url'] });

    const [pub, priv] = endpointSignals(r);
    expect(pub).toMatchObject({ severity: 'medium', confidence: 'medium' });
    expect(pub!.derivation).toContain('2 external host(s) outside the egress and sovereign service catalogues');
    expect(pub!.evidence).toEqual(['src/main/resources/application.yml:9', 'src/main/resources/application.yml:3']);
    expect(priv).toMatchObject({ severity: 'low' });
    expect(priv!.evidence).toEqual(['src/main/resources/application.yml:6']);
  });

  it('a Kafka bootstrap list in YAML list form and in .properties is found', async () => {
    put('src/main/resources/application-prod.yml', ['spring:', '  kafka:', '    bootstrap-servers:', '      - broker-a.msg.partner-cloud.de:9093', '      - broker-b.msg.partner-cloud.de:9093'].join('\n'));
    put('src/main/resources/kafka.properties', 'bootstrap.servers=SASL_SSL://broker-c.msg.partner-cloud.de:9093\n');
    const r = await runEgrPass(ctx());
    expect(hosts(r).map((h) => `${h.host}@${h.locations[0]!.line}`)).toEqual([
      'broker-a.msg.partner-cloud.de@4', 'broker-b.msg.partner-cloud.de@5', 'broker-c.msg.partner-cloud.de@1',
    ]);
  });

  it('a credential in a URL never reaches the pass output', async () => {
    put('src/main/resources/application.properties', 'spring.data.redis.url=redis://svc-user:s3cret@cache.partner-cloud.de:6379\n');
    const r = await runEgrPass(ctx());
    expect(host(r, 'cache.partner-cloud.de')).toMatchObject({ channels: ['cache'] });
    expect(JSON.stringify(r)).not.toContain('s3cret');
  });

  it('Oracle thin JDBC URLs (no ://) are found', async () => {
    put('src/main/resources/application.properties', 'spring.datasource.url=jdbc:oracle:thin:@//ora-prod.partner-cloud.de:1521/ACCT\n');
    const r = await runEgrPass(ctx());
    expect(host(r, 'ora-prod.partner-cloud.de')).toMatchObject({ channels: ['database'], via: ['spring.datasource.url'] });
  });
});

describe('#3422 Pass 07: hosts in Java code', () => {
  it('attributes each URL to its HTTP client (RestTemplate, WebClient, Feign, OkHttp, JDK HttpClient)', async () => {
    put('src/main/java/de/acme/clients/Clients.java', [
      'package de.acme.clients;',
      '@FeignClient(name = "scoring", url = "https://scoring.partner-risk.com/api")',
      'interface ScoringClient {}',
      'class Clients {',
      '  Object a = restTemplate.getForObject("https://rates.partner-fx.com/latest", Object.class);',
      '  WebClient b = WebClient.builder().baseUrl("https://geo.partner-maps.net").build();',
      '  Request c = new Request.Builder().url("https://push.partner-notify.io/send").build();',
      '  HttpRequest d = HttpRequest.newBuilder(URI.create("https://audit.partner-logs.org/ingest")).build();',
      '  String jdbc = "jdbc:mysql://10.20.30.40:3306/app";',
      '}',
      '@FeignClient(',
      '    name = "ledger", url = "https://ledger.partner-bank.de")',
      'interface LedgerClient {}',
    ].join('\n'));
    const r = await runEgrPass(ctx());
    const via = Object.fromEntries(hosts(r).map((h) => [h.host, h.via.join(',')]));
    expect(via).toEqual({
      'scoring.partner-risk.com': 'Feign',
      'rates.partner-fx.com': 'RestTemplate',
      'geo.partner-maps.net': 'WebClient',
      'push.partner-notify.io': 'OkHttp',
      'audit.partner-logs.org': 'JDK HttpClient',
      '10.20.30.40': '',
      'ledger.partner-bank.de': 'Feign',
    });
    expect(host(r, '10.20.30.40')).toMatchObject({ classification: 'private', channels: ['database'] });
    expect(host(r, 'rates.partner-fx.com')!.locations[0]).toMatchObject({ file: 'src/main/java/de/acme/clients/Clients.java', line: 5 });
  });

  it('a catalogued host in Java or application.yml is reported once, by the catalogue, not as a hard-coded endpoint', async () => {
    put('src/main/java/de/acme/Pay.java', 'class Pay { String u = "https://api.stripe.com/v1/charges"; }\n');
    put('src/main/resources/application.yml', 'sentry:\n  dsn: https://key@o1.ingest.sentry.io/42\n');
    const r = await runEgrPass(ctx());
    expect(hosts(r)).toEqual([]);
    const services = r.assessment['sovereign_services'] as Array<{ service_id: string; detected_via: string }>;
    expect(services.map((s) => s.service_id).sort()).toEqual(['sentry', 'stripe']);
    expect(services.every((s) => s.detected_via === 'source_scan')).toBe(true);
  });
});

describe('#3422 Pass 07: production/test split and test-code setting (#3403)', () => {
  function fixture(): void {
    put('src/main/resources/application.yml', 'partner:\n  base-url: https://api.partner-payments.eu/v2\n');
    put('src/test/java/de/acme/PartnerIT.java', 'class PartnerIT { String u = "https://sandbox.partner-payments.eu/v2"; String v = "https://api.partner-payments.eu/v2"; }\n');
  }

  it('test-only hosts are listed separately; counts per class are recorded', async () => {
    fixture();
    beginSourceScopeRun();
    const r = await runEgrPass(ctx());
    expect(host(r, 'api.partner-payments.eu')).toMatchObject({ total: 2, production: 1, test: 1 });
    expect(host(r, 'sandbox.partner-payments.eu')).toMatchObject({ total: 1, production: 0, test: 1 });
    const [pub] = endpointSignals(r);
    expect(pub!.severity).toBe('medium');
    expect(pub!.derivation).toContain('1 in production code or configuration: api.partner-payments.eu');
    expect(pub!.derivation).toContain('1 seen in test code only: sandbox.partner-payments.eu');
    expect(pub!.evidence).toEqual(['src/main/resources/application.yml:2', 'src/test/java/de/acme/PartnerIT.java:1']);
  });

  it('a class with test-only hosts is informational with low confidence', async () => {
    put('src/test/java/de/acme/PartnerIT.java', 'class PartnerIT { String u = "https://sandbox.partner-payments.eu/v2"; }\n');
    beginSourceScopeRun();
    const r = await runEgrPass(ctx());
    expect(endpointSignals(r)[0]).toMatchObject({ severity: 'informational', confidence: 'low' });
  });

  it('exclude: test files are never listed, so test-only hosts disappear', async () => {
    fixture();
    beginSourceScopeRun({ testCode: 'exclude' });
    const r = await runEgrPass(ctx({ testCode: 'exclude' }));
    expect(hosts(r).map((h) => h.host)).toEqual(['api.partner-payments.eu']);
    expect(host(r, 'api.partner-payments.eu')).toMatchObject({ total: 1, test: 0 });
  });

  it('a Node-only fixture keeps the pre-#3422 output (no hardcoded_endpoints block, fallback signal)', async () => {
    put('package.json', JSON.stringify({ name: 'web', dependencies: {} }));
    put('src/app.ts', 'export const u = "https://api.partner-payments.eu/v2";\n');
    const r = await runEgrPass(ctx());
    expect(r.assessment['hardcoded_endpoints']).toBeUndefined();
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]!.derivation).toContain('No known egress domains');
  });
});

describe('#3422 hostMatchesCatalogueDomain', () => {
  it('handles exact, subdomain, .suffix, prefix. and host/path catalogue forms', () => {
    expect(hostMatchesCatalogueDomain('bucket.s3.amazonaws.com', ['s3.amazonaws.com'])).toBe(true);
    expect(hostMatchesCatalogueDomain('mys3.amazonaws.com', ['s3.amazonaws.com'])).toBe(false);
    expect(hostMatchesCatalogueDomain('acme.okta.com', ['.okta.com'])).toBe(true);
    expect(hostMatchesCatalogueDomain('cognito-idp.eu-central-1.amazonaws.com', ['cognito-idp.'])).toBe(true);
    expect(hostMatchesCatalogueDomain('gitlab.com', ['gitlab.com/api'])).toBe(true);
  });
});
