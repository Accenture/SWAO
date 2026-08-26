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

import { useState, useEffect } from 'react';
import { Box, useStdout } from 'ink';
import { spawn } from 'child_process';
import { join } from 'path';
// Assessment TUI screens relocated to @swao/module-app-assessment (#0553); the
// host injects the SWAO version + the `swao init` scaffolding functions
// (branding + workspace-setup are host-only) into the module screens.
import { AssessmentTypeScreen, AssessScreen, type LzCatalogueHint } from '@swao/module-app-assessment';
import { resolveLzCataloguesDir, resolveBundledLzCataloguesDir, loadLzCatalogueIndex, resolveProviderCatalogue, discoverGateCapableFrameworks } from '@swao/module-landing-zone';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { resolveCatalogsDir } from '@swao/core';
// DoctorScreen relocated to @swao/module-doctor (#0573); the host injects the
// SWAO version (branding is host-only), mirroring the AssessScreen wiring.
import { HealthCheckScreen } from '@swao/module-health-check';
import { SWAO_VERSION } from '../branding.js';
import { scaffoldImports, scaffoldIngestion, scaffoldSource, scaffoldLandingZoneStubs, appSwaoYmlTemplate } from '../commands/init.js';
import { listLenses, readWorkspaceLenses, writeWorkspaceLenses } from '../commands/lenses.js';
import { MainMenu, type MenuTarget } from './screens/MainMenu.js';
import { ToolsMenu, type ToolsTarget } from './screens/ToolsMenu.js';
import { SetupWizard }      from './screens/SetupWizard.js';
import { ReportScreen }     from './screens/ReportScreen.js';
// ExportBiScreen relocated to @swao/module-powerbi (#0577); the host injects the
// SWAO version (branding is host-only), mirroring the DoctorScreen wiring.
import { ExportBiScreen }   from '@swao/module-powerbi';
// PortfolioScreen relocated to @swao/module-portfolio (#0579); the host injects
// the SWAO version (branding is host-only), mirroring the DoctorScreen wiring.
import { PortfolioScreen }  from '@swao/module-portfolio';
// GenerateTfScreen relocated to @swao/module-terraform (#0578); the host injects
// the SWAO version (branding is host-only), mirroring the DoctorScreen wiring.
import { GenerateTfScreen } from '@swao/module-terraform';
import { LicenseScreen }    from './screens/LicenseScreen.js';
import { CredentialScreen } from './screens/CredentialScreen.js';
import { HelpScreen }       from './screens/HelpScreen.js';
// ChallengeScreen relocated to @swao/module-challenge (#0580); the host injects
// the SWAO version (branding is host-only), mirroring the DoctorScreen wiring.
import { ChallengeScreen }  from '@swao/module-challenge';
import { LensesScreen }    from './screens/LensesScreen.js';
import { LzCatalogueUpdateScreen } from './screens/LzCatalogueUpdateScreen.js';
import { IngestScreen } from './screens/IngestScreen.js';
import { SupportBundleScreen } from './screens/SupportBundleScreen.js';
// Publish + Serve screens relocated to @swao/module-html-report (#0575); the
// host injects the SWAO version (branding is host-only), mirroring the
// DoctorScreen / AssessScreen wiring.
import { PublishScreen, ServeScreen } from '@swao/module-html-report';
import { LlmAssessmentScreen } from './screens/LlmAssessmentScreen.js';

// Build LZ catalogue hint once at startup so provider/region screens show
// available options as a SelectInput instead of a free-text field.
// Workspace catalogues (sovereign clouds, private providers, new regions)
// take precedence over the bundled set. New providers added to a binary update
// are merged in from the bundled index even when the workspace index.json
// predates the update (#1669).
function buildLzCatalogueHint(): LzCatalogueHint | null {
  try {
    const wsDir = resolveLzCataloguesDir(undefined, process.cwd());
    const bundledDir = resolveBundledLzCataloguesDir();
    if (!wsDir && !bundledDir) return null;

    // Load workspace index; merge in bundled entries whose provider key is absent (#1669).
    const wsIndex = wsDir ? loadLzCatalogueIndex(wsDir) : { catalogues: [], coming_soon: [] };
    const bundledIndex = bundledDir ? loadLzCatalogueIndex(bundledDir) : { catalogues: [], coming_soon: [] };
    const wsProviders = new Set(wsIndex.catalogues.map(c => c.provider));
    const allEntries = [
      ...wsIndex.catalogues,
      ...bundledIndex.catalogues.filter(c => !wsProviders.has(c.provider)),
    ];

    // Resolve each provider via the layered resolution so workspace files
    // override bundled ones even for providers whose entry came from the
    // bundled index.
    const entries = allEntries.flatMap((c) => {
      try {
        const { catalogue } = resolveProviderCatalogue(c.provider, process.cwd());
        return [{
          provider: c.provider,
          name: c.name,
          regions: (catalogue.regions as Array<{ id: string; display?: string; country?: string }>).map(r => ({
            id: r.id,
            display: r.display ?? r.id,
            country: r.country,
          })),
        }];
      } catch { return []; }
    });
    return entries.length > 0 ? { entries } : null;
  } catch { return null; }
}
const LZ_CATALOGUE_HINT = buildLzCatalogueHint();

