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

// #4257 (TUI-13, Design 126 sections 3 and 4.1): the Tools menu on
// ScreenLayout with the central numbered SelectInput and one guidance entry
// per entry (#4230). Esc and "0 Back to main menu" return to the main menu.

import { useMemo } from 'react';
import {
  ScreenLayout, SelectInput, KEY_HINTS, isAllowed, useFlowNavigation, useOptionGuidance,
  type GuidanceEntry, type LicenseStateView, type SelectOption,
} from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { SWAO_LANDING_URL } from '../../branding.js';
import type { MenuTarget } from './MainMenu.js';

// Subset of MenuTarget reachable from the Tools submenu.
// challenge + lenses removed: both are now integrated into the assessment wizard flow.
// lz-catalogue-manage removed (#1522): auto-seeded during init; no menu action needed.
// lz-connections removed (#4127): Landing Zone Connections is part of the Landing
// Zone Live setup branch (Design 125 section 5.5) and step 1 of the Landing Zone
// Live Assessment; `swao lz connect / probe / migrate / remove` are unchanged.
export type ToolsTarget = Extract<MenuTarget, 'license' | 'credentials' | 'help' | 'lz-catalogue-update' | 'llm-gateway-update' | 'ingest' | 'support-bundle' | 'chat'>;

interface ToolsItem {
  key: string;
  label: string;
  detail: string;
  // #2417: when true, show [Consultant+] marker on Community/Consultant binaries
  consultantGated?: boolean;
  // #2778: when true, show [Enterprise] marker on non-Enterprise binaries
  enterpriseGated?: boolean;
  target: ToolsTarget;
}

interface ToolsInfo {
  what: string;
  use: string;
  output: string;
  /** #4257 (Design 126 section 8 rule 2): the CLI equivalent, shown only in the guidance cli line. */
  cli?: string;
}

const ITEMS: ToolsItem[] = [
  { key: '1', label: 'License',             detail: 'status / request / activate',                    target: 'license'             },
  { key: '2', label: 'Credentials',         detail: 'list / set / delete',                            target: 'credentials'         },
  // #0872 -- LZ catalogue refresh; Consultant+ gated inside the screen.
  { key: '3', label: 'Update LZ Catalogue', detail: 'refresh provider service catalogues',              target: 'lz-catalogue-update', consultantGated: true },
  // #3388 -- refresh workspace LLM gateway connectors from the packaged seeds.
  { key: '4', label: 'Update LLM Gateway',   detail: 'refresh workspace connectors from packaged seeds',   target: 'llm-gateway-update' },
  // #0967 -- pre-process ingestion/ before a full assessment run.
  { key: '5', label: 'Ingest Files',         detail: 'pre-process ingestion/ folder (classify + extract)', target: 'ingest'          },
  // #1515 -- PII-free diagnostic bundle for support hand-off.
  { key: '6', label: 'Support Bundle',       detail: 'create PII-free diagnostic bundle for support',       target: 'support-bundle'   },
  // #2778 -- Multi-turn portfolio chat; Enterprise only.
  { key: '7', label: 'Chat with Portfolio',  detail: 'multi-turn LLM conversation about assessments',       target: 'chat', enterpriseGated: true },
  { key: '8', label: 'Help',                 detail: 'quick reference + troubleshooting',                  target: 'help'             },
  // #4126: the #3875 Frameworks entry (key f) is removed with the framework install and baseline commands (owner decision 2026-11-08).
];

