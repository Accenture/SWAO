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

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput, GuidanceBox } from '@swao/tui-kit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { type LlmProvider, setWizardGuidanceOpen } from '../shared.js';
import { LlmStep } from './LlmStep.js';

// -- Step 1c: Secondary LLM provider (#1768) --------------------------------

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

  useInput((_input, key) => {
    if (phase !== 'prompt') return;
    if (key.escape) onSkip();
  });

  if (phase === 'configure') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1c -- Secondary LLM Provider</Text>
        <LlmStep
          workspaceRoot={workspaceRoot}
          onNext={onNext}
          isSecondary
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 1c -- Secondary LLM Provider (optional)</Text>
      <Text dimColor>A secondary provider runs LLM Assessment legs in parallel with the primary for direct model comparison.</Text>
      {suggestion && (
        <Box marginTop={1}>
          <Text>  Suggestion from last LLM Assessment: <Text color="cyan">{suggestion}</Text></Text>
        </Box>
      )}
      <Box marginTop={1}>
        <SelectInput
          label="Add a secondary LLM provider?"
          options={[
            { label: 'Yes -- configure a secondary provider now', value: 'yes' },
            { label: 'No  -- skip (can be added later in .swao.yml)', value: 'no' },
          ]}
          onSelect={(v) => {
            if (v === 'yes') setPhase('configure');
            else onSkip();
          }}
          active
        />
      </Box>
      <GuidanceBox
        title="Secondary LLM provider"
        what="Configure a second provider to enable head-to-head model comparison in LLM Assessment (Design 092). The secondary provider runs the same passes as the primary; results appear side-by-side in the HTML and PDF reports."
        details={[
          { label: 'When useful',  value: 'Comparing Anthropic vs OpenAI, testing a new model version, or benchmarking a private deployment.' },
          { label: 'Skip is fine', value: 'You can add providers.llm.secondary manually in .swao.yml at any time.' },
          ...(suggestion ? [{ label: 'Suggestion', value: `${suggestion} ranked #2 in your last LLM Assessment run.` }] : []),
        ]}
        affordances={['Up/Down -- select  |  Enter -- confirm  |  Escape -- skip']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}
