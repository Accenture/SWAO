// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3430: the service footprint (Pass 01 service_dep signals with provenance)
// is checked against the bundled landing-zone catalogues.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveConstraints, type Signal } from '@swao/core';
import { assembleLzCatalogWsp } from '../run-lz.js';
import { detectCoverageGap, toLzRequiredServices, type LzFitReport } from '../lz-fit.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function sig(id: string, caps: string[], confidence: Signal['confidence'], evidence: string[]): Signal {
  return {
    id, source: 'static_analysis', category: 'infrastructure_platform', severity: 'informational',
    derivation: 'Service footprint', evidence, confidence, implies: caps.map((c) => `service_dep:${c}`),
  };
}

// Footprint signals as Pass 01 emits them for a Spring Boot service on
// Kubernetes with MariaDB, Kafka and S3; KMS only named in an architecture document.
const FOOTPRINT: Signal[] = [
  sig('INV-10', ['kubernetes'], 'high', ['deploy/k8s/app.yaml']),
  sig('INV-11', ['load_balancer'], 'high', ['deploy/k8s/app.yaml']),
  sig('INV-12', ['block_storage'], 'high', ['deploy/k8s/app.yaml']),
  sig('INV-13', ['mariadb'], 'high', ['pom.xml', 'deploy/k8s/app.yaml']),
  sig('INV-14', ['kafka'], 'high', ['pom.xml']),
  sig('INV-15', ['object_storage'], 'high', ['pom.xml']),
  sig('INV-16', ['key_vault'], 'low', ['key_vault: wsp/inputs/architecture/overview.md']),
];

function fit(provider: string, regionId: string, frameworks = false): LzFitReport {
  const ws = mkdtempSync(join(tmpdir(), 'swao-footprint-fit-'));
  dirs.push(ws);
  const res = assembleLzCatalogWsp({
    workspacePath: ws,
    provider,
    regionId,
    requiredServices: toLzRequiredServices(deriveConstraints(FOOTPRINT).requiredServices),
    frameworkDecls: frameworks ? [{ id: 'GDPR', sovereignty_requirements: { required_services: ['key_vault'] } }] : [],
    assessedAt: '2026-10-24',
  });
  if (!res.ok) throw new Error(res.error);
  return res.wsp.lz as LzFitReport;
}

describe('service footprint against the landing-zone catalogues (#3430)', () => {
  it('STACKIT eu01 reports kafka as not available and lists it under services_not_in_catalogue', () => {
    const r = fit('stackit', 'eu01');
    const kafka = r.items.find((i) => i.service_code === 'kafka')!;
    expect(kafka.verdict).toBe('NOT_AVAILABLE_IN_REGION');
    expect(kafka.evidence).toEqual(['pom.xml']);
    expect(r.services_not_in_catalogue).toEqual(['kafka']);
    for (const code of ['kubernetes', 'mariadb', 'object_storage', 'key_vault', 'load_balancer', 'block_storage']) {
      expect(r.items.find((i) => i.service_code === code)!.verdict, code).toBe('SUPPORTED');
    }
    expect(r.overall).toBe('BLOCKED');
  });

  it('the footprint covers compute, network, kms and storage: assessment_mode full, no coverage warning', () => {
    const r = fit('stackit', 'eu01');
    expect(r.assessment_mode).toBe('full');
    expect(r.coverage_warning).toBeUndefined();
  });

  it('AWS eu-central-1 offers Kafka (MSK fulfils kafka) and block storage (EBS)', () => {
    const r = fit('aws', 'eu-central-1');
    expect(r.items.find((i) => i.service_code === 'kafka')!.verdict).toBe('SUPPORTED');
    expect(r.services_not_in_catalogue).toBeUndefined();
  });

  it('a documentation-only requirement keeps low confidence and its document evidence', () => {
    const r = fit('stackit', 'eu01');
    const kms = r.items.find((i) => i.service_code === 'key_vault')!;
    expect(kms.confidence).toBe('low');
    expect(kms.evidence).toEqual(['wsp/inputs/architecture/overview.md']);
  });

  it('a framework-mandated service is no longer low confidence when the footprint names it from documents only', () => {
    const r = fit('stackit', 'eu01', true);
    const kms = r.items.filter((i) => i.service_code === 'key_vault');
    expect(kms).toHaveLength(1);
    expect(kms[0]!.confidence).toBeUndefined();
    expect(kms[0]!.label).toBe('key_vault (framework-mandated)');
  });

  it('LZ gap signals carry the requirement evidence', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-footprint-fit-'));
    dirs.push(ws);
    const res = assembleLzCatalogWsp({
      workspacePath: ws, provider: 'stackit', regionId: 'eu01', assessedAt: '2026-10-24',
      requiredServices: toLzRequiredServices(deriveConstraints(FOOTPRINT).requiredServices),
    });
    if (!res.ok) throw new Error(res.error);
    const gap = res.wsp.signals.find((s) => s.derivation.startsWith('kafka:'))!;
    expect(gap.evidence).toEqual(['pom.xml']);
  });

  it('load_balancer satisfies the network baseline (the old pattern only knew load-balancer)', () => {
    const w = detectCoverageGap([{ code: 'kubernetes' }, { code: 'load_balancer' }, { code: 'key_vault' }, { code: 'object_storage' }]);
    expect(w).toBeUndefined();
  });
});
