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

// #4190 SET-01 (Design 125 section 5.1): the generic workspace setup. The
// step components are the ones of the linear wizard (wizard/steps/*); these
// adapters carry the side effects SetupWizard.tsx ran in its onNext handlers
// (YAML writes, connector copy, the wizard.* events), unchanged. Owner: the
// engine lane. The generic health check and the type selection are plan
// entries the engine adds (plan.ts).

import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { StatusRow } from '@swao/tui-kit';
import { SetupStepFrame } from '../setup-frame.js';
import { defaultWorkspaceChangeLine, logPortfolio, readSavedDefaultWorkspacePath, saveDefaultWorkspace, setWorkspaceRoot } from '@swao/core';
import { getConnector, copyConnectorToWorkspace } from '@swao/module-llm-providers';
import { InitStep } from '../../tui/screens/wizard/steps/InitStep.js';
import { LlmStep } from '../../tui/screens/wizard/steps/LlmStep.js';
import { LlmSecondaryStep } from '../../tui/screens/wizard/steps/LlmSecondaryStep.js';
import { CredentialsStep } from '../../tui/screens/wizard/steps/CredentialsStep.js';
import { ClaudeDesktopStep } from '../../tui/screens/wizard/steps/IntegrationsStep.js';
import { writeLlmToYaml, writeSecondaryLlmToYaml } from '../../tui/screens/wizard/yaml-helpers.js';
import type { LlmProvider } from '../../tui/screens/wizard/shared.js';
import type { SetupGenericModule, SetupStepProps } from '../types.js';
import { logSetupStepComplete } from '../step-events.js';

/** #1400: materialise a bundled gateway connector into wsp/inputs/llm-gateway/ (never overwrites). */
function copyBundledConnector(workDir: string, provider: LlmProvider): void {
  if (!provider.startsWith('gw:')) return;
  try {
    const loaded = getConnector(provider.slice(3), { workspaceRoot: workDir });
    if (loaded && loaded.origin === 'bundled') copyConnectorToWorkspace(workDir, loaded.path, loaded.file.connector.id);
  } catch { /* best-effort */ }
}

export function GenericInitStep({ onNext, updateSession }: SetupStepProps) {
  const logged = useRef(false);
  return (
    <InitStep
      onNext={({ workDir, engagementName, clientCode, partnershipLead }) => {
        // #4392: same as swao init (saveDefaultWorkspaceStep): the change of the
        // saved default is shown (Ready step) and logged, never written to the
        // console under Ink.
        const previous = readSavedDefaultWorkspacePath();
        saveDefaultWorkspace(workDir);
        const changed = defaultWorkspaceChangeLine(previous, workDir) !== null;
        updateSession({ workDir, engagementName, clientCode, partnershipLead, ...(changed ? { previousDefaultWorkspace: previous ?? '' } : {}) });
        if (changed) {
          try { logPortfolio('info', 'workspace.default.changed', 'Saved default workspace changed', { context: { previous: previous ?? null, current: workDir, origin: 'setup-wizard' } }); } catch { /* best-effort */ }
        }
        setWorkspaceRoot(workDir);
        // #2389 / #2714 / #4121: wizard.init.complete and wizard.engagement.confirmed.
        if (!logged.current) {
          logged.current = true;
          try { logPortfolio('info', 'wizard.init.complete', 'Workspace initialised', { context: { wsp_version: '0.9', engagement_name: engagementName } }); } catch { /* best-effort */ }
          try { logPortfolio('info', 'wizard.engagement.confirmed', 'Engagement details confirmed', { context: { work_dir: workDir, has_engagement_name: !!engagementName, has_client_code: !!clientCode } }); } catch { /* best-effort */ }
        }
        onNext({ status: 'done' });
      }}
    />
  );
}

/** Primary LLM, then the optional secondary LLM (#2355), as one step of the bar. */
export function GenericLlmStep({ ctx, onNext, updateSession }: SetupStepProps) {
  const [phase, setPhase] = useState<'primary' | 'secondary'>('primary');
  const logged = useRef(false);
  const workDir = ctx.workspaceRoot;
  if (phase === 'primary') {
    return (
      <LlmStep
        workspaceRoot={workDir}
        onNext={(provider, model, endpoint, openLlmBase) => {
          updateSession({ llmProvider: provider, llmModel: model, ollamaEndpoint: endpoint, openLlmBaseUrl: openLlmBase });
          writeLlmToYaml(workDir, provider, model, endpoint, openLlmBase);
          copyBundledConnector(workDir, provider);
          if (!logged.current) {
            logged.current = true;
            try { setWorkspaceRoot(workDir); } catch { /* best-effort */ }
            logSetupStepComplete('llm', 'LLM provider configured', { provider, model: model || null });
          }
          setPhase('secondary');
        }}
      />
    );
  }
  return (
    <LlmSecondaryStep
      workspaceRoot={workDir}
      primaryProvider={ctx.session.llmProvider}
      onSkip={() => onNext({ status: 'done' })}
      onNext={(provider, model, endpoint, openLlmBase) => {
        writeSecondaryLlmToYaml(workDir, provider, model, endpoint, openLlmBase);
        copyBundledConnector(workDir, provider);
        logSetupStepComplete('llm-secondary', 'Secondary LLM provider configured', { provider, model: model || null });
        updateSession({ llmSecondaryProvider: provider, llmSecondaryModel: model });
        onNext({ status: 'done' });
      }}
    />
  );
}

