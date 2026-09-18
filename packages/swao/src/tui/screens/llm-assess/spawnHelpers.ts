// spawnChallenge + spawnLzChallenge -- extracted from LlmAssessmentScreen.tsx
// (#2376). Pure async spawn wrappers; no React state.

import { spawn } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
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

  type AgentEntry = { agent_id?: string; [k: string]: unknown };
  let agentData: Array<AgentEntry> = [];
  const reportPath = join(workspacePath, 'apps', selectedAppId, 'wsp', 'challenge-app', 'combined.yaml');
  if (existsSync(reportPath)) {
    agentData = (load(readFileSync(reportPath, 'utf-8')) as { reports?: AgentEntry[] })?.reports ?? [];
  } else {
    const challengeAppDir = join(workspacePath, 'apps', selectedAppId, 'wsp', 'challenge-app');
    if (existsSync(challengeAppDir)) {
      const tsDir = readdirSync(challengeAppDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name))[0];
      if (tsDir) {
        const aaFiles = readdirSync(join(challengeAppDir, tsDir.name))
          .filter(f => f.startsWith('AA_') && f.endsWith('.yaml'));
        for (const f of aaFiles) {
          try {
            const parsed = load(readFileSync(join(challengeAppDir, tsDir.name, f), 'utf-8'));
            if (parsed && typeof parsed === 'object') agentData.push(parsed as AgentEntry);
          } catch { /* skip malformed */ }
        }
      }
    }
  }
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

  const lzBaseDir = join(workspacePath, 'apps', selectedAppId, 'wsp', 'challenge-lz');
  const lzAgentData: Array<{ agent_id: string }> = [];
  if (existsSync(lzBaseDir)) {
    const tsDirs = readdirSync(lzBaseDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}T/.test(d))
      .sort()
      .reverse();
    const latestDir = tsDirs[0];
    if (latestDir) {
      const files = readdirSync(join(lzBaseDir, latestDir))
        .filter(f => f.startsWith('LZCA_') && f.endsWith('.yaml'));
      for (const f of files) {
        lzAgentData.push({ agent_id: f.replace(/^LZCA_/, '').replace(/\.yaml$/, '') });
      }
    }
  }
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
