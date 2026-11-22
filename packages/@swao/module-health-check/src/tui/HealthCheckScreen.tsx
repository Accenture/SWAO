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

// #4257 (TUI-13, Design 126 sections 3, 4.8 and 7.6): the Health Check screen
// on ScreenLayout. The probe list shows one StatusRow per probe with the
// reason of a warn or fail result on its second line; the guidance box shows
// the selected probe. While the probes run, Esc cancels at once (Q-09); when
// they are done, Enter and Esc return to the main menu.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { LicenseGuard, findWorkspace } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import {
  ScreenLayout, ProgressBar, DetailRow, KEY_HINTS, guidanceOwnsKey, tone, type GuidanceEntry, type LicenseStateView,
} from '@swao/tui-kit';
import { HealthCheckProbeList } from './components/HealthCheckProbeList.js';
import { parseHealthCheckOutput } from './components/health-check-parse.js';


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

  // Blocks 1 and 2: the host-injected version and the licence state (LicenseGuard is in @swao/core).
  const header = useMemo(() => {
    let licenseState: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseState = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return { subtitle: 'Health Check', version, licenseState, licenseError };
  }, [version]);

  const [probeEntry, setProbeEntry] = useState<GuidanceEntry | undefined>(undefined);
  const onCursorEntry = useCallback((e: GuidanceEntry | undefined) => { setProbeEntry(e); }, []);

  useEffect(() => {
    const selfCmd = selfSpawnCommand(['health-check']);
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // #4241: the central helper (no script path in the binary, PKG_EXECPATH '').
      // The 0-probe failure of #1234 came from the mixed form (script path plus
      // PKG_EXECPATH ''), which the helper never produces.
      env: selfCmd.env,
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

  // #2744: count parsed probes so the summary can distinguish "zero probes" from
  // "probes ran and all passed". Avoids calling parseHealthCheckOutput twice in
  // the render by memoising the count alongside the existing lines state.
  // #2841: also extract total probe count from the [N/M] header for the progress bar.
  const { parsedProbeCount, totalProbeCount } = useMemo(() => {
    const probes = parseHealthCheckOutput(lines);
    const last = probes[probes.length - 1];
    return { parsedProbeCount: probes.length, totalProbeCount: last?.total ?? 0 };
  }, [lines]);

  // #0798 / #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp
  // and PgDn only; Enter still finishes with the box open.
  const guidanceOpenRef = useRef(false);
  useInput((_input, key) => {
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (done && (key.return || key.escape)) onBack();
    if (!done && key.escape) onBack();
  });

  const entry: GuidanceEntry = probeEntry ?? {
    title: 'Health Check',
    what: done
      ? 'The health check ran no probes on this screen. Run it from a terminal to see its full output.'
      : 'Checks the licence, the LLM gateway, the tools and the inputs of this workspace, one probe after the other.',
    cli: 'swao health-check',
  };

  return (
    <ScreenLayout
      header={header}
      title={{ title: 'Health Check', subtitle: 'Licence, LLM, tools and inputs of this workspace, one row per probe.' }}
      keys={done ? KEY_HINTS.lastStep : KEY_HINTS.run}
      guidance={{ entry, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {engagementInfo && (
        <>
          <DetailRow label="Engagement" value={engagementInfo.code ? `${engagementInfo.name} (${engagementInfo.code})` : engagementInfo.name} labelWidth={12} />
          {engagementInfo.lead && <DetailRow label="Lead" value={engagementInfo.lead} labelWidth={12} />}
          <Text> </Text>
        </>
      )}
      {!done && <Text {...tone('muted')}>Running environment checks...</Text>}
      {/* #2841: progress bar while probes are streaming and [N/M] is parseable */}
      {!done && totalProbeCount > 0 && (
        <ProgressBar value={parsedProbeCount} total={totalProbeCount} label={`${parsedProbeCount}/${totalProbeCount} probes`} width={28} />
      )}
      <HealthCheckProbeList
        lines={lines}
        done={done}
        active={true}
        guidance="none"
        onCursorEntry={onCursorEntry}
        canPage={() => !guidanceOpenRef.current}
      />
      {/* #2744: only show "All probes passed" when probes were actually parsed.
           An empty probe list with exit 0 means output was not captured: say so,
           so the operator is not misled into thinking the workspace is healthy. */}
      {done && code === 0 && parsedProbeCount > 0 && <Text {...tone('ok')}>All probes passed.</Text>}
      {done && code === 0 && parsedProbeCount === 0 && <Text {...tone('warning')}>The health check ran no probes; the guidance names the command to run it in a terminal.</Text>}
      {done && code !== 0 && <Text {...tone('warning')}>One or more probes need attention.</Text>}
    </ScreenLayout>
  );
}
