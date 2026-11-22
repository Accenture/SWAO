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

// #4257 (TUI-13, Design 126 sections 3 and 4.8): on ScreenLayout without a
// guidance box (#2347: the help is the reference); sections as level 2
// titles, entries as DetailRows that wrap under their label.

import { Text, useInput } from 'ink';
import { ScreenLayout, StepTitle, DetailRow, type KeyHint } from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { SWAO_CONTACTS_INLINE, SWAO_LANDING_URL } from '../../branding.js';

interface HelpScreenProps {
  onBack: () => void;
}

const MENU_ITEMS = [
  { key: '1',      label: 'Workspace Setup',      when: 'First time, or to change AI provider / credentials' },
  { key: '2',      label: 'Health Check',          when: 'After any config change, or if assessments fail' },
  { key: '3',      label: 'Run Assessment',        when: 'Application / Service Portfolio / Landing Zone Catalog / LLM' },
  { key: '4',      label: 'Generate Report',       when: 'Text / PDF stakeholder reports from latest run' },
  { key: '5',      label: 'Publish HTML',          when: 'HTML report to publications/ folder (Engagement Hub)' },
  { key: '6',      label: 'Export BI',             when: 'Star schema / PowerBI / Tableau bundle' },
  { key: '7',      label: 'Portfolio Operations [Enterprise]',  when: 'Multi-app aggregate operations' },
  { key: '8',      label: 'Generate TF Modules [Enterprise]',  when: 'Terraform module stubs for sovereign LZ migration (coming soon)' },
  { key: '9',      label: 'Tools',                 when: 'Licence / Credentials / Ingest / Help' },
  { key: '9 2',    label: 'Credentials',           when: 'Tools (9), then Credentials (2): API keys and VCS tokens' },
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
  { problem: 'Ingestion exits with code 1',  fix: 'Known issue #1525. Start the assessment directly from Run Assessment (3).' },
];

const HELP_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];

export function HelpScreen({ onBack }: HelpScreenProps) {
  const header = useScreenHeader('SWAO Help');
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  return (
    <ScreenLayout
      header={header}
      title={{ title: 'Main menu reference', subtitle: 'Quick start: 1 Workspace Setup, then 3 Run Assessment, then 5 Publish HTML.' }}
      keys={HELP_KEYS}
      guidance={null}
    >
      {MENU_ITEMS.map((item) => (
        <DetailRow key={item.key} label={`${item.key.padEnd(4)}${item.label}`} value={item.when} labelWidth={38} />
      ))}
      <Text> </Text>
      <StepTitle title="Troubleshooting" level={2} />
      {TROUBLESHOOTING.map((t) => (
        <DetailRow key={t.problem} label={t.problem} value={t.fix} labelWidth={32} />
      ))}
      <Text> </Text>
      <DetailRow label="Landing page" value={SWAO_LANDING_URL} labelWidth={16} />
      <DetailRow label="Contacts" value={SWAO_CONTACTS_INLINE} labelWidth={16} />
    </ScreenLayout>
  );
}
