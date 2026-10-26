// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3405: shared hard-coded endpoint scanner (Design 117 section 3).

import { describe, it, expect } from 'vitest';
import {
  scanEndpoints,
  scanReportableEndpoints,
  classifyEndpointHost,
  isEndpointScanCandidate,
  endpointEvidence,
  type EndpointHit,
} from './endpoint-scanner.js';

const brief = (hits: EndpointHit[]) => hits.map((h) => `${h.kind}:${h.host}@${h.line}:${h.column}:${h.classification}`);

describe('scanEndpoints: positive hits per file type (acceptance criterion)', () => {
  it('Java: URL and IPv4 literal with file:line', () => {
    const src = [
      'package a;',
      'class Client {',
      '  static final String BASE = "https://api.partner-bank.eu/v1/accounts";',
      '  static final String DB = "10.20.30.40";',
      '}',
    ].join('\n');
    const hits = scanReportableEndpoints(src);
    expect(brief(hits)).toEqual([
      'url:api.partner-bank.eu@3:31:public',
      'ipv4:10.20.30.40@4:29:private',
    ]);
    expect(endpointEvidence('src/main/java/a/Client.java', hits[0]!)).toBe('src/main/java/a/Client.java:3');
  });

  it('TS/JS: fetch URL and websocket URL', () => {
    const src = "const r = await fetch('https://pricing.vendor-cloud.io/api');\nconst ws = new WebSocket(`wss://stream.vendor-cloud.io:8443/feed`);";
    expect(brief(scanReportableEndpoints(src))).toEqual([
      'url:pricing.vendor-cloud.io@1:24:public',
      'url:stream.vendor-cloud.io@2:27:public',
    ]);
  });

  it('YAML incl. Helm values: JDBC URL, bare IP, internal service name', () => {
    const src = [
      'spring:',
      '  datasource:',
      '    url: jdbc:postgresql://db.prod.corp:5432/orders',
      'ingress:',
      '  loadBalancerIP: 52.29.11.7',
      'keycloak:',
      '  url: http://keycloak:8080/auth',
    ].join('\n');
    const hits = scanReportableEndpoints(src);
    expect(brief(hits)).toEqual([
      'url:db.prod.corp@3:10:private',
      'ipv4:52.29.11.7@5:19:public',
      'url:keycloak@7:8:private',
    ]);
    expect(hits[0]!.scheme).toBe('jdbc:postgresql');
  });

  it('properties: literal default inside a Spring placeholder is still a hard-coded host', () => {
    const src = 'db.host=${DB_HOST:10.1.2.3}\nservice.url=${SERVICE_URL:https://svc.partner.de/api}';
    expect(brief(scanReportableEndpoints(src))).toEqual([
      'ipv4:10.1.2.3@1:19:private',
      'url:svc.partner.de@2:27:public',
    ]);
  });

  it('Dockerfile: download URL and ENV with IP', () => {
    const src = 'FROM eclipse-temurin:21\nRUN curl -fsSL https://downloads.tool-vendor.com/agent.jar -o /a.jar\nENV PROXY_HOST=172.20.0.15';
    expect(brief(scanReportableEndpoints(src))).toEqual([
      'url:downloads.tool-vendor.com@2:16:public',
      'ipv4:172.20.0.15@3:16:private',
    ]);
  });

  it('an IPv4 literal inside a URL is reported once, as the URL', () => {
    const hits = scanEndpoints('endpoint: http://10.0.0.5:9000/health');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'url', host: '10.0.0.5', classification: 'private' });
  });

  it('IPv6 literal inside a URL', () => {
    expect(brief(scanEndpoints('u = "http://[2a00:1450:4001::200e]:80/"'))).toEqual(['url:2a00:1450:4001::200e@1:6:public']);
  });

  it('userinfo is stripped from the host', () => {
    expect(scanEndpoints('amqp://guest:guest@rabbit.prod.example-corp.de:5672')[0]).toMatchObject({ host: 'rabbit.prod.example-corp.de', classification: 'public' });
  });
});

describe('scanEndpoints: exclusions (not reportable)', () => {
  const reportable = (src: string) => scanReportableEndpoints(src).map((h) => h.value);

  it('loopback, unspecified and localhost', () => {
    expect(reportable('a=127.0.0.1\nb=0.0.0.0\nc=http://localhost:8080/x\nd=http://[::1]:80/\ne=http://api.localhost/')).toEqual([]);
  });

  it('RFC 5737 documentation ranges and RFC 3849 IPv6 documentation prefix', () => {
    const hits = scanEndpoints('a=192.0.2.10\nb=198.51.100.7\nc=203.0.113.99\nd=http://[2001:db8::1]/');
    expect(hits.map((h) => h.classification)).toEqual(['documentation', 'documentation', 'documentation', 'documentation']);
    expect(hits.every((h) => !h.reportable)).toBe(true);
  });

  it('RFC 2606 / RFC 6761 names', () => {
    expect(reportable('https://example.com/a https://api.example.org http://svc.test/ http://x.invalid http://foo.example/')).toEqual([]);
  });

  it('four-part version numbers and OIDs', () => {
    expect(reportable('<version>2.5.0.1</version>')).toEqual([]);
    expect(reportable("implementation 'com.acme:lib:1.2.3.4'")).toEqual([]);
    expect(reportable('oid = "1.3.6.1.4.1.311"')).toEqual([]);
    expect(reportable('v1.2.3.4')).toEqual([]);
  });

  it('XML namespaces, schema locations and licence headers', () => {
    const src = [
      '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      '  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
      ' * Licensed under the Apache License, Version 2.0 (see http://www.apache.org/licenses/LICENSE-2.0)',
    ].join('\n');
    expect(reportable(src)).toEqual([]);
  });

  it('templated hosts (Spring, Helm, shell)', () => {
    const hits = scanEndpoints('a: http://${DB_HOST}:5432\nb: "https://{{ .Values.api.host }}/v1"\nc=https://$HOST/x\nd=http://%s/path');
    expect(hits.map((h) => h.classification)).toEqual(['templated', 'templated', 'templated', 'templated']);
  });

  it('netmasks, multicast and leading-zero quads', () => {
    expect(reportable('mask 255.255.255.0 mc 239.1.1.1 odd 010.001.002.003')).toEqual([]);
  });

  it('non-network schemes are ignored', () => {
    expect(scanEndpoints('file:///etc/hosts myapp://open/screen classpath://x')).toEqual([]);
  });

  it('operator allowlist: exact host and .suffix', () => {
    const src = 'a=https://artifactory.acme-group.eu/x\nb=https://git.acme-group.eu\nc=10.9.8.7';
    const hits = scanEndpoints(src, { allowHosts: ['.acme-group.eu', '10.9.8.7'] });
    expect(hits.map((h) => h.classification)).toEqual(['allowlisted', 'allowlisted', 'allowlisted']);
  });
});

