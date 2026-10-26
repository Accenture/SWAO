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

// #3424: Pass 06 TF-01 (Factor III, Config) is stack-aware. Synthetic
// fixtures only (Spring Boot with placeholders, Helm chart, Node with
// .env.example, hard-coded JDBC URL and password).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import type { PassContext, Signal } from '@swao/core';
import { runTfPass } from './pass-06-tf.js';
import { ConfigExternalisationSchema, credentialLiteral, keyValueLines, type ConfigExternalisation } from './tf-config-evidence.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-tf01-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content, 'utf-8');
  }
  return root;
}

interface Run {
  tf01: Signal;
  factor: string | undefined;
  passRate: number;
  cfg: ConfigExternalisation;
}

async function run(files: Record<string, string>): Promise<Run> {
  const sourcePath = tree(files);
  const r = await runTfPass({ sourcePath, workspacePath: sourcePath, appId: 'tf', iter: 1, assessedAt: '2026-10-24' } as PassContext);
  const a = r.assessment as { factor_scores: Array<{ factor: string; status: string }>; twelve_factor_pass_rate: number; config_externalisation: unknown };
  return {
    tf01: r.signals.find((s) => s.id === 'TF-01')!,
    factor: a.factor_scores.find((f) => f.factor.startsWith('III'))?.status,
    passRate: a.twelve_factor_pass_rate,
    // Parsed only when present, so the signal assertions run (and fail) on pre-#3424 code.
    cfg: (a.config_externalisation === undefined ? undefined : ConfigExternalisationSchema.parse(a.config_externalisation)) as ConfigExternalisation,
  };
}

const POM = `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.2.5</version><relativePath/></parent>
  <groupId>de.example</groupId><artifactId>svc</artifactId><version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  </dependencies>
</project>`;

const APP_YML_PLACEHOLDERS = `spring:
  application:
    name: svc
  datasource:
    url: jdbc:postgresql://\${DB_HOST}:5432/app
    username: \${DB_USER}
    password: \${DB_PASSWORD}
server:
  port: \${SERVER_PORT:8080}
`;

const CHART = 'apiVersion: v2\nname: svc\nversion: 0.1.0\n';
// Secret-name keys (Bitnami style) name a Kubernetes Secret, they do not hold one.
const VALUES_PROD = 'image:\n  repository: registry.example/svc\ndb:\n  host: 10.20.30.40\n  existingSecret: svc-db-credentials\nimagePullSecrets: regcred\ningress:\n  tlsSecret: svc-tls\n';
const DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
spec:
  template:
    spec:
      containers:
        - name: svc
          envFrom:
            - configMapRef:
                name: {{ .Release.Name }}-config
          env:
            - name: DB_HOST
              value: {{ .Values.db.host | quote }}
