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

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { LlmPassResponse } from './types.js';
import type { Signal } from '@swao/core';
import { SIGNAL_SCHEMA_HINT, normalizeSignal } from '@swao/core';
import { llmSkipResult, llmInvalidResponseResult } from './llm-skip.js';
import { TARGET_CAPABILITY_GAP_TAG } from './infra-input-role.js';
import { computeMigrationScores, type MigrationScores } from '../scoring/migration-scores.js';
import {
  resolveDefaultCataloguePath,
  loadCatalogueDocument,
  deriveConstraints,
  marketScan,
  lzCatalogueFitFileName,
  MARKET_SCAN_MAX_REVIEW_AGE_DAYS,
  type MarketScanResult,
} from '@swao/core';

// ---------------------------------------------------------------------------
// LZR adjustment types (exported for testing)
// ---------------------------------------------------------------------------

export interface LzrAdjustment {
  verdict: 'ready' | 'blocked' | 'advisory' | 'not_assessed';
  score_delta?: Record<string, number>;
  affected_Rs?: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Passes directory resolver (latest.txt-aware)
// ---------------------------------------------------------------------------

// Resolve the current run's passes/ dir via wsp/latest.txt. Falls back to
// the legacy flat <workspacePath>/wsp/passes/ if no run is recorded yet.
// Same pattern used by pass-11-compliance.ts and pass-12-blocks.ts.
export function resolvePassesDir(workspacePath: string): string {
  const wspDir = join(workspacePath, 'wsp');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim();
      const candidate = join(wspDir, rel, 'passes');
      if (existsSync(candidate)) return candidate;
    } catch { /* fall through */ }
  }
  return join(wspDir, 'passes');
}

// ---------------------------------------------------------------------------
// LZR verdict reader
// ---------------------------------------------------------------------------

interface LzrVerdictInfo {
  verdict: 'ready' | 'blocked' | 'advisory' | null;
  landing_zone_id: string | null;
  first_blocker_description: string | null;
  first_blocker_id: string | null;
}

// #3158: an active run passes its own passes/ dir. Without it the resolver
// follows latest.txt, which during a run still points at the PREVIOUS run, so
// SYNTH applied a stale LZR verdict (or one from a different landing zone).
export function readLzrVerdict(workspacePath: string, passesDirOverride?: string): LzrVerdictInfo {
  const lzrFile = join(passesDirOverride ?? resolvePassesDir(workspacePath), '23-lzr.yaml');
  if (!existsSync(lzrFile)) {
    return { verdict: null, landing_zone_id: null, first_blocker_description: null, first_blocker_id: null };
  }
  try {
    const raw = load(readFileSync(lzrFile, 'utf-8')) as {
      lzrResult?: {
        overall_verdict?: string;
        landing_zone_id?: string;
        blockers?: Array<{ check_id?: string; description?: string }>;
      };
      assessment?: {
        overall_verdict?: string;
        landing_zone_id?: string;
      };
    } | null;

    // Support both the pass-23 output format (lzrResult key) and direct format
    const lzrResult = raw?.lzrResult ?? raw?.assessment;
    const verdict = lzrResult?.overall_verdict;
    if (verdict !== 'ready' && verdict !== 'blocked' && verdict !== 'advisory') {
      return { verdict: null, landing_zone_id: null, first_blocker_description: null, first_blocker_id: null };
    }

    const blockers = raw?.lzrResult?.blockers ?? [];
    return {
      verdict,
      landing_zone_id: lzrResult?.landing_zone_id ?? null,
      first_blocker_description: blockers[0]?.description ?? null,
      first_blocker_id: blockers[0]?.check_id ?? null,
    };
  } catch {
    return { verdict: null, landing_zone_id: null, first_blocker_description: null, first_blocker_id: null };
  }
}

// ---------------------------------------------------------------------------
// LZR adjustment logic
// ---------------------------------------------------------------------------

const MIGRATION_RS = new Set(['Rehost', 'Replatform']);

