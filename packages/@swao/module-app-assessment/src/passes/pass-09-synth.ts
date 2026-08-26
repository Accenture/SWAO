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
import { join } from 'path';
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { LlmPassResponse } from './types.js';
import type { Signal } from '@swao/core';
import { SIGNAL_SCHEMA_HINT, normalizeSignal } from '@swao/core';
import { llmSkipResult } from './llm-skip.js';
import type { LandingZoneResult } from '@swao/core';
import {
  resolveDefaultCataloguePath,
  loadCatalogue,
  deriveConstraints,
  matchLandingZone,
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

export function readLzrVerdict(workspacePath: string): LzrVerdictInfo {
  const lzrFile = join(resolvePassesDir(workspacePath), '23-lzr.yaml');
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

function buildSynthPrompt(priorSignals: Signal[], appId: string, recommendedProvider?: string): string {
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
    '  "modernization_position": "string", "portability_score": number, "confidence": "string",',
    '  "landing_zone": "string", "recommended_next_steps": ["string"], "migration_blockers": number,',
    '  "migration_enablers": ["string"] } }',
    '',
    'Signal IDs must use prefix SYNTH-NN.',
    'Emit SYNTH-01 (7R verdict), SYNTH-02 (7R rejection rationale), SYNTH-03 (key constraint).',
    'seven_r_label must be one of: Retire, Retain, Rehost, Replatform, Repurchase, Refactor, Re-architect.',
    'modernization_position is a strategic disposition; canonical values are invest_modernize_now,',
    '  migrate_stabilize, tolerate_contain, retire_replace.',
    '  Refinement variants are acceptable (e.g. invest_modernize_with_remediation).',
    'portability_score is a decimal 0.0-1.0. Definition: fraction of egress signals that have',
    '  sovereign-cloud equivalents, using formula (available + 0.5 * partial) / total_egress.',
    '  Sovereign-ready threshold is 0.70.',
    '  If no EGR signals exist: estimate from TF-* (twelve-factor) and CTX-* (IaC) signals.',
    '  Containerised + full IaC coverage => 0.8-1.0. No IaC + bare-metal deployment => 0.1-0.3.',
    '  Each CTX signal indicating vendor lock-in (proprietary SDK, managed PaaS, SaaS-only API)',
    '  reduces the score by 0.1-0.2. Absence of any signals => 0.5 (unknown).',
    'confidence is your confidence in the overall 7R verdict; one of: high, medium, low.',
    '  Reflect uncertainty when prior signals are sparse or contradictory.',
    'migration_blockers is an integer count.',
    '',
    SIGNAL_SCHEMA_HINT,
  ];

  if (recommendedProvider) {
    lines.push('', `Recommended landing zone from catalogue matching: ${recommendedProvider}`);
    lines.push('Use this provider name in your landing_zone field and migration_rationale.');
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

  return lines.join('\n');
}

export async function runSynthPass(ctx: PassContext): Promise<PassResult> {
  const { workspacePath, appId, iter, assessedAt, llm } = ctx;

  if (!llm) {
    // LLM-optional alignment (#0550): no provider configured -> graceful skip.
    return llmSkipResult({ id: 9, name: 'synthesis', signalPrefix: 'SYNTH', iter, assessedAt });
  }

  const priorSignals = loadPriorSignals(workspacePath, ctx.passesDir);

  // Landing zone matching sub-pass: runs before LLM call to inform the prompt
  let landingZoneResult: LandingZoneResult | undefined;
  try {
    const cataloguePath = resolveDefaultCataloguePath();
    const providers = loadCatalogue(cataloguePath);
    const constraints = deriveConstraints(priorSignals);
    const coverageScoreForLz = computeCoverageScore(priorSignals);
    landingZoneResult = matchLandingZone(providers, constraints, {}, coverageScoreForLz);
  } catch {
    // Catalogue unavailable (e.g. in CI without repo root): skip sub-pass silently
  }

  // Read LZR verdict from 23-lzr.yaml (if Pass 23 has already run)
  const lzrVerdictInfo = readLzrVerdict(workspacePath);

  const prompt = buildSynthPrompt(priorSignals, appId, landingZoneResult?.recommended_landing_zone);
  const raw = await llm.complete(prompt);

  let parsed: LlmPassResponse;
  try {
    parsed = JSON.parse(raw) as LlmPassResponse;
  } catch {
    throw new Error(`SYNTH pass: LLM response is not valid JSON.\n${raw.slice(0, 200)}`);
  }

  const sevenRRaw = parsed.assessment['seven_r_label'];
  const sevenR = canonicaliseSevenR(sevenRRaw);
  if (!sevenR) {
    throw new Error(`SYNTH pass: invalid seven_r_label "${String(sevenRRaw)}". Must be one of: ${[...VALID_7R].join(', ')} (case-insensitive; underscores normalised).`);
  }
  // Stash back the canonical form so downstream consumers see PascalCase.
  parsed.assessment['seven_r_label'] = sevenR;
  if (sevenR !== sevenRRaw) {
    console.log(`[info] SYNTH pass: normalised seven_r_label "${String(sevenRRaw)}" -> "${sevenR}"`);
  }

  const modernizationPosition = parsed.assessment['modernization_position'];
  if (typeof modernizationPosition !== 'string' || modernizationPosition.length === 0) {
    throw new Error(
      'SYNTH pass: modernization_position missing or not a non-empty string. ' +
      'Expected a strategic disposition (canonical: invest_modernize_now, migrate_stabilize, ' +
      'tolerate_contain, retire_replace).',
    );
  }

  const portabilityScore = parsed.assessment['portability_score'];
  if (typeof portabilityScore !== 'number' || !Number.isFinite(portabilityScore) ||
      portabilityScore < 0 || portabilityScore > 1) {
    throw new Error(
      `SYNTH pass: portability_score must be a decimal 0.0-1.0, got ${String(portabilityScore)}.`,
    );
  }

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
      ...(landingZoneResult ?? {}),
    },
  };
}
