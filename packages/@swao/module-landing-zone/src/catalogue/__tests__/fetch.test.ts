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
import { parseLzCatalogue } from '@swao/core';
import { normalizeAwsSsmCatalogue, type SsmParameter } from '../fetch-aws.js';
import { normalizeAzureProducts, type AzureAvailabilityRow } from '../fetch-azure.js';
import { normalizeGcpProducts, type GcpProductsMatrix } from '../fetch-gcp.js';

describe('AWS SSM catalogue normaliser (#0565)', () => {
  const params: SsmParameter[] = [
    { Name: '/aws/service/global-infrastructure/regions/eu-central-1/services/s3', Value: 's3' },
    { Name: '/aws/service/global-infrastructure/regions/eu-central-1/services/ec2', Value: 'ec2' },
    { Name: '/aws/service/global-infrastructure/regions/us-east-1/services/s3', Value: 's3' },
    { Name: '/aws/service/global-infrastructure/services/s3', Value: 's3' }, // not a region-service path -> ignored
    { Name: 'garbage', Value: 'x' }, // ignored
  ];

  it('groups services by region, ignores non-region-service params, validates', () => {
    const cat = normalizeAwsSsmCatalogue(params, {
      lastUpdated: '2026-06-24',
      operator: 'test',
      overlay: {
        'eu-central-1': {
          display: 'Europe (Frankfurt)',
          country: 'DE',
          sovereignty: { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act'], certifications: ['C5'] },
        },
      },
    });
    expect(() => parseLzCatalogue(cat)).not.toThrow();
    expect(cat.meta.provider).toBe('aws');
    expect(cat.meta.source.mode).toBe('api');
    expect(cat.regions.map((r) => r.id)).toEqual(['eu-central-1', 'us-east-1']);
    const fra = cat.regions[0]!;
    expect(fra.services.map((s) => s.code)).toEqual(['ec2', 's3']); // sorted
    expect(fra.services[0]!.source).toBe('ssm');
    // sovereignty facts merged from the curated overlay (SSM gives availability only)
    expect(fra.sovereignty?.extraterritorial_exposure).toContain('us_cloud_act');
    // region with no overlay still appears (us-east-1), just without facts
    expect(cat.regions[1]!.sovereignty).toBeUndefined();
  });

  it('empty params -> empty catalogue (valid)', () => {
    const cat = normalizeAwsSsmCatalogue([], { lastUpdated: '2026-06-24' });
    expect(cat.regions).toHaveLength(0);
    expect(() => parseLzCatalogue(cat)).not.toThrow();
  });
});

describe('Azure products normaliser (#0565)', () => {
  const rows: AzureAvailabilityRow[] = [
    { region: 'germanywestcentral', service: 'Microsoft.Storage/storageAccounts', serviceName: 'Storage Accounts' },
    { region: 'germanywestcentral', service: 'Microsoft.Compute/virtualMachines', serviceName: 'Virtual Machines' },
    { region: 'westeurope', service: 'Microsoft.Storage/storageAccounts' },
  ];

  it('groups rows by region, keeps service display names, validates', () => {
    const cat = normalizeAzureProducts(rows, {
      lastUpdated: '2026-06-24',
      overlay: { germanywestcentral: { country: 'DE', sovereignty: { residency_country: 'DE', extraterritorial_exposure: ['us_cloud_act'], certifications: [] } } },
    });
    expect(() => parseLzCatalogue(cat)).not.toThrow();
    expect(cat.meta.provider).toBe('azure');
    expect(cat.regions.map((r) => r.id)).toEqual(['germanywestcentral', 'westeurope']);
    const gwc = cat.regions[0]!;
    expect(gwc.services[0]!.code).toBe('Microsoft.Compute/virtualMachines'); // sorted
    expect(gwc.services[0]!.name).toBe('Virtual Machines');
    expect(gwc.services[0]!.source).toBe('products-by-region');
  });
});

describe('GCP region-picker normaliser (#0870)', () => {
  const matrix: GcpProductsMatrix = {
    'Compute Engine': { 'europe-west3': true, 'us-east1': true, 'asia-east1': false },
    'Cloud SQL':      { 'europe-west3': true, 'us-east1': false },
    'Vertex AI':      { 'europe-west3': false, 'us-east1': true },
    'Unknown Product': { 'europe-west3': true },
  };

  it('inverts the matrix, maps fulfills, applies overlay, validates schema', () => {
    const cat = normalizeGcpProducts(matrix, {
      lastUpdated: '2026-07-07',
      overlay: {
        'europe-west3': {
          display: 'Frankfurt, Germany',
          country: 'DE',
          sovereignty: {
            residency_country: 'DE',
            operator_jurisdiction: 'US-entity',
            extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
            certifications: ['C5', 'ISO_27001', 'SOC_2'],
          },
        },
        'us-east1': {
          display: 'South Carolina, USA',
          country: 'US',
          sovereignty: {
            residency_country: 'US',
            operator_jurisdiction: 'US-entity',
            extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
            certifications: ['ISO_27001', 'SOC_2'],
          },
        },
      },
    });

    expect(() => parseLzCatalogue(cat)).not.toThrow();
    expect(cat.meta.provider).toBe('gcp');
    expect(cat.meta.source.mode).toBe('scrape');
    expect(cat.meta.source.tool).toBe('region-picker-github');
    expect(cat.meta.confidence).toBe('medium');

    // Only europe-west3 and us-east1 have available === true entries (asia-east1 has none).
    expect(cat.regions.map((r) => r.id)).toEqual(['europe-west3', 'us-east1']);

    const fra = cat.regions.find((r) => r.id === 'europe-west3')!;
    // europe-west3 has: Compute Engine, Cloud SQL, Unknown Product (true entries)
    // sorted alphabetically
    expect(fra.services.map((s) => s.code)).toEqual(['Cloud SQL', 'Compute Engine', 'Unknown Product']);
    expect(fra.services[0]!.source).toBe('region-picker-github');
    expect(fra.services[0]!.status).toBe('ga');
    // Cloud SQL fulfills postgresql + mysql
    expect(fra.services[0]!.fulfills).toContain('postgresql');
    expect(fra.services[0]!.fulfills).toContain('mysql');
    // Compute Engine fulfills vm_compute
    const computeEntry = fra.services.find((s) => s.code === 'Compute Engine')!;
    expect(computeEntry.fulfills).toContain('vm_compute');
    expect(computeEntry.key_custody).toContain('byok');
    // Unknown product has empty fulfills
    const unknownEntry = fra.services.find((s) => s.code === 'Unknown Product')!;
    expect(unknownEntry.fulfills).toHaveLength(0);
    expect(unknownEntry.key_custody).toEqual(['provider-managed']);

    // sovereignty facts from overlay
    expect(fra.sovereignty?.operator_jurisdiction).toBe('US-entity');
    expect(fra.sovereignty?.certifications).toContain('C5');

    // us-east1 has: Compute Engine (true), Vertex AI (true)
    const use1 = cat.regions.find((r) => r.id === 'us-east1')!;
    expect(use1.services.map((s) => s.code)).toEqual(['Compute Engine', 'Vertex AI']);
    const vertexEntry = use1.services.find((s) => s.code === 'Vertex AI')!;
    expect(vertexEntry.fulfills).toContain('managed_llm');
    expect(vertexEntry.fulfills).toContain('ml_training');
  });

  it('empty matrix -> empty catalogue (valid)', () => {
    const cat = normalizeGcpProducts({}, { lastUpdated: '2026-07-07' });
    expect(cat.regions).toHaveLength(0);
    expect(() => parseLzCatalogue(cat)).not.toThrow();
  });

  it('uses built-in overlay when no overlay supplied (europe-west3 gets C5)', () => {
    const minMatrix: GcpProductsMatrix = {
      'Cloud Storage': { 'europe-west3': true },
    };
    const cat = normalizeGcpProducts(minMatrix, { lastUpdated: '2026-07-07' });
    const fra = cat.regions.find((r) => r.id === 'europe-west3')!;
    expect(fra.sovereignty?.certifications).toContain('C5');
    expect(fra.sovereignty?.operator_jurisdiction).toBe('US-entity');
    expect(fra.sovereignty?.extraterritorial_exposure).toContain('us_cloud_act');
    expect(fra.country).toBe('DE');
  });
});