/** Credentials of the primary LLM, then of the secondary when one is configured (#2355). */
export function GenericCredentialsStep({ ctx, onNext, stepNumber }: SetupStepProps) {
  const [phase, setPhase] = useState<'primary' | 'secondary'>('primary');
  const logged = useRef(false);
  const s = ctx.session;
  if (phase === 'primary') {
    return (
      <CredentialsStep
        key="primary"
        provider={s.llmProvider}
        workspaceRoot={ctx.workspaceRoot}
        model={s.llmModel}
        stepNumber={stepNumber}
        onNext={() => {
          if (!logged.current) {
            logged.current = true;
            try { setWorkspaceRoot(ctx.workspaceRoot); } catch { /* best-effort */ }
            logSetupStepComplete('credentials', 'Credentials step completed', { provider: s.llmProvider });
          }
          const hasSecondary = !!s.llmSecondaryProvider && s.llmSecondaryProvider !== 'skip';
          if (hasSecondary) setPhase('secondary');
          else onNext({ status: 'done' });
        }}
      />
    );
  }
  return (
    <CredentialsStep
      key="secondary"
      provider={s.llmSecondaryProvider!}
      model={s.llmSecondaryModel}
      workspaceRoot={ctx.workspaceRoot}
      stepNumber={stepNumber}
      onNext={() => {
        logSetupStepComplete('credentials-secondary', 'Secondary credentials step completed', { provider: s.llmSecondaryProvider });
        onNext({ status: 'done' });
      }}
    />
  );
}

/** #4254: what the Enterprise tier adds, the content of the upgrade notice. */
export const ENTERPRISE_FEATURES = [
  'All Consultant features',
  'Portfolio Operations (multi-app aggregation)',
  'Stakeholder Challenge agents',
  'HTML Editor for publications',
  'MCP server integration (Claude Desktop, Claude Code)',
  'SWAO Chat',
] as const;

/**
 * MCP upgrade notice (Community / Consultant), moved from SetupWizard.tsx (#2725).
 * #4254 (Design 126 sections 4.5, 8 and 9): on SetupStepFrame (confirm hints,
 * one guidance box); the upgrade request command lives in the guidance CLI
 * line, not on the screen (G-11). Enter continues; Esc belongs to the wizard.
 */
export function McpUpgradeNotice({ onNext }: { onNext: () => void }) {
  useInput((_input, key) => {
    if (key.return) onNext(); // #4341: Esc belongs to the wizard (abort)
  });
  return (
    <SetupStepFrame
      title="MCP Client"
      subtitle="Register SWAO with an MCP client (Enterprise)."
      kind="confirm"
      guidance={{
        title: 'MCP Client',
        what: 'The MCP server integration lets Claude Desktop and Claude Code use SWAO tools. It needs an Enterprise licence; this step continues without it and the rest of the setup is unaffected.',
        sections: [{ label: 'Upgrade', text: 'Request an Enterprise licence from the SWAO team; the request command is below.' }],
        cli: 'swao license request --tier enterprise',
      }}
    >
      <Box flexDirection="column">
        <StatusRow level="info" label="Licence" summary="MCP server integration needs an Enterprise licence." labelWidth={10} />
        <Box marginTop={1} flexDirection="column">
          <Text bold>The Enterprise tier adds:</Text>
          {ENTERPRISE_FEATURES.map((f) => <Text key={f}>{`  - ${f}`}</Text>)}
        </Box>
      </Box>
    </SetupStepFrame>
  );
}

/** #2725: the MCP client step on Enterprise, the upgrade notice below it. */
export function GenericMcpStep({ ctx, onNext }: SetupStepProps) {
  const logged = useRef(false);
  if (ctx.tier !== 'enterprise') return <McpUpgradeNotice onNext={() => onNext({ status: 'skipped' })} />;
  return (
    <ClaudeDesktopStep
      workDir={ctx.workspaceRoot}
      onNext={() => {
        if (!logged.current) {
          logged.current = true;
          try { setWorkspaceRoot(ctx.workspaceRoot); } catch { /* best-effort */ }
          logSetupStepComplete('claude-desktop', 'MCP client step completed');
        }
        onNext({ status: 'done' });
      }}
    />
  );
}

export const genericSetup: SetupGenericModule = {
  steps: [
    { id: 'generic.init', label: 'Init', assessmentType: 'generic', order: 10, guidance: 'Engagement data and the workspace scaffold.', component: GenericInitStep },
    { id: 'generic.llm', label: 'LLM', assessmentType: 'generic', order: 20, guidance: 'Primary and optional secondary LLM provider and model.', component: GenericLlmStep },
    { id: 'generic.credentials', label: 'Credentials', assessmentType: 'generic', order: 30, guidance: 'LLM credentials into the vault, with a connectivity check.', component: GenericCredentialsStep },
    { id: 'generic.mcp', label: 'MCP Client', assessmentType: 'generic', order: 40, guidance: 'Register SWAO with an MCP client (Enterprise).', component: GenericMcpStep },
  ],
};
