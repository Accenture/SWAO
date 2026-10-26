// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- landing-zone fit summary (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Shared landing-zone fit classifier so the publication extractor and the
 * portfolio summary count per-region blockers identically (#3402). Vocabulary
 * matches the extractor (extractor.ts lzCatCheckResult): SUPPORTED is a pass,
 * AVAILABLE_NOT_ENABLED is not applicable, everything else is a blocker.
 */
export function lzCatCheckResult(verdict: string): 'pass' | 'fail' | 'not_applicable' {
  if (verdict === 'SUPPORTED') return 'pass';
  if (verdict === 'AVAILABLE_NOT_ENABLED') return 'not_applicable';
  return 'fail';
}

/** Count the blocking items (verdict classified as fail) in a catalogue-fit
 *  region's `items` list. */
export function countLzFitBlockers(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return (items as Array<{ verdict?: unknown }>).filter(
    (i) => lzCatCheckResult(String(i?.verdict ?? '')) === 'fail',
  ).length;
}
