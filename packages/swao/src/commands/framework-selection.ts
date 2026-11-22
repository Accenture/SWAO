// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4269: the framework selection of an app run, logged once at run start
// (`assess.frameworks.selected`) and recorded in run-context.yaml
// (`frameworks_selection`), so a reader can tell a run-time narrowing
// (`swao assess --regimes`, the TUI framework step, #4284) from the app
// default (`assessment.regimes_active` of the app, then the workspace).

export type FrameworkSelectionSource = 'app-default' | 'run-selection';

export interface FrameworkSelection {
  /** The app default: assessment.regimes_active (app file, then workspace). */
  default: string[];
  /** The frameworks this run evaluates. */
  chosen: string[];
  /** app-default when no run selection was given or it equals the default (as a set). */
  source: FrameworkSelectionSource;
}

export function frameworkSelection(defaultIds: readonly string[], runIds: readonly string[] | undefined): FrameworkSelection {
  const def = [...defaultIds];
  if (runIds === undefined) return { default: def, chosen: def, source: 'app-default' };
  const a = new Set(runIds);
  const b = new Set(defaultIds);
  const same = a.size === b.size && [...a].every((x) => b.has(x));
  return { default: def, chosen: [...runIds], source: same ? 'app-default' : 'run-selection' };
}

/** The console line of a run-time selection; null for the app default. */
export function frameworkSelectionLine(s: FrameworkSelection): string | null {
  if (s.source === 'app-default') return null;
  const chosen = s.chosen.length > 0 ? s.chosen.join(', ') : 'none';
  return `[info] Frameworks for this run: ${chosen} (${s.chosen.filter((c) => s.default.includes(c)).length} of ${s.default.length} app framework${s.default.length === 1 ? '' : 's'} chosen for this run; the app default stays ${s.default.length > 0 ? s.default.join(', ') : 'empty'})`;
}

/** #4400 (Design 103 section 7): the framework every service run evaluates. */
export const SERVICE_BASELINE_FRAMEWORK = 'SWAO_APM';

/**
 * #4400: the frameworks of a run. For a service run (`type` service) SWAO_APM
 * is always evaluated, and a run selection (`--regimes`, the TUI framework step)
 * ADDS to the app default instead of replacing it (owner decision 2026-11-15:
 * SWAO_APM, then the app default, then the added frameworks, without
 * duplicates). Without a selection the app default applies, with SWAO_APM in
 * front when it lacks it; undefined when the app default already has it.
 * An application run keeps the #4284 rule: `--regimes` replaces the default.
 */
export function serviceRunRegimes(type: string | undefined, runIds: readonly string[] | undefined, defaultIds: readonly string[]): string[] | undefined {
  if (type !== 'service') return runIds as string[] | undefined;
  if (runIds === undefined) return defaultIds.includes(SERVICE_BASELINE_FRAMEWORK) ? undefined : [SERVICE_BASELINE_FRAMEWORK, ...defaultIds];
  return [...new Set([SERVICE_BASELINE_FRAMEWORK, ...defaultIds, ...runIds])];
}

/** #4400: true when a service run gets SWAO_APM although neither the selection nor the app default lists it. */
export function serviceBaselineAdded(type: string | undefined, runIds: readonly string[] | undefined, defaultIds: readonly string[]): boolean {
  return type === 'service' && ![...(runIds ?? []), ...defaultIds].includes(SERVICE_BASELINE_FRAMEWORK);
}

/**
 * #4400 (Design 103 section 7): the frameworks of a service run, SWAO_APM
 * first and fixed, then the added ones in the given order, without duplicates.
 */
export function serviceRunFrameworks(added: readonly string[] = []): string[] {
  return [...new Set([SERVICE_BASELINE_FRAMEWORK, ...added.map((r) => r.trim()).filter((r) => r !== '')])];
}
