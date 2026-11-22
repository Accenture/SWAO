// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment app-picker stage (#2373)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React from 'react';
import { Box, Text } from 'ink';
import { SelectInput, PICKER_VISIBLE_COUNT, tone, useOptionGuidance } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import type { GuidanceEntry, KeyHint } from '@swao/tui-kit';
import type { EligibleApp, UnavailableApp } from '../types.js';

/** #4242: "2026-11-09T14-08-36" -> "2026-11-09 14:08 UTC" (run folders are UTC timestamps). */
export function runLabel(runTs: string): string {
  const m = runTs.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]} UTC` : runTs;
}

/** #4242: picker label naming the suite run and its pass count. */
export function appOptionLabel(a: EligibleApp, defaultAppId?: string): string {
  const suite = a.suiteRun
    ? `${a.suiteRun.passCount} passes, Application Assessment ${runLabel(a.suiteRun.runTs)}${(a.applicationRunCount ?? 1) > 1 ? `, newest of ${a.applicationRunCount} application runs` : ''}`
    : `${a.passCount} passes`;
  return `${a.id}  (${suite})${a.id === defaultAppId ? '  (default)' : ''}`;
}

/** #4255 (TUI-11): key hints of the LLM app picker (Design 126 section 7.9). */
export const LLM_APP_PICKER_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: 'Type', verb: 'filter' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'abort' },
];

/** #4255: the only key of the dead end without an eligible app: Esc leaves the flow. */
export const LLM_NO_APPS_KEYS: readonly KeyHint[] = [{ key: 'Esc', verb: 'abort' }];

/** #4230 / #4255: the guidance of the picker step (section 9), shown until an option is highlighted. */
export const LLM_APP_PICKER_GUIDANCE: GuidanceEntry = {
  title: 'Select the application',
  what: 'Select the application whose pass suite benchmarks your LLM connectors. SWAO runs the same pass suite through each connector you add in the next step and compares the results.',
  sections: [
    { label: 'Requirement', text: 'The application has at least one completed Application Assessment run; apps without one are listed under the picker with the reason.' },
    { label: 'Preselected', text: 'The app stored by the LLM setup is listed first and marked (default).' },
    { label: 'Next step', text: 'Add the LLM connectors to compare.' },
  ],
  cli: 'swao assess --type llm --app <id>',
};

/** #4230: the guidance of one highlighted app: which suite run the benchmark replays. */
export function llmAppGuidance(a: EligibleApp, defaultAppId?: string): GuidanceEntry {
  const run = a.suiteRun
    ? `The benchmark replays the ${a.suiteRun.passCount} passes of the Application Assessment run of ${runLabel(a.suiteRun.runTs)}${(a.applicationRunCount ?? 1) > 1 ? `, the newest of ${a.applicationRunCount} application runs` : ''}.`
    : `The benchmark replays the ${a.passCount} passes of the newest Application Assessment run.`;
  return {
    title: a.id,
    what: `${run} Each LLM connector you add next runs this same suite, so the results compare like with like.`,
    sections: [
      ...(a.id === defaultAppId ? [{ label: 'Preselected', text: 'The LLM setup stored this app as the subject of the LLM Assessment.' }] : []),
      { label: 'Next step', text: 'Add the LLM connectors to compare.' },
    ],
    cli: `swao assess --type llm --app ${a.id}`,
  };
}

/** Unavailable apps listed under the picker (the rest are counted). */
const MAX_UNAVAILABLE_LINES = 8;

export interface AppPickerStageProps {
  eligibleApps: EligibleApp[];
  /** #4242: apps without a completed Application Assessment run, with the reason. */
  unavailableApps?: UnavailableApp[];
  noApps: boolean;
  /** #4198: the app stored by the LLM setup branch; listed first and marked. */
  defaultAppId?: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onSelect: (appId: string) => void;
}

export function AppPickerStage({
  eligibleApps,
  unavailableApps = [],
  noApps,
  defaultAppId,
  onGuidanceOpenChange,
  onSelect,
}: AppPickerStageProps): React.JSX.Element {
  const { entry, onCursorChange } = useOptionGuidance(LLM_APP_PICKER_GUIDANCE);
  const unavailableBlock = unavailableApps.length > 0 ? (
    <Box flexDirection="column" marginTop={1}>
      <Text {...tone('muted')}>{`Not available (${unavailableApps.length}): no completed Application Assessment run`}</Text>
      {unavailableApps.slice(0, MAX_UNAVAILABLE_LINES).map((u) => (
        <Text key={u.id} {...tone('muted')} wrap="truncate-end">{`  ${u.id}: ${u.reason}`}</Text>
      ))}
      {unavailableApps.length > MAX_UNAVAILABLE_LINES && (
        <Text {...tone('muted')}>{`  and ${unavailableApps.length - MAX_UNAVAILABLE_LINES} more`}</Text>
      )}
    </Box>
  ) : null;

  if (noApps) {
    return (
      <LlmStageFrame
        keys={LLM_NO_APPS_KEYS}
        guidance={{
          title: 'LLM Assessment: no eligible app',
          what: "The LLM Assessment compares how different LLM connectors perform on your application's pass suite. You need at least one completed Application Assessment run before you can run LLM Assessment.",
          sections: [{ label: 'Next step', text: 'Run the Application Assessment of an app, then return here.' }],
          cli: 'swao assess --app <id>',
        }}
        onGuidanceOpenChange={onGuidanceOpenChange}
      >
        <Box flexDirection="column">
          <Text {...tone('warning')}>No eligible applications found.</Text>
          <Text>Complete the Application Assessment of at least one app first; the guidance names the command.</Text>
          {unavailableBlock}
        </Box>
      </LlmStageFrame>
    );
  }

  return (
    <LlmStageFrame keys={LLM_APP_PICKER_KEYS} guidance={entry} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      <SelectInput
        label="Select application to assess"
        options={eligibleApps.map((a) => ({
          label: appOptionLabel(a, defaultAppId),
          value: a.id,
          guidance: llmAppGuidance(a, defaultAppId),
        }))}
        onSelect={onSelect}
        onCursorChange={onCursorChange}
        visibleCount={PICKER_VISIBLE_COUNT}
        filter
        itemNoun="apps"
        showKeyHints={false}
        active
      />
      {unavailableBlock}
    </Box>
    </LlmStageFrame>
  );
}
