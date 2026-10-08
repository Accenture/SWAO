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

// Category-weight context selection for per-pass relevance scoring (#2958).
//
// Pure functions, no I/O. Importable by any pass in Phase 2 without
// pulling in filesystem dependencies.
//
// Design reference: docs/design/106-context-quality-per-pass-relevance.md

/** Chunk with category classification for weight-based budget selection. */
export interface ScoredChunk {
  relativePath: string;
  partNum: number;
  totalParts: number;
  content: string;
  charCount: number;
  category: string;
}

/**
 * Per-pass category weights for pass-04 (context_ingestion).
 *
 * Weights encode how much prompt budget each category deserves relative to
 * the others. 1.0 = full priority; lower values deprioritise relative to
 * categories at 1.0 when the budget is tight.
 *
 * Pass 04 weights fix the field bug where terraform .json files (tier-4 in
 * the old sort) were always the first to be dropped. Now they receive 0.7
 * (behind architecture/compliance/intake at 1.0 but ahead of structured at
 * 0.6). Small-file tiebreak further favours concise docs over large state files.
 *
 * Phase 2: add entries here when other LLM passes gain wsp/inputs/ context.
 */
export const PASS_WEIGHTS: Record<string, Record<string, number>> = {
  '04': {
    architecture: 1.0,  // Design docs -- core architectural signal
    compliance:   1.0,  // Compliance requirements -- critical for COMP pass
    intake:       1.0,  // Discovery/kickoff docs -- establish scope and constraints
    workshops:    0.9,  // Workshop outputs -- architecture decisions, risk register
    docs:         0.8,  // General documentation
    terraform:    0.7,  // Infrastructure config -- JSON is space-inefficient; large state files
    operations:   0.7,  // Runbooks, monitoring -- ops context
    structured:   0.6,  // CSV exports -- useful but high volume, lower density
  },
};

/** Fallback weights: all categories equal. Applied to passes not in PASS_WEIGHTS. */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  architecture: 1.0,
  compliance:   1.0,
  intake:       1.0,
  workshops:    1.0,
  docs:         1.0,
  operations:   1.0,
  structured:   1.0,
  terraform:    1.0,
};

/**
 * Classify a file by its first wsp/inputs/ path component.
 * Root-level files (no parent directory) default to 'docs'.
 */
export function getFileCategory(relativePath: string): string {
  const first = relativePath.split(/[/\\]/)[0].toLowerCase();
  if (first === 'terraform') return 'terraform';
  if (['architecture', 'design', 'adr'].includes(first)) return 'architecture';
  if (first === 'compliance') return 'compliance';
  if (['workshops', 'workshop'].includes(first)) return 'workshops';
  if (['operations', 'ops'].includes(first)) return 'operations';
  if (['intake', 'discovery', 'kickoff'].includes(first)) return 'intake';
  if (['structured', 'data', 'exports'].includes(first)) return 'structured';
  return 'docs';
}

/**
 * Select chunks that fit within budgetChars using category-weight ordering.
 *
 * Sort order:
 *   1. weight desc (higher-priority categories first)
 *   2. charCount asc (smaller files preferred at equal weight -- maximises
 *      distinct file count for a given budget)
 *   3. relativePath + partNum asc (deterministic)
 *
 * User multipliers (from .swao.yml context.categories) are applied as
 * multiplicative factors on top of the per-pass code defaults and clamped
 * to [0.0, 1.0].
 */
export function selectContextChunks(
  chunks: ScoredChunk[],
  budgetChars: number,
  passId: string,
  userMultipliers?: Record<string, number>,
): { included: ScoredChunk[]; excluded: ScoredChunk[] } {
  const baseWeights = PASS_WEIGHTS[passId] ?? DEFAULT_WEIGHTS;
  const weights: Record<string, number> = { ...baseWeights };

  if (userMultipliers) {
    for (const [cat, mult] of Object.entries(userMultipliers)) {
      if (cat in weights) {
        weights[cat] = Math.min(1.0, Math.max(0.0, weights[cat] * mult));
      }
    }
  }

  const scored = chunks.map(c => ({ ...c, weight: weights[c.category] ?? 1.0 }));

  scored.sort((a, b) =>
    b.weight !== a.weight ? b.weight - a.weight
    : a.charCount !== b.charCount ? a.charCount - b.charCount
    : a.relativePath.localeCompare(b.relativePath) || a.partNum - b.partNum,
  );

  let remaining = budgetChars;
  const included: ScoredChunk[] = [];
  const excluded: ScoredChunk[] = [];

  for (const c of scored) {
    if (c.weight === 0) {
      // Weight 0.0 = hard exclude regardless of remaining budget.
      excluded.push(c);
    } else if (c.charCount <= remaining) {
      included.push(c);
      remaining -= c.charCount;
    } else {
      excluded.push(c);
    }
  }

  return { included, excluded };
}
