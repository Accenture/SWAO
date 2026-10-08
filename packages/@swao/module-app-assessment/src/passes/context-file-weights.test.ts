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

// Unit tests for context-file-weights.ts (#2958).
// No I/O, no LLM. Pure unit tests.

import { describe, it, expect } from 'vitest';
import { getFileCategory, selectContextChunks, PASS_WEIGHTS, DEFAULT_WEIGHTS } from './context-file-weights.js';
import type { ScoredChunk } from './context-file-weights.js';

function makeChunk(opts: {
  relativePath: string;
  category?: string;
  charCount?: number;
  partNum?: number;
  totalParts?: number;
}): ScoredChunk {
  const charCount = opts.charCount ?? 1000;
  return {
    relativePath: opts.relativePath,
    partNum: opts.partNum ?? 1,
    totalParts: opts.totalParts ?? 1,
    content: 'x'.repeat(charCount),
    charCount,
    category: opts.category ?? getFileCategory(opts.relativePath),
  };
}

describe('getFileCategory (#2958)', () => {
  it('maps terraform/ to terraform', () => {
    expect(getFileCategory('terraform/prod.tfstate')).toBe('terraform');
  });

  it('maps architecture/ to architecture', () => {
    expect(getFileCategory('architecture/overview.md')).toBe('architecture');
  });

  it('maps design/ to architecture', () => {
    expect(getFileCategory('design/sequence.md')).toBe('architecture');
  });

  it('maps adr/ to architecture', () => {
    expect(getFileCategory('adr/0001-cloud-provider.md')).toBe('architecture');
  });

  it('maps compliance/ to compliance', () => {
    expect(getFileCategory('compliance/bsi-c5-gap.csv')).toBe('compliance');
  });

  it('maps workshops/ to workshops', () => {
    expect(getFileCategory('workshops/session-1.md')).toBe('workshops');
  });

  it('maps workshop/ to workshops', () => {
    expect(getFileCategory('workshop/notes.md')).toBe('workshops');
  });

  it('maps operations/ to operations', () => {
    expect(getFileCategory('operations/runbook.md')).toBe('operations');
  });

  it('maps ops/ to operations', () => {
    expect(getFileCategory('ops/monitoring.yaml')).toBe('operations');
  });

  it('maps intake/ to intake', () => {
    expect(getFileCategory('intake/kickoff-minutes.md')).toBe('intake');
  });

  it('maps discovery/ to intake', () => {
    expect(getFileCategory('discovery/requirements.md')).toBe('intake');
  });

  it('maps kickoff/ to intake', () => {
    expect(getFileCategory('kickoff/agenda.md')).toBe('intake');
  });

  it('maps structured/ to structured', () => {
    expect(getFileCategory('structured/cmdb-export.csv')).toBe('structured');
  });

  it('maps data/ to structured', () => {
    expect(getFileCategory('data/assets.csv')).toBe('structured');
  });

  it('maps exports/ to structured', () => {
    expect(getFileCategory('exports/report.csv')).toBe('structured');
  });

  it('root-level file defaults to docs', () => {
    expect(getFileCategory('README.md')).toBe('docs');
  });

  it('unknown first directory defaults to docs', () => {
    expect(getFileCategory('misc/notes.md')).toBe('docs');
  });

  it('is case-insensitive on first path component', () => {
    expect(getFileCategory('Terraform/prod.tfstate')).toBe('terraform');
    expect(getFileCategory('COMPLIANCE/audit.csv')).toBe('compliance');
  });
});

