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

/**
 * RunContextPicker -- assessment type selector for multi-type workspaces.
 *
 * Displayed before report, publish, export-bi, and portfolio operations when
 * the workspace WSP directory has runs of more than one assessment type
 * (Design 067 §5.1, #0784). Auto-selects when only one type is present.
 */

import { useEffect, useState } from 'react';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { Box, Text, useInput } from 'ink';
import { tone } from '../theme.js';
import { SelectInput, type SelectOption } from './SelectInput.js';
import type { GuidanceEntry } from './guidance-entry.js';

export interface SelectedRunContext {
  assessmentType: string;
  runTimestamp: string;
}

export interface RunContextPickerProps {
  wspDir: string;
  onSelect: (ctx: SelectedRunContext) => void;
  onCancel?: () => void;
}

export interface TypeEntry {
  assessmentType: string;
  runTimestamp: string;
  label: string;
}

export const DISPLAY_NAMES: Record<string, string> = {
  application: 'Application Assessment',
  'landing-zone-catalog': 'Landing Zone Catalog Assessment',
  audit: 'Audit Assessment',
  llm: 'LLM Assessment',
  hybrid: 'Hybrid Assessment',
};

export function displayName(type: string): string {
  return DISPLAY_NAMES[type] ?? type;
}

/** Convert run-directory timestamp (2026-07-04T14-23-55) to ISO string. */
export function formatRunTs(raw: string): string {
  if (raw.length < 19) return raw;
  // raw: 2026-07-04T14-23-55 -> 2026-07-04T14:23:55Z
  return raw.slice(0, 13) + ':' + raw.slice(14, 16) + ':' + raw.slice(17, 19) + 'Z';
}

export function loadEntries(wspDir: string): TypeEntry[] {
  if (!existsSync(wspDir)) return [];
  const files = readdirSync(wspDir);
  const entries: TypeEntry[] = [];
  for (const f of files) {
    const m = /^latest-(.+)\.txt$/.exec(f);
    if (!m) continue;
    const assessmentType = m[1]!;
    const raw = readFileSync(join(wspDir, f), 'utf-8').trim();
    // Content is "runs/<runTs>" -- extract the run timestamp
    const runTsRaw = raw.startsWith('runs/') ? raw.slice(5) : raw;
    const runTimestamp = formatRunTs(runTsRaw);
    entries.push({
      assessmentType,
      runTimestamp,
      label: `${displayName(assessmentType).padEnd(38)} (${runTimestamp})`,
    });
  }

  // #1529: also check <workspace>/llm-assessments/swao/latest.txt.
  // wspDir = <workspace>/apps/<app>/wsp; workspace = 3 levels up.
  try {
    const workspaceRoot = dirname(dirname(dirname(wspDir)));
    const llmLatestPath = join(workspaceRoot, 'llm-assessments', 'swao', 'latest.txt');
    if (existsSync(llmLatestPath) && !entries.some((e) => e.assessmentType === 'llm')) {
      const llmRunTs = readFileSync(llmLatestPath, 'utf-8').trim();
      if (llmRunTs) {
        // Optionally filter by app_id: read manifest.yaml from the run dir.
        const manifestPath = join(workspaceRoot, 'llm-assessments', 'swao', llmRunTs, 'manifest.yaml');
        let appIdMatch = true;
        if (existsSync(manifestPath)) {
          try {
            // manifest.yaml is written as JSON by the orchestrator despite the .yaml extension
            const m2 = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown> | null;
            const runAppId = typeof m2?.app_id === 'string' ? m2.app_id : '';
            // wspDir = <workspace>/apps/<app>/wsp; extract <app> component
            const appFromWsp = dirname(wspDir).split(/[/\\]/).pop() ?? '';
            if (runAppId && appFromWsp && runAppId !== appFromWsp) appIdMatch = false;
          } catch { /* best-effort: include if manifest unreadable */ }
        }
        if (appIdMatch) {
          const runTimestamp = formatRunTs(llmRunTs);
          entries.push({
            assessmentType: 'llm',
            runTimestamp,
            label: `${displayName('llm').padEnd(38)} (${runTimestamp})`,
          });
        }
      }
    }
  } catch { /* best-effort */ }

  return entries.sort((a, b) => a.assessmentType.localeCompare(b.assessmentType));
}

