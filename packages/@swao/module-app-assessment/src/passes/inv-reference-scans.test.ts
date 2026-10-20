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

// #3160: Pass 01 reference catalogue scans (INV-07 database compatibility,
// INV-08 legacy indicators, INV-09 vendor SDK lock-in) against a fixture
// source tree written to a temp directory and the real swao/controls/ catalogues.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { SignalSchema } from '@swao/core';
import type { PassContext, Signal } from '@swao/core';
import {
  collectDependencyInventory,
  matchesPattern,
  imageRepository,
  imageTag,
  leadingVersion,
  versionInRange,
  runInvReferenceScans,
  type LegacyHit,
  type VendorSdkHit,
  type DbCompatibilityResult,
} from './inv-reference-scans.js';
import { runInvPass } from './pass-01-inv.js';

/** Fixture: a multi-ecosystem source tree with known legacy, vendor and database dependencies. */
const FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'fixture-app',
    version: '1.0.0',
    dependencies: { '@aws-sdk/client-s3': '^3.500.0', mssql: '^10.0.0', pg: '^8.11.0', express: '^4.19.0' },
    devDependencies: { typescript: '^5.4.0' },
  }),
  'requirements.txt': '# comment\n-r base.txt\nboto3==1.34.0\npymqi>=1.12\n',
  'pyproject.toml': [
    '[project]',
    'name = "fixture"',
    'dependencies = [',
    '  "oracledb>=2.0",',
    '  "requests",',
    ']',
    'classifiers = ["Programming Language :: Python"]',
    '',
    '[tool.poetry.dependencies]',
    'python = "^3.11"',
    'lxml = "*"',
    '',
  ].join('\n'),
  'Cargo.toml': [
    '[package]',
    'name = "fixture"',
    '',
    '[dependencies]',
    'tiberius = "0.12"',
    'windows = "0.52"',
    '',
    '[dependencies.aws-config]',
    'version = "1"',
    '',
  ].join('\n'),
  'java/pom.xml': [
    '<project>',
    '  <dependencies>',
    '    <dependency><groupId>com.ibm.mq</groupId><artifactId>com.ibm.mq.allclient</artifactId><version>9.3.0.0</version></dependency>',
    '    <dependency><groupId>log4j</groupId><artifactId>log4j</artifactId><version>1.2.17</version></dependency>',
    '  </dependencies>',
    '</project>',
  ].join('\n'),
  'java/build.gradle': "dependencies {\n  implementation 'com.tibco:tibjms:8.0.0'\n}\n",
  'dotnet/App.csproj': '<Project><ItemGroup><PackageReference Include="Azure.Storage.Blobs" Version="12.19.0" /></ItemGroup></Project>',
  'docker-compose.yml': [
    'services:',
    '  db:',
    '    image: postgres:11-alpine',
    '  cache:',
    '    image: "redis:7.2"',
    '  mssql:',
    '    image: mcr.microsoft.com/mssql/server:2019-latest',
    '',
  ].join('\n'),
  // #3302: a BizTalk map (.btm, BizTalk Server glossary); .odx is not evaluated (ASAM ODX collision).
  'integration/orders.btm': '<biztalk orchestration />',
  'legacy/module.p': '/* ambiguous: Pascal or OpenEdge */',
  'cobol/PAYROLL.cbl': '       IDENTIFICATION DIVISION.',
  // Dependency folders are not scanned.
  'node_modules/firebase/package.json': JSON.stringify({ name: 'firebase', dependencies: { firebase: '10.0.0' } }),
};

function writeFixture(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
}

let root: string;
let emptyRoot: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-3160-inv-'));
  writeFixture(root, FIXTURE);
  emptyRoot = mkdtempSync(join(tmpdir(), 'swao-3160-inv-empty-'));
  writeFixture(emptyRoot, { 'package.json': JSON.stringify({ name: 'plain', dependencies: { express: '^4.19.0' } }) });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(emptyRoot, { recursive: true, force: true });
});

