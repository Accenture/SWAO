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

// #0967: TUI wrapper for `swao ingest`.
// Classifies and extracts files from ingestion/ before a full assessment.
// #4257 (TUI-13, Design 126 sections 3, 4.6 and 4.8): on ScreenLayout; the
// output through RunOutput (dashes normalised, wrapped with a hanging
// indent), the result as a StatusRow, Esc cancel while running (Q-09),
// Enter finish and Esc abort when done.

import { useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findWorkspace, logPortfolio, setWorkspaceRoot } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { ScreenLayout, RunOutput, StatusRow, DetailRow, KEY_HINTS, guidanceOwnsKey, tone, type GuidanceEntry } from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { cliLineLevel } from '../../commands/cli-line-level.js';

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
  const header                = useScreenHeader('Ingest Files');
  const guidanceOpenRef       = useRef(false);

  useInput((_input, key) => {
    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and PgDn only.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (donePressRef.current) return;
    // Q-09: Esc cancels the ingestion at once (unmount stops the child).
    if (phase === 'running' && key.escape) { donePressRef.current = true; onBack(); return; }
    if (phase === 'done' && (key.return || key.escape)) {
      donePressRef.current = true;
      onBack();
    }
  });

  useEffect(() => {
    const workspace = findWorkspace(process.cwd());
    workspaceRef.current = workspace ?? undefined;
    if (workspace) { try { setWorkspaceRoot(workspace); } catch { /* best-effort */ } }
    if (!workspace) {
      setLines(['No SWAO workspace found. Run Workspace Setup (menu 1) to initialise, then try again.']);
      setExitCode(1);
      setPhase('done');
      return;
    }
    const args = ['ingest'];
    if (workspace) args.push('--workspace', workspace);
    // Resolve app: explicit prop wins; otherwise auto-discover from apps/ directory.
    // The ingest command only auto-detects ingestion/ at workspace root, not under apps/<id>/.
    const resolvedApp = appId ?? (workspace ? discoverIngestApp(workspace) : undefined);
    if (resolvedApp) args.push('--app', resolvedApp);

    // #4241: central self-spawn helper (pkg binary and node dist).
    const selfCmd = selfSpawnCommand(args, {
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-deprecation'].filter(Boolean).join(' '),
      },
    });
    const child = spawn(selfCmd.command, selfCmd.args, {
      env: selfCmd.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const appendLine = (raw: string) => {
      const trimmed = raw.trimEnd();
      if (!trimmed) return;
      // #2359: write full line to NDJSON log before TUI truncation.
      if (workspaceRef.current) {
        try { logPortfolio(cliLineLevel(trimmed), 'ingest_log', trimmed); } catch { /* best-effort */ }
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
  const failed = phase === 'done' && !succeeded;

  const entry: GuidanceEntry = {
    title: 'Ingest Files',
    what: failed
      ? 'Ingestion failed. Check the output for the cause. Common causes: unsupported file format, missing ingestion/ folder, or a permissions issue on wsp/inputs/.'
      : 'Classifies and extracts the files of the app ingestion/ folder into the structured wsp/inputs/ tree. Run before an assessment to pre-process PDFs, spreadsheets and other documents.',
    sections: [
      { label: 'Input', text: 'apps/<app>/ingestion/ (drop files here before running)' },
      { label: 'Output', text: 'apps/<app>/wsp/inputs/ (normalised files, ready for the context pass)' },
    ],
    cli: 'swao ingest --app <id>',
  };

  return (
    <ScreenLayout
      header={header}
      title={{ title: 'Ingest Files', subtitle: 'Classify and extract the documents of the ingestion folder before an assessment.' }}
      keys={phase === 'done' ? KEY_HINTS.lastStep.filter((h) => h.key !== '↑↓') : KEY_HINTS.run}
      guidance={{ entry, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {phase === 'running' && <Text {...tone('muted')}>Ingestion running...</Text>}
      {lines.length > 0 && <RunOutput lines={lines} maxLines={20} />}
      {phase === 'done' && (
        <>
          <Text> </Text>
          <StatusRow
            level={succeeded ? 'ok' : 'fail'}
            label={succeeded ? 'Ingestion complete' : 'Ingestion failed'}
            labelWidth={24}
          />
          {!succeeded && exitCode !== null && <DetailRow label="Exit code" value={String(exitCode)} />}
        </>
      )}
    </ScreenLayout>
  );
}
