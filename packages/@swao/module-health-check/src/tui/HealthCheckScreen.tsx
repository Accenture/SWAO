// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { LicenseGuard, findWorkspace } from '@swao/core';
import { HeaderView, type LicenseStateView } from '@swao/tui-kit';
import { HealthCheckProbeList } from './components/HealthCheckProbeList.js';


const BIN  = process.execPath;
const SELF = process.argv[1] as string;

interface HealthCheckScreenProps {
  onBack: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
}

export function HealthCheckScreen({ onBack, version }: HealthCheckScreenProps) {
  const [lines, setLines]               = useState<string[]>([]);
  const [done, setDone]                 = useState(false);
  const [code, setCode]                 = useState<number | null>(null);
  // #0756: read engagement info from .swao.yml (best-effort, sync at mount)
  const engagementInfo = useMemo(() => {
    try {
      const ws = findWorkspace(process.cwd());
      if (!ws) return null;
      const raw = readFileSync(`${ws}/.swao.yml`, 'utf-8');
      const yml = load(raw) as { engagement?: { name?: string; client_code?: string; partnership_lead?: string } } | null;
      const eng = yml?.engagement;
      if (!eng?.name) return null;
      return { name: eng.name, code: eng.client_code ?? null, lead: eng.partnership_lead ?? null };
    } catch {
      return null;
    }
  }, []);

  // Local master-banner wrapper: closes over the host-injected version + the
  // licence state (LicenseGuard is in @swao/core). Memoised for a stable
  // identity so HeaderView (which holds resize state) does not remount. Lets
  // the existing `<Header subtitle=... />` call site stay unchanged. Mirrors
  // the #0553 AssessScreen pattern.
  const Header = useMemo(() => {
    let licenseState: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseState = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseState} licenseError={licenseError} />;
    };
  }, [version]);

  useEffect(() => {
    const child = spawn(BIN, [SELF, 'health-check'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // #1234: use parent env unchanged. PKG_EXECPATH='' prevents child VFS init
      // and causes 0 probes. SELF as argv[1] lets the pkg splice work correctly.
      // Contrast: MCP spawns (server.ts) omit SELF and STILL need PKG_EXECPATH=''.
      env: process.env,
    });

    // #1080: buffer partial lines across chunk boundaries so HEADER_RE always
    // sees a complete line. Strip \r to guard against CRLF on Windows -- dot
    // in JS regex does not match \r, causing HEADER_RE to fail on trailing CR.
    // Separate buffers per stream: a newline-less stderr write must not be
    // prepended to the next stdout chunk, which would corrupt the [N/M] header
    // pattern and cause probes to be silently dropped from the TUI list.
    let stdoutBuf = '';
    let stderrBuf = '';
    const makePush = (getB: () => string, setB: (s: string) => void) => (chunk: Buffer) => {
      const text = getB() + chunk.toString().replace(/\r/g, '');
      const parts = text.split('\n');
      setB(parts.pop() ?? '');
      const complete = parts.filter(Boolean);
      if (complete.length > 0) setLines(prev => [...prev, ...complete]);
    };

    child.stdout.on('data', makePush(() => stdoutBuf, s => { stdoutBuf = s; }));
    child.stderr.on('data', makePush(() => stderrBuf, s => { stderrBuf = s; }));
    child.on('close', (exitCode) => {
      if (stdoutBuf.trim()) setLines(prev => [...prev, stdoutBuf]);
      if (stderrBuf.trim()) setLines(prev => [...prev, stderrBuf]);
      setCode(exitCode);
      setDone(true);
    });

    return () => { child.kill(); };
  }, []);

  // #0798: guard navigation so Escape does not fire while GuidanceBox is expanded.
  const guidanceOpenRef = useRef(false);
  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (done && (key.return || key.escape)) onBack();
    if (!done && key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Health Check" />
      {engagementInfo && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>  Engagement: <Text color="cyanBright">{engagementInfo.name}</Text>
            {engagementInfo.code ? <Text dimColor>  ({engagementInfo.code})</Text> : null}
          </Text>
          {engagementInfo.lead && <Text>  Lead: <Text dimColor>{engagementInfo.lead}</Text></Text>}
        </Box>
      )}
      {!done && <Text color="yellow">Running environment checks...</Text>}
      <HealthCheckProbeList
        lines={lines}
        done={done}
        active={true}
        onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
      />
      {done && code === 0 && <Text color="green">All probes passed.</Text>}
      {done && code !== 0 && <Text color="yellow">One or more probes need attention.</Text>}
      <Box marginTop={1}>
        <Text dimColor>{done ? 'Press Enter or Escape to return to menu...' : 'Press Escape to cancel...'}</Text>
      </Box>
    </Box>
  );
}
