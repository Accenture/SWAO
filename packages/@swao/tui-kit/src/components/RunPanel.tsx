// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, run panel and stage progress (mockup M-12)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4252 (TUI-08, Design 126 sections 4.6 and 7.6, mockup M-12, F-02): the
// run screen content. StageProgress draws each bar with its percentage on
// one line and puts label, timer and ETA on their own line under it, so no
// bracket or timer wraps (#4237 a); the stage percentage includes the share
// of items done (#4237 b). The output section has a level 2 title "Output";
// every line passes runOutputLine() (dash normalisation, rule 11; user
// paths as %LOCALAPPDATA%, rule 4) and wraps with a hanging indent.
//
// Esc cancel (section 7.6, Q-09 decided): a long run (assessment, research,
// refresh) asks with the AbortDialog first; a short one (probe, health
// check; `confirmCancel={false}`) cancels at once. Cancelling aborts the
// run's AbortController when the run exposes one (the LLM Assessment
// orchestrator marks the run folder `cancelled`, #4243) and calls
// `onCancel`, where the screen returns to the step that started the run.
// The panel owns Esc while the run is shown; an open guidance box takes
// Esc first (`guidanceOpen`). The screen passes RUN_PANEL_KEYS to ScreenLayout.

import { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { tone } from '../theme.js';
import { StepTitle } from './StepTitle.js';
import { AbortDialog } from './AbortDialog.js';
import { KEY_HINTS, type KeyHint } from './KeyHints.js';
import { ROW_INDENT } from './StatusLabel.js';
import { useHeaderWidth } from './header-width.js';
import { formatElapsed, formatEta, hangingPrefix, runOutputLine, stagePercent, wrapWords } from './run-output.js';

/** The key hints of a run screen (section 7.9): `Esc cancel` only. */
export const RUN_PANEL_KEYS: readonly KeyHint[] = KEY_HINTS.run;

/** Label column of the bars ("Stage", "Apps"; M-12). */
export const PROGRESS_LABEL_WIDTH = 8;
const PERCENT_WIDTH = 6; // two blanks and up to "100%", as drawn in M-12

export interface StageProgressProps {
  /** Current stage, 1-based. */
  stage: number;
  stages: number;
  /** Name of the current stage ("Research"), on the timer line. */
  label: string;
  /**
   * #4472: what the current stage is ("LLM Providers"), in the subtitle
   * "Stage 1 of 2: LLM Providers.". Without it the subtitle reads "Stage 1 of 2.".
   */
  stageName?: string;
  /**
   * #4472: progress within the current stage, 0..1, for the Stage bar when it
   * moves with finer steps than the item bar (passes of the running leg).
   * Default: itemsDone / itemsTotal.
   */
  stageShare?: number;
  /** Items done and total within the current stage (apps, passes). */
  itemsDone?: number;
  itemsTotal?: number;
  /** Label of the item bar ("Apps"); without it there is no item bar. */
  itemsLabel?: string;
  /** What the items are, for the count line ("apps": "188 of 234 apps"). */
  itemsNoun?: string;
  elapsedMs: number;
  etaMs?: number;
}

function Bar({ label, pct, width }: { label: string; pct: number; width: number }): JSX.Element {
  const barWidth = Math.max(4, width - ROW_INDENT - PROGRESS_LABEL_WIDTH - 2 - PERCENT_WIDTH);
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * barWidth);
  return (
    <Box>
      <Box width={ROW_INDENT} />
      <Box width={PROGRESS_LABEL_WIDTH}><Text {...tone('muted')}>{label}</Text></Box>
      <Text {...tone(pct >= 100 ? 'progressDone' : 'progressRunning')}>{`[${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}]`}</Text>
      <Text {...tone('text')}>{`  ${pct}%`}</Text>
    </Box>
  );
}

function SubLine({ children, width }: { children: JSX.Element | JSX.Element[]; width: number }): JSX.Element {
  return (
    <Box>
      <Box width={ROW_INDENT + PROGRESS_LABEL_WIDTH} />
      <Box width={Math.max(1, width - ROW_INDENT - PROGRESS_LABEL_WIDTH)}><Text wrap="wrap">{children}</Text></Box>
    </Box>
  );
}

