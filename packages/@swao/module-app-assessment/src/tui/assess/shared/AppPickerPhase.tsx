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

import { useState, useRef } from 'react';
import type { ComponentType } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SelectInput, TextInput, GuidanceBox } from '@swao/tui-kit';
import { filterList, FILTER_THRESHOLD, SHOW_ALL } from '../../list-filter.js';

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
  onBack: () => void;
  Header: ComponentType<{ subtitle?: string }>;
}

// App picker phase -- selects or names an app before entering the credential hub.
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
export function AppPickerPhase({ workspace, assessmentType, typeLabel, onSelect, onNew, onNewApp, onDelete, onRename, onEditCredentials, onBack, Header }: AppPickerPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const [filter, setFilter] = useState('');
  const [cursorValue, setCursorValue] = useState('');

  const existingApps: string[] = workspace && existsSync(join(workspace, 'apps'))
    ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    : [];

  useInput((input, key) => {
    if (guidanceOpenRef.current && !(input === 'e' || input === 'E')) return;
    if (key.escape) {
      // #0763: Esc clears filter first; second Esc goes back to parent
      if (filter) { setFilter(''); } else { onBack(); }
    }
    // #0800: E key opens credential hub in edit-only mode for highlighted app
    if (input === 'e' || input === 'E') {
      if (cursorValue && cursorValue !== '__new__' && cursorValue !== '__delete__' && cursorValue !== '__rename__') {
        onEditCredentials(cursorValue);
      }
    }
  });

  if (assessmentType === 'application' || existingApps.length > 0) {
    // #0763: large workspace -- show filter step first
    if (existingApps.length > FILTER_THRESHOLD && filter === '') {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle={typeLabel} />
          <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
          <Text dimColor>{existingApps.length} apps found. Filter to narrow the list.</Text>
          <Box marginTop={1}>
            <TextInput
              key="app-filter"
              label="Filter by name (or Enter to show all)"
              placeholder="sovereign-health"
              onSubmit={(v) => setFilter(v || SHOW_ALL)}
              active
            />
          </Box>
          <GuidanceBox
            title="Filter apps"
            what={`${existingApps.length} apps in workspace. Type part of the app name to filter, or Enter to show all.`}
            affordances={['Type -- filter  |  Enter -- confirm filter  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    const filteredApps = filterList(existingApps, filter, a => a);
    const appOptions = assessmentType === 'application'
      ? [
        { label: '+ New app...',     value: '__new__'    },
        ...filteredApps.map(a => ({ label: `apps/${a}`, value: a })),
        { label: '-- Delete app...', value: '__delete__' },
        { label: '-- Rename app...', value: '__rename__' },
      ]
      : filteredApps.map(a => ({ label: `apps/${a}`, value: a }));

    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
        {filter && filter !== SHOW_ALL && (
          <Text dimColor>Filter: <Text color="cyanBright">{filter}</Text>  ({filteredApps.length}/{existingApps.length} apps)  Esc to clear</Text>
        )}
        <Box marginTop={1}>
          <SelectInput
            label="Select application to assess"
            options={appOptions}
            onCursorChange={(v) => setCursorValue(v)}
            onSelect={(v) => {
              if      (v === '__new__')    onNew();
              else if (v === '__delete__') onDelete();
              else if (v === '__rename__') onRename();
              else                         onSelect(v);
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Select app to assess"
          what={filteredApps.length !== existingApps.length
            ? `Showing ${filteredApps.length} of ${existingApps.length} apps matching "${filter}". Esc to reset filter.`
            : 'Choose the app from your workspace. Enter to confirm.'}
          affordances={['Up/Down -- pick  |  Enter -- start assessment  |  E -- edit settings  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // Empty workspace fallback -- show text input for app ID directly
  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={typeLabel} />
      {workspace
        ? <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
        : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>No apps found in this workspace. Run `swao init` first to create one.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app"
            label="Application ID (e.g. sovereign-health)"
            placeholder="sovereign-health"
            onSubmit={(id) => { if (id) onNewApp(id); }}
            active
          />
        </Box>
      </Box>
    </Box>
  );
}
