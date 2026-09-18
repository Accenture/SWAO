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

// #2150 -- Tier upgrade prompt shown when a Community-tier user activates a
// gated menu item. Replaces the old "disabled: true / [coming soon]" treatment.

import { useMemo, useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { LicenseTier } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { LicenseGuard } from '../../license/license-guard.js';

/** Tiers that can appear as a requirement (Community is never a gate). */
type GatedTier = Exclude<LicenseTier, 'community'>;

const TIER_ORDER: Record<GatedTier, number> = { consultant: 1, enterprise: 2 };

const TIER_INFO: Record<GatedTier, { label: string; includes: string[] }> = {
  consultant: {
    label: 'Consultant',
    includes: [
      'All Community features',
      'PDF report generation',
      'Terraform module stubs (generate-tf)',
      'LZ catalogue update',
      'BI export (star schema / PowerBI / Tableau)',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    includes: [
      'All Consultant features',
      'Portfolio Operations (multi-app aggregation)',
      'Stakeholder Challenge agents',
      'SWAO Live Portal (Mode B server)',
      'MCP server integration (Claude Desktop / Claude Code)',
    ],
  },
};

export interface UpgradePromptScreenProps {
  feature: string;
  requiredTier: GatedTier;
  description?: string;
  onBack: () => void;
  onOpenLicenseScreen: () => void;
}

export function UpgradePromptScreen({ feature, requiredTier, description, onBack, onOpenLicenseScreen }: UpgradePromptScreenProps) {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  const width = Math.min(98, Math.max(61, cols - 2));

  useInput((input, key) => {
    if (input === 'l' || input === 'L') { onOpenLicenseScreen(); return; }
    if (key.escape || input === 'q' || input === 'Q' || key.return) onBack();
  });

  // #2617: load licence state to detect expiry-driven downgrade.
  const licenseState = useMemo(() => {
    try { return LicenseGuard.load().state; } catch { return null; }
  }, []);

  const info = TIER_INFO[requiredTier];
  const expiredTier = licenseState?.expiredTier;
  const expiredAt   = licenseState?.exp;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Upgrade Required" />

      {/* #2616: consistent yellow-box styling matching LicenseGate width + content. */}
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1} width={width}>
        <Text bold color="yellow">
          {feature} requires a {info.label} licence.
        </Text>
        {/* #2617: show expiry context when the downgrade was caused by licence expiry. */}
        {expiredTier && TIER_ORDER[expiredTier as GatedTier] >= TIER_ORDER[requiredTier] && (
          <Box marginTop={1}>
            <Text color="red">
              Your {TIER_INFO[expiredTier as GatedTier]?.label ?? expiredTier} licence expired on {expiredAt ?? 'unknown date'} -- renew to restore access.
            </Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Your current effective tier: <Text color="cyanBright">Community</Text> (free, unlimited assessments).</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>{info.label} tier includes:</Text>
          {info.includes.map((line, i) => (
            <Text key={i}>  - {line}</Text>
          ))}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text>To request an upgrade:</Text>
          <Text dimColor>  Press <Text bold>L</Text> -- open the Licence screen and run "Request a licence".</Text>
          <Text dimColor>  Or run on the command line: <Text color="cyanBright">swao license request --tier {requiredTier}</Text></Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Press <Text bold>Esc</Text> or <Text bold>q</Text> to go back.</Text>
        </Box>
      </Box>

      {description && (
        <GuidanceBox
          title={feature}
          what={description}
          initiallyCollapsed={true}
        />
      )}
    </Box>
  );
}
