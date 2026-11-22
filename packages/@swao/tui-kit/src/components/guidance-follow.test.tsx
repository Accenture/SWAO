// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the guidance box follows the cursor (#4230)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4230 (Design 126 section 7.8), day 2:
// GF-01 guidanceOwnsKey: an open box owns Esc, PgUp and PgDn only; a closed box owns nothing
// GF-02 SelectInput reports the highlighted option when the options arrive after the first render
// GF-03 SelectInput reports a new option list that reuses the values with other entries
// GF-04 CommunityFrameworkPicker: the open box follows the cursor from "All" to a framework and stays open
// GF-05 LzCatalogPicker and LlmModelPicker: the open box follows the highlighted option

import { describe, it, expect, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { SelectInput, type SelectOption } from './SelectInput.js';
import { guidanceOwnsKey } from './guidance-entry.js';
import { CommunityFrameworkPicker } from './CommunityFrameworkPicker.js';
import { LzCatalogPicker } from './LzCatalogPicker.js';
import { LlmModelPicker } from './LlmModelPicker.js';
import { renderAt } from '../testing/render-at.js';

const DOWN = '\u001B[B';
const CTRL_G = '\u0007';

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function press(stdin: { write(d: string): void }, ...keys: string[]): Promise<void> {
  await settle();
  for (const k of keys) {
    stdin.write(k);
    await settle();
  }
}

describe('guidanceOwnsKey (#4230)', () => {
  it('GF-01 an open box owns Esc, PgUp and PgDn; arrows, Enter and letters reach the screen', () => {
    expect(guidanceOwnsKey({ escape: true }, true)).toBe(true);
    expect(guidanceOwnsKey({ pageUp: true }, true)).toBe(true);
    expect(guidanceOwnsKey({ pageDown: true }, true)).toBe(true);
    expect(guidanceOwnsKey({}, true)).toBe(false);
    expect(guidanceOwnsKey({ escape: false, pageDown: false }, true)).toBe(false);
    // A collapsed box owns no key: Esc goes to the flow, PgUp and PgDn page the list.
    expect(guidanceOwnsKey({ escape: true }, false)).toBe(false);
    expect(guidanceOwnsKey({ pageDown: true }, false)).toBe(false);
  });
});

describe('SelectInput reports the highlighted option without a key press (#4230)', () => {
  it('GF-02 options that arrive after the first render are reported', async () => {
    const seen = vi.fn();
    const OPTS: SelectOption[] = [
      { label: 'First', value: 'first', guidance: { title: 'First entry', what: 'one' } },
      { label: 'Second', value: 'second' },
    ];
    function Late(): JSX.Element {
      const [opts, setOpts] = useState<SelectOption[]>([]);
      useEffect(() => { const t = setTimeout(() => setOpts(OPTS), 10); return () => clearTimeout(t); }, []);
      return <SelectInput label="Pick" options={opts} onSelect={() => undefined} onCursorChange={seen} />;
    }
    const r = renderAt(<Late />, 100);
    await settle(80);
    r.unmount();
    const last = seen.mock.calls[seen.mock.calls.length - 1]!;
    expect(last[0]).toBe('first');
    expect((last[1] as SelectOption).guidance?.title).toBe('First entry');
  });

  it('GF-03 a new option list with the same values and other entries is reported', async () => {
    const seen = vi.fn();
    const A: SelectOption[] = [{ label: 'Yes', value: 'y', guidance: { title: 'Keep the scope', what: 'a' } }];
    const B: SelectOption[] = [{ label: 'Yes', value: 'y', guidance: { title: 'Link the app', what: 'b' } }];
    function Swap(): JSX.Element {
      const [opts, setOpts] = useState<SelectOption[]>(A);
      useEffect(() => { const t = setTimeout(() => setOpts(B), 10); return () => clearTimeout(t); }, []);
      return <SelectInput label="Pick" options={opts} onSelect={() => undefined} onCursorChange={seen} />;
    }
    const r = renderAt(<Swap />, 100);
    await settle(80);
    r.unmount();
    const titles = seen.mock.calls.map((c) => (c[1] as SelectOption | undefined)?.guidance?.title);
    expect(titles).toEqual(['Keep the scope', 'Link the app']);
  });
});

describe('tui-kit pickers: one box that follows the cursor (#4230)', () => {
  it('GF-04 CommunityFrameworkPicker: the open box moves from "All" to the framework and stays open', async () => {
    const r = renderAt(
      <CommunityFrameworkPicker
        app="brickos"
        options={[
          { id: 'GDPR', name: 'General Data Protection Regulation', description: 'EU data protection rules.', controlsCount: 42 },
          { id: 'BSI_C5', name: 'BSI C5', description: 'Cloud computing compliance criteria catalogue.', controlsCount: 100 },
        ]}
        initialSelected={[]}
        onConfirm={() => undefined}
      />,
      100,
      50,
    );
    await press(r.stdin, CTRL_G);
    let f = r.lastFrame();
    expect(f).toContain('Community Frameworks');
    expect(f).toContain('Ctrl+G close guidance');
    await press(r.stdin, DOWN);
    f = r.lastFrame();
    expect(f).toContain('GDPR: General Data Protection Regulation');
    expect(f).toContain('EU data protection rules.');
    expect(f).toContain('Ctrl+G close guidance');
    await press(r.stdin, DOWN);
    f = r.lastFrame();
    r.unmount();
    expect(f).toContain('BSI_C5: BSI C5');
    expect(f).toContain('Ctrl+G close guidance');
    expect(f).not.toMatch(/ -- /);
  });

  it('GF-05 LzCatalogPicker and LlmModelPicker: the open box follows the highlighted option', async () => {
    const lz = renderAt(
      <LzCatalogPicker
        app="brickos"
        providerLabel="OTC"
        options={[
          { label: 'GDPR  (42 controls)', value: 'GDPR', name: 'GDPR', description: 'EU data protection rules.', gate_summary: 'EU residency' },
          { label: 'BSI_C5  (100 controls)', value: 'BSI_C5', name: 'BSI C5', description: 'Cloud criteria.' },
        ]}
        onConfirm={() => undefined}
      />,
      100,
      50,
    );
    await press(lz.stdin, CTRL_G);
    expect(lz.lastFrame()).toContain('GDPR: GDPR');
    expect(lz.lastFrame()).toContain('EU residency');
    await press(lz.stdin, DOWN);
    const lf = lz.lastFrame();
    lz.unmount();
    expect(lf).toContain('BSI_C5: BSI C5');
    expect(lf).toContain('Ctrl+G close guidance');

    const llm = renderAt(<LlmModelPicker app="brickos" currentLabel="anthropic" onSelect={() => undefined} />, 100, 50);
    await press(llm.stdin, CTRL_G);
    expect(llm.lastFrame()).toContain('Removes the override');
    await press(llm.stdin, DOWN, DOWN, DOWN);
    const mf = llm.lastFrame();
    llm.unmount();
    expect(mf).toContain('A local Ollama server');
    expect(mf).toContain('Storage:');
    expect(mf).toContain('Ctrl+G close guidance');
  });
});
