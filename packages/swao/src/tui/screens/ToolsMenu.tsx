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

import { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { GuidanceBox } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { SWAO_CONTACTS_INLINE, SWAO_LANDING_URL } from '../../branding.js';
import type { MenuTarget } from './MainMenu.js';

// Subset of MenuTarget reachable from the Tools submenu.
// challenge + lenses removed: both are now integrated into the assessment wizard flow.
// lz-catalogue-manage removed (#1522): auto-seeded during init; no menu action needed.
export type ToolsTarget = Extract<MenuTarget, 'license' | 'credentials' | 'help' | 'lz-catalogue-update' | 'ingest' | 'support-bundle'>;

interface ToolsItem {
  key: string;
  label: string;
  detail: string;
  target: ToolsTarget;
}

interface ToolsInfo {
  what: string;
  use: string;
  output: string;
}

const ITEMS: ToolsItem[] = [
  { key: '1', label: 'License',             detail: 'status / request / activate',                    target: 'license'             },
  { key: '2', label: 'Credentials',         detail: 'list / set / delete',                            target: 'credentials'         },
  // #0872 -- LZ catalogue refresh; Consultant+ gated inside the screen.
  { key: '3', label: 'Update LZ Catalogue', detail: 'refresh provider service catalogues (Consultant+)', target: 'lz-catalogue-update' },
  // #0967 -- pre-process ingestion/ before a full assessment run.
  { key: '4', label: 'Ingest Files',         detail: 'pre-process ingestion/ folder (classify + extract)', target: 'ingest'          },
  // #1515 -- PII-free diagnostic bundle for support hand-off.
  { key: '5', label: 'Support Bundle',       detail: 'create PII-free diagnostic bundle for support',       target: 'support-bundle'   },
  { key: '6', label: 'Help',                 detail: 'quick reference + troubleshooting',                  target: 'help'             },
];

const TOOLS_INFO: Record<ToolsTarget, ToolsInfo> = {
  license: {
    what:   'Licence management: view status, activate a key, or request a new licence.',
    use:    `Community: unlimited assessments (free, Apache-2.0). Consultant: adds PDF export + Terraform scaffolding. Enterprise: adds portfolio mode + challenge agents. Contact ${SWAO_CONTACTS_INLINE} to upgrade. More info: ${SWAO_LANDING_URL}`,
    output: 'Licence status screen showing tier, usage, expiry, and machine fingerprint.',
  },
  credentials: {
    what:   'Secure credential store for API keys and tokens.',
    use:    'Store or update your Anthropic API key (sk-ant-...), OpenAI key (sk-...), GitHub / GitLab PAT, or Ollama endpoint. Credentials are encrypted with AES-256-GCM and tied to this machine.',
    output: 'Encrypted credential file at ~/.swao/credentials  |  Credentials injected into assessment child process.',
  },
  help: {
    what:   'Quick reference guide and troubleshooting tips.',
    use:    `Open when you need a reminder of what each menu item does, the quick start steps, or to diagnose common errors (fetch failed, no workspace found, VCS clone failed, blank reports). Further information: ${SWAO_LANDING_URL}`,
    output: 'On-screen reference. No files written.',
  },
  // #0967 -- Ingest Files tool.
  ingest: {
    what:   'Pre-process the ingestion/ folder: classify files by content, extract text from PDF/DOCX/XLSX/PPTX, and write the SHA-256 manifest.',
    use:    'Run before `swao assess` when you have a large document collection. The assessment will find a fresh manifest and skip re-processing. Can also be run standalone at any time to update the manifest after adding new files to ingestion/.',
    output: 'Files routed into wsp/inputs/<category>/, companion extracted-text files, and ingestion/ingestion-manifest.json.',
  },
  // #1515 -- Support diagnostic bundle.
  'support-bundle': {
    what:   'Create a PII-free diagnostic bundle of SWAO event logs and environment info.',
    use:    'Run when filing a support request. Collects event codes, timestamps, error codes, and system info. Excludes all document content, API keys, user data, and engagement names.',
    output: 'wsp/support-diag/<timestamp>.tar.gz  |  extract with: tar -xzf <file>',
  },
  // #0872 -- LZ catalogue update; Consultant+ only.
  'lz-catalogue-update': {
    what:   'Refresh the landing zone service catalogues for AWS, Azure, GCP, and STACKIT. ' +
            'The bundled catalogues ship with each SWAO release; run this before an engagement ' +
            'to pick up services launched since the last release.',
    use:    'Requires a Consultant or Enterprise licence. No cloud credentials required for ' +
            'AWS, Azure (Retail Prices API), GCP (region-picker), and STACKIT (PIM API). ' +
            'Refreshed files are written to <workspace>/wsp/inputs/catalogs/lz-catalogues/ and take precedence ' +
            'over the bundled binary copy for all assessments in this workspace.',
    output: 'Updated JSON catalogue files in <workspace>/wsp/inputs/catalogs/lz-catalogues/. ' +
            'Run `swao lz catalogue list` to view the current state.',
  },
};

interface ToolsMenuProps {
  onSelect: (target: ToolsTarget) => void;
  onBack: () => void;
}

export function ToolsMenu({ onSelect, onBack }: ToolsMenuProps) {
  const [idx, setIdx] = useState(0);
  const guidanceOpenRef = useRef(false);
  // #0816: same stale-closure guard as MainMenu/SelectInput.
  const idxRef = useRef(idx);
  idxRef.current = idx;

  // #1521: reset guidance ref when selection changes so a re-render that
  // recycles the component without unmounting never leaves nav permanently locked.
  useEffect(() => { guidanceOpenRef.current = false; }, [idx]);

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.upArrow)   setIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setIdx(i => Math.min(ITEMS.length - 1, i + 1));
    if (key.return) { const item = ITEMS[idxRef.current]; if (item) onSelect(item.target); }
    if (input === '0' || key.escape) onBack();

    const shortcut = ITEMS.find(it => it.key === input);
    if (shortcut) onSelect(shortcut.target);
  });

  const activeItem = ITEMS[idx];
  const info = activeItem ? TOOLS_INFO[activeItem.target] : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Tools" />
      <Box marginTop={1}>
        <Text bold color="cyanBright">Tools</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map((item, i) => {
          const active = i === idx;
          return (
            <Box key={item.key}>
              <Text color={active ? 'cyan' : undefined} bold={active}>
                {active ? ' ❯ ' : '   '}
                {item.key}  {item.label}
              </Text>
              <Text dimColor>{'  '}{item.detail}</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>   0  Back to main menu</Text>
        </Box>
      </Box>

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
        <Text dimColor>Arrow keys or number to select   Enter to open   Esc or 0 to go back</Text>
      </Box>
      <Box>
        <Text><Text dimColor>Further information: </Text><Text bold color="cyanBright">{SWAO_LANDING_URL}</Text></Text>
      </Box>
    </Box>
  );
}
