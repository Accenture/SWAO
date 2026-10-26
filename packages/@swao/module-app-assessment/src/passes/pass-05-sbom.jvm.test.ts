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

// #3420: Pass 05 SBOM on Java services (Maven / Gradle). One test per
// acceptance criterion; OSV is always mocked or served from a local database.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import type { PassContext } from '@swao/core';
import { runSbomPass, javaEolVerdict, osvQueryFromPurl } from './pass-05-sbom.js';

const ENV_KEYS = ['SWAO_OSV_BASE_URL', 'SWAO_OSV_OFFLINE', 'SWAO_OSV_DB_PATH'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function workspace(src: Record<string, string>, ws: Record<string, string> = {}): { sourcePath: string; workspacePath: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-sbom-jvm-'));
  roots.push(root);
  const sourcePath = join(root, 'src');
  const workspacePath = join(root, 'ws');
  mkdirSync(sourcePath, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  for (const [rel, content] of Object.entries(src)) {
    mkdirSync(dirname(join(sourcePath, rel)), { recursive: true });
    writeFileSync(join(sourcePath, rel), content, 'utf-8');
  }
  for (const [rel, content] of Object.entries(ws)) {
    mkdirSync(dirname(join(workspacePath, rel)), { recursive: true });
    writeFileSync(join(workspacePath, rel), content, 'utf-8');
  }
  return { sourcePath, workspacePath };
}

function ctx(paths: { sourcePath: string; workspacePath: string }): PassContext {
  return {
    ...paths,
    appId: 'client-like',
    iter: 1,
    assessedAt: '2026-10-24',
    llm: undefined as unknown as PassContext['llm'],
  } as PassContext;
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

const LOG4SHELL = {
  id: 'GHSA-jfh8-c2jp-5v3q',
  database_specific: { severity: 'CRITICAL' },
  affected: [{
    package: { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core' },
    ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '2.0-beta9' }, { fixed: '2.15.0' }] }],
  }],
};

/** Mock OSV: log4j-core 2.14.1 is affected by LOG4SHELL; everything else is clean. */
function stubOsv(): { batches: Array<{ queries: Array<{ version: string; package: { name: string; ecosystem: string } }> }> } {
  const seen = { batches: [] as Array<{ queries: Array<{ version: string; package: { name: string; ecosystem: string } }> }> };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/querybatch')) {
      const body = JSON.parse(String(init!.body)) as (typeof seen.batches)[number];
      seen.batches.push(body);
      return jsonResponse({
        results: body.queries.map((q) =>
          q.package.name === 'org.apache.logging.log4j:log4j-core' && q.version === '2.14.1' ? { vulns: [{ id: LOG4SHELL.id }] } : {}),
      });
    }
    if (url.includes('/v1/vulns/')) return jsonResponse(LOG4SHELL);
    return jsonResponse({}, false);
  }));
  return seen;
}

const SERVICE_PARENT = `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.2.5</version><relativePath/></parent>
  <groupId>de.example.acme</groupId><artifactId>acme-parent</artifactId><version>1.0.0</version><packaging>pom</packaging>
  <modules><module>core</module></modules>
  <properties><java.version>17</java.version><log4j.version>2.14.1</log4j.version></properties>
  <dependencyManagement><dependencies>
    <dependency><groupId>org.mariadb.jdbc</groupId><artifactId>mariadb-java-client</artifactId><version>3.3.3</version></dependency>
  </dependencies></dependencyManagement>
</project>`;

const SERVICE_CORE = `<project>
  <parent><groupId>de.example.acme</groupId><artifactId>acme-parent</artifactId><version>1.0.0</version></parent>
  <artifactId>acme-core</artifactId>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>\${log4j.version}</version></dependency>
    <dependency><groupId>org.mariadb.jdbc</groupId><artifactId>mariadb-java-client</artifactId></dependency>
    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency>
  </dependencies>
</project>`;

