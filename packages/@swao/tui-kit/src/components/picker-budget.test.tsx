// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, pickers on the shared height rule (#4348)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4348 (Design 126 sections 3 and 10), day 2: SelectInput and MultiSelect
// take their window from the shared height rule inside a measured frame.
// PB-01 pickerBudgetRows: no bound when the options fit; two "more" lines counted otherwise
// PB-02 SelectInput of 235 apps in ScreenLayout at 24, 30 and 40 rows: the frame fits, the guidance box is last
// PB-03 MultiSelect of 60 frameworks in ScreenLayout at 24 and 30 rows: the frame fits
// PB-04 ListBudgetScope (a screen without ScreenLayout): the picker plus the rows outside fit the terminal
// PB-05 outside a frame the picker keeps its own bound (visibleCount, terminal height)

import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { SelectInput } from './SelectInput.js';
import { MultiSelect } from './MultiSelect.js';
import { ScreenLayout } from './ScreenLayout.js';
import { GuidanceBox } from './GuidanceBox.js';
import { KEY_HINTS } from './KeyHints.js';
import { ListBudgetScope, pickerBudgetRows, GUIDANCE_COLLAPSED_ROWS } from './list-window.js';
import { renderAt } from '../testing/render-at.js';

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));
const LICENCE = { tier: 'enterprise' as const, assessmentCount: 12, firstRun: '2026-01-01', exp: '2099-03-31' };
const APPS = Array.from({ length: 235 }, (_, i) => ({ label: `app${String(i + 1).padStart(4, '0')}`, value: `app${i + 1}` }));

/** Lines of the frame without the trailing empty line Ink writes. */
function frameLines(f: string): string[] {
  const lines = f.split('\n');
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}

describe('pickerBudgetRows (#4348)', () => {
  it('PB-01 no bound when the options fit; otherwise the budget minus the fixed rows and two more lines', () => {
    expect(pickerBudgetRows(undefined, 3, 100)).toBeUndefined();
    expect(pickerBudgetRows(20, 3, 10)).toBeUndefined();
    expect(pickerBudgetRows(20, 3, 100)).toBe(15);
    expect(pickerBudgetRows(4, 3, 100)).toBe(1);
  });
});

describe('pickers on the shared height rule (#4348)', () => {
  for (const rows of [24, 30, 40]) {
    it(`PB-02 SelectInput of 235 apps in ScreenLayout at ${rows} rows fits the terminal with the guidance box last`, async () => {
      const r = renderAt(
        <ScreenLayout
          header={{ subtitle: 'Run Assessment', version: '1.6.1', licenseState: LICENCE }}
          title={{ title: 'Select application', subtitle: 'The app to assess.' }}
          keys={KEY_HINTS.picker}
          guidance={{ entry: { title: 'Select application', what: 'Choose the app from your workspace.' } }}
        >
          <SelectInput label="Select application to assess" options={APPS} visibleCount={100} filter itemNoun="apps" showKeyHints={false} onSelect={() => undefined} />
        </ScreenLayout>,
        100,
        rows,
      );
      await settle();
      const lines = frameLines(r.lastFrame());
      r.unmount();
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(lines.join('\n')).toContain('app0001');
      expect(lines.join('\n')).toMatch(/↓ \d+ more/);
      expect(lines[lines.length - 3]).toContain('Ctrl+G for guidance');
    });
  }

  for (const rows of [24, 30]) {
    it(`PB-03 MultiSelect of 60 frameworks in ScreenLayout at ${rows} rows fits the terminal`, async () => {
      const options = Array.from({ length: 60 }, (_, i) => ({ label: `FW_${i + 1}`, value: `fw${i + 1}` }));
      const r = renderAt(
        <ScreenLayout
          header={{ subtitle: 'Run Assessment', version: '1.6.1', licenseState: LICENCE }}
          title={{ title: 'Frameworks' }}
          keys={KEY_HINTS.multiSelect}
          guidance={{ entry: { title: 'Frameworks', what: 'Select the frameworks.' } }}
        >
          <MultiSelect label="Frameworks" options={options} visibleCount={100} onConfirm={() => undefined} />
        </ScreenLayout>,
        100,
        rows,
      );
      await settle();
      const lines = frameLines(r.lastFrame());
      r.unmount();
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(lines.join('\n')).toContain('FW_1');
      expect(lines.join('\n')).toContain('Ctrl+G for guidance');
    });
  }

  it('PB-04 ListBudgetScope: a screen without ScreenLayout keeps the picker and the guidance box inside the terminal', async () => {
    const rows = 26;
    const r = renderAt(
      <Box flexDirection="column" padding={1}>
        <ListBudgetScope outside={2 + 1 + GUIDANCE_COLLAPSED_ROWS}>
          <Text>HEADER LINE 1</Text>
          <Text>HEADER LINE 2</Text>
          <Text>HEADER LINE 3</Text>
          <SelectInput label="Select application to assess" options={APPS} visibleCount={100} showKeyHints={false} onSelect={() => undefined} />
        </ListBudgetScope>
        <GuidanceBox entry={{ title: 'Select app', what: 'Choose the app.' }} />
      </Box>,
      100,
      rows,
    );
    await settle();
    const lines = frameLines(r.lastFrame());
    r.unmount();
    expect(lines.length).toBeLessThanOrEqual(rows - 1);
    expect(lines.join('\n')).toContain('Ctrl+G for guidance');
    expect(lines.join('\n')).toContain('app0001');
  });

  it('PB-05 outside a frame the picker keeps visibleCount', async () => {
    const r = renderAt(<SelectInput label="Pick" options={APPS} visibleCount={5} onSelect={() => undefined} />, 100, 60);
    await settle();
    const f = r.lastFrame();
    r.unmount();
    expect(f).toContain('app0005');
    expect(f).not.toContain('app0006');
  });
});