type Screen = 'type-select' | 'main' | 'llm-assess' | MenuTarget;

// Natural next step after completing each screen
const NEXT_AFTER: Partial<Record<MenuTarget, MenuTarget>> = {
  setup:   'doctor',
  doctor:  'assess',
  assess:  'report',
  report:  'publish',
  publish: 'export-bi',
  'export-bi': 'generate-tf',
};

interface AppProps {
  initialScreen?: Screen;
}

export function App({ initialScreen = 'main' }: AppProps) {
  const [screen, setScreen]           = useState<Screen>(initialScreen);
  const [suggestedNext, setSuggested] = useState<MenuTarget | undefined>(undefined);
  const [assessmentType, setAssessmentType] = useState<'application' | 'landing-zone'>('application');
  // #1109: app name captured when navigating to the LZ Sovereignty Challenge from assess-done.
  const [lzChallengeApp, setLzChallengeApp] = useState<string>('');
  // #0825: stable terminal height so the root Box never shrinks when
  // navigating from a taller screen (LicenseScreen, ToolsMenu) to a shorter
  // one (MainMenu). Without a fixed height, Ink moves the cursor up by the
  // shorter screen's height and leaves stale lines from the taller screen
  // visible above the new header (ghost text). Setting height=rows forces
  // Ink to always paint the same number of rows; shorter screens pad with
  // blank space at the bottom instead of shrinking the render region.
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(stdout?.rows ?? 30);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTermRows(stdout.rows ?? 30);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const goMain = (from?: MenuTarget) => {
    setSuggested(from ? NEXT_AFTER[from] : undefined);
    setScreen('main');
  };

  const handleSelect = (target: MenuTarget) => {
    if (target === 'shell') {
      if (process.platform === 'win32') {
        const child = spawn('cmd', ['/c', 'start', 'cmd'], { detached: true, cwd: process.cwd(), stdio: ['ignore', 'ignore', 'ignore'] });
        child.unref();
      }
      return;
    }
    setSuggested(undefined);
    // "Run Assessment" goes to the type-selector sub-screen first.
    setScreen(target === 'assess' ? 'type-select' : target);
  };

  // Wrappers for the in-Tools navigation.
  const setToolsScreen = (s: Screen) => { setScreen(s); };

  return (
    <Box flexDirection="column" height={termRows}>
      {screen === 'type-select' && (
        <AssessmentTypeScreen
          version={SWAO_VERSION}
          onBack={() => { setScreen('main'); }}
          onSelect={(type) => {
            // AssessScreen uses the short 'landing-zone' prop form; map the
            // router token at this boundary. 'llm' routes to LlmAssessmentScreen
            // (#1427); 'hybrid' is reserved for a future sprint.
            if (type === 'application') {
              setAssessmentType(type);
              setScreen('assess');
            } else if (type === 'landing-zone-catalog') {
              setAssessmentType('landing-zone');
              setScreen('assess');
            } else if (type === 'llm') {
              setScreen('llm-assess');
            }
          }}
        />
      )}
      {screen === 'main'        && <MainMenu        onSelect={handleSelect} suggestedNext={suggestedNext} />}
      {screen === 'setup'       && <SetupWizard      onBack={() => goMain('setup')} />}
      {screen === 'doctor'      && <HealthCheckScreen onBack={() => goMain('doctor')} version={SWAO_VERSION} />}
      {screen === 'assess'      && <AssessScreen     assessmentType={assessmentType} onBack={() => {
            // ESC from any assessment type returns to the type-selector, not the main menu.
            // After completion, goMain('assess') suggests "Generate Report" as next step.
            setScreen('type-select');
          }} onChallenge={() => { setToolsScreen('challenge'); }} onLzChallenge={(a: string) => { setLzChallengeApp(a); setToolsScreen('lz-challenge'); }} version={SWAO_VERSION} scaffold={{ imports: scaffoldImports, ingestion: scaffoldIngestion, source: scaffoldSource, landingZoneStubs: scaffoldLandingZoneStubs, appYmlTemplate: appSwaoYmlTemplate, lzCatalogueHint: LZ_CATALOGUE_HINT, lenses: listLenses(), readWorkspaceLenses: (wp) => readWorkspaceLenses(join(wp, '.swao.yml')), saveWorkspaceLenses: (wp, ids) => writeWorkspaceLenses(join(wp, '.swao.yml'), ids), discoverLzGateFrameworks: (wp, _appId) => discoverGateCapableFrameworks(resolveCatalogsDir(wp), communityFrameworksDir), bundledCommunityDir: communityFrameworksDir }} />}
      {screen === 'report'      && <ReportScreen     onBack={() => goMain('report')} onOpenLicense={() => setToolsScreen('license')} />}
      {screen === 'publish'     && <PublishScreen    onBack={() => goMain('publish')} version={SWAO_VERSION} />}
      {screen === 'serve'       && <ServeScreen      onBack={() => goMain()} version={SWAO_VERSION} />}
      {screen === 'export-bi'   && <ExportBiScreen   onBack={() => goMain('export-bi')} version={SWAO_VERSION} />}
      {screen === 'portfolio'   && <PortfolioScreen  onBack={() => goMain('portfolio')}  onOpenLicense={() => setToolsScreen('license')} version={SWAO_VERSION} />}
      {screen === 'generate-tf' && <GenerateTfScreen onBack={() => goMain('generate-tf')} onOpenLicense={() => setToolsScreen('license')} version={SWAO_VERSION} />}
      {/* #0244: License / Credentials / Help now sit under the Tools submenu.
          ESC inside any of them returns to Tools; ESC from Tools returns to main. */}
      {screen === 'tools'       && <ToolsMenu        onSelect={(t: ToolsTarget) => setToolsScreen(t)} onBack={() => goMain()} />}
      {screen === 'license'     && <LicenseScreen    onBack={() => setToolsScreen('tools')} />}
      {screen === 'credentials' && <CredentialScreen onBack={() => setToolsScreen('tools')} />}
      {screen === 'help'        && <HelpScreen       onBack={() => setToolsScreen('tools')} />}
      {/* #0259.C4 -- Premium-gated; reached only via the Tools submenu. */}
      {screen === 'challenge'    && <ChallengeScreen mode="app"  onBack={() => setToolsScreen('tools')} onComplete={() => goMain()} onOpenLicense={() => setToolsScreen('license')} version={SWAO_VERSION} />}
      {/* #1109 -- LZ Sovereignty Challenge; reached from LZ assess-done via onLzChallenge. */}
      {screen === 'lz-challenge' && <ChallengeScreen mode="lz" initialApp={lzChallengeApp} onBack={() => setScreen('assess')} onComplete={() => goMain()} onOpenLicense={() => setToolsScreen('license')} version={SWAO_VERSION} />}
      {/* #0455 -- Assessment lens management; reached via the Tools submenu. */}
      {screen === 'lenses'      && <LensesScreen     onBack={() => setToolsScreen('tools')} onRunAssessment={() => { setAssessmentType('application'); setToolsScreen('assess'); }} />}
      {/* #0872 -- LZ catalogue update; Consultant+ gated; reached via Tools submenu. */}
      {screen === 'lz-catalogue-update' && <LzCatalogueUpdateScreen onBack={() => setToolsScreen('tools')} onOpenLicense={() => setToolsScreen('license')} />}
      {/* #0967 -- Ingest Files pre-processor; reached via Tools submenu. */}
      {screen === 'ingest' && <IngestScreen onBack={() => setToolsScreen('tools')} />}
      {/* #1515 -- Support diagnostic bundle; reached via Tools submenu. */}
      {screen === 'support-bundle' && <SupportBundleScreen onBack={() => setToolsScreen('tools')} />}
      {/* #1427 -- LLM Assessment: app picker, leg review, run progress, ranked result. */}
      {screen === 'llm-assess' && <LlmAssessmentScreen onBack={() => setScreen('type-select')} />}
    </Box>
  );
}