export function applyLzrAdjustment(
  sevenRLabel: string,
  info: LzrVerdictInfo,
): { adjustedLabel: string; lzrAdjustment: LzrAdjustment } {
  if (info.verdict === null) {
    return { adjustedLabel: sevenRLabel, lzrAdjustment: { verdict: 'not_assessed' } };
  }

  if (info.verdict === 'ready') {
    return { adjustedLabel: sevenRLabel, lzrAdjustment: { verdict: 'ready' } };
  }

  const lzId = info.landing_zone_id ?? 'unknown';

  if (info.verdict === 'blocked') {
    const isMigrationR = MIGRATION_RS.has(sevenRLabel);
    const isRetain = sevenRLabel === 'Retain';

    if (isMigrationR) {
      const note =
        `Landing zone ${lzId} is BLOCKED` +
        (info.first_blocker_id ? ` (${info.first_blocker_id}` : '') +
        (info.first_blocker_description ? `: ${info.first_blocker_description.slice(0, 80).split('\n')[0].trim()}` : '') +
        (info.first_blocker_id ? ')' : '') +
        `. ${sevenRLabel} removed from viable options.`;
      return {
        adjustedLabel: 'Retain',
        lzrAdjustment: {
          verdict: 'blocked',
          score_delta: { [sevenRLabel.toLowerCase()]: -1.0, retain: 0.15 },
          affected_Rs: [sevenRLabel.toLowerCase(), 'retain'],
          note,
        },
      };
    }

    if (isRetain) {
      return {
        adjustedLabel: 'Retain',
        lzrAdjustment: {
          verdict: 'blocked',
          score_delta: { retain: 0.15 },
          affected_Rs: ['retain'],
          note: `Landing zone ${lzId} is BLOCKED. Retain score boosted (capped at 1.0).`,
        },
      };
    }

    // Other labels (Retire, Repurchase, Refactor, Re-architect) -- not affected by LZ status
    return {
      adjustedLabel: sevenRLabel,
      lzrAdjustment: {
        verdict: 'blocked',
        score_delta: {},
        affected_Rs: [],
        note: `Landing zone ${lzId} is BLOCKED but does not affect ${sevenRLabel} recommendation.`,
      },
    };
  }

  // advisory
  if (MIGRATION_RS.has(sevenRLabel)) {
    return {
      adjustedLabel: sevenRLabel,
      lzrAdjustment: {
        verdict: 'advisory',
        score_delta: { [sevenRLabel.toLowerCase()]: -0.15 },
        affected_Rs: [sevenRLabel.toLowerCase()],
        note: `Landing zone ${lzId} has advisory warnings. ${sevenRLabel} recommendation flagged -- resolve warnings before migration.`,
      },
    };
  }

  return {
    adjustedLabel: sevenRLabel,
    lzrAdjustment: {
      verdict: 'advisory',
      score_delta: {},
      affected_Rs: [],
      note: `Landing zone ${lzId} has advisory warnings.`,
    },
  };
}

const VALID_7R = new Set([
  'Retire', 'Retain', 'Rehost', 'Replatform', 'Repurchase', 'Refactor', 'Re-architect',
]);

// #0404 (sprint-040 round-5): normalise LLM-emitted 7R labels to the
// canonical PascalCase form. gpt-4o-mini returned "refactor" (lowercase);
// older Anthropic outputs returned "re_architect" (snake_case). Rather
// than fail the entire synthesis pass on a casing variance the LLM is
// fundamentally bad at controlling, canonicalise and accept. Logs the
// normalisation so the audit trail shows the original LLM output.
const SEVEN_R_ALIASES: Record<string, string> = {
  retire: 'Retire',
  retain: 'Retain',
  rehost: 'Rehost',
  replatform: 'Replatform',
  repurchase: 'Repurchase',
  refactor: 'Refactor',
  're-architect': 'Re-architect',
  're_architect': 'Re-architect',
  'rearchitect': 'Re-architect',
};

function canonicaliseSevenR(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/_/g, '-');
  // Try alias map first (handles re_architect / rearchitect / case differences),
  // then verify the result is in the canonical set.
  const aliased = SEVEN_R_ALIASES[key];
  if (aliased && VALID_7R.has(aliased)) return aliased;
  // Last resort: exact match against the canonical set (preserves any future
  // additions we might forget to add to the alias map).
  return VALID_7R.has(raw) ? raw : null;
}

