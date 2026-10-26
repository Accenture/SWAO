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

import type { PassRunner } from '@swao/core';
import { runInvPass } from './passes/pass-01-inv.js';
import { runStatePass } from './passes/pass-02-state.js';
import { runDataPass } from './passes/pass-03-data.js';
import { runCtxPass } from './passes/pass-04-ctx.js';
import { runSbomPass } from './passes/pass-05-sbom.js';
import { runTfPass } from './passes/pass-06-tf.js';
import { runEgrPass } from './passes/pass-07-egr.js';
import { runCryptoPass } from './passes/pass-08-crypto.js';
import { runSynthPass } from './passes/pass-09-synth.js';
// COMP (Pass 11) moved to @swao/module-framework (#0570). It is no longer part
// of this orchestrator profile -- a module may not import another module -- so
// the host dispatches it directly from @swao/module-framework.
import { runBlocksPass } from './passes/pass-12-blocks.js';
import { runScopePass } from './passes/pass-13-scope.js';
import { runMalwarePass, runSecretScanPass } from './passes/pass-14-malware.js';
import { CANONICAL_DEFAULT_PASS_KEYS } from '@swao/core';
import { runIamPass } from './passes/pass-21-iam.js';
import { runQualityPass } from './passes/pass-26-quality.js';

/**
 * AssessOrchestrator (#0549) -- owns the ordered application-assessment pass
 * profile that `swao assess` iterates. This replaces the hardcoded PASS_MAP
 * literal that used to live in @swao/swao's commands/assess.ts: the dispatch
 * table is now provided by the module that owns the passes.
 *
 * Pass 10 (DYNAMIC) and Pass 23 (LZR) are intentionally absent from PASS_PROFILE --
 * they take orchestrator-supplied inputs beyond PassContext and are dispatched
 * separately by the caller. This profile is the 11 uniform single-argument passes.
 *
 * Pass 14 (MALWARE) is intentionally absent from passKeys() (the default profile).
 * It requires external tools (Gitleaks, OSV-Scanner) that are not guaranteed to
 * be installed. Users opt in via --passes malware; getPass('malware') resolves it
 * through OPT_IN_PASSES. (#0681)
 * #3419: the Gitleaks part of Pass 14 runs by default as `secrets`
 * (getPass('secrets'), DEFAULT_PASS_KEYS); a missing Gitleaks yields MAL-00.
 */

export type AppAssessmentPassKey =
  | 'inv'
  | 'state'
  | 'data'
  | 'ctx'
  | 'sbom'
  | 'tf'
  | 'egr'
  | 'crypto'
  | 'synth'
  | 'blocks'
  | 'scope'
  | 'quality';

export interface AppAssessmentPassDescriptor {
  /** Two-digit pass number used in the WSP filename and progress output. */
  num: string;
  /** Canonical pass name emitted in the PassHeader. */
  name: string;
  /** Single-argument pass runner. */
  runner: PassRunner;
  /** Non-null when the pass is LLM-driven; the value is the pass-name key the
   *  LLM provider factory is keyed on. Drives provider creation, data_source
   *  injection and the rule_engine/llm assessor tag in the caller. */
  llmPassName: string | null;
}

// Lookup table for the uniform passes, listed by pass number. The execution
// order is CANONICAL_PASS_ORDER below (#3152), not the key order of this map.
const PASS_PROFILE: Record<AppAssessmentPassKey, AppAssessmentPassDescriptor> = {
  inv: { num: '01', name: 'inventory', runner: runInvPass, llmPassName: null },
  state: { num: '02', name: 'state_analysis', runner: runStatePass, llmPassName: null },
  data: { num: '03', name: 'data_classification', runner: runDataPass, llmPassName: 'data' },
  ctx: { num: '04', name: 'context_ingestion', runner: runCtxPass, llmPassName: 'ctx' },
  sbom: { num: '05', name: 'sbom_cve', runner: runSbomPass, llmPassName: null },
  tf: { num: '06', name: 'twelve_factor', runner: runTfPass, llmPassName: null },
  egr: { num: '07', name: 'egress', runner: runEgrPass, llmPassName: null },
  crypto: { num: '08', name: 'crypto_posture', runner: runCryptoPass, llmPassName: null },
  synth: { num: '09', name: 'synthesis', runner: runSynthPass, llmPassName: 'synth' },
  // 'comp' (Pass 11) intentionally absent -- dispatched by the host from
  // @swao/module-framework (#0570), like Pass 10 (DYNAMIC) and Pass 23 (LZR).
  blocks: { num: '12', name: 'block_assessments', runner: runBlocksPass, llmPassName: 'blocks' },
  scope: { num: '13', name: 'scope_coverage', runner: runScopePass, llmPassName: null },
  // #3405: Pass 26 code health (15 to 22 are former block numbers, 21 is iam, 23 to 25 are in use).
  quality: { num: '26', name: 'code_health', runner: runQualityPass, llmPassName: null },
};

