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

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import {
  BlindSpotsCatalogueSchema,
  type BlindSpotsCatalogue,
  type BlindSpotEntry,
} from '../schema/blind-spots-catalogue.js';
import type { BlindSpotEntryResult, ScopeCoverage } from '@swao/core';

// Sprint 029 Phase 1 (#0263) -- Pass 13 Scope Coverage.
//
// Deterministic rule-engine pass; no LLM cost. For each entry in the
// blind-spots catalogue:
//   1. Walk `input_paths` (relative to apps/<id>/).
//   2. If any path exists and is non-empty, mark coverage closed.
//   3. If absent and catalogue's current_swao_coverage is "partial",
//      mark coverage partial. (Spec ambiguity resolved Option B: input
//      present overrides partial baseline -> closed.)
//   4. Otherwise mark coverage open.
//
// Emits one SCOPE-<id> signal per blind spot plus a `scope_coverage`
// block on the assessment for derive-plan to surface in wsp-plan.yaml.
//
// coverage_ratio formula: (closed + 0.5 * partial) / total. Pinned
// here to a single computation; downstream code should not re-implement.

const PASS_ID = 13;
const PASS_NAME = 'scope_coverage';
const SIGNAL_PREFIX = 'SCOPE';

// ---------------------------------------------------------------------------
// Catalogue resolution + load
// ---------------------------------------------------------------------------