describe('helpers', () => {
  it('matchesPattern: trailing wildcard is a prefix, default exact, pip names normalised', () => {
    expect(matchesPattern('@aws-sdk/client-s3', '@aws-sdk/*', 'prefix', 'npm')).toBe(true);
    expect(matchesPattern('aws-sdk', 'aws-sdk', 'exact', 'npm')).toBe(true);
    expect(matchesPattern('aws-sdk-mock', 'aws-sdk', 'exact', 'npm')).toBe(false);
    expect(matchesPattern('cx-oracle', 'cx_Oracle', 'exact', 'pip')).toBe(true);
    expect(matchesPattern('azure.storage.blobs', 'Azure.*', 'prefix', 'nuget')).toBe(true);
  });

  it('image reference parsing', () => {
    expect(imageRepository('docker.io/library/postgres:11-alpine')).toBe('postgres');
    expect(imageRepository('mcr.microsoft.com/mssql/server:2019-latest')).toBe('mcr.microsoft.com/mssql/server');
    expect(imageRepository('localhost:5000/app')).toBe('localhost:5000/app');
    expect(imageTag('postgres:11-alpine')).toBe('11-alpine');
    expect(imageTag('localhost:5000/app')).toBeNull();
    expect(leadingVersion('11-alpine')).toBe('11');
    expect(leadingVersion('latest')).toBeNull();
  });

  it('versionInRange evaluates catalogue ranges', () => {
    expect(versionInRange('11', '<12')).toBe(true);
    expect(versionInRange('14', '>=12,<15')).toBe(true);
    expect(versionInRange('15.4', '>=15')).toBe(true);
    expect(versionInRange('5.7.44', '>=5.7,<8.0')).toBe(true);
    expect(versionInRange('8.0', '>=5.7,<8.0')).toBe(false);
  });
});

describe('collectDependencyInventory', () => {
  it('parses every supported manifest and skips node_modules', () => {
    const inv = collectDependencyInventory(root);
    const names = (eco: string): string[] => inv.deps.filter((d) => d.ecosystem === eco).map((d) => d.name);
    expect(names('npm')).toEqual(expect.arrayContaining(['@aws-sdk/client-s3', 'mssql', 'pg', 'typescript']));
    expect(names('npm')).not.toContain('firebase');
    expect(names('pip')).toEqual(expect.arrayContaining(['boto3', 'pymqi', 'oracledb', 'requests', 'lxml']));
    // classifiers and the Poetry python constraint are not dependencies
    expect(names('pip')).not.toContain('Programming');
    expect(names('pip')).not.toContain('python');
    expect(names('cargo')).toEqual(expect.arrayContaining(['tiberius', 'windows', 'aws-config']));
    const maven = inv.deps.filter((d) => d.ecosystem === 'maven').map((d) => `${d.group}:${d.name}`);
    expect(maven).toEqual(expect.arrayContaining(['com.ibm.mq:com.ibm.mq.allclient', 'log4j:log4j', 'com.tibco:tibjms']));
    expect(names('nuget')).toEqual(['Azure.Storage.Blobs']);
    expect(inv.images.map((i) => i.image)).toEqual(['postgres:11-alpine', 'redis:7.2', 'mcr.microsoft.com/mssql/server:2019-latest']);
    expect(inv.files).toContain('integration/orders.btm');
  });

  it('returns an empty inventory for a missing source path', () => {
    expect(collectDependencyInventory(join(tmpdir(), 'swao-3160-does-not-exist'))).toEqual({ deps: [], images: [], files: [] });
  });
});