// Opt-in passes: recognized by getPass() but excluded from passKeys() so they
// do not run as part of the default pass profile. Users must request them
// explicitly via --passes <key>.
// #3419: `secrets` is the Pass 14 secret scan (Gitleaks only) and IS in the
// default `--passes` list (DEFAULT_PASS_KEYS); it is registered here because
// the AppAssessmentPassKey union lists only the original uniform passes.
const OPT_IN_PASSES: Record<string, AppAssessmentPassDescriptor> = {
  secrets: { num: '14', name: 'secret_scan', runner: runSecretScanPass, llmPassName: null },
  malware: { num: '14', name: 'malware_scanning', runner: runMalwarePass, llmPassName: null },
  iam: { num: '21', name: 'iam_assessment', runner: runIamPass, llmPassName: null },
};

export class AssessOrchestrator {
  /** Lookup a pass descriptor by key. Checks the default profile first, then
   *  the opt-in registry. Returns undefined for unknown keys (the caller warns
   *  and skips, preserving prior behaviour). */
  getPass(key: string): AppAssessmentPassDescriptor | undefined {
    return (PASS_PROFILE as Record<string, AppAssessmentPassDescriptor>)[key]
      ?? OPT_IN_PASSES[key];
  }

  /** Pass keys of the default pass profile, by pass number (execution order: CANONICAL_PASS_ORDER). */
  get passKeys(): AppAssessmentPassKey[] {
    return Object.keys(PASS_PROFILE) as AppAssessmentPassKey[];
  }

  /** Resolve a requested key list into descriptors, in the requested order,
   *  skipping unknown keys. */
  resolve(requestedKeys: string[]): AppAssessmentPassDescriptor[] {
    return requestedKeys
      .map((k) => this.getPass(k))
      .filter((d): d is AppAssessmentPassDescriptor => d !== undefined);
  }
}

export const assessOrchestrator = new AssessOrchestrator();

// ---------------------------------------------------------------------------
// Execution order, aliases and --skip-llm filtering (#3152, #3158)
//
// Kept here as pure functions so the host `swao assess` command stays thin and
// the decisions are unit-tested in this package (the host CLI tests spawn the
// built binary and cannot exercise source changes directly).
// ---------------------------------------------------------------------------

/**
 * Canonical execution order. The user-supplied `--passes` order and the
 * pass_profile / lens order are treated as a SET; the host always runs in this
 * sequence (#1282 root B, #1350, #3152).
 *
 * Signal-read dependencies that fix the order:
 * - `dynamic`, `scope` and `malware` read no other pass file, so they run with
 *   the static passes and their DYN, SCOPE and MAL signals are on disk before
 *   COMP evaluates the run (#3152: previously they ran after COMP and BLOCKS).
 * - `lzr` (Pass 23, only when `--lzr <landingZoneId>` is set) runs before
 *   SYNTH, which reads `23-lzr.yaml` of the current run for its LZ adjustment
 *   (#3152 / #3158: previously it ran after the loop, so SYNTH read the
 *   previous run's verdict).
 * - `comp` runs before `synth` so the 7R verdict sees compliance gaps (#1350).
 *   No bundled framework names a SYNTH evidence basis, so COMP loses nothing.
 * - `blocks` runs last: its prompt carries the SYNTH context (7R label,
 *   coverage score, rationale) from `09-synth.yaml` of the current run, which
 *   did not exist yet when BLOCKS ran before SYNTH (#3152). BLOCKS emits no
 *   signals, so SYNTH loses nothing by running first.
 */
export const CANONICAL_PASS_ORDER: readonly string[] = [
  'inv', 'state', 'data', 'ctx', 'sbom', 'tf', 'egr', 'crypto', 'quality',
  'dynamic', 'scope', 'secrets', 'malware', 'lzr', 'comp', 'synth', 'blocks',
];

/**
 * Default `--passes` list (every default-profile pass; malware is opt-in, lzr is
 * driven by `--lzr`). #3419: the one list lives in @swao/core
 * (DEFAULT_PASS_PROFILE) and now includes `secrets`, the Gitleaks secret scan.
 */
export const DEFAULT_PASS_KEYS: readonly string[] = CANONICAL_DEFAULT_PASS_KEYS;