export function resolveDefaultBlindSpotsCataloguePath(): string {
  // The catalogue lives at `swao/controls/blind-spots-catalogue.yaml`.
  // Reaching it depends on the runtime layout. Since this pass moved into
  // @swao/module-app-assessment (#0548), the package nests one level deeper
  // than @swao/swao, so the dev paths are 5 levels up:
  //
  //   module src (vitest)    -> __dirname = packages/@swao/module-app-assessment/src/passes  (5 up)
  //   module compiled (tsc)  -> __dirname = packages/@swao/module-app-assessment/dist/passes (5 up)
  //   bundled (pkg snapshot) -> __dirname = packages/swao/dist (3 up; esbuild collapses the
  //                             module's code into swao's bundle.cjs)
  //
  // Try candidate path-lengths (5 for module dev, 4 for the legacy swao
  // layout, 3 for the bundle) and return the first that exists.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, '../../../../../controls/blind-spots-catalogue.yaml'),
    resolve(__dirname, '../../../../controls/blind-spots-catalogue.yaml'),
    resolve(__dirname, '../../../controls/blind-spots-catalogue.yaml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] as string;
}

export function loadBlindSpotsCatalogue(cataloguePath: string): BlindSpotsCatalogue {
  const raw = readFileSync(cataloguePath, 'utf-8');
  const parsed = load(raw) as unknown;
  return BlindSpotsCatalogueSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Input-path detection
// ---------------------------------------------------------------------------

// `input_paths` is interpreted relative to apps/<id>/. The runner walks
// each candidate; if any is present AND has content (file with bytes, or
// directory containing at least one non-empty entry), the blind spot
// closes. Empty dirs and empty files do NOT close a blind spot --
// that prevents accidental `mkdir wsp/inputs/iam` from suggesting a
// closed gap.
//
// Exported for the unit tests.
export function inputPathSatisfied(workspaceAppDir: string, relativePath: string): boolean {
  const abs = join(workspaceAppDir, relativePath);
  if (!existsSync(abs)) return false;
  let stat;
  try { stat = statSync(abs); } catch { return false; }
  if (stat.isFile()) return stat.size > 0;
  if (stat.isDirectory()) {
    try {
      const entries = readdirSync(abs);
      // Empty directory does not count.
      if (entries.length === 0) return false;
      // At least one entry must be a non-empty file or non-empty subdir.
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const child = join(abs, entry);
        let childStat;
        try { childStat = statSync(child); } catch { continue; }
        if (childStat.isFile() && childStat.size > 0) return true;
        if (childStat.isDirectory()) return true;  // recursive non-empty check is overkill; one subdir is enough signal
      }
      return false;
    } catch { return false; }
  }
  return false;
}

function firstSatisfiedPath(workspaceAppDir: string, paths: string[]): string | null {
  for (const p of paths) {
    if (inputPathSatisfied(workspaceAppDir, p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-entry evaluation
// ---------------------------------------------------------------------------

export interface BlindSpotEvaluation {
  entry: BlindSpotEntry;
  coverage: 'closed' | 'partial' | 'open';
  inputProvided: string | null;
}

export function evaluateBlindSpot(
  workspaceAppDir: string,
  entry: BlindSpotEntry,
): BlindSpotEvaluation {
  const inputProvided = firstSatisfiedPath(workspaceAppDir, entry.input_paths);
  if (inputProvided !== null) {
    // Input present: closes regardless of baseline. (Option B per
    // post-advisor design clarification in #0263 issue body.)
    return { entry, coverage: 'closed', inputProvided };
  }
  // No input: baseline determines status.
  if (entry.current_swao_coverage === 'partial') {
    return { entry, coverage: 'partial', inputProvided: null };
  }
  if (entry.current_swao_coverage === 'full') {
    // current_swao_coverage='full' without input still counts as closed
    // (SWAO covers it natively). Unlikely in the v1 catalogue but the
    // schema permits it.
    return { entry, coverage: 'closed', inputProvided: null };
  }
  return { entry, coverage: 'open', inputProvided: null };
}

// ---------------------------------------------------------------------------
// Aggregate -> scope_coverage block
// ---------------------------------------------------------------------------

export function buildScopeCoverage(
  catalogue: BlindSpotsCatalogue,
  evaluations: BlindSpotEvaluation[],
  assessedAt: string,
): ScopeCoverage {
  const counts = { closed: 0, partial: 0, open: 0 };
  for (const ev of evaluations) counts[ev.coverage] += 1;
  const total = evaluations.length;
  // Formula pinned: (closed + 0.5 * partial) / total. Zero-protected.
  const ratio = total === 0 ? 0 : (counts.closed + 0.5 * counts.partial) / total;

  const blindSpotResults: BlindSpotEntryResult[] = evaluations.map((ev) => ({
    id: ev.entry.id,
    name: ev.entry.name,
    category: ev.entry.category,
    coverage: ev.coverage,
    severity: ev.entry.severity_default,
    input_required: ev.coverage === 'open' ? ev.entry.input_path_hint : undefined,
    input_provided: ev.inputProvided ?? undefined,
    partial_coverage_note: ev.coverage === 'partial' && ev.entry.current_swao_coverage === 'partial'
      ? `SWAO covers a subset (${ev.entry.input_that_closes}); supply ${ev.entry.input_path_hint} to close fully.`
      : undefined,
    related_regimes: ev.entry.related_regimes,
    assessor: 'rule_engine',
    assessed_at: assessedAt,
  }));

  return {
    catalogue_version: catalogue.catalogue_version,
    total_blind_spots: total,
    closed: counts.closed,
    partial: counts.partial,
    open: counts.open,
    coverage_ratio: Math.round(ratio * 10000) / 10000,  // 4 decimal places
    blind_spots: blindSpotResults,
  };
}

// ---------------------------------------------------------------------------
// Signal emission
// ---------------------------------------------------------------------------

const COVERAGE_TO_SEVERITY: Record<'closed' | 'partial' | 'open', Signal['severity']> = {
  closed: 'positive',
  partial: 'medium',
  open: 'medium',   // overridden below by entry.severity_default when open
};

const COVERAGE_TO_OUTCOME: Record<'closed' | 'partial' | 'open', Signal['outcome']> = {
  closed: 'positive',
  partial: 'indeterminate',
  open: 'indeterminate',
};

// Blind-spot categories are free-form taxonomy in the catalogue
// (network, secrets, detection, ...). Signal.category is constrained
// to the four Stage-D signal taxonomies; map accordingly.
function mapToSignalCategory(blindSpotCategory: string): Signal['category'] {
  switch (blindSpotCategory) {
    case 'process':
    case 'governance':
    case 'contractual':
      return 'business_processes';
    default:
      return 'infrastructure_platform';
  }
}

function buildScopeSignal(ev: BlindSpotEvaluation, index: number, assessedAt: string): Signal {
  // Signal ID matches PREFIX-NN per SIGNAL_ID_REGEX. The blind-spot's
  // semantic identifier (BS_NETWORK_POLICY etc.) is carried in
  // signal_ref so downstream code can join SCOPE-NN to a catalogue row.
  const id = `SCOPE-${String(index + 1).padStart(2, '0')}`;
  const severity = ev.coverage === 'open' ? ev.entry.severity_default : COVERAGE_TO_SEVERITY[ev.coverage];
  let derivation: string;
  if (ev.coverage === 'closed') {
    derivation = `Blind-spot ${ev.entry.id} (${ev.entry.name}) is in scope: ${ev.inputProvided ?? 'native SWAO coverage'} provides the input that closes it.`;
  } else if (ev.coverage === 'partial') {
    derivation = `Blind-spot ${ev.entry.id} (${ev.entry.name}) is partially covered: SWAO assesses a baseline subset (${ev.entry.input_that_closes}); the rest needs ${ev.entry.input_path_hint} to close fully.`;
  } else {
    derivation = `Blind-spot ${ev.entry.id} (${ev.entry.name}) is out of scope for this assessment. Closure needs: ${ev.entry.input_path_hint}.`;
  }
  return {
    id,
    source: 'static_analysis',
    category: mapToSignalCategory(ev.entry.category),
    severity,
    outcome: COVERAGE_TO_OUTCOME[ev.coverage],
    confidence: 'high',
    assessor: 'rule_engine',
    assessed_at: assessedAt,
    derivation,
    evidence: ev.inputProvided ? [ev.inputProvided] : [],
    // implies carries the catalogue link in shape `blind_spot_<coverage>:<BS_ID>`
    // so downstream code can join SCOPE-NN signals back to their catalogue
    // row. signal_ref intentionally not set: it requires the SIGNAL_ID_REGEX
    // shape, and BS_* ids are catalogue IDs not signal IDs.
    implies: [`blind_spot_${ev.coverage}:${ev.entry.id}`],
  };
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export async function runScopePass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt } = ctx;
  // Pass 13 reads inputs at apps/<id>/wsp/inputs/. PassContext's
  // workspacePath IS apps/<id>/ when invoked by the assess command.
  // sourcePath is the cloned source tree; not used here.
  void sourcePath;

  const cataloguePath = resolveDefaultBlindSpotsCataloguePath();
  let catalogue: BlindSpotsCatalogue;
  try {
    catalogue = loadBlindSpotsCatalogue(cataloguePath);
  } catch (err) {
    // Catalogue unreachable (e.g. in-tree test isolation): emit a single
    // SCOPE-CATALOGUE-UNREACHABLE signal and an empty scope_coverage block
    // so the report and doctor still render something coherent.
    const signal: Signal = {
      id: 'SCOPE-99',  // sentinel id reserved for catalogue-unreachable
      source: 'static_analysis',
      category: 'business_processes',
      severity: 'informational',
      outcome: 'indeterminate',
      confidence: 'low',
      assessor: 'rule_engine',
      assessed_at: assessedAt,
      derivation: `Blind-spots catalogue could not be loaded from ${cataloguePath}: ${(err as Error).message}. Scope coverage report skipped.`,
      evidence: [],
      implies: ['scope_catalogue_unreachable'],
    };
    return {
      pass: { id: PASS_ID, name: PASS_NAME, signal_prefix: SIGNAL_PREFIX, status: 'complete', iter, assessed_at: assessedAt },
      signals: [signal],
      assessment: { scope_coverage: {
        catalogue_version: 'unknown',
        total_blind_spots: 0, closed: 0, partial: 0, open: 0,
        coverage_ratio: 0, blind_spots: [],
      } },
    };
  }

  const evaluations = catalogue.blind_spots.map((entry) => evaluateBlindSpot(workspacePath, entry));
  const scopeCoverage = buildScopeCoverage(catalogue, evaluations, assessedAt);
  const signals = evaluations.map((ev, i) => buildScopeSignal(ev, i, assessedAt));

  return {
    pass: { id: PASS_ID, name: PASS_NAME, signal_prefix: SIGNAL_PREFIX, status: 'complete', iter, assessed_at: assessedAt },
    signals,
    assessment: { scope_coverage: scopeCoverage },
  };
}
