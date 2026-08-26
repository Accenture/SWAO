// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Tests for the data-migration feasibility computation (#0060 sprint-038).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeDataMigrationFeasibility } from '@swao/module-app-assessment';

describe('computeDataMigrationFeasibility (#0060)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-datamig-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeYml(body: string) {
    writeFileSync(join(tmp, '.swao.yml'), body, 'utf-8');
  }

  it('returns undefined when .swao.yml is absent', () => {
    expect(computeDataMigrationFeasibility(tmp)).toBeUndefined();
  });

  it('returns undefined when migration block is absent', () => {
    writeYml('engagement: test\n');
    expect(computeDataMigrationFeasibility(tmp)).toBeUndefined();
  });

  it('returns undefined when total_storage_gb_override is missing', () => {
    writeYml('migration:\n  rto_hours_override: 4\n');
    expect(computeDataMigrationFeasibility(tmp)).toBeUndefined();
  });

  it('returns undefined when rto_hours_override is missing', () => {
    writeYml('migration:\n  total_storage_gb_override: 100\n');
    expect(computeDataMigrationFeasibility(tmp)).toBeUndefined();
  });

  it('verdict=feasible when transfer fits well within RTO', () => {
    // 50 GB at default 100 GB/hr = 0.5 hours << 4 hours * 0.6 = 2.4
    writeYml('migration:\n  total_storage_gb_override: 50\n  rto_hours_override: 4\n');
    const r = computeDataMigrationFeasibility(tmp);
    expect(r).toBeDefined();
    expect(r!.feasibility_verdict).toBe('feasible');
    expect(r!.estimated_transfer_hours).toBe(0.5);
    expect(r!.rto_hours).toBe(4);
    expect(r!.transfer_rate_gbph).toBe(100);
    expect(r!.storage_source).toBe('swao_yml_override');
  });

  it('verdict=marginal when transfer approaches RTO ceiling', () => {
    // 300 GB at 100 GB/hr = 3 hours; 4h * 0.6 = 2.4; 3 > 2.4 but <= 4
    writeYml('migration:\n  total_storage_gb_override: 300\n  rto_hours_override: 4\n');
    const r = computeDataMigrationFeasibility(tmp);
    expect(r!.feasibility_verdict).toBe('marginal');
    expect(r!.estimated_transfer_hours).toBe(3);
  });

  it('verdict=requires_phased_migration when transfer exceeds RTO (Medplum case)', () => {
    // Medplum: 828 GB at 100 GB/hr = 8.28 hours; RTO 4h
    writeYml('migration:\n  total_storage_gb_override: 828\n  rto_hours_override: 4\n');
    const r = computeDataMigrationFeasibility(tmp);
    expect(r!.feasibility_verdict).toBe('requires_phased_migration');
    expect(r!.estimated_transfer_hours).toBeCloseTo(8.28, 2);
    expect(r!.feasibility_note).toContain('exceeds RTO');
  });

  it('honours operator transfer-rate override (200 GB/hr)', () => {
    writeYml('migration:\n  total_storage_gb_override: 828\n  rto_hours_override: 8\n  transfer_rate_gbph: 200\n');
    const r = computeDataMigrationFeasibility(tmp);
    expect(r!.transfer_rate_gbph).toBe(200);
    expect(r!.estimated_transfer_hours).toBeCloseTo(4.14, 2);
    // 4.14 vs 8h * 0.6 = 4.8 -> feasible
    expect(r!.feasibility_verdict).toBe('feasible');
  });
});