describe('#3420 AC1+AC4: Maven multi-module service produces SBOM signals with Maven OSV results', () => {
  it('queries OSV with ecosystem Maven for resolved, non-test dependencies and reports the critical CVE', async () => {
    const osv = stubOsv();
    const r = await runSbomPass(ctx(workspace({ 'service/pom.xml': SERVICE_PARENT, 'service/core/pom.xml': SERVICE_CORE })));

    // Old behaviour: "package.json not found ... Cannot perform dependency scan".
    const sbom01 = r.signals.find((s) => s.id === 'SBOM-01')!;
    expect(sbom01.derivation).not.toMatch(/package\.json not found|Cannot perform/);
    expect(sbom01.severity).toBe('high');
    expect(sbom01.derivation).toContain('Maven: 3');
    expect(sbom01.derivation).toContain('2 Maven/Gradle build file(s)');
    expect(sbom01.evidence).toEqual(expect.arrayContaining(['service/pom.xml', 'service/core/pom.xml']));

    const sent = osv.batches.flatMap((b) => b.queries);
    expect(sent.every((q) => q.package.ecosystem === 'Maven')).toBe(true);
    expect(sent.map((q) => `${q.package.name}@${q.version}`).sort()).toEqual([
      'org.apache.logging.log4j:log4j-core@2.14.1',
      'org.mariadb.jdbc:mariadb-java-client@3.3.3',
      'org.springframework.boot:spring-boot-starter-web@3.2.5',
    ]);
    // Unresolved (remote BOM) and test-scoped dependencies are never queried.
    expect(sent.some((q) => q.package.name.includes('jackson') || q.package.name.includes('junit'))).toBe(false);

    expect(r.assessment['cve_lookup']).toBe('completed');
    expect(r.assessment['critical_cves_found']).toBe(1);
    expect(r.assessment['high_critical_vulnerabilities']).toEqual([
      { package: 'org.apache.logging.log4j:log4j-core', version: '2.14.1', ids: [LOG4SHELL.id] },
    ]);
    expect(r.assessment['osv']).toMatchObject({ mode: 'online', queried: 3, unresolved_versions_not_queried: 1, batch_size: 1000 });
  });

  it('writes the JVM build summary and per-dependency list for downstream consumers (#3430)', async () => {
    stubOsv();
    const r = await runSbomPass(ctx(workspace({ 'service/pom.xml': SERVICE_PARENT, 'service/core/pom.xml': SERVICE_CORE })));
    expect(r.assessment['jvm_build']).toMatchObject({
      build_tools: ['maven'], modules: 2, dependency_count: 5, unresolved_version_count: 1,
      spring_boot: true, spring_boot_version: '3.2.5',
    });
    const list = r.assessment['jvm_dependencies'] as Array<Record<string, unknown>>;
    expect(list).toContainEqual({
      group: 'org.mariadb.jdbc', artifact: 'mariadb-java-client', version: '3.3.3', scope: 'compile',
      version_source: 'managed', direct: true, build_tool: 'maven', manifest: 'service/core/pom.xml',
      purl: 'pkg:maven/org.mariadb.jdbc/mariadb-java-client@3.3.3',
    });
  });
});

describe('#3420 AC2: no "Node.js unspecified" for Java-only services; Java runtime EOL reported', () => {
  it('reports the Java release from the build and no Node.js runtime signal', async () => {
    stubOsv();
    const r = await runSbomPass(ctx(workspace({ 'service/pom.xml': SERVICE_PARENT, 'service/core/pom.xml': SERVICE_CORE })));
    expect(r.signals.some((s) => /Node\.js/.test(s.derivation))).toBe(false);
    const java = r.signals.find((s) => s.derivation.startsWith('Runtime: Java'))!;
    expect(java.derivation).toContain('java.version = 17');
    expect(java.derivation).toContain('EOL status: supported');
    expect(java.severity).toBe('positive');
    expect(java.evidence).toEqual(['service/pom.xml (java.version)']);
    expect(r.assessment['runtime']).toBe('java');
    expect(r.assessment['node_eol_status']).toBeUndefined();
    expect(r.assessment['java_runtime']).toMatchObject({ major: 17, eol_status: 'supported', eol_date: '2029-09-30' });
  });

  it('flags an end-of-life Java release from a Gradle toolchain as high', async () => {
    const r = await runSbomPass(ctx(workspace({
      'build.gradle.kts': 'java { toolchain { languageVersion.set(JavaLanguageVersion.of(16)) } }\n',
    })));
    const java = r.signals.find((s) => s.derivation.startsWith('Runtime: Java'))!;
    expect(java.severity).toBe('high');
    expect(java.derivation).toContain('EOL status: eol');
    expect(java.derivation).toContain('non-LTS');
  });

  it('Java 8 (catalogue severity high) is not reported as positive while still in support', async () => {
    const r = await runSbomPass(ctx(workspace({
      'pom.xml': '<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version><properties><maven.compiler.source>1.8</maven.compiler.source></properties></project>',
    })));
    const java = r.signals.find((s) => s.derivation.startsWith('Runtime: Java'))!;
    expect(java.severity).not.toBe('positive');
  });

  it('javaEolVerdict uses the catalogue entry, its severity and the non-LTS rule', () => {
    const entries = [{ id: 'java-8', name: 'Java SE 8', eol_date: '2026-12-31', severity: 'high' }, { id: 'java-17', eol_date: '2029-09-30', severity: 'positive' }];
    expect(javaEolVerdict(8, entries, '2027-01-01')).toMatchObject({ status: 'eol', severity: 'high' });
    expect(javaEolVerdict(8, entries, '2026-10-24')).toMatchObject({ status: 'supported', severity: 'low' });
    expect(javaEolVerdict(17, entries, '2026-10-24')).toMatchObject({ status: 'supported', severity: 'positive' });
    expect(javaEolVerdict(19, entries, '2026-10-24').status).toBe('eol');
    expect(javaEolVerdict(29, entries, '2026-10-24').status).toBe('unknown');
  });
});

