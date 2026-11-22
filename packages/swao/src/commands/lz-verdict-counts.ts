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

// #4274: per-verdict counts of an LZ Catalog Assessment. The portfolio-scope
// lz.assessment.complete event counted every verdict other than READY as
// blocked (two NEEDS_VERIFICATION targets logged blocked 2). Both completion
// events (app and portfolio scope) now carry the same summary: the overall
// verdict, one count per verdict, and the per-target verdicts.

export const LZ_FIT_VERDICTS = ['READY', 'ADVISORY', 'NEEDS_VERIFICATION', 'BLOCKED', 'SOVEREIGNTY_BLOCKED'] as const;
export type LzFitVerdict = (typeof LZ_FIT_VERDICTS)[number];

export interface LzVerdictCounts {
  ready: number;
  advisory: number;
  needs_verification: number;
  blocked: number;
  sovereignty_blocked: number;
  /** Verdict strings outside the known set (never folded into blocked). */
  other: number;
}

function isLzFitVerdict(v: string): v is LzFitVerdict {
  return (LZ_FIT_VERDICTS as readonly string[]).includes(v);
}

export function countLzVerdicts(verdicts: readonly string[]): LzVerdictCounts {
  const c: LzVerdictCounts = { ready: 0, advisory: 0, needs_verification: 0, blocked: 0, sovereignty_blocked: 0, other: 0 };
  for (const v of verdicts) {
    if (!isLzFitVerdict(v)) { c.other += 1; continue; }
    switch (v) {
      case 'READY': c.ready += 1; break;
      case 'ADVISORY': c.advisory += 1; break;
      case 'NEEDS_VERIFICATION': c.needs_verification += 1; break;
      case 'BLOCKED': c.blocked += 1; break;
      case 'SOVEREIGNTY_BLOCKED': c.sovereignty_blocked += 1; break;
      default: { const never: never = v; throw new Error(`unhandled LZ verdict ${String(never)}`); }
    }
  }
  return c;
}

export interface LzCompletionSummary extends LzVerdictCounts {
  overall_verdict: string;
  targets: Array<{ target: string; verdict: string; gaps: number }>;
}

/** The shared summary fields of both lz.assessment.complete events of one run. */
export function lzCompletionSummary(
  overallVerdict: string,
  results: ReadonlyArray<{ provider: string; region: string; overall: string; signals: number }>,
): LzCompletionSummary {
  return {
    overall_verdict: overallVerdict,
    ...countLzVerdicts(results.map((r) => r.overall)),
    targets: results.map((r) => ({ target: `${r.provider}:${r.region}`, verdict: r.overall, gaps: r.signals })),
  };
}
