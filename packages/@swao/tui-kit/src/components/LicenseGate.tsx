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

// #4257 (TUI-13, Design 126 sections 5.2, 7.9 and 13.2 G-01, G-04, G-11): the
// gate box carries no key wording, no dash punctuation and no CLI command.
// The host screen shows LICENSE_GATE_KEYS on its key hint line and puts
// licenseGateGuidance(...) (with the request command in its `cli` field) in
// its guidance box. The keys stay as they were: L opens the Licence screen,
// Esc or Q goes back.

import { useInput } from 'ink';
import { Box, Text } from 'ink';
import { tone, tokenColor } from '../theme.js';
import { useHeaderWidth } from './header-width.js';
import type { KeyHint } from './KeyHints.js';
import type { GuidanceEntry } from './guidance-entry.js';

/**
 * Local view-model for the licence fields LicenseGate reads (ADR-0048: tui-kit
 * is a pure leaf, no @swao runtime dependency). The host's full LicenseState
 * and the @swao/core LicenseState are both structurally assignable to this
 * interface (superset), so callers can pass either without a cast.
 */
export type LicenseTier = 'community' | 'consultant' | 'enterprise';

export interface LicenseStateView {
  tier: LicenseTier;
  exp?: string;
  /** Set when a paid tier expired and the session downgraded to Community (#2632). */
  expiredTier?: string;
}

interface LicenseGateProps {
  required: LicenseTier;
  state: LicenseStateView;
  feature: string;
  onOpenLicenseScreen: () => void;
  onBack: () => void;
  children: React.ReactNode;
}

const TIER_ORDER: Record<LicenseTier, number> = {
  community: 0,
  consultant: 1,
  enterprise: 2,
};

const TIER_LABEL: Record<LicenseTier, string> = {
  community: 'Community',
  consultant: 'Consultant',
  enterprise: 'Enterprise',
};

/** The key hint line of a host screen while the gate shows (#4257). */
export const LICENSE_GATE_KEYS: readonly KeyHint[] = [
  { key: 'L', verb: 'open', object: 'licence' },
  { key: 'Esc', verb: 'back' },
];

/** The guidance entry of a host screen while the gate shows; the request command in `cli` (#4257). */
export function licenseGateGuidance(required: LicenseTier, feature: string): GuidanceEntry {
  return {
    title: `${TIER_LABEL[required]} licence required`,
    what: `${feature} needs a ${TIER_LABEL[required]} licence. The Licence screen prepares the request ("Request a licence").`,
    cli: `swao license request --tier ${required}`,
  };
}

export function isAllowed(state: LicenseStateView, required: LicenseTier): boolean {
  return TIER_ORDER[state.tier] >= TIER_ORDER[required];
}

export function LicenseGate({
  required,
  state,
  feature,
  onOpenLicenseScreen,
  onBack,
  children,
}: LicenseGateProps): JSX.Element {
  const allowed = isAllowed(state, required);
  // The box spans the header rule (Design 126 section 10).
  const width = useHeaderWidth();

  useInput((input, key) => {
    if (allowed) return;
    if (input === 'l' || input === 'L') onOpenLicenseScreen();
    if (key.escape || input === 'q' || input === 'Q') onBack();
  });

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor={tokenColor('warning')} width={width}>
      <Text {...tone('warning', { bold: true })}>
        {TIER_LABEL[required]} licence required
      </Text>
      <Box marginTop={1}>
        <Text wrap="wrap">
          The feature <Text bold>{feature}</Text> requires a {TIER_LABEL[required]} licence.
        </Text>
      </Box>
      {/* #2617: show expiry context when the tier dropped due to licence expiry. */}
      {state.expiredTier && (
        <Box marginTop={1}>
          <Text {...tone('error')} wrap="wrap">
            Your {TIER_LABEL[state.expiredTier as LicenseTier] ?? state.expiredTier} licence expired on {state.exp ?? 'an unknown date'}; renew it to restore access.
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text {...tone('muted')}>
          Your current tier: <Text {...tone('accent')}>{TIER_LABEL[state.tier]}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text wrap="wrap">To request an upgrade, open the Licence screen (key L) and run &quot;Request a licence&quot;.</Text>
      </Box>
    </Box>
  );
}
