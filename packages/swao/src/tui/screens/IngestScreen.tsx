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

// #0967 -- TUI wrapper for `swao ingest`.
// Classifies + extracts files from ingestion/ before a full assessment.

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspace } from '@swao/core';
import { GuidanceBox } from '@swao/tui-kit';
import { Header } from '../components/Header.js';

type Phase = 'running' | 'done';

/** Finds the first app under <workspace>/apps/ that contains an ingestion/ subfolder. */
export function discoverIngestApp(workspace: string): string | undefined {
  const appsDir = join(workspace, 'apps');
  if (!existsSync(appsDir)) return undefined;
  try {
    return readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(appsDir, d.name, 'ingestion')))
      .map(d => d.name)[0];
  } catch { return undefined; }
}

export interface IngestScreenProps {
  onBack: () => void;
  /** App id to pass via --app (optional; omit for workspace-level). */
  appId?: string;
}

export function IngestScreen({ onBack, appId }: IngestScreenProps) {
  const [lines, setLines]     = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [phase, setPhase]     = useState<Phase>('running');
  const donePressRef          = useRef(false);

  useInput((input, key) => {
    if (phase !== 'done') return;
    if (donePressRef.current) return;
    if (key.return || key.escape || input === 'q') {
      donePressRef.current = true;
      onBack();
    }
  });

  useEffect(() => {
    const workspace = findWorkspace(process.cwd());
    const isPkg = Boolean((process as { pkg?: unknown }).pkg);
    const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
    const args = ['ingest'];
    if (workspace) args.push('--workspace', workspace);
    // Resolve app: explicit prop wins; otherwise auto-discover from apps/ directory.
    // The ingest command only auto-detects ingestion/ at workspace root, not under apps/<id>/.
    const resolvedApp = appId ?? (workspace ? discoverIngestApp(workspace) : undefined);
    if (resolvedApp) args.push('--app', resolvedApp);

    const child = spawn(process.execPath, [...baseArgs, ...args], {
      env: { ...process.env, PKG_EXECPATH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const appendLine = (raw: string) => {
      const trimmed = raw.trimEnd();
      if (trimmed) setLines((prev) => [...prev, trimmed]);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) appendLine(line);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) appendLine(line);
    });
    child.on('close', (code) => {
      setExitCode(code ?? 0);
      setPhase('done');
    });

    return () => { child.kill(); };
  }, [appId]);

  const succeeded = exitCode === 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Ingest Files" />
      <Box marginTop={1}>
        <Text bold color="cyanBright">Ingestion pre-processor</Text>
        {phase === 'running' && <Text dimColor>  running...</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {lines.slice(-30).map((l, i) => (
          <Text key={i} color={l.startsWith('[warn]') ? 'yellow' : l.startsWith('[ok]') ? 'green' : undefined}>
            {l}
          </Text>
        ))}
      </Box>
      {phase === 'done' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={succeeded ? 'green' : 'red'}>
            {succeeded ? '[ok]  Ingestion complete' : `[fail]  Ingestion exited with code ${exitCode}`}
          </Text>
        </Box>
      )}
      <GuidanceBox
        title="Ingestion details"
        what={succeeded || phase === 'running'
          ? 'Classifies and extracts files from the app ingestion/ folder into structured wsp/inputs/ tree. Run before an assessment to pre-process PDFs, spreadsheets, and other documents.'
          : 'Ingestion failed. Check the output above for error details. Common causes: unsupported file format, missing ingestion/ folder, or a permissions issue on wsp/inputs/.'}
        details={[
          { label: 'Input',  value: 'apps/<app>/ingestion/  (drop files here before running)' },
          { label: 'Output', value: 'apps/<app>/wsp/inputs/  (normalised files, ready for CTX pass)' },
        ]}
        affordances={phase === 'done' ? ['Enter / Esc / Q -- back to Tools menu'] : []}
      />
      {phase === 'done' && (
        <Box marginTop={1}>
          <Text dimColor>Press Enter, Esc, or Q to return to Tools menu</Text>
        </Box>
      )}
    </Box>
  );
}
