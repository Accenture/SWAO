// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- LZ Catalog target preselection (#4198)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4198 (Design 125 section 5.7, owner decision 2026-11-09, ADR-0067
// amendment): the targets set up in `.swao.yml` (assessment.landing_zone.targets,
// resolved by resolveLzTargets as the CLI does) are preselected first. The
// last LZ Catalog run's targets are offered as a second choice when they
// differ. Without setup targets the last run's targets are preselected, as
// before. A run never writes its targets back (ADR-0067 decision 3).

export interface LzTargetPrefill {
  /** The targets preselected in the provider and region pickers. */
  preselected: string[];
  /** Where the preselection comes from. */
  source: 'setup' | 'last-run' | 'none';
  /** The last run's targets, offered as a second choice; set only when they differ from the setup targets. */
  alternative?: string[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

export function lzTargetPrefill(configured: readonly string[], lastRun: readonly string[]): LzTargetPrefill {
  if (configured.length > 0) {
    const out: LzTargetPrefill = { preselected: [...configured], source: 'setup' };
    if (lastRun.length > 0 && !sameSet(configured, lastRun)) out.alternative = [...lastRun];
    return out;
  }
  if (lastRun.length > 0) return { preselected: [...lastRun], source: 'last-run' };
  return { preselected: [], source: 'none' };
}

/** The phase after the credentials hub: the setup-or-last-run question only when the last run differs. */
export function lzPhaseAfterCredentials(p: LzTargetPrefill): 'input-lz-target-source' | 'input-lz-provider' {
  return p.alternative ? 'input-lz-target-source' : 'input-lz-provider';
}

/** The targets the pickers preselect for the user's choice (setup unless the last run was picked). */
export function lzTargetsForChoice(p: LzTargetPrefill, choice: 'setup' | 'last-run'): string[] {
  return choice === 'last-run' && p.alternative ? p.alternative : p.preselected;
}
