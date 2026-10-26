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

// #3420: deterministic Maven / Gradle build-file reader. Synthetic fixtures
// only; no Maven or Gradle installation, no network.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import {
  collectJvmProject, parseJavaMajor, parsePom, parseVersionCatalog, isConcreteVersion,
  type JvmDependency, type JvmProject,
} from './jvm-build-files.js';

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-jvm-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function dep(p: JvmProject, ga: string, manifest?: string): JvmDependency | undefined {
  return p.dependencies.find((d) => `${d.group}:${d.artifact}` === ga && (!manifest || d.manifest === manifest));
}

// A multi-module Maven reactor below service/ (no root pom), Spring Boot parent
// from the repository (not resolvable offline), local dependencyManagement.
const PARENT_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.5</version>
    <relativePath/>
  </parent>
  <groupId>de.example.acme</groupId>
  <artifactId>acme-parent</artifactId>
  <version>1.4.0</version>
  <packaging>pom</packaging>
  <modules>
    <module>core</module>
  </modules>
  <properties>
    <java.version>17</java.version>
    <log4j.version>2.14.1</log4j.version>
    <kafka.version>3.6.1</kafka.version>
  </properties>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.apache.kafka</groupId>
        <artifactId>kafka-clients</artifactId>
        <version>\${kafka.version}</version>
      </dependency>
      <dependency>
        <groupId>org.mariadb.jdbc</groupId>
        <artifactId>mariadb-java-client</artifactId>
        <version>3.3.3</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
`;

const CORE_POM = `<project>
  <parent>
    <groupId>de.example.acme</groupId>
    <artifactId>acme-parent</artifactId>
    <version>1.4.0</version>
  </parent>
  <artifactId>acme-core</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.apache.logging.log4j</groupId>
      <artifactId>log4j-core</artifactId>
      <version>\${log4j.version}</version>
    </dependency>
    <dependency>
      <groupId>org.apache.kafka</groupId>
      <artifactId>kafka-clients</artifactId>
    </dependency>
    <dependency>
      <groupId>org.mariadb.jdbc</groupId>
      <artifactId>mariadb-java-client</artifactId>
      <scope>runtime</scope>
    </dependency>
    <dependency>
      <groupId>de.example.acme</groupId>
      <artifactId>acme-api</artifactId>
      <version>\${project.version}</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>ranged</artifactId>
      <version>[1.0,2.0)</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
    <!--
    <dependency>
      <groupId>commented</groupId>
      <artifactId>out</artifactId>
      <version>1.0</version>
    </dependency>
    -->
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <artifactId>maven-surefire-plugin</artifactId>
        <dependencies>
          <dependency><groupId>plugin.only</groupId><artifactId>dep</artifactId><version>1.0</version></dependency>
        </dependencies>
      </plugin>
    </plugins>
  </build>
  <profiles>
    <profile>
      <id>legacy</id>
      <dependencies>
        <dependency><groupId>profile.only</groupId><artifactId>dep</artifactId><version>1.0</version></dependency>
      </dependencies>
    </profile>
  </profiles>
