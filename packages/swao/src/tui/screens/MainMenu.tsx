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

// #4257 (TUI-13, Design 126 sections 3, 4.1 and 7): the main menu on
// ScreenLayout with the central numbered SelectInput, the menu key hints and
// one guidance entry per entry (#4230). Esc asks "Exit SWAO?" through the
// AbortDialog (Q-03 decided); the "0 Exit" entry stays visible and exits at once.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Text, useApp, useInput } from 'ink';
import {
  ScreenLayout, SelectInput, KEY_HINTS, isAllowed, tone, useFlowNavigation, useOptionGuidance,
  type GuidanceEntry, type LicenseTier, type SelectOption,
} from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { SWAO_LANDING_URL } from '../../branding.js';
import { ITEMS, MENU_INFO, type MenuItem, type MenuTarget } from './main-menu-items.js';
import { formatTuiMcpServerState, useTuiMcpServerState } from '../mcp-server-slot.js';

// #3476: menu data moved to main-menu-items.ts (plain module, shared with the MCP start prompt).
export type { MenuTarget } from './main-menu-items.js';

interface MainMenuProps {
  onSelect: (target: MenuTarget) => void;
  suggestedNext?: MenuTarget;
  /** #2579: cursor returns to this item when navigating back from a sub-screen. */
  lastVisited?: MenuTarget;
  /** Esc leaves to this screen at once when provided (no exit question). */
  onBack?: () => void;
  /** Called when a tier-gated item is activated without sufficient licence. */
  onUpgradeNeeded?: (feature: string, tier: Exclude<LicenseTier, 'community'>, description: string) => void;
}

/** Value of the "0 Exit" entry (no MenuTarget). */
const EXIT_VALUE = '__exit';

const EXIT_GUIDANCE: GuidanceEntry = {
  title: 'Exit',
  what: 'Close SWAO. The workspace, its runs and the settings stay on disk; nothing is lost.',
  sections: [{ label: 'Next', text: 'Start SWAO again from the workspace folder to pick up where you left off.' }],
};

const MENU_GUIDANCE: GuidanceEntry = {
  title: 'Main menu',
  what: 'Pick a task. Workspace Setup first, then Health Check, then Run Assessment.',
};

/** The tier or availability badge of an entry, shown in its description column. */
function badge(item: MenuItem, tierBlocked: boolean): string {
  if (tierBlocked) return item.tierRequired === 'enterprise' ? '[Enterprise]' : '[Consultant+]';
  if (item.comingSoon) return '[Coming soon]';
  return '';
}

/** Menu entries as picker options with their guidance entry (exported for tests). */
export function mainMenuOptions(
  isBlocked: (item: MenuItem) => boolean,
  suggested?: MenuTarget,
): SelectOption[] {
  const entries = ITEMS.map((item): SelectOption => {
    const info = MENU_INFO[item.target];
    const b = badge(item, isBlocked(item));
    const hint = suggested === item.target && !isBlocked(item) ? 'suggested next' : '';
    return {
      label: item.label,
      value: item.target,
      number: item.key,
      detail: [b, item.detail, hint].filter((s) => s !== '').join('  '),
      guidance: {
        title: item.label,
        what: info.what,
        sections: [
          { label: 'When to use', text: info.use },
          { label: 'Deliverables', text: info.output },
        ],
        ...(item.cli ? { cli: item.cli } : {}),
      },
    };
  });
  return [...entries, { label: 'Exit', value: EXIT_VALUE, number: '0', guidance: EXIT_GUIDANCE }];
}

/** #4392: the frame footer: the MCP server state (when there is one), then the landing page. */
export function mainMenuFooter(mcpLine: string | null): string {
  const info = `Further information: ${SWAO_LANDING_URL}`;
  return mcpLine ? `${mcpLine}. ${info}` : info;
}

export function MainMenu({ onSelect, suggestedNext, lastVisited, onBack, onUpgradeNeeded }: MainMenuProps) {
  const { exit } = useApp();
  const header = useScreenHeader('Main Menu');
  const licenseState = header.licenseState ?? { tier: 'community' as const, assessmentCount: 0, firstRun: '' };

  // Inline message for comingSoon items activated by Enterprise users (#2312).
  const [comingSoonMsg, setComingSoonMsg] = useState('');
  // #0248: the "suggested next" hint goes once the operator moves the cursor.
  const [hasNavigated, setHasNavigated] = useState(false);
  const mounted = useRef(false);

  // Q-03: Esc asks "Exit SWAO?"; with onBack the menu is a sub-screen and leaves at once.
  const nav = useFlowNavigation({ steps: ['Main menu'], dirty: !onBack, what: 'exit', onExit: onBack ?? exit });

  const isBlocked = useCallback(
    (item: MenuItem): boolean => !!item.tierRequired && !isAllowed(licenseState, item.tierRequired),
    [licenseState],
  );
  const options = useMemo(
    () => mainMenuOptions(isBlocked, hasNavigated ? undefined : suggestedNext),
    [isBlocked, suggestedNext, hasNavigated],
  );

  // #2579: restore the cursor to lastVisited; fall back to suggestedNext on first entry.
  const start = lastVisited ?? suggestedNext;
  const initialIndex = start ? Math.max(0, ITEMS.findIndex((it) => it.target === start)) : 0;

  const guidance = useOptionGuidance(MENU_GUIDANCE);
  // #4392: the HTTP MCP server state (Enterprise; nothing in Community and Consultant).
  const mcpLine = formatTuiMcpServerState(useTuiMcpServerState());

  /** Activate an item: enforce tier gate, then comingSoon gate, then route. */
  const activate = (value: string): void => {
    if (value === EXIT_VALUE) { exit(); return; }
    const item = ITEMS.find((it) => it.target === value);
    if (!item) return;
    if (isBlocked(item)) {
      if (onUpgradeNeeded && item.tierRequired) onUpgradeNeeded(item.label, item.tierRequired, item.detail);
      return;
    }
    if (item.comingSoon) {
      setComingSoonMsg(`${item.label} is coming soon in a future release.`);
      return;
    }
    onSelect(item.target);
  };

  // The shell entry has a letter key (Windows only); the picker reads digits only.
  useInput((input) => {
    if (comingSoonMsg) setComingSoonMsg('');
    const shortcut = ITEMS.find((it) => it.key === input && !/^[0-9]$/.test(it.key));
    if (shortcut) activate(shortcut.target);
  }, { isActive: nav.contentActive });

  return (
    <ScreenLayout
      header={header}
      keys={KEY_HINTS.menu}
      guidance={{ entry: guidance.entry, onOpenChange: nav.onGuidanceOpenChange }}
      footer={mainMenuFooter(mcpLine)}
    >
      <SelectInput
        label="Main menu"
        options={options}
        numbered
        visibleCount={options.length}
        showKeyHints={false}
        initialIndex={initialIndex}
        active={nav.contentActive}
        onSelect={activate}
        onCursorChange={(value, option) => {
          if (mounted.current && value !== suggestedNext) setHasNavigated(true);
          mounted.current = true;
          guidance.onCursorChange(value, option);
        }}
      />
      {comingSoonMsg !== '' && <Text {...tone('warning')}>{comingSoonMsg}</Text>}
      {nav.dialog}
    </ScreenLayout>
  );
}
