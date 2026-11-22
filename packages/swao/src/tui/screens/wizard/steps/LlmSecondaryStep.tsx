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

// #4254 / #4230 (Design 126 sections 4.5, 7.7 and 9): the yes/no question on
// SetupStepFrame (picker hints, step title without a number); each answer
// carries its own guidance entry (#4230 Log names this call site). "No: skip"
// is the visible entry, Esc belongs to the wizard. The configure phase is the
// LLM step in its secondary form; its connector picker goes back to the
// question with Shift+Tab or Left arrow.

import { useState } from 'react';
import { Box, Text } from 'ink';
import { SelectInput, fitToWidth, useHeaderWidth, useOptionGuidance, type GuidanceEntry, type GuidanceSection, type SelectOption } from '@swao/tui-kit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { type LlmProvider } from '../shared.js';
import { LlmStep } from './LlmStep.js';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';

// -- Secondary LLM provider (#1768) -------------------------------------------

// Reads the latest LLM Assessment run (if any) and returns the connector id
// of the top-ranked non-primary leg as a suggestion for the secondary slot.
function suggestSecondaryConnector(workspaceRoot: string, primaryProvider: LlmProvider): string | null {
  try {
    const latestFile = join(workspaceRoot, 'llm-assessments', 'swao', 'latest.txt');
    if (!existsSync(latestFile)) return null;
    const ts = readFileSync(latestFile, 'utf-8').trim();
    const pubPath = join(workspaceRoot, 'llm-assessments', 'swao', ts, 'comparison', 'publication-model.json');
    if (!existsSync(pubPath)) return null;
    const raw = JSON.parse(readFileSync(pubPath, 'utf-8')) as Record<string, unknown>;
    const final = raw['final'] as { rank?: Record<string, number | null> } | undefined;
    if (!final?.rank) return null;
    const legs = raw['legs'] as Array<{ id: string; connector: string; primary?: boolean }> | undefined;
    if (!legs) return null;
    // Sort legs by rank, pick the best-ranked leg that is NOT the primary.
    const ranked = Object.entries(final.rank)
      .filter(([, r]) => r !== null)
      .sort(([, a], [, b]) => (a as number) - (b as number));
    const primaryConnector = primaryProvider.startsWith('gw:') ? primaryProvider.slice(3) : null;
    for (const [legId] of ranked) {
      const leg = legs.find((l) => l.id === legId);
      if (!leg) continue;
      if (leg.primary) continue;
      if (primaryConnector && leg.connector === primaryConnector) continue;
      return leg.connector;
    }
    return null;
  } catch {
    return null;
  }
}

/** #4230: the two answers, each with its own guidance entry. */
export function secondaryOptions(suggestion: string | null): SelectOption[] {
  const sections: GuidanceSection[] = suggestion ? [{ label: 'Suggestion', text: `${suggestion} ranked best after the primary in your last LLM Assessment run.` }] : [];
  return [
    {
      label: 'Yes: configure a secondary provider now',
      value: 'yes',
      guidance: {
        title: 'Configure a secondary provider',
        what: 'A second provider runs the same passes as the primary in the LLM Assessment; the reports show both side by side (Design 092). Compares providers, model versions or a private deployment.',
        sections,
      },
    },
    {
      label: 'No: skip (can be added later in .swao.yml)',
      value: 'no',
      guidance: {
        title: 'Skip the secondary provider',
        what: 'Only the primary LLM is configured. Add providers.llm.secondary in .swao.yml at any time, or run this step again from Setup.',
        sections,
      },
    },
  ];
}

const STEP_GUIDANCE: GuidanceEntry = {
  title: 'Secondary LLM provider',
  what: 'Configure a second provider to enable head-to-head model comparison in the LLM Assessment (Design 092).',
};

export function LlmSecondaryStep({
  workspaceRoot,
  primaryProvider,
  onSkip,
  onNext,
}: {
  workspaceRoot: string;
  primaryProvider: LlmProvider;
  onSkip: () => void;
  onNext: (provider: LlmProvider, model: string, endpoint: string, openLlmBase: string) => void;
}) {
  const [phase, setPhase] = useState<'prompt' | 'configure'>('prompt');
  const suggestion = suggestSecondaryConnector(workspaceRoot, primaryProvider);
  const { entry, onCursorChange } = useOptionGuidance(STEP_GUIDANCE);
  const width = useHeaderWidth();

  if (phase === 'configure') {
    return <LlmStep workspaceRoot={workspaceRoot} onNext={onNext} isSecondary onBack={() => setPhase('prompt')} />;
  }

  return (
    <SetupStepFrame title="Secondary LLM" subtitle="Optional: a second provider for the LLM Assessment comparison." kind="picker" guidance={entry}>
      <Box flexDirection="column">
        {suggestion && <Text>{fitToWidth(`Suggestion from the last LLM Assessment: ${suggestion}`, width)}</Text>}
        <Box marginTop={suggestion ? 1 : 0}>
          <SelectInput
            label="Add a secondary LLM provider?"
            options={secondaryOptions(suggestion)}
            numbered
            showKeyHints={false}
            visibleCount={2}
            onCursorChange={onCursorChange}
            onSelect={(v) => {
              if (v === 'yes') setPhase('configure');
              else onSkip();
            }}
            active
          />
        </Box>
      </Box>
    </SetupStepFrame>
  );
}
