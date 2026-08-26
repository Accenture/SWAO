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

import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { GuidanceBox } from '@swao/tui-kit';
import { SWAO_CONTACTS_INLINE, SWAO_LANDING_URL } from '../../branding.js';

let _helpGuidanceOpen = false;

interface HelpScreenProps {
  onBack: () => void;
}

const MENU_ITEMS = [
  { key: '1',      label: 'Workspace Setup',      when: 'First time, or to change AI provider / credentials' },
  { key: '2',      label: 'Health Check',          when: 'After any config change, or if assessments fail' },
  { key: '3',      label: 'Run Assessment',        when: 'Application / Audit / Landing Zone + more' },
  { key: '4',      label: 'Generate Report',       when: 'Text / PDF stakeholder reports from latest run' },
  { key: '5',      label: 'Publish HTML',          when: 'HTML report to publications/ folder (Engagement Hub + per-report files)' },
  { key: '6',      label: 'Export BI',             when: 'Star schema / PowerBI / Tableau bundle' },
  { key: '7',      label: 'Portfolio Operations',  when: 'Coming soon -- multi-app aggregate operations (Enterprise)' },
  { key: '8',      label: 'Generate TF Modules',   when: 'Coming soon -- Terraform stubs for migration (Consultant+)' },
  { key: '9',      label: 'Tools',                 when: 'Licence / Credentials / Ingest / Help' },
  { key: '9 -> 2', label: 'Credentials',           when: 'Update API keys or VCS tokens' },
  { key: '0',      label: 'Exit',                  when: 'Close SWAO' },
];

const TROUBLESHOOTING = [
  { problem: '"Windows protected your PC"',  fix: 'Click More info -> Run anyway (once per new download).' },
  { problem: '"No workspace found"',         fix: 'Navigate to your project folder, or run Workspace Setup (1).' },
  { problem: 'Assessment fails on pass 09',  fix: 'Tools (9) -> Credentials (2). Check HTTPS to api.anthropic.com.' },
  { problem: 'LLM 403 / model access',       fix: 'Check model name in LLM gateway connector. Verify API key tier.' },
  { problem: 'LLM 401 / incorrect key',      fix: 'Tools (9) -> Credentials (2) to re-issue the API key.' },
  { problem: 'Reports blank / stub data',    fix: 'Confirm API key is set, then run assessment again.' },
  { problem: '"VCS clone failed"',           fix: 'Check repo URL. Set GitHub PAT via Tools (9) -> Credentials.' },
  { problem: 'Pass 04 shows zero imports',   fix: 'Put files in apps/<app-id>/ingestion/ (.md .txt .yaml .json).' },
  { problem: 'Ingestion exits with code 1',  fix: 'Known issue #1525. Run swao assess directly as workaround.' },
];

export function HelpScreen({ onBack }: HelpScreenProps) {
  useInput((_input, key) => {
    if ((key.escape || key.return) && !_helpGuidanceOpen) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Help / Quick Reference" />

      <GuidanceBox
        title="Key actions and shortcuts"
        what="Main menu shortcuts and troubleshooting tips. Full documentation at the SWAO landing page."
        details={[
          { label: 'Quick start', value: '1 Setup -> 3 Assess -> 5 Publish HTML' },
          { label: 'Credentials', value: 'Menu 9 -> 2 to update API keys' },
          { label: 'Logs',        value: 'wsp/logs/portfolio-events-<YYYY-MM>.ndjson' },
        ]}
        affordances={['Esc -- return to menu']}
        onOpenChange={(open) => { _helpGuidanceOpen = open; }}
      />

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyanBright">Quick start</Text>
        <Text>  1 -- Workspace Setup  -- creates workspace, sets LLM API key and VCS token.</Text>
        <Text>  3 -- Run Assessment   -- select app, choose passes, wait for completion.</Text>
        <Text>  5 -- Publish HTML     -- generates self-contained HTML in wsp/publications/</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyanBright">Main menu reference</Text>
        <Box flexDirection="column">
          {MENU_ITEMS.map(item => (
            <Box key={item.key}>
              <Text color="cyanBright">  {item.key}  </Text>
              <Text bold>{item.label.padEnd(18)}</Text>
              <Text dimColor>  {item.when}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyanBright">Troubleshooting</Text>
        {TROUBLESHOOTING.map((t, i) => (
          <Box key={i} flexDirection="row">
            <Box width={36} flexShrink={0}>
              <Text color="yellow">  {t.problem}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text dimColor wrap="wrap">  {t.fix}</Text>
            </Box>
          </Box>
        ))}
        <Text dimColor>  Full troubleshooting guide: <Text color="cyanBright">https://github.com/Accenture/SWAO/wiki</Text></Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyanBright">Further information</Text>
        <Text>  SWAO landing page:  <Text color="cyanBright">{SWAO_LANDING_URL}</Text></Text>
        <Text>  Contacts:           <Text color="cyanBright">{SWAO_CONTACTS_INLINE}</Text></Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Escape or Enter to return to menu...</Text>
      </Box>
    </Box>
  );
}
