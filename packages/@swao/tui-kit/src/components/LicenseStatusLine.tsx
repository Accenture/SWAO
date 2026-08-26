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

/**
 * Local view-model of the licence fields this presentational component reads
 * (ADR-0048: tui-kit is a pure leaf -- no @swao runtime/type dependency). The
 * host's full LicenseState is structurally assignable (superset of these fields).
 */
export interface LicenseStateView {
  tier: 'community' | 'consultant' | 'enterprise';
  assessmentCount: number;
  firstRun: string;
  assessmentLimit?: number | null;
  exp?: string;
}
type LicenseState = LicenseStateView;

/**
 * One-line licence status shown at the top of MainMenu and reused by
 * LicenseScreen. The colour state is computed by `licenseStatusColor`
 * so #0283 can reuse the same logic without duplicating it.
 *
 * Colour states:
 *   - green  -- comfortable margin on both budget and expiry
 *   - amber  -- within 20% of budget OR within 14 days of expiry
 *   - red    -- at the budget cap OR within 3 days of expiry / expired
 *   - gray   -- Community (no cap to warn about; informational)
 *
 * After M18 D-05 (revised): Community has no cap, so the Community
 * variant is always neutral gray.
 *
 * Source: design/022 §4.3 + issue #0278.
 */

export type LicenseColorState = 'gray' | 'green' | 'amber' | 'red';

export interface LicenseStatusColor {
  state: LicenseColorState;
  /** Ink colour string (or undefined for default). */
  inkColor?: string;
  /** Whether to also render with dimColor. */
  dim: boolean;
}

const BUDGET_AMBER_RATIO = 0.20; // <=20% remaining triggers amber
const DAYS_AMBER         = 14;   // <=14 days remaining triggers amber
const DAYS_RED           = 3;    // <=3 days remaining triggers red

function daysUntilIso(iso: string | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return Math.floor((target - today) / 86_400_000);
}

export function licenseStatusColor(state: LicenseState): LicenseStatusColor {
  // Community -- no cap to warn about, always neutral gray.
  if (state.tier === 'community') {
    return { state: 'gray', dim: true };
  }

  const limit = state.assessmentLimit;
  const daysLeft = daysUntilIso(state.exp);

  // Red: at the cap, or already expired, or within 3 days of expiry.
  if (limit != null && state.assessmentCount >= limit) {
    return { state: 'red', inkColor: 'red', dim: false };
  }
  if (daysLeft != null && daysLeft <= DAYS_RED) {
    return { state: 'red', inkColor: 'red', dim: false };
  }

  // Amber: within 20% of budget, or within 14 days of expiry.
  if (limit != null && state.assessmentCount >= limit * (1 - BUDGET_AMBER_RATIO)) {
    return { state: 'amber', inkColor: 'yellow', dim: false };
  }
  if (daysLeft != null && daysLeft <= DAYS_AMBER) {
    return { state: 'amber', inkColor: 'yellow', dim: false };
  }

  return { state: 'green', inkColor: 'green', dim: false };
}

/**
 * Human-readable budget label for the status line. `null` limit renders
 * "(unlimited)" and the count is shown lifetime-style; positive integer
 * limit renders "N/M used (R remaining)".
 */
export function formatBudget(state: LicenseState): string {
  const limit = state.assessmentLimit;
  const used = state.assessmentCount;
  if (limit == null) {
    return `${used} run (unlimited)`;
  }
  const remaining = Math.max(0, limit - used);
  return `${used}/${limit} used (${remaining} remaining)`;
}

/**
 * Format the days-until-expiry segment. Returns null when there is no
 * licence file at all (Community with no prior licence).
 */
export function formatExpiry(state: LicenseState): string | null {
  const days = daysUntilIso(state.exp);
  if (days == null) return null;
  if (days < 0) {
    return `previous licence expired ${state.exp} (${-days} days ago)`;
  }
  return `expires ${state.exp} (${days} days)`;
}

interface LicenseStatusLineProps {
  state: LicenseState;
  /** SWAO version string (injected from HeaderView). Shown next to the tier label. */
  version?: string;
}

export function LicenseStatusLine({ state, version }: LicenseStatusLineProps) {
  const color = licenseStatusColor(state);
  const vSuffix = version ? ` v${version}` : '';
  const tierLabel =
    state.tier === 'enterprise' ? `Enterprise Edition${vSuffix}` :
    state.tier === 'consultant' ? `Consultant Edition${vSuffix}` :
    `Community Edition${vSuffix}`;

  if (state.tier === 'community') {
    // Community: no budget or expiry to warn about. Show the lifetime
    // counter as informational. If a prior licence expired, surface
    // that as a small footnote rather than the main signal.
    const expired = formatExpiry(state);
    return (
      <Box>
        <Text color={color.inkColor} dimColor={color.dim}>
          {tierLabel}  --  Apache 2.0  |  {state.assessmentCount} assessments run since {state.firstRun}
          {expired && expired.startsWith('previous') ? `  |  ${expired}` : ''}
        </Text>
      </Box>
    );
  }

  // Consultant / Enterprise: show tier + budget + expiry.
  const budget = formatBudget(state);
  const expiry = formatExpiry(state);
  return (
    <Box>
      <Text color={color.inkColor} bold={color.state === 'red'}>
        {tierLabel}  |  {budget}{expiry ? `  |  ${expiry}` : ''}
      </Text>
    </Box>
  );
}
