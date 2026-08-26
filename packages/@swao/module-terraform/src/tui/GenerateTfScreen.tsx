// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Terraform module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { HeaderView, type LicenseStateView, TextInput, LiveOutput, GuidanceBox } from '@swao/tui-kit';
import { findWorkspace, LicenseGuard } from '@swao/core';
import type { LicenseState } from '@swao/core';
import { LicenseGate, isAllowed } from '@swao/tui-kit';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

type Phase = 'input' | 'running' | 'done';

interface GenerateTfScreenProps {
  onBack: () => void;
  onOpenLicense?: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
}

export function GenerateTfScreen({ onBack, onOpenLicense, version }: GenerateTfScreenProps) {
  // Consultant gate (M18 #0277). Mirrors the CLI gate in generate-tf.ts.
  const licenseState: LicenseState = useMemo(() => {
    try {
      return LicenseGuard.load().state;
    } catch {
      return {
        tier: 'community',
        fingerprint: 'unknown',
        firstRun: new Date().toISOString().slice(0, 10),
        assessmentCount: 0,
        daysElapsed: 0,
      };
    }
  }, []);

  // Local master-banner wrapper: closes over the host-injected version + the
  // licence state (LicenseGuard is in @swao/core). Memoised for a stable
  // identity so HeaderView (which holds resize state) does not remount. Lets
  // the existing `<Header subtitle=... />` call sites stay unchanged. Mirrors
  // the #0573 DoctorScreen pattern.
  const Header = useMemo(() => {
    let licenseStateView: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseStateView = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseStateView} licenseError={licenseError} />;
    };
  }, [version]);

  if (!isAllowed(licenseState, 'consultant')) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Generate Terraform Modules" />
        <LicenseGate
          required="consultant"
          state={licenseState}
          feature="swao generate-tf (Terraform scaffolding)"
          onOpenLicenseScreen={onOpenLicense ?? onBack}
          onBack={onBack}
        >
          <></>
        </LicenseGate>
      </Box>
    );
  }

  const workspace = findWorkspace(process.cwd());

  const [phase, setPhase] = useState<Phase>('input');
  const [app, setApp]     = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);

  useEffect(() => {
    if (phase !== 'running') return;

    const child = spawn(BIN, [SELF, 'generate-tf', '--app', app], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: workspace ?? undefined,
    });

    const push = (chunk: Buffer) =>
      setLines(prev => [...prev, ...chunk.toString().split('\n').filter(Boolean)]);

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => { setCode(exitCode); setDone(true); setPhase('done'); });
    return () => { child.kill(); };
  }, [phase]);

  const guidanceOpenRef = useRef(false);

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (done && (key.return || key.escape)) onBack();
    if (!done && key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Generate Terraform Modules" />

      {phase === 'input' && (
        <Box flexDirection="column">
          {workspace
            ? <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
            : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
          <Box marginTop={1}>
            <TextInput
              label="Application ID"
              placeholder="sovereign-health"
              onSubmit={(v) => { if (v) { setApp(v); setPhase('running'); } }}
              active
            />
          </Box>
          <GuidanceBox
            title="Generate Terraform"
            what="Emits Terraform modules for the matched sovereign landing zone. Review before applying."
            details={[{ label: 'Output', value: 'apps/<id>/tf/{main,variables,outputs}.tf' }]}
            affordances={['Enter -- run  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {(phase === 'running' || phase === 'done') && (
        <>
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          {!done && <Text color="yellow">Generating Terraform modules...</Text>}
          {done && code === 0 && <Text color="green">TF modules generated successfully.</Text>}
          {done && code !== 0 && <Text color="yellow">Generation finished with warnings (exit {code}).</Text>}
          <LiveOutput lines={lines} maxLines={20} />
          <Box marginTop={1}>
            <Text dimColor>{done ? 'Press Enter or Escape to return to menu...' : 'Escape to cancel...'}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