describe('selectContextChunks -- pass-04 category weighting (#2958)', () => {
  it('places architecture chunks before structured at equal charCount', () => {
    // 10 000-char budget; 3 structured (weight 0.6) + 3 architecture (weight 1.0)
    // totalling 6 000 chars each. Architecture should be included, structured excluded.
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'structured/export.csv', category: 'structured', charCount: 2000 }),
      makeChunk({ relativePath: 'structured/assets.csv', category: 'structured', charCount: 2000 }),
      makeChunk({ relativePath: 'structured/cmdb.csv',   category: 'structured', charCount: 2000 }),
      makeChunk({ relativePath: 'architecture/overview.md', category: 'architecture', charCount: 2000 }),
      makeChunk({ relativePath: 'architecture/adr-001.md',  category: 'architecture', charCount: 2000 }),
      makeChunk({ relativePath: 'architecture/design.md',   category: 'architecture', charCount: 2000 }),
    ];

    const { included, excluded } = selectContextChunks(chunks, 10_000, '04');

    const includedPaths = included.map(c => c.relativePath);
    expect(includedPaths).toContain('architecture/overview.md');
    expect(includedPaths).toContain('architecture/adr-001.md');
    expect(includedPaths).toContain('architecture/design.md');
    expect(excluded.some(c => c.category === 'structured')).toBe(true);
  });

  it('tiebreaks at equal weight by charCount asc (smaller file included first)', () => {
    // Two compliance chunks at weight 1.0; budget = 2000; sizes 1000 and 3000.
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'compliance/large.csv', category: 'compliance', charCount: 3000 }),
      makeChunk({ relativePath: 'compliance/small.csv', category: 'compliance', charCount: 1000 }),
    ];

    const { included, excluded } = selectContextChunks(chunks, 2_000, '04');

    expect(included).toHaveLength(1);
    expect(included[0].relativePath).toBe('compliance/small.csv');
    expect(excluded[0].relativePath).toBe('compliance/large.csv');
  });

  it('unlisted passId uses DEFAULT_WEIGHTS -- all categories equal, sorted by charCount asc', () => {
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'terraform/state.json', category: 'terraform', charCount: 500 }),
      makeChunk({ relativePath: 'architecture/doc.md',  category: 'architecture', charCount: 300 }),
      makeChunk({ relativePath: 'compliance/audit.csv', category: 'compliance', charCount: 800 }),
    ];

    const { included } = selectContextChunks(chunks, 10_000, '99');

    // All fit; order should be charCount asc (300, 500, 800)
    expect(included[0].charCount).toBe(300);
    expect(included[1].charCount).toBe(500);
    expect(included[2].charCount).toBe(800);
  });

  it('returns empty excluded when all chunks fit within budget', () => {
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'terraform/state.json', category: 'terraform', charCount: 1000 }),
      makeChunk({ relativePath: 'architecture/doc.md',  category: 'architecture', charCount: 1000 }),
    ];

    const { excluded } = selectContextChunks(chunks, 100_000, '04');

    expect(excluded).toHaveLength(0);
  });

  it('returns empty included and all excluded when budget is zero', () => {
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'architecture/doc.md', category: 'architecture', charCount: 100 }),
    ];

    const { included, excluded } = selectContextChunks(chunks, 0, '04');

    expect(included).toHaveLength(0);
    expect(excluded).toHaveLength(1);
  });
});

describe('selectContextChunks -- user multipliers (#2968)', () => {
  it('user multiplier reduces effective weight for a category', () => {
    // Pass-04 terraform default = 0.7; user multiplier = 0.5 -> effective 0.35
    // Pass-04 docs default = 0.8; docs should rank above terraform at 0.35
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'terraform/big.json', category: 'terraform', charCount: 500 }),
      makeChunk({ relativePath: 'docs/notes.md',       category: 'docs',      charCount: 600 }),
    ];

    const { included } = selectContextChunks(chunks, 600, '04', { terraform: 0.5 });

    // Only docs fits (600 chars); terraform is deprioritised by the multiplier
    expect(included).toHaveLength(1);
    expect(included[0].relativePath).toBe('docs/notes.md');
  });

  it('user multiplier of 0.0 hard-excludes a category', () => {
    const chunks: ScoredChunk[] = [
      makeChunk({ relativePath: 'structured/export.csv', category: 'structured', charCount: 100 }),
      makeChunk({ relativePath: 'architecture/doc.md',   category: 'architecture', charCount: 100 }),
    ];

    const { included, excluded } = selectContextChunks(chunks, 10_000, '04', { structured: 0.0 });

    expect(included.map(c => c.relativePath)).not.toContain('structured/export.csv');
    expect(excluded.map(c => c.relativePath)).toContain('structured/export.csv');
    expect(included.map(c => c.relativePath)).toContain('architecture/doc.md');
  });

  it('PASS_WEIGHTS and DEFAULT_WEIGHTS are exported constants', () => {
    expect(PASS_WEIGHTS['04']).toBeDefined();
    expect(PASS_WEIGHTS['04']['architecture']).toBe(1.0);
    expect(PASS_WEIGHTS['04']['terraform']).toBe(0.7);
    expect(PASS_WEIGHTS['04']['structured']).toBe(0.6);
    expect(DEFAULT_WEIGHTS['terraform']).toBe(1.0);
  });
});
