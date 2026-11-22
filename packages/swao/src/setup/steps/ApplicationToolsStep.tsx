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

// #4192 SET-03 (Design 125 section 5.2): Tools step of the Application
// branch. Lists the scanners and IaC tools found on PATH, each with what it
// enables; the guidance of the selected tool says what is lost without it
// (setup/application-tools.ts). Nothing is installed; the scoped health
// check at the end of the branch verifies versions.
//
// #4254 / #4341 (Design 126 sections 4.5, 7.7 and 9): the frame comes from the
// wizard (SetupStepFrame, picker keys); "Check again" and "Continue" are the
// last list entries, Esc belongs to the wizard (AbortDialog); the guidance
// box follows the highlighted tool or entry.

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { fitToWidth, tone, useHeaderWidth, type GuidanceEntry } from '@swao/tui-kit';
import { logPortfolio } from '@swao/core';
import { APPLICATION_TOOL_GROUPS, detectApplicationTools, toolState, toolsSummary, type ApplicationToolStatus, type PathLookupOptions } from '../application-tools.js';
import type { SetupStepProps } from '../types.js';
import { SetupStepFrame } from '../setup-frame.js';
import { ActionRows, StatusRows, moveCursor } from './step-ui.js';

export const TOOLS_ACTIONS = ['Check again', 'Continue'] as const;

/** #4230: the guidance of one highlighted tool. */
export function toolGuidance(s: ApplicationToolStatus): GuidanceEntry {
  return {
    title: `${s.tool.name}: ${s.found ? 'found' : 'not found'}`,
    what: s.found ? `Enables: ${s.tool.enables}.` : `Without it: ${s.tool.without}`,
    sections: [
      { label: 'Enables', text: `${s.tool.enables}.` },
      { label: 'Without it', text: s.tool.without },
      { label: 'Checked by', text: `The ${s.tool.probe} probe of the Application health check, with the version.` },
      { label: 'Install', text: 'Install the tool with the package manager of this machine and make sure it is on PATH, then choose Check again.' },
    ],
  };
}

/** #4230: the guidance of the two action entries. */
export const TOOLS_ACTION_GUIDANCE: Readonly<Record<(typeof TOOLS_ACTIONS)[number], GuidanceEntry>> = {
  'Check again': { title: 'Check again', what: 'Looks for the tools on PATH again, for example after installing one in another terminal. Nothing is installed by SWAO.' },
  Continue: { title: 'Continue', what: 'Goes on to the health check of the Application Assessment, which runs the probes with version detection. Missing tools stay listed there.' },
};

export function ApplicationToolsStep(props: SetupStepProps & { lookup?: PathLookupOptions }) {
  const { onNext } = props;
  const [statuses, setStatuses] = useState<ApplicationToolStatus[]>(() => detectApplicationTools(props.lookup));
  const [cursor, setCursor] = useState(0);
  const width = useHeaderWidth();
  const size = statuses.length + TOOLS_ACTIONS.length;
  const recheckIndex = statuses.length;

  const finish = (): void => {
    const summary = toolsSummary(statuses);
    try {
      logPortfolio('info', 'wizard.application.tools.complete', 'Setup: tools step complete', {
        context: { found: statuses.filter((s) => s.found).map((s) => s.tool.name), missing: statuses.filter((s) => !s.found).map((s) => s.tool.name) },
      });
    } catch { /* best-effort */ }
    onNext({ status: 'kept', summary });
  };

  useInput((_input, key) => {
    if (moveCursor(key, size, setCursor)) return;
    if (!key.return) return;
    if (cursor === recheckIndex) { setStatuses(detectApplicationTools(props.lookup)); return; }
    finish();
  });

  const selected = statuses[cursor];
  const guidance = selected ? toolGuidance(selected) : TOOLS_ACTION_GUIDANCE[TOOLS_ACTIONS[cursor - statuses.length] ?? 'Continue'];
  const groups = (['scanner', 'code-health', 'iac'] as const).map((g) => ({ g, rows: statuses.map((s, i) => ({ s, i })).filter(({ s }) => s.tool.group === g) }));
  return (
    <SetupStepFrame title="Tools" subtitle="Security, code health and IaC tools on this machine, and what each one adds." kind="picker" guidance={guidance}>
      <Box flexDirection="column">
        {groups.map(({ g, rows }) => (
          <Box key={g} flexDirection="column">
            <Box marginTop={1}><Text bold>{APPLICATION_TOOL_GROUPS[g].label}</Text></Box>
            <StatusRows
              cursor={rows.findIndex(({ i }) => i === cursor)}
              rows={rows.map(({ s }) => ({ state: toolState(s), label: s.tool.name, text: s.found ? s.tool.enables : `not found: ${s.tool.enables}` }))}
            />
          </Box>
        ))}
        <ActionRows labels={TOOLS_ACTIONS} cursor={cursor} offset={statuses.length} />
        <Box marginTop={1}><Text {...tone('muted')}>{fitToWidth(toolsSummary(statuses), width)}</Text></Box>
      </Box>
    </SetupStepFrame>
  );
}
