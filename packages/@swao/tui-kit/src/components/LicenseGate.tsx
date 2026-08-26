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

import { Box, Text, useInput } from 'ink';

/**
 * Local view-model for the licence fields LicenseGate reads (ADR-0048: tui-kit
 * is a pure leaf -- no @swao runtime dependency). The host's full LicenseState
 * and the @swao/core LicenseState are both structurally assignable to this
 * interface (superset), so callers can pass either without a cast.
 */
export type LicenseTier = 'community' | 'consultant' | 'enterprise';

export interface LicenseStateView {
  tier: LicenseTier;
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

  useInput((input, key) => {
    if (allowed) return;
    if (input === 'l' || input === 'L') onOpenLicenseScreen();
    if (key.escape || input === 'q' || input === 'Q') onBack();
  });

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="yellow">
      <Text bold color="yellow">
        {TIER_LABEL[required]} licence required
      </Text>
      <Box marginTop={1}>
        <Text>
          The feature <Text bold>{feature}</Text> requires a {TIER_LABEL[required]} licence.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Your current tier: <Text color="cyanBright">{TIER_LABEL[state.tier]}</Text>
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>To request an upgrade:</Text>
        <Text dimColor>  Press <Text bold>L</Text> -- open the Licence screen and run "Request a licence".</Text>
        <Text dimColor>  Or run on the command line: <Text color="cyanBright">swao license request --tier {required}</Text></Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press <Text bold>Esc</Text> or <Text bold>q</Text> to go back.</Text>
      </Box>
    </Box>
  );
}
