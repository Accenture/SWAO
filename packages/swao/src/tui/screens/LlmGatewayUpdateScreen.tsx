// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, TUI wrapper for `swao llm-gateway update`
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
// #4257 (TUI-13, Design 126 sections 3, 4.6 and 4.8): on ScreenLayout; the
// output through RunOutput, the result as a StatusRow, Esc cancels while
// running (Q-09), Enter or Esc goes back when done; the CLI only in the
// guidance `cli` field.

import { useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { KEY_HINTS, RunOutput, ScreenLayout, StatusRow, guidanceOwnsKey, tone, type GuidanceEntry, type KeyHint } from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { findWorkspace } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';

type Phase = 'running' | 'done';

/** The keys per phase: Esc cancels the run; Enter or Esc goes back when done. */
export function llmGatewayUpdateKeys(phase: Phase): readonly KeyHint[] {
  return phase === 'running' ? KEY_HINTS.run : [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];
}

export const LLM_GATEWAY_UPDATE_GUIDANCE: GuidanceEntry = {
  title: 'Update LLM Gateway',
  what: 'Copies new packaged connectors into wsp/inputs/llm-gateway/ and refreshes any seed you have not edited. Connectors you changed are kept untouched. Run this after upgrading the SWAO binary.',
  sections: [{ label: 'Connectors', text: 'wsp/inputs/llm-gateway/ (one file per connector)' }],
  cli: 'swao llm-gateway update',
};

export interface LlmGatewayUpdateScreenProps {
  onBack: () => void;
}

export function LlmGatewayUpdateScreen({ onBack }: LlmGatewayUpdateScreenProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('running');
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const header = useScreenHeader('Update LLM Gateway');
  const guidanceOpenRef = useRef(false);
  const backRef = useRef(false);

  useEffect(() => {
    if (phase !== 'running') return;
    const workspace = findWorkspace(process.cwd());
    const selfCmd = selfSpawnCommand(['llm-gateway', 'update']);
    const child = spawn(
      selfCmd.command,
      selfCmd.args,
      {
        cwd:         workspace ?? process.cwd(),
        env:         selfCmd.env,
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
    child.on('error', (err) => { setLines(prev => [...prev, err.message]); setExitCode(1); setPhase('done'); });
    child.on('close', (code) => { setExitCode(code ?? 0); setPhase('done'); });
    return () => { child.kill(); };
  }, [phase]);

  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (backRef.current) return;
    // Q-09: Esc cancels the update at once (the unmount stops the child).
    if ((phase === 'running' && key.escape) || (phase === 'done' && (key.return || key.escape))) {
      backRef.current = true;
      onBack();
    }
  });

  return (
    <ScreenLayout
      header={header}
      title={{ title: 'Update LLM Gateway', subtitle: 'Refresh the workspace connectors from the packaged seeds.' }}
      keys={llmGatewayUpdateKeys(phase)}
      guidance={{ entry: LLM_GATEWAY_UPDATE_GUIDANCE, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {phase === 'running' && <Text {...tone('muted')}>Refreshing the connectors...</Text>}
      {lines.length > 0 && <RunOutput lines={lines} maxLines={12} />}
      {phase === 'done' && (
        <StatusRow
          level={exitCode === 0 ? 'ok' : 'warn'}
          label="Update"
          summary={exitCode === 0 ? 'done' : `finished with warnings (exit ${exitCode ?? 'unknown'})`}
        />
      )}
    </ScreenLayout>
  );
}