// #1055: accept an explicit passesDir when the orchestrator injects it via
// PassContext (active runs -- latest.txt is not yet written). Falls back to
// resolvePassesDir (latest.txt lookup) for standalone / post-run callers.
export function loadPriorSignals(workspacePath: string, passesDirOverride?: string): Signal[] {
  const dir = passesDirOverride ?? resolvePassesDir(workspacePath);
  if (!existsSync(dir)) return [];

  const signals: Signal[] = [];
  const files = readdirSync(dir).sort().filter(
    f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('09-synth'),
  );

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const parsed = load(raw) as { signals?: Signal[] } | null;
      if (parsed?.signals) signals.push(...parsed.signals);
    } catch {
      // skip unreadable
    }
  }

  return signals;
}

// data_gaps_blocking and data_gaps_nonblocking are deferred to a later sprint
// (they require wsp-plan.yaml parsing). M4 uses only low-confidence ratio.
function computeCoverageScore(priorSignals: Signal[]): number {
  const total = priorSignals.length;
  if (total === 0) return 0.5;
  const lowConf = priorSignals.filter(s => s.confidence === 'low').length;
  const score = 1.0 - (lowConf / total);
  return Math.round(Math.max(0.0, Math.min(1.0, score)) * 100) / 100;
}

// #3430: exported for the target-capability prompt section test.
// #3431: `scores` are the deterministic cloud-native and portability scores
// (scoring/migration-scores.ts). The LLM no longer sets portability_score; it
// sees the computed values as context and may comment on them.
export function buildSynthPrompt(
  priorSignals: Signal[],
  appId: string,
  lz: SynthLzPromptContext = { targets: [] },
  scores?: MigrationScores,
): string {
  const bySeverity: Record<string, string[]> = {};
  for (const s of priorSignals) {
    const sev = s.severity ?? 'informational';
    if (!bySeverity[sev]) bySeverity[sev] = [];
    bySeverity[sev].push(s.id);
  }

  const byPrefix: Record<string, number> = {};
  for (const s of priorSignals) {
    const prefix = s.id.split('-')[0];
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }

  const lines: string[] = [
    'SYNTHESIS_PASS',
    `App: ${appId}`,
    `Total prior signals: ${priorSignals.length}`,
    `By prefix: ${JSON.stringify(byPrefix)}`,
    `By severity: ${JSON.stringify(bySeverity)}`,
    '',
    'Task: Apply the 7R migration framework. Return JSON matching:',
    '{ "signals": [...], "assessment": { "seven_r_label": "string", "migration_rationale": "string",',
    '  "modernization_position": "string", "portability_comment": "string", "confidence": "string",',
    '  "landing_zone": "string", "recommended_next_steps": ["string"], "migration_blockers": number,',
    '  "migration_enablers": ["string"] } }',
    '',
    'Signal IDs must use prefix SYNTH-NN.',
    'Emit SYNTH-01 (7R verdict), SYNTH-02 (7R rejection rationale), SYNTH-03 (key constraint).',
    'seven_r_label must be one of: Retire, Retain, Rehost, Replatform, Repurchase, Refactor, Re-architect.',
    'modernization_position is a strategic disposition; canonical values are invest_modernize_now,',
    '  migrate_stabilize, tolerate_contain, retire_replace.',
    '  Refinement variants are acceptable (e.g. invest_modernize_with_remediation).',
    'Do not emit portability_score or cloud_native_score: SWAO computes both deterministically',
    '  (see DETERMINISTIC SCORES below). portability_comment is an optional short remark (max 300',
    '  characters) on the computed portability score, e.g. which lock-in or gap matters most.',
    'confidence is your confidence in the overall 7R verdict; one of: high, medium, low.',
    '  Reflect uncertainty when prior signals are sparse or contradictory.',
    'migration_blockers is an integer count.',
    '',
    SIGNAL_SCHEMA_HINT,
  ];

  if (scores) {
    lines.push('', '--- DETERMINISTIC SCORES (computed by SWAO, not to be re-estimated) ---');
    const cn = scores.cloud_native;
    lines.push(cn
      ? `cloud_native_score: ${cn.score.toFixed(2)} (${cn.factors_checked} of ${cn.factors_total} twelve-factor checks determinate, confidence ${cn.confidence})`
      : `cloud_native_score: not computed (${scores.cloud_native_skipped_reason ?? 'no input'})`);
    const pt = scores.portability;
    if (pt && pt.score !== null) {
      lines.push(`portability_score: ${pt.score.toFixed(2)} from ${pt.components_used.join(', ')}`);
      for (const c of pt.components) {
        lines.push(`  ${c.id}: ${c.used && c.value !== null ? c.value.toFixed(2) : 'not used'} (${c.reason})`);
      }
    } else {
      lines.push('portability_score: not computed (no input data)');
    }
  }

  // #4481 (Design 012 section 5a): only the landing zones selected for the run
  // reach the LLM; the bundled provider list only when the market scan is on.
  lines.push('', '--- LANDING ZONES SELECTED FOR THIS RUN ---');
  if (lz.targets.length > 0) {
    lines.push(`Selected targets (assessed by the LZ catalogue fit of this run): ${lz.targets.map(lzTargetLabel).join(', ')}`);
    lines.push('landing_zone must be one of these targets (provider/region) or an empty string; do not name any other provider.');
  } else {
    lines.push('No landing zone was selected for this run. Set landing_zone to an empty string and do not name a provider.');
  }
  if (lz.marketScan && lz.marketScan.candidates.length > 0) {
    lines.push('', '--- MARKET SCAN (bundled provider list, lower confidence; not a selected landing zone) ---');
    for (const c of lz.marketScan.candidates.slice(0, 5)) {
      lines.push(`${c.id}: fit ${c.disqualified ? 'disqualified' : c.fit_score.toFixed(2)} (reviewed ${c.last_reviewed})`);
    }
    lines.push('You may mention the market scan in recommended_next_steps as an option to assess; never as the landing_zone.');
  }

  if (priorSignals.length > 0) {
    lines.push('', '--- HIGH SEVERITY SIGNALS ---');
    for (const s of priorSignals.filter(x => x.severity === 'high').slice(0, 10)) {
      lines.push(`${s.id}: ${s.derivation.slice(0, 120)}`);
    }
    lines.push('', '--- EGR SIGNALS ---');
    for (const s of priorSignals.filter(x => x.id.startsWith('EGR-'))) {
      lines.push(`${s.id}: ${s.derivation.slice(0, 120)}`);
    }
  }

  // #3430 (decision on the #3429 follow-up): CTX signals tagged
  // gap_type:target_capability describe what a candidate landing zone lacks,
  // not a defect of the application. SYNTH sees them in a section of their own
  // and must not count them as migration blockers or 7R evidence. The section
  // is added only when such signals exist, so other prompts stay byte-identical.
  const targetGaps = priorSignals.filter(s => s.implies?.includes(TARGET_CAPABILITY_GAP_TAG));
  if (targetGaps.length > 0) {
    lines.push(
      '',
      '--- TARGET-PLATFORM GAPS (gap_type:target_capability) ---',
      'These signals describe capabilities a candidate landing zone does not offer; they are not defects of the application today.',
      'Do not count them in migration_blockers and do not use them as evidence for the 7R verdict; use them only for the landing_zone choice and next steps.',
    );
    for (const s of targetGaps.slice(0, 10)) {
      lines.push(`${s.id}: ${s.derivation.slice(0, 120)}`);
    }
  }

  return lines.join('\n');
}

