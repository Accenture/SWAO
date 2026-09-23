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

import { join } from 'path';
import { homedir } from 'os';
import { Box, Text, useInput } from 'ink';
import { GuidanceBox } from '@swao/tui-kit';
import { type SetupState, _wizardGuidanceOpen, setWizardGuidanceOpen } from '../shared.js';

const CRED_PATH = join(homedir(), '.config', 'swao', '.swao-credentials.json');

// -- Step 7: Ready --------------------------------------------------------

export function ReadyStep({ state, onBack }: { state: SetupState; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.return) onBack(); // #1412: one-press advance when guidance is open
    if (key.escape && !_wizardGuidanceOpen) onBack();
  });

  // #1400 polish: gateway connectors display as "Gateway: <id>" -- the
  // legacy fallthrough labelled every non-openai provider "Anthropic",
  // which mislabelled e.g. an OpenRouter+Gemini selection.
  const llmDisplay = state.llmProvider === 'skip'
    ? 'not configured (set manually in .swao.yml)'
    : state.llmProvider.startsWith('gw:')
      ? `Gateway: ${state.llmProvider.slice(3)}  (${state.llmModel})`
      : state.llmProvider === 'ollama'
        ? `Ollama  ${state.llmModel}  (${state.ollamaEndpoint})`
        : state.llmProvider === 'open-llm-provider'
          ? `Open LLM Provider  ${state.llmModel}  (${state.openLlmBaseUrl})`
          : `${state.llmProvider === 'openai' ? 'OpenAI' : 'Anthropic'}  ${state.llmModel}`;

  return (
    <Box flexDirection="column">
      <Text bold color="green">Workspace ready!</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>  Workspace:    <Text color="cyanBright">{state.workDir}</Text></Text>
        {state.engagementName && (
          <Text>  Engagement:   <Text color="cyanBright">{state.engagementName} ({state.clientCode})</Text></Text>
        )}
        <Text>  LLM:          <Text color="cyanBright">{llmDisplay}</Text></Text>
        {state.llmSecondaryProvider && state.llmSecondaryProvider !== 'skip' && (
          <Text>  LLM 2nd:      <Text color="cyanBright">{
            state.llmSecondaryProvider.startsWith('gw:')
              ? `Gateway: ${state.llmSecondaryProvider.slice(3)}  (${state.llmSecondaryModel})`
              : state.llmSecondaryProvider === 'ollama'
                ? `Ollama  ${state.llmSecondaryModel}`
                : `${state.llmSecondaryProvider === 'openai' ? 'OpenAI' : 'Anthropic'}  ${state.llmSecondaryModel}`
          }</Text></Text>
        )}
        <Text>  Credentials:  <Text color="cyanBright">{CRED_PATH}</Text></Text>
        {state.visionMaxScreens !== undefined && (
          <Text>  Vision:       <Text color="cyanBright">{state.visionMaxScreens} screen{state.visionMaxScreens === 1 ? '' : 's'} per assessment (vision_max_screens)</Text></Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Next steps:</Text>
        <Text>  Choose "Run Assessment" from the main menu</Text>
        <Text>  Enter an app ID -- SWAO guides you through source and config setup</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Optional: drop documents into the app ingestion folder before running.</Text>
        <Text dimColor>SWAO will classify, extract, and index them during the assessment.</Text>
        <Text dimColor>Use Tools {'>'} Ingest Files to pre-process them manually.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to the main menu...</Text>
      </Box>
      <GuidanceBox
        title="Workspace ready"
        what="Go to Run Assessment from the main menu to begin your first analysis."
        affordances={['Enter -- return to main menu']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}
