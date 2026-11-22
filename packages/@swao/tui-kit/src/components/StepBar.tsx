// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { Box, Text } from 'ink';
import { tone } from '../theme.js';

interface StepBarProps {
  steps: string[];
  currentIndex: number;
  /** Columns after each entry (default 2). A caller fitting the bar to the header rule may pass 1 (#4110). */
  gap?: number;
  /** Columns between bullet and label (default 1; the wide bar of mockup M-02 uses 2). */
  bulletGap?: number;
}

export function StepBar({ steps, currentIndex, gap = 2, bulletGap = 1 }: StepBarProps): JSX.Element {
  const pad = ' '.repeat(Math.max(1, bulletGap));
  return (
    <Box marginBottom={1}>
      {steps.map((label, i) => {
        const done    = i < currentIndex;
        const active  = i === currentIndex;
        const bullet  = done ? '●' : active ? '●' : '○';
        const style   = tone(done ? 'ok' : active ? 'selection' : 'muted');
        // Keyed by position: a fitted bar may shorten labels to the same text
        // or to nothing (bullet only).
        return (
          <Box key={i} marginRight={i < steps.length - 1 ? gap : 0}>
            <Text {...style}>{label ? `${bullet}${pad}${label}` : bullet}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** A step bar ready to render: the labels, the columns after each entry and between bullet and label. */
export interface StepBarLayout {
  labels: string[];
  gap: number;
  bulletGap: number;
}

/** Rendered width of a step bar (as StepBar renders it, no gap after the last entry). */
export function stepBarWidth(labels: readonly string[], gap: number, bulletGap = 1): number {
  return labels.reduce((w, l) => w + (l ? 1 + bulletGap + l.length : 1), 0) + gap * Math.max(0, labels.length - 1);
}

/**
 * #4248 (Design 126 mockup M-02): fits the step bar into `width` columns (the
 * header rule, #4110) for ScreenLayout, without an ellipsis (section 8 rule 5):
 * 1. wide: two spaces after the bullet, three between entries;
 * 2. compact: one space after the bullet, two between entries;
 * 3. compact with the labels other than the current one shortened to their
 *    first word ("Source access" becomes "Source"), then with gap 1;
 * 4. bullets only for the other steps (the 63-column minimum).
 * The current label stays whole. The setup engine keeps its own fitStepBar
 * (swao/src/setup/plan.ts) until #4254 moves the wizard to ScreenLayout.
 */
export function fitStepBar(labels: readonly string[], currentIndex: number, width: number): StepBarLayout {
  const all = [...labels];
  if (stepBarWidth(all, 3, 2) <= width) return { labels: all, gap: 3, bulletGap: 2 };
  if (stepBarWidth(all, 2) <= width) return { labels: all, gap: 2, bulletGap: 1 };
  const short = labels.map((l, i) => (i === currentIndex ? l : (l.split(' ')[0] ?? l)));
  if (stepBarWidth(short, 2) <= width) return { labels: short, gap: 2, bulletGap: 1 };
  if (stepBarWidth(short, 1) <= width) return { labels: short, gap: 1, bulletGap: 1 };
  return { labels: labels.map((l, i) => (i === currentIndex ? l : '')), gap: 1, bulletGap: 1 };
}
