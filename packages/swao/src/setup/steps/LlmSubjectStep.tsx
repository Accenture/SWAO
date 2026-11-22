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

// #4196 SET-07 (Design 125 section 5.6, Q-05): Subject step of the LLM
// branch. Only apps with a completed Application Assessment run can be the
// subject (the LLM Assessment gate checkAppAssessmentPrecondition). Without
// one, the step points to the Application branch in plain words. The choice
// is stored as assessment.llm.subject_app; the stored subject, or a single
// eligible app, is preselected.
//
// #4254 / #4341 (Design 126 sections 4.5, 7.7 and 9): the frame comes from the
// wizard (SetupStepFrame, picker keys). Keeping the stored subject, skipping
// or continuing without an eligible app is the last list entry, never Esc;
// Esc belongs to the wizard. The guidance follows the highlighted app.

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PICKER_VISIBLE_COUNT, SelectInput, fitToWidth, tone, useHeaderWidth, type GuidanceEntry, type GuidanceSection, type SelectOption } from '@swao/tui-kit';
import { logPortfolio, serviceAppsNoteText } from '@swao/core';
import { readApplicationDefaults, readLlmDefaults } from '../defaults.js';
import { listSubjectApps, preselectedSubject, subjectReasonText, writeAssessmentLlm } from '../llm-values.js';
import type { SetupStepProps } from '../types.js';
import { SetupStepFrame } from '../setup-frame.js';
import { ActionRows, StatusRows, moveCursor } from './step-ui.js';

export const NO_SUBJECT_TEXT = 'No app has a completed Application Assessment yet. Set up the Application Assessment, run it once, then return to this step.';

const SUBJECT_WHAT = 'The LLM Assessment repeats the passes of this app\'s Application Assessment with each candidate and compares the results with that run.';
const SUBJECT_SECTIONS: readonly GuidanceSection[] = [
  { label: 'Requirement', text: 'At least one completed Application Assessment run of the app (owner decision Q-05). Apps without one are listed but cannot be chosen.' },
  { label: 'Application branch', text: 'Main menu, Setup, Set up an assessment type, Application Assessment: add the app and its source, then run the Application Assessment.' },
  { label: 'Saved as', text: 'assessment.llm.subject_app in the workspace .swao.yml; the LLM Assessment preselects it.' },
];

/** #4341: the last list entry: keep the stored subject, skip, or continue without an eligible app. */
export function subjectKeepLabel(eligibleCount: number, stored: string | undefined): string {
  if (eligibleCount === 0) return 'Continue';
  return stored ? `Keep ${stored} and continue` : 'Skip this step';
}

/** #4230: the guidance of the highlighted row: an eligible app, or the keep entry after the apps. */
export function subjectGuidance(highlighted: { appId: string; latestRun?: string | null } | undefined, eligibleCount: number, keepLabel: string, stored: string | undefined): GuidanceEntry {
  if (highlighted) return { title: `Assessed app ${highlighted.appId}`, what: `${SUBJECT_WHAT} Last completed run: ${highlighted.latestRun ?? 'unknown'}.`, sections: SUBJECT_SECTIONS };
  if (eligibleCount === 0) return { title: 'Assessed app', what: NO_SUBJECT_TEXT, sections: SUBJECT_SECTIONS };
  return { title: keepLabel, what: stored ? `Continues with ${stored}; nothing is written.` : 'Continues without an assessed app; the LLM Assessment asks for one when it starts.', sections: SUBJECT_SECTIONS };
}

/** #4490: above this many apps the step is a paged list with type-to-filter (Design 126 section 7.13). */
export const SUBJECT_ROWS_MAX = 8;
const SUBJECT_KEEP_VALUE = '__keep__';

