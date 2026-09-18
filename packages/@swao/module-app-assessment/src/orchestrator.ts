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
import { runMalwarePass } from './passes/pass-14-malware.js';

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
  | 'scope';

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

// Ordered profile. Order here is the canonical pass order; the caller still
// honours the user-specified --passes order when iterating, using this map
// purely as the lookup table (mirrors the previous PASS_MAP semantics).
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
};

// Opt-in passes: recognized by getPass() but excluded from passKeys() so they
// do not run as part of the default pass profile. Users must request them
// explicitly via --passes <key>.
const OPT_IN_PASSES: Record<string, AppAssessmentPassDescriptor> = {
  malware: { num: '14', name: 'malware_scanning', runner: runMalwarePass, llmPassName: null },
};

export class AssessOrchestrator {
  /** Lookup a pass descriptor by key. Checks the default profile first, then
   *  the opt-in registry. Returns undefined for unknown keys (the caller warns
   *  and skips, preserving prior behaviour). */
  getPass(key: string): AppAssessmentPassDescriptor | undefined {
    return (PASS_PROFILE as Record<string, AppAssessmentPassDescriptor>)[key]
      ?? OPT_IN_PASSES[key];
  }

  /** Canonical ordered pass keys (the default pass profile). */
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
