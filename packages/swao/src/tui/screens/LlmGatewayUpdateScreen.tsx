// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI wrapper for `swao llm-gateway update`
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3388 step 4 (Design 112 D-2): Tools -> Update LLM Gateway. Refreshes the
// workspace connectors from the packaged seeds (unchanged seeds updated,
// user-edited files kept, new connectors added). All tiers; no credentials.

import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { GuidanceBox, LiveOutput } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { findWorkspace } from '@swao/core';

type Phase = 'running' | 'done';

export interface LlmGatewayUpdateScreenProps {
  onBack: () => void;
}

export function LlmGatewayUpdateScreen({ onBack }: LlmGatewayUpdateScreenProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('running');
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    if (phase !== 'running') return;
    const workspace = findWorkspace(process.cwd());
    const IS_PKG = Boolean((process as { pkg?: unknown }).pkg);
    const child = spawn(
      process.execPath,
      [...(IS_PKG ? [] : [process.argv[1] ?? '']), 'llm-gateway', 'update'],
      {
        cwd:         workspace ?? process.cwd(),
        env:         { ...process.env, PKG_EXECPATH: '' },
        stdio:       ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const append = (data: Buffer) => {
      const chunks = data.toString().split('\n').filter(l => l.length > 0);
      if (chunks.length > 0) setLines(prev => [...prev, ...chunks]);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err) => { setLines(prev => [...prev, `[error] ${err.message}`]); setExitCode(1); setPhase('done'); });
    child.on('close', (code) => { setExitCode(code ?? 0); setPhase('done'); });
    return () => { child.kill(); };
  }, [phase]);

  useInput((_input, key) => {
    if (phase === 'done' && (key.return || key.escape)) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Update LLM Gateway" />
      <Text>Refreshing workspace connectors from the packaged seeds...</Text>
      <Box marginTop={1}>
        <LiveOutput lines={lines} maxLines={12} maxWidth={100} label="Output" />
      </Box>
      {phase === 'done' && (
        <Box marginTop={1}>
          <Text color={exitCode === 0 ? 'green' : 'yellow'}>
            {exitCode === 0 ? 'Done.' : `Finished with warnings (exit ${exitCode ?? '?'}).`}  Press Enter or Esc to return.
          </Text>
        </Box>
      )}
      <GuidanceBox
        title="Update LLM Gateway"
        what="Copies new packaged connectors into wsp/inputs/llm-gateway/ and refreshes any seed you have not edited. Connectors you changed are kept untouched. Run this after upgrading the SWAO binary."
        affordances={['Enter/Esc -- back']}
      />
    </Box>
  );
}
