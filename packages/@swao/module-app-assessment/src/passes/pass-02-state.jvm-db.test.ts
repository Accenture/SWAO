// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass 02 state: Android folders, JDBC / JPA, Kotlin objects (#3485)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3485: synthetic fixtures only. Follow-ups of #3422: React Native / mobile
// android/ folders no longer take the JVM path, JDBC / JPA produce STATE-01,
// Kotlin object state feeds STATE-05.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { endSourceScopeRun, type PassContext, type PassResult, type Signal } from '@swao/core';
import { runStatePass } from './pass-02-state.js';
import { databaseEngineOf, isAndroidFolderPath, jdbcUrlEngine, kotlinMutableProperty } from './jvm-state.js';

let tmp: string;
let src: string;

function put(rel: string, content: string): void {
  const p = join(src, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { workspacePath: tmp, sourcePath: src, appId: 'jvm-app', iter: 1, assessedAt: '2026-10-25', ...overrides } as PassContext;
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
  put('src/main/resources/application.yml', ['server:', '  port: 8080'].join('\n'));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3485-state-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Android (mobile) folders
// ---------------------------------------------------------------------------

function reactNativeAndroid(): void {
  put('package.json', JSON.stringify({ name: 'mobile', dependencies: { 'react-native': '0.74.0', jsonwebtoken: '9.0.0' } }));
  put('App.tsx', 'export default function App() { return null; }\n');
  put('android/build.gradle', "buildscript { dependencies { classpath('com.android.tools.build:gradle:8.2.0') } }\n");
  put('android/gradle.properties', 'org.gradle.jvmargs=-Xmx2048m\nandroid.useAndroidX=true\n');
  put('android/app/build.gradle', 'apply plugin: "com.android.application"\nandroid { namespace "com.mobile" }\n');
  put('android/app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:name=".MainApplication"/></manifest>\n');
  put('android/app/src/main/java/com/mobile/MainActivity.java', [
    'package com.mobile;',
    'public class MainActivity extends ReactActivity {',
    '  private static final Map<String, String> CACHE = new HashMap<>();',
    '}',
  ].join('\n'));
  put('android/app/src/main/java/com/mobile/MainApplication.kt', 'package com.mobile\nobject Holder {\n    var current: String? = null\n}\n');
}

describe('#3485 Pass 02: Android (mobile) folders do not take the JVM path', () => {
  it('a React Native repo whose only Java / Kotlin files sit under android/ keeps the package.json path', async () => {
    reactNativeAndroid();
    const r = await runStatePass(ctx());
    expect(r.assessment['jvm_state']).toBeUndefined();
    expect(r.assessment['session_type']).toBe('jwt_stateless');
    expect(sig(r, 'STATE-03')!.derivation).toContain('JWT-based stateless auth');
    expect(r.signals.map((s) => s.id)).toEqual(['STATE-03', 'STATE-04']);
  });

  it('a native Android app (manifest module, Android Gradle plugin) is not a JVM service either', async () => {
    put('build.gradle', "plugins { id 'com.android.application' version '8.2.0' apply false }\n");
    put('app/build.gradle', "plugins { id 'com.android.application' }\n");
    put('app/src/main/AndroidManifest.xml', '<manifest/>\n');
    put('app/src/main/java/com/x/MainActivity.kt', 'class MainActivity : AppCompatActivity()\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['jvm_state']).toBeUndefined();
  });

  it('a real Spring service still takes the JVM path', async () => {
    springBootApp();
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('none_detected');
    expect(r.assessment['jvm_state']).toMatchObject({ spring_boot: true, jvm_source_files: 1, spring_config_files: 1 });
    expect(r.assessment['jvm_state']).not.toHaveProperty('android_files_excluded');
  });

  it('a mixed repo (Spring service plus android/) takes the JVM path and ignores the android files', async () => {
    reactNativeAndroid();
    put('backend/pom.xml', POM);
    put('backend/src/main/java/de/acme/account/AccountApplication.java', '@SpringBootApplication\npublic class AccountApplication {}\n');
    put('backend/src/main/resources/application.yml', 'server:\n  port: 8080\n');
    const r = await runStatePass(ctx());
    // The JVM model found no session use, so the package.json JWT finding of
    // the React Native front end decides STATE-03 (#3422 rule).
    expect(r.assessment['session_type']).toBe('jwt_stateless');
    expect(r.assessment['jvm_state']).toMatchObject({
      spring_boot: true, stack_evidence: 'backend/pom.xml', jvm_source_files: 1, spring_config_files: 1, android_files_excluded: 6,
    });
    // The static map and the Kotlin object under android/ are not in-process state of the service.
    expect(sig(r, 'STATE-05')).toBeUndefined();
  });

  it('without a JWT or session dependency the React Native repo stays unknown (not the JVM none_detected)', async () => {
    reactNativeAndroid();
    put('package.json', JSON.stringify({ name: 'mobile', dependencies: { 'react-native': '0.74.0' } }));
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('unknown');
    expect(sig(r, 'STATE-03')!.derivation).toBe('Session type could not be determined from package.json alone.');
    expect(r.assessment['jvm_state']).toBeUndefined();
  });

  it('an AndroidManifest.xml in test resources does not switch off the JVM path', async () => {
    springBootApp();
    put('src/test/resources/AndroidManifest.xml', '<manifest/>\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['jvm_state']).toMatchObject({ spring_boot: true, jvm_source_files: 1, spring_config_files: 1 });
  });

  it('a root-level Android app next to a Spring service in backend/: JVM path, backend files counted, app files skipped', async () => {
    put('build.gradle', "plugins { id 'com.android.application' }\n");
    put('src/main/AndroidManifest.xml', '<manifest/>\n');
    put('src/main/java/com/x/MainActivity.java', 'public class MainActivity { private static final Map<String, String> M = new HashMap<>(); }\n');
    put('backend/pom.xml', POM);
    put('backend/src/main/java/de/acme/account/AccountApplication.java', '@SpringBootApplication\npublic class AccountApplication {}\n');
    put('backend/src/main/resources/application.yml', 'server:\n  port: 8080\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['session_type']).toBe('none_detected');
    expect(r.assessment['jvm_state']).toMatchObject({
      spring_boot: true, stack_evidence: 'backend/pom.xml', jvm_source_files: 1, spring_config_files: 1, android_files_excluded: 3,
    });
    expect(sig(r, 'STATE-05')).toBeUndefined();
  });

  it('isAndroidFolderPath: an android segment before src/ only', () => {
    expect(isAndroidFolderPath('android/app/src/main/java/A.java')).toBe(true);
    expect(isAndroidFolderPath('apps/mobile/android/build.gradle')).toBe(true);
    expect(isAndroidFolderPath('src/main/java/com/acme/android/AndroidController.java')).toBe(false);
    expect(isAndroidFolderPath('android')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STATE-01 for JDBC / JPA
// ---------------------------------------------------------------------------

const POM_DB = [
  '<project>',
  '  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.0</version></parent>',
  '  <artifactId>account-service</artifactId>',
  '  <dependencies>',
  '    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>',
  '    <dependency>',
  '      <groupId>org.postgresql</groupId>',
  '      <artifactId>postgresql</artifactId>',
  '      <version>42.7.3</version>',
  '      <scope>runtime</scope>',
  '    </dependency>',
  '    <dependency>',
  '      <groupId>com.h2database</groupId>',
  '      <artifactId>h2</artifactId>',
  '      <version>2.2.224</version>',
  '      <scope>test</scope>',
  '    </dependency>',
  '  </dependencies>',
  '</project>',
].join('\n');

function jpaService(): void {
  put('pom.xml', POM_DB);
  put('src/main/java/de/acme/account/AccountApplication.java', '@SpringBootApplication\npublic class AccountApplication {}\n');
  put('src/main/java/de/acme/account/Account.java', 'import jakarta.persistence.Entity;\n@Entity\npublic class Account { @Id Long id; }\n');
  put('src/main/java/de/acme/account/AccountRepository.java', 'public interface AccountRepository extends JpaRepository<Account, Long> {}\n');
  put('src/main/resources/application.yml', [
    'spring:',
    '  datasource:',
    '    url: jdbc:postgresql://db-user:s3cret@db.internal:5432/accounts',
    '  jpa:',
    '    open-in-view: false',
  ].join('\n'));
  put('src/test/resources/application-test.properties', 'spring.datasource.url=jdbc:h2:mem:test\n');
}

describe('#3485 Pass 02: STATE-01 for JDBC / JPA', () => {
  it('Spring Data JPA with a PostgreSQL datasource: STATE-01, primary_db postgresql, orm jpa, file:line evidence', async () => {
    jpaService();
    const r = await runStatePass(ctx());
    const s01 = sig(r, 'STATE-01')!;
    expect(s01.severity).toBe('informational');
    expect(s01.confidence).toBe('high');
    expect(s01.derivation).toContain('relational database used by the Spring Boot service');
    expect(s01.derivation).toContain('engine postgresql');
    expect(s01.evidence).toEqual(expect.arrayContaining([
      'src/main/java/de/acme/account/Account.java:2',
      'src/main/java/de/acme/account/AccountRepository.java:1',
      'src/main/resources/application.yml:3',
      'pom.xml:5',
      'pom.xml:8',
    ]));
    // The test-scoped H2 driver does not count.
    expect(s01.evidence).not.toContain('pom.xml:14');
    expect(r.assessment['primary_db']).toBe('postgresql');
    expect(r.assessment['orm']).toBe('jpa');
    expect(r.assessment['database_engines']).toEqual(['postgresql']);
    expect(r.assessment['stateful_components']).toEqual(expect.arrayContaining([{ name: 'database', engine: 'postgresql', orm: 'jpa' }]));
    expect(r.signals.map((s) => s.id)).toEqual(['STATE-01', 'STATE-03', 'STATE-04']);
    // Credentials in the datasource URL never reach the pass output.
    const out = JSON.stringify(r);
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('db-user');
  });

  it('the WSP fragment is deterministic and keeps test hits out of the engines', async () => {
    jpaService();
    const a = await runStatePass(ctx());
    const b = await runStatePass(ctx());
    expect(b).toEqual(a);
    const state = a.assessment['jvm_state'] as { findings: Record<string, { stores?: string[]; total: number; production: number; test: number }> };
    expect(Object.keys(state.findings)).toEqual(['jdbc', 'jpa']);
    expect(state.findings['jdbc']).toMatchObject({ stores: ['postgresql'], production: 2, test: 1 });
    expect(state.findings['jpa']).toMatchObject({ production: 4, test: 0 });
    expect(state.findings['jpa']).not.toHaveProperty('stores');
  });

  it('JDBC without JPA (JdbcTemplate, MySQL driver class in properties): orm jdbc', async () => {
    springBootApp();
    put('src/main/resources/application.properties', 'spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver\nspring.datasource.url=${DB_URL}\n');
    put('src/main/java/de/acme/account/Dao.java', 'class Dao { private final JdbcTemplate jdbc; }\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['primary_db']).toBe('mysql');
    expect(r.assessment['orm']).toBe('jdbc');
    expect(sig(r, 'STATE-01')!.evidence).toEqual([
      'src/main/java/de/acme/account/Dao.java:1',
      'src/main/resources/application.properties:1',
      'src/main/resources/application.properties:2',
    ]);
  });

  it('persistence.xml with a Hibernate dialect and a JDBC URL in Helm values name the engine', async () => {
    put('pom.xml', '<project><artifactId>legacy</artifactId></project>\n');
    put('src/main/java/App.java', 'public class App {}\n');
    put('src/main/resources/META-INF/persistence.xml', [
      '<persistence>',
      '  <persistence-unit name="main">',
      '    <property name="hibernate.dialect" value="org.hibernate.dialect.Oracle12cDialect"/>',
      '  </persistence-unit>',
      '</persistence>',
    ].join('\n'));
    put('deploy/values.yaml', 'env:\n  SPRING_DATASOURCE_URL: jdbc:oracle:thin:@db.internal:1521:ORCL\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['primary_db']).toBe('oracle');
    expect(r.assessment['orm']).toBe('jpa');
    expect(sig(r, 'STATE-01')!.evidence).toEqual(expect.arrayContaining([
      'src/main/resources/META-INF/persistence.xml:2',
      'src/main/resources/META-INF/persistence.xml:3',
      'deploy/values.yaml:2',
    ]));
  });

  it('several server engines: primary_db unknown, every engine listed', async () => {
    springBootApp();
    put('src/main/resources/application-prod.yml', 'spring:\n  datasource:\n    url: jdbc:postgresql://a:5432/x\n');
    put('src/main/resources/reporting.properties', 'report.db=jdbc:sqlserver://b:1433;databaseName=r\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['primary_db']).toBe('unknown');
    expect(r.assessment['database_engines']).toEqual(['postgresql', 'sqlserver']);
    expect(sig(r, 'STATE-01')!.derivation).toContain('engines postgresql, sqlserver');
    expect(sig(r, 'STATE-01')!.confidence).toBe('medium');
  });

  it('an embedded H2 database in production is named and flagged as embedded', async () => {
    springBootApp();
    put('src/main/resources/application-local.yml', 'spring:\n  datasource:\n    url: jdbc:h2:file:./data/app\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['primary_db']).toBe('h2');
    expect(sig(r, 'STATE-01')!.derivation).toContain('The only engine found is embedded');
  });

  it('two embedded engines only: primary_db unknown, both named, no "only engine" wording', async () => {
    springBootApp();
    put('src/main/resources/application-local.yml', 'spring:\n  datasource:\n    url: jdbc:h2:file:./data/app\n');
    put('src/main/resources/legacy.properties', 'legacy.url=jdbc:hsqldb:file:./data/legacy\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['primary_db']).toBe('unknown');
    expect(r.assessment['database_engines']).toEqual(['h2', 'hsqldb']);
    const d = sig(r, 'STATE-01')!.derivation;
    expect(d).toContain('embedded engines h2, hsqldb');
    expect(d).toContain('All engines found are embedded');
    expect(d).not.toContain('engine not named');
  });

  it('database hits in test code only produce no STATE-01', async () => {
    springBootApp();
    put('src/test/resources/application-test.yml', 'spring:\n  datasource:\n    url: jdbc:h2:mem:t\n');
    put('src/test/java/de/acme/account/RepoTest.java', 'class RepoTest { JdbcTemplate t; }\n');
    const r = await runStatePass(ctx());
    expect(sig(r, 'STATE-01')).toBeUndefined();
    expect(r.assessment['primary_db']).toBeUndefined();
  });

  it('Prisma keeps precedence over JVM hits', async () => {
    jpaService();
    put('prisma/schema.prisma', 'datasource db {\n  provider = "mysql"\n}\n');
    const r = await runStatePass(ctx());
    expect(r.assessment['primary_db']).toBe('mysql');
    expect(sig(r, 'STATE-01')!.evidence).toEqual(['prisma/schema.prisma']);
    expect(r.assessment['database_engines']).toBeUndefined();
  });

  it('databaseEngineOf and jdbcUrlEngine', () => {
    expect(databaseEngineOf('org.hibernate.dialect.PostgreSQLDialect')).toBe('postgresql');
    expect(databaseEngineOf('org.mariadb.jdbc.Driver')).toBe('mariadb');
    expect(databaseEngineOf('SQL_SERVER')).toBe('sqlserver');
    expect(databaseEngineOf('org.h2.Driver')).toBe('h2');
    expect(databaseEngineOf('oauth2')).toBeUndefined();
    expect(jdbcUrlEngine('url: jdbc:mysql:replication://a,b/db')).toBe('mysql');
    expect(jdbcUrlEngine('r2dbc:pool:postgresql://h/db')).toBe('postgresql');
    expect(jdbcUrlEngine('jdbc:tc:postgresql:15:///db')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Kotlin object state
// ---------------------------------------------------------------------------

describe('#3485 Pass 02: Kotlin object state', () => {
  it('mutable members of an object / companion object and top-level vars yield STATE-05; vals, locals and class members do not', async () => {
    springBootApp();
    put('src/main/kotlin/de/acme/account/Registry.kt', [
      'package de.acme.account',
      '',
      'private var requestCount = 0',
      'val VERSION = "1"',
      '',
      'object Registry {',
      '    private val handlers = mutableMapOf<String, Handler>()',
      '    val names: MutableList<String> = loadNames()',
      '    const val MAX = 10',
      '    private val log = LoggerFactory.getLogger("r")',
      '    fun register(n: String) {',
      '        var local = n',
      '        handlers[n] = Handler(local)',
      '    }',
      '}',
      '',
      'class AccountService {',
      '    var lastAccount: String? = null',
      '    companion object {',
      '        @Volatile var instance: AccountService? = null',
      '        val ids = listOf(1, 2)',
      '    }',
      '}',
      'val handler = object : Runnable {',
      '    var ran = false',
      '    override fun run() {}',
      '}',
    ].join('\n'));
    const r = await runStatePass(ctx());
    const s05 = sig(r, 'STATE-05')!;
    expect(s05.severity).toBe('low');
    expect(s05.derivation).toContain('mutable properties of Kotlin objects or top-level declarations at 4 locations');
    expect(s05.evidence).toEqual([
      'src/main/kotlin/de/acme/account/Registry.kt:3',
      'src/main/kotlin/de/acme/account/Registry.kt:7',
      'src/main/kotlin/de/acme/account/Registry.kt:8',
      'src/main/kotlin/de/acme/account/Registry.kt:20',
    ]);
    const state = r.assessment['jvm_state'] as { findings: Record<string, { locations: Array<{ match: string }> }> };
    expect(state.findings['kotlin_object_state']!.locations.map((l) => l.match)).toEqual([
      'var requestCount', 'val handlers', 'val names', 'var instance',
    ]);
  });

  it('kotlinMutableProperty returns the declaration head only', () => {
    expect(kotlinMutableProperty('    private val cache = ConcurrentHashMap<String, String>()')).toBe('val cache');
    expect(kotlinMutableProperty('    lateinit var client: Client')).toBe('var client');
    expect(kotlinMutableProperty('    val x = listOf(1)')).toBeNull();
    expect(kotlinMutableProperty('    fun f(var x: Int)')).toBeNull();
  });
});