describe('runInvReferenceScans on the fixture', () => {
  let signals: Signal[];
  let assessment: Record<string, unknown>;

  beforeAll(() => {
    const r = runInvReferenceScans({ sourcePath: root, priorSignals: [] });
    signals = r.signals;
    assessment = r.assessment;
  });

  it('emits INV-07, INV-08 and INV-09, each valid against SignalSchema', () => {
    expect(signals.map((s) => s.id).sort()).toEqual(['INV-07', 'INV-08', 'INV-09']);
    for (const s of signals) expect(() => SignalSchema.parse(s), s.id).not.toThrow();
    expect(assessment.reference_catalogue_checks).toEqual({
      vendor_sdk: 'matched',
      legacy_indicators: 'matched',
      db_compatibility: 'matched',
    });
  });

  it('INV-09 lists the vendor SDKs and is high (an SDK blocks migration)', () => {
    const ids = (assessment.vendor_sdks as VendorSdkHit[]).map((h) => h.id).sort();
    expect(ids).toEqual([
      'aws-sdk-js-v3', 'aws-sdk-python', 'aws-sdk-rust', 'azure-sdk-dotnet',
      'ibm-mq-client', 'oracle-db-client', 'sql-server-client', 'tibco-ems-client',
    ]);
    const inv09 = signals.find((s) => s.id === 'INV-09')!;
    expect(inv09.severity).toBe('high');
    expect(inv09.derivation).toContain('vendor-sdk-catalogue.yaml');
  });

  it('INV-08 lists the legacy indicators with tiers, ignores ambiguous file patterns', () => {
    const hits = assessment.legacy_indicators as LegacyHit[];
    const byId = new Map(hits.map((h) => [h.id, h]));
    expect([...byId.keys()].sort()).toEqual([
      'LI-T1-001', 'LI-T1-002', 'LI-T1-004', 'LI-T1-005',
      'LI-T2-001', 'LI-T2-002', 'LI-T2-004',
      'LI-T3-003', 'LI-T3-005',
    ]);
    // `*.p` is ambiguous: no OpenEdge hit from legacy/module.p
    expect(byId.has('LI-T1-007')).toBe(false);
    // cargo `windows` carries a catalogue note: COM is low confidence
    expect(byId.get('LI-T1-005')!.confidence).toBe('low');
    // pip `lxml` carries a note: XSLT is low confidence
    expect(byId.get('LI-T3-003')!.confidence).toBe('low');
    // log4j rule is pinned to group and artifact: high confidence
    expect(byId.get('LI-T3-005')!.confidence).toBe('high');
    expect(byId.get('LI-T1-004')!.evidence).toContain('integration/orders.btm');
    const inv08 = signals.find((s) => s.id === 'INV-08')!;
    expect(inv08.legacy_tier).toBe('tier_1_blocker');
    expect(inv08.severity).toBe('high');
  });

  it('INV-07 classifies database engines by version from image tags', () => {
    const results = assessment.database_compatibility as DbCompatibilityResult[];
    const key = (r: DbCompatibilityResult): string => `${r.engine}@${r.version ?? '?'}`;
    expect(results.map(key).sort()).toEqual(['oracle@?', 'postgres@11', 'redis@7.2', 'sqlserver@2019']);
    const pg = results.find((r) => r.engine === 'postgres')!;
    expect(pg.rows[0]!.compatibility).toBe('migration_required');
    expect(pg.severity).toBe('medium');
    expect(results.find((r) => r.engine === 'redis')!.severity).toBe('informational');
    expect(results.find((r) => r.engine === 'sqlserver')!.rows[0]!.sovereign_availability).toBe('vm_only');
    // Every Oracle row is vm_only, so the verdict holds without a version.
    expect(results.find((r) => r.engine === 'oracle')!.severity).toBe('high');
    const inv07 = signals.find((s) => s.id === 'INV-07')!;
    expect(inv07.severity).toBe('high');
    expect(inv07.confidence).toBe('medium');
  });

  it('unversioned engine with version-dependent rows is low', () => {
    const r = runInvReferenceScans({ sourcePath: emptyRoot, priorSignals: [], databaseEngine: 'postgresql' });
    const results = r.assessment.database_compatibility as DbCompatibilityResult[];
    expect(results).toHaveLength(1);
    expect(results[0]!.version).toBeNull();
    expect(results[0]!.severity).toBe('low');
    expect(r.signals.find((s) => s.id === 'INV-07')!.confidence).toBe('low');
  });

  it('reads engine versions from service_dep tags of earlier INV signals', () => {
    const prior: Signal[] = [{
      id: 'INV-10', source: 'static_analysis', category: 'infrastructure_platform', severity: 'informational',
      derivation: 'Terraform state declares postgresql@16.', evidence: ['x.tfstate'], confidence: 'high',
      implies: ['service_dep:postgresql@16'],
    }];
    const r = runInvReferenceScans({ sourcePath: emptyRoot, priorSignals: prior });
    const results = r.assessment.database_compatibility as DbCompatibilityResult[];
    expect(results.map((x) => `${x.engine}@${x.version}`)).toEqual(['postgres@16']);
    expect(results[0]!.rows[0]!.version_range).toBe('>=15');
  });
});

