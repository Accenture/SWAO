// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the fixed screen anatomy (Design 126 section 3)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4248 (TUI-04): every screen renders the blocks of section 3 in this order,
// so the order is enforced by construction (gate G-07,
// tui-layout-order.test.tsx):
//
//   1 header, 2 licence line (HeaderView), 3 step bar, 4 step title,
//   5 and 6 content and result (children), 7 key hints, 8 guidance box,
//   9 frame footer.
//
// One left margin for all blocks (no outer indent). The key hints sit
// directly above the guidance box (no blank line between them, M-09, F-01).
// The licence line shows on every screen except Chat (Q-07 decided), so the
// header props carry no hideLicenseStatus; only `chat` hides it. A block is
// absent when its prop is absent; the order never changes.

import { useRef, type ReactNode } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { tone } from '../theme.js';
import { HeaderView, type HeaderViewProps } from './HeaderView.js';
import { StepBar, fitStepBar } from './StepBar.js';
import { StepTitle, type StepTitleProps } from './StepTitle.js';
import { KeyHints, type KeyHint } from './KeyHints.js';
import { GuidanceBox, countWrappedLines, type GuidanceBoxProps } from './GuidanceBox.js';
import { useHeaderWidth } from './header-width.js';
import { GUIDANCE_COLLAPSED_ROWS, ListBudgetContext, useListBudgetFrame } from './list-window.js';

export interface ScreenLayoutProps {
  /** Blocks 1 and 2. */
  header: Omit<HeaderViewProps, 'hideLicenseStatus'>;
  /** The Chat screen only: hides the licence line (Q-07). */
  chat?: boolean;
  /** Block 3: step bar of a flow with more than one step; fitted to the header rule unless `gap` is given. */
  steps?: { labels: string[]; current: number; gap?: number };
  /** Block 4. */
  title?: StepTitleProps;
  /** Blocks 5 and 6. */
  children?: ReactNode;
  /** Block 7: the compact key hint line. */
  keys: readonly KeyHint[];
  /** Block 8; null only on Help (#2347). Its keys section defaults to `keys`. Its height is
   *  bounded by the rows left under blocks 1 to 7 (#4250, section 9.5) unless `maxRows` is given. */
  guidance: Omit<GuidanceBoxProps, 'marginTop'> | null;
  /** Block 9: optional dim line; never repeats the key hints (section 7.9). */
  footer?: string;
}

/** The section 3 block names in their fixed order (for the G-07 checks). */
export const SCREEN_BLOCKS = ['header', 'licence', 'steps', 'title', 'content', 'keys', 'guidance', 'footer'] as const;

export function ScreenLayout({ header, chat = false, steps, title, children, keys, guidance, footer }: ScreenLayoutProps): JSX.Element {
  const width = useHeaderWidth();
  // Block 3 only for a flow with more than one step; fitted to the rule (M-02).
  const bar = steps && steps.labels.length > 1
    ? (steps.gap !== undefined ? { labels: steps.labels, gap: steps.gap, bulletGap: 1 } : fitStepBar(steps.labels, steps.current, width))
    : null;
  // #4250 (section 9.5): the guidance box gets the rows left under blocks 1 to 7
  // and above the footer, measured after layout, so it is never cut at the
  // window bottom. Unknown terminal height: no bound (tests without a terminal).
  const aboveRef = useRef<DOMElement>(null);
  const footerRows = footer ? countWrappedLines(footer, width) : 0;
  // #4348: a paged list in the content gets the rows left after the measured
  // chrome, the collapsed guidance box and the footer (useListBudget); the
  // measurement is the shared one of ListBudgetScope.
  const below = (guidance ? GUIDANCE_COLLAPSED_ROWS : 0) + footerRows;
  const budgetFrame = useListBudgetFrame(aboveRef, below);
  const { frameRows, above } = budgetFrame;
  const maxRows = guidance?.maxRows ?? (frameRows !== undefined && above !== undefined ? Math.max(0, frameRows - above - footerRows) : undefined);
  return (
    <Box flexDirection="column" width={width}>
      <Box ref={aboveRef} flexDirection="column" flexShrink={0}>
        <HeaderView {...header} hideLicenseStatus={chat} />
        {bar && steps && <StepBar steps={bar.labels} currentIndex={steps.current} gap={bar.gap} bulletGap={bar.bulletGap} />}
        {title && <StepTitle {...title} />}
        {children !== undefined && children !== null && (
          <Box flexDirection="column" marginTop={title ? 1 : 0}>
            <ListBudgetContext.Provider value={budgetFrame}>{children}</ListBudgetContext.Provider>
          </Box>
        )}
        <Box marginTop={1}>
          <KeyHints hints={keys} />
        </Box>
      </Box>
      {guidance && <GuidanceBox keys={keys} {...guidance} maxRows={maxRows} marginTop={0} />}
      {footer && <Text {...tone('muted')} wrap="wrap">{footer}</Text>}
    </Box>
  );
}
