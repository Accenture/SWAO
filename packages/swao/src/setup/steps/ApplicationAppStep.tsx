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

// #4192 SET-03 (Design 125 section 5.2): App step of the Application branch.
// Re-entry is idempotent (section 4): the current apps are shown and Enter
// keeps them; "Add an app" creates one the way the CLI init with an app name
// does (setup/application-app.ts createApplicationApp).
//
// #4254 / #4341 (Design 126 sections 4.5, 7.2, 7.7 and 9): the frame comes
// from the wizard (SetupStepFrame). The step opens on a numbered menu also
// without apps, so keeping or skipping is a visible entry ("Keep the current
// apps and continue", "Skip this step"), never Esc; Esc belongs to the wizard.
// The sub-steps (app id, source kind, source value) go back with Shift+Tab
// (and Left arrow on the source kind menu). The guidance follows the
// highlighted entry.

import { useState } from 'react';
import { Box, Text } from 'ink';
import { SelectInput, TextInput, fitToWidth, tone, useHeaderWidth, useOptionGuidance, type GuidanceEntry, type GuidanceSection, type SelectOption } from '@swao/tui-kit';
import { logPortfolio, serviceAppsNoteText } from '@swao/core';
import { readApplicationDefaults } from '../defaults.js';
import { appIdProblem, appSourceProblem, createApplicationApp, type AppSourceKind } from '../application-app.js';
import type { SetupStepProps } from '../types.js';
import { SetupStepFrame } from '../setup-frame.js';

type Phase = 'list' | 'id' | 'source-kind' | 'source-value';

export const APP_KEEP_CHOICE = 'Keep the current apps and continue';
export const APP_ADD_CHOICE = 'Add an app';
export const APP_SKIP_CHOICE = 'Skip this step';
/** The entries of the first menu: keep first when apps exist, else add first and skip last. */
export function appListChoices(hasApps: boolean): readonly string[] {
  return hasApps ? [APP_KEEP_CHOICE, APP_ADD_CHOICE] : [APP_ADD_CHOICE, APP_SKIP_CHOICE];
}
export const APP_SOURCE_CHOICES: ReadonlyArray<{ kind: AppSourceKind; label: string; help: string }> = [
  { kind: 'repository', label: 'Repository address', help: 'SWAO clones the repository before the assessment. The access token is checked in the next step.' },
  { kind: 'folder', label: 'Folder on this machine', help: 'SWAO reads the source code from the folder; nothing is cloned or copied.' },
  { kind: 'later', label: 'Set the source later', help: 'The app is created without a source; add it later in the app settings or in the Application Assessment.' },
];

const APP_WHAT = 'Each app has its own settings file under apps/<id>/. The Application Assessment preselects the apps added here; with one app it is chosen automatically.';
const APP_SECTIONS: readonly GuidanceSection[] = [
  { label: 'App id', text: 'Lower-case letters, digits, dash or underscore. It names the folder under apps/ and appears in reports.' },
  { label: 'Frameworks', text: 'A new app starts with the four demo compliance frameworks, as in the workspace initialisation. Change them in the Application Assessment.' },
  { label: 'Source', text: 'A repository address (cloned at assessment time), a folder on this machine, or none yet.' },
  { label: 'Applies to', text: 'Application Assessments. The LLM Assessment compares models on an app that has a completed Application Assessment.' },
];

/** #4230: the guidance of each entry of the first menu. */
export function appListGuidance(label: string, apps: readonly string[]): GuidanceEntry {
  if (label === APP_KEEP_CHOICE) return { title: label, what: `Continues with ${apps.join(', ')}; nothing is written.`, sections: APP_SECTIONS };
  if (label === APP_SKIP_CHOICE) return { title: label, what: 'Continues without an app. The Application Assessment asks for one when it starts, and this step can run again from Setup.', sections: APP_SECTIONS };
  return { title: label, what: `Asks for the app id, then for its source. ${APP_WHAT}`, sections: APP_SECTIONS };
}

/** #4230: the guidance of each source kind. */
export function appSourceGuidance(c: (typeof APP_SOURCE_CHOICES)[number]): GuidanceEntry {
  return { title: c.label, what: c.help, sections: [APP_SECTIONS[2]!] };
}