</project>
`;

describe('#3420 Maven pom.xml', () => {
  it('resolves a multi-module reactor under service/ (parent properties, managed versions, project.version)', () => {
    const root = fixture({ 'service/pom.xml': PARENT_POM, 'service/core/pom.xml': CORE_POM });
    const p = collectJvmProject(root);

    expect(p.buildTools).toEqual(['maven']);
    expect([...p.manifests].sort()).toEqual(['service/core/pom.xml', 'service/pom.xml']);
    expect(p.modules).toBe(2);

    const core = 'service/core/pom.xml';
    expect(dep(p, 'org.apache.logging.log4j:log4j-core', core)).toMatchObject({ version: '2.14.1', versionSource: 'property', scope: 'compile' });
    expect(dep(p, 'org.apache.kafka:kafka-clients', core)).toMatchObject({ version: '3.6.1', versionSource: 'managed' });
    expect(dep(p, 'org.mariadb.jdbc:mariadb-java-client', core)).toMatchObject({ version: '3.3.3', versionSource: 'managed', scope: 'runtime' });
    expect(dep(p, 'de.example.acme:acme-api', core)).toMatchObject({ version: '1.4.0', versionSource: 'property' });
    expect(dep(p, 'org.junit.jupiter:junit-jupiter', core)?.scope).toBe('test');
    expect(dep(p, 'org.mariadb.jdbc:mariadb-java-client', core)?.purl).toBe('pkg:maven/org.mariadb.jdbc/mariadb-java-client@3.3.3');
  });

  it('applies the Spring Boot family rule and leaves BOM-managed third-party versions unresolved', () => {
    const root = fixture({ 'service/pom.xml': PARENT_POM, 'service/core/pom.xml': CORE_POM });
    const p = collectJvmProject(root);
    expect(p.usesSpringBoot).toBe(true);
    expect(p.springBootVersion).toBe('3.2.5');
    expect(dep(p, 'org.springframework.boot:spring-boot-starter-web')).toMatchObject({ version: '3.2.5', versionSource: 'bom_family' });
    // Managed by the remote Boot BOM: never guessed.
    expect(dep(p, 'com.fasterxml.jackson.core:jackson-databind')).toMatchObject({ version: null, versionSource: 'unresolved' });
    expect(dep(p, 'com.fasterxml.jackson.core:jackson-databind')?.purl).toBe('pkg:maven/com.fasterxml.jackson.core/jackson-databind');
    // A version range is not a concrete version.
    expect(dep(p, 'com.example:ranged')).toMatchObject({ version: null, declaredVersion: '[1.0,2.0)' });
  });

  it('ignores dependencyManagement entries, plugin and profile dependencies, comments, test resources and target/', () => {
    const root = fixture({
      'service/pom.xml': PARENT_POM,
      'service/core/pom.xml': CORE_POM,
      'service/core/src/test/resources/pom.xml': '<project><dependencies><dependency><groupId>test.res</groupId><artifactId>x</artifactId><version>1</version></dependency></dependencies></project>',
      'service/core/target/classes/META-INF/maven/pom.xml': '<project><dependencies><dependency><groupId>build.out</groupId><artifactId>x</artifactId><version>1</version></dependency></dependencies></project>',
    });
    const p = collectJvmProject(root);
    const groups = new Set(p.dependencies.map((d) => d.group));
    for (const g of ['plugin.only', 'profile.only', 'commented', 'test.res', 'build.out']) expect(groups.has(g)).toBe(false);
    // The parent's dependencyManagement is not a dependency of the parent.
    expect(p.dependencies.filter((d) => d.manifest === 'service/pom.xml')).toEqual([]);
  });

  it('reads the Java release from inherited properties (java.version) and maven.compiler.release', () => {
    const root = fixture({ 'service/pom.xml': PARENT_POM, 'service/core/pom.xml': CORE_POM });
    const p = collectJvmProject(root);
    expect(p.java).toMatchObject({ major: 17, key: 'java.version' });

    const rel = fixture({
      'pom.xml': '<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>',
    });
    expect(collectJvmProject(rel).java).toMatchObject({ major: 21, key: 'maven.compiler.release', file: 'pom.xml' });

    const legacy = fixture({
      'pom.xml': `<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version>
        <build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId>
        <configuration><source>1.8</source><target>1.8</target></configuration></plugin></plugins></build></project>`,
    });
    expect(collectJvmProject(legacy).java).toMatchObject({ major: 8, key: 'maven-compiler-plugin source', raw: '1.8' });
  });

  it('imports managed versions from a local BOM module', () => {
    const root = fixture({
      'bom/pom.xml': `<project><groupId>de.ex</groupId><artifactId>platform-bom</artifactId><version>2.0.0</version>
        <dependencyManagement><dependencies>
          <dependency><groupId>io.minio</groupId><artifactId>minio</artifactId><version>8.5.7</version></dependency>
        </dependencies></dependencyManagement></project>`,
      'app/pom.xml': `<project><groupId>de.ex</groupId><artifactId>app</artifactId><version>2.0.0</version>
        <dependencyManagement><dependencies>
          <dependency><groupId>de.ex</groupId><artifactId>platform-bom</artifactId><version>2.0.0</version><type>pom</type><scope>import</scope></dependency>
        </dependencies></dependencyManagement>
        <dependencies><dependency><groupId>io.minio</groupId><artifactId>minio</artifactId></dependency></dependencies></project>`,
    });
    expect(dep(collectJvmProject(root), 'io.minio:minio')).toMatchObject({ version: '8.5.7', versionSource: 'managed' });
  });

  it('parsePom keeps project coordinates and modules', () => {
    const m = parsePom(PARENT_POM);
    expect(m.artifactId).toBe('acme-parent');
    expect(m.modules).toEqual(['core']);
    expect(m.parent?.relativePath).toBe('');
    expect(m.managed).toHaveLength(2);
    expect(m.dependencies).toHaveLength(0);
  });
});

describe('#3420 Gradle', () => {
  it('reads Groovy string and map notation, ext / gradle.properties variables, scopes and sourceCompatibility', () => {
    const root = fixture({
      'gradle.properties': 'jacksonVersion=2.15.3\n',
      'build.gradle': `
