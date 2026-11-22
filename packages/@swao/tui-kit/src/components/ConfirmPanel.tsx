// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, confirmation panel (mockup M-11)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4251 (TUI-07, Design 126 section 4.4, mockup M-11): one confirmation for
// every flow (#4235 rule 9). A title, one purpose line, an aligned summary
// block of DetailRows (what runs, on what, how long) and an optional risk
// line in words (Design 120: the CLI flag is named only in the guidance).
//
// The panel is content of ScreenLayout: the screen passes CONFIRM_PANEL_KEYS
// as its key hints (block 7), so the hints are not drawn twice. Key owners:
// Enter is the panel's; the left arrow is the flow's (useFlowNavigation) and
// the panel reads it only when `onBack` is given (a confirmation outside a
// step flow); Esc is never the panel's (section 7.5).

import { useCallback, useRef } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { tone } from '../theme.js';
import { DetailRow, ROW_INDENT, type DetailRowProps } from './StatusLabel.js';
import { StepTitle } from './StepTitle.js';
import { KEY_HINTS, type KeyHint } from './KeyHints.js';
import { useHeaderWidth } from './header-width.js';
import { wrapWords } from './run-output.js';

/** Label column of the summary blocks of ConfirmPanel and FinishPanel (M-11, M-13: values at column 15). */
export const PANEL_LABEL_WIDTH = 12;

/** The key hints of a confirmation screen (section 7.9): `Enter confirm   ← back   Esc abort`. */
export const CONFIRM_PANEL_KEYS: readonly KeyHint[] = KEY_HINTS.confirm;

/** Label column for a block of rows: at least PANEL_LABEL_WIDTH, two spaces after the longest label. */
export function panelLabelWidth(labels: readonly string[]): number {
  return Math.max(PANEL_LABEL_WIDTH, ...labels.map((l) => l.length + 2));
}

/** The aligned DetailRow block shared by ConfirmPanel and FinishPanel. */
export function SummaryBlock({ rows, extraLabels = [] }: { rows: readonly DetailRowProps[]; extraLabels?: readonly string[] }): JSX.Element {
  const labelWidth = panelLabelWidth([...rows.map((r) => r.label), ...extraLabels]);
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => <DetailRow key={`${r.label}-${i}`} {...r} labelWidth={r.labelWidth ?? labelWidth} />)}
    </Box>
  );
}

export interface ConfirmPanelProps {
  /** What starts ("Start the Service Portfolio Assessment"). */
  title: string;
  /** One purpose line under the title. */
  subtitle?: string;
  /** The summary block: what will run, on what, estimated duration. */
  rows: DetailRowProps[];
  /** A risk the operator accepts, in words (`warning`); never a CLI flag. */
  risk?: string;
  /** Enter. */
  onConfirm(): void;
  /** Left arrow; give it only when no useFlowNavigation owns the left arrow. */
  onBack?(): void;
  /** Keys are read only while active (default true); false while a dialog is open. */
  active?: boolean;
}

export function ConfirmPanel({ title, subtitle, rows, risk, onConfirm, onBack, active = true }: ConfirmPanelProps): JSX.Element {
  const width = useHeaderWidth();
  const cb = useRef({ onConfirm, onBack });
  cb.current = { onConfirm, onBack };
  useInput(useCallback((_input: string, key: Key) => {
    if (key.return) cb.current.onConfirm();
    else if (key.leftArrow) cb.current.onBack?.();
  }, []), { isActive: active });
  const riskLabel = 'Risk:';
  const labelWidth = panelLabelWidth([...rows.map((r) => r.label), riskLabel]);
  return (
    <Box flexDirection="column" width={width}>
      <StepTitle title={title} {...(subtitle !== undefined ? { subtitle } : {})} />
      <Box flexDirection="column" marginTop={1}>
        <SummaryBlock rows={rows} extraLabels={risk ? [riskLabel] : []} />
        {risk && (
          <Box width={width}>
            <Box width={ROW_INDENT} />
            <Box width={labelWidth}><Text {...tone('warning')}>{riskLabel}</Text></Box>
            <Box width={Math.max(1, width - ROW_INDENT - labelWidth)} flexDirection="column">
              {wrapWords(risk, width - ROW_INDENT - labelWidth).map((l, i) => (
                <Text key={i} {...tone('warning')} wrap="wrap">{l}</Text>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
