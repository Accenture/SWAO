// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4349: the notice and hint block of the Application Assessment Target
// Landing Zone step. Both sit in one indented Box, so every wrapped line
// starts at the same column (Design 126 section 10); the strings carry no
// leading spaces. Keys live in KeyHints and the guidance box, not in the body.

import { Box, Text } from 'ink';
import { tone, useHeaderWidth, type KeyHint, type MultiSelectOption } from '@swao/tui-kit';

/** The header subtitle of every Target Landing Zone sub-step (no double hyphen, no "(optional)"). */
export const TARGET_LZ_SUBTITLE = 'Application Assessment: Target Landing Zone';

/** #4255: the step title of the Target LZ step (the step bar label, section 4.5). */
export const TARGET_LZ_TITLE = 'Target LZ';

// #4255 (Design 126 sections 7.2, 7.4 and 7.7): Esc aborts the flow and never
// skips or goes back; the left arrow (Shift+Tab in a text input) goes back one
// step; the LZ fit is skipped by confirming the provider or region list with
// nothing selected.

/** The keys of the provider step. */
export const TARGET_LZ_PROVIDER_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' },
  { key: 'Space', verb: 'toggle' },
  { key: 'A', verb: 'toggle', object: 'all' },
  { key: 'Enter', verb: 'next' },
  { key: '←', verb: 'back' },
  { key: 'Esc', verb: 'abort' },
];

/** The keys of the "provider without a region" confirmation. */
export const TARGET_LZ_GAP_KEYS: readonly KeyHint[] = [
  { key: 'Enter', verb: 'confirm', object: 'without them' },
  { key: '←', verb: 'back', object: 'to the regions' },
  { key: 'Esc', verb: 'abort' },
];

/** The keys of the region filter step (a text input). */
export const TARGET_LZ_FILTER_KEYS: readonly KeyHint[] = [
  { key: 'Type', verb: 'filter' },
  { key: 'Enter', verb: 'next' },
  { key: 'Shift+Tab', verb: 'back', object: 'to the providers' },
  { key: 'Esc', verb: 'abort' },
];

/** The keys of the region step; with a filter set, the left arrow clears it first. */
export function targetLzRegionKeys(filterActive: boolean): KeyHint[] {
  return [
    { key: '↑↓', verb: 'select' },
    { key: 'Space', verb: 'toggle' },
    { key: 'A', verb: 'toggle', object: 'all' },
    { key: 'Enter', verb: 'next' },
    filterActive ? { key: '←', verb: 'cancel', object: 'filter' } : { key: '←', verb: 'back' },
    { key: 'Esc', verb: 'abort' },
  ];
}

/** The keys of the manual region entry (no catalogue loaded). */
export const TARGET_LZ_MANUAL_REGION_KEYS: readonly KeyHint[] = [
  { key: 'Enter', verb: 'next', object: '(empty skips the LZ fit)' },
  { key: 'Shift+Tab', verb: 'back' },
  { key: 'Esc', verb: 'abort' },
];

/** #4255 (Design 126 section 7.7): the value of the "Skip this step" entry of the provider step. */
export const TARGET_LZ_SKIP = '__skip_target_lz__';

/** #4255: the last entry of the provider list: an action (no checkbox) that starts the run without an LZ fit. */
export const TARGET_LZ_SKIP_OPTION: MultiSelectOption = {
  label: 'Skip this step',
  value: TARGET_LZ_SKIP,
  action: true,
  guidance: {
    title: 'Skip this step',
    what: 'Starts the assessment without a Target LZ fit: nothing is assessed against the landing zone catalogue in this run. The selection above is not used.',
  },
};

/** #4481 (Design 012 section 5a): the value of the market scan entry of the provider step. */
export const TARGET_LZ_MARKET_SCAN = '__lz_market_scan__';

/**
 * #4481: the market scan entry of the provider step, an action that toggles
 * `swao assess --lz-market-scan` for this run (off by default). The label
 * shows the state.
 */
export function targetLzMarketScanOption(on: boolean): MultiSelectOption {
  return {
    label: `Market scan (bundled provider list, lower confidence): ${on ? 'on' : 'off'}`,
    value: TARGET_LZ_MARKET_SCAN,
    action: true,
    guidance: {
      title: 'Market scan',
      what: 'Enter switches the market scan on or off for this run. When on, the synthesis also scores the cloud provider list bundled with SWAO and the publication shows it as its own part, lower confidence: it is not a landing zone catalogue, and providers not reviewed within 180 days are listed as not reviewed without a fit score. The selected targets above are assessed either way.',
    },
  };
}

/** #4481: the assess argument of the market scan choice (none when off). */
export function lzMarketScanArgs(on: boolean): string[] {
  return on ? ['--lz-market-scan'] : [];
}

/** The hint line of the provider step. */
export const TARGET_LZ_PROVIDER_HINT = 'Select one or more target CSPs. The HTML publication shows the per-service readiness of each.';

export interface TargetLzNoticeProps {
  /** The short LZ source line (linked apps only). */
  notice?: string | null;
  /** The dim hint below it. */
  hint?: string;
  /** Usable width (default: the header width); the block is indented by two columns inside it. */
  width?: number;
}

export function TargetLzNotice({ notice, hint, width }: TargetLzNoticeProps): JSX.Element | null {
  const headerWidth = useHeaderWidth();
  if (!notice && !hint) return null;
  return (
    <Box flexDirection="column" marginLeft={2} width={Math.max(20, (width ?? headerWidth) - 2)}>
      {notice ? <Text {...tone('warning')} wrap="wrap">{notice}</Text> : null}
      {hint ? <Text {...tone('muted')} wrap="wrap">{hint}</Text> : null}
    </Box>
  );
}