plugins {
  id 'java'
  id 'org.springframework.boot' version '3.3.4'
}
ext {
  kafkaVersion = '3.7.0'
}
def minioVersion = "8.5.9"
sourceCompatibility = JavaVersion.VERSION_17
buildscript { dependencies { classpath 'com.example:build-tool:1.0' } }
dependencies {
  implementation 'org.springframework.boot:spring-boot-starter-actuator'
  implementation "org.apache.kafka:kafka-clients:$kafkaVersion"
  implementation "com.fasterxml.jackson.core:jackson-databind:\${jacksonVersion}"
  implementation group: 'io.minio', name: 'minio', version: minioVersion
  runtimeOnly 'org.mariadb.jdbc:mariadb-java-client:3.4.1'
  compileOnly 'org.projectlombok:lombok:1.18.34'
  testImplementation 'org.junit.jupiter:junit-jupiter:5.11.0'
  implementation project(':shared')
  // implementation 'commented:out:1.0'
}
`,
    });
    const p = collectJvmProject(root);
    expect(p.buildTools).toEqual(['gradle']);
    expect(dep(p, 'org.springframework.boot:spring-boot-starter-actuator')).toMatchObject({ version: '3.3.4', versionSource: 'bom_family' });
    expect(dep(p, 'org.apache.kafka:kafka-clients')).toMatchObject({ version: '3.7.0', versionSource: 'property' });
    expect(dep(p, 'com.fasterxml.jackson.core:jackson-databind')).toMatchObject({ version: '2.15.3', versionSource: 'property' });
    expect(dep(p, 'org.mariadb.jdbc:mariadb-java-client')).toMatchObject({ version: '3.4.1', scope: 'runtime', versionSource: 'declared' });
    expect(dep(p, 'org.projectlombok:lombok')?.scope).toBe('provided');
    expect(dep(p, 'org.junit.jupiter:junit-jupiter')?.scope).toBe('test');
    expect(dep(p, 'com.example:build-tool')).toBeUndefined();
    expect(dep(p, 'commented:out')).toBeUndefined();
    expect(p.java).toMatchObject({ major: 17, key: 'sourceCompatibility' });
    // Map notation with a variable reference as version.
    expect(dep(p, 'io.minio:minio')).toMatchObject({ version: '8.5.9', versionSource: 'property' });
  });

  it('resolves Kotlin DSL version-catalog accessors, bundles, the Boot plugin alias and the Java toolchain', () => {
    const root = fixture({
      'settings.gradle.kts': 'rootProject.name = "svc"\ninclude(":app")\n',
      'gradle/libs.versions.toml': `
[versions]
spring-boot = "3.4.1"
kafka = { strictly = "3.8.0" }
minio = "8.5.12"

[libraries]
spring-boot-starter-web = { module = "org.springframework.boot:spring-boot-starter-web" }
kafka-clients = { module = "org.apache.kafka:kafka-clients", version.ref = "kafka" }
minio = { group = "io.minio", name = "minio", version.ref = "minio" }
logstash-encoder = "net.logstash.logback:logstash-logback-encoder:7.4"
aws-s3 = { module = "software.amazon.awssdk:s3", version = "2.25.0" }

[bundles]
storage = ["minio", "aws-s3"]

[plugins]
spring-boot = { id = "org.springframework.boot", version.ref = "spring-boot" }
`,
      'app/build.gradle.kts': `
