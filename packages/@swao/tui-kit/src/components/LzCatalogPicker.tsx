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

import { useState } from 'react';
import { Box, Text } from 'ink';
import { MultiSelect } from './MultiSelect.js';
import { GuidanceBox } from './GuidanceBox.js';

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
  const [cursor, setCursor] = useState<string>('');
  const activeFw = options.find(o => o.value === cursor);

  return (
    <Box flexDirection="column">
      <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
      <Box marginTop={1}>
        <MultiSelect
          label="Sovereignty frameworks (optional -- Enter with none selected = no gate)"
          options={options}
          allowEmptyConfirm
          visibleCount={visibleCount}
          onCursorChange={setCursor}
          onConfirm={onConfirm}
        />
      </Box>
      {options.length > 0 && !activeFw && (
        <Box>
          <Text dimColor>All installed community frameworks are listed. Frameworks with sovereignty requirements (e.g. BSI C5, GDPR) block non-compliant regions; others apply as compliance gates without regional blocking.</Text>
        </Box>
      )}
      {options.length === 0 && (
        <Text color="yellow">No sovereignty frameworks found in wsp/inputs/catalogs/community/ -- press Enter to run without a gate.</Text>
      )}
      {!activeFw ? (
        <GuidanceBox
          title="Sovereignty Frameworks"
          what="Select which sovereignty frameworks to apply as a gate. Frameworks with sovereignty requirements (BSI C5, GDPR, HIPAA) actively block regions that do not meet their operator, residency, or certification rules. Frameworks without sovereignty requirements are included as compliance context gates but do not block any region. Enter with nothing selected to run without a gate (catalogue-level fit/gap only)."
          affordances={['Up/Down -- move  |  Space -- toggle  |  A -- all  |  Enter -- confirm  |  Esc -- back to provider']}
          onOpenChange={onGuidanceOpenChange}
        />
      ) : (
        <GuidanceBox
          title={`${activeFw.value} -- ${activeFw.name ?? activeFw.value}`}
          what={activeFw.description ?? 'No description available in framework-meta.yaml.'}
          details={[
            { label: 'Authority',       value: activeFw.authority ?? 'not specified' },
            { label: 'Controls',        value: activeFw.controlsCount != null ? `${activeFw.controlsCount}` : 'unknown' },
            { label: 'Sovereignty gate', value: activeFw.gate_summary ?? 'no sovereignty requirements defined' },
            { label: 'Folder',          value: `community/${activeFw.slug ?? activeFw.value.toLowerCase()}/` },
            ...(activeFw.contributorName ? [{ label: 'Contributor', value: activeFw.contributorName }] : []),
          ]}
          affordances={['Space -- toggle  |  A -- all  |  Enter -- confirm  |  Esc -- back to provider']}
          onOpenChange={onGuidanceOpenChange}
        />
      )}
    </Box>
  );
}
