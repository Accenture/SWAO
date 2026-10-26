// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI and orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3430 end to end: Pass 01 service footprint -> deriveConstraints ->
// toLzRequiredServices -> landing-zone fit against the bundled STACKIT
// catalogue, the same chain assess.ts runs. Catches capability-code drift
// between controls/service-footprint-catalogue.yaml and swao/lz-catalogues/.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveConstraints, type PassContext } from '@swao/core';
import { runInvPass } from '@swao/module-app-assessment';
import { assembleLzCatalogWsp, toLzRequiredServices, type LzFitReport } from '@swao/module-landing-zone';

const POM = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example.idm</groupId><artifactId>idm</artifactId><version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.mariadb.jdbc</groupId><artifactId>mariadb-java-client</artifactId><version>3.4.1</version></dependency>
    <dependency><groupId>org.springframework.kafka</groupId><artifactId>spring-kafka</artifactId><version>3.2.4</version></dependency>
    <dependency><groupId>software.amazon.awssdk</groupId><artifactId>s3</artifactId><version>2.28.0</version></dependency>
  </dependencies>
</project>
`;

const K8S = `apiVersion: apps/v1
kind: Deployment
metadata: { name: idm }
spec:
  template:
    spec:
      containers: [{ name: app, image: registry.example.org/idm:1.0.0 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: idm }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data }
`;

let root = '';
function write(rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('service footprint to landing-zone fit (#3430)', () => {
  it('Maven + Kubernetes + docs: STACKIT eu01 lacks kafka, full assessment mode, KMS from documents only is low confidence', async () => {
    root = mkdtempSync(join(tmpdir(), 'swao-3430-e2e-'));
    write('src/pom.xml', POM);
    write('src/deploy/k8s/app.yaml', K8S);
    write('ws/wsp/inputs/architecture/overview.md', '# Architecture\n\nKeys are held in the platform KMS.\n');
    const ctx: PassContext = { appId: 'idm', iter: 1, assessedAt: '2026-10-24', sourcePath: join(root, 'src'), workspacePath: join(root, 'ws'), passesDir: root };
    const inv = await runInvPass(ctx);

    const required = toLzRequiredServices(deriveConstraints(inv.signals).requiredServices);
    expect(required.map((r) => r.code).sort()).toEqual(['block_storage', 'kafka', 'key_vault', 'kubernetes', 'load_balancer', 'mariadb', 'object_storage']);

    const res = assembleLzCatalogWsp({ workspacePath: join(root, 'ws'), provider: 'stackit', regionId: 'eu01', requiredServices: required, assessedAt: '2026-10-24' });
    if (!res.ok) throw new Error(res.error);
    const fit = res.wsp.lz as LzFitReport;
    expect(fit.items.find((i) => i.service_code === 'kafka')!.verdict).toBe('NOT_AVAILABLE_IN_REGION');
    expect(fit.services_not_in_catalogue).toEqual(['kafka']);
    expect(fit.assessment_mode).toBe('full');
    expect(fit.items.find((i) => i.service_code === 'key_vault')!.confidence).toBe('low');
    for (const code of ['kubernetes', 'mariadb', 'object_storage', 'load_balancer', 'block_storage']) {
      expect(fit.items.find((i) => i.service_code === code)!.verdict, code).toBe('SUPPORTED');
    }
  });
});