// #3158: the cloud-provider catalogue lives at swao/controls/. The core
// default resolver assumes one layout (4 levels up), which misses the
// catalogue in the bundled binary, where this module is collapsed into
// packages/swao/dist (3 levels up). Try each layout, mirroring
// pass-13-scope.ts; return null when none exists so the pass records why the
// landing-zone match did not run instead of skipping it silently.
export function resolveCloudProviderCataloguePath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolveDefaultCataloguePath(),
    resolve(here, '../../../../../controls/cloud-provider-catalogue.yaml'),
    resolve(here, '../../../../controls/cloud-provider-catalogue.yaml'),
    resolve(here, '../../../controls/cloud-provider-catalogue.yaml'),
    resolve(here, '_controls/cloud-provider-catalogue.yaml'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Body of the first markdown code fence, or null. Same result as
 * `/```(?:json)?\s*\n([\s\S]*?)\n```/` (group 1): an opening fence, an optional
 * `json` tag, whitespace that contains a newline, and the text up to the next
 * newline-fence. Written as a scan because the regex backtracks polynomially on
 * long whitespace runs (CodeQL js/polynomial-redos). Exported for tests.
 */
export function firstFenceBody(raw: string): string | null {
  let from = 0;
  // No newline-fence exists at or after this index (each search is done once).
  let noCloseFrom = Number.POSITIVE_INFINITY;
  for (;;) {
    const open = raw.indexOf('```', from);
    if (open < 0) return null;
    from = open + 1;
    let i = open + 3;
    if (raw.startsWith('json', i)) i += 4;
    // Whitespace run after the tag; the body starts after its last newline
    // (greedy `\s*` backtracks to the last newline first).
    let lastNl = -1;
    let prevNl = -1;
    let j = i;
    while (j < raw.length && /\s/.test(raw[j] as string)) {
      if (raw[j] === '\n') { prevNl = lastNl; lastNl = j; }
      j++;
    }
    if (lastNl < 0) continue;
    const start = lastNl + 1;
    const close = start >= noCloseFrom ? -1 : raw.indexOf('\n```', start);
    if (close >= 0) return raw.slice(start, close);
    noCloseFrom = Math.min(noCloseFrom, start);
    // Regex backtracking: an earlier newline in the run starts the body, and the
    // run's last newline plus the fence right after it closes it.
    if (prevNl >= 0 && raw.startsWith('```', start)) return raw.slice(prevNl + 1, lastNl);
  }
}

/** Extract the JSON object from an LLM answer (markdown fences or stray prose around it). */
export function extractJsonObject(raw: string): unknown {
  const fenced = firstFenceBody(raw);
  const candidate = fenced ?? raw;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(candidate.slice(first, last + 1)); } catch { return null; }
}