plugins {
    alias(libs.plugins.spring.boot)
}
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}
dependencies {
    implementation(libs.spring.boot.starter.web)
    implementation(libs.kafka.clients)
    implementation(libs.bundles.storage)
    runtimeOnly(libs.logstash.encoder)
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
}
`,
    });
    const p = collectJvmProject(root);
    expect(p.springBootVersion).toBe('3.4.1');
    expect(dep(p, 'org.springframework.boot:spring-boot-starter-web')).toMatchObject({ version: '3.4.1', versionSource: 'bom_family' });
    expect(dep(p, 'org.apache.kafka:kafka-clients')).toMatchObject({ version: '3.8.0', versionSource: 'catalog' });
    expect(dep(p, 'io.minio:minio')).toMatchObject({ version: '8.5.12', versionSource: 'catalog' });
    expect(dep(p, 'software.amazon.awssdk:s3')).toMatchObject({ version: '2.25.0', versionSource: 'catalog' });
    expect(dep(p, 'net.logstash.logback:logstash-logback-encoder')).toMatchObject({ version: '7.4', scope: 'runtime' });
    expect(p.java).toMatchObject({ major: 21, key: 'java toolchain languageVersion', file: 'app/build.gradle.kts' });
  });

  it('takes exact versions (incl. transitive) from gradle.lockfile', () => {
    const root = fixture({
      'build.gradle': "dependencies {\n  implementation 'com.google.guava:guava'\n}\n",
      'gradle.lockfile': [
        '# This is a Gradle generated file for dependency locking.',
        'com.google.guava:guava:32.1.3-jre=compileClasspath,runtimeClasspath',
        'com.google.guava:failureaccess:1.0.1=compileClasspath,runtimeClasspath',
        'org.junit:junit-bom:5.10.0=testCompileClasspath,testRuntimeClasspath',
        'empty=annotationProcessor',
      ].join('\n'),
    });
    const p = collectJvmProject(root);
    expect(dep(p, 'com.google.guava:guava')).toMatchObject({ version: '32.1.3-jre', versionSource: 'lockfile', direct: true });
    expect(dep(p, 'com.google.guava:failureaccess')).toMatchObject({ version: '1.0.1', direct: false, scope: 'runtime' });
    expect(dep(p, 'org.junit:junit-bom')).toMatchObject({ direct: false, scope: 'test' });
  });

  it('parseVersionCatalog handles string notation, rich versions and accessor normalisation', () => {
    const c = parseVersionCatalog('[versions]\nboot = { require = "3.1.0" }\n[libraries]\nmy_lib-core = "g:a:1.0"\nother = { module = "g:b", version.ref = "boot" }\n');
    expect(c.libraries.get('my.lib.core')).toMatchObject({ group: 'g', artifact: 'a', version: '1.0' });
    expect(c.libraries.get('other')).toMatchObject({ version: '3.1.0' });
  });
});

describe('#3420 helpers', () => {
  it('parseJavaMajor normalises the common spellings', () => {
    expect(parseJavaMajor('1.8')).toBe(8);
    expect(parseJavaMajor('8')).toBe(8);
    expect(parseJavaMajor('11')).toBe(11);
    expect(parseJavaMajor('17.0.2')).toBe(17);
    expect(parseJavaMajor('VERSION_1_8')).toBe(8);
    expect(parseJavaMajor('VERSION_21')).toBe(21);
    expect(parseJavaMajor('[17,18)')).toBe(17);
    expect(parseJavaMajor('temurin-21.0.1')).toBe(21);
    expect(parseJavaMajor('21.0.2-tem')).toBe(21);
    expect(parseJavaMajor('${java.version}')).toBeNull();
    expect(parseJavaMajor('1')).toBeNull();
  });

  it('isConcreteVersion rejects ranges and dynamic versions', () => {
    expect(isConcreteVersion('2.14.1')).toBe(true);
    expect(isConcreteVersion('32.1.3-jre')).toBe(true);
    expect(isConcreteVersion('[1.0,2.0)')).toBe(false);
    expect(isConcreteVersion('1.+')).toBe(false);
    expect(isConcreteVersion('latest.release')).toBe(false);
    expect(isConcreteVersion('${x}')).toBe(false);
    expect(isConcreteVersion('5.3.1.RELEASE')).toBe(true);
    expect(isConcreteVersion('1.0 <2.0')).toBe(false);
    expect(isConcreteVersion('1.x')).toBe(false);
    expect(isConcreteVersion('2.X.1')).toBe(false);
  });

  it('returns an empty project for a tree without JVM build files', () => {
    const root = fixture({ 'package.json': '{}' });
    const p = collectJvmProject(root);
    expect(p.manifests).toEqual([]);
    expect(p.java).toBeNull();
  });
});
