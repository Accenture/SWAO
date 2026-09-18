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

import { useMemo } from 'react';
import { HeaderView } from '@swao/tui-kit';
import type { LicenseStateView } from '@swao/tui-kit';
import { SWAO_VERSION } from '../../branding.js';
import { LicenseGuard } from '../../license/license-guard.js';

/**
 * Header -- the host container for the master banner (ADR-0048). Reads the
 * SWAO version + licence state (the host-only data) and renders the
 * presentational `HeaderView` from @swao/tui-kit. The 16 in-host screens keep
 * importing this `Header` unchanged; the guest-module screens render
 * `HeaderView` directly with version/licence injected from the CoreContext.
 */

interface HeaderProps {
  /** Screen-specific subtitle line shown below the master banner. */
  subtitle?: string;
  /** Assessment-flow breadcrumb prefix (e.g. "LLM Assessment"). When set,
   *  the header renders "<contextPrefix> - <subtitle>" unless the subtitle
   *  already begins with the prefix (#1602). */
  contextPrefix?: string;
  /** Step indicator (right-aligned next to the subtitle). */
  stepInfo?: string;
  /** Hide the licence-status line. Use on the LicenseScreen which renders
   *  its own richer status panel. */
  hideLicenseStatus?: boolean;
}

function useLicenseState(): { state: LicenseStateView | null; error: string | null } {
  return useMemo(() => {
    try {
      return { state: LicenseGuard.load().state as LicenseStateView, error: null };
    } catch (e) {
      return { state: null, error: (e as Error).message };
    }
  }, []);
}

export function Header({ subtitle, contextPrefix, stepInfo, hideLicenseStatus }: HeaderProps): JSX.Element {
  const { state, error } = useLicenseState();
  return (
    <HeaderView
      subtitle={subtitle}
      contextPrefix={contextPrefix}
      stepInfo={stepInfo}
      hideLicenseStatus={hideLicenseStatus}
      version={SWAO_VERSION}
      licenseState={state}
      licenseError={error}
    />
  );
}
