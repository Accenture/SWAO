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

import { useState, useRef, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { GuidanceBox, isAllowed } from '@swao/tui-kit';
import type { LicenseStateView, LicenseTier } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { LicenseGuard } from '../../license/license-guard.js';
import { SWAO_CONTACTS_INLINE, SWAO_LANDING_URL } from '../../branding.js';

export type MenuTarget =
  | 'setup'
  | 'doctor'
  | 'assess'
  | 'report'
  | 'publish'     // #0432 -- swao publish: HTML single-file publication
  | 'export-bi'
  | 'portfolio'
  | 'generate-tf'
  | 'tools'
  | 'license'
  | 'credentials'
  | 'help'
  | 'challenge'     // #0259.C4 -- Premium-gated stakeholder challenge; surfaced under Tools
  | 'lz-challenge'  // #1109 -- LZ Sovereignty Challenge; reached from LZ assess-done
  | 'lenses'      // #0455 -- assessment lens management; surfaced under Tools
  | 'serve'              // #0438 -- SWAO Live Portal server; launched from PublishScreen
  | 'shell'
  | 'lz-catalogue-update' // #0872 -- LZ catalogue refresh; reached via Tools submenu
  | 'ingest'              // #0967 -- Pre-process ingestion/ folder; reached via Tools submenu
  | 'support-bundle'     // #1515 -- PII-free diagnostic bundle; reached via Tools submenu
  | 'chat';              // #2778 -- Multi-turn portfolio chat; reached via Tools submenu (Enterprise)
  // lz-catalogue-manage removed: auto-seeded during init (#1522)

interface MenuItem {
  key: string;
  label: string;
  detail: string;
  target: MenuTarget;
  /** If set, item is visible but requires this tier or higher to activate. */
  tierRequired?: Exclude<LicenseTier, 'community'>;
  /** If true, item is visible but not yet implemented; shows [Coming soon] badge and refuses activation. */
  comingSoon?: boolean;
}

interface MenuInfo {
  what: string;
  use: string;
  output: string;
}

// #0244: continuous 1..8 numbering on the main menu. License, Credentials,
// and Help live under the Tools submenu (item 8). Shell stays on `s` and
// Exit stays on `0` so muscle memory survives the change.
const ITEMS: MenuItem[] = [
  { key: '1', label: 'Workspace Setup',     detail: 'init + LLM + credentials wizard',         target: 'setup'       },
  { key: '2', label: 'Health Check',        detail: 'swao health-check',                       target: 'doctor'      },
  { key: '3', label: 'Run Assessment',      detail: 'Application / Audit / Landing Zone + more', target: 'assess'      },
  { key: '4', label: 'Generate Report',     detail: 'swao report (text / PDF)',                target: 'report'      },
  { key: '5', label: 'Publish HTML',        detail: 'swao publish -- publications/ folder (HTML)', target: 'publish',     tierRequired: 'consultant' as const },
  { key: '6', label: 'Export BI',           detail: 'star schema / PowerBI / Tableau',         target: 'export-bi'   },
  { key: '7', label: 'Portfolio Operations', detail: 'multi-app aggregate',                    target: 'portfolio',   tierRequired: 'enterprise' as const },
  { key: '8', label: 'Generate TF Modules', detail: 'swao generate-tf',                        target: 'generate-tf', tierRequired: 'enterprise' as const, comingSoon: true as const },
  { key: '9', label: 'Tools',               detail: 'lenses / license / credentials / help',   target: 'tools'       },
  ...(process.platform === 'win32'
    ? [{ key: 's', label: 'Open Shell Here', detail: 'open command prompt in workspace', target: 'shell' as MenuTarget }]
    : []),
];

const MENU_INFO: Record<MenuTarget, MenuInfo> = {
  setup: {
    what:   'Workspace configuration wizard (7 steps): LLM provider, API keys, MCP entry.',
    use:    'Run once per engagement, or re-run to edit existing settings.',
    output: '.swao.yml  |  apps/ structure  |  Claude Desktop config',
  },
  doctor: {
    what:   'Environment health check -- verifies licence, LLM, Playwright, MCP, and inputs.',
    use:    'Run before an assessment or after any configuration change.',
    output: 'Health report on screen. Exit 0 = ok, 1 = warning.',
  },
  assess: {
    what:   'Run an assessment: Application (12-pass), Audit, Landing Zone, LLM, or Hybrid.',
    use:    'Source code -> Application  |  Interview records -> Audit  |  IaC export -> Landing Zone.',
    output: 'wsp/runs/<ts>/passes/  |  wsp/latest.txt',
  },
  report: {
    what:   'Generate stakeholder reports (text / PDF) from the latest assessment.',
    use:    'Run after swao assess. Choose "All views" or a specific audience.',
    output: 'wsp/reports-app/<ts>-{technical,exec,compliance,finops,migration-manager}.txt',
  },
  publish: {
    what:   'Single-file HTML publication from the latest assessment (search + compliance).',
    use:    'Run after swao assess. Select the app ID. EN/DE language switcher included.',
    output: 'apps/<id>/wsp/publications/<ts>-<id>.html  (< 2 MB)',
  },
  'export-bi': {
    what:   'BI export bundle: star-schema CSV + NDJSON + XLSX for PowerBI / Tableau.',
    use:    'Run after a successful assessment. PowerBI templates refresh automatically.',
    output: 'apps/<id>/wsp/exports/<ts>/{star,ndjson,xlsx}/  |  wsp/templates/powerbi/',
  },
  portfolio: {
    what:   'Multi-app aggregation: LZR assess, BI export (19-CSV), and portfolio report.',
    use:    'Enterprise. Run after assessing two or more apps.',
    output: 'wsp/exports/<ts>/star/  |  wsp/reports-app/<ts>/  |  swao-portfolio.pbit',
  },
  'generate-tf': {
    what:   'Generate Terraform module stubs for the target sovereign landing zone. Coming soon.',
    use:    'Enterprise. Run after assessment. Feature is in development -- not yet available.',
    output: 'Terraform module stubs for the migration engineer.',
  },
  tools: {
    what:   'Tools submenu: licence, credentials, lenses, and help.',
    use:    'Open to check licence tier, rotate API keys, or review the quick-reference guide.',
    output: 'No files written (credential store writes to ~/.swao/).',
  },
  license: {
    what:   'Licence management: view status or request an upgrade.',
    use:    `Community: free, unlimited. Consultant: PDF + BI (500 runs). Enterprise: portfolio + 2000 runs. Contact ${SWAO_CONTACTS_INLINE}.`,
    output: 'Licence status: tier, budget, expiry, machine fingerprint.',
  },
  credentials: {
    what:   'Secure credential store: Anthropic, OpenAI, GitHub PAT, Ollama endpoint.',
    use:    'Store or rotate API keys. Encrypted with AES-256-GCM, tied to this machine.',
    output: '~/.swao/credentials  |  injected into assessment child process.',
  },
  help: {
    what:   'Quick reference guide and troubleshooting tips.',
    use:    'Open for a reminder of menu items, quick-start steps, or common error fixes.',
    output: 'On-screen only. No files written.',
  },
  challenge: {
    what:   'LLM agents stress-test a WSP assessment from a stakeholder lens.',
    use:    `Enterprise only. Via Tools (9). Contact ${SWAO_CONTACTS_INLINE} to upgrade.`,
    output: 'apps/<id>/wsp/challenge-app/<ts>/<agent>.yaml',
  },
  // #1109 -- LZ Sovereignty Challenge; reached from LZ assess-done (not a menu item).
  'lz-challenge': {
    what:   'LLM agents challenge an LZ Catalog Assessment from sovereignty and architecture lenses.',
    use:    'Enterprise only. Reached via C key on the LZ assess-done screen.',
    output: 'apps/<id>/wsp/challenge-lz/<ts>/LZCA_<agent>.yaml',
  },
  shell: {
    what:   'Open a command prompt in the current workspace folder (Windows only).',
    use:    'Use for CLI commands: playwright install, git, or inspecting output files.',
    output: 'New cmd.exe window. TUI stays open in background.',
  },
  lenses: {
    what:   'Select analysis passes and compliance frameworks for this workspace.',
    use:    'Via Tools (9). Bundled lenses: cloud-migration, security-focus, data-governance.',
    output: '.swao.yml assessment.lenses  |  no assessment output written.',
  },
  serve: {
    what:   'Live Portal server: Mode B static site + REST/MCP API at localhost:4000.',
    use:    'Launched from Publish screen. Enterprise licence required.',
    output: 'Fastify server at localhost:4000  |  REST /api/v1/  |  SSE stream.',
  },
  // #0872 -- Consultant+ only; reached via Tools submenu (item 9 -> item 5).
  'lz-catalogue-update': {
    what:   'Refresh the landing zone service catalogues for AWS, Azure, GCP, and STACKIT.',
    use:    'Via Tools (9). Requires Consultant or Enterprise licence.',
    output: '<workspace>/wsp/inputs/catalogs/lz-catalogues/ JSON files  |  takes precedence over bundled copy.',
  },
  // #0967 -- Pre-process ingestion/ folder; reached via Tools submenu.
  ingest: {
    what:   'Pre-process the ingestion/ folder: classify files by content, extract text from PDF/DOCX/XLSX/PPTX, and write the SHA-256 manifest.',
    use:    'Via Tools (9 -> 5). Run before swao assess when you have a large document collection.',
    output: 'wsp/inputs/<category>/ routed files  |  companion extracted-text files  |  ingestion/ingestion-manifest.json.',
  },
  // #1515 -- PII-free diagnostic bundle; reached via Tools submenu.
  'support-bundle': {
    what:   'Create a PII-free diagnostic bundle of SWAO event logs and environment info for support hand-off.',
    use:    'Via Tools (9 -> 6). Run when filing a support request. Excludes all document content, API keys, and user data.',
    output: 'wsp/support-diag/<timestamp>.tar.gz  |  no user data or credentials included.',
  },
  // #2778 -- Multi-turn portfolio chat; Enterprise only; reached via Tools submenu.
  chat: {
    what:   'Multi-turn LLM conversation about the portfolio assessment results.',
    use:    'Via Tools (9 -> 6). Enterprise only. Requires a configured LLM gateway. MCP server auto-starts for context.',
    output: 'wsp/chat/<ts>.ndjson  |  conversation history preserved across sessions.',
  },
};

interface MainMenuProps {
  onSelect: (target: MenuTarget) => void;
  suggestedNext?: MenuTarget;
  /** #2579: cursor returns to this item when navigating back from a sub-screen. */
  lastVisited?: MenuTarget;
  /** ESC navigates back to the Assessment Type screen when provided. */
  onBack?: () => void;
  /** Called when a tier-gated item is activated without sufficient licence. */
  onUpgradeNeeded?: (feature: string, tier: Exclude<LicenseTier, 'community'>, description: string) => void;
}

export function MainMenu({ onSelect, suggestedNext, lastVisited, onBack, onUpgradeNeeded }: MainMenuProps) {
  const { exit } = useApp();

  // Load licence state once (same pattern as LzCatalogueUpdateScreen).
  const licenseState = useMemo<LicenseStateView>(() => {
    try {
      return LicenseGuard.load().state as LicenseStateView;
    } catch {
      return { tier: 'community', assessmentCount: 0, firstRun: '' };
    }
  }, []);

  // #2579: restore cursor to lastVisited when returning from a sub-screen;
  // fall back to suggestedNext for initial entry (virgin session).
  const initialIdx = lastVisited
    ? Math.max(0, ITEMS.findIndex(it => it.target === lastVisited))
    : suggestedNext
    ? Math.max(0, ITEMS.findIndex(it => it.target === suggestedNext))
    : 0;

  const [idx, setIdx] = useState(initialIdx);
  // #0248: once the operator has navigated (arrow keys or a shortcut
  // that lands them on a row other than the suggested one), suppress
  // the green "suggested next" hint. Its purpose was to nudge; once
  // the operator has chosen otherwise, the nudge has served its
  // purpose and the visual clutter should go away.
  const [hasNavigated, setHasNavigated] = useState(false);
  // Inline message for comingSoon items activated by Enterprise users (#2312).
  const [comingSoonMsg, setComingSoonMsg] = useState('');
  // #0813: guard prevents Escape/Enter from navigating away while guidance is open.
  const guidanceOpenRef = useRef(false);
  // #0816: useRef mirrors the stale-closure fix from SelectInput #0805. Ink
  // re-registers useInput on every render; the old handler can fire with a
  // stale idx during screen transitions. Refs always hold the live value.
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const hasNavigatedRef = useRef(hasNavigated);
  hasNavigatedRef.current = hasNavigated;
  // Stable ref to licenseState to avoid stale closure in useInput.
  const licenseStateRef = useRef(licenseState);
  licenseStateRef.current = licenseState;

  /** Activate an item: enforce tier gate, then comingSoon gate, then route. */
  const activateItem = (item: MenuItem) => {
    if (item.tierRequired && !isAllowed(licenseStateRef.current, item.tierRequired)) {
      if (onUpgradeNeeded) onUpgradeNeeded(item.label, item.tierRequired, item.detail);
      return;
    }
    if (item.comingSoon) {
      setComingSoonMsg(`${item.label} is coming soon in a future release.`);
      return;
    }
    onSelect(item.target);
  };

  useInput((input, key) => {
    // #2304: Enter activates the highlighted item even when the GuidanceBox is
    // expanded. GuidanceBox closes itself on Enter; the parent handler must also
    // fire (per GuidanceBox #1412 intent) or the shell/menu item is never reached.
    if (guidanceOpenRef.current && !key.return && !key.upArrow && !key.downArrow) return;
    // Clear any inline coming-soon message on the next keypress.
    if (comingSoonMsg) setComingSoonMsg('');
    if (key.upArrow) {
      setIdx(i => Math.max(0, i - 1));
      setHasNavigated(true);
    }
    if (key.downArrow) {
      setIdx(i => Math.min(ITEMS.length - 1, i + 1));
      setHasNavigated(true);
    }
    if (key.return) {
      const item = ITEMS[idxRef.current];
      if (item) activateItem(item);
      return;
    }
    // ESC = back when onBack is provided; at top level ESC does nothing (#2554: no silent exit).
    // Use 0 (or the Exit item) to exit SWAO from the main menu.
    if (key.escape) { if (onBack) { onBack(); } return; }
    if (input === '0') { exit(); return; }

    const shortcut = ITEMS.find(it => it.key === input);
    if (shortcut) {
      if (shortcut.target !== suggestedNext) setHasNavigated(true);
      activateItem(shortcut);
    }
  });

  const activeItem = ITEMS[idx];
  const info = activeItem ? MENU_INFO[activeItem.target] : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Main Menu" />
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map((item, i) => {
          const active = i === idx;
          const tierBlocked = !!item.tierRequired && !isAllowed(licenseState, item.tierRequired);
          // #2615: never highlight a tier-gated item as "suggested next" on a lower tier.
          const isSuggested =
            suggestedNext && item.target === suggestedNext && !active && !hasNavigated && !tierBlocked;
          // #2605: tier-gated items remain fully visible (badge signals the gate);
          // only items truly unavailable to all tiers (comingSoon without a tier
          // requirement) are dimmed so the visual treatment is consistent across
          // MainMenu and ToolsMenu.
          const comingSoonOnly = !!item.comingSoon && !tierBlocked;
          return (
            <Box key={item.key}>
              <Text
                color={comingSoonOnly ? undefined : (active ? 'cyan' : isSuggested ? 'green' : undefined)}
                bold={active && !comingSoonOnly}
                dimColor={comingSoonOnly}
              >
                {active ? ' ❯ ' : '   '}
                {item.key}{'  '}{item.label}
              </Text>
              {/* #2560: all tier badges use yellow so they are visually consistent */}
              {tierBlocked && (
                <Text color="yellow">
                  {'  '}{item.tierRequired === 'enterprise' ? '[Enterprise]' : '[Consultant+]'}
                </Text>
              )}
              {item.comingSoon && !tierBlocked && <Text dimColor>{'  [Coming soon]'}</Text>}
              <Text dimColor>{'  '}{item.detail}</Text>
              {isSuggested && <Text color="green" dimColor>  {'<-'} suggested next</Text>}
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>   0  Exit</Text>
        </Box>
      </Box>

      {comingSoonMsg && (
        <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">{comingSoonMsg}</Text>
        </Box>
      )}

      {info && (
        <GuidanceBox
          title={activeItem!.label}
          what={info.what}
          details={[
            { label: 'When to use', value: info.use },
            { label: 'Deliverables', value: info.output },
          ]}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      )}

      <Box marginTop={1}>
        <Text dimColor>Arrow keys or number to select   Enter to open   0 to exit</Text>
      </Box>
      <Box>
        <Text><Text dimColor>Further information: </Text><Text bold color="cyanBright">{SWAO_LANDING_URL}</Text></Text>
      </Box>
    </Box>
  );
}
