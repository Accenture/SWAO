// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, test helper: every TUI screen as a render case (#4213)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2, gates G-05 (screen part) and G-08: one list of every
// TUI screen the App routes to, so both gates render the same set. Each case
// names the screen source file it covers; the gates fail when a screen file
// (`*Screen.tsx`, `*Menu.tsx`, `*Wizard.tsx`, tui-gate-rules.ts isScreenFile)
// has no case and no documented exemption (SCREEN_EXEMPT).
//
// The consuming test file mocks `@swao/core` (licence Enterprise, findWorkspace
// to the fixture workspace) and `child_process` (a fake child), so no screen
// starts a real process or reads the real profile (#4278). The premium screens
// (swao-premium) load through a dynamic import and are absent from the public
// tree; the cases report them as unavailable there.

import React from 'react';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { AppAssessmentScreen, AssessmentTypeScreen, LzAssessmentScreen, LzLiveAssessmentScreen } from '@swao/module-app-assessment';
import { HealthCheckScreen } from '@swao/module-health-check';
import { PublishScreen, ServeScreen } from '@swao/module-html-report';
import { ExportBiScreen } from '@swao/module-powerbi';
import { MainMenu } from '../../tui/screens/MainMenu.js';
import { ToolsMenu } from '../../tui/screens/ToolsMenu.js';
import { SetupWizard } from '../../tui/screens/SetupWizard.js';
import { CredentialScreen } from '../../tui/screens/CredentialScreen.js';
import { LicenseScreen } from '../../tui/screens/LicenseScreen.js';
import { LzCatalogueUpdateScreen } from '../../tui/screens/LzCatalogueUpdateScreen.js';
import { LzConnectionsScreen } from '../../tui/screens/LzConnectionsScreen.js';
import { IngestScreen } from '../../tui/screens/IngestScreen.js';
import { LensesScreen } from '../../tui/screens/LensesScreen.js';
import { RegimeSelectorScreen } from '../../tui/screens/RegimeSelectorScreen.js';
import { ReportScreen } from '../../tui/screens/ReportScreen.js';
import { ServiceInitScreen } from '../../tui/screens/ServiceInitScreen.js';
import { SupportBundleScreen } from '../../tui/screens/SupportBundleScreen.js';
import { UpgradePromptScreen } from '../../tui/screens/UpgradePromptScreen.js';
import { LlmGatewayUpdateScreen } from '../../tui/screens/LlmGatewayUpdateScreen.js';
import { LlmAssessmentScreen } from '../../tui/screens/LlmAssessmentScreen.js';
import { ChatScreen as ChatStub } from '../../tiers/premium-stubs/ChatScreen.js';
import { PREMIUM_DIR } from './tui-gate.js';

const NL = String.fromCharCode(10);
const noop = (): void => undefined;
const DOWN = '\u001B[B';
const ENTER = '\r';

/** One render case: the screen, the source file it covers, keys that reach a later phase. */
export interface ScreenCase {
  name: string;
  /** Source file of the screen, relative to the repository root, forward slashes. */
  file: string;
  /** The screen element; undefined when its package is absent (swao-premium in the public tree). */
  element: () => Promise<JSX.Element | undefined>;
  /** Key presses after the first frame; each frame after a key is checked as well. */
  keys?: readonly string[];
}

/** Screen files without a case, with the reason and the gate that covers them instead. */
export const SCREEN_EXEMPT: Readonly<Record<string, string>> = {
  'swao/packages/swao/src/tui/screens/HelpScreen.tsx': 'Help is the reference itself and has no guidance box (#2347); width at 100 and 80 in tui13-screens-width.test.tsx',
  'swao/packages/swao/src/tui/screens/ChatScreen.tsx': 'Enterprise Chat may not be imported by a synced file (#3348); guidance box and width at 100 and 80 in tui13-chat-width.test.tsx (W-01, W-02)',
};

