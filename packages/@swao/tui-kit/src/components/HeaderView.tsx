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

import { Box, Text } from 'ink';
import { useHeaderWidth } from './header-width.js';
import { LicenseStatusLine, type LicenseStateView } from './LicenseStatusLine.js';
import { tone } from '../theme.js';

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

const TITLE      = 'S W A O  -  Sovereign Workload Assessment and Onboarding';

// #4430: the build of the running program (commit, date or tag), set once by
// the host at TUI start (setHeaderBuildTag) so every header, host or guest
// module, names it without threading a prop through each screen.
let headerBuildTag: string | null = null;

/** Set the build part of the header version, e.g. "4c8dd01e, 2026-11-14"; null clears it. */
export function setHeaderBuildTag(tag: string | null): void {
  headerBuildTag = tag && tag.trim() !== '' ? tag.trim() : null;
}

/**
 * The version text right of the title that fits into `room` columns: the full
 * "v1.6.1 (4c8dd01e, 2026-11-14)", else the commit only "v1.6.1 (4c8dd01e)" (an
 * 80-column terminal), else "v1.6.1".
 */
export function headerVersionText(version: string, buildTag: string | null, room: number): string {
  const plain = `v${version}`;
  if (!buildTag) return plain;
  const full = `${plain} (${buildTag})`;
  if (full.length <= room) return full;
  const commit = buildTag.split(',')[0]!.trim();
  const short = `${plain} (${commit})`;
  return short.length <= room ? short : plain;
}
// #4110: the rule width is shared (header-width.ts) so screens can fit their
// text to it without per-screen numbers.

export function HeaderView({
  subtitle,
  contextPrefix,
  stepInfo,
  hideLicenseStatus,
  version,
  licenseState,
  licenseError,
}: HeaderViewProps): JSX.Element {
  const width = useHeaderWidth();
  const bar   = '='.repeat(width);

  const displaySubtitle = contextPrefix && subtitle && !subtitle.startsWith(contextPrefix)
    ? `${contextPrefix} - ${subtitle}`
    : subtitle;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{bar}</Text>
      <Box justifyContent="space-between" width={width}>
        <Text {...tone('brand')}>{TITLE}</Text>
        <Text {...tone('muted')}>{headerVersionText(version, headerBuildTag, width - TITLE.length - 1)}</Text>
      </Box>
      {displaySubtitle && (
        <Box justifyContent="space-between" width={width}>
          <Text {...tone('brand', { bold: false })}>{displaySubtitle}</Text>
          {stepInfo && <Text {...tone('muted')}>{stepInfo}</Text>}
        </Box>
      )}
      <Text>{bar}</Text>
      {!hideLicenseStatus && (
        <Box marginTop={0} flexDirection="column">
          {licenseError
            ? <Text {...tone('error')}>licence: {licenseError.split('\n')[0]}</Text>
            : licenseState && <LicenseStatusLine state={licenseState} version={version} />}
          {/* #2632: expiry notification banner -- shown on all screens when a paid tier expired. */}
          {!licenseError && licenseState?.expiredTier && (
            <Text {...tone('error', { bold: true })}>
              {licenseState.expiredTier.charAt(0).toUpperCase() + licenseState.expiredTier.slice(1)} licence expired on {licenseState.exp ?? 'unknown'}, session downgraded to Community.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