export function LlmSubjectStep({ ctx, onNext }: SetupStepProps) {
  const ws = ctx.workspaceRoot;
  // #4490: application apps only (listSubjectApps reads readApplicationDefaults); the ready ones first.
  const [apps] = useState(() => listSubjectApps(ws));
  const [serviceNote] = useState(() => serviceAppsNoteText(readApplicationDefaults(ws).serviceApps));
  const [stored] = useState(() => readLlmDefaults(ws).subjectApp);
  const eligible = apps.filter((a) => a.eligible);
  const pre = preselectedSubject(apps, stored);
  const [cursor, setCursor] = useState(() => Math.max(0, eligible.findIndex((a) => a.appId === pre)));
  const [error, setError] = useState('');
  const width = useHeaderWidth();
  const keepIndex = eligible.length;
  const keepLabel = subjectKeepLabel(eligible.length, stored);
  const size = eligible.length + 1;

  const log = (status: string, subject: string | undefined): void => {
    try { logPortfolio('info', 'wizard.llm.subject.complete', 'Setup: LLM subject step complete', { context: { status, subject_app: subject ?? null, eligible_apps: eligible.length } }); } catch { /* best-effort */ }
  };

  const keep = (): void => {
    log('kept', stored);
    if (eligible.length === 0) { onNext({ status: 'skipped', summary: 'No app with a completed Application Assessment' }); return; }
    onNext(stored ? { status: 'kept', summary: `Assessed app: ${stored}` } : { status: 'skipped', summary: 'No assessed app chosen' });
  };

  const choose = (i: number): void => {
    if (i === keepIndex) { keep(); return; }
    const app = eligible[i];
    if (!app) return;
    if (app.appId !== stored) {
      try { writeAssessmentLlm(ws, { subjectApp: app.appId }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); return; }
    }
    log(app.appId === stored ? 'kept' : 'done', app.appId);
    onNext({ status: app.appId === stored ? 'kept' : 'done', summary: `Assessed app: ${app.appId}` });
  };

  const others = apps.filter((a) => !a.eligible);
  const paged = eligible.length + others.length > SUBJECT_ROWS_MAX;

  useInput((input, key) => {
    if (paged) return; // the SelectInput owns the keys
    if (moveCursor(key, size, setCursor)) return;
    if (key.return) { choose(cursor); return; }
    const n = Number.parseInt(input, 10);
    if (n >= 1 && n <= Math.min(9, size)) choose(n - 1);
  });

  const guidance = subjectGuidance(eligible[cursor], eligible.length, keepLabel, stored);
  const pagedOptions: SelectOption[] = [
    ...eligible.map((a): SelectOption => ({ label: a.appId, value: a.appId, detail: `${a.appId === stored ? 'current, ' : ''}last completed run ${a.latestRun ?? ''}`.trim(), group: 'Ready for the LLM Assessment', guidance: subjectGuidance(a, eligible.length, keepLabel, stored) })),
    { label: keepLabel, value: SUBJECT_KEEP_VALUE, group: 'Actions', guidance: subjectGuidance(undefined, eligible.length, keepLabel, stored) },
  ];
  return (
    <SetupStepFrame title="Assessed app" subtitle="The app the LLM comparison runs on; it needs a completed Application Assessment." kind="picker" guidance={guidance}>
      <Box flexDirection="column">
        {eligible.length === 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text {...tone('warning')}>{fitToWidth('No app is ready for the LLM Assessment.', width)}</Text>
            <Text>{fitToWidth('Set up the Application Assessment, run it once, then return here.', width)}</Text>
          </Box>
        )}
        {paged && (
          <SelectInput
            label="Assessed app"
            options={pagedOptions}
            visibleCount={PICKER_VISIBLE_COUNT}
            filter
            itemNoun="apps"
            showKeyHints={false}
            initialIndex={cursor}
            onCursorChange={(v) => { const i = eligible.findIndex((a) => a.appId === v); setCursor(i >= 0 ? i : keepIndex); }}
            onSelect={(v) => choose(v === SUBJECT_KEEP_VALUE ? keepIndex : eligible.findIndex((a) => a.appId === v))}
          />
        )}
        {paged && others.length > 0 && (
          <Text {...tone('muted')} wrap="wrap">{`${others.length} more ${others.length === 1 ? 'app has' : 'apps have'} no completed Application Assessment and cannot be chosen yet.`}</Text>
        )}
        {!paged && eligible.length > 0 && (
          <StatusRows
            cursor={cursor}
            rows={eligible.map((a) => ({ state: 'ok' as const, label: a.appId, text: `${a.appId === stored ? 'current, ' : ''}last completed run ${a.latestRun ?? ''}`.trim() }))}
          />
        )}
        {!paged && others.length > 0 && (
          <StatusRows rows={others.map((a) => ({ state: 'info' as const, label: a.appId, text: subjectReasonText(a.reason) }))} />
        )}
        {!paged && <ActionRows labels={[keepLabel]} cursor={cursor} offset={keepIndex} />}
        {serviceNote && <Text {...tone('muted')} wrap="wrap">{serviceNote}</Text>}
        {error && <Text {...tone('error')}>{fitToWidth(error, width)}</Text>}
      </Box>
    </SetupStepFrame>
  );
}
