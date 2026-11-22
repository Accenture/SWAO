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
import { Box, useInput } from 'ink';
import { DetailRow, KEY_HINTS, StatusRow, StepTitle } from '@swao/tui-kit';
import { shortenProfilePath } from '@swao/core';
import { type SetupState } from '../shared.js';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';
import type { WizardHealthSummary } from './HealthCheckStep.js';
import { healthIncompleteText } from './health-check-run.js';

/** #4120: one-line result of the wizard's final health check. */
export function formatReadyHealthLine(health: WizardHealthSummary | undefined): string {
  // #4410: a run the watchdog stopped says so instead of the counts.
  const incomplete = healthIncompleteText(health);
  if (incomplete) return `${incomplete}; run Health Check from the main menu`;
  if (!health || health.probeCount === 0) return 'no result (run Health Check from the main menu)';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(health.probeCount, 'probe')}, ${plural(health.failCount, 'failure')}, ${plural(health.warnCount, 'warning')}`;
}

const CRED_PATH = join(homedir(), '.config', 'swao', '.swao-credentials.json');

/**
 * #4344 (Design 126 section 8 rule 4): the credential store as the Ready step
 * shows it, profile-relative (`~\.config\swao\...`) so the screen never carries
 * the user profile path with the Windows user name.
 */
export function readyCredentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return shortenProfilePath(CRED_PATH, env);
}

// -- Step 7: Ready --------------------------------------------------------

export function ReadyStep({ state, health, onBack }: { state: SetupState; health?: WizardHealthSummary; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.return) onBack(); // #1412: one-press advance when guidance is open
    // #4341: Esc belongs to the wizard (back to the main menu, nothing to lose here).
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

  const secondary = state.llmSecondaryProvider && state.llmSecondaryProvider !== 'skip'
    ? state.llmSecondaryProvider.startsWith('gw:')
      ? `Gateway: ${state.llmSecondaryProvider.slice(3)}  (${state.llmSecondaryModel})`
      : state.llmSecondaryProvider === 'ollama'
        ? `Ollama  ${state.llmSecondaryModel}`
        : `${state.llmSecondaryProvider === 'openai' ? 'OpenAI' : 'Anthropic'}  ${state.llmSecondaryModel}`
    : undefined;

  // #4254 (Design 126 M-06): a DetailRow block, the health result as a status row.
  return (
    <SetupStepFrame
      title="Ready"
      subtitle="The workspace is set up."
      keys={KEY_HINTS.lastStep.filter((h) => h.key !== '↑↓')}
      guidance={{
        title: 'Workspace ready',
        what: 'The workspace setup is complete. Choose Run Assessment in the main menu and enter an app id; SWAO guides you through the source and the configuration of the app.',
        sections: [
          { label: 'Documents', text: 'Drop documents into the ingestion folder of the app before a run; SWAO classifies, extracts and indexes them. Tools, Ingest Files pre-processes them.' },
          { label: 'Next', text: 'Enter finishes the setup and returns to the main menu.' },
        ],
      }}
    >
      <Box flexDirection="column">
        <DetailRow label="Workspace" value={state.workDir} path />
        {/* #4392: parity with swao init, which prints the same change. */}
        {state.previousDefaultWorkspace !== undefined && (
          <DetailRow label="Default" value={`now the saved default workspace (was ${state.previousDefaultWorkspace === '' ? 'none' : shortenProfilePath(state.previousDefaultWorkspace)})`} />
        )}
        {state.engagementName && <DetailRow label="Engagement" value={`${state.engagementName} (${state.clientCode})`} />}
        <DetailRow label="LLM" value={llmDisplay} />
        {secondary && <DetailRow label="LLM 2nd" value={secondary} />}
        <DetailRow label="Credentials" value={readyCredentialPath()} path />
        {state.visionMaxScreens !== undefined && (
          <DetailRow label="Vision" value={`${state.visionMaxScreens} screen${state.visionMaxScreens === 1 ? '' : 's'} per assessment`} />
        )}
        {state.testCodeMode !== undefined && <DetailRow label="Test code" value={state.testCodeMode} />}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <StatusRow level={!health || health.probeCount === 0 ? 'waiting' : health.failCount > 0 ? 'fail' : health.warnCount > 0 ? 'warn' : 'ok'} label="Health" summary={formatReadyHealthLine(health)} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <StepTitle title="Next steps" level={2} />
        <DetailRow label="Run" value="Choose Run Assessment in the main menu and enter an app id." />
      </Box>
    </SetupStepFrame>
  );
}