/**
 * #3419: passes the TUI does not pre-select although the CLI default runs
 * them: `dynamic` needs Playwright and an analyst-configured crawl. Derived,
 * not a second literal, so the TUI cannot drift from DEFAULT_PASS_KEYS.
 */
export const TUI_OPT_IN_PASS_KEYS: ReadonlySet<string> = new Set(['dynamic']);

/** #3419: the TUI first-run pre-selection (DEFAULT_PASS_KEYS without TUI_OPT_IN_PASS_KEYS). */
export const TUI_DEFAULT_PASS_KEYS: readonly string[] = DEFAULT_PASS_KEYS.filter((k) => !TUI_OPT_IN_PASS_KEYS.has(k));

/**
 * #3419: a requested pass that makes another one redundant. The full malware
 * scan runs Gitleaks itself, so `secrets` is dropped when `malware` is in the
 * run (never reported as "not executed").
 */
export const SUPERSEDED_PASS_KEYS: Readonly<Record<string, string>> = { secrets: 'malware' };

/** Passes removed from the run by `--skip-llm`: their result is meaningless
 *  without an LLM (#1625, #2441). DATA and SYNTH stay and emit their
 *  llmSkipResult marker, because the host withholds the provider (#3158). */
export const SKIP_LLM_REMOVED_PASSES: readonly string[] = ['ctx', 'comp', 'blocks'];

/**
 * Shorthand IDs used in lens definitions and docs (#1040). `lzr` maps to
 * `null`: Pass 23 is not a `--passes` key, it runs only when `--lzr
 * <landingZoneId>` names a landing zone. It used to map to `scope`, which ran
 * the wrong pass under the LZR name (#3152).
 */
export const PASS_ALIASES: Readonly<Record<string, string | null>> = {
  mal: 'malware',
  dyn: 'dynamic',
  lzr: null,
};

/** Every key accepted in `--passes` or pass_profile, aliases included. */
export const INDIVIDUAL_PASS_KEYS: ReadonlySet<string> = new Set([
  'inv', 'state', 'data', 'ctx', 'sbom', 'tf', 'egr', 'crypto',
  'synth', 'dynamic', 'comp', 'blocks', 'scope', 'secrets', 'malware', 'quality',
  ...Object.keys(PASS_ALIASES),
]);

/** Opt-in passes: not in the default list, but added when a configured lens or
 *  pass_profile names them and the operator did not pass an explicit `--passes`. */
export const OPT_IN_PASS_KEYS: ReadonlySet<string> = new Set(['malware']);

/**
 * Resolve a pass key or alias (case-insensitive) to its canonical key.
 * Returns `null` for keys that are recognised but select no `--passes` entry
 * (`lzr`), and `undefined` for unknown keys.
 */
export function resolvePassAlias(key: string): string | null | undefined {
  const lc = key.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PASS_ALIASES, lc)) return PASS_ALIASES[lc] ?? null;
  return INDIVIDUAL_PASS_KEYS.has(lc) ? lc : undefined;
}

/**
 * Deduplicate (case-insensitive) and sort into CANONICAL_PASS_ORDER. Unknown keys keep their relative order at the end.
 * #3419: a superseded pass is dropped when the pass that supersedes it is in
 * the list (`secrets` with `malware`), so every path (CLI, profile, TUI) agrees.
 */
export function sortPassesCanonical(keys: readonly string[]): string[] {
  const lowered = Array.from(new Set(keys.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0)));
  const unique = lowered.filter((k) => {
    const by = SUPERSEDED_PASS_KEYS[k];
    return by === undefined || !lowered.includes(by);
  });
  const rank = (k: string): number => {
    const i = CANONICAL_PASS_ORDER.indexOf(k);
    return i === -1 ? CANONICAL_PASS_ORDER.length : i;
  };
  return unique
    .map((k, i) => ({ k, i }))
    .sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i)
    .map((e) => e.k);
}

/**
 * Normalise a requested `--passes` list: resolve aliases (`mal`, `dyn`), drop
 * `lzr` (it selects Pass 23, which `--lzr <landingZoneId>` drives) and sort into
 * canonical order. Unknown keys are kept so the host can warn about them.
 * The TUI writes lens pass codes (MAL, LZR) straight into `--passes` (#3158).
 */
export function normaliseRequestedPasses(keys: readonly string[]): { passes: string[]; lzrRequested: boolean } {
  let lzrRequested = false;
  const out: string[] = [];
  for (const raw of keys) {
    const lc = raw.trim().toLowerCase();
    if (lc.length === 0) continue;
    if (lc === 'lzr') lzrRequested = true;
    const canonical = resolvePassAlias(lc);
    if (canonical === null) continue;
    out.push(canonical ?? lc);
  }
  return { passes: sortPassesCanonical(out), lzrRequested };
}

