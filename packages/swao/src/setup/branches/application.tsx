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

// #4190 SET-01 / #4192 SET-03 (Design 125 section 5.2): the Application
// Assessment branch. Owner of this file after SET-01: the Application lane.
// Migrated from the linear wizard (behaviour unchanged): Playwright (order 30)
// and Test code (order 40). SET-03: App (10, setup/steps/ApplicationAppStep),
// Source access (20, ApplicationSourceStep, probe vcs_auth), Tools (50,
// ApplicationToolsStep, probes prerequisites and iac_toolchain). Each new
// step has a non-interactive check (Design 125 section 8). Health check and
// Ready are added by the engine.

import { useRef } from 'react';
import { findInstalledChromium, logPortfolio, SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import { PlaywrightStep } from '../../tui/screens/wizard/steps/IntegrationsStep.js';
import { TestCodeStep } from '../../tui/screens/wizard/steps/TestCodeStep.js';
import { readTestCodeModeFromYaml, writeTestCodeModeToYaml, writeVisionMaxScreensToYaml } from '../../tui/screens/wizard/yaml-helpers.js';
import type { SetupBranchModule, SetupStepProps } from '../types.js';
import { ApplicationAppStep } from '../steps/ApplicationAppStep.js';
import { ApplicationSourceStep } from '../steps/ApplicationSourceStep.js';
import { ApplicationToolsStep } from '../steps/ApplicationToolsStep.js';
import { checkApplicationApps } from '../application-app.js';
import { checkApplicationSource } from '../application-source.js';
import { checkApplicationTools } from '../application-tools.js';
import { readApplicationDefaults } from '../defaults.js';
import type { SetupCheckItem } from '../types.js';

/** #4192: non-interactive check of the Playwright step (the browser the dynamic passes use). */
export function checkApplicationPlaywright(_workspaceRoot: string, find: () => string | null = findInstalledChromium): SetupCheckItem[] {
  let path: string | null = null;
  try { path = find(); } catch { path = null; }
  return [path
    ? { label: 'Browser', state: 'ok', detail: 'Chromium found for the browser crawl (Pass 10)', short: 'Chromium found' }
    : { label: 'Browser', state: 'warn', detail: 'No Chromium found; the browser crawl (Pass 10) needs it', short: 'no Chromium found' }];
}

/** #4192: non-interactive check of the Test Code step (assessment.test_code.mode, Design 125 section 5.7). */
export function checkApplicationTestCode(workspaceRoot: string): SetupCheckItem[] {
  const mode = readApplicationDefaults(workspaceRoot).testCodeMode;
  return [mode
    ? { label: 'Test code', state: 'ok', detail: `mode ${mode}` }
    : { label: 'Test code', state: 'info', detail: 'not set; test code is analysed like production code', short: 'not set' }];
}

export function ApplicationPlaywrightStep({ ctx, onNext, updateSession }: SetupStepProps) {
  const logged = useRef(false);
  return (
    <PlaywrightStep onNext={(visionMaxScreens?: number) => {
      const chromiumPath = findInstalledChromium();
      // #2815: persist vision_max_screens to .swao.yml when Playwright is installed.
      if (visionMaxScreens !== undefined) {
        updateSession({ visionMaxScreens });
        writeVisionMaxScreensToYaml(ctx.workspaceRoot, visionMaxScreens);
      }
      if (!logged.current) {
        logged.current = true;
        try { logPortfolio('info', 'playwright.check.complete', 'Playwright step completed', { context: { chromium_found: chromiumPath !== null, path: chromiumPath ?? undefined, vision_max_screens: visionMaxScreens ?? null } }); } catch { /* best-effort */ }
        try { logPortfolio('info', 'wizard.integrations.playwright.complete', 'Playwright integration step complete', { context: { chromium_found: chromiumPath !== null, vision_max_screens: visionMaxScreens ?? null } }); } catch { /* best-effort */ }
      }
      onNext({ status: visionMaxScreens !== undefined ? 'done' : 'kept' });
    }} />
  );
}

export function ApplicationTestCodeStep({ ctx, onNext, updateSession }: SetupStepProps) {
  const logged = useRef(false);
  // #4341: keeping the current setting is the last list entry of the step;
  // Esc belongs to the wizard (AbortDialog), so the step captures nothing.
  return (
    <TestCodeStep initial={readTestCodeModeFromYaml(ctx.workspaceRoot)} onNext={(testCodeMode) => {
      // #3403: persist assessment.test_code.mode; the keep entry keeps the current value.
      if (testCodeMode !== undefined) {
        updateSession({ testCodeMode });
        writeTestCodeModeToYaml(ctx.workspaceRoot, testCodeMode);
      }
      if (!logged.current) {
        logged.current = true;
        try { logPortfolio('info', 'wizard.test_code.complete', 'Test-code step complete', { context: { test_code_mode: testCodeMode ?? null } }); } catch { /* best-effort */ }
      }
      onNext(testCodeMode !== undefined ? { status: 'done', summary: `Test code: ${testCodeMode}` } : { status: 'kept' });
    }} />
  );
}

export const applicationBranch: SetupBranchModule = {
  branch: {
    type: 'application',
    label: SETUP_ASSESSMENT_TYPE_LABELS.application,
    description: 'Apps, source access, browser, test code and scanners',
    minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER.application,
  },
  steps: [
    { id: 'application.app', label: 'App', assessmentType: 'application', order: 10, guidance: 'The application to assess: id and source.', component: ApplicationAppStep, check: checkApplicationApps },
    { id: 'application.source', label: 'Source Access', assessmentType: 'application', order: 20, guidance: 'Repository access for each app, with the token in the vault.', component: ApplicationSourceStep, check: (ws) => checkApplicationSource(ws) },
    { id: 'application.playwright', label: 'Playwright', assessmentType: 'application', order: 30, guidance: 'Browser for the dynamic passes.', component: ApplicationPlaywrightStep, check: (ws) => checkApplicationPlaywright(ws) },
    { id: 'application.test-code', label: 'Test Code', assessmentType: 'application', order: 40, guidance: 'How test code is treated in the analysis.', component: ApplicationTestCodeStep, check: checkApplicationTestCode },
    { id: 'application.tools', label: 'Tools', assessmentType: 'application', order: 50, guidance: 'Scanners and IaC tools on this machine, and what each one adds.', component: ApplicationToolsStep, check: (ws) => checkApplicationTools(ws) },
  ],
};
