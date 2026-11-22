// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, theme token tests (#4258, Design 126 section 15)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TH-01 TOKENS has exactly the twelve tokens of section 15.2 with their Ink styles
// TH-02 status levels map to tokens as in section 15.4
// TH-03 tone() spreads the token style and overrides bold; tokenColor() returns the colour
// TH-04 ProgressBar takes progressRunning while it runs and progressDone at 100 percent
// TH-05 M-00 legend at 100 and 80 columns: every token, its Ink style and its sample

import { describe, it, expect } from 'vitest';
import { STATUS_TOKENS, TOKENS, TOKEN_NAMES, inkStyleName, tokenColor, tone } from './theme.js';
import { ColourLegend, COLOUR_LEGEND_SAMPLES } from './components/ColourLegend.js';
import { ProgressBar } from './components/ProgressBar.js';
import { renderAt, widest } from './testing/render-at.js';

describe('theme tokens (#4258, Design 126 section 15)', () => {
  it('TH-01 defines the twelve tokens with the section 15.2 styles', () => {
    expect(Object.keys(TOKENS).sort()).toEqual([...TOKEN_NAMES].sort());
    expect(TOKEN_NAMES).toHaveLength(12);
    expect(TOKENS.brand).toEqual({ color: 'cyanBright', bold: true });
    expect(TOKENS.text).toEqual({});
    expect(TOKENS.muted).toEqual({ dimColor: true });
    expect(TOKENS.selection).toEqual({ color: 'cyanBright' });
    expect(TOKENS.accent).toEqual({ color: 'cyan' });
    expect(TOKENS.ok).toEqual({ color: 'green' });
    expect(TOKENS.info).toEqual({ dimColor: true });
    expect(TOKENS.warning).toEqual({ color: 'yellow' });
    expect(TOKENS.error).toEqual({ color: 'red' });
    expect(TOKENS.progressRunning).toEqual({ color: 'cyan' });
    expect(TOKENS.progressDone).toEqual({ color: 'green' });
    expect(TOKENS.border).toEqual({ color: 'gray' });
  });

  it('TH-02 maps the status levels to tokens (section 15.4)', () => {
    expect(STATUS_TOKENS).toEqual({
      ok: 'ok', info: 'info', warn: 'warning', waiting: 'warning', cancelled: 'warning', fail: 'error', missing: 'error',
    });
  });

  it('TH-03 tone() and tokenColor()', () => {
    expect(tone('brand', { bold: false })).toEqual({ color: 'cyanBright', bold: false });
    expect(tone('muted')).toEqual({ dimColor: true });
    const t = tone('ok');
    t.color = 'red';
    expect(TOKENS.ok.color).toBe('green');
    expect(tokenColor('border')).toBe('gray');
    expect(tokenColor('text')).toBeUndefined();
  });

  it('TH-04 ProgressBar has no per-call colour: running and done follow the tokens', () => {
    const running = ProgressBar({ value: 1, total: 4 });
    const done = ProgressBar({ value: 4, total: 4, color: 'magenta' });
    const barStyle = (el: JSX.Element): unknown => (el.props as { children: JSX.Element[] }).children[0]!.props;
    expect(barStyle(running)).toMatchObject({ color: 'cyan' });
    expect(barStyle(done)).toMatchObject({ color: 'green' });
  });

  for (const columns of [100, 80]) {
    it(`TH-05 M-00 legend at ${columns} columns`, () => {
      const r = renderAt(<ColourLegend />, columns);
      const lines = r.lines();
      r.unmount();
      expect(lines[0]).toMatch(/^Token\s+Ink\s+Sample/);
      for (const t of TOKEN_NAMES) {
        const row = lines.find((l) => l.startsWith(t + ' '));
        expect(row, t).toBeDefined();
        expect(row).toContain(inkStyleName(TOKENS[t]));
      }
      expect(lines.join('\n')).toContain(COLOUR_LEGEND_SAMPLES.warning.slice(0, 20));
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
    });
  }
});
