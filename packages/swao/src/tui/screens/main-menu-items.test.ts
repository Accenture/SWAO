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

// #3476 (Design 116 REQ-12.3): the MCP start prompt renders the TUI main menu
// from the same data (main-menu-items.ts) the MainMenu screen uses.

import { describe, it, expect } from 'vitest';
import { buildStartPromptText } from '@swao/module-mcp';
import { ITEMS, MENU_INFO, mainMenuEntries } from './main-menu-items.js';

describe('main-menu-items for the MCP start prompt (#3476)', () => {
  it('mainMenuEntries follows ITEMS without the Windows-only shell entry', () => {
    const entries = mainMenuEntries();
    expect(entries.map((e) => e.key)).toEqual(ITEMS.filter((i) => i.target !== 'shell').map((i) => i.key));
    for (const e of entries) {
      const item = ITEMS.find((i) => i.key === e.key)!;
      expect(e.what).toBe(MENU_INFO[item.target].what);
    }
    expect(entries.some((e) => e.label === 'Open Shell Here')).toBe(false);
  });

  it('the start prompt holds every menu label (except the shell entry), the version, and no dashes', () => {
    const text = buildStartPromptText({ entries: mainMenuEntries(), version: '1.2.3', edition: 'Enterprise', listedTools: new Set(['swao']) });
    for (const item of ITEMS.filter((i) => i.target !== 'shell')) expect(text, item.label).toContain(item.label);
    expect(text).not.toContain('Open Shell Here');
    expect(text).toContain('v1.2.3 Enterprise');
    expect(text).not.toMatch(/--|[\u2013\u2014]/);
  });
});