export function ApplicationAppStep({ ctx, onNext }: SetupStepProps) {
  const ws = ctx.workspaceRoot;
  // #4490: application apps only; the service apps are counted in a note.
  const [{ apps, serviceApps }] = useState(() => readApplicationDefaults(ws));
  const serviceNote = serviceAppsNoteText(serviceApps);
  const [phase, setPhase] = useState<Phase>('list');
  const [appId, setAppId] = useState('');
  const [sourceKind, setSourceKind] = useState<AppSourceKind>('repository');
  const [error, setError] = useState('');
  const width = useHeaderWidth();
  const stepEntry: GuidanceEntry = { title: 'App', what: APP_WHAT, sections: APP_SECTIONS };
  const { entry: optionEntry, onCursorChange } = useOptionGuidance(stepEntry);

  const finish = (id: string, kind: AppSourceKind, value: string): void => {
    try {
      const source = kind === 'repository' ? { kind, url: value } as const : kind === 'folder' ? { kind, path: value } as const : { kind } as const;
      const res = createApplicationApp(ws, { appId: id, source });
      try { logPortfolio('info', 'wizard.application.app.created', 'Setup: app added', { context: { app_id: id, source_mode: res.sourceMode } }); } catch { /* best-effort */ }
      onNext({ status: 'done', summary: `App ${id} added` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const back = (): void => {
    setError('');
    if (phase === 'source-value') { setPhase('source-kind'); return; }
    if (phase === 'source-kind') { setPhase('id'); return; }
    setPhase('list');
  };

  const chooseList = (label: string): void => {
    setError('');
    if (label === APP_KEEP_CHOICE) { onNext({ status: 'kept', summary: appsSummary(apps) }); return; }
    if (label === APP_SKIP_CHOICE) { onNext({ status: 'skipped', summary: 'No app added' }); return; }
    setPhase('id');
  };

  const chooseSource = (kind: AppSourceKind): void => {
    setError('');
    setSourceKind(kind);
    if (kind === 'later') finish(appId, 'later', '');
    else setPhase('source-value');
  };

  const listOptions: SelectOption[] = appListChoices(apps.length > 0).map((label) => ({ label, value: label, guidance: appListGuidance(label, apps) }));
  const sourceOptions: SelectOption[] = APP_SOURCE_CHOICES.map((c) => ({ label: c.label, value: c.kind, guidance: appSourceGuidance(c) }));
  const guidance: GuidanceEntry = phase === 'list' || phase === 'source-kind'
    ? optionEntry
    : phase === 'id'
      ? { title: 'App id', what: APP_SECTIONS[0]!.text, sections: APP_SECTIONS.slice(1) }
      : appSourceGuidance(APP_SOURCE_CHOICES.find((c) => c.kind === sourceKind)!);

  return (
    <SetupStepFrame
      title="App"
      subtitle="The application the assessment analyses."
      kind={phase === 'id' || phase === 'source-value' ? 'textInput' : 'picker'}
      guidance={guidance}
      back={phase === 'list' ? undefined : back}
    >
      <Box flexDirection="column">
        {apps.length > 0 && <Text>{fitToWidth(`Applications in this workspace: ${apps.join(', ')}`, width)}</Text>}
        {serviceNote && <Text {...tone('muted')} wrap="wrap">{serviceNote}</Text>}

        {phase === 'list' && (
          <Box marginTop={1}>
            <SelectInput key="app-list" label="" options={listOptions} numbered showKeyHints={false} visibleCount={listOptions.length} onCursorChange={onCursorChange} onSelect={chooseList} />
          </Box>
        )}

        {phase === 'id' && (
          <Box marginTop={1}>
            <TextInput
              key="app-id"
              label="App id"
              placeholder="my-app"
              onSubmit={(raw) => {
                const problem = appIdProblem(ws, raw);
                if (problem) { setError(problem); return; }
                setError('');
                setAppId(raw.trim());
                setPhase('source-kind');
              }}
            />
          </Box>
        )}

        {phase === 'source-kind' && (
          <Box marginTop={1} flexDirection="column">
            <Text>{fitToWidth(`Source of ${appId}:`, width)}</Text>
            <SelectInput key="app-source" label="" options={sourceOptions} numbered showKeyHints={false} visibleCount={sourceOptions.length} onCursorChange={onCursorChange} onSelect={(v) => chooseSource(v as AppSourceKind)} />
          </Box>
        )}

        {phase === 'source-value' && (
          <Box marginTop={1}>
            <TextInput
              key={`source-${sourceKind}`}
              label={sourceKind === 'repository' ? 'Repository address' : 'Source folder'}
              placeholder={sourceKind === 'repository' ? 'https://github.com/org/repo' : 'full path of the folder'}
              maxValueWidth={Math.max(20, width - 24)}
              onSubmit={(raw) => {
                const problem = appSourceProblem(sourceKind, raw);
                if (problem) { setError(problem); return; }
                finish(appId, sourceKind, raw);
              }}
            />
          </Box>
        )}

        {error && <Text {...tone('error')}>{fitToWidth(error, width)}</Text>}
      </Box>
    </SetupStepFrame>
  );
}

export function appsSummary(apps: readonly string[]): string {
  return apps.length === 1 ? `App: ${apps[0]}` : `${apps.length} apps: ${apps.join(', ')}`;
}
