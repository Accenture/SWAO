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
import { SelectInput } from './SelectInput.js';
import { GuidanceBox } from './GuidanceBox.js';

export interface LlmModelPickerProps {
  app: string;
  currentLabel: string;
  onSelect: (value: string) => void;
  onGuidanceOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Exported utilities (tested without rendering)
// ---------------------------------------------------------------------------

/** Canonical LLM provider options for the TUI picker. */
export const LLM_PROVIDER_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Use workspace default (remove override)',  value: 'workspace-default' },
  { label: 'Anthropic Claude',                         value: 'anthropic'         },
  { label: 'OpenAI',                                   value: 'openai'            },
  { label: 'Ollama (local)',                            value: 'ollama'            },
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
  return (
    <Box flexDirection="column">
      <Text>App: <Text color="cyanBright">{app}</Text></Text>
      <Text dimColor>Current LLM: <Text color="cyanBright">{currentLabel}</Text></Text>
      <Box marginTop={1}>
        <SelectInput
          label="LLM provider for this app"
          options={LLM_PROVIDER_OPTIONS}
          onSelect={onSelect}
          active
        />
      </Box>
      <GuidanceBox
        title="Per-app LLM override"
        what="Override the workspace-level LLM provider for this specific app. The selected provider is saved to the app .swao.yml and used for all future assessments of this app."
        details={[
          { label: 'Current', value: currentLabel },
          { label: 'Storage', value: `apps/${app}/.swao.yml  (providers.llm.primary)` },
        ]}
        affordances={['Up/Down -- pick  |  Enter -- save and return  |  Esc -- cancel']}
        onOpenChange={onGuidanceOpenChange}
      />
    </Box>
  );
}
