// spawnChallenge + spawnLzChallenge -- extracted from LlmAssessmentScreen.tsx
// (#2376). Pure async spawn wrappers; no React state.

import { spawn } from 'child_process';
import { join } from 'path';
import { readLegChallengeAgents } from '../../../commands/llm-leg-challenge.js';
import type { ChallengePassResult } from '@swao/module-llm-assessment';

interface LegRef {
  connector: string;
  model:     string;
}

interface SpawnResult {
  exitCode: number | null;
}

function spawnProcess(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...env, PKG_EXECPATH: '' },
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => res({ exitCode: null }));
    child.on('exit', (code) => res({ exitCode: code }));
  });
}

export async function spawnChallenge(
  selectedAppId: string,
  workspacePath: string,
  leg: LegRef,
  _legWorkspaceRoot: string,
  legEnv: NodeJS.ProcessEnv,
): Promise<ChallengePassResult> {
  const challengeStarted = Date.now();
  const isPkg = Boolean((process as { pkg?: unknown }).pkg);
  const cmd = process.execPath;
  const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
  const args = [
    ...baseArgs,
    'challenge', '--app', selectedAppId, '--all-agents', '--report',
    '--connector', leg.connector,
    ...(leg.model !== 'default' ? ['--model', leg.model] : []),
  ];
  const spawnResult = await spawnProcess(cmd, args, workspacePath, legEnv);
  const durationMs = Date.now() - challengeStarted;

  // #3336: only the challenge this leg's subprocess wrote counts; the run id
  // is ignored by design (every leg challenges the main run).
  const agentData = readLegChallengeAgents(join(workspacePath, 'apps', selectedAppId, 'wsp'), 'app', challengeStarted).agents;
  return {
    completed_at: new Date().toISOString(),
    agents: agentData.map((a) => ({
      agent_id: String(a['agent_id'] ?? 'unknown'),
      calls: 1,
      dnf: spawnResult.exitCode !== 0,
      duration_ms: Math.round(durationMs / Math.max(agentData.length, 1)),
    })),
    exit_code: spawnResult.exitCode,
  };
}

export async function spawnLzChallenge(
  selectedAppId: string,
  workspacePath: string,
  leg: LegRef,
  _legWorkspaceRoot: string,
  legEnv: NodeJS.ProcessEnv,
): Promise<ChallengePassResult> {
  const lzStarted = Date.now();
  const isPkg = Boolean((process as { pkg?: unknown }).pkg);
  const cmd = process.execPath;
  const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
  const args = [
    ...baseArgs,
    'challenge', '--type', 'lz', '--app', selectedAppId, '--all-agents',
    '--connector', leg.connector,
    ...(leg.model !== 'default' ? ['--model', leg.model] : []),
  ];
  const spawnResultLz = await spawnProcess(cmd, args, workspacePath, legEnv);
  const durationMsLz = Date.now() - lzStarted;

  // #3336: the challenge-lz/<ts>/ folder this leg wrote (run id ignored by design).
  const lzAgentData = readLegChallengeAgents(join(workspacePath, 'apps', selectedAppId, 'wsp'), 'lz', lzStarted).agents
    .map(a => ({ agent_id: String(a.agent_id ?? 'unknown') }));
  return {
    completed_at: new Date().toISOString(),
    agents: lzAgentData.map((a) => ({
      agent_id: String(a.agent_id),
      calls: 1,
      dnf: spawnResultLz.exitCode !== 0,
      duration_ms: Math.round(durationMsLz / Math.max(lzAgentData.length, 1)),
    })),
    exit_code: spawnResultLz.exitCode,
  };
}
