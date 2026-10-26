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

import { useState, useRef, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { GuidanceBox, isAllowed } from '@swao/tui-kit';
import type { LicenseStateView, LicenseTier } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { LicenseGuard } from '../../license/license-guard.js';
import { SWAO_LANDING_URL } from '../../branding.js';
import { ITEMS, MENU_INFO, type MenuItem, type MenuTarget } from './main-menu-items.js';

// #3476: menu data moved to main-menu-items.ts (plain module, shared with the MCP start prompt).
export type { MenuTarget } from './main-menu-items.js';

interface MainMenuProps {
  onSelect: (target: MenuTarget) => void;
  suggestedNext?: MenuTarget;
  /** #2579: cursor returns to this item when navigating back from a sub-screen. */
  lastVisited?: MenuTarget;
  /** ESC navigates back to the Assessment Type screen when provided. */
  onBack?: () => void;
  /** Called when a tier-gated item is activated without sufficient licence. */
  onUpgradeNeeded?: (feature: string, tier: Exclude<LicenseTier, 'community'>, description: string) => void;
}

export function MainMenu({ onSelect, suggestedNext, lastVisited, onBack, onUpgradeNeeded }: MainMenuProps) {
  const { exit } = useApp();

  // Load licence state once (same pattern as LzCatalogueUpdateScreen).
  const licenseState = useMemo<LicenseStateView>(() => {
    try {
      return LicenseGuard.load().state as LicenseStateView;
    } catch {
      return { tier: 'community', assessmentCount: 0, firstRun: '' };
    }
  }, []);

  // #2579: restore cursor to lastVisited when returning from a sub-screen;
  // fall back to suggestedNext for initial entry (virgin session).
  const initialIdx = lastVisited
    ? Math.max(0, ITEMS.findIndex(it => it.target === lastVisited))
    : suggestedNext
    ? Math.max(0, ITEMS.findIndex(it => it.target === suggestedNext))
    : 0;

  const [idx, setIdx] = useState(initialIdx);
  // #0248: once the operator has navigated (arrow keys or a shortcut
  // that lands them on a row other than the suggested one), suppress
  // the green "suggested next" hint. Its purpose was to nudge; once
  // the operator has chosen otherwise, the nudge has served its
  // purpose and the visual clutter should go away.
  const [hasNavigated, setHasNavigated] = useState(false);
  // Inline message for comingSoon items activated by Enterprise users (#2312).
  const [comingSoonMsg, setComingSoonMsg] = useState('');
  // #0813: guard prevents Escape/Enter from navigating away while guidance is open.
  const guidanceOpenRef = useRef(false);
  // #0816: useRef mirrors the stale-closure fix from SelectInput #0805. Ink
  // re-registers useInput on every render; the old handler can fire with a
  // stale idx during screen transitions. Refs always hold the live value.
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const hasNavigatedRef = useRef(hasNavigated);
  hasNavigatedRef.current = hasNavigated;
  // Stable ref to licenseState to avoid stale closure in useInput.
  const licenseStateRef = useRef(licenseState);
  licenseStateRef.current = licenseState;

  /** Activate an item: enforce tier gate, then comingSoon gate, then route. */
  const activateItem = (item: MenuItem) => {
    if (item.tierRequired && !isAllowed(licenseStateRef.current, item.tierRequired)) {
      if (onUpgradeNeeded) onUpgradeNeeded(item.label, item.tierRequired, item.detail);
      return;
    }
    if (item.comingSoon) {
      setComingSoonMsg(`${item.label} is coming soon in a future release.`);
      return;
    }
    onSelect(item.target);
  };

  useInput((input, key) => {
    // #2304: Enter activates the highlighted item even when the GuidanceBox is
    // expanded. GuidanceBox closes itself on Enter; the parent handler must also
    // fire (per GuidanceBox #1412 intent) or the shell/menu item is never reached.
    if (guidanceOpenRef.current && !key.return && !key.upArrow && !key.downArrow) return;
    // Clear any inline coming-soon message on the next keypress.
    if (comingSoonMsg) setComingSoonMsg('');
    if (key.upArrow) {
      setIdx(i => Math.max(0, i - 1));
      setHasNavigated(true);
    }
    if (key.downArrow) {
      setIdx(i => Math.min(ITEMS.length - 1, i + 1));
      setHasNavigated(true);
    }
    if (key.return) {
      const item = ITEMS[idxRef.current];
      if (item) activateItem(item);
      return;
    }
    // ESC = back when onBack is provided; at top level ESC does nothing (#2554: no silent exit).
    // Use 0 (or the Exit item) to exit SWAO from the main menu.
    if (key.escape) { if (onBack) { onBack(); } return; }
    if (input === '0') { exit(); return; }

    const shortcut = ITEMS.find(it => it.key === input);
    if (shortcut) {
      if (shortcut.target !== suggestedNext) setHasNavigated(true);
      activateItem(shortcut);
    }
  });

  const activeItem = ITEMS[idx];
  const info = activeItem ? MENU_INFO[activeItem.target] : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Main Menu" />
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map((item, i) => {
          const active = i === idx;
          const tierBlocked = !!item.tierRequired && !isAllowed(licenseState, item.tierRequired);
          // #2615: never highlight a tier-gated item as "suggested next" on a lower tier.
          const isSuggested =
            suggestedNext && item.target === suggestedNext && !active && !hasNavigated && !tierBlocked;
          // #2605: tier-gated items remain fully visible (badge signals the gate);
          // only items truly unavailable to all tiers (comingSoon without a tier
          // requirement) are dimmed so the visual treatment is consistent across
          // MainMenu and ToolsMenu.
          const comingSoonOnly = !!item.comingSoon && !tierBlocked;
          return (
            <Box key={item.key}>
              <Text
                color={comingSoonOnly ? undefined : (active ? 'cyan' : isSuggested ? 'green' : undefined)}
                bold={active && !comingSoonOnly}
                dimColor={comingSoonOnly}
              >
                {active ? ' ❯ ' : '   '}
                {item.key}{'  '}{item.label}
              </Text>
              {/* #2560: all tier badges use yellow so they are visually consistent */}
              {tierBlocked && (
                <Text color="yellow">
                  {'  '}{item.tierRequired === 'enterprise' ? '[Enterprise]' : '[Consultant+]'}
                </Text>
              )}
              {item.comingSoon && !tierBlocked && <Text dimColor>{'  [Coming soon]'}</Text>}
              <Text dimColor>{'  '}{item.detail}</Text>
              {isSuggested && <Text color="green" dimColor>  {'<-'} suggested next</Text>}
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>   0  Exit</Text>
        </Box>
      </Box>

      {comingSoonMsg && (
        <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">{comingSoonMsg}</Text>
        </Box>
      )}

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
        <Text dimColor>Arrow keys or number to select   Enter to open   0 to exit</Text>
      </Box>
      <Box>
        <Text><Text dimColor>Further information: </Text><Text bold color="cyanBright">{SWAO_LANDING_URL}</Text></Text>
      </Box>
    </Box>
  );
}
