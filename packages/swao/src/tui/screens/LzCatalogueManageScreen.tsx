// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #1436 -- TUI parity for user-editable LZ catalogues (copy/new/list-with-origin).
// Community-tier accessible (no cloud credentials required).

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { GuidanceBox, LiveOutput, SelectInput } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { findWorkspace } from '@swao/core';
import { resolveLzCataloguesDir, loadLzCatalogueIndex } from '@swao/module-landing-zone';

type Action = 'list' | 'copy' | 'new';
type Phase = 'select-action' | 'input-provider' | 'running' | 'done';

interface ActionOption {
  label: string;
  value: Action;
  detail: string;
}

const ACTIONS: ActionOption[] = [
  {
    label: 'list           -- show all catalogues with origin (workspace | bundled)',
    value: 'list',
    detail: 'swao lz catalogue list --origin',
  },
  {
    label: 'copy <provider> -- copy bundled seed to workspace for editing',
    value: 'copy',
    detail: 'swao lz catalogue copy <provider>',
  },
  {
    label: 'new <provider>  -- scaffold an empty catalogue for a new provider',
    value: 'new',
    detail: 'swao lz catalogue new <provider>',
  },
];

// Provider list is built dynamically from the bundled lz-catalogues/index.json.
// Adding a catalogue to index.json is sufficient -- no code change required here.
function buildManageProviderOptions(): Array<{ label: string; value: string }> {
  const opts: Array<{ label: string; value: string }> = [];
  const dir = resolveLzCataloguesDir();
  if (dir) {
    try {
      const { catalogues } = loadLzCatalogueIndex(dir);
      for (const c of catalogues) {
        const pad = c.provider.padEnd(12);
        const desc = c.short_description ?? c.name;
        opts.push({ label: `${pad}-- ${desc}`, value: c.provider });
      }
    } catch { /* bundled index unreadable; fall back to empty list */ }
  }
  opts.push({ label: 'other       -- type a custom provider id', value: '__custom__' });
  return opts;
}

const PROVIDER_OPTIONS = buildManageProviderOptions();

export interface LzCatalogueManageScreenProps {
  onBack: () => void;
}

export function LzCatalogueManageScreen({ onBack }: LzCatalogueManageScreenProps) {
  const [phase, setPhase]               = useState<Phase>('select-action');
  const [selectedAction, setAction]     = useState<Action | null>(null);
  const [selectedProvider, setProvider] = useState<string>('');
  const [lines, setLines]               = useState<string[]>([]);
  const [exitCode, setExitCode]         = useState<number | null>(null);
  const guidanceOpenRef                 = useRef(false);

  useEffect(() => {
    if (phase !== 'running' || !selectedAction) return;

    const workspace = findWorkspace(process.cwd());
    const selfPath  = process.argv[1] ?? '';
    const args: string[] = ['lz', 'catalogue', selectedAction];
    if (selectedAction !== 'list') args.push(selectedProvider);
    if (selectedAction === 'list') args.push('--origin');

    const child = spawn(
      process.execPath,
      [selfPath, ...args],
      {
        cwd:         workspace ?? process.cwd(),
        stdio:       ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    const appendLines = (data: Buffer) => {
      const chunks = data.toString().split('\n').filter(l => l.length > 0);
      if (chunks.length > 0) setLines(prev => [...prev, ...chunks]);
    };

    child.stdout?.on('data', appendLines);
    child.stderr?.on('data', appendLines);
    child.on('close', (code) => {
      setExitCode(code ?? 0);
      setPhase('done');
    });

    return () => { child.kill(); };
  }, [phase]);

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.escape) {
      if (phase === 'select-action' || phase === 'done') { onBack(); return; }
      if (phase === 'input-provider') { setPhase('select-action'); return; }
    }
    if (phase === 'done' && key.return) { onBack(); return; }
    void input;
  });

  function handleActionSelect(val: string): void {
    const action = val as Action;
    setAction(action);
    setLines([]);
    setExitCode(null);
    if (action === 'list') {
      setPhase('running');
    } else {
      setPhase('input-provider');
    }
  }

  function handleProviderSelect(val: string): void {
    if (val === '__custom__') return; // TextInput not wired -- select a known option
    setProvider(val);
    setPhase('running');
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Manage LZ Catalogues" />

      {phase === 'select-action' && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Copy bundled catalogues to your workspace for editing, scaffold new providers, or list current origins.</Text>
          <Box marginTop={1}>
            <SelectInput
              label="Select action"
              options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
              onSelect={handleActionSelect}
              active
            />
          </Box>
        </Box>
      )}

      {phase === 'input-provider' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Action: <Text color="cyanBright" bold>{selectedAction}</Text></Text>
          <Box marginTop={1}>
            <SelectInput
              label="Select provider"
              options={PROVIDER_OPTIONS}
              onSelect={handleProviderSelect}
              active
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Esc -- back to action select</Text>
          </Box>
        </Box>
      )}

      {phase === 'running' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Running <Text color="cyanBright">swao lz catalogue {selectedAction}{selectedProvider ? ` ${selectedProvider}` : ' --origin'}</Text>...</Text>
          <LiveOutput lines={lines} maxLines={25} label="Output" />
        </Box>
      )}

      {phase === 'done' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={exitCode === 0 ? 'green' : 'red'}>
            {exitCode === 0 ? 'Done.' : 'Command failed. See output above.'}
          </Text>
          <LiveOutput lines={lines} maxLines={40} label="Output" />
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Esc to return to Tools.</Text>
          </Box>
        </Box>
      )}

      <GuidanceBox
        title="Manage LZ Catalogues"
        what={
          'Manage landing-zone service catalogues for your workspace. ' +
          'copy: materialise a bundled seed into your workspace for editing. ' +
          'new: scaffold a blank catalogue for a sovereign or private cloud provider not in the bundled set. ' +
          'list --origin: show all available providers with their resolved source (workspace or bundled).'
        }
        details={[
          {
            label: 'Resolution order',
            value:
              'workspace wsp/inputs/catalogs/lz-catalogues/ takes precedence over the bundled binary seed on a per-provider basis. ' +
              'Editing a workspace file only affects this workspace; bundled files are unchanged.',
          },
          {
            label: 'Validation',
            value:
              'Workspace files are strictly schema-validated on every assessment run. ' +
              'A broken edit produces a named parse error rather than silently falling back to the bundled seed. ' +
              'Run `swao health-check` after editing to confirm the file loads correctly.',
          },
          {
            label: 'User guide',
            value: 'See the Adapting LZ Catalogues runbook in the SWAO documentation for the full editing guide.',
          },
        ]}
        onOpenChange={(open: boolean) => { guidanceOpenRef.current = open; }}
      />
    </Box>
  );
}
