// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// LZ catalogue target selection (#3281).
//
// One resolver for every place that needs the configured landing zone
// catalogue targets: `swao assess --type landing-zone-catalog`, the inline
// catalogue fit of an Application Assessment, run-context.yaml and the TUI
// pre-selection. Order (the first source that yields a target wins):
//
//   1. --lz-cat-targets "provider:region,..."                       (CLI)
//   2. --lz-provider/--lz-region (or --lz-cat-provider/--lz-cat-region);
//      a missing half is taken from the app, then the workspace config (CLI)
//   3. app .swao.yml        assessment.landing_zone.targets
//   4. app .swao.yml        assessment.lz_cat_targets (deprecated, #2755)
//   5. app .swao.yml        assessment.landing_zone.provider + region
//   6. workspace .swao.yml  the same three keys, in the same order
//
// The resolver does not validate provider or region ids: geography handling
// and the valid-region hint need the catalogues and live in
// @swao/module-landing-zone (resolveLzGeography) and the fit loop.

export interface LzTargetSpec {
  provider: string;
  region: string;
}

export type LzTargetSource =
  | 'cli:--lz-cat-targets'
  | 'cli:--lz-provider/--lz-region'
  | 'app:assessment.landing_zone.targets'
  | 'app:assessment.lz_cat_targets'
  | 'app:assessment.landing_zone.provider/region'
  | 'workspace:assessment.landing_zone.targets'
  | 'workspace:assessment.lz_cat_targets'
  | 'workspace:assessment.landing_zone.provider/region'
  | 'none';

export interface ResolvedLzTargets {
  targets: LzTargetSpec[];
  source: LzTargetSource;
}

export interface ResolveLzTargetsInput {
  /** Value of --lz-cat-targets. */
  cliTargets?: string;
  /** Value of --lz-provider (standalone) or --lz-cat-provider (inline fit). */
  cliProvider?: string;
  /** Value of --lz-region (standalone) or --lz-cat-region (inline fit). */
  cliRegion?: string;
  /** Parsed `assessment` block of the app .swao.yml. */
  appAssessment?: Record<string, unknown> | null;
  /** Parsed `assessment` block of the workspace .swao.yml. */
  workspaceAssessment?: Record<string, unknown> | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

/** Parse one `provider:region` string; undefined when it has no provider or region. */
export function parseLzTarget(raw: string): LzTargetSpec | undefined {
  const t = raw.trim();
  const colon = t.indexOf(':');
  if (colon <= 0) return undefined;
  const provider = t.slice(0, colon).trim();
  const region = t.slice(colon + 1).trim();
  return provider && region ? { provider, region } : undefined;
}

/** Parse a comma-separated `provider:region` list (the --lz-cat-targets form). */
export function parseLzTargetList(raw: string): LzTargetSpec[] {
  return dedupe(raw.split(',').map(parseLzTarget).filter((t): t is LzTargetSpec => !!t));
}

/** `provider:region` label used in events, run-status.json and reports. */
export const lzTargetLabel = (t: LzTargetSpec): string => `${t.provider}:${t.region}`;

function dedupe(targets: LzTargetSpec[]): LzTargetSpec[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const k = lzTargetLabel(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function landingZoneBlock(assessment: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  const lz = assessment?.['landing_zone'];
  return isObject(lz) ? lz : undefined;
}

/** Entries of assessment.landing_zone.targets (strings or { provider, region } objects). */
export function readLzTargetsKey(assessment: Record<string, unknown> | null | undefined): LzTargetSpec[] {
  const list = landingZoneBlock(assessment)?.['targets'];
  if (!Array.isArray(list)) return [];
  const out: LzTargetSpec[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      const t = parseLzTarget(entry);
      if (t) out.push(t);
    } else if (isObject(entry)) {
      const provider = str(entry['provider']);
      const region = str(entry['region']);
      if (provider && region) out.push({ provider, region });
    }
  }
  return dedupe(out);
}

/** Targets configured in one `assessment` block, with the key they came from. */
export function lzTargetsFromAssessment(
  assessment: Record<string, unknown> | null | undefined,
): { targets: LzTargetSpec[]; key: 'assessment.landing_zone.targets' | 'assessment.lz_cat_targets' | 'assessment.landing_zone.provider/region' } | undefined {
  if (!assessment) return undefined;
  const listed = readLzTargetsKey(assessment);
  if (listed.length > 0) return { targets: listed, key: 'assessment.landing_zone.targets' };
  const legacy = str(assessment['lz_cat_targets']);
  if (legacy) {
    const parsed = parseLzTargetList(legacy);
    if (parsed.length > 0) return { targets: parsed, key: 'assessment.lz_cat_targets' };
  }
  const lz = landingZoneBlock(assessment);
  const provider = str(lz?.['provider']);
  const region = str(lz?.['region']);
  if (provider && region) return { targets: [{ provider, region }], key: 'assessment.landing_zone.provider/region' };
  return undefined;
}

/** Resolve the LZ catalogue targets of a run (see the order at the top of this file). */
export function resolveLzTargets(input: ResolveLzTargetsInput): ResolvedLzTargets {
  if (input.cliTargets && input.cliTargets.trim() !== '') {
    const targets = parseLzTargetList(input.cliTargets);
    if (targets.length > 0) return { targets, source: 'cli:--lz-cat-targets' };
  }
  const cliProvider = str(input.cliProvider);
  const cliRegion = str(input.cliRegion);
  if (cliProvider || cliRegion) {
    const appLz = landingZoneBlock(input.appAssessment);
    const wsLz = landingZoneBlock(input.workspaceAssessment);
    const provider = cliProvider ?? str(appLz?.['provider']) ?? str(wsLz?.['provider']);
    const region = cliRegion ?? str(appLz?.['region']) ?? str(wsLz?.['region']);
    if (provider && region) return { targets: [{ provider, region }], source: 'cli:--lz-provider/--lz-region' };
  }
  const app = lzTargetsFromAssessment(input.appAssessment);
  if (app) return { targets: app.targets, source: `app:${app.key}` };
  const ws = lzTargetsFromAssessment(input.workspaceAssessment);
  if (ws) return { targets: ws.targets, source: `workspace:${ws.key}` };
  return { targets: [], source: 'none' };
}

/**
 * Write `targets` to `assessment.landing_zone.targets` of a parsed .swao.yml
 * object (TUI persistence). Removes the deprecated `assessment.lz_cat_targets`
 * so a single key is authoritative; `provider` / `region` are left untouched
 * (Pass 23 reads `provider`). Returns the same object for chaining.
 */
export function setLzTargetsInSwaoYml(yml: Record<string, unknown>, targets: readonly string[]): Record<string, unknown> {
  const assessment = isObject(yml['assessment']) ? yml['assessment'] : {};
  const lz = isObject(assessment['landing_zone']) ? assessment['landing_zone'] : {};
  lz['targets'] = [...new Set(targets.map((t) => t.trim()).filter(Boolean))];
  assessment['landing_zone'] = lz;
  delete assessment['lz_cat_targets'];
  yml['assessment'] = assessment;
  return yml;
}
