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

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { logPortfolio, saveDefaultWorkspace, setWorkspaceRoot, findInstalledChromium } from '@swao/core';
import { LicenseGuard } from '../../license/license-guard.js';
import { getConnector, copyConnectorToWorkspace } from '@swao/module-llm-providers';
import { Header } from '../components/Header.js';
import { StepBar } from '@swao/tui-kit';
import { type SetupState, _wizardGuidanceOpen, setWizardGuidanceOpen } from './wizard/shared.js';
import { writeLlmToYaml, writeSecondaryLlmToYaml } from './wizard/yaml-helpers.js';
import { InitStep } from './wizard/steps/InitStep.js';
import { LlmStep } from './wizard/steps/LlmStep.js';
import { LlmSecondaryStep } from './wizard/steps/LlmSecondaryStep.js';
import { CredentialsStep } from './wizard/steps/CredentialsStep.js';
import { HealthCheckStep } from './wizard/steps/HealthCheckStep.js';
import { ClaudeDesktopStep, PlaywrightStep } from './wizard/steps/IntegrationsStep.js';
import { ReadyStep } from './wizard/steps/ReadyStep.js';

type Step = 'init' | 'llm' | 'llm-secondary' | 'credentials' | 'credentials-secondary' | 'health-check' | 'claude-desktop' | 'playwright' | 'ready';
// 'llm-secondary' and 'credentials-secondary' are sub-steps -- not in STEP_LABELS so StepBar still shows 7 steps.
const STEP_LABELS: Exclude<Step, 'llm-secondary' | 'credentials-secondary'>[] = ['init', 'llm', 'credentials', 'health-check', 'claude-desktop', 'playwright', 'ready'];
const STEP_NAMES = ['Init', 'LLM', 'Credentials', 'Health Check', 'MCP Client', 'Playwright', 'Ready'];

interface SetupWizardProps {
  onBack: () => void;
}

// -- MCP upgrade notice (shown on Community/Consultant for the MCP step) --

function McpUpgradeNotice({ onNext }: { onNext: () => void }) {
  useInput((_input, key) => {
    if (key.return || key.escape) onNext();
  });
  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 4 -- MCP Client Setup</Text>
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="single"
        borderColor="yellow"
        paddingX={1}
      >
        <Text bold color="yellow">MCP Server integration requires an Enterprise licence.</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Enterprise tier includes:</Text>
          <Text>  - All Consultant features</Text>
          <Text>  - Portfolio Operations (multi-app aggregation)</Text>
          <Text>  - Stakeholder Challenge agents</Text>
          <Text>  - SWAO Live Portal (Mode B server)</Text>
          <Text>  - MCP server integration (Claude Desktop / Claude Code)</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>To request an upgrade, run: <Text color="cyanBright">swao license request --tier enterprise</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press <Text bold>Enter</Text> or <Text bold>Esc</Text> to continue.</Text>
        </Box>
      </Box>
    </Box>
  );
}

// -- Wizard root ----------------------------------------------------------

