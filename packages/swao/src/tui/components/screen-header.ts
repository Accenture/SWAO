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

// #4257 (TUI-13, Design 126 section 3): the header props of a host screen on
// ScreenLayout (blocks 1 and 2). The host reads the SWAO version and the
// licence state, as the Header container does; the screen passes the result
// to `ScreenLayout header={...}`.

import { useMemo } from 'react';
import type { LicenseStateView, ScreenLayoutProps } from '@swao/tui-kit';
import { SWAO_VERSION } from '../../branding.js';
import { LicenseGuard } from '../../license/license-guard.js';

export type ScreenHeader = ScreenLayoutProps['header'];

/** The licence state for the header, or the load error (first line shown by HeaderView). */
export function loadHeaderLicence(): { licenseState: LicenseStateView | null; licenseError: string | null } {
  try {
    return { licenseState: LicenseGuard.load().state as LicenseStateView, licenseError: null };
  } catch (e) {
    return { licenseState: null, licenseError: (e as Error).message };
  }
}

/** Header props of a host screen: subtitle, optional step info, version and licence state. */
export function useScreenHeader(subtitle: string, stepInfo?: string): ScreenHeader {
  const licence = useMemo(loadHeaderLicence, []);
  return useMemo(
    () => ({ subtitle, stepInfo, version: SWAO_VERSION, ...licence }),
    [subtitle, stepInfo, licence],
  );
}
