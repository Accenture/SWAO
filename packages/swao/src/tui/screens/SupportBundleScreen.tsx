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

// #1515: TUI wrapper for `swao support-bundle`.
// Collects a PII-free diagnostic bundle from existing event logs.
// #4257 (TUI-13, Design 126 sections 3, 4.6, 4.8 and 6): on ScreenLayout; the
// included and excluded facts and the output folder as DetailRows (the path
// keeps drive and file name), the output through RunOutput, the result as a
// StatusRow, keys through KeyHints (Enter confirm, Esc cancel; Esc cancels a
// running bundle, Q-09), the CLI only in the guidance `cli` field.

import { useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findWorkspace } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { DetailRow, KEY_HINTS, ProgressBar, RunOutput, ScreenLayout, StatusRow, guidanceOwnsKey, type GuidanceEntry, type KeyHint } from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { BUNDLE_VERSION, bundlePathFromLine } from '../../commands/support-bundle.js';

type Phase = 'confirm' | 'running' | 'done';

const INCLUDED = 'event trace, error context, workspace config, health check output, LZ catalogue meta, run manifests';
const EXCLUDED = 'engagement names, client codes, lead names, absolute paths, API keys';

/** The keys per phase (Design 126 section 7.9). */
export function supportBundleKeys(phase: Phase): readonly KeyHint[] {
  if (phase === 'confirm') return [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'cancel' }];
  if (phase === 'running') return KEY_HINTS.run;
  return [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];
}

const SUPPORT_BUNDLE_CLI = { cli: 'swao support-bundle --workspace <path>' } as const;

/** The guidance entry per phase and result. */
export function supportBundleGuidance(phase: Phase, succeeded: boolean): GuidanceEntry {
  if (phase === 'done' && succeeded) {
    return {
      title: 'Bundle location',
      what: 'Send this file to your SWAO support contact. No document content or credentials are included; client hosts, paths and chat text are redacted (#3437).',
      sections: [{ label: 'Extract', text: 'tar -xzf <bundle>.tar.gz' }],
      ...SUPPORT_BUNDLE_CLI,
    };
  }
  if (phase === 'done') {
    return {
      title: 'Bundle creation failed',
      what: 'The support bundle could not be created. Check the output for the specific error. Common causes: missing SWAO event logs in wsp/logs/, insufficient disk space, or a file permission issue on the output directory.',
      ...SUPPORT_BUNDLE_CLI,
    };
  }
  return {
    title: 'What gets included',
    what: 'Creates a PII-free diagnostic archive from SWAO event logs and workspace metadata. Send this file to your SWAO support contact to help diagnose issues.',
    sections: [
      { label: 'Included', text: INCLUDED },
      { label: 'Excluded', text: EXCLUDED },
      { label: 'Format', text: 'tar.gz, extract with tar -xzf <bundle>.tar.gz' },
    ],
    ...SUPPORT_BUNDLE_CLI,
  };
}

export interface SupportBundleScreenProps {
  onBack: () => void;
}

export function SupportBundleScreen({ onBack }: SupportBundleScreenProps) {
  const [lines, setLines]           = useState<string[]>([]);
  const [exitCode, setExitCode]     = useState<number | null>(null);
  const [phase, setPhase]           = useState<Phase>('confirm');
  const [resolvedOutDir, setResolvedOutDir] = useState<string>('wsp/support-diag/');
  const [progressTick, setProgressTick] = useState(0);
  const donePressRef                = useRef(false);
  const guidanceOpenRef             = useRef(false);
  const header                      = useScreenHeader('Support Bundle');

  // Resolve output dir at mount so confirm phase shows the actual path (#1599)
  useEffect(() => {
    const workspace = findWorkspace(process.cwd());
    if (workspace) setResolvedOutDir(join(workspace, 'wsp', 'support-diag'));
  }, []);

  // #2610: advance progress tick at 150 ms while the bundle is being created (drives ProgressBar)
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => {
      setProgressTick(t => (t + 1) % 20);
    }, 150);
    return () => clearInterval(id);
  }, [phase]);

  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (donePressRef.current) return;
    if (phase === 'confirm') {
      if (key.return) { setPhase('running'); return; }
      if (key.escape) { donePressRef.current = true; onBack(); }
      return;
    }
    // Q-09: Esc cancels a running bundle at once (the unmount stops the child).
    if ((phase === 'running' && key.escape) || (phase === 'done' && (key.return || key.escape))) {
      donePressRef.current = true;
      onBack();
    }
  });

  useEffect(() => {
    if (phase !== 'running') return;

    const workspace = findWorkspace(process.cwd());
    // #1663 / #4241: the central self-spawn helper never passes the virtual
    // snapshot path in the binary (commander would read it as the command).
    const args = ['support-bundle'];
    if (workspace) args.push('--workspace', workspace);

    const selfCmd = selfSpawnCommand(args);
    const child = spawn(selfCmd.command, selfCmd.args, {
      env: selfCmd.env,
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
  }, [phase]);

  const succeeded = exitCode === 0;
  // #1599: the resolved bundle path on success.
  const bundlePath = lines.map(bundlePathFromLine).find((p): p is string => p !== undefined) ?? resolvedOutDir;
  const title = phase === 'confirm'
    ? { title: 'Support Diagnostic Bundle', subtitle: `Packages SWAO event logs and diagnostics into one PII-free archive for your SWAO support contact (bundle v${BUNDLE_VERSION}).` }
    : phase === 'running' ? { title: 'Creating the bundle' }
    : { title: 'Support Diagnostic Bundle' };

  return (
    <ScreenLayout
      header={header}
      title={title}
      keys={supportBundleKeys(phase)}
      guidance={{ entry: supportBundleGuidance(phase, succeeded), initiallyCollapsed: phase !== 'done', onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {phase === 'confirm' && (
        <>
          <DetailRow label="Included" value={INCLUDED} />
          <DetailRow label="Excluded" value={EXCLUDED} />
          <DetailRow label="Output" value={resolvedOutDir} path />
        </>
      )}
      {phase === 'running' && <ProgressBar value={progressTick} total={20} label="Creating bundle..." width={28} />}
      {phase !== 'confirm' && lines.length > 0 && <RunOutput lines={lines} maxLines={20} />}
      {phase === 'done' && (
        <>
          <Text> </Text>
          <StatusRow
            level={succeeded ? 'ok' : 'fail'}
            label="Bundle"
            summary={succeeded ? `created (v${BUNDLE_VERSION})` : `creation failed (exit ${exitCode ?? 'unknown'})`}
          />
          {succeeded && <DetailRow label="Path" value={bundlePath} path />}
        </>
      )}
    </ScreenLayout>
  );
}
