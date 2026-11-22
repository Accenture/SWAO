// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4285 (absorbs #4289; Design 125 sections 5.7 and 8, ADR-0067 amendment
// 2026-11-09): the target pickers of the Application and the LZ Catalog
// Assessment preselect the set-up targets `assessment.landing_zone.targets`
// (app file first, then the workspace), resolved the way `swao assess`
// resolves them: a geography such as `azure:germany` becomes the region the
// catalogue names as its default (azure:germanywestcentral). The host injects
// the resolver (scaffold.resolveSetupLzTargets, the CLI resolver of
// commands/lz-target-config.ts), so both pickers and the CLI share one rule.
// Nothing is dropped silently: a set-up target the picker does not offer and a
// provider left without a region are named on screen.

/** A geography target resolved to its default region. */
export interface SetupLzResolvedTarget {
  requested: string;
  resolved: string;
  geography: string;
}

/** The set-up targets of an app as `provider:region` labels (geographies resolved). */
export interface SetupLzTargets {
  targets: string[];
  resolved: SetupLzResolvedTarget[];
  /** Where they came from, e.g. `app:assessment.landing_zone.targets`, `workspace:...`, `none`. */
  source: string;
}

export type ResolveSetupLzTargets = (workspacePath: string, appId: string) => SetupLzTargets;

const NONE: SetupLzTargets = { targets: [], resolved: [], source: 'none' };

/**
 * The set-up targets through the host resolver; without one (tests, older
 * hosts) the raw configured labels, which match a picker option only when they
 * name a region.
 */
export function setupLzTargetsFor(
  workspace: string | null,
  app: string,
  resolver: ResolveSetupLzTargets | undefined,
  rawConfigured: () => string[],
): SetupLzTargets {
  if (!workspace || !app) return NONE;
  try {
    if (resolver) return resolver(workspace, app);
    const targets = rawConfigured();
    return targets.length > 0 ? { targets, resolved: [], source: 'setup' } : NONE;
  } catch {
    return NONE;
  }
}

/** Where the set-up targets are stored, for the screen line. */
function sourceLabel(source: string): string {
  if (source.startsWith('app:')) return 'app .swao.yml';
  if (source.startsWith('workspace:')) return 'workspace .swao.yml';
  return '.swao.yml';
}

/** "Set-up targets (workspace .swao.yml): azure:germany -> azure:germanywestcentral, otc:eu-de"; null without targets. */
export function setupLzTargetsLine(s: SetupLzTargets): string | null {
  if (s.targets.length === 0) return null;
  const shown = s.targets.map((t) => {
    const r = s.resolved.find((x) => x.resolved === t);
    return r ? `${r.requested} -> ${t}` : t;
  });
  return `Set-up targets (${sourceLabel(s.source)}): ${shown.join(', ')}`;
}

/** Set-up targets of the selected providers that the picker does not offer (named, never dropped silently). */
export function setupTargetsNotOffered(s: SetupLzTargets, providers: readonly string[], offered: readonly string[]): string[] {
  return s.targets.filter((t) => providers.includes(t.split(':')[0]!) && !offered.includes(t));
}

/** Providers selected in the provider step that end without any region. */
export function providersWithoutRegion(providers: readonly string[], targets: readonly string[]): string[] {
  const withRegion = new Set(targets.map((t) => t.split(':')[0]!));
  return providers.filter((p) => !withRegion.has(p));
}

/** The notice before a run that leaves selected providers out. */
export function providersWithoutRegionNotice(providers: readonly string[]): string {
  return `${providers.join(', ')} ${providers.length === 1 ? 'was' : 'were'} selected but no region was chosen; ${providers.length === 1 ? 'it is' : 'they are'} not assessed in this run.`;
}
