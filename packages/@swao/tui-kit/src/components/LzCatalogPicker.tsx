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
 * LzCatalogPicker -- sovereignty framework multi-select for LZ Catalog Assessment.
 *
 * Shows ALL community frameworks installed in the workspace. No pre-filtering
 * by sovereignty_requirements -- the user decides which frameworks to apply as
 * gates. When no frameworks are installed, renders an empty-state with a yellow
 * notice and allows the user to proceed without a gate (#1678).
 *
 * Extracted from AssessScreen phase 'input-lz-frameworks' (#1660).
 * Unified label format + cursor-driven GuidanceBox (#1769).
 */

import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { MultiSelect, type MultiSelectOption } from './MultiSelect.js';
import { GuidanceBox } from './GuidanceBox.js';
import { useOptionGuidance, type GuidanceEntry } from './guidance-entry.js';
import type { KeyHint } from './KeyHints.js';
import { tone } from '../theme.js';

export interface LzPickerOption {
  label: string;
  value: string;
  name?: string;
  description?: string;
  authority?: string;
  controlsCount?: number;
  slug?: string;
  contributorName?: string;
  gate_summary?: string;
}

export interface LzCatalogPickerProps {
  app: string;
  providerLabel: string;
  options: LzPickerOption[];
  onConfirm: (selected: string[]) => void;
  onGuidanceOpenChange?: (open: boolean) => void;
  visibleCount?: number;
}

// ---------------------------------------------------------------------------
// Exported utilities (tested without rendering)
// ---------------------------------------------------------------------------

/**
 * Display-name overrides for framework IDs where the raw ID is not
 * user-friendly enough. Sovereignty details appear in the GuidanceBox,
 * not in the picker label. Only override when the ID meaningfully differs
 * from what users would recognise (e.g. NIST_SP_800_66R2 vs HIPAA).
 */
export const CURATED_LZ_FW_LABELS: Record<string, string> = {
  NIST_SP_800_66R2: 'HIPAA / NIST SP 800-66r2',
};

/**
 * Convert raw framework entries to LzPickerOptions with a unified label
 * format matching the App Assessment community framework picker:
 *   ID  (N controls)
 * DEMO-suffix variants show as "ID (Demo)  (N controls)".
 * Sovereignty details are passed through to the GuidanceBox via rich fields.
 */
export function applyLzCuratedLabels(
  options: Array<{
    id: string;
    name?: string;
    description?: string;
    authority?: string;
    controlsCount?: number;
    slug?: string;
    contributorName?: string;
    gate_summary?: string;
    label?: string;
  }>,
): LzPickerOption[] {
  return options.map(f => {
    const curatedName = CURATED_LZ_FW_LABELS[f.id];
    const displayId = curatedName ?? (f.id.endsWith('_DEMO')
      ? f.id.replace(/_DEMO$/, '') + ' (Demo)'
      : f.id);
    const label = `${displayId}${f.controlsCount != null ? `  (${f.controlsCount} controls)` : ''}`;
    return {
      label,
      value: f.id,
      name: f.name,
      description: f.description,
      authority: f.authority,
      controlsCount: f.controlsCount,
      slug: f.slug,
      contributorName: f.contributorName,
      gate_summary: f.gate_summary,
    };
  });
}

/** Keys of the sovereignty framework picker, shown in the expanded guidance box. */
export const LZ_FRAMEWORK_PICKER_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'A', verb: 'toggle', object: 'all' },
  { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back', object: 'to provider' }, { key: 'Esc', verb: 'abort' }, // #4255 (Design 126 section 7.4)
];

/** The step entry of the sovereignty framework picker (no framework highlighted). */
export const LZ_FRAMEWORKS_STEP_GUIDANCE: GuidanceEntry = {
  title: 'Sovereignty Frameworks',
  what: 'Select which sovereignty frameworks to apply as a gate. Frameworks with sovereignty requirements (BSI C5, GDPR, HIPAA) actively block regions that do not meet their operator, residency, or certification rules. Frameworks without sovereignty requirements are included as compliance context gates but do not block any region. Enter with nothing selected to run without a gate (catalogue-level fit/gap only).',
};

/** #4230: the guidance entry of one sovereignty framework row. */
export function lzFrameworkGuidanceEntry(o: LzPickerOption): GuidanceEntry {
  return {
    title: `${o.value}: ${o.name ?? o.value}`,
    what: o.description ?? 'No description available in framework-meta.yaml.',
    sections: [
      { label: 'Authority', text: o.authority ?? 'not specified' },
      { label: 'Controls', text: o.controlsCount != null ? `${o.controlsCount}` : 'unknown' },
      { label: 'Sovereignty gate', text: o.gate_summary ?? 'no sovereignty requirements defined' },
      { label: 'Folder', text: `community/${o.slug ?? o.value.toLowerCase()}/` },
      ...(o.contributorName ? [{ label: 'Contributor', text: o.contributorName }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LzCatalogPicker({
  app,
  providerLabel,
  options,
  onConfirm,
  onGuidanceOpenChange,
  visibleCount,
}: LzCatalogPickerProps): JSX.Element {
  // #4230: one box that follows the highlighted framework (per-option entries).
  const { entry, onCursorChange } = useOptionGuidance(LZ_FRAMEWORKS_STEP_GUIDANCE);
  const pickerOptions = useMemo<MultiSelectOption[]>(
    () => options.map((o) => ({ label: o.label, value: o.value, guidance: lzFrameworkGuidanceEntry(o) })),
    [options],
  );

  return (
    <Box flexDirection="column">
      <Text>App: <Text {...tone('accent')}>{app}</Text> | CSP(s): <Text {...tone('accent')}>{providerLabel}</Text></Text>
      <Box marginTop={1}>
        <MultiSelect
          label="Sovereignty frameworks (optional, Enter with none selected runs without a gate)"
          options={pickerOptions}
          allowEmptyConfirm
          visibleCount={visibleCount}
          onCursorChange={onCursorChange}
          onConfirm={onConfirm}
        />
      </Box>
      {options.length === 0 && (
        <Text {...tone('warning')}>No sovereignty frameworks found in wsp/inputs/catalogs/community/; the run goes on without a gate.</Text>
      )}
      <GuidanceBox entry={entry} keys={LZ_FRAMEWORK_PICKER_KEYS} onOpenChange={onGuidanceOpenChange} />
    </Box>
  );
}
