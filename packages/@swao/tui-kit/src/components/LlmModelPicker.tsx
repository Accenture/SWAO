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
 * LlmModelPicker -- per-app LLM provider selector.
 *
 * Shows four options (workspace default, Anthropic, OpenAI, Ollama). The
 * caller reads the current config and provides a pre-formatted label string.
 * On selection, calls onSelect with the raw provider value so the caller can
 * write to .swao.yml or clear the override.
 *
 * Extracted from AssessScreen phase 'input-app-llm' (#1660).
 */

import { Box, Text } from 'ink';
import { SelectInput, type SelectOption } from './SelectInput.js';
import { GuidanceBox } from './GuidanceBox.js';
import { useOptionGuidance, type GuidanceEntry } from './guidance-entry.js';
import type { KeyHint } from './KeyHints.js';
import { tone } from '../theme.js';

export interface LlmModelPickerProps {
  app: string;
  currentLabel: string;
  onSelect: (value: string) => void;
  onGuidanceOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Exported utilities (tested without rendering)
// ---------------------------------------------------------------------------

/** What each provider option means (#4230: the guidance box follows the highlighted option). */
const LLM_PROVIDER_WHAT: Readonly<Record<string, string>> = {
  'workspace-default': 'Removes the override of this app, so its assessments use the LLM provider of the workspace again.',
  anthropic: 'Anthropic Claude through the Anthropic Messages API. Needs an Anthropic API key in the credential store.',
  openai: 'OpenAI through the OpenAI API. Needs an OpenAI API key in the credential store.',
  ollama: 'A local Ollama server on this machine. No API key; the model runs locally and no code leaves the machine.',
};

/** Canonical LLM provider options for the TUI picker, each with its guidance entry. */
export const LLM_PROVIDER_OPTIONS: SelectOption[] = [
  { label: 'Use workspace default (remove override)',  value: 'workspace-default' },
  { label: 'Anthropic Claude',                         value: 'anthropic'         },
  { label: 'OpenAI',                                   value: 'openai'            },
  { label: 'Ollama (local)',                           value: 'ollama'            },
].map((o) => ({ ...o, guidance: { title: o.label, what: LLM_PROVIDER_WHAT[o.value] ?? o.label } }));

/** Keys of the per-app LLM picker, shown in the expanded guidance box. */
export const LLM_MODEL_PICKER_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'confirm' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }, // #4255 (Design 126 section 7.4)
];

/**
 * Format the current LLM label shown above the picker.
 * When no per-app override is set, falls back to the workspace-level type.
 */
export function formatLlmCurrentLabel(
  appType: string | undefined,
  appModel: string | undefined,
  wsType: string | undefined,
): string {
  if (appType) return `${appType}${appModel ? ` (${appModel})` : ''}`;
  return `workspace default (${wsType ?? 'not set'})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LlmModelPicker({
  app,
  currentLabel,
  onSelect,
  onGuidanceOpenChange,
}: LlmModelPickerProps): JSX.Element {
  // #4230: the step entry, followed by the entry of the highlighted provider.
  const sections = [
    { label: 'Current', text: currentLabel },
    { label: 'Storage', text: `apps/${app}/.swao.yml  (providers.llm.primary)` },
  ];
  const stepEntry: GuidanceEntry = {
    title: 'Per-app LLM override',
    what: 'Override the workspace-level LLM provider for this specific app. The selected provider is saved to the app .swao.yml and used for all future assessments of this app.',
    sections,
  };
  const { entry, onCursorChange } = useOptionGuidance(stepEntry);
  const shown: GuidanceEntry = entry === stepEntry ? entry : { ...entry, sections: [...(entry.sections ?? []), ...sections] };
  return (
    <Box flexDirection="column">
      <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
      <Text {...tone('muted')}>Current LLM: <Text {...tone('accent')}>{currentLabel}</Text></Text>
      <Box marginTop={1}>
        <SelectInput
          label="LLM provider for this app"
          options={LLM_PROVIDER_OPTIONS}
          onSelect={onSelect}
          onCursorChange={onCursorChange}
          active
        />
      </Box>
      <GuidanceBox entry={shown} keys={LLM_MODEL_PICKER_KEYS} onOpenChange={onGuidanceOpenChange} />
    </Box>
  );
}
