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

/**
 * CommunityFrameworkPicker -- multi-select picker for compliance frameworks.
 *
 * Presentational component: accepts pre-discovered framework options and
 * delegates disk I/O + phase transitions to the caller. Renders an empty-state
 * when no frameworks are installed, or a MultiSelect + cursor-driven GuidanceBox
 * when frameworks are available.
 *
 * Extracted from AssessScreen phase 'input-regimes' (#1660).
 */

import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { MultiSelect, type MultiSelectOption } from './MultiSelect.js';
import { GuidanceBox } from './GuidanceBox.js';
import { useOptionGuidance, type GuidanceEntry } from './guidance-entry.js';
import { KeyHints, type KeyHint } from './KeyHints.js';
import { tone } from '../theme.js';

export interface CommunityFrameworkOption {
  id: string;
  name: string;
  description?: string;
  authority?: string;
  controlsCount?: number;
  slug?: string;
  contributorName?: string;
}

export interface CommunityFrameworkPickerProps {
  app: string;
  options: CommunityFrameworkOption[];
  initialSelected: string[];
  onConfirm: (expandedIds: string[]) => void;
  onGuidanceOpenChange?: (open: boolean) => void;
  visibleCount?: number;
}

// ---------------------------------------------------------------------------
// Exported utilities (tested without rendering)
// ---------------------------------------------------------------------------

/**
 * Build the MultiSelect options list from available frameworks.
 * Prepends the "All frameworks" sentinel and formats DEMO labels.
 */
export function buildFrameworkPickerOptions(options: CommunityFrameworkOption[]): Array<{ label: string; value: string }> {
  return [
    { label: 'All frameworks (recommended)', value: 'all' },
    ...options.map(r => ({
      label: `${r.id.endsWith('_DEMO') ? r.id.replace(/_DEMO$/, '') + ' (Demo)' : r.id}${r.controlsCount ? `  (${r.controlsCount} controls)` : ''}`,
      value: r.id,
    })),
  ];
}

/**
 * Expand the raw MultiSelect selection (which may include 'all') to concrete
 * framework IDs. Case-insensitive match -- always returns canonical IDs from
 * availableIds so stored regimes exactly match installed framework IDs.
 * Defaults to all available when nothing valid is selected.
 */
export function expandFrameworkSelection(selected: string[], availableIds: string[]): string[] {
  if (selected.includes('all')) return availableIds;
  const expanded = selected.flatMap(id => {
    const match = availableIds.find(a => a.toLowerCase() === id.toLowerCase());
    return match ? [match] : [];
  });
  return expanded.length > 0 ? expanded : availableIds;
}

/** Keys of the framework picker, shown in the expanded guidance box. */
export const FRAMEWORK_PICKER_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'A', verb: 'toggle', object: 'all' }, { key: 'Enter', verb: 'confirm' },
  { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }, // #4255 (Design 126 section 7.4)
];

/** #4230: the guidance entry of one framework row. */
export function frameworkGuidanceEntry(fw: CommunityFrameworkOption): GuidanceEntry {
  return {
    title: `${fw.id}: ${fw.name}`,
    what: fw.description ?? 'No description available in framework-meta.yaml.',
    sections: [
      { label: 'Authority', text: fw.authority ?? 'not specified' },
      { label: 'Controls', text: fw.controlsCount ? `${fw.controlsCount}` : 'unknown' },
      { label: 'Folder', text: `community/${fw.slug ?? fw.id.toLowerCase()}/` },
      { label: 'Contributor', text: fw.contributorName ?? 'not specified' },
      ...(fw.id === 'LLM_SELECTION' ? [{ label: 'Note', text: 'Requires LLM provider context files in apps/{app}/context/ or Hybrid Assessment audit evidence for controls to yield signals.' }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** #4343: the key of the step without a framework in the workspace. */
const NO_FRAMEWORK_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next', object: 'without frameworks' }];

export function CommunityFrameworkPicker({
  app,
  options,
  initialSelected,
  onConfirm,
  onGuidanceOpenChange,
  visibleCount = 10,
}: CommunityFrameworkPickerProps): JSX.Element {
  const stepEntry: GuidanceEntry = {
    title: 'Community Frameworks',
    what: 'Select the compliance frameworks for Pass 11; the keys are listed below.',
    sections: [{ label: 'Available', text: `${options.length} framework(s): ${options.map((r) => r.id).join(', ')}` }],
  };
  const { entry, onCursorChange } = useOptionGuidance(stepEntry);
  const pickerOptions = useMemo<MultiSelectOption[]>(
    () => buildFrameworkPickerOptions(options).map((o) => {
      const fw = options.find((r) => r.id === o.value);
      return { ...o, guidance: fw ? frameworkGuidanceEntry(fw) : undefined };
    }),
    [options],
  );

  if (options.length === 0) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text {...tone('warning')}>No community frameworks are in this workspace.</Text>
        <Text><Text {...tone('muted')}>Frameworks live in </Text><Text {...tone('accent')}>wsp/inputs/catalogs/community/{'<folder>'}/</Text><Text {...tone('muted')}>.</Text></Text>
        {/* #4126: frameworks are copied from the GitHub repository; the install command is removed. */}
        <Box marginTop={1} flexDirection="column">
          <Text {...tone('muted')}>To get one, copy a framework folder from the GitHub repository into that folder:</Text>
          <Text>  <Text {...tone('accent')}>https://github.com/Accenture/SWAO/tree/main/community-frameworks</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text {...tone('muted')}>Compliance frameworks are optional; you can assess without them (Pass 11 is skipped).</Text>
        </Box>
        {/* #4343 (Design 126 section 7.9, B-3): the key is a KeyHints line, not a sentence. */}
        <Box marginTop={1}>
          <KeyHints hints={NO_FRAMEWORK_KEYS} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginTop={1} flexDirection="column">
        <Text {...tone('muted')}>Community frameworks determine which control sets appear in the report</Text>
        <Text {...tone('muted')}>(Compliance / Auditor PowerBI pages). Pick all that apply to this app.</Text>
        {/* #4126: the picker lists the workspace frameworks; more come from the GitHub repository. */}
        <Text {...tone('muted')}>More frameworks: copy a folder from github.com/Accenture/SWAO/tree/main/community-frameworks</Text>
        <Text {...tone('muted')}>into wsp/inputs/catalogs/community/.</Text>
        <Text {...tone('muted')}>Selection is saved to <Text {...tone('accent')}>apps/{app}/.swao.yml</Text> regimes.</Text>
      </Box>
      <Box marginTop={1}>
        <MultiSelect
          key="framework-picker"
          label="Select community frameworks"
          options={pickerOptions}
          initialSelected={initialSelected}
          allValue="all"
          onCursorChange={onCursorChange}
          visibleCount={visibleCount}
          onConfirm={(selected) => {
            const availableIds = options.map(r => r.id);
            onConfirm(expandFrameworkSelection(selected, availableIds));
          }}
          active
        />
      </Box>
      {/* #4230: one box that follows the highlighted framework; it stays open while the cursor moves. */}
      <GuidanceBox entry={entry} keys={FRAMEWORK_PICKER_KEYS} onOpenChange={onGuidanceOpenChange} />
    </Box>
  );
}