/** #4481: skip reason of a service run (a service assessment has no LZ catalogue target; same wording as the baseline decisions in assess.ts). */
// #4511: a service run with no selected target (the workspace sets none); with a target it is matched like an application run.
export const SERVICE_NO_LZ_TARGET_REASON = 'no landing zone selected for the service assessment';

/** #4481: LZ context of the synthesis prompt (selected targets, optional market scan). */
export interface SynthLzPromptContext {
  targets: ReadonlyArray<{ provider: string; region: string }>;
  marketScan?: MarketScanResult;
}

function lzTargetLabel(t: { provider: string; region: string }): string {
  return `${t.provider}/${t.region}`;
}

/**
 * #4481: true when an LLM landing_zone value names a selected target: the
 * provider/region label (also provider:region), the provider id alone, or a
 * value that starts with the provider id followed by a separator.
 */
export function landingZoneInSelection(value: string, targets: ReadonlyArray<{ provider: string; region: string }>): boolean {
  const v = value.trim().toLowerCase();
  return targets.some((t) => {
    const p = t.provider.toLowerCase();
    const r = t.region.toLowerCase();
    if (v === `${p}/${r}` || v === `${p}:${r}` || v === p) return true;
    if (!v.startsWith(p)) return false;
    const next = v.charAt(p.length);
    return next === '/' || next === ':' || next === '_' || next === '-' || next === ' ';
  });
}

/**
 * #4481 (Design 012 section 5a): the landing-zone fields of the synthesis
 * assessment. Default: the targets selected for the run with the name of the
 * catalogue fit file each is written to (the inline fit runs after the
 * passes), or the skip reason when none is selected. With the market scan on:
 * also the scored bundled provider list, lower confidence, with its version,
 * review dates and sources; providers not reviewed within 180 days are listed
 * without a fit score and named in the run log.
 */
