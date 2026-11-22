// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- LZ gap classification for the TUI
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Gap classification of one LZ target from its fit items (#2331), shared by
 * LzAssessmentScreen and AssessScreen. `policy` covers BLOCKED_BY_POLICY items
 * (Design 120 section 5.3, #3569): the service is offered but the tenant's
 * governance denies its use. Parts keep a fixed order: sovereignty,
 * availability, policy.
 */
export type LzGapType =
  | 'sovereignty'
  | 'availability'
  | 'policy'
  | 'sovereignty+availability'
  | 'sovereignty+policy'
  | 'availability+policy'
  | 'sovereignty+availability+policy'
  | 'other';

export function deriveLzGapType(items: ReadonlyArray<{ verdict?: string }>): LzGapType {
  const parts: string[] = [];
  if (items.some((i) => i.verdict === 'SOVEREIGNTY_GAP')) parts.push('sovereignty');
  if (items.some((i) => i.verdict === 'NOT_AVAILABLE_IN_REGION')) parts.push('availability');
  if (items.some((i) => i.verdict === 'BLOCKED_BY_POLICY')) parts.push('policy');
  return parts.length === 0 ? 'other' : (parts.join('+') as LzGapType);
}

/** Label suffix for a blocked target, e.g. "  BLOCKED (sovereignty + availability)"; empty for `other`. */
export function lzBlockedGapLabel(gapType: LzGapType): string {
  return gapType === 'other' ? '' : `  BLOCKED (${gapType.split('+').join(' + ')})`;
}