export function SetupWizard({ onBack }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('init');
  const [state, setState] = useState<SetupState>({
    workDir: '.',
    engagementName: '',
    clientCode: '',
    partnershipLead: '',
    llmProvider: 'anthropic',
    llmModel: '',
    ollamaEndpoint: '',
    openLlmBaseUrl: '',
  });
  // Guard: prevent double-logging when Ink re-renders cause onNext to fire twice (#1067).
  const loggedSteps = useRef(new Set<string>());

  // #2725: MCP server is Enterprise-only (feature-licence-tier-matrix F-105).
  // Check the effective tier once at mount to decide whether to show the MCP
  // setup step or an upgrade notice.
  const isEnterpriseTier = useMemo(() => {
    try { return LicenseGuard.load().state.tier === 'enterprise'; } catch { return false; }
  }, []);

  // Top-level Escape handler so every step / sub-phase reliably returns
  // to the main menu (the footer promises "Escape at any time" but the
  // text-input phases didn't honour it before). Ink delivers input to all
  // active useInput hooks; the inner TextInput etc. don't consume Escape,
  // so this fires from any phase. (#0223 follow-up)
  // #0760: guard -- do NOT navigate when any GuidanceBox is open (the panel's
  // own useInput closes it first; this handler would wrongly navigate away).
  useInput((_input, key) => {
    if (key.escape && !_wizardGuidanceOpen) onBack();
  });

  // #0804: reset guidance open flag on every step change.
  // GuidanceBox.tsx now has an unmount cleanup, but this is a belt-and-braces
  // guard: if a step transitions while a panel is expanded, any residual
  // _wizardGuidanceOpen=true is cleared before the new step's useInput handlers fire.
  useEffect(() => { setWizardGuidanceOpen(false); }, [step]);

  // #2385: emit wizard.abort when the wizard unmounts before completing ReadyStep.
  // Use a ref to read the latest step value from the cleanup without stale closure.
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => {
    return () => {
      if (stepRef.current !== 'ready') {
        try { logPortfolio('warn', 'wizard.abort', 'Setup Wizard exited before completion', { context: { last_step: stepRef.current } }); } catch { /* best-effort */ }
      }
    };
  }, []);

  // #0397 / #0400 / #0406 / #0407 REVERTED AGAIN -- see AssessScreen for
  // the same Ink-diff-renderer collision. Bleed-tolerance is the lesser
  // evil until sprint-041 picks a proper Ink-aware solution.

  const stepIdx = STEP_LABELS.indexOf((step === 'llm-secondary' ? 'llm' : step === 'credentials-secondary' ? 'credentials' : step) as Exclude<Step, 'llm-secondary' | 'credentials-secondary'>);

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Workspace Setup" stepInfo={`Step ${stepIdx + 1} of ${STEP_LABELS.length}`} />
      <StepBar steps={STEP_NAMES} currentIndex={stepIdx} />

      {step === 'init' && (
        <InitStep
          onNext={({ workDir, engagementName, clientCode, partnershipLead }) => {
            setState(s => ({ ...s, workDir, engagementName, clientCode, partnershipLead }));
            saveDefaultWorkspace(workDir);
            setWorkspaceRoot(workDir);
            // #2389: align event code with Design 098 wizard.init.* prefix taxonomy.
if (!loggedSteps.current.has('init')) { loggedSteps.current.add('init'); try { logPortfolio('info', 'wizard.init.complete', 'Workspace initialised', { context: { wsp_version: '0.9', engagement_name: engagementName } }); } catch { /* best-effort */ } }
            setStep('llm');
          }}
        />
      )}

      {step === 'llm' && (
        <LlmStep
          workspaceRoot={state.workDir}
          onNext={(provider, model, endpoint, openLlmBase) => {
            setState(s => ({
              ...s,
              llmProvider: provider,
              llmModel: model,
              ollamaEndpoint: endpoint,
              openLlmBaseUrl: openLlmBase,
            }));
            writeLlmToYaml(state.workDir, provider, model, endpoint, openLlmBase);
            // #1400 operator decision 2026-08-06: materialise the selected
            // bundled connector into wsp/inputs/llm-gateway/ (raw copy,
            // comments preserved, never overwrites) so the operator can see
            // and edit the connectivity file that will serve the runs.
            if (provider.startsWith('gw:')) {
              try {
                const loaded = getConnector(provider.slice(3), { workspaceRoot: state.workDir });
                if (loaded && loaded.origin === 'bundled') {
                  copyConnectorToWorkspace(state.workDir, loaded.path, loaded.file.connector.id);
                }
              } catch { /* best-effort */ }
            }
            if (!loggedSteps.current.has('llm')) {
              loggedSteps.current.add('llm');
              try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
              try { logPortfolio('info', 'wizard.step.complete', 'LLM provider configured', { context: { step: 'llm', provider, model: model || null } }); } catch { /* best-effort */ }
            }
            setStep('llm-secondary');
          }}
        />
      )}

      {step === 'llm-secondary' && (
        <LlmSecondaryStep
          workspaceRoot={state.workDir}
          primaryProvider={state.llmProvider}
          onSkip={() => setStep('credentials')}
          onNext={(provider, model, endpoint, openLlmBase) => {
            writeSecondaryLlmToYaml(state.workDir, provider, model, endpoint, openLlmBase);
            if (provider.startsWith('gw:')) {
              try {
                const loaded = getConnector(provider.slice(3), { workspaceRoot: state.workDir });
                if (loaded && loaded.origin === 'bundled') {
                  copyConnectorToWorkspace(state.workDir, loaded.path, loaded.file.connector.id);
                }
              } catch { /* best-effort */ }
            }
            try { logPortfolio('info', 'wizard.step.complete', 'Secondary LLM provider configured', { context: { step: 'llm-secondary', provider, model: model || null } }); } catch { /* best-effort */ }
            // #2355: store secondary provider so credentials step can prompt for its key.
            // #2365: also store model so ready screen can display it.
            setState(prev => ({ ...prev, llmSecondaryProvider: provider, llmSecondaryModel: model }));
            setStep('credentials');
          }}
        />
      )}

      {step === 'credentials' && (
        <CredentialsStep
          provider={state.llmProvider}
          workspaceRoot={state.workDir}
          stepNumber={stepIdx + 1}
          onNext={() => {
            if (!loggedSteps.current.has('credentials')) {
              loggedSteps.current.add('credentials');
              try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
              try { logPortfolio('info', 'wizard.step.complete', 'Credentials step completed', { context: { step: 'credentials', provider: state.llmProvider } }); } catch { /* best-effort */ }
            }
            // #2355: if secondary LLM is configured, show its credential step (auto-skips for Ollama/env-var).
            const hasSecondary = !!state.llmSecondaryProvider && state.llmSecondaryProvider !== 'skip';
            setStep(hasSecondary ? 'credentials-secondary' : 'health-check');
          }}
        />
      )}

      {/* #2355: secondary credential step */}
      {step === 'credentials-secondary' && state.llmSecondaryProvider && (
        <CredentialsStep
          provider={state.llmSecondaryProvider}
          workspaceRoot={state.workDir}
          stepNumber={stepIdx + 1}
          onNext={() => {
            try { logPortfolio('info', 'wizard.step.complete', 'Secondary credentials step completed', { context: { step: 'credentials-secondary', provider: state.llmSecondaryProvider } }); } catch { /* best-effort */ }
            setStep('health-check');
          }}
        />
      )}

      {step === 'health-check' && (
        <HealthCheckStep onNext={() => setStep('claude-desktop')} />
      )}

      {step === 'claude-desktop' && isEnterpriseTier && (
        <ClaudeDesktopStep workDir={state.workDir} onNext={() => {
          if (!loggedSteps.current.has('mcp')) {
            loggedSteps.current.add('mcp');
            try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
            try { logPortfolio('info', 'wizard.step.complete', 'MCP client step completed', { context: { step: 'claude-desktop' } }); } catch { /* best-effort */ }
          }
          setStep('playwright');
        }} />
      )}

      {step === 'claude-desktop' && !isEnterpriseTier && (
        <McpUpgradeNotice onNext={() => setStep('playwright')} />
      )}

      {step === 'playwright' && (
        <PlaywrightStep onNext={() => {
          const chromiumPath = findInstalledChromium();
          if (!loggedSteps.current.has('playwright')) { loggedSteps.current.add('playwright'); try { logPortfolio('info', 'playwright.check.complete', 'Playwright step completed', { context: { chromium_found: chromiumPath !== null, path: chromiumPath ?? undefined } }); } catch { /* best-effort */ } }
          if (!loggedSteps.current.has('ready')) {
            loggedSteps.current.add('ready');
            // #1766: ensure workspace root is set before the summary event, then emit.
            try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
            try {
              logPortfolio('info', 'wsp.setup.complete', 'Workspace setup completed', {
                context: {
                  steps_completed: STEP_LABELS.length,
                  workspace: state.workDir,
                  provider: state.llmProvider,
                  model: state.llmModel || null,
                },
              });
            } catch { /* best-effort */ }
          }
          setStep('ready');
        }} />
      )}

      {step === 'ready' && (
        <ReadyStep state={state} onBack={onBack} />
      )}

      <Box marginTop={1}>
        <Text dimColor>Escape at any time to return to the main menu</Text>
      </Box>
    </Box>
  );
}
