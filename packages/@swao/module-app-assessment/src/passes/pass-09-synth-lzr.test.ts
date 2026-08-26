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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump } from 'js-yaml';
import { readLzrVerdict, applyLzrAdjustment } from './pass-09-synth.js';

// ---------------------------------------------------------------------------
// Test workspace helpers
// ---------------------------------------------------------------------------

const TEMP_DIR = join(tmpdir(), `synth-lzr-test-${process.pid}`);
const PASSES_DIR = join(TEMP_DIR, 'wsp', 'passes');

function writeLzrFile(
  verdict: 'ready' | 'blocked' | 'advisory',
  opts: {
    landing_zone_id?: string;
    blockers?: Array<{ check_id: string; description: string; remediation: string; evidence: string[]; category: string; blocks_migration: boolean }>;
  } = {},
): void {
  const content = {
    pass: { id: 23, name: 'lzr', signal_prefix: 'LZR', status: 'complete', iter: 1 },
    signals: [],
    assessment: { overall_verdict: verdict },
    lzrResult: {
      provider_id: 'stackit_de_sovereign',
      landing_zone_id: opts.landing_zone_id ?? 'lz-stackit-de-01',
      assessed_at: '2026-04-28',
      ingestion_strategy: 'terraform',
      blockers: opts.blockers ?? [],
      warnings: [],
      service_checks: [],
      quota_checks: [],
      policy_checks: [],
      network_checks: [],
      overall_verdict: verdict,
    },
  };
  writeFileSync(join(PASSES_DIR, '23-lzr.yaml'), dump(content, { lineWidth: 120 }));
}

