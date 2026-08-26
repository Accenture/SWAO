// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { LicenseStatusLine, type LicenseStateView } from './LicenseStatusLine.js';

/**
 * HeaderView -- presentational master banner (ADR-0048). Pure + prop-driven:
 * the version string and licence state are injected by the host container
 * (swao's `Header` reads SWAO_VERSION + LicenseGuard and passes them), so this
 * component has no @swao dependency and both the host and guest modules can
 * render it.
 */

export interface HeaderViewProps {
  /** Screen-specific subtitle shown below the master banner. */
  subtitle?: string;
  /** Assessment-flow breadcrumb prefix, e.g. "Application Assessment".
   *  When set and the subtitle does not already begin with this prefix,
   *  the header renders "<contextPrefix> - <subtitle>" (#1602). */
  contextPrefix?: string;
  /** Step indicator, right-aligned next to the subtitle. */
  stepInfo?: string;
  /** Hide the licence-status line (the LicenseScreen renders its own panel). */
  hideLicenseStatus?: boolean;
  /** SWAO version string (injected; e.g. "0.3.9"). */
  version: string;
  /** Current licence state, or null if it could not be loaded. */
  licenseState: LicenseStateView | null;
  /** Licence load error (first line shown in red), if any. */
  licenseError?: string | null;
}

const TITLE      = 'S W A O  --  Sovereign Workload Assessment and Onboarding';
const MIN_WIDTH  = 63;
const MAX_WIDTH  = 100;
const MAX_BAR_BR = 2;     // safety margin so the bar does not wrap

function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const initial = (stdout?.columns ?? 80);
  const [cols, setCols] = useState(initial);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  return cols;
}

export function HeaderView({
  subtitle,
  contextPrefix,
  stepInfo,
  hideLicenseStatus,
  version,
  licenseState,
  licenseError,
}: HeaderViewProps): JSX.Element {
  const cols  = useTerminalWidth();
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, cols - MAX_BAR_BR));
  const bar   = '='.repeat(width);

  const displaySubtitle = contextPrefix && subtitle && !subtitle.startsWith(contextPrefix)
    ? `${contextPrefix} - ${subtitle}`
    : subtitle;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{bar}</Text>
      <Box justifyContent="space-between" width={width}>
        <Text bold color="cyanBright">{TITLE}</Text>
        <Text dimColor>v{version}</Text>
      </Box>
      {displaySubtitle && (
        <Box justifyContent="space-between" width={width}>
          <Text color="cyanBright">{displaySubtitle}</Text>
          {stepInfo && <Text dimColor>{stepInfo}</Text>}
        </Box>
      )}
      <Text>{bar}</Text>
      {!hideLicenseStatus && (
        <Box marginTop={0}>
          {licenseError
            ? <Text color="red">licence: {licenseError.split('\n')[0]}</Text>
            : licenseState && <LicenseStatusLine state={licenseState} version={version} />}
        </Box>
      )}
    </Box>
  );
}