/** A workspace with one assessed application and one registered live landing zone. */
export function fixtureWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-screen-cases-'));
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', ''].join(NL));
  const wsp = join(ws, 'apps', 'demo-app', 'wsp');
  mkdirSync(join(wsp, 'runs', '2026-11-10T08-53-21'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'), 'name: demo-app' + NL);
  writeFileSync(join(wsp, 'latest-application.txt'), 'runs/2026-11-10T08-53-21');
  writeFileSync(join(wsp, 'latest.txt'), 'runs/2026-11-10T08-53-21');
  return ws;
}

const scaffold = {
  imports: noop, ingestion: noop, source: noop, landingZoneStubs: noop, appYmlTemplate: () => 'name: x', lenses: [],
  lzCatalogueHint: { entries: [{ provider: 'azure', name: 'Azure', label: 'azure - Azure', regions: [{ id: 'germanywestcentral', display: 'germanywestcentral', country: 'DE', label: 'germanywestcentral - DE' }] }] },
};

const PREMIUM_MODULES = join(PREMIUM_DIR, 'packages', '@swao');
const premium = (module: string, file: string): boolean => existsSync(join(PREMIUM_MODULES, module, 'src', 'tui', file));

/** Every routed screen (App.tsx), with the fixture workspace `ws`. */
export function screenCases(ws: string): ScreenCase[] {
  const at = async (e: JSX.Element): Promise<JSX.Element> => e;
  const SW = 'swao/packages/swao/src/tui/screens/';
  const APP = 'swao/packages/@swao/module-app-assessment/src/tui/';
  const PREM = 'swao-premium/packages/@swao/';
  return [
    { name: 'Main menu', file: `${SW}MainMenu.tsx`, element: () => at(<MainMenu onSelect={noop} />) },
    { name: 'Setup Wizard', file: `${SW}SetupWizard.tsx`, element: () => at(<SetupWizard onBack={noop} />) },
    { name: 'Tools', file: `${SW}ToolsMenu.tsx`, element: () => at(<ToolsMenu onSelect={noop} onBack={noop} />) },
    { name: 'Assessment type', file: `${APP}AssessmentTypeScreen.tsx`, element: () => at(<AssessmentTypeScreen onSelect={noop} version="0.0.0" onBack={noop} />) },
    { name: 'Application Assessment', file: `${APP}assess/AppAssessmentScreen.tsx`, element: () => at(<AppAssessmentScreen onBack={noop} version="0.0.0" scaffold={scaffold} />), keys: ['\r'] },
    { name: 'Landing Zone Catalog Assessment', file: `${APP}assess/LzAssessmentScreen.tsx`, element: () => at(<LzAssessmentScreen onBack={noop} version="0.0.0" scaffold={scaffold} />), keys: ['\r'] },
    { name: 'Landing Zone Live Assessment', file: `${APP}assess/LzLiveAssessmentScreen.tsx`, element: () => at(<LzLiveAssessmentScreen onBack={noop} version="0.0.0" workspace={ws} run={async () => 0} />) },
    { name: 'LLM Assessment', file: `${SW}LlmAssessmentScreen.tsx`, element: () => at(<LlmAssessmentScreen workspacePath={ws} onBack={noop} />) },
    { name: 'Service Portfolio Assessment', file: `${SW}ServiceInitScreen.tsx`, element: () => at(<ServiceInitScreen onBack={noop} workspacePath={ws} runChild={async () => 0} />) },
    { name: 'Health Check', file: 'swao/packages/@swao/module-health-check/src/tui/HealthCheckScreen.tsx', element: () => at(<HealthCheckScreen onBack={noop} version="0.0.0" />) },
    { name: 'Generate Report', file: `${SW}ReportScreen.tsx`, element: () => at(<ReportScreen onBack={noop} onOpenLicense={noop} />), keys: [ENTER] },
    { name: 'Publish HTML', file: 'swao/packages/@swao/module-html-report/src/tui/PublishScreen.tsx', element: () => at(<PublishScreen onBack={noop} version="0.0.0" />) },
    { name: 'Serve publication', file: 'swao/packages/@swao/module-html-report/src/tui/ServeScreen.tsx', element: () => at(<ServeScreen onBack={noop} version="0.0.0" />) },
    { name: 'Export BI', file: 'swao/packages/@swao/module-powerbi/src/tui/ExportBiScreen.tsx', element: () => at(<ExportBiScreen onBack={noop} version="0.0.0" />), keys: [ENTER] },
    { name: 'Licence', file: `${SW}LicenseScreen.tsx`, element: () => at(<LicenseScreen onBack={noop} />), keys: [DOWN, ENTER] },
    { name: 'Credentials', file: `${SW}CredentialScreen.tsx`, element: () => at(<CredentialScreen onBack={noop} />), keys: [DOWN, ENTER] },
    { name: 'Lenses', file: `${SW}LensesScreen.tsx`, element: () => at(<LensesScreen onBack={noop} onRunAssessment={noop} />) },
    { name: 'Regime Selector', file: `${SW}RegimeSelectorScreen.tsx`, element: () => at(<RegimeSelectorScreen workspacePath={ws} onDone={noop} />) },
    { name: 'Update LZ Catalogue', file: `${SW}LzCatalogueUpdateScreen.tsx`, element: () => at(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />) },
    { name: 'Landing Zone Connections', file: `${SW}LzConnectionsScreen.tsx`, element: () => at(<LzConnectionsScreen onBack={noop} workspace={ws} run={async () => 0} store={new CredentialStore(join(ws, '.vault'))} />) },
    { name: 'Update LLM Gateway', file: `${SW}LlmGatewayUpdateScreen.tsx`, element: () => at(<LlmGatewayUpdateScreen onBack={noop} />) },
    { name: 'Ingest', file: `${SW}IngestScreen.tsx`, element: () => at(<IngestScreen onBack={noop} />) },
    { name: 'Support Bundle', file: `${SW}SupportBundleScreen.tsx`, element: () => at(<SupportBundleScreen onBack={noop} />) },
    { name: 'Upgrade prompt', file: `${SW}UpgradePromptScreen.tsx`, element: () => at(<UpgradePromptScreen feature="Publish HTML" requiredTier="consultant" description="HTML publications of assessment runs" onBack={noop} onOpenLicenseScreen={noop} />) },
    { name: 'Chat (Community and Consultant notice)', file: 'swao/packages/swao/src/tiers/premium-stubs/ChatScreen.tsx', element: () => at(<ChatStub onBack={noop} />) },
    {
      name: 'Portfolio Operations (Enterprise)', file: `${PREM}module-portfolio/src/tui/PortfolioScreen.tsx`,
      element: async () => {
        if (!premium('module-portfolio', 'PortfolioScreen.tsx')) return undefined;
        const { PortfolioScreen } = await import('@swao/module-portfolio');
        return <PortfolioScreen onBack={noop} onOpenLicense={noop} version="0.0.0" />;
      },
    },
    {
      name: 'Stakeholder Challenge (Enterprise)', file: `${PREM}module-challenge/src/tui/ChallengeScreen.tsx`,
      element: async () => {
        if (!premium('module-challenge', 'ChallengeScreen.tsx')) return undefined;
        const { ChallengeScreen } = await import('@swao/module-challenge');
        return <ChallengeScreen onBack={noop} onComplete={noop} onOpenLicense={noop} version="0.0.0" />;
      },
    },
    {
      name: 'Generate TF (Enterprise)', file: `${PREM}module-terraform/src/tui/GenerateTfScreen.tsx`,
      element: async () => {
        if (!premium('module-terraform', 'GenerateTfScreen.tsx')) return undefined;
        const { GenerateTfScreen } = await import('@swao/module-terraform');
        return <GenerateTfScreen onBack={noop} onOpenLicense={noop} version="0.0.0" />;
      },
    },
  ];
}