/**
 * Reference catalogues under swao/controls/ that no pass reads (#3158). When
 * a catalogue is listed here, orchestrator.test.ts checks that no pass source
 * names it, so the list stays accurate. #3160 wired the five catalogues that
 * were listed (vendor-sdk, db-compatibility and legacy-indicators in Pass 01
 * via passes/inv-reference-scans.ts; sovereign-service in Pass 07; licence-risk
 * in Pass 14), so the list is empty; WIRED_REFERENCE_CATALOGUES records them.
 */
export const UNREAD_REFERENCE_CATALOGUES: ReadonlyArray<{ file: string; intendedConsumer: string }> = [];

/** Reference catalogues wired by #3160 and the pass that reads each one. */
export const WIRED_REFERENCE_CATALOGUES: ReadonlyArray<{ file: string; consumer: string }> = [
  { file: 'vendor-sdk-catalogue.yaml', consumer: 'Pass 01 INV-09 (passes/inv-reference-scans.ts)' },
  { file: 'db-compatibility-catalogue.yaml', consumer: 'Pass 01 INV-07 (passes/inv-reference-scans.ts)' },
  { file: 'legacy-indicators-catalogue.yaml', consumer: 'Pass 01 INV-08 (passes/inv-reference-scans.ts)' },
  { file: 'licence-risk-catalogue.yaml', consumer: 'Pass 14 MAL-10 and MAL-13 (ORT licence classification)' },
  { file: 'sovereign-service-catalogue.yaml', consumer: 'Pass 07 EGR sovereign service signals' },
];

/** Apply `--skip-llm` to a comma-separated `--passes` value. */
export function applySkipLlm(passes: string): string {
  return passes
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !SKIP_LLM_REMOVED_PASSES.includes(p.toLowerCase()))
    .join(',');
}

/** Minimal lens shape (mirrors LensDef in the host's commands/lenses.ts). */
export interface PassProfileLens {
  id: string;
  passes: readonly string[];
}

export interface PassProfileExpansion {
  /** Canonical pass keys enabled by the profile (aliases resolved). */
  enabledKeys: Set<string>;
  /** Entries that are neither a lens ID nor a pass key. */
  unknownEntries: string[];
  /** Entries removed as case-insensitive duplicates. */
  duplicateEntries: string[];
  /** True when the profile (directly or through a lens) names LZR. */
  lzrRequested: boolean;
}

/**
 * Expand an `assessment.lenses` / `pass_profile` list into canonical pass
 * keys. Lens pass codes go through the same alias resolution as individual
 * entries (#3158: `security-focus` lists MAL and `cloud-migration` lists LZR;
 * neither matched a key before, so malware was silently dropped).
 */
export function expandPassProfile(profile: readonly string[], lenses: readonly PassProfileLens[]): PassProfileExpansion {
  const enabledKeys = new Set<string>();
  const unknownEntries: string[] = [];
  const duplicateEntries: string[] = [];
  let lzrRequested = false;
  const seen = new Set<string>();
  const addKey = (raw: string): boolean => {
    if (raw.trim().toLowerCase() === 'lzr') lzrRequested = true;
    const canonical = resolvePassAlias(raw);
    if (canonical === undefined) return false;
    if (canonical !== null) enabledKeys.add(canonical);
    return true;
  };
  for (const entry of profile) {
    const lc = entry.toLowerCase();
    if (seen.has(lc)) { duplicateEntries.push(entry); continue; }
    seen.add(lc);
    const lens = lenses.find((l) => l.id === entry);
    if (lens) {
      for (const p of lens.passes) addKey(p);
    } else if (!addKey(entry)) {
      unknownEntries.push(entry);
    }
  }
  return { enabledKeys, unknownEntries, duplicateEntries, lzrRequested };
}

/**
 * Filter the requested pass list by an expanded profile. Opt-in passes the
 * profile names (malware) are added when the operator did not set `--passes`
 * explicitly, because the profile is then the only statement of intent.
 * An empty enabled set leaves the list unfiltered (e.g. a profile of only
 * `lzr`, which selects no `--passes` entry).
 */
export function filterByPassProfile(
  requested: readonly string[],
  expansion: PassProfileExpansion,
  passesExplicit: boolean,
): string[] {
  if (expansion.enabledKeys.size === 0) return [...requested];
  const kept = requested.filter((p) => expansion.enabledKeys.has(p));
  if (!passesExplicit) {
    for (const k of expansion.enabledKeys) {
      if (OPT_IN_PASS_KEYS.has(k) && !kept.includes(k)) kept.push(k);
    }
  }
  return sortPassesCanonical(kept);
}