/** The stage bar and the optional item bar, each with its line of words under it (M-12). */
export function StageProgress(p: StageProgressProps): JSX.Element {
  const width = useHeaderWidth();
  const pct = stagePercent(p.stage, p.stages, p.itemsDone, p.itemsTotal, p.stageShare);
  const hasItems = p.itemsLabel !== undefined && p.itemsTotal !== undefined && p.itemsTotal > 0;
  const itemPct = hasItems ? Math.floor(((p.itemsDone ?? 0) / p.itemsTotal!) * 100) : 0;
  const timer = `elapsed ${formatElapsed(p.elapsedMs)}${p.etaMs !== undefined ? `   ETA ${formatEta(p.etaMs)}` : ''}`;
  return (
    <Box flexDirection="column" width={width}>
      <Bar label="Stage" pct={pct} width={width} />
      <SubLine width={width}>
        <Text {...tone('text')}>{p.label}</Text>
        <Text {...tone('muted')}>{`   ${timer}`}</Text>
      </SubLine>
      {hasItems && <Bar label={p.itemsLabel!} pct={itemPct} width={width} />}
      {hasItems && (
        <SubLine width={width}>
          <Text {...tone('muted')}>{`${p.itemsDone ?? 0} of ${p.itemsTotal}${p.itemsNoun ? ` ${p.itemsNoun}` : ''}`}</Text>
        </SubLine>
      )}
    </Box>
  );
}

export interface RunOutputProps {
  lines: readonly string[];
  /** Last lines shown; default 8. */
  maxLines?: number;
  /** Environment for the path shortening; default process.env (tests inject one). */
  env?: Readonly<Record<string, string | undefined>>;
}

/** The titled output section: normalised lines, wrapped with a hanging indent, never cut. */
export function RunOutput({ lines, maxLines = 8, env }: RunOutputProps): JSX.Element {
  const width = useHeaderWidth();
  const shown = lines.slice(-maxLines).map((l) => runOutputLine(l, env));
  return (
    <Box flexDirection="column" width={width}>
      <StepTitle title="Output" level={2} />
      {shown.map((line, i) => {
        const prefix = hangingPrefix(line);
        const lead = prefix ?? '';
        const rest = prefix ? line.slice(prefix.length) : line;
        return (
          <Box key={i}>
            <Box width={ROW_INDENT} />
            {prefix && <Box width={lead.length} flexShrink={0}><Text {...tone('text')}>{lead}</Text></Box>}
            <Box width={Math.max(1, width - ROW_INDENT - lead.length)} flexDirection="column">
              {wrapWords(rest, width - ROW_INDENT - lead.length).map((part, j) => (
                <Text key={j} {...tone('text')} wrap="wrap">{part}</Text>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export interface RunPanelProps {
  /** What the run does ("Researching all 234 apps to rank the top 10"). */
  title: string;
  progress: StageProgressProps;
  /** Run output, oldest first. */
  lines: readonly string[];
  maxLines?: number;
  /** Called once when the run is cancelled; return to the step that started the run. */
  onCancel(): void;
  /** The run's AbortController, aborted on cancel (the orchestrator marks the run cancelled). */
  abort?: AbortController;
  /** Ask before cancelling (assessment, research, refresh; default); false cancels at once (probe, health check). */
  confirmCancel?: boolean;
  /** True while the guidance box is open: Esc closes the box first. */
  guidanceOpen?: boolean;
  /** Keys are read only while active (default true). */
  active?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

export function RunPanel({ title, progress, lines, maxLines, onCancel, abort, confirmCancel = true, guidanceOpen = false, active = true, env }: RunPanelProps): JSX.Element {
  const width = useHeaderWidth();
  const [asking, setAsking] = useState(false);
  const live = useRef({ onCancel, abort, confirmCancel, guidanceOpen, asking, done: false });
  live.current = { ...live.current, onCancel, abort, confirmCancel, guidanceOpen, asking };

  const cancel = useCallback((): void => {
    if (live.current.done) return;
    live.current.done = true;
    setAsking(false);
    live.current.abort?.abort();
    live.current.onCancel();
  }, []);

  useInput(useCallback((_input: string, key: Key) => {
    const s = live.current;
    if (!key.escape || s.asking || s.guidanceOpen || s.done) return;
    if (s.confirmCancel) setAsking(true);
    else cancel();
  }, [cancel]), { isActive: active });

  return (
    <Box flexDirection="column" width={width}>
      <StepTitle title={title} subtitle={`Stage ${progress.stage} of ${progress.stages}${progress.stageName ? `: ${progress.stageName}` : ''}.`} />
      <Box marginTop={1}><StageProgress {...progress} /></Box>
      {asking && (
        <Box marginTop={1}>
          <AbortDialog what="run" onAbort={cancel} onStay={() => setAsking(false)} active={active} />
        </Box>
      )}
      <Box marginTop={1}><RunOutput lines={lines} {...(maxLines !== undefined ? { maxLines } : {})} {...(env ? { env } : {})} /></Box>
    </Box>
  );
}
