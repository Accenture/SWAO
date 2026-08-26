// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Extractor for LLM Assessment publication models -- Design 092 s8, L5 (#1428).
//
// Reads llm-assessments/swao/<ts>/comparison/publication-model.json (written by
// the LLM Assessment orchestrator, #1421) and returns:
//   - a minimal PublicationModel stub (satisfies the engine contract), and
//   - the LlmPubData object (attached as a runtime extension field).
//
// The extra-field cast pattern (model['llm_assessment'] = llmData) mirrors the
// engagement-hub pattern used by renderHubPage in @swao/module-html-report; the
// llm block renderers (blocks/llm.ts) read it back via the same cast.
//
// Run directory structure (092 s7):
//   <workspace>/llm-assessments/swao/<ts>/comparison/publication-model.json
//   <workspace>/llm-assessments/swao/latest.txt  (pointer, kind-level)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicationModel } from './model.js';
import type { LlmPubData } from './llm-pub-data.js';

export interface ExtractLlmOptions {
  swaoVersion?: string;
  logger?: { warn(msg: string): void };
}

/**
 * Reads the LLM Assessment publication model from disk and returns a
 * {model, llmData} pair ready for use by `renderModeALlm`.
 *
 * @param workspaceRoot - Absolute path to the SWAO workspace root.
 * @param appId         - The assessed application ID.
 * @param runTs         - Optional run timestamp (e.g. '2026-08-06T10-00-00').
 *                        When omitted, the latest run is resolved from `latest.txt`.
 * @param opts          - Optional swaoVersion and logger.
 */
export function extractLlmAssessmentPublicationModel(
  workspaceRoot: string,
  appId: string,
  runTs?: string,
  opts?: ExtractLlmOptions,
): { model: PublicationModel; llmData: LlmPubData } {
  const llmRoot = join(workspaceRoot, 'llm-assessments', 'swao');

  // Resolve the run timestamp from latest.txt when not supplied explicitly.
  // Normalise ISO timestamps (colons, Z suffix) to the hyphenated dir format
  // the orchestrator writes on disk ("2026-08-11T13-38-08").
  let ts: string;
  if (runTs) {
    ts = runTs.replace(/:/g, '-').replace(/Z$/, '');
  } else {
    const latestFile = join(llmRoot, 'latest.txt');
    if (!existsSync(latestFile)) {
      throw new Error(
        `No LLM assessment runs found in ${llmRoot}. ` +
        `Run 'swao assess --type llm --app ${appId}' first.`,
      );
    }
    ts = readFileSync(latestFile, 'utf-8').trim();
  }

  const pubModelPath = join(llmRoot, ts, 'comparison', 'publication-model.json');
  if (!existsSync(pubModelPath)) {
    throw new Error(
      `LLM assessment publication model not found: ${pubModelPath}. ` +
      `Re-run the assessment to regenerate it.`,
    );
  }

  const raw = JSON.parse(readFileSync(pubModelPath, 'utf-8')) as Record<string, unknown>;

  // Build a minimal PublicationModel stub. The PublicationModelSchema does not
  // include LLM-specific fields; those arrive via the runtime extension (below).
  const model: PublicationModel = {
    contract_version: '1.1',
    meta: {
      app_id: appId,
      app_name: appId,
      assessed_at: (raw['created'] as string | undefined) ?? new Date().toISOString(),
      run_id: ts,
      swao_version: opts?.swaoVersion ?? 'unknown',
      engagement: { engagement_name: '', partnership_lead: '' },
      licensee: 'SWAO',
      tier: 'consultant',
      publication_config: {
        classification_band: '',
        logo_name: 'SWAO',
        logo_sub: 'LLM',
        footer_note: '',
        engagement_lead_label: '',
        primary_contact_label: '',
        secondary_contact_label: '',
      },
    },
    summary: {
      seven_r_label: '',
      coverage_score: 0,
      signal_counts: {},
      blocker_count: 0,
      top_findings: [],
    },
    signals: [],
    compliance: [],
    risk_register: [],
    runbook: [],
    evidence: [],
    input_files: [],
    tags: {},
    lzr: { overall: '', blockers: 0, checks: [] },
    run_history: [],
    block_profile: 'llm-assessment',
    assessment_type: 'llm',
  };

  const llmData: LlmPubData = {
    app_id: (raw['app_id'] as string | undefined) ?? appId,
    created: (raw['created'] as string | undefined) ?? model.meta.assessed_at,
    analysis_mode: (raw['analysis_mode'] as string | undefined) ?? 'serial',
    legs: (raw['legs'] as LlmPubData['legs'] | undefined) ?? [],
    weights: (raw['weights'] as Record<string, number> | undefined) ?? {},
    final: (raw['final'] as LlmPubData['final'] | undefined) ?? { score: {}, rank: {}, weights: {} },
    groups: (raw['groups'] as LlmPubData['groups'] | undefined) ?? [],
    passGroups: (raw['passGroups'] as LlmPubData['passGroups'] | undefined) ?? [],
    challengePassGroups: raw['challengePassGroups'] as LlmPubData['challengePassGroups'] | undefined,
    lzChallengePassGroups: raw['lzChallengePassGroups'] as LlmPubData['lzChallengePassGroups'] | undefined,
    // #1587: compute cross-leg resilience score from challengePassGroups DNF counts.
    challengeResilienceScore: (() => {
      const cpg = raw['challengePassGroups'] as LlmPubData['challengePassGroups'] | undefined;
      if (!cpg || cpg.length === 0) return undefined;
      let total = 0; let dnf = 0;
      for (const pg of cpg) {
        for (const agg of Object.values(pg.legs)) {
          total += agg.calls;
          dnf += agg.dnf;
        }
      }
      return total > 0 ? Math.round((1 - dnf / total) * 100) / 100 : undefined;
    })(),
    bucketViews: (raw['bucketViews'] as LlmPubData['bucketViews'] | undefined) ?? [],
    findings: (raw['findings'] as LlmPubData['findings'] | undefined) ?? [],
    narrative: raw['narrative'] as string | undefined,
    verdicts: raw['verdicts'] as Record<string, string | null> | undefined,
  };

  return { model, llmData };
}
