// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #0773/#0763: App picker phase -- app list + filter + empty-workspace fallback,
// extracted from AssessScreen (#2371). Shared by AppAssessmentScreen and
// LzAssessmentScreen. Component owns its own filter/cursor state; parent callbacks
// handle all state machine transitions.
//
// Scope: input-app only. input-app-new remains in AssessScreen to support
// the back-navigation from input-vcs-url (preserves new-app context on Esc).

import { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { APPS_LOADING_LINE, SelectInput, TextInput, KEY_HINTS, PICKER_VISIBLE_COUNT, tone, useAfterFirstFrame, useOptionGuidance } from '@swao/tui-kit';
import type { GuidanceEntry, KeyHint, SelectOption } from '@swao/tui-kit';
import { serviceAppsNoteText } from '@swao/core';
import { APP_KIND_GROUP, listWorkspaceApps, preselectedAppIndex, readSubjectApp } from './app-kinds.js';
import type { WorkspaceApp } from './app-kinds.js';
import { FlowFrame, type FlowHeader } from './flow-frame.js';

export interface AppPickerPhaseProps {
  workspace: string | null;
  assessmentType: 'application' | 'landing-zone';
  typeLabel: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewApp: (id: string) => void;
  onDelete: () => void;
  onRename: () => void;
  onEditCredentials: (id: string) => void;
  /** Esc: the flow's abort (useFlowNavigation `requestAbort`). */
  onBack: () => void;
  /** #4255: header, step bar and AbortDialog of the flow (Design 126 sections 3 and 4.5). */
  header: FlowHeader;
  steps: readonly string[];
  current: number;
  dialog?: JSX.Element | null;
  onGuidanceOpenChange?: (open: boolean) => void;
}

/** Group heading of the app management entries of the Application picker. */
export const APP_ACTIONS_GROUP = 'Manage apps';

const ACTION_VALUES = new Set(['__new__', '__delete__', '__rename__']);

/**
 * #4400: the apps a picker offers. The Application Assessment lists application
 * apps only: a service app (`assessment.type: service`) is assessed by the
 * Service Portfolio Assessment (Design 103 section 3.6). The Landing Zone
 * Catalog Assessment keeps both groups.
 */
export function pickerApps(apps: readonly WorkspaceApp[], assessmentType: string): WorkspaceApp[] {
  return assessmentType === 'application' ? apps.filter((a) => a.kind !== 'service') : [...apps];
}

/** #4400: the note row under the Application picker when service apps are not listed; null when there are none. */
export function serviceAppsNote(apps: readonly WorkspaceApp[], assessmentType: string): string | null {
  if (assessmentType !== 'application') return null;
  return serviceAppsNoteText(apps.filter((a) => a.kind === 'service').length);
}

/**
 * #4239 / #4255 (TUI-11): the picker options. Applications first, service
 * apps under their own heading; the Application picker adds the app
 * management entries under "Manage apps" after the apps.
 */
export function appPickerOptions(apps: readonly WorkspaceApp[], assessmentType: string, subjectApp?: string): SelectOption[] {
  const options: SelectOption[] = pickerApps(apps, assessmentType).map((a) => ({ label: a.id, value: a.id, ...(a.name ? { detail: a.name } : {}), group: APP_KIND_GROUP[a.kind], guidance: appOptionGuidance(a, assessmentType, subjectApp) }));
  if (assessmentType === 'application') {
    options.push(
      { label: 'New app', value: '__new__', group: APP_ACTIONS_GROUP, guidance: { title: 'New app', what: 'Creates a new app folder under apps/ with its own .swao.yml; you name it and give the source next.' } },
      { label: 'Delete an app', value: '__delete__', group: APP_ACTIONS_GROUP, guidance: { title: 'Delete an app', what: 'Lists the apps of this workspace to pick one to delete; SWAO asks once more before it removes the folder.' } },
      { label: 'Rename an app', value: '__rename__', group: APP_ACTIONS_GROUP, guidance: { title: 'Rename an app', what: 'Lists the apps of this workspace to pick one to rename; its folder and its runs keep their content.' } },
    );
  }
  return options;
}

/**
 * #4230: the guidance of one highlighted app: its kind, what the run reads
 * and whether it is the subject app of the setup.
 */
export function appOptionGuidance(app: WorkspaceApp, assessmentType: string, subjectApp?: string): GuidanceEntry {
  const what = app.kind === 'service'
    ? `${app.id} is a service app scaffolded by the Service Portfolio Assessment. It has no source of its own; the run reads its intake row and its research results.`
    : `${app.id} is an application. The run reads its source and settings from apps/${app.id}/.swao.yml.`;
  const target = assessmentType === 'landing-zone'
    ? 'The Landing Zone Catalog Assessment checks the landing zone targets of this app.'
    : 'Its settings and credentials can be changed before the run.';
  return {
    title: app.id,
    what: `${what} ${target}`,
    sections: app.id === subjectApp ? [{ label: 'Preselected', text: 'The setup stored this app as the subject of the assessment.' }] : [],
  };
}

/**
 * #4198 (Design 125 section 5.7) and #4239: where the cursor starts. The
 * subject app of the setup when it is listed, else the first application.
 */
export function appPickerInitialIndex(apps: readonly WorkspaceApp[], subjectApp: string | undefined): number {
  return preselectedAppIndex(apps, subjectApp);
}

/** Key hints of the app picker (Design 126 section 7.9); Tab opens the app settings. */
export const APP_PICKER_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' },
  { key: 'Type', verb: 'filter' },
  { key: 'Enter', verb: 'next' },
  { key: 'Tab', verb: 'open', object: 'settings' },
  { key: 'Esc', verb: 'abort' },
];