describe('scanEndpoints: robustness', () => {
  it('handles CRLF line endings with the same line numbers', () => {
    const lf = scanEndpoints('x\nurl=https://a.vendor.io\nip=52.1.2.3');
    const crlf = scanEndpoints('x\r\nurl=https://a.vendor.io\r\nip=52.1.2.3');
    expect(crlf).toEqual(lf);
  });

  it('skips over-long (minified) lines', () => {
    const long = `var a="${'x'.repeat(5000)}https://a.vendor.io";`;
    expect(scanEndpoints(long)).toEqual([]);
  });

  it('trims trailing punctuation', () => {
    expect(scanEndpoints('See (https://status.vendor.io/page).')[0]!.value).toBe('https://status.vendor.io/page');
  });

  it('skips comment-only lines by default (licence headers, Javadoc, YAML comments), keeps trailing comments and #define', () => {
    const src = [
      '//  Website       :  https://steady-echo.vendor-host.now/',
      ' * @see https://docs.vendor.io/api',
      '# docs: https://docs.vendor.io/yaml',
      '! legacy=10.1.1.1',
      'url: https://api.vendor.io # prod',
      '#define API "https://api.vendor.io/c"',
      '<!-- http://old.vendor.io -->',
    ].join('\n');
    expect(scanEndpoints(src).map((h) => h.line)).toEqual([5, 6]);
    expect(scanEndpoints(src, { skipCommentLines: false }).map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('does not treat a Dockerfile / shell continuation flag (--proxy) as an SQL comment', () => {
    const hits = scanEndpoints('RUN curl -fsSL \\\n    --proxy http://10.0.0.1:3128 \\\n    -- not a url line\n-- sql comment http://x.vendor.io');
    expect(hits.map((h) => `${h.line}:${h.host}`)).toEqual(['2:10.0.0.1']);
  });

  it('masks URL userinfo in the returned value (never echoes credentials)', () => {
    const [h] = scanEndpoints('DATABASE_URL=postgres://app:S3cret@db.prod.vendor.io:5432/orders');
    expect(h!.value).toBe('postgres://***@db.prod.vendor.io:5432/orders');
    expect(h!.value).not.toContain('S3cret');
    expect(h!.host).toBe('db.prod.vendor.io');
  });

  it('maxHits caps the result', () => {
    expect(scanEndpoints('52.1.1.1 52.1.1.2 52.1.1.3', { maxHits: 2 })).toHaveLength(2);
  });

  it('is linear on adversarial input (no catastrophic backtracking)', () => {
    const evil = `${'a'.repeat(3000)}://${'1.'.repeat(400)}`;
    const t0 = Date.now();
    scanEndpoints(evil, { maxLineLength: 10_000 });
    scanEndpoints(`${'1.1.1.'.repeat(600)}`, { maxLineLength: 10_000 });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('is deterministic', () => {
    const src = 'a=https://x.vendor.io\nb=10.1.1.1 c=http://[fd00::1]/';
    expect(scanEndpoints(src)).toEqual(scanEndpoints(src));
  });
});

describe('classifyEndpointHost', () => {
  it.each([
    ['52.29.11.7', 'public'],
    ['10.0.0.1', 'private'],
    ['172.16.5.4', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['169.254.169.254', 'link_local'],
    ['db', 'private'],
    ['orders.svc.cluster.local', 'private'],
    ['api.vendor.com', 'public'],
    ['www.w3.org', 'namespace'],
    ['fe80::1', 'link_local'],
    ['fd12:3456::1', 'private'],
  ])('%s -> %s', (host, cls) => {
    expect(classifyEndpointHost(host)).toBe(cls);
  });
});

describe('isEndpointScanCandidate', () => {
  it.each([
    ['Client.java', '.java', true],
    ['config.js', '.js', true],
    ['values-prod.yaml', '.yaml', true],
    ['application.properties', '.properties', true],
    ['Dockerfile', '', true],
    ['Dockerfile.prod', '.prod', true],
    ['api.dockerfile', '.dockerfile', true],
    ['.env', '', true],
    ['.env.production', '.production', true],
    ['README.md', '.md', false],
    ['package-lock.json', '.json', false],
    ['pnpm-lock.yaml', '.yaml', false],
    ['logo.png', '.png', false],
  ])('%s -> %s', (name, ext, expected) => {
    expect(isEndpointScanCandidate({ name, ext })).toBe(expected);
  });
});