describe('#3420 AC3: batched OSV with a documented cap; offline database or supplied CycloneDX SBOM', () => {
  it('sends all Gradle dependencies in one /v1/querybatch request (no top-10 spot check)', async () => {
    const deps = Array.from({ length: 15 }, (_, i) => `  implementation 'com.example:lib${i}:1.0.${i}'`).join('\n');
    const osv = stubOsv();
    const r = await runSbomPass(ctx(workspace({ 'build.gradle': `dependencies {\n${deps}\n}\n` })));
    expect(osv.batches).toHaveLength(1);
    expect(osv.batches[0]!.queries).toHaveLength(15);
    expect(r.assessment['osv']).toMatchObject({ queried: 15, query_cap: 2000, detail_cap: 200 });
  });

  it('never sends npm range residue (1.0 <2.0, 1.x) to OSV', async () => {
    const osv = stubOsv();
    await runSbomPass(ctx(workspace({
      'package.json': JSON.stringify({ name: 'web', dependencies: { a: '>=1.0 <2.0', b: '1.x', c: '^4.18.2', d: '*' } }),
    })));
    expect(osv.batches.flatMap((b) => b.queries).map((q) => `${q.package.name}@${q.version}`)).toEqual(['c@4.18.2']);
  });

  it('matches an osv-scanner style Maven/all.zip database in wsp/inputs/osv/ without network', async () => {
    process.env['SWAO_OSV_OFFLINE'] = 'true';
    const paths = workspace({ 'service/pom.xml': SERVICE_PARENT, 'service/core/pom.xml': SERVICE_CORE });
    const zip = new AdmZip();
    zip.addFile(`${LOG4SHELL.id}.json`, Buffer.from(JSON.stringify(LOG4SHELL), 'utf-8'));
    mkdirSync(join(paths.workspacePath, 'wsp', 'inputs', 'osv', 'Maven'), { recursive: true });
    zip.writeZip(join(paths.workspacePath, 'wsp', 'inputs', 'osv', 'Maven', 'all.zip'));
    const f = vi.fn(async () => { throw new Error('network must not be used'); });
    vi.stubGlobal('fetch', f);

    const r = await runSbomPass(ctx(paths));
    expect(f).not.toHaveBeenCalled();
    expect(r.signals.find((s) => s.id === 'SBOM-00')).toBeUndefined();
    const sbom01 = r.signals.find((s) => s.id === 'SBOM-01')!;
    expect(sbom01.severity).toBe('high');
    expect(sbom01.derivation).toContain('Offline OSV database lookup');
    expect(r.assessment['scan_type']).toBe('osv_offline_db');
    expect(r.assessment['osv']).toMatchObject({ mode: 'offline_db', database_files: ['all.zip'] });
  });

  it('queries Maven package URLs from a CycloneDX bom.json supplied in wsp/inputs/compliance/', async () => {
    const osv = stubOsv();
    const bom = {
      bomFormat: 'CycloneDX',
      components: [
        { type: 'library', group: 'org.apache.logging.log4j', name: 'log4j-core', version: '2.14.1', purl: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1?type=jar' },
        { type: 'library', name: 'no-purl', version: '1.0' },
      ],
    };
    const r = await runSbomPass(ctx(workspace({}, { 'wsp/inputs/compliance/bom.json': JSON.stringify(bom) })));
    expect(osv.batches[0]!.queries).toEqual([
      { version: '2.14.1', package: { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' } },
    ]);
    expect(r.assessment['external_sbom_files']).toEqual(['bom.json']);
    expect(r.signals.find((s) => s.id === 'SBOM-01')!.severity).toBe('high');
  });

  it('degrades to SBOM-00 (never throws) when OSV is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await runSbomPass(ctx(workspace({ 'build.gradle': "dependencies { implementation 'com.example:lib:1.0.0' }\n" })));
    expect(r.signals.find((s) => s.id === 'SBOM-00')!.derivation).toMatch(/unreachable/);
    expect(r.signals.find((s) => s.id === 'SBOM-01')!.severity).toBe('informational');
  });

  it('osvQueryFromPurl maps Maven and npm purls and rejects ranges', () => {
    expect(osvQueryFromPurl('pkg:maven/g.h/a-b@1.2.3?type=jar')).toEqual({ ecosystem: 'Maven', name: 'g.h:a-b', version: '1.2.3' });
    expect(osvQueryFromPurl('pkg:npm/%40scope/pkg@4.0.0')).toEqual({ ecosystem: 'npm', name: '@scope/pkg', version: '4.0.0' });
    expect(osvQueryFromPurl('pkg:cargo/tokio@1.35.0')).toBeNull();
    expect(osvQueryFromPurl('pkg:maven/g/a')).toBeNull();
  });
});