describe('#3296 catalogue corrections', () => {
  const withFiles = (files: Record<string, string>, fn: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-3296-inv-'));
    try {
      writeFixture(dir, files);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const pom = (deps: Array<[string, string]>): string =>
    `<project><dependencies>${deps.map(([g, a]) => `<dependency><groupId>${g}</groupId><artifactId>${a}</artifactId><version>1</version></dependency>`).join('')}</dependencies></project>`;

  it('LI-T2-005: the plain JMS API or an open-source broker is not flagged', () => {
    withFiles({ 'pom.xml': pom([['jakarta.jms', 'jakarta.jms-api'], ['javax.jms', 'javax.jms-api'], ['org.apache.activemq', 'artemis-jakarta-client']]) }, (dir) => {
      const r = runInvReferenceScans({ sourcePath: dir, priorSignals: [] });
      expect(r.signals.find((s) => s.id === 'INV-08')).toBeUndefined();
    });
  });

  it('LI-T2-005: an Oracle AQ JMS client is flagged', () => {
    withFiles({ 'pom.xml': pom([['jakarta.jms', 'jakarta.jms-api'], ['com.oracle.database.messaging', 'aqapi']]) }, (dir) => {
      const r = runInvReferenceScans({ sourcePath: dir, priorSignals: [] });
      const hits = r.assessment.legacy_indicators as Array<{ id: string; confidence: string }>;
      expect(hits.map((h) => h.id)).toEqual(['LI-T2-005']);
      expect(hits[0]!.confidence).toBe('high');
    });
  });

  it('PostgreSQL 12 and 13 are end of life (migration_required); 14 is supported', () => {
    const at = (v: string) => {
      const prior: Signal[] = [{
        id: 'INV-10', source: 'static_analysis', category: 'infrastructure_platform', severity: 'informational',
        derivation: `Terraform state declares postgresql@${v}.`, evidence: ['x.tfstate'], confidence: 'high',
        implies: [`service_dep:postgresql@${v}`],
      }];
      const r = runInvReferenceScans({ sourcePath: emptyRoot, priorSignals: prior });
      return (r.assessment.database_compatibility as DbCompatibilityResult[])[0]!.rows[0]!;
    };
    expect(at('12').compatibility).toBe('migration_required');
    expect(at('13').compatibility).toBe('migration_required');
    expect(at('14').compatibility).toBe('supported');
    expect(at('14').version_range).toBe('>=14,<15');
  });
});

describe('no matches and missing catalogues', () => {
  it('a plain app emits no reference signals and records no_match', () => {
    const r = runInvReferenceScans({ sourcePath: emptyRoot, priorSignals: [] });
    expect(r.signals).toEqual([]);
    expect(r.assessment.reference_catalogue_checks).toEqual({
      vendor_sdk: 'no_match',
      legacy_indicators: 'no_match',
      db_compatibility: 'no_match',
    });
  });

  it('a missing catalogue is recorded as skipped and does not throw', () => {
    const missing = join(tmpdir(), 'swao-3160-missing.yaml');
    const r = runInvReferenceScans({
      sourcePath: root,
      priorSignals: [],
      cataloguePaths: { vendorSdk: missing, legacyIndicators: missing, dbCompatibility: missing },
    });
    expect(r.signals).toEqual([]);
    const checks = r.assessment.reference_catalogue_checks as Record<string, string>;
    expect(checks.vendor_sdk).toMatch(/^skipped: /);
    expect(checks.legacy_indicators).toMatch(/^skipped: /);
    expect(checks.db_compatibility).toMatch(/^skipped: /);
  });
});

describe('runInvPass integration', () => {
  const ctx = (sourcePath: string): PassContext => ({
    appId: 'fixture', sourcePath, workspacePath: sourcePath, iter: 1, assessedAt: '2026-10-17T00:00:00Z',
  });

  it('Pass 01 carries INV-07, INV-08 and INV-09 for the fixture', async () => {
    const result = await runInvPass(ctx(root));
    const ids = result.signals.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['INV-01', 'INV-05', 'INV-07', 'INV-08', 'INV-09']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.assessment.reference_catalogue_checks).toBeDefined();
  });

  it('Pass 01 on a plain app adds no reference signals', async () => {
    const result = await runInvPass(ctx(emptyRoot));
    expect(result.signals.map((s) => s.id).filter((id) => ['INV-07', 'INV-08', 'INV-09'].includes(id))).toEqual([]);
  });
});
