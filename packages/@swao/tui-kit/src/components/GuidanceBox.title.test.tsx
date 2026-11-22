// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the collapsed guidance box title row (#4254)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// GT-01 a long title is cut at its end; "(Ctrl+G for guidance)" stays whole at
//       100 and 80 columns (day 3 follow-up of #4254: the hint column was squeezed)
// GT-02 a short title keeps the title and the hint unchanged

import { describe, it, expect } from 'vitest';
import { GuidanceBox } from './GuidanceBox.js';
import { headerRuleWidth } from './header-width.js';
import { renderAt, widest } from '../testing/render-at.js';

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
const LONG = 'a-service-intake-workbook-with-a-long-file-name-for-the-width-test-and-more-words.xlsx';

describe('GuidanceBox collapsed title row (#4254)', () => {
  for (const columns of [100, 80]) {
    it(`GT-01 a long title at ${columns} columns keeps the whole hint`, async () => {
      const r = renderAt(<GuidanceBox entry={{ title: LONG, what: 'What it does.' }} initiallyCollapsed />, columns);
      await settle();
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      const row = lines.find((l) => l.includes('Ctrl+G'));
      expect(row).toContain('(Ctrl+G for guidance)');
      expect(row).toContain('a-service-intake');
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
    });
  }

  it('GT-02 a short title is unchanged', async () => {
    const r = renderAt(<GuidanceBox entry={{ title: 'Tools', what: 'What it does.' }} initiallyCollapsed />, 80);
    await settle();
    const text = r.lines().join(String.fromCharCode(10));
    r.unmount();
    expect(text).toContain('Tools   (Ctrl+G for guidance)');
  });
});
