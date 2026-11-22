// spawnChallenge + spawnLzChallenge -- extracted from LlmAssessmentScreen.tsx
// (#2376). Pure async spawn wrappers; no React state.
// #4478: both start the challenge through the shared helper of the CLI
// (commands/llm-challenge-spawn.ts): PID to the orchestrator, and the
// challenge signal (Esc cancel or a fired challenge limit) kills the tree.

import type { ChallengePassResult, LegChallengeContext, LegSpawnHooks } from '@swao/module-llm-assessment';
import { runLegChallenge } from '../../../commands/llm-challenge-spawn.js';

export { cleanSkipExit } from '../../../commands/llm-challenge-spawn.js';

interface LegRef {
  connector: string;
  model:     string;
}

/**
 * #4277: the leg challenge runs in the LEG workspace (cwd legWorkspaceRoot)
 * on the leg's own application run (`ctx.runId`, #4291); the main workspace is never
 * written. `_workspacePath` stays for the call shape of the screen.
 */
export async function spawnChallenge(
  selectedAppId: string,
  _workspacePath: string,
  leg: LegRef,
  legWorkspaceRoot: string,
  legEnv: NodeJS.ProcessEnv,
  ctx?: LegChallengeContext,
  signal?: AbortSignal,
  hooks?: LegSpawnHooks,
): Promise<ChallengePassResult> {
  return (await runLegChallenge({
    kind: 'app', appId: selectedAppId, leg, legWorkspaceRoot, legEnv,
    ...(ctx ? { ctx } : {}), ...(signal ? { signal } : {}), ...(hooks ? { hooks } : {}),
  })).result;
}

export async function spawnLzChallenge(
  selectedAppId: string,
  _workspacePath: string,
  leg: LegRef,
  legWorkspaceRoot: string,
  legEnv: NodeJS.ProcessEnv,
  ctx?: LegChallengeContext,
  signal?: AbortSignal,
  hooks?: LegSpawnHooks,
): Promise<ChallengePassResult> {
  return (await runLegChallenge({
    kind: 'lz', appId: selectedAppId, leg, legWorkspaceRoot, legEnv,
    ...(ctx ? { ctx } : {}), ...(signal ? { signal } : {}), ...(hooks ? { hooks } : {}),
  })).result;
}
