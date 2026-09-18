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
import { SWAO_CONTACTS_INLINE, SWAO_LANDING_URL } from '../../branding.js';

interface HelpScreenProps {
  onBack: () => void;
}

const MENU_ITEMS = [
  { key: '1',      label: 'Workspace Setup',      when: 'First time, or to change AI provider / credentials' },
  { key: '2',      label: 'Health Check',          when: 'After any config change, or if assessments fail' },
  { key: '3',      label: 'Run Assessment',        when: 'Application / Audit / Landing Zone + more' },
  { key: '4',      label: 'Generate Report',       when: 'Text / PDF stakeholder reports from latest run' },
  { key: '5',      label: 'Publish HTML',          when: 'HTML report to publications/ folder (Engagement Hub)' },
  { key: '6',      label: 'Export BI',             when: 'Star schema / PowerBI / Tableau bundle' },
  { key: '7',      label: 'Portfolio Operations  [Enterprise]',  when: 'Multi-app aggregate operations' },
  { key: '8',      label: 'Generate TF Modules   [Consultant+]', when: 'Terraform module stubs for sovereign LZ migration' },
  { key: '9',      label: 'Tools',                 when: 'Licence / Credentials / Ingest / Help' },
  { key: '  2',    label: 'Credentials',           when: 'Tools (9) -> Credentials (2) -- API keys / VCS tokens' },
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
    if (key.escape || key.return) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="SWAO Help" />

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyanBright">Main menu reference</Text>
        <Text dimColor>  Quick start: 1 -- Workspace Setup -- 3 -- Run Assessment -- 5 -- Publish HTML</Text>
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
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text>  SWAO landing page:  <Text color="cyanBright">{SWAO_LANDING_URL}</Text></Text>
        <Text>  Contacts:           <Text color="cyanBright">{SWAO_CONTACTS_INLINE}</Text></Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Escape or Enter to return to menu...</Text>
      </Box>
    </Box>
  );
}