/** #4484: key hints while loading: Esc only; other keys pressed while the apps load are dropped. */
export const APP_PICKER_LOADING_KEYS: readonly KeyHint[] = [{ key: 'Esc', verb: 'abort' }];

// App picker phase: selects or names an app before entering the credential hub.
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
/** #4255: key hints of the empty-workspace fallback (a text input on the first step). */
export const APP_ID_INPUT_KEYS: readonly KeyHint[] = KEY_HINTS.textInput.filter((h) => h.verb !== 'back');

export function AppPickerPhase({ workspace, assessmentType, typeLabel, onSelect, onNew, onNewApp, onDelete, onRename, onEditCredentials, onBack, header, steps, current, dialog = null, onGuidanceOpenChange }: AppPickerPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const [cursorValue, setCursorValue] = useState('');

  // #4239: one scan per mount; 235 .swao.yml reads per keystroke would lag.
  // #4484: the scan runs after the first frame ("Loading apps"), through the app index.
  const loaded = useAfterFirstFrame(() => listWorkspaceApps(workspace), [workspace]);
  const apps = useMemo(() => loaded ?? [], [loaded]);
  const subjectApp = useMemo(() => readSubjectApp(workspace), [workspace]);
  const options = useMemo(() => appPickerOptions(apps, assessmentType, subjectApp), [apps, assessmentType, subjectApp]);
  const serviceCount = apps.filter((a) => a.kind === 'service').length;
  // #4400: the Application picker lists application apps only; the note row counts the service apps.
  const listed = useMemo(() => pickerApps(apps, assessmentType), [apps, assessmentType]);
  const note = serviceAppsNote(apps, assessmentType);
  const stepEntry: GuidanceEntry = {
    title: 'Select app to assess',
    what: note
      ? `Choose the application to assess. Type part of a name to filter the list. ${note}`
      : serviceCount > 0
      ? `Choose the app to assess. ${apps.length - serviceCount} application(s) are listed first, the ${serviceCount} service app(s) of the Service Portfolio Assessment follow under their own heading. Type part of a name to filter the list.`
      : 'Choose the app from your workspace. Type part of a name to filter the list.',
  };
  // #4230: the box follows the highlighted app (hook before any early return).
  const { entry, onCursorChange } = useOptionGuidance(stepEntry);

  useInput((_input, key) => {
    if (dialog) return; // the AbortDialog owns Enter and Esc
    // An open guidance box owns Esc (Design 126 section 7.5).
    if (key.escape) {
      if (!guidanceOpenRef.current) onBack();
      return;
    }
    if (!loaded) return; // #4484: keys other than Esc pressed while the apps load are dropped
    // #0800: Tab opens the credential and settings hub of the highlighted app.
    if (key.tab && cursorValue && !ACTION_VALUES.has(cursorValue)) onEditCredentials(cursorValue);
  });

  const onOpenChange = (open: boolean): void => { guidanceOpenRef.current = open; onGuidanceOpenChange?.(open); };
  const frame = { header: { ...header, subtitle: typeLabel }, steps, current, dialog, onGuidanceOpenChange: onOpenChange };

  // #4484 (Design 126 section 7.12): the frame draws at once; the list follows the scan.
  if (!loaded) {
    return (
      <FlowFrame {...frame} title="Select app to assess" subtitle={workspace ? `Workspace ${workspace}` : undefined} keys={APP_PICKER_LOADING_KEYS} guidance={{ entry: { title: 'Select app to assess', what: 'SWAO reads the apps of this workspace; the list follows in a moment.' } }}>
        <Text {...tone('muted')}>{APPS_LOADING_LINE}</Text>
      </FlowFrame>
    );
  }

  if (assessmentType === 'application' || apps.length > 0) {
    return (
      <FlowFrame {...frame} title="Select app to assess" subtitle={workspace ? `Workspace ${workspace}` : undefined} keys={APP_PICKER_KEYS} guidance={{ entry }}>
        <SelectInput
          label="Application"
          options={options}
          // #4198 / #4239: the subject app of the setup, else the first application.
          initialIndex={appPickerInitialIndex(listed, subjectApp)}
          visibleCount={PICKER_VISIBLE_COUNT}
          filter
          itemNoun="entries"
          showKeyHints={false}
          onCursorChange={(v, o) => { setCursorValue(v); onCursorChange(v, o); }}
          onSelect={(v) => {
            if      (v === '__new__')    onNew();
            else if (v === '__delete__') onDelete();
            else if (v === '__rename__') onRename();
            else                         onSelect(v);
          }}
          active={!dialog}
        />
        {note && <Text {...tone('muted')} wrap="wrap">{note}</Text>}
      </FlowFrame>
    );
  }

  // Empty workspace fallback: show text input for app ID directly
  return (
    <FlowFrame {...frame} title="Select app to assess" keys={APP_ID_INPUT_KEYS} guidance={{ entry: { title: 'Application ID', what: 'No apps found in this workspace. Create one with Workspace Setup first, or type the ID of the app to assess.' } }}>
      {workspace
        ? <Text>Workspace: <Text {...tone('text', { bold: true })}>{workspace}</Text></Text>
        : <Text {...tone('warning')}>No workspace found. Run Workspace Setup first.</Text>}
      <Box marginTop={1}>
        <TextInput
          key="input-app"
          label="Application ID (e.g. sovereign-health)"
          placeholder="sovereign-health"
          onSubmit={(id) => { if (id) onNewApp(id); }}
          active={!dialog}
        />
      </Box>
    </FlowFrame>
  );
}
