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
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspace, logPortfolio, setWorkspaceRoot } from '@swao/core';
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
  const workspaceRef          = useRef<string | undefined>(undefined);
  const { stdout }            = useStdout();
  const termRows              = stdout?.rows ?? 24;

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
    workspaceRef.current = workspace ?? undefined;
    if (workspace) { try { setWorkspaceRoot(workspace); } catch { /* best-effort */ } }
    if (!workspace) {
      setLines(['[warn] No SWAO workspace found. Run Workspace Setup (menu 1) to initialise, then try again.']);
      setExitCode(1);
      setPhase('done');
      return;
    }
    const isPkg = Boolean((process as { pkg?: unknown }).pkg);
    const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
    const args = ['ingest'];
    if (workspace) args.push('--workspace', workspace);
    // Resolve app: explicit prop wins; otherwise auto-discover from apps/ directory.
    // The ingest command only auto-detects ingestion/ at workspace root, not under apps/<id>/.
    const resolvedApp = appId ?? (workspace ? discoverIngestApp(workspace) : undefined);
    if (resolvedApp) args.push('--app', resolvedApp);

    const child = spawn(process.execPath, [...baseArgs, ...args], {
      env: {
        ...process.env,
        PKG_EXECPATH: '',
        NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-deprecation'].filter(Boolean).join(' '),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const appendLine = (raw: string) => {
      const trimmed = raw.trimEnd();
      if (!trimmed) return;
      // #2359: write full line to NDJSON log before TUI truncation.
      if (workspaceRef.current) {
        const level = trimmed.startsWith('[warn]') ? 'warn'
          : trimmed.startsWith('[error]') ? 'error'
          : 'info';
        try { logPortfolio(level, 'ingest_log', trimmed); } catch { /* best-effort */ }
      }
      setLines((prev) => [...prev, trimmed]);
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
      {/* #2420: two-line rendering for long messages -- split at ' -- ' separator so
          filename is on line 1 and the description/detail is on line 2 (indented).
          #2186: wrap="wrap" on all Text lines so any remaining long output wraps
          cleanly within the terminal width rather than truncating mid-word. */}
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {lines.slice(-30).map((l, i) => {
          const color = l.startsWith('[warn]') ? 'yellow' : l.startsWith('[ok]') ? 'green' : undefined;
          const sepIdx = l.indexOf(' -- ');
          if (l.length > 95 && sepIdx > 0) {
            return (
              <Box key={i} flexDirection="column">
                <Text color={color} wrap="wrap">{l.slice(0, sepIdx)}</Text>
                <Text color={color} wrap="wrap">{'        '}{l.slice(sepIdx + 4)}</Text>
              </Box>
            );
          }
          return (
            <Text key={i} color={color} wrap="wrap">{l}</Text>
          );
        })}
      </Box>
      {phase === 'done' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={succeeded ? 'green' : 'red'}>
            {succeeded ? '[ok]  Ingestion complete' : `[fail]  Ingestion exited with code ${exitCode}`}
          </Text>
        </Box>
      )}
      <GuidanceBox
        initiallyCollapsed={true}
        maxRows={Math.max(8, termRows - 20)}
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