export function synthLandingZoneContext(
  targets: ReadonlyArray<{ provider: string; region: string }>,
  opts: { marketScan: boolean; priorSignals: Signal[]; assessedAt: string; cataloguePath?: string | null; service?: boolean },
): { context: Record<string, unknown>; marketScan?: MarketScanResult } {
  const context: Record<string, unknown> = targets.length > 0
    ? {
      landing_zone_targets: targets.map((t) => ({
        provider: t.provider,
        region: t.region,
        fit_file: lzCatalogueFitFileName(t.provider, t.region, targets.length),
      })),
    }
    : { landing_zone_match_skipped_reason: opts.service ? SERVICE_NO_LZ_TARGET_REASON : 'no landing zone selected' };
  if (!opts.marketScan) return { context };
  const cataloguePath = opts.cataloguePath !== undefined ? opts.cataloguePath : resolveCloudProviderCataloguePath();
  if (!cataloguePath) {
    context['landing_zone_market_scan_skipped_reason'] = 'cloud-provider-catalogue.yaml not found';
    return { context };
  }
  try {
    const scan = marketScan(
      loadCatalogueDocument(cataloguePath),
      deriveConstraints(opts.priorSignals),
      opts.assessedAt,
      computeCoverageScore(opts.priorSignals),
      MARKET_SCAN_MAX_REVIEW_AGE_DAYS,
    );
    context['landing_zone_market_scan'] = scan;
    if (scan.not_reviewed.length > 0) {
      console.log(`[info] SYNTH market scan: ${scan.not_reviewed.length} provider(s) not reviewed within ${scan.max_review_age_days} days, listed without a fit score: ${scan.not_reviewed.map((p) => p.id).join(', ')}`);
    }
    return { context, marketScan: scan };
  } catch (err) {
    context['landing_zone_market_scan_skipped_reason'] = `cloud-provider catalogue unreadable: ${(err as Error).message.split('\n')[0]}`;
    return { context };
  }
}

