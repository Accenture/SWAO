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

// #4192 SET-03 (Design 125 section 5.2): Source access step of the
// Application branch. Runs the vcs_auth probe builder (the function of the
// health check) for every app and lists the outcome in plain words
// (setup/application-source.ts vcsOutcomeView). For a missing or rejected
// token, choosing the app opens a masked input; the token goes into the
// credential vault under the provider-scoped key and the check runs again.
//
// #4254 / #4341 (Design 126 sections 4.5, 7.7 and 9): the frame comes from the
// wizard (SetupStepFrame); "Check again" and "Continue" are list entries
// (no letter keys, no Esc); the token input goes back to the list with
// Shift+Tab; Esc belongs to the wizard. The guidance follows the highlighted
// app or entry.

import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CredentialStore, logPortfolio, type VcsAuthProbeResult } from '@swao/core';
import { PICKER_VISIBLE_COUNT, PasswordInput, SelectInput, fitToWidth, statusText, tone, useHeaderWidth, useOptionGuidance, type GuidanceEntry, type GuidanceSection, type SelectOption } from '@swao/tui-kit';
import { readApplicationDefaults } from '../defaults.js';
import { buildVcsAuthProbe } from '../../health-check/vcs-auth-probe.js';
import { storeVcsToken, vcsOutcomeView } from '../application-source.js';
import type { SetupStepProps } from '../types.js';
import { SetupStepFrame } from '../setup-frame.js';
import { ActionRows, StatusRows, moveCursor } from './step-ui.js';

/** Injection points for tests: the probe and the vault. */
export interface ApplicationSourceDeps {
  probe: (workspaceRoot: string, store: CredentialStore) => Promise<VcsAuthProbeResult>;
  store: () => CredentialStore;
}

const defaultDeps: ApplicationSourceDeps = {
  probe: (ws, store) => buildVcsAuthProbe(ws, store),
  store: () => new CredentialStore(),
};

type Phase = 'checking' | 'list' | 'token';

export const SOURCE_ACTIONS = ['Check again', 'Continue'] as const;

/**
 * #4490 (Design 126 section 7.13): above this many apps the results are a
 * paged list with type-to-filter (the central SelectInput) instead of the
 * status rows, so every app stays reachable.
 */
export const SOURCE_ROWS_MAX = 8;
const SOURCE_ACTION_VALUE: Readonly<Record<(typeof SOURCE_ACTIONS)[number], string>> = { 'Check again': '__recheck__', Continue: '__continue__' };

/** #4490: the options of the paged results list: one per app (status and text as detail), then the actions. */
export function sourceResultOptions(apps: VcsAuthProbeResult['apps']): SelectOption[] {
  return [
    ...apps.map((a): SelectOption => {
      const v = vcsOutcomeView(a.outcome);
      return { label: a.app_id, value: a.app_id, detail: `${statusText(v.state)} ${v.text}${a.host ? ` (${a.host})` : ''}`, group: 'Applications', guidance: sourceAppGuidance(a) };
    }),
    ...SOURCE_ACTIONS.map((label): SelectOption => ({ label, value: SOURCE_ACTION_VALUE[label], group: 'Actions', guidance: SOURCE_ACTION_GUIDANCE[label] })),
  ];
}

const SOURCE_SECTIONS: readonly GuidanceSection[] = [
  { label: 'Token', text: 'Stored encrypted in the SWAO credential vault for the repository host (GitHub, GitLab, Azure DevOps), never in the settings file. Read access to the repository is enough.' },
  { label: 'Check', text: 'The same check runs in the Application health check at the end of this setup.' },
  { label: 'Applies to', text: 'Application Assessments of apps that clone their source from a repository.' },
];

const SOURCE_WHAT = 'SWAO checks with a read-only request whether each repository answers: with the stored token, or without one for a public repository. A token is asked for only when anonymous access fails. Apps with a local folder need no check.';

