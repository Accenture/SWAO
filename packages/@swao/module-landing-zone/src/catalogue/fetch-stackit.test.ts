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

import { describe, it, expect } from 'vitest';
import {
  normalizeStackitSkus,
  slugifyProductName,
  STACKIT_SERVICE_FULFILLS,
  STACKIT_REGION_OVERLAY,
  type StackitSku,
} from './fetch-stackit.js';

// ---------------------------------------------------------------------------
// Minimal test fixtures (no licence required -- pure function tests)
// ---------------------------------------------------------------------------

const LAST_UPDATED = '2026-07-07';

function sku(product: string, region: string, deprecated = 'No', mms = 'ga'): StackitSku {
  return { product, region, deprecated, maturityModelState: mms };
}

describe('slugifyProductName', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyProductName('Kubernetes Engine')).toBe('kubernetes-engine');
  });

  it('collapses consecutive non-alphanumeric chars into a single hyphen', () => {
    expect(slugifyProductName('AI Model Serving')).toBe('ai-model-serving');
  });

  it('handles already-hyphenated names', () => {
    expect(slugifyProductName('PostgreSQL Flex')).toBe('postgresql-flex');
  });

  it('removes leading/trailing hyphens', () => {
    expect(slugifyProductName(' Test ')).toBe('test');
  });
});