export async function runSynthPass(ctx: PassContext): Promise<PassResult> {
  const { workspacePath, appId, iter, assessedAt, llm } = ctx;

  // #3431: deterministic scores, independent of the LLM. Every outcome of the
  // pass carries them; derive-plan computes the same values for wsp.yaml.
  const priorSignals = loadPriorSignals(workspacePath, ctx.passesDir);
  const migrationScores = computeMigrationScores(ctx.passesDir ?? resolvePassesDir(workspacePath), {
    signals: priorSignals,
    workspaceAppDir: workspacePath,
  });
  const scoreFields = migrationScoreFields(migrationScores);

  if (!llm) {
    // LLM-optional alignment (#0550): no provider configured -> graceful skip.
    return llmSkipResult({ id: 9, name: 'synthesis', signalPrefix: 'SYNTH', iter, assessedAt, assessment: scoreFields });
  }

  // #4481 (Design 012 section 5a): the landing zones selected for the run, and
  // the opt-in market scan over the bundled provider list.
  const lzTargets = ctx.lzTargets ?? [];
  const { context: lzContext, marketScan: lzMarketScan } = synthLandingZoneContext(lzTargets, {
    marketScan: ctx.lzMarketScan === true,
    priorSignals,
    assessedAt,
    service: ctx.assessmentType === 'service',
  });

  // Read the LZR verdict from 23-lzr.yaml of THIS run (Pass 23 runs before SYNTH, #3152).
  const lzrVerdictInfo = readLzrVerdict(workspacePath, ctx.passesDir);

  const prompt = buildSynthPrompt(priorSignals, appId, { targets: lzTargets, ...(lzMarketScan ? { marketScan: lzMarketScan } : {}) }, migrationScores);
  const raw = await llm.complete(prompt);

  // #3158: an unusable answer degrades this pass (SYNTH-00, not_applicable)
  // instead of throwing, which used to abort the whole assessment run.
  const degrade = (detail: string): PassResult => {
    console.warn(`[warn] SYNTH pass: ${detail}; pass degraded.\n${raw.slice(0, 200)}`);
    return llmInvalidResponseResult({
      id: 9, name: 'synthesis', signalPrefix: 'SYNTH', iter, assessedAt, detail,
      assessment: { prior_signals_analysed: priorSignals.length, coverage_score: computeCoverageScore(priorSignals), ...lzContext, ...scoreFields },
    });
  };

  const json = extractJsonObject(raw);
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return degrade('LLM response is not valid JSON');
  }
  const candidate = json as { signals?: unknown; assessment?: unknown };
  if (candidate.assessment === null || typeof candidate.assessment !== 'object' || Array.isArray(candidate.assessment)) {
    return degrade('LLM response has no assessment object');
  }
  const parsed: LlmPassResponse = {
    signals: Array.isArray(candidate.signals) ? (candidate.signals as LlmPassResponse['signals']) : [],
    assessment: candidate.assessment as LlmPassResponse['assessment'],
  };

  const sevenRRaw = parsed.assessment['seven_r_label'];
  const sevenR = canonicaliseSevenR(sevenRRaw);
  if (!sevenR) {
    return degrade(`invalid seven_r_label "${String(sevenRRaw)}"; expected one of ${[...VALID_7R].join(', ')}`);
  }
  // Stash back the canonical form so downstream consumers see PascalCase.
  parsed.assessment['seven_r_label'] = sevenR;
  if (sevenR !== sevenRRaw) {
    console.log(`[info] SYNTH pass: normalised seven_r_label "${String(sevenRRaw)}" -> "${sevenR}"`);
  }

  // #4481: the landing zone the LLM names must be a selected target.
  const llmLz = parsed.assessment['landing_zone'];
  if (typeof llmLz === 'string' && llmLz.trim() !== '' && !landingZoneInSelection(llmLz, lzTargets)) {
    console.warn(`[warn] SYNTH pass: landing_zone "${llmLz.slice(0, 60)}" is not a landing zone selected for this run; cleared.`);
    parsed.assessment['landing_zone'] = '';
  }

  const modernizationPosition = parsed.assessment['modernization_position'];
  if (typeof modernizationPosition !== 'string' || modernizationPosition.length === 0) {
    return degrade(
      'modernization_position missing or not a non-empty string (canonical: invest_modernize_now, ' +
      'migrate_stabilize, tolerate_contain, retire_replace)',
    );
  }

  // #3431: portability_score / cloud_native_score are code-set. A value the
  // model still returns (older prompt habits, stubs) is discarded below; the
  // optional portability_comment is kept when it is a short string.
  const comment = parsed.assessment['portability_comment'];
  delete parsed.assessment['portability_comment'];
  delete parsed.assessment['portability_score'];
  delete parsed.assessment['cloud_native_score'];
  const portabilityComment = typeof comment === 'string' && comment.trim().length > 0
    ? comment.trim().slice(0, 300)
    : undefined;

  // Apply LZR adjustment to the 7R label and emit lzr_adjustment block
  const { adjustedLabel, lzrAdjustment } = applyLzrAdjustment(sevenR, lzrVerdictInfo);

  const signals: Signal[] = parsed.signals.map(s => ({
    ...normalizeSignal(s),
    synthesis: true,
  }));

  const coverageScore = computeCoverageScore(priorSignals);

  return {
    pass: {
      id: 9,
      name: 'synthesis',
      signal_prefix: 'SYNTH',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      ...parsed.assessment,
      seven_r_label: adjustedLabel,
      lzr_adjustment: lzrAdjustment,
      coverage_score: coverageScore,
      prior_signals_analysed: priorSignals.length,
      ...lzContext,
      ...(portabilityComment ? { portability_comment: portabilityComment } : {}),
      ...scoreFields,
    },
  };
}

/**
 * #3431: the synth assessment fields for the deterministic scores. The
 * legacy keys portability_score / cloud_native_score stay (now code-set);
 * the breakdowns are additive. A score that could not be computed is absent.
 */
export function migrationScoreFields(scores: MigrationScores): Record<string, unknown> {
  const out: Record<string, unknown> = { migration_scores_catalogue: scores.catalogue };
  if (scores.cloud_native) {
    out['cloud_native_score'] = scores.cloud_native.score;
    out['cloud_native'] = scores.cloud_native;
  } else if (scores.cloud_native_skipped_reason) {
    out['cloud_native_skipped_reason'] = scores.cloud_native_skipped_reason;
  }
  if (scores.portability) {
    if (scores.portability.score !== null) out['portability_score'] = scores.portability.score;
    out['portability'] = scores.portability;
  }
  return out;
}