/**
 * #4213 (Design 126 section 9, gate G-05h): the guidance entry of one app of an
 * "assessed application" picker (Generate Report, Export BI, Stakeholder
 * Challenge): the app, its assessment runs (type and the latest run) and what
 * the screen does with it on Enter (`purpose`, one sentence);
 * `cli` is the command of the screen, `<id>` or `<app>` stands for the app.
 */
export function assessedAppGuidance(appId: string, wspDir: string, purpose: string, cli?: string): GuidanceEntry {
  const entries = loadEntries(wspDir);
  let runs = entries.map((e) => `${displayName(e.assessmentType)}, latest run ${e.runTimestamp}`).join('; ');
  if (!runs) {
    // A workspace with only the untyped pointer apps/<id>/wsp/latest.txt.
    const pointer = join(wspDir, 'latest.txt');
    const raw = existsSync(pointer) ? readFileSync(pointer, 'utf-8').trim() : '';
    runs = raw ? `latest run ${formatRunTs(raw.startsWith('runs/') ? raw.slice(5) : raw)}` : 'no run pointer found';
  }
  return {
    title: appId,
    what: purpose,
    sections: [{ label: 'Runs', text: runs }],
    ...(cli ? { cli: cli.replace(/<id>|<app>/g, appId) } : {}),
  };
}

/** #4213: the options of an assessed application picker, one guidance entry per app. */
export function assessedAppOptions(workspace: string, apps: readonly string[], purpose: string, cli?: string): SelectOption[] {
  return apps.map((a) => ({ label: a, value: a, guidance: assessedAppGuidance(a, join(workspace, 'apps', a, 'wsp'), purpose, cli) }));
}

export function RunContextPicker({ wspDir, onSelect, onCancel }: RunContextPickerProps): JSX.Element {
  const entries = loadEntries(wspDir);
  const [autoSelected, setAutoSelected] = useState(false);

  useEffect(() => {
    if (!autoSelected && entries.length === 1) {
      setAutoSelected(true);
      onSelect({ assessmentType: entries[0]!.assessmentType, runTimestamp: entries[0]!.runTimestamp });
    }
  }, [autoSelected, entries, onSelect]);

  // #4343 (Design 126 sections 4.2 and 7.9, B-2, B-3): the rows are a SelectInput (the
  // central cursor and its key hint line); this picker reads only the cancel keys.
  useInput((input, key) => {
    if (entries.length <= 1) return;
    if (key.escape || input === '0') onCancel?.();
  });

  if (entries.length === 0) {
    return (
      <Box>
        <Text {...tone('muted')}>No assessment runs found in {wspDir}.</Text>
      </Box>
    );
  }

  if (entries.length === 1) {
    return (
      <Box>
        <Text {...tone('muted')}>Using {displayName(entries[0]!.assessmentType)} run ({entries[0]!.runTimestamp}).</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text {...tone('brand')}>Multiple assessment types found. Select the run to use:</Text>
      <Box flexDirection="column" marginTop={1}>
        <SelectInput
          label=""
          options={entries.map((e) => ({ label: e.label, value: e.assessmentType }))}
          visibleCount={Math.min(entries.length, 8)}
          // The host screen (Report, Publish HTML) draws the key hint line.
          showKeyHints={false}
          onSelect={(v) => {
            const e = entries.find((x) => x.assessmentType === v);
            if (e) onSelect({ assessmentType: e.assessmentType, runTimestamp: e.runTimestamp });
          }}
        />
      </Box>
    </Box>
  );
}
