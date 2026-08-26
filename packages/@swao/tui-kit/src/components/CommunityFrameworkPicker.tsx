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

import { useState } from 'react';
import { Box, Text } from 'ink';
import { MultiSelect } from './MultiSelect.js';
import { GuidanceBox } from './GuidanceBox.js';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommunityFrameworkPicker({
  app,
  options,
  initialSelected,
  onConfirm,
  onGuidanceOpenChange,
  visibleCount = 10,
}: CommunityFrameworkPickerProps): JSX.Element {
  const [cursor, setCursor] = useState<string>('all');

  if (options.length === 0) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">No community frameworks are installed in this workspace.</Text>
        <Text><Text dimColor>Frameworks live in </Text><Text color="cyanBright">wsp/inputs/catalogs/community/{'<id>'}/</Text><Text dimColor>. Install bundled ones from the shell:</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text>  <Text color="green">swao framework list</Text><Text dimColor>          show the bundled frameworks</Text></Text>
          <Text>  <Text color="green">swao framework install {'<id>'}</Text><Text dimColor>  e.g. gdpr, bsi-c5, dora, iso-27001</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>If "swao framework list" shows none, this build may be missing its bundled</Text>
        </Box>
        <Text dimColor>frameworks -- please report it. Compliance frameworks are optional; you can</Text>
        <Text dimColor>assess without them (Pass 11 is skipped).</Text>
        <Box marginTop={1}>
          <Text>Press <Text color="cyanBright">Enter</Text> to continue without frameworks, <Text color="cyanBright">Esc</Text> to go back.</Text>
        </Box>
      </Box>
    );
  }

  const activeFw = options.find(r => r.id === cursor);

  return (
    <Box flexDirection="column">
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Community frameworks determine which control sets appear in the report</Text>
        <Text dimColor>(Compliance / Auditor PowerBI pages). Pick all that apply to this app.</Text>
        <Text dimColor>Selection is saved to <Text color="cyanBright">apps/{app}/.swao.yml</Text> regimes.</Text>
      </Box>
      <Box marginTop={1}>
        <MultiSelect
          key="framework-picker"
          label="Select community frameworks (space to toggle, Enter to confirm)"
          options={buildFrameworkPickerOptions(options)}
          initialSelected={initialSelected}
          allValue="all"
          onCursorChange={setCursor}
          visibleCount={visibleCount}
          onConfirm={(selected) => {
            const availableIds = options.map(r => r.id);
            onConfirm(expandFrameworkSelection(selected, availableIds));
          }}
          active
        />
      </Box>
      {cursor === 'all' && (
        <GuidanceBox
          title="Community Frameworks"
          what="Select compliance frameworks for Pass 11. Space to toggle, A for all."
          details={[{ label: 'Available', value: `${options.length} framework(s): ${options.map(r => r.id).join(', ')}` }]}
          affordances={['Space -- toggle  |  A -- all  |  Enter -- confirm']}
          onOpenChange={onGuidanceOpenChange}
        />
      )}
      {activeFw && (
        <GuidanceBox
          title={`${activeFw.id} -- ${activeFw.name}`}
          what={activeFw.description ?? 'No description available in framework-meta.yaml.'}
          details={[
            { label: 'Authority',    value: activeFw.authority ?? 'not specified' },
            { label: 'Controls',     value: activeFw.controlsCount ? `${activeFw.controlsCount}` : 'unknown' },
            { label: 'Folder',       value: `community/${activeFw.slug ?? activeFw.id.toLowerCase()}/` },
            { label: 'Contributor',  value: activeFw.contributorName ?? 'not specified' },
            ...(activeFw.id === 'LLM_SELECTION' ? [{ label: 'Note', value: 'Requires LLM provider context files in apps/{app}/context/ or Hybrid Assessment audit evidence for controls to yield signals.' }] : []),
          ]}
          affordances={['Space -- toggle this framework', 'A -- toggle all', 'Enter -- confirm selection']}
          onOpenChange={onGuidanceOpenChange}
        />
      )}
    </Box>
  );
}
