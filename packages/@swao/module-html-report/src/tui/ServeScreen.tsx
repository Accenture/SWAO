// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * ServeScreen -- TUI for `swao publish --serve`
 * Full implementation: #0438 (SWAO Live Portal, sprint-048)
 * This stub shows the serve command output and a stop button.
 */

import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { LicenseGuard } from '@swao/core';
import { GuidanceBox, HeaderView, LiveOutput, type LicenseStateView } from '@swao/tui-kit';
import { findWorkspace } from '@swao/core';

let _serveGuidanceOpen = false;

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

type Phase = 'starting' | 'running' | 'stopped' | 'error';

interface ServeScreenProps {
  appId?: string;
  onBack: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
}

export function ServeScreen({ appId, onBack, version }: ServeScreenProps) {
  const workspace = findWorkspace(process.cwd());

  // Local master-banner wrapper closing over the host-injected version + licence
  // state. Memoised for stable identity. Mirrors the #0573 DoctorScreen pattern.
  const Header = useMemo(() => {
    let licenseState: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseState = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseState} licenseError={licenseError} />;
    };
  }, [version]);
  const [phase, setPhase] = useState<Phase>('starting');
  const [lines, setLines] = useState<string[]>([]);
  const [portalUrl, setPortalUrl] = useState('http://localhost:4000');
  const [errorMsg, setErrorMsg] = useState('');
  const [proc, setProc] = useState<ReturnType<typeof spawn> | null>(null);

  useInput((input, key) => {
    if (_serveGuidanceOpen) return;
    if (key.escape || input === 'q' || input === 'Q' || (key.ctrl && input === 'c')) {
      proc?.kill();
      setPhase('stopped');
      setTimeout(onBack, 500);
    }
  });

  useEffect(() => {
    const args = ['publish', '--serve', ...(appId ? ['--app', appId] : [])];
    const child = spawn(BIN, [SELF, ...args], {
      cwd: workspace ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    setProc(child);

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      setLines(prev => [...prev, ...text.split('\n').filter(Boolean)]);
      // Try to detect the URL from server output
      const urlMatch = text.match(/http:\/\/localhost:\d+/);
      if (urlMatch) setPortalUrl(urlMatch[0]);
      if (text.includes('listening') || text.includes('started') || text.includes('4000')) {
        setPhase('running');
      }
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        setErrorMsg(`Server exited with code ${code}`);
        setPhase('error');
      }
    });

    return () => { child.kill(); };
  }, []);

  return (
    <Box flexDirection="column">
      <Header subtitle="SWAO Live Portal" />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyanBright">SWAO Live Portal</Text>
        {phase === 'starting' && <Text color="yellow">Starting server...</Text>}
        {phase === 'running' && (
          <Text color="green">Server running at <Text bold>{portalUrl}</Text></Text>
        )}
        {phase === 'error' && <Text color="red">Error: {errorMsg}</Text>}
        {phase === 'stopped' && <Text color="gray">Server stopped.</Text>}
      </Box>
      <Box paddingX={2}>
        <LiveOutput lines={lines} maxLines={20} />
      </Box>
      <Box paddingX={2} marginTop={1}>
        <Text color="gray" dimColor>Q or Esc: stop server and go back</Text>
      </Box>
      <GuidanceBox
        title="SWAO Live Portal"
        what="Serves the generated HTML publication on a local HTTP server. Open the URL shown above in a browser to explore findings."
        details={[
          { label: 'Stop',    value: 'Press Q or Esc to stop the server and return to menu.' },
          { label: 'Reports', value: 'Located in apps/<app>/wsp/reports-app/ (or reports-lz/ for LZ) and the site/ folder.' },
        ]}
        affordances={['Q/Esc -- stop server  |  Ctrl+G -- toggle panel']}
        onOpenChange={(open) => { _serveGuidanceOpen = open; }}
      />
    </Box>
  );
}