`;
const CONFIGMAP = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: svc-config\ndata:\n  LOG_LEVEL: info\n';

const SPRING_HELM: Record<string, string> = {
  'pom.xml': POM,
  'src/main/resources/application.yml': APP_YML_PLACEHOLDERS,
  'src/main/resources/application-prod.yml': 'logging:\n  level:\n    root: INFO\n',
  'src/main/java/de/example/DbProps.java': '@ConfigurationProperties(prefix = "db")\npublic class DbProps {}\n',
  'helm/svc/Chart.yaml': CHART,
  'helm/svc/values-prod.yaml': VALUES_PROD,
  'helm/svc/templates/deployment.yaml': DEPLOYMENT,
  'helm/svc/templates/configmap.yaml': CONFIGMAP,
};

describe('#3424 AC1: Spring Boot / Helm with placeholders and ConfigMaps yields Positive', () => {
  it('TF-01 positive, factor III pass, no .env.example needed (fails before #3424: High)', async () => {
    const { tf01, factor, cfg } = await run(SPRING_HELM);
    expect(tf01.severity).toBe('positive');
    expect(tf01.confidence).toBe('high');
    expect(factor).toBe('pass');
    expect(tf01.derivation).not.toContain('.env.example not found');
    expect(tf01.derivation).toContain('Spring Boot');
    expect(tf01.derivation).toContain('Helm');
    expect(cfg.stacks).toEqual(expect.arrayContaining(['spring', 'helm', 'kubernetes']));
    const details = cfg.positive.map((e) => e.detail).join(' | ');
    expect(details).toContain('spring.datasource.password resolved from the placeholder ${DB_PASSWORD}');
    expect(details).toContain('Kubernetes ConfigMap manifest');
    expect(details).toContain('Helm template reads configuration from .Values');
    expect(details).toContain('@ConfigurationProperties binding');
    expect(cfg.positive.find((e) => e.detail.startsWith('spring.datasource.password'))?.file).toBe('src/main/resources/application.yml:7');
    expect(cfg.hard_coded).toEqual([]);
  });

  it('a literal host in a per-environment Helm values file is informational, not hard-coded', async () => {
    const { tf01, cfg } = await run(SPRING_HELM);
    expect(cfg.deployment_literals).toEqual([{ file: 'helm/svc/values-prod.yaml:4', detail: 'private IP 10.20.30.40 in deployment values' }]);
    expect(tf01.severity).toBe('positive');
    expect(tf01.derivation).toContain('which is where they belong');
    // existingSecret / imagePullSecrets / tlsSecret are Secret names, not credentials.
    expect(cfg.hard_coded).toEqual([]);
  });

  it('a literal host in the chart default values.yaml counts against TF-01 (partial / low)', async () => {
    const { tf01, factor, cfg } = await run({ ...SPRING_HELM, 'helm/svc/values.yaml': 'db:\n  host: 10.20.30.41\n' });
    expect(cfg.deployment_literals.map((e) => e.file)).toEqual(expect.arrayContaining(['helm/svc/values.yaml:2', 'helm/svc/values-prod.yaml:4']));
    expect(cfg.deployment_default_literal_count).toBe(1);
    expect(tf01.severity).toBe('low');
    expect(factor).toBe('partial');
    expect(tf01.derivation).toContain('helm/svc/values.yaml:2');
    expect(cfg.hard_coded).toEqual([]);
  });

  it('a literal host in a ConfigMap counts against TF-01 (partial / low)', async () => {
    const { tf01, cfg } = await run({ ...SPRING_HELM, 'helm/svc/templates/configmap.yaml': CONFIGMAP + '  DB_HOST: 10.20.30.42\n' });
    expect(cfg.deployment_default_literal_count).toBe(1);
    expect(tf01.severity).toBe('low');
    expect(tf01.derivation).toContain('ConfigMap hold literal endpoints');
  });

  it('only per-environment overlays keep the default-literal count at zero', async () => {
    const { cfg } = await run(SPRING_HELM);
    expect(cfg.deployment_default_literal_count).toBe(0);
  });

  it('cluster service names in application.yml are informational, not hard-coded', async () => {
    const { tf01, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://postgres:5432/app\n    password: ${DB_PASSWORD}\neureka:\n  client:\n    service-url:\n      defaultZone: http://eureka.platform.svc.cluster.local:8761/eureka\n',
    });
    expect(cfg.hard_coded).toEqual([]);
    expect(cfg.service_hosts.map((e) => e.file)).toEqual(['src/main/resources/application.yml:3', 'src/main/resources/application.yml:8']);
    expect(tf01.severity).toBe('positive');
  });

  it('spring.config.import with userinfo never echoes the password', async () => {
    const { tf01, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.properties': 'spring.config.import=configserver:http://admin:Sup3rS3cret@config-server:8888\n',
    });
    expect(tf01.severity).toBe('positive');
    expect(tf01.derivation).not.toContain('Sup3rS3cret');
    expect(JSON.stringify(cfg)).not.toContain('Sup3rS3cret');
  });

  it('Spring Cloud Config import counts as external configuration', async () => {
    const { tf01, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.properties': 'spring.application.name=svc\nspring.config.import=optional:configserver:\n',
    });
    expect(tf01.severity).toBe('positive');
    expect(cfg.positive[0]).toEqual({ file: 'src/main/resources/application.properties:2', detail: 'spring.config.import=optional:configserver:' });
  });
});

describe('#3424 AC2: a literal DB password or IP in application.yml yields High with file:line', () => {
  it('hard-coded JDBC URL with a private IP', async () => {
    const { tf01, factor, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://10.20.30.40:5432/app\n    username: app\n',
    });
    expect(tf01.severity).toBe('high');
    expect(tf01.confidence).toBe('high');
    expect(factor).toBe('fail');
    expect(tf01.evidence).toEqual(['src/main/resources/application.yml:3']);
    expect(cfg.hard_coded).toEqual([{ file: 'src/main/resources/application.yml:3', detail: 'hard-coded private endpoint jdbc:postgresql://10.20.30.40' }]);
  });

  it('literal password (value never echoed) and placeholder default password', async () => {
    const { tf01, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://${DB_HOST}:5432/app\n    password: S3cretValue!\napp:\n  api-key: ${API_KEY:abc123def}\n',
    });
    expect(tf01.severity).toBe('high');
    expect(tf01.derivation).not.toContain('S3cretValue');
    expect(tf01.derivation).not.toContain('abc123def');
    expect(cfg.hard_coded).toEqual([
      { file: 'src/main/resources/application.yml:4', detail: 'literal value for spring.datasource.password' },
      { file: 'src/main/resources/application.yml:6', detail: 'literal default for app.api-key inside the placeholder ${API_KEY}' },
    ]);
    expect(tf01.derivation).toContain('Externalisation evidence is also present');
    expect(JSON.stringify(cfg)).not.toContain('abc123def');
    expect(JSON.stringify(cfg)).not.toContain('S3cretValue');
  });

  it('a credential in a Helm values file is hard-coded too', async () => {
    const { tf01, cfg } = await run({ ...SPRING_HELM, 'helm/svc/values.yaml': 'db:\n  password: hunter2hunter2\n' });
    expect(tf01.severity).toBe('high');
    expect(cfg.hard_coded[0]).toEqual({ file: 'helm/svc/values.yaml:2', detail: 'literal value for db.password in deployment configuration' });
  });

  it('a literal IP default inside a placeholder is partial (low), not High', async () => {
    const { tf01, factor, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.yml': 'db:\n  host: ${DB_HOST:10.0.0.1}\n  url: jdbc:postgresql://${DB_HOST:10.0.0.2}:5432/app\n',
    });
    expect(tf01.severity).toBe('low');
    expect(factor).toBe('partial');
    expect(cfg.placeholder_defaults.map((e) => e.file)).toEqual(['src/main/resources/application.yml:2', 'src/main/resources/application.yml:3']);
  });

  it('test resources and test profiles are never evidence (H2 / localhost / literal test password)', async () => {
    const { tf01, cfg } = await run({
      'pom.xml': POM,
      'src/main/resources/application.yml': APP_YML_PLACEHOLDERS,
      'src/test/resources/application.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://10.9.9.9:5432/test\n    password: testpass\n',
      'src/main/resources/application-test.yml': 'spring:\n  datasource:\n    password: testpass\n',
    });
    expect(cfg.hard_coded).toEqual([]);
    expect(tf01.severity).toBe('positive');
  });
});

describe('#3424 AC3: Node keeps the pre-#3424 behaviour', () => {
  it('Node with .env.example: identical signal', async () => {
    const { tf01, factor } = await run({
      'package.json': JSON.stringify({ name: 'api', dependencies: { express: '4.0.0' } }),
      '.env.example': 'DATABASE_URL=\nPORT=3000\n',
      'src/main.ts': 'const port = process.env.PORT;\n',
    });
    expect(tf01).toEqual({
      id: 'TF-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: '.env.example present at .env.example. Runtime configuration externalised via environment variables. Factor III satisfied.',
      evidence: ['.env.example'],
      confidence: 'high',
    });
    expect(factor).toBe('pass');
  });

  it('Node in a subfolder (apps/api/.env.example) keeps the relative path', async () => {
    const { tf01 } = await run({
      'package.json': JSON.stringify({ name: 'mono' }),
      'apps/api/.env.example': 'X=1\n',
    });
    expect(tf01.evidence).toEqual(['apps/api/.env.example']);
    expect(tf01.severity).toBe('positive');
  });

  it('Node without .env.example but reading process.env is positive; NODE_ENV alone is not', async () => {
    const reads = await run({ 'package.json': '{"name":"api"}', 'src/db.ts': 'const url = process.env.DATABASE_URL;\n' });
    expect(reads.tf01.severity).toBe('positive');
    expect(reads.tf01.evidence).toEqual(['src/db.ts:1']);
    const nodeEnv = await run({ 'package.json': '{"name":"api"}', 'src/x.ts': 'if (process.env.NODE_ENV === "production") {}\n' });
    expect(nodeEnv.tf01.severity).toBe('medium');
  });
});

describe('#3424 AC4: unknown stack yields Medium "not determinable"', () => {
  it('no recognisable evidence: medium, confidence low, factor unknown', async () => {
    const { tf01, factor, cfg } = await run({ 'README.md': '# app\n', 'main.go': 'package main\n' });
    expect(tf01.severity).toBe('medium');
    expect(tf01.confidence).toBe('low');
    expect(factor).toBe('unknown');
    expect(tf01.derivation).toContain('not determinable');
    expect(tf01.derivation).not.toContain('Hard-coded config risk');
    expect(cfg.status).toBe('unknown');
    expect(cfg.stacks).toEqual([]);
  });

  it('Python os.environ and .NET AddEnvironmentVariables are recognised', async () => {
    const py = await run({ 'requirements.txt': 'fastapi\n', 'app/settings.py': 'import os\nDB = os.environ["DB_URL"]\n' });
    expect(py.tf01.severity).toBe('positive');
    expect(py.cfg.stacks).toEqual(['python']);
    const net = await run({
      'Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      'Api/appsettings.json': '{\n  "Logging": { "LogLevel": { "Default": "Information" } }\n}\n',
      'Api/Program.cs': 'builder.Configuration.AddEnvironmentVariables();\n',
    });
    expect(net.tf01.severity).toBe('positive');
    expect(net.cfg.stacks).toEqual(['dotnet']);
  });

  it('.NET connection string with an inline password is hard-coded', async () => {
    const net = await run({
      'Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      'Api/appsettings.json': '{\n  "ConnectionStrings": {\n    "Db": "Server=db;Database=app;User Id=sa;Password=Pa55word;"\n  }\n}\n',
    });
    expect(net.tf01.severity).toBe('high');
    expect(net.cfg.hard_coded[0]?.file).toBe('Api/appsettings.json:3');
    expect(net.tf01.derivation).not.toContain('Pa55word');
  });
});

describe('#3424 AC5: the cloud-native score no longer penalises Java apps for a missing .env.example', () => {
  it('Spring Boot / Helm: factor III counts as pass in twelve_factor_pass_rate', async () => {
    const { passRate, factor } = await run(SPRING_HELM);
    expect(factor).toBe('pass');
    // Checked: III pass, VIII pass (helm/), XI partial, IX fail (no Actuator):
    // 2 of 4. Before #3424 factor III was fail: 1 of 4 = 0.25.
    expect(passRate).toBe(0.5);
  });

  it('a Java service without recognisable evidence is unknown (excluded from the rate), not fail', async () => {
    const { factor, tf01 } = await run({ 'pom.xml': POM, 'src/main/java/App.java': 'class App {}\n' });
    expect(factor).toBe('unknown');
    expect(tf01.severity).toBe('medium');
  });
});

describe('#3424 helpers', () => {
  it('keyValueLines tracks YAML parents and line numbers', () => {
    const kv = keyValueLines('application.yml', 'spring:\n  datasource:\n    password: x # c\n  jpa:\n    open-in-view: false\n');
    expect(kv).toEqual([
      { key: 'spring.datasource.password', value: 'x', line: 3 },
      { key: 'spring.jpa.open-in-view', value: 'false', line: 5 },
    ]);
  });

  it('credentialLiteral ignores references, empties and non-credential keys', () => {
    expect(credentialLiteral('spring.datasource.password', '${DB_PASSWORD}')).toBeNull();
    expect(credentialLiteral('spring.datasource.password', '${DB_PASSWORD:}')).toBeNull();
    expect(credentialLiteral('jasypt.password', 'ENC(abc)')).toBeNull();
    expect(credentialLiteral('db.password', '""')).toBeNull();
    expect(credentialLiteral('security.oauth2.token-uri', 'https://idp/token')).toBeNull();
    expect(credentialLiteral('server.port', '8080')).toBeNull();
    expect(credentialLiteral('app.client-secret', 'abc')).toBe('literal value for app.client-secret');
  });
});
