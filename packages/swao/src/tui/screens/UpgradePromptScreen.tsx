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

// #2150: Tier upgrade prompt shown when a Community-tier user activates a
// gated menu item. Replaces the old "disabled: true / [coming soon]" treatment.
// #4257 (TUI-13, Design 126 sections 3, 6 and 7): on ScreenLayout; the
// requirement and the expiry as StatusRows, the current tier as a DetailRow,
// the actions as a numbered menu (open the Licence screen, back) instead of
// the letter L named only in the text; the request command only in the
// guidance `cli` field; theme tokens only.

import { useMemo, useRef } from 'react';
import { Text, useInput } from 'ink';
import type { LicenseTier } from '@swao/tui-kit';
import { DetailRow, SelectInput, ScreenLayout, StatusRow, guidanceOwnsKey, tone, useOptionGuidance, type GuidanceEntry, type KeyHint, type SelectOption } from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { LicenseGuard } from '../../license/license-guard.js';

/** Tiers that can appear as a requirement (Community is never a gate). */
type GatedTier = Exclude<LicenseTier, 'community'>;

const TIER_ORDER: Record<GatedTier, number> = { consultant: 1, enterprise: 2 };

const TIER_INFO: Record<GatedTier, { label: string; includes: string[] }> = {
  consultant: {
    label: 'Consultant',
    includes: [
      'All Community features',
      'HTML publication of assessment runs and HTML reports',
      'PDF report generation',
      'Power BI dashboard templates (.pbit)',
      'LZ catalogue update',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    includes: [
      'All Consultant features',
      'Portfolio Operations (multi-app aggregation)',
      'Service portfolio export',
      'Stakeholder Challenge agents',
      'HTML Editor',
      'MCP server integration (Claude Desktop, Claude Code)',
      'SWAO Chat',
    ],
  },
};

/** The keys of the screen: a numbered menu of two actions. */
export const UPGRADE_PROMPT_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' },
];

/** The guidance of the prompt: what the tier adds and the request command. */
export function upgradeGuidance(feature: string, requiredTier: GatedTier, description?: string): GuidanceEntry {
  return {
    title: feature,
    what: description ?? `${feature} needs a ${TIER_INFO[requiredTier].label} licence. Request one on the Licence screen.`,
    sections: [{ label: 'Request', text: 'Licence screen, "Request a licence"' }],
    cli: `swao license request --tier ${requiredTier}`,
  };
}

/** The two actions: open the Licence screen or go back. */
export function upgradeOptions(requiredTier: GatedTier): SelectOption[] {
  const label = TIER_INFO[requiredTier].label;
  return [
    {
      label: 'Open the Licence screen',
      value: 'license',
      guidance: { title: 'Open the Licence screen', what: `Run "Request a licence" there to request a ${label} licence.`, cli: `swao license request --tier ${requiredTier}` },
    },
    { label: 'Back', value: 'back', guidance: { title: 'Back', what: 'Return to the previous menu without a change.' } },
  ];
}

export interface UpgradePromptScreenProps {
  feature: string;
  requiredTier: GatedTier;
  description?: string;
  onBack: () => void;
  onOpenLicenseScreen: () => void;
}

export function UpgradePromptScreen({ feature, requiredTier, description, onBack, onOpenLicenseScreen }: UpgradePromptScreenProps) {
  const header = useScreenHeader('Upgrade Required');
  const guidanceOpenRef = useRef(false);
  const options = useMemo(() => upgradeOptions(requiredTier), [requiredTier]);
  // #4213 (Design 126 section 9): the guidance box follows the highlighted action.
  const actionGuidance = useOptionGuidance(upgradeGuidance(feature, requiredTier, description));

  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (key.escape) onBack();
  });

  // #2617: load licence state to detect expiry-driven downgrade.
  const licenseState = useMemo(() => {
    try { return LicenseGuard.load().state; } catch { return null; }
  }, []);

  const info = TIER_INFO[requiredTier];
  const expiredTier = licenseState?.expiredTier;
  const expiredAt   = licenseState?.exp;
  const expired = Boolean(expiredTier && TIER_ORDER[expiredTier as GatedTier] >= TIER_ORDER[requiredTier]);

  return (
    <ScreenLayout
      header={header}
      title={{ title: `${feature} requires a ${info.label} licence` }}
      keys={UPGRADE_PROMPT_KEYS}
      guidance={{ entry: actionGuidance.entry, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      <StatusRow level="warn" label={feature} summary={`needs a ${info.label} licence`} />
      {/* #2617: show expiry context when the downgrade was caused by licence expiry. */}
      {expired && (
        <StatusRow
          level="fail"
          label="Licence"
          summary={`your ${TIER_INFO[expiredTier as GatedTier]?.label ?? expiredTier} licence expired on ${expiredAt ?? 'an unknown date'}; renew it to restore access`}
        />
      )}
      <DetailRow label="Your tier" value="Community (free, unlimited assessments)" />
      <Text> </Text>
      <Text {...tone('text', { bold: true })}>{info.label} tier includes:</Text>
      {info.includes.map((line) => (
        <Text key={line} {...tone('muted')}>{`  ${line}`}</Text>
      ))}
      <Text> </Text>
      <SelectInput
        label="Next"
        options={options}
        numbered
        visibleCount={options.length}
        showKeyHints={false}
        onCursorChange={actionGuidance.onCursorChange}
        onSelect={(value) => { if (value === 'license') onOpenLicenseScreen(); else onBack(); }}
      />
    </ScreenLayout>
  );
}