const TOOLS_INFO: Record<ToolsTarget, ToolsInfo> = {
  license: {
    what:   'Licence management: view status, activate a key, or request a new licence.',
    use:    `Community: unlimited (Apache-2.0). Consultant: PDF export + Terraform. Enterprise: portfolio mode + challenge agents. For upgrades, see ${SWAO_LANDING_URL}`,
    output: 'Licence status screen showing tier, usage, expiry, and machine fingerprint.',
  },
  credentials: {
    what:   'Secure credential store for API keys and tokens.',
    use:    'Store or update your Anthropic API key (sk-ant-...), OpenAI key (sk-...), GitHub / GitLab PAT, or Ollama endpoint. Credentials are encrypted with AES-256-GCM and tied to this machine.',
    output: 'Encrypted credential file at ~/.swao/credentials; credentials are injected into assessment child process.',
  },
  help: {
    what:   'Quick reference guide and troubleshooting tips.',
    use:    `Open for a menu reference, quick-start steps, or common error diagnostics (fetch failed, no workspace found, VCS clone failed, blank reports). See: ${SWAO_LANDING_URL}`,
    output: 'On-screen reference. No files written.',
  },
  // #0967 -- Ingest Files tool.
  ingest: {
    what:   'Pre-process the ingestion/ folder: classify files by content, extract text from PDF/DOCX/XLSX/PPTX, and write the SHA-256 manifest.',
    use:    'Run before an assessment with a large document set. The assessment will use the fresh manifest and skip re-processing. Re-run at any time after adding files to ingestion/.',
    output: 'Files routed into wsp/inputs/<category>/, companion extracted-text files, and ingestion/ingestion-manifest.json.',
    cli:    'swao ingest',
  },
  // #1515 -- Support diagnostic bundle.
  'support-bundle': {
    what:   'Create a PII-free diagnostic bundle of SWAO event logs and environment info.',
    use:    'Run when filing a support request. Collects event codes, timestamps, error codes, and system info. Excludes all document content, API keys, user data, and engagement names.',
    output: 'wsp/support-diag/<timestamp>.tar.gz, a gzip tar archive',
  },
  // #2778 -- Multi-turn portfolio chat; Enterprise only.
  chat: {
    what:   'Multi-turn LLM conversation about the portfolio assessment results.',
    use:    `Enterprise only. Requires a configured LLM gateway (Workspace Setup). The MCP server auto-starts to load portfolio context. History saved to wsp/chat/. See: ${SWAO_LANDING_URL}`,
    output: 'wsp/chat/<ts>.ndjson, the conversation history preserved across sessions.',
    cli:    'swao chat',
  },
  // #0872 -- LZ catalogue update; Consultant+ only.
  'lz-catalogue-update': {
    what:   'Refresh the landing zone service catalogues for AWS, Azure, GCP, and STACKIT. ' +
            'The bundled catalogues ship with each SWAO release; run this before an engagement ' +
            'to pick up services launched since the last release.',
    use:    'Requires Consultant+ licence. Internet sources need no cloud credentials: AWS, Azure, GCP, and STACKIT use public APIs. ' +
            'With a registered landing zone, its live landing zone catalogue (from a live run) is a second source: ' +
            'dry-run diff, then write, or build a new catalogue file. Refreshed files go to wsp/inputs/catalogs/lz-catalogues/ and override the bundled copy.',
    output: 'Updated JSON catalogue files in <workspace>/wsp/inputs/catalogs/lz-catalogues/.',
    cli:    'swao lz catalogue update; swao lz catalogue list shows the current state',
  },
  // #3388 (Design 112 D-2) -- refresh workspace LLM gateway connectors.
  'llm-gateway-update': {
    what:   'Refresh the workspace LLM gateway connectors (wsp/inputs/llm-gateway/) from the ' +
            'packaged seeds. The connector folder is the single source SWAO reads.',
    use:    'All tiers; no credentials. Run after upgrading the SWAO binary. Connectors you have ' +
            'edited are kept untouched; unchanged seeds are refreshed and new connectors are added.',
    output: 'Updated connector YAML files in <workspace>/wsp/inputs/llm-gateway/.',
    cli:    'swao llm-gateway update',
  },
};

interface ToolsMenuProps {
  onSelect: (target: ToolsTarget) => void;
  onBack: () => void;
}

/** Value of the "0 Back to main menu" entry (no ToolsTarget). */
const BACK_VALUE = '__back';

const TOOLS_GUIDANCE: GuidanceEntry = {
  title: 'Tools',
  what: 'Licence, credentials, catalogue and connector refresh, ingestion, support bundle, chat and help.',
};

/** Tools entries as picker options with their guidance entry (exported for tests). */
export function toolsMenuOptions(licenseState: LicenseStateView): SelectOption[] {
  const entries = ITEMS.map((item): SelectOption => {
    const info = TOOLS_INFO[item.target];
    // #2659 / #2778: the tier badge only when the active licence is below the tier.
    const b = item.consultantGated && !isAllowed(licenseState, 'consultant') ? '[Consultant+]'
      : item.enterpriseGated && !isAllowed(licenseState, 'enterprise') ? '[Enterprise]' : '';
    return {
      label: item.label,
      value: item.target,
      number: item.key,
      detail: b === '' ? item.detail : `${b}  ${item.detail}`,
      guidance: {
        title: item.label,
        what: info.what,
        sections: [
          { label: 'When to use', text: info.use },
          { label: 'Deliverables', text: info.output },
        ],
        ...(info.cli ? { cli: info.cli } : {}),
      },
    };
  });
  return [...entries, {
    label: 'Back to main menu', value: BACK_VALUE, number: '0',
    guidance: { title: 'Back to main menu', what: 'Return to the main menu.' },
  }];
}

export function ToolsMenu({ onSelect, onBack }: ToolsMenuProps) {
  // #2659: load licence state at render time so the badge reflects the active
  // tier rather than the module-load-time env var (which may not be set yet).
  const header = useScreenHeader('Tools');
  const licenseState = header.licenseState ?? { tier: 'community' as const, assessmentCount: 0, firstRun: '' };
  const options = useMemo(() => toolsMenuOptions(licenseState), [licenseState]);
  // Esc leaves to the main menu at once: the menu holds no input.
  const nav = useFlowNavigation({ steps: ['Tools'], dirty: false, onExit: onBack });
  const guidance = useOptionGuidance(TOOLS_GUIDANCE);

  return (
    <ScreenLayout
      header={header}
      title={{ title: 'Tools', subtitle: 'Licence, credentials and maintenance tasks of this workspace.' }}
      keys={KEY_HINTS.menu}
      guidance={{ entry: guidance.entry, initiallyCollapsed: true, onOpenChange: nav.onGuidanceOpenChange }}
      footer={`Further information: ${SWAO_LANDING_URL}`}
    >
      <SelectInput
        label="Tools"
        options={options}
        numbered
        visibleCount={options.length}
        showKeyHints={false}
        active={nav.contentActive}
        onSelect={(value) => { if (value === BACK_VALUE) onBack(); else onSelect(value as ToolsTarget); }}
        onCursorChange={guidance.onCursorChange}
      />
    </ScreenLayout>
  );
}
