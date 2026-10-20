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

import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { logPortfolio } from '@swao/core';
import { HealthCheckProbeList, summariseHealthCheckOutput } from '@swao/module-health-check';
import { BIN, SELF_ARGS, setWizardGuidanceOpen } from '../shared.js';

/**
 * #1675 / #3170: emit setup.health-check.complete (or .empty) for the wizard's
 * health-check run. fail_count uses the runner's failure definition (read from
 * its summary line), so it equals health-check.complete fail_count; WARN probes
 * stay visible (#2388) as warn_count + warned_probes. Exported for tests.
 */
export function logSetupHealthCheckResult(lines: ReadonlyArray<string>): void {
  const summary = summariseHealthCheckOutput(lines);
  if (summary.probeCount === 0) {
    logPortfolio('warn', 'setup.health-check.empty', 'Setup Wizard health-check: zero probes parsed -- output may be corrupt or binary mismatch');
    return;
  }
  logPortfolio(
    'info',
    'setup.health-check.complete',
    `Setup Wizard health-check finished: ${summary.probeCount} probes, ${summary.failCount} failure(s), ${summary.warnCount} warning(s)`,
    {
      context: {
        probe_count: summary.probeCount,
        fail_count: summary.failCount,
        failed_probes: summary.failedProbes,
        warn_count: summary.warnCount,
        warned_probes: summary.warnedProbes,
      },
    },
  );
}

// -- Step 4: Health Check -------------------------------------------------

export function HealthCheckStep({ onNext, stepNumber = 4 }: { onNext: () => void; stepNumber?: number }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try { logPortfolio('info', 'setup.health-check.start', 'Setup Wizard: invoking health-check probe runner'); } catch { /* best-effort */ }
    const child = spawn(BIN, [...SELF_ARGS, 'health-check'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // #1234 / #2576-family: PKG_EXECPATH='' prevents child VFS re-init;
      // SELF_ARGS is empty inside a pkg binary so Commander sees 'health-check'
      // as the first positional. MCP spawns (server.ts) omit SELF_ARGS already.
      env: { ...process.env, PKG_EXECPATH: '' },
    });
    // #1147: buffer partial lines across chunk boundaries; strip \r for Windows
    // CRLF so HEADER_RE always sees complete lines (mirrors HealthCheckScreen.tsx).
    // #1675: separate buffers per stream -- a newline-less stderr write must not be
    // prepended to the next stdout chunk, which corrupts the [N/M] header pattern
    // and causes probes to be silently dropped from the TUI list.
    let stdoutBuf = '';
    let stderrBuf = '';
    // #1675: keep every complete stdout/stderr line via closure so the close
    // handler can emit NDJSON events. #3170: the counts come from
    // summariseHealthCheckOutput, which reads the runner's own summary line, so
    // fail_count always matches health-check.complete; WARN probes are reported
    // as warn_count + warned_probes and are no longer added to fail_count.
    const hcLines: string[] = [];
    // Idle watchdog: if the child produces no output for 120 s, assume it is
    // wedged (post-probe sync check blocks exit) and unblock the wizard.
    // The timer resets on every data chunk so a slow-but-active health-check
    // is not killed prematurely.
    // 120 s because gatherProbes() is async and prints NO output while running
    // (only the intro line arrives before all probes complete). Observed
    // health-check durations are 28-60 s; the old 30 s threshold killed the
    // child before probe lines were printed, producing "No probes detected."
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { child.kill(); setDone(true); }, 120_000);
    };
    const makePush = (getBuf: () => string, setBuf: (s: string) => void) => (chunk: Buffer) => {
      resetWatchdog();
      const text = getBuf() + chunk.toString().replace(/\r/g, '');
      const parts = text.split('\n');
      setBuf(parts.pop() ?? '');
      const completeLines = parts.filter(Boolean);
      hcLines.push(...completeLines);
      if (completeLines.length > 0) setLines(prev => [...prev, ...completeLines]);
    };
    child.stdout.on('data', makePush(() => stdoutBuf, s => { stdoutBuf = s; }));
    child.stderr.on('data', makePush(() => stderrBuf, s => { stderrBuf = s; }));
    // #2367: guard against spawn failures (ENOENT, EACCES).  Without this
    // handler an 'error' event from the child process becomes an uncaught
    // exception that crashes the TUI without writing a useful crash log.
    child.on('error', (err) => {
      clearTimeout(watchdog);
      setLines(prev => [...prev, `[spawn error] ${err.message}`]);
      setDone(true);
    });
    resetWatchdog();
    child.on('close', () => {
      clearTimeout(watchdog);
      if (stdoutBuf.trim()) setLines(prev => [...prev, stdoutBuf]);
      if (stderrBuf.trim()) setLines(prev => [...prev, stderrBuf]);
      setDone(true);
      // #1675: emit setup.health-check.complete / .empty so the E2E monitor
      // can confirm the wizard health-check step ran and detect silent failures.
      try {
        if (stdoutBuf.trim()) hcLines.push(stdoutBuf);
        logSetupHealthCheckResult(hcLines);
      } catch { /* best-effort */ }
    });
    return () => {
      clearTimeout(watchdog);
      child.kill();
    };
  }, []);

  useInput((_input, key) => {
    if (done && key.return) onNext(); // #1412: one-press advance when guidance is open
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step {stepNumber} -- Health Check</Text>
      {!done && <Text color="yellow">Running swao health-check...</Text>}
      <HealthCheckProbeList
        lines={lines}
        done={done}
        active
        onGuidanceOpenChange={setWizardGuidanceOpen}
      />
      {done && <Text dimColor>Press Enter to continue...</Text>}
    </Box>
  );
}