beforeEach(() => {
  mkdirSync(PASSES_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readLzrVerdict
// ---------------------------------------------------------------------------

describe('readLzrVerdict -- file absent', () => {
  it('returns verdict=null when 23-lzr.yaml does not exist', () => {
    const result = readLzrVerdict(TEMP_DIR);
    expect(result.verdict).toBeNull();
  });
});

describe('readLzrVerdict -- file present', () => {
  it('reads ready verdict correctly', () => {
    writeLzrFile('ready');
    const result = readLzrVerdict(TEMP_DIR);
    expect(result.verdict).toBe('ready');
    expect(result.landing_zone_id).toBe('lz-stackit-de-01');
  });

  it('reads blocked verdict and first blocker', () => {
    writeLzrFile('blocked', {
      landing_zone_id: 'lz-ghostfolio-prod',
      blockers: [{
        check_id: 'LZR-01',
        description: 'Managed PostgreSQL not found in Terraform state',
        remediation: 'Add a managed PostgreSQL resource',
        evidence: ['stackit_postgresql not found'],
        category: 'service',
        blocks_migration: true,
      }],
    });
    const result = readLzrVerdict(TEMP_DIR);
    expect(result.verdict).toBe('blocked');
    expect(result.landing_zone_id).toBe('lz-ghostfolio-prod');
    expect(result.first_blocker_id).toBe('LZR-01');
    expect(result.first_blocker_description).toContain('PostgreSQL');
  });

  it('reads advisory verdict', () => {
    writeLzrFile('advisory');
    const result = readLzrVerdict(TEMP_DIR);
    expect(result.verdict).toBe('advisory');
  });
});

// ---------------------------------------------------------------------------
// applyLzrAdjustment -- not_assessed
// ---------------------------------------------------------------------------

describe('applyLzrAdjustment -- not_assessed (no LZR data)', () => {
  const noInfo = { verdict: null as null, landing_zone_id: null, first_blocker_description: null, first_blocker_id: null };

  it('returns verdict: not_assessed', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Replatform', noInfo);
    expect(lzrAdjustment.verdict).toBe('not_assessed');
  });

  it('does not change the 7R label', () => {
    const { adjustedLabel } = applyLzrAdjustment('Replatform', noInfo);
    expect(adjustedLabel).toBe('Replatform');
  });

  it('no score_delta or affected_Rs on not_assessed', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Retain', noInfo);
    expect(lzrAdjustment.score_delta).toBeUndefined();
    expect(lzrAdjustment.affected_Rs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyLzrAdjustment -- ready
// ---------------------------------------------------------------------------

describe('applyLzrAdjustment -- ready verdict', () => {
  const readyInfo = { verdict: 'ready' as const, landing_zone_id: 'lz-x', first_blocker_description: null, first_blocker_id: null };

  it('ready + Rehost: no label change', () => {
    const { adjustedLabel } = applyLzrAdjustment('Rehost', readyInfo);
    expect(adjustedLabel).toBe('Rehost');
  });

  it('ready + Replatform: verdict is ready', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Replatform', readyInfo);
    expect(lzrAdjustment.verdict).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// applyLzrAdjustment -- blocked
// ---------------------------------------------------------------------------

describe('applyLzrAdjustment -- blocked verdict', () => {
  const blockedInfo = {
    verdict: 'blocked' as const,
    landing_zone_id: 'lz-ghostfolio-prod',
    first_blocker_id: 'LZR-01',
    first_blocker_description: 'Managed PostgreSQL not found in Terraform state',
  };

  it('blocked + Rehost: label changed to Retain', () => {
    const { adjustedLabel } = applyLzrAdjustment('Rehost', blockedInfo);
    expect(adjustedLabel).toBe('Retain');
  });

  it('blocked + Replatform: label changed to Retain', () => {
    const { adjustedLabel } = applyLzrAdjustment('Replatform', blockedInfo);
    expect(adjustedLabel).toBe('Retain');
  });

  it('blocked + Rehost: score_delta rehost=-1.0', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Rehost', blockedInfo);
    expect(lzrAdjustment.score_delta?.['rehost']).toBe(-1.0);
  });

  it('blocked + Replatform: score_delta replatform=-1.0', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Replatform', blockedInfo);
    expect(lzrAdjustment.score_delta?.['replatform']).toBe(-1.0);
  });

  it('blocked + Rehost: score_delta retain=0.15 (boost)', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Rehost', blockedInfo);
    expect(lzrAdjustment.score_delta?.['retain']).toBe(0.15);
  });

  it('blocked + Rehost: note contains landing_zone_id', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Rehost', blockedInfo);
    expect(lzrAdjustment.note).toContain('lz-ghostfolio-prod');
  });

  it('blocked + Rehost: note contains blocker check_id', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Rehost', blockedInfo);
    expect(lzrAdjustment.note).toContain('LZR-01');
  });

  it('blocked + Retain: label stays Retain, score_delta retain=0.15', () => {
    const { adjustedLabel, lzrAdjustment } = applyLzrAdjustment('Retain', blockedInfo);
    expect(adjustedLabel).toBe('Retain');
    expect(lzrAdjustment.score_delta?.['retain']).toBe(0.15);
  });

  it('blocked + Refactor: label unchanged, empty affected_Rs', () => {
    const { adjustedLabel, lzrAdjustment } = applyLzrAdjustment('Refactor', blockedInfo);
    expect(adjustedLabel).toBe('Refactor');
    expect(lzrAdjustment.affected_Rs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyLzrAdjustment -- advisory
// ---------------------------------------------------------------------------

describe('applyLzrAdjustment -- advisory verdict', () => {
  const advisoryInfo = {
    verdict: 'advisory' as const,
    landing_zone_id: 'lz-stackit-de-01',
    first_blocker_id: null,
    first_blocker_description: null,
  };

  it('advisory + Rehost: label unchanged', () => {
    const { adjustedLabel } = applyLzrAdjustment('Rehost', advisoryInfo);
    expect(adjustedLabel).toBe('Rehost');
  });

  it('advisory + Replatform: score_delta=-0.15', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Replatform', advisoryInfo);
    expect(lzrAdjustment.score_delta?.['replatform']).toBe(-0.15);
  });

  it('advisory + Retain: not affected, empty affected_Rs', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Retain', advisoryInfo);
    expect(lzrAdjustment.affected_Rs).toHaveLength(0);
  });

  it('advisory + Rehost: note mentions advisory warning', () => {
    const { lzrAdjustment } = applyLzrAdjustment('Rehost', advisoryInfo);
    expect(lzrAdjustment.note).toContain('advisory');
  });
});
