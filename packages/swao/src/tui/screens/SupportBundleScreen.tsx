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

// #1515 -- TUI wrapper for `swao support-bundle`.
// Collects a PII-free diagnostic bundle from existing event logs.

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findWorkspace } from '@swao/core';
import { GuidanceBox } from '@swao/tui-kit';
import { Header } from '../components/Header.js';

type Phase = 'confirm' | 'running' | 'done';

export interface SupportBundleScreenProps {
  onBack: () => void;
}

export function SupportBundleScreen({ onBack }: SupportBundleScreenProps) {
  const [lines, setLines]           = useState<string[]>([]);
  const [exitCode, setExitCode]     = useState<number | null>(null);
  const [phase, setPhase]           = useState<Phase>('confirm');
  const [resolvedOutDir, setResolvedOutDir] = useState<string>('wsp/support-diag/');
  const donePressRef                = useRef(false);

  // Resolve output dir at mount so confirm phase shows the actual path (#1599)
  useEffect(() => {
    const workspace = findWorkspace(process.cwd());
    if (workspace) setResolvedOutDir(join(workspace, 'wsp', 'support-diag'));
  }, []);

  useInput((input, key) => {
    if (phase === 'confirm') {
      if (key.return || input === 'y' || input === 'Y') {
        setPhase('running');
      }
      if (key.escape || input === 'n' || input === 'N' || input === 'q') {
        onBack();
      }
      return;
    }
    if (phase === 'done') {
      if (donePressRef.current) return;
      if (key.return || key.escape || input === 'q') {
        donePressRef.current = true;
        onBack();
      }
    }
  });

  useEffect(() => {
    if (phase !== 'running') return;

    const workspace = findWorkspace(process.cwd());
    // IS_PKG pattern: in pkg binary, argv[1] is the virtual snapshot path -- including
    // it causes commander to see it as the command (argv shifts). Use [] in pkg mode,
    // same as LlmAssessmentScreen spawnLeg pattern (#1663).
    const isPkg = Boolean((process as { pkg?: unknown }).pkg);
    const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
    const args = ['support-bundle'];
    if (workspace) args.push('--workspace', workspace);

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
  }, [phase]);

  const succeeded = exitCode === 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Support Bundle" />
      <Box marginTop={1}>
        <Text bold color="cyanBright">Support Diagnostic Bundle</Text>
        {phase === 'running' && <Text dimColor>  creating...</Text>}
      </Box>

      {phase === 'confirm' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Packages SWAO event logs and diagnostics into a single PII-free archive</Text>
          <Text>ready to send to your SWAO support contact (bundle v2.0).</Text>
          <Box marginTop={1}>
            <Text dimColor>Included:  </Text>
            <Text>event trace, error context, workspace config, health-check, LZ catalogue meta</Text>
          </Box>
          <Box>
            <Text dimColor>Excluded:  </Text>
            <Text>document content, API keys, user data, engagement names, absolute paths</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Output:    </Text>
            <Text bold>{resolvedOutDir}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Y to create the bundle   Esc, N, or Q to cancel</Text>
          </Box>
          <GuidanceBox
            title="What gets included"
            what="Creates a PII-free diagnostic archive from SWAO event logs and workspace metadata. Send this file to your SWAO support contact to help diagnose issues."
            details={[
              { label: 'Included', value: 'event trace, error context, workspace config, health-check output, LZ catalogue meta, run manifests' },
              { label: 'Excluded', value: 'document content, API keys, user data, engagement names, absolute paths' },
              { label: 'Format', value: 'tar.gz -- extract with: tar -xzf <bundle>.tar.gz' },
            ]}
            affordances={['Enter / Y -- create bundle  |  Esc / N / Q -- cancel']}
          />
        </Box>
      )}

      {phase === 'running' && (
        <Box flexDirection="column" marginTop={1} flexGrow={1}>
          {lines.slice(-20).map((l, i) => (
            <Text
              key={i}
              color={l.startsWith('[ok]') ? 'green' : l.startsWith('[error]') ? 'red' : undefined}
            >
              {l}
            </Text>
          ))}
        </Box>
      )}

      {phase === 'done' && (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="column" flexGrow={1}>
            {lines.slice(-20).map((l, i) => (
              <Text
                key={i}
                color={l.startsWith('[ok]') ? 'green' : l.startsWith('[error]') ? 'red' : undefined}
              >
                {l}
              </Text>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold color={succeeded ? 'green' : 'red'}>
              {succeeded
                ? '[ok]  Bundle created successfully (v2.0)'
                : `[fail]  Bundle creation failed (exit ${exitCode})`}
            </Text>
            {/* #1599: highlight resolved bundle path in GuidanceBox on success */}
            {succeeded && (() => {
              const pathLine = lines.find(l => l.startsWith('[ok]  Support bundle created:'));
              const bundlePath = pathLine ? pathLine.replace('[ok]  Support bundle created: ', '') : resolvedOutDir;
              return (
                <Box marginTop={1}>
                  <GuidanceBox
                    title="Bundle location"
                    what="Send this file to your SWAO support contact. No user data or credentials are included."
                    details={[{ label: 'Path', value: bundlePath }]}
                    affordances={['Press Enter, Esc, or Q to return to Tools menu']}
                    initiallyCollapsed={false}
                  />
                </Box>
              );
            })()}
            {!succeeded && (
              <Box marginTop={1}>
                <GuidanceBox
                  title="Bundle creation failed"
                  what="The support bundle could not be created. Check the output above for the specific error. Common causes: missing SWAO event logs in wsp/logs/, insufficient disk space, or a file-permission issue on the output directory."
                  affordances={['Press Enter, Esc, or Q to return to Tools menu']}
                  initiallyCollapsed={false}
                />
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