/** #4230: the guidance of one highlighted app. */
export function sourceAppGuidance(app: VcsAuthProbeResult['apps'][number]): GuidanceEntry {
  const v = vcsOutcomeView(app.outcome);
  // A short title (the app id): a long title wraps the box's own hint column at 80 columns.
  return {
    title: app.app_id,
    what: `${v.text.charAt(0).toUpperCase()}${v.text.slice(1)}. ${v.help}`,
    sections: [
      { label: 'Choose', text: v.tokenFixes && app.vcs_url ? 'Choosing this app opens the token input for its repository host.' : 'Choosing this app continues; no token would change its result.' },
      ...SOURCE_SECTIONS,
    ],
  };
}

/** #4230: the guidance of the action entries. */
export const SOURCE_ACTION_GUIDANCE: Readonly<Record<(typeof SOURCE_ACTIONS)[number], GuidanceEntry>> = {
  'Check again': { title: 'Check again', what: 'Runs the repository check for every app again, for example after changing a repository address or a token outside SWAO.', sections: SOURCE_SECTIONS },
  Continue: { title: 'Continue', what: 'Goes on to the next step. Apps that still need attention stay listed in the health check and on the Ready step.', sections: SOURCE_SECTIONS },
};

export function ApplicationSourceStep(props: SetupStepProps & { deps?: ApplicationSourceDeps }) {
  const { ctx, onNext } = props;
  const deps = props.deps ?? defaultDeps;
  const ws = ctx.workspaceRoot;
  const [phase, setPhase] = useState<Phase>('checking');
  const [result, setResult] = useState<VcsAuthProbeResult | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [round, setRound] = useState(0);
  const [stored, setStored] = useState(0);
  const [error, setError] = useState('');
  const width = useHeaderWidth();

  useEffect(() => {
    let live = true;
    setPhase('checking');
    deps.probe(ws, deps.store())
      .then((r) => { if (live) { setResult(r); setPhase('list'); } })
      .catch((err: unknown) => { if (live) { setError(err instanceof Error ? err.message : String(err)); setResult({ status: 'warn', apps: [], message: '' }); setPhase('list'); } });
    return () => { live = false; };
  }, [round]);

  // #4490: the Application Assessment setup checks application apps only (the service apps have no source).
  const applicationIds = useMemo(() => new Set(readApplicationDefaults(ws).apps), [ws]);
  const apps = useMemo(() => (result?.apps ?? []).filter((a) => applicationIds.has(a.app_id)), [result, applicationIds]);
  const paged = apps.length > SOURCE_ROWS_MAX;
  const pagedGuidance = useOptionGuidance({ title: 'Source access', what: SOURCE_WHAT, sections: SOURCE_SECTIONS });
  const size = apps.length + SOURCE_ACTIONS.length;
  const recheckIndex = apps.length;
  const selected = cursor < apps.length ? apps[cursor] : undefined;
  const selectedView = selected ? vcsOutcomeView(selected.outcome) : undefined;

  const finish = (): void => {
    const open = apps.filter((a) => vcsOutcomeView(a.outcome).state === 'missing').length;
    const vcsApps = apps.filter((a) => a.vcs_url !== null).length;
    const summary = vcsApps === 0 ? 'Source: local folders only' : open === 0 ? 'Source access confirmed' : `Source access: ${open} app${open === 1 ? '' : 's'} need attention`;
    try { logPortfolio('info', 'wizard.application.source.complete', 'Setup: source access step complete', { context: { apps: apps.length, needs_attention: open, tokens_stored: stored } }); } catch { /* best-effort */ }
    onNext({ status: stored > 0 ? 'done' : 'kept', summary });
  };

  const recheck = (): void => { setError(''); setRound((n) => n + 1); };

  /** #4490: Enter on an entry of the paged results list. */
  const choosePaged = (value: string): void => {
    if (value === '__recheck__') { recheck(); return; }
    if (value === '__continue__') { finish(); return; }
    const i = apps.findIndex((a) => a.app_id === value);
    if (i < 0) return;
    setCursor(i);
    const app = apps[i]!;
    if (vcsOutcomeView(app.outcome).tokenFixes && app.vcs_url) { setError(''); setPhase('token'); return; }
    finish();
  };

  useInput((_input, key) => {
    if (phase !== 'list' || paged) return;
    if (moveCursor(key, size, setCursor)) return;
    if (!key.return) return;
    if (cursor === recheckIndex) { recheck(); return; }
    if (selected && selectedView?.tokenFixes && selected.vcs_url) { setError(''); setPhase('token'); return; }
    finish();
  });

  const backToList = (): void => { setPhase('list'); setError(''); };
  const guidance: GuidanceEntry = phase === 'token' && selected
    ? { title: `Access token for ${selected.host ?? selected.app_id}`, what: selectedView?.help ?? SOURCE_WHAT, sections: SOURCE_SECTIONS }
    : paged && phase === 'list'
      ? pagedGuidance.entry
    : selected
      ? sourceAppGuidance(selected)
      : phase === 'list' && apps.length > 0
        ? SOURCE_ACTION_GUIDANCE[SOURCE_ACTIONS[cursor - apps.length] ?? 'Continue']
        : { title: 'Source access', what: SOURCE_WHAT, sections: SOURCE_SECTIONS };

  return (
    <SetupStepFrame
      title="Source access"
      subtitle="Can SWAO read each app's repository?"
      kind={phase === 'token' ? 'textInput' : 'picker'}
      guidance={guidance}
      back={phase === 'token' ? backToList : undefined}
    >
      <Box flexDirection="column">
        {phase === 'checking' && <Text {...tone('progressRunning')}>Checking repository access...</Text>}
        {phase !== 'checking' && apps.length === 0 && <Text {...tone('muted')}>{fitToWidth('No app yet. Add an app in the previous step; this check runs again in the health check.', width)}</Text>}
        {phase === 'list' && paged && (
          <SelectInput
            label="Apps"
            options={sourceResultOptions(apps)}
            visibleCount={PICKER_VISIBLE_COUNT}
            filter
            itemNoun="apps"
            showKeyHints={false}
            initialIndex={Math.min(cursor, apps.length + SOURCE_ACTIONS.length - 1)}
            onCursorChange={pagedGuidance.onCursorChange}
            onSelect={choosePaged}
          />
        )}
        {phase !== 'checking' && apps.length > 0 && !(paged && phase === 'list') && !(paged && phase === 'token') && (
          <StatusRows
            cursor={phase === 'list' ? cursor : undefined}
            rows={apps.map((a) => { const v = vcsOutcomeView(a.outcome); return { state: v.state, label: a.app_id, text: `${v.text}${a.host ? ` (${a.host})` : ''}` }; })}
          />
        )}
        {phase === 'list' && !paged && <ActionRows labels={SOURCE_ACTIONS} cursor={cursor} offset={apps.length} />}
        {phase === 'token' && selected?.vcs_url && (
          <Box marginTop={1} flexDirection="column">
            <Text>{fitToWidth(`Access token for ${selected.host ?? selected.app_id}`, width)}</Text>
            <PasswordInput
              label="Token"
              onSubmit={(value) => {
                const url = selected.vcs_url!;
                storeVcsToken(deps.store(), url, value)
                  .then((keyName) => {
                    try { logPortfolio('info', 'wizard.application.source.token.stored', 'Setup: repository token stored', { context: { app_id: selected.app_id, key: keyName } }); } catch { /* best-effort */ }
                    setStored((n) => n + 1);
                    setPhase('checking');
                    setRound((n) => n + 1);
                  })
                  .catch((err: unknown) => setError(err instanceof Error && err.message === 'empty token' ? 'Enter a token, or go back to the list.' : 'The token could not be stored in the vault.'));
              }}
            />
          </Box>
        )}
        {error && <Text {...tone('error')}>{fitToWidth(error, width)}</Text>}
      </Box>
    </SetupStepFrame>
  );
}