describe('normalizeStackitSkus -- filtering', () => {
  it('excludes SKUs with deprecated === Yes', () => {
    const skus = [
      sku('Object Storage', 'eu01'),
      sku('OldService', 'eu01', 'Yes'),
    ];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    expect(eu01.services.map((s) => s.code)).toContain('object-storage');
    expect(eu01.services.map((s) => s.name)).not.toContain('OldService');
  });

  it('excludes SKUs with maturityModelState === deprecated', () => {
    const skus = [
      sku('Object Storage', 'eu01'),
      sku('Legacy', 'eu01', 'No', 'deprecated'),
    ];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    expect(eu01.services.map((s) => s.name)).not.toContain('Legacy');
  });

  it('includes beta SKUs as preview status', () => {
    const skus = [sku('Workflows', 'eu01', 'No', 'beta')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    const svc = eu01.services.find((s) => s.code === 'workflows');
    expect(svc).toBeDefined();
    expect(svc?.status).toBe('preview');
  });
});

describe('normalizeStackitSkus -- global expansion', () => {
  it('expands global region to both eu01 and eu02', () => {
    const skus = [sku('CDN', 'global')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    const eu02 = cat.regions.find((r) => r.id === 'eu02')!;
    expect(eu01.services.some((s) => s.code === 'cdn')).toBe(true);
    expect(eu02.services.some((s) => s.code === 'cdn')).toBe(true);
  });

  it('deduplicates a product that appears in both eu01 and global', () => {
    const skus = [
      sku('DNS', 'eu01'),
      sku('DNS', 'global'),
    ];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    const dnsSvcs = eu01.services.filter((s) => s.code === 'dns');
    expect(dnsSvcs).toHaveLength(1);
  });

  it('ga status beats beta for same product in same region', () => {
    const skus = [
      sku('PostgreSQL Flex', 'eu01', 'No', 'beta'),
      sku('PostgreSQL Flex', 'eu01', 'No', 'ga'),
    ];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const svc = cat.regions.find((r) => r.id === 'eu01')!.services.find((s) => s.code === 'postgresql-flex');
    expect(svc?.status).toBe('ga');
  });

  it('eu02-only service does not appear in eu01', () => {
    const skus = [sku('Application Load Balancer', 'eu02')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    expect(eu01.services.some((s) => s.code === 'application-load-balancer')).toBe(false);
  });
});

describe('normalizeStackitSkus -- fulfills mapping', () => {
  it('maps Kubernetes Engine to kubernetes capability', () => {
    const skus = [sku('Kubernetes Engine', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const svc = cat.regions.find((r) => r.id === 'eu01')!.services.find((s) => s.code === 'kubernetes-engine');
    expect(svc?.fulfills).toContain('kubernetes');
  });

  it('maps PostgreSQL Flex to postgresql', () => {
    const skus = [sku('PostgreSQL Flex', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const svc = cat.regions.find((r) => r.id === 'eu01')!.services.find((s) => s.code === 'postgresql-flex');
    expect(svc?.fulfills).toContain('postgresql');
  });

  it('maps Object Storage to object_storage', () => {
    const skus = [sku('Object Storage', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const svc = cat.regions.find((r) => r.id === 'eu01')!.services.find((s) => s.code === 'object-storage');
    expect(svc?.fulfills).toContain('object_storage');
  });

  it('maps KMS to key_vault', () => {
    const skus = [sku('KMS', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const svc = cat.regions.find((r) => r.id === 'eu01')!.services.find((s) => s.code === 'kms');
    expect(svc?.fulfills).toContain('key_vault');
    expect(svc?.key_custody).toContain('hyok');
  });

  it('unknown products get empty fulfills', () => {
    const skus = [sku('Some Unknown Service', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const svc = cat.regions.find((r) => r.id === 'eu01')!.services.find((s) => s.name === 'Some Unknown Service');
    expect(svc?.fulfills).toEqual([]);
  });
});

describe('normalizeStackitSkus -- sovereignty overlay', () => {
  it('eu01 carries BSI_C5 and ISO_27001 certifications', () => {
    const skus = [sku('Server', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    expect(eu01.sovereignty?.certifications).toContain('BSI_C5');
    expect(eu01.sovereignty?.certifications).toContain('ISO_27001');
    expect(eu01.sovereignty?.operator_jurisdiction).toBe('EU-entity');
    expect(eu01.sovereignty?.extraterritorial_exposure).toEqual([]);
  });

  it('eu02 carries ISO_27001 but NOT BSI_C5', () => {
    const skus = [sku('Server', 'eu02')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    const eu02 = cat.regions.find((r) => r.id === 'eu02')!;
    expect(eu02.sovereignty?.certifications).toContain('ISO_27001');
    expect(eu02.sovereignty?.certifications).not.toContain('BSI_C5');
    expect(eu02.sovereignty?.operator_jurisdiction).toBe('EU-entity');
    expect(eu02.sovereignty?.extraterritorial_exposure).toEqual([]);
  });

  it('eu01 residency_country is DE', () => {
    const skus = [sku('Server', 'eu01')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    expect(cat.regions.find((r) => r.id === 'eu01')?.sovereignty?.residency_country).toBe('DE');
  });

  it('eu02 residency_country is AT', () => {
    const skus = [sku('Server', 'eu02')];
    const cat = normalizeStackitSkus(skus, { lastUpdated: LAST_UPDATED });
    expect(cat.regions.find((r) => r.id === 'eu02')?.sovereignty?.residency_country).toBe('AT');
  });
});

describe('normalizeStackitSkus -- catalogue meta', () => {
  it('produces meta with correct provider, confidence, and source mode', () => {
    const cat = normalizeStackitSkus([], { lastUpdated: LAST_UPDATED });
    expect(cat.meta.provider).toBe('stackit');
    expect(cat.meta.confidence).toBe('medium');
    expect(cat.meta.source.mode).toBe('pim-api-stackit');
    expect(cat.meta.source.source_note).toMatch(/not publicly contracted/);
  });

  it('sets last_updated from opts', () => {
    const cat = normalizeStackitSkus([], { lastUpdated: '2026-01-15' });
    expect(cat.meta.last_updated).toBe('2026-01-15');
  });

  it('always emits both eu01 and eu02 regions (even if empty)', () => {
    const cat = normalizeStackitSkus([], { lastUpdated: LAST_UPDATED });
    expect(cat.regions.map((r) => r.id)).toEqual(['eu01', 'eu02']);
  });
});

describe('STACKIT_SERVICE_FULFILLS coverage', () => {
  it('covers at least 40 known STACKIT products', () => {
    expect(Object.keys(STACKIT_SERVICE_FULFILLS).length).toBeGreaterThanOrEqual(40);
  });
});

describe('STACKIT_REGION_OVERLAY', () => {
  it('defines both eu01 and eu02', () => {
    expect(Object.keys(STACKIT_REGION_OVERLAY)).toContain('eu01');
    expect(Object.keys(STACKIT_REGION_OVERLAY)).toContain('eu02');
  });
});
