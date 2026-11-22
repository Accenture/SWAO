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

// #3589: Landing Zone Connections (Design 120 section 14.2), the Landing Zone Live setup and
// step 1 of the LZ Live Assessment (#4127). Lists the landing zones registered in
// .swao.yml with their offline connection state, and adds a landing zone,
// adds a scope with credentials, probes read-only + coverage, migrates legacy
// LZR credentials (only when the vault holds them) and removes a scope or a
// landing zone. Every change runs the CLI (lz-connections-flow.ts), so a TUI
// change and a CLI change are the same. Credential values are typed into a
// masked input, reach `swao lz connect --credentials-stdin` on stdin only and
// are never rendered, put on a command line or written to a file. The probe
// here only reports; the write-capable confirmation belongs to a run (Landing
// Zone Live Assessment, Design 120 section 6.3).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { CredentialStore, findWorkspace, providerLabel, providerColumns } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import type { LzCredentialField } from '@swao/core';
import {
  ConfirmPanel, KEY_HINTS, PasswordInput, PICKER_ROW_INDENT, PICKER_VISIBLE_COUNT, ScreenLayout, SelectInput, StatusRow, TextInput, guidanceOwnsKey, tone, useGuidanceOpen,
  type DetailRowProps, type GuidanceEntry, type KeyHint, type SelectOption,
} from '@swao/tui-kit';
import {
  describeLandingZones,
  getLiveLzDriver,
  legacyCredentialCounts,
  registerBuiltInLiveLzDrivers,
  registeredLiveLzProviders,
  reusableCredentialSets,
  awsSsoProfilesForScope,
  readLandingZones,
  storeScopeAwsProfile,
  type AwsSsoProfile,
  type AuthMethod,
  type StoredCredentialSet,
  type LzConnection,
} from '@swao/module-landing-zone';
import { useScreenHeader } from '../components/screen-header.js';
import { SetupStepFrame } from '../../setup/setup-frame.js';
import { defaultLzRegionLoader } from '../../setup/branches/lz-catalog-checks.js';
import { GroupedRegionPicker } from './wizard/GroupedRegionPicker.js';
import type { LzGeographyRegion } from '@swao/module-landing-zone';
import {
  availableKinds,
  lzAppLinkGuidance,
  lzAppLinkRows,
  expiredSessionAt,
  awsSessionKeyScopes,
  buildRefreshArgs,
  isSignInCodeLine,
  isSignInUrlLine,
  readLzAppLinkApps,
  lzAuthMethodGuidance,
  lzMigrateTargetGuidance,
  lzPickLandingZoneGuidance,
  lzProviderGuidance,
  lzRemoveTargetGuidance,
  lzScopeKindGuidance,
  type LzConnectionsPhase,
  buildConnectArgs,
  buildConnectionProbeArgs,
  buildCredentialsStdin,
  buildRemoveArgs,
  migrationTargets,
  parseConnectionProbe,
  parseRegions,
  parseTargets,
  probeRow,
  coverageOf,
  resultGuidance,
  proposeScopeId,
  validateRegistrationId,
  visibleActions,
  actionDisabledReason,
  actionLabel,
  scopeKindLabel,
  SCOPE_KIND_DEFINITIONS,
  SCOPE_KIND_LABELS,
  LZ_CONNECTIONS_ACTION_GUIDANCE,
  LZ_CONNECTIONS_GUIDANCE,
  lzConnectionsPhaseGuidance,
  type ConnectionAction,
  type LzTargetKey,
  type ProbeSummaryLine,
} from './lz-connections-flow.js';

/** Runs one CLI call (optional stdin text) and returns the exit code; injectable for tests. */
export type ConnectionsCliRunner = (args: string[], onLine: (line: string) => void, stdinText?: string, signal?: AbortSignal) => Promise<number>;

/** Spawns this SWAO binary (pkg aware); also used by the Landing Zone Live setup Probe step (#4195). */
export const defaultRunner = (cwd: string | undefined): ConnectionsCliRunner => (args, onLine, stdinText, signal) => new Promise((resolve) => {
  const selfCmd = selfSpawnCommand(args, { env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const child = spawn(selfCmd.command, selfCmd.args, {
    stdio: [stdinText === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    cwd,
    windowsHide: true,
    env: selfCmd.env,
  });
  const push = (chunk: Buffer): void => { for (const l of chunk.toString('utf-8').split('\n')) { const t = l.replace(/\r$/, ''); if (t) onLine(t); } };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  if (stdinText !== undefined) child.stdin?.end(stdinText);
  // #4459: Esc while the AWS SSO sign-in waits stops the child (nothing is stored then).
  signal?.addEventListener('abort', () => { child.kill(); }, { once: true });
  child.on('close', (code) => resolve(code ?? 1));
  child.on('error', () => resolve(1));
});

/** Driver facts the screen needs (provider id and auth methods). */
export interface ConnectionDriverInfo {
  provider: string;
  authMethods: AuthMethod[];
}

function defaultDrivers(): ConnectionDriverInfo[] {
  // Q-21 gate: only drivers the build registers (liveVerified, or named in
  // SWAO_LZ_UNVERIFIED_DRIVERS), never the whole built-in list.
  registerBuiltInLiveLzDrivers();
  return registeredLiveLzProviders().flatMap((p) => {
    const d = getLiveLzDriver(p);
    return d ? [{ provider: p, authMethods: d.authMethods }] : [];
  });
}

type Phase = LzConnectionsPhase;

export interface LzConnectionsScreenProps {
  onBack: () => void;
  /** Workspace root; defaults to the one found from the current directory. */
  workspace?: string;
  /** CLI runner; defaults to spawning this SWAO binary. */
  run?: ConnectionsCliRunner;
  /** Vault (read for key names and the offline state); defaults to the user vault. */
  store?: CredentialStore;
  /** Live drivers of this build; defaults to the registered built-in drivers. */
  drivers?: ConnectionDriverInfo[];
  /** Setup Wizard: the wizard draws the frame; "Continue the setup" is the last menu item and Esc on the list is the wizard's. */
  embedded?: boolean;
  /** Setup Wizard: true while a form of the screen owns Esc (cancel to the list), false on the list (#4299). */
  onEscapeCaptureChange?: (captured: boolean) => void;
  /** #4459: the AWS SSO profiles offered for a scope; defaults to the AWS config file (awsSsoProfilesForScope). */
  ssoProfiles?: (lzId: string, scopeId: string) => AwsSsoProfile[];
}

interface Draft {
  lzId: string;
  provider: string;
  display?: string;
  existingScopes: { id: string; kind: string }[];
  scopeId: string;
  kind: 'platform' | 'application';
  auth?: AuthMethod;
  regions: string[];
  target: Partial<Record<LzTargetKey, string>>;
  /** Optional link to apps/<id> (--app, Design 120 section 6.1). */
  app?: string;
  values: Partial<Record<LzCredentialField, string>>;
  /** #4232: a stored credential set confirmed for reuse (copied with --credentials-from). */
  credentialsFrom?: { lzId: string; scopeId: string };
}

const EMPTY_DRAFT: Draft = { lzId: '', provider: '', existingScopes: [], scopeId: '', kind: 'platform', regions: [], target: {}, values: {} };

export function LzConnectionsScreen({ onBack, workspace: wsProp, run: runProp, store: storeProp, drivers: driversProp, embedded = false, onEscapeCaptureChange, ssoProfiles: ssoProfilesProp }: LzConnectionsScreenProps): JSX.Element {
  const workspace = useMemo(() => wsProp ?? findWorkspace(process.cwd()) ?? undefined, [wsProp]);
  const run = useMemo(() => runProp ?? defaultRunner(workspace), [runProp, workspace]);
  const store = useMemo(() => storeProp ?? new CredentialStore(), [storeProp]);
  const drivers = useMemo(() => driversProp ?? defaultDrivers(), [driversProp]);

  const [lzs, setLzs] = useState<LzConnection[]>([]);
  const [legacy, setLegacy] = useState({ aws: 0, azure: 0 });
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [phase, setPhase] = useState<Phase>('list');
  // #4229 / #4230: the sub-steps of Add scope have their own guidance.
  const phaseGuidanceBase = lzConnectionsPhaseGuidance(phase);
  const [action, setAction] = useState<ConnectionAction>('add-lz');
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [credIdx, setCredIdx] = useState(0);
  const [removeScope, setRemoveScope] = useState<string | undefined>(undefined);
  const [migrate, setMigrate] = useState<{ lzId: string; provider: 'aws' | 'azure'; scopeId: string } | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [probe, setProbe] = useState<ProbeSummaryLine[]>([]);
  const [resultTitle, setResultTitle] = useState('');
  const [resultOk, setResultOk] = useState(true);
  // #4459: a registration whose session token has expired is a warning, not a green success.
  const [resultWarn, setResultWarn] = useState(false);
  const [error, setError] = useState('');
  // #4459: the AWS SSO refresh: the scope, the profiles to choose from, the live lines (URL and code) and the abort.
  const [refreshTarget, setRefreshTarget] = useState<{ lzId: string; scopeId: string } | null>(null);
  const [ssoChoices, setSsoChoices] = useState<AwsSsoProfile[]>([]);
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const refreshAbort = useRef<AbortController | null>(null);
  // #4496: the profile a refresh signed in with, when it differs from the stored aws_profile of the scope.
  const [profileOffer, setProfileOffer] = useState<{ lzId: string; scopeId: string; profile: string } | null>(null);
  const guidanceOpen = useRef(false);
  // #4299 (Design 126 section 7.5): an open guidance box takes Esc only; every other key keeps working.
  // Embedded, the wizard draws the box (its open flag); standalone, the screen's own box sets the ref.
  // #4394: embedded, the state of the wizard's guidance owner (useGuidanceOpen).
  const wizardGuidance = useGuidanceOpen();
  const guidanceIsOpen = (): boolean => (embedded ? wizardGuidance.isOpen() : guidanceOpen.current);
  const [menuGuidance, setMenuGuidance] = useState<GuidanceEntry | undefined>(undefined);
  const header = useScreenHeader('Landing Zone Connections');

  // #4299: in the Setup Wizard the list leaves Esc to the wizard (abort); the forms own it (cancel to the list).
  const escapeCaptureRef = useRef(onEscapeCaptureChange);
  escapeCaptureRef.current = onEscapeCaptureChange;
  useEffect(() => { if (embedded) escapeCaptureRef.current?.(phase !== 'list'); }, [embedded, phase]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await describeLandingZones(workspace, store, new Date(), (p) => drivers.find((d) => d.provider === p));
        let counts = { aws: 0, azure: 0 };
        try { counts = legacyCredentialCounts(store); } catch { /* vault unreadable: no migration offer */ }
        if (cancelled) return;
        setLzs(found);
        setLegacy(counts);
        setLoadError('');
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [workspace, store, drivers, reload]);

  const refreshScopes = awsSessionKeyScopes(lzs);
  const actions = visibleActions(legacy, refreshScopes.length);
  // #4458: id, name and type of each app, applications first (lzAppLinkRows).
  const appRows = useMemo(() => readLzAppLinkApps(workspace), [workspace, reload]);
  const apps = useMemo(() => appRows.map((a) => a.id), [appRows]);
  const migrations = migrationTargets(legacy, lzs);
  const fields: { field: LzCredentialField; required: boolean }[] = draft.auth
    ? [...draft.auth.required.map((f) => ({ field: f, required: true })), ...draft.auth.optional.map((f) => ({ field: f, required: false }))]
    : [];
  const driverOf = (provider: string): ConnectionDriverInfo | undefined => drivers.find((d) => d.provider === provider);
  // #4232: stored credential sets of the chosen provider and auth method (names only; no value is read).
  const reuseSets = (d: Draft): StoredCredentialSet[] => {
    if (!d.auth) return [];
    let keys: string[] = [];
    try { keys = Object.keys(store.loadSync()); } catch { return []; }
    return reusableCredentialSets(keys, { provider: d.provider, auth: d.auth, lzId: d.lzId, scopeId: d.scopeId }, drivers, lzs);
  };
  const reuseOptions = phase === 'reuse' ? reuseSets(draft) : [];

  function backToList(refresh = false): void {
    setPhase('list');
    setCursor(0);
    setError('');
    setDraft(EMPTY_DRAFT);
    setCredIdx(0);
    setRemoveScope(undefined);
    setMigrate(null);
    if (refresh) setReload((n) => n + 1);
  }

  /** Run one CLI call and collect its output (never the stdin text). */
  async function call(args: string[], stdinText?: string): Promise<{ code: number; out: string[] }> {
    const out: string[] = [];
    const code = await run(args, (l) => out.push(l), stdinText);
    return { code, out };
  }

  async function connectAndProbe(d: Draft): Promise<void> {
    setPhase('working');
    const creds = d.credentialsFrom ? { fields: [] as string[], text: '' } : buildCredentialsStdin(d.values);
    if ('error' in creds) { setError(creds.error); setPhase('cred'); return; }
    const args = buildConnectArgs({
      lzId: d.lzId, provider: d.provider, ...(d.display ? { display: d.display } : {}),
      scopeId: d.scopeId, kind: d.kind, auth: d.auth?.id ?? '', regions: d.regions, target: d.target,
      ...(d.app ? { app: d.app } : {}),
      credentialsOnStdin: creds.fields.length > 0,
      ...(d.credentialsFrom ? { credentialsFrom: `${d.credentialsFrom.lzId}:${d.credentialsFrom.scopeId}` } : {}),
    });
    const c = await call(args, creds.fields.length > 0 ? creds.text : undefined);
    if (c.code !== 0) {
      setLines(c.out); setProbe([]); setResultOk(false); setResultWarn(false);
      setResultTitle(`Connect failed (exit ${c.code}); nothing more was done.`);
      setPhase('result');
      return;
    }
    const registered = `Landing zone ${d.lzId}, scope ${d.scopeId} registered${d.credentialsFrom ? ` with the stored credentials of ${d.credentialsFrom.lzId} / ${d.credentialsFrom.scopeId}` : creds.fields.length > 0 ? ` with ${creds.fields.length} credential field(s) in the vault` : ''}`;
    const expiredAt = expiredSessionAt(c.out);
    if (expiredAt !== null) {
      // #4459: the probe would only refuse the expired token; the result says what to do instead.
      setLines(c.out); setProbe([]); setResultOk(true); setResultWarn(true);
      setResultTitle(`${registered}, but the session token expired at ${expiredAt}; refresh it before a run${d.provider === 'aws' && d.auth?.id === 'session-keys' ? ' (Refresh the AWS SSO session in the menu)' : ''}.`);
      setPhase('result');
      return;
    }
    const p = await call(buildConnectionProbeArgs(d.lzId, d.scopeId));
    const parsed = parseConnectionProbe(p.out.join('\n'));
    setLines([...c.out, ...(parsed.length === 0 ? p.out : [])]);
    setProbe(parsed);
    setResultOk(true); setResultWarn(false);
    setResultTitle(`${registered}.`);
    setPhase('result');
  }

  async function probeLz(lzId: string): Promise<void> {
    setPhase('working');
    const p = await call(buildConnectionProbeArgs(lzId));
    const parsed = parseConnectionProbe(p.out.join('\n'));
    setProbe(parsed);
    setLines(parsed.length === 0 ? p.out : []);
    setResultOk(parsed.length > 0); setResultWarn(false);
    setResultTitle(parsed.length > 0 ? `Probe of landing zone ${lzId}` : `Probe of landing zone ${lzId} failed (exit ${p.code}).`);
    setPhase('result');
  }

  async function runMigration(m: { lzId: string; provider: 'aws' | 'azure'; scopeId: string }): Promise<void> {
    const lz = lzs.find((l) => l.id === m.lzId);
    const sc = lz?.scopes.find((s) => s.id === m.scopeId);
    if (!lz || !sc) return;
    setPhase('working');
    // The registration is passed unchanged, so only the keys move.
    const c = await call(buildConnectArgs({ lzId: lz.id, provider: lz.provider, scopeId: sc.id, kind: sc.kind, auth: sc.auth, regions: sc.regions, ...(sc.target ? { target: sc.target } : {}), ...(sc.app ? { app: sc.app } : {}), credentialsOnStdin: false, moveLegacyCredentials: true }));
    setLines(c.out); setProbe([]); setResultOk(c.code === 0); setResultWarn(false);
    setResultTitle(c.code === 0 ? `Legacy ${providerLabel(m.provider)} credentials moved to scope ${sc.id} of ${lz.id}.` : `Migration failed (exit ${c.code}).`);
    setPhase('result');
  }

  async function runRefresh(t: { lzId: string; scopeId: string }, profile: string): Promise<void> {
    const ctl = new AbortController();
    refreshAbort.current = ctl;
    setLiveLines([]);
    setPhase('refreshing');
    const out: string[] = [];
    const code = await run(buildRefreshArgs(t.lzId, t.scopeId, profile), (l) => { out.push(l); setLiveLines((prev) => [...prev, l]); }, undefined, ctl.signal);
    refreshAbort.current = null;
    setLines(out); setProbe([]);
    if (ctl.signal.aborted) {
      setResultOk(true); setResultWarn(true);
      setResultTitle(`Refresh of ${t.lzId} / ${t.scopeId} stopped before the sign-in; nothing was stored.`);
    } else {
      setResultOk(code === 0); setResultWarn(false);
      setResultTitle(code === 0
        ? `AWS SSO session of ${t.lzId} / ${t.scopeId} refreshed with the profile ${profile}; the new keys are in the SWAO credential vault.`
        : `Refresh of ${t.lzId} / ${t.scopeId} failed (exit ${code}); nothing was stored.`);
      // #4496: a profile chosen in the picker that the scope does not name yet: ask to keep it.
      if (code === 0 && workspace && storedAwsProfile(workspace, t.lzId, t.scopeId) !== profile) {
        setProfileOffer({ lzId: t.lzId, scopeId: t.scopeId, profile });
        setPhase('confirm-profile');
        return;
      }
    }
    setPhase('result');
  }

  /** #4496: Yes on "Use <profile> for this scope from now on?": aws_profile through the landing zone writer (minimal patch). */
  function keepProfile(offer: { lzId: string; scopeId: string; profile: string }): void {
    try {
      if (workspace) storeScopeAwsProfile(workspace, offer.lzId, offer.scopeId, offer.profile);
      setResultTitle((s) => `${s} The profile ${offer.profile} is stored as aws_profile of ${offer.lzId} / ${offer.scopeId}; the next refresh uses it.`);
    } catch (e) {
      setResultWarn(true);
      setResultTitle((s) => `${s} The profile could not be stored: ${(e as Error).message}`);
    }
    setProfileOffer(null);
    setPhase('result');
  }

  async function removeSelected(lzId: string, scopeId: string | undefined): Promise<void> {
    setPhase('working');
    const c = await call(buildRemoveArgs(lzId, scopeId));
    setLines(c.out); setProbe([]); setResultOk(c.code === 0); setResultWarn(false);
    setResultTitle(c.code === 0 ? 'Removed.' : `Remove failed (exit ${c.code}).`);
    setPhase('result');
  }

  function chooseAction(id: ConnectionAction | 'continue'): void {
    if (id === 'continue') { onBack(); return; }
    setError('');
    const reason = actionDisabledReason(id, lzs.length);
    if (reason) { setError(`${actionLabel(id)}: ${reason}; choose 1 Add landing zone.`); return; }
    setAction(id);
    setCursor(0);
    switch (id) {
      case 'add-lz':
        if (drivers.length === 0) { setError('No live landing zone driver in this build (Q-21: only live-verified drivers are registered).'); return; }
        setDraft(EMPTY_DRAFT);
        setPhase('provider');
        return;
      case 'add-scope':
      case 'probe':
      case 'remove':
        setPhase('pick-lz');
        return;
      case 'refresh-sso':
        setPhase('pick-refresh');
        return;
      case 'migrate':
        if (migrations.length === 0) { setError('Legacy credentials found, but no AWS or Azure landing zone is registered to move them to. Add one first (1).'); return; }
        setPhase('pick-migrate');
        return;
      default: {
        const never: never = id;
        return never;
      }
    }
  }

  useInput((_input, key) => {
    // #4230 / #4299: an open guidance box owns Esc, PgUp and PgDn only; every other key keeps working.
    if (guidanceOwnsKey(key, guidanceIsOpen())) return;
    if (phase === 'working') return;
    switch (phase) {
      case 'refreshing': {
        // #4459: Esc stops waiting for the sign-in; the CLI stores nothing then.
        if (key.escape) refreshAbort.current?.abort();
        return;
      }
      case 'pick-refresh': case 'pick-sso-profile': {
        if (key.escape) backToList();
        return;
      }
      case 'list': {
        // The menu is a SelectInput (arrows, numbers, Enter). Esc goes back outside the setup; inside it Esc is the wizard's.
        if (key.escape && !embedded) onBack();
        return;
      }
      case 'auth': {
        if (key.escape) { setCursor(0); setPhase('kind'); }
        return;
      }
      case 'provider': case 'pick-lz': case 'kind': case 'app': case 'reuse': case 'pick-migrate': case 'pick-remove': {
        // #4257: the sub-step pickers are the central SelectInput (arrows, Enter); Esc cancels the form.
        if (key.escape) backToList();
        return;
      }
      case 'confirm':
      case 'confirm-remove': {
        // #4299: Enter and the Left arrow belong to the ConfirmPanel; Esc cancels.
        if (key.escape) { if (phase === 'confirm') backToList(); else setPhase('pick-remove'); }
        return;
      }
      case 'confirm-profile': {
        // #4496: Esc is No: the refresh result without storing the profile.
        if (key.escape) { setProfileOffer(null); setPhase('result'); }
        return;
      }
      case 'result': {
        if (key.return || key.escape) backToList(true);
        return;
      }
      case 'lz-id': case 'display': case 'scope-id': case 'regions': case 'target': case 'cred': {
        // Text phases: the input component takes the keys; Esc cancels the form.
        if (key.escape) backToList();
        return;
      }
      default: {
        const never: never = phase;
        return never;
      }
    }
  });

  // #4257 (Design 126 section 4.2): what Enter does on each sub-step picker; the row index is the option value.
  const pickProvider = (i: number): void => {
    const d = drivers[i];
    if (!d) return;
    setDraft({ ...EMPTY_DRAFT, provider: d.provider });
    setCursor(0);
    setPhase('lz-id');
  };
  const pickLz = (i: number): void => {
    const lz = lzs[i];
    if (!lz) return;
    setCursor(0);
    if (action === 'probe') { void probeLz(lz.id); return; }
    if (action === 'remove') { setDraft({ ...EMPTY_DRAFT, lzId: lz.id, provider: lz.provider, existingScopes: lz.scopes }); setPhase('pick-remove'); return; }
    if (!driverOf(lz.provider)) { setError(`No live driver for ${providerLabel(lz.provider)} in this build.`); return; }
    // #4229: the kind, login and locator come first; the scope id is proposed from them afterwards.
    setDraft({ ...EMPTY_DRAFT, lzId: lz.id, provider: lz.provider, existingScopes: lz.scopes });
    setPhase('kind');
  };
  const pickKind = (i: number): void => {
    const kind = availableKinds(draft.existingScopes)[i];
    if (!kind) return;
    setDraft((d) => ({ ...d, kind }));
    setCursor(0);
    setPhase('auth');
  };
  const pickAuth = (i: number): void => {
    const method = driverOf(draft.provider)?.authMethods[i];
    if (!method) return;
    setDraft((d) => ({ ...d, auth: method, values: {} }));
    setCursor(0);
    setTypeRegions(false);
    setPhase('regions');
  };
  const pickApp = (i: number): void => {
    // #4229: the scope id is proposed from the kind, the linked app or the locator, then confirmed.
    const app = [undefined, ...apps][i];
    setDraft((d) => ({ ...d, app, scopeId: proposeScopeId(d.kind, d.target, app, d.existingScopes) }));
    setCursor(0);
    setPhase('scope-id');
  };
  const pickReuse = (i: number): void => {
    // #4232: confirm a stored credential set of the same provider and auth method, or enter new ones.
    const set = reuseOptions[i];
    setCursor(0);
    if (set) { setDraft((d) => ({ ...d, credentialsFrom: { lzId: set.lzId, scopeId: set.scopeId }, values: {} })); setPhase('confirm'); }
    else { setDraft((d) => { const { credentialsFrom: _drop, ...rest } = d; return rest; }); setPhase('cred'); }
  };
  const pickMigrate = (i: number): void => {
    const m = migrations[i];
    if (!m) return;
    setMigrate(m);
    void runMigration(m);
  };
  // #4459: the scope, then the AWS profile (skipped when one fits), then the sign-in.
  const pickRefresh = (i: number): void => {
    const t = refreshScopes[i];
    if (!t) return;
    let profiles: AwsSsoProfile[] = [];
    try {
      profiles = ssoProfilesProp ? ssoProfilesProp(t.lzId, t.scopeId) : workspace ? awsSsoProfilesForScope({ workspaceRoot: workspace, lzId: t.lzId, scopeId: t.scopeId }) : [];
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setRefreshTarget({ lzId: t.lzId, scopeId: t.scopeId });
    setCursor(0);
    if (profiles.length === 0) {
      setLines([]); setProbe([]); setResultOk(true); setResultWarn(true);
      setResultTitle(`No AWS SSO profile for the account of this scope found in the AWS config file. Add one with aws configure sso, then choose Refresh the AWS SSO session again (CLI: swao lz credentials refresh ${t.lzId} ${t.scopeId} --profile <aws-profile>).`);
      setPhase('result');
      return;
    }
    if (profiles.length === 1) { void runRefresh(t, profiles[0]!.name); return; }
    setSsoChoices(profiles);
    setPhase('pick-sso-profile');
  };
  const pickSsoProfile = (i: number): void => {
    const p = ssoChoices[i];
    if (!p || !refreshTarget) return;
    void runRefresh(refreshTarget, p.name);
  };
  const pickRemove = (i: number): void => {
    setRemoveScope([undefined, ...draft.existingScopes.map((s) => s.id)][i]);
    setPhase('confirm-remove');
  };

  // #4257 (Design 126 section 4.2, gate G-02): every sub-step list is the central SelectInput,
  // bounded, without its own hint line (block 7 is the screen's); the cursor feeds the guidance and
  // is where a picker starts again after a step back (Remove: Esc on the confirmation keeps the scope).
  // A row's `note` is a longer explanation: it is shown in full, wrapped, under the list for the
  // highlighted row instead of being cut in the second column (Design 126 section 8 rule 5).
  const picker = (label: string, rows: ReadonlyArray<{ label: string; detail?: string; note?: string }>, onPick: (i: number) => void, opts: { filter?: boolean; itemNoun?: string } = {}): JSX.Element => {
    const note = rows[cursor]?.note;
    return (
      <Box key={phase} flexDirection="column">
        <SelectInput
          label={label}
          options={rows.map((r, i): SelectOption => ({ label: r.label, value: String(i), ...(r.detail ? { detail: r.detail } : {}) }))}
          visibleCount={PICKER_VISIBLE_COUNT}
          initialIndex={cursor}
          {...(opts.filter ? { filter: true, itemNoun: opts.itemNoun ?? 'entries' } : {})}
          showKeyHints={false}
          onCursorChange={(v) => setCursor(Number(v) || 0)}
          onSelect={(v) => onPick(Number(v))}
        />
        {note ? <Box marginLeft={PICKER_ROW_INDENT}><Text {...tone('muted')} wrap="wrap">{note}</Text></Box> : null}
      </Box>
    );
  };

  const credText = (s: LzConnection['scopes'][number]): string => {
    switch (s.credentials) {
      case 'ok': return `credentials stored (${s.storedFields.length} field(s))`;
      case 'missing': return `credentials missing: ${s.missingFields.join(', ')}`;
      case 'expired': return 'token expired';
      case 'unknown-auth': return `unknown auth method ${s.auth}`;
      case 'no-driver': return 'no driver in this build';
      default: {
        const never: never = s.credentials;
        return never;
      }
    }
  };

  const current = fields[credIdx];

  // #4299: the menu, numbered 1 to n by position; "Continue the setup" last in the Setup Wizard only.
  const menuOptions: SelectOption[] = [
    ...actions.map((a): SelectOption => {
      const reason = actionDisabledReason(a.id, lzs.length);
      return { label: a.label, value: a.id, guidance: LZ_CONNECTIONS_ACTION_GUIDANCE[a.id], ...(reason ? { detail: reason } : {}) };
    }),
    ...(embedded ? [{ label: 'Continue the setup', value: 'continue', guidance: LZ_CONNECTIONS_ACTION_GUIDANCE.continue }] : []),
  ];

  const screenGuidance: GuidanceEntry = {
    title: 'Landing Zone Connections',
    what: 'Register the live landing zones SWAO assesses and their scopes: the Platform landing zone (PLZ) and the Application landing zones (ALZ). The registration is written to .swao.yml; credentials go to the SWAO credential vault and are never written to a file or shown on screen.',
    sections: LZ_CONNECTIONS_GUIDANCE.map((d) => ({ label: d.label, text: d.value })),
    cli: 'swao lz connect / probe / list / remove',
  };
  // #4298 / #4299: the vault key names, the role list and the connect output are guidance, not body text.
  const credGuidance: GuidanceEntry | undefined = phase === 'cred' && current
    ? {
      title: 'Credentials',
      what: `Each field is entered masked and stored in the SWAO credential vault of your user as lz:${draft.lzId}:${draft.scopeId}:${current.field}; it is never shown or written to a file.`,
      sections: [{ label: 'Fields', text: fields.map((f) => `${f.field}${f.required ? '' : ' (optional)'}`).join(', ') }],
    }
    : undefined;
  // #4230: the guidance of the highlighted row of a picker sub-step; the box follows the cursor.
  const rowGuidance = ((): GuidanceEntry | undefined => {
    switch (phase) {
      case 'provider': { const d = drivers[cursor]; return d ? lzProviderGuidance(d.provider, providerLabel(d.provider, 'full'), d.authMethods) : undefined; }
      case 'pick-lz': { const l = lzs[cursor]; return l ? lzPickLandingZoneGuidance(l, providerLabel(l.provider, 'full'), action) : undefined; }
      case 'kind': { const k = availableKinds(draft.existingScopes)[cursor]; return k ? lzScopeKindGuidance(k) : undefined; }
      case 'auth': { const m = driverOf(draft.provider)?.authMethods[cursor]; return m ? lzAuthMethodGuidance(m) : undefined; }
      case 'app': return cursor === 0 ? lzAppLinkGuidance(undefined) : apps[cursor - 1] !== undefined ? lzAppLinkGuidance(apps[cursor - 1]) : undefined;
      case 'pick-migrate': { const m = migrations[cursor]; return m ? lzMigrateTargetGuidance(m, legacy[m.provider]) : undefined; }
      case 'pick-remove': {
        if (cursor === 0) return lzRemoveTargetGuidance(draft.lzId, undefined);
        const sc = draft.existingScopes[cursor - 1];
        return sc ? lzRemoveTargetGuidance(draft.lzId, sc.id) : undefined;
      }
      default: return undefined;
    }
  })();
  // #4299: one guidance entry per stored-credential option (#4232) and for "Enter new credentials".
  const reuseSet = phase === 'reuse' ? reuseOptions[cursor] : undefined;
  const reuseGuidance: GuidanceEntry | undefined = phase !== 'reuse'
    ? undefined
    : reuseSet
      ? {
        title: `Stored credentials of ${reuseSet.lzId} / ${reuseSet.scopeId}`,
        what: `Copies the ${reuseSet.fields.length} stored field(s) (${reuseSet.fields.join(', ')}) of ${reuseSet.lzId} / ${reuseSet.scopeId} to this scope in the SWAO credential vault; no value is shown or typed again.`,
        sections: [{ label: 'Vault keys', text: `from lz:${reuseSet.lzId}:${reuseSet.scopeId}:* to lz:${draft.lzId}:${draft.scopeId}:*` }],
      }
      : { title: 'Enter new credentials', what: 'Asks for each credential field of the auth method, masked, and stores them in the SWAO credential vault for this scope only.' };
  const guidance: GuidanceEntry = phase === 'list'
    ? menuGuidance ?? screenGuidance
    : phase === 'result'
      ? (resultOk ? resultGuidance(probe, lines) : { title: 'Result', what: 'The call failed; the lines shown are its output. Nothing more was done.' })
      : credGuidance ?? rowGuidance ?? reuseGuidance ?? phaseGuidanceBase ?? screenGuidance;
  // #4494: the Add scope regions come from the provider catalogue, grouped by country, when it knows them.
  // The last row of the picker switches to the free-text input (a region the catalogue does not list).
  const [typeRegions, setTypeRegions] = useState(false);
  const catalogueRegions = useMemo<LzGeographyRegion[]>(() => {
    if (phase !== 'regions' || !draft.provider || !workspace || typeRegions) return [];
    try { return defaultLzRegionLoader(draft.provider, workspace) as LzGeographyRegion[]; } catch { return []; }
  }, [phase, draft.provider, workspace, typeRegions]);
  const keys = phase === 'regions' && catalogueRegions.length > 0 ? GROUPED_REGION_KEYS : keysFor(phase, embedded);

  const confirmRows: DetailRowProps[] = [
    { label: 'Landing zone', value: `${draft.lzId} (${providerWithDisplay(draft.provider, draft.display)})` },
    { label: 'Scope', value: `${draft.scopeId}: ${scopeKindLabel(draft.kind)}` },
    { label: 'Auth', value: `${draft.auth?.id ?? ''}${draft.regions.length > 0 ? `, regions ${draft.regions.join(', ')}` : ''}${draft.app ? `, app ${draft.app}` : ''}` },
    {
      label: 'Credentials',
      value: draft.credentialsFrom
        ? `the stored set of ${draft.credentialsFrom.lzId} / ${draft.credentialsFrom.scopeId}, copied to this scope`
        : `fields ${Object.entries(draft.values).filter(([, v]) => (v ?? '').trim() !== '').map(([f]) => f).join(', ') || 'none (store them later)'}`,
    },
    { label: 'Next', value: 'the read-only probe runs and only reports; SWAO never writes to the tenant' },
  ];

  const body = (
    <Box flexDirection="column">
      {!workspace && <Text {...tone('warning')}>No SWAO workspace found. Run Workspace Setup first.</Text>}
      {loadError ? <Text {...tone('error')}>{loadError}</Text> : null}

      {phase === 'list' && workspace && (
        <Box flexDirection="column">
          {lzs.length === 0
            ? <Text {...tone('muted')}>No landing zone registered in .swao.yml yet.</Text>
            : (
              // #4254 (Design 126 section 3 margin, A-03): one left margin; the list rows indent
              // two columns under their label (as SelectInput rows) and a long scope line wraps
              // under its own text, never back to column 0.
              <Box flexDirection="column">
                <Text>Registered landing zones:</Text>
                {lzs.map((l) => (
                  <Box key={l.id} flexDirection="column" paddingLeft={LZ_LIST_INDENT}>
                    <Text wrap="wrap"><Text bold>{l.id}</Text><Text {...tone('muted')}>{`  ${lzListDetail(l)}`}</Text></Text>
                    {l.scopes.map((sc) => (
                      <Box key={sc.id} paddingLeft={LZ_LIST_INDENT}>
                        <Box flexShrink={0} width={scopeIdWidth(l.scopes) + 2}><Text {...tone('muted')}>{sc.id}</Text></Box>
                        <Box flexGrow={1} flexShrink={1}><Text {...tone('muted')} wrap="wrap">{`${scopeKindLabel(sc.kind)}, auth ${sc.auth}${sc.regions.length > 0 ? `, ${sc.regions.join(' ')}` : ''}; ${credText(sc)}`}</Text></Box>
                      </Box>
                    ))}
                  </Box>
                ))}
              </Box>
            )}
          {legacy.aws + legacy.azure > 0 && <Text {...tone('warning')}>{`Legacy LZR credentials in the vault: ${legacy.aws} AWS, ${legacy.azure} Azure key(s) (Pass 23 names, no longer read).`}</Text>}
          <Box marginTop={1}>
            {/* #4111: actions that need a landing zone stay in the menu with the reason, until one exists. */}
            <SelectInput
              label="Landing Zone Connections"
              options={menuOptions}
              numbered
              visibleCount={menuOptions.length}
              showKeyHints={false}
              onCursorChange={(_v, o) => setMenuGuidance(o?.guidance)}
              onSelect={(v) => chooseAction(v as ConnectionAction | 'continue')}
            />
          </Box>
        </Box>
      )}

      {phase === 'provider' && (
        // #4296: abbreviation and full name from the central map; the id stays the key.
        picker('Provider of the landing zone', drivers.map((d) => ({ label: providerColumns(d.provider), detail: d.authMethods.map((m) => m.id).join(', ') })), pickProvider)
      )}
      {phase === 'lz-id' && (
        <TextInput key="lz-id" label="Short name for this landing zone, used in file names and reports, for example otc-prod" initialValue={`${draft.provider}-prod`} onSubmit={(v) => {
          const bad = validateRegistrationId(v, 'landing zone id');
          if (bad) { setError(bad); return; }
          if (lzs.some((l) => l.id === v)) { setError(`landing zone ${v} is registered already; use 2 Add scope`); return; }
          setError(''); setDraft((d) => ({ ...d, lzId: v })); setPhase('display');
        }} />
      )}
      {phase === 'display' && (
        <TextInput key="display" label="Display name (keep it, change it, or clear it to skip)" initialValue={providerLabel(draft.provider, 'full')} onSubmit={(v) => {
          setDraft((d) => ({ ...d, display: v || undefined }));
          setCursor(0);
          setPhase('kind');
        }} />
      )}
      {phase === 'pick-lz' && (
        picker('Landing zone', lzs.map((l) => ({ label: l.id, detail: `${providerLabel(l.provider)}; ${l.scopes.length} scope(s)` })), pickLz)
      )}
      {phase === 'scope-id' && (
        <TextInput key="scope-id" label="Short name for this scope, used in file names and reports; lower case letters, digits and hyphens" initialValue={draft.scopeId} onSubmit={(v) => {
          const bad = validateRegistrationId(v, 'scope id');
          if (bad) { setError(bad); return; }
          if (draft.existingScopes.some((sc) => sc.id === v)) { setError(`scope ${v} exists already; remove it first to change it`); return; }
          const next = { ...draft, scopeId: v };
          setError(''); setDraft(next); setCursor(0); setCredIdx(0);
          setPhase(fields.length === 0 ? 'confirm' : reuseSets(next).length > 0 ? 'reuse' : 'cred');
        }} />
      )}
      {phase === 'kind' && (
        picker('Scope kind', availableKinds(draft.existingScopes).map((k) => ({ label: SCOPE_KIND_LABELS[k], note: SCOPE_KIND_DEFINITIONS[k] })), pickKind)
      )}
      {phase === 'auth' && (
        picker('Auth method', (driverOf(draft.provider)?.authMethods ?? []).map((m) => ({ label: m.id, note: `Needs ${m.required.join(', ')}${m.optional.length > 0 ? `; optional ${m.optional.join(', ')}` : ''}.` })), pickAuth)
      )}
      {phase === 'regions' && catalogueRegions.length > 0 && (
        <GroupedRegionPicker key="regions-grouped" regions={catalogueRegions} initial={draft.regions} onType={() => setTypeRegions(true)} onConfirm={(regions) => {
          setError(''); setDraft((d) => ({ ...d, regions })); setPhase('target');
        }} />
      )}
      {phase === 'regions' && catalogueRegions.length === 0 && (
        <TextInput key="regions" label="Regions (comma separated, Enter for all)" onSubmit={(v) => {
          const r = parseRegions(v);
          if ('error' in r) { setError(r.error); return; }
          setError(''); setTypeRegions(false); setDraft((d) => ({ ...d, regions: r.regions })); setPhase('target');
        }} />
      )}
      {phase === 'target' && (
        <TextInput key="target" label="Scope locator, for example project=eu-de_payments (optional; leave it empty to skip)" onSubmit={(v) => {
          const t = parseTargets(v);
          if ('error' in t) { setError(t.error); return; }
          setError(''); setDraft((d) => ({ ...d, target: t.target })); setCursor(0);
          setPhase('app');
        }} />
      )}
      {phase === 'app' && (
        picker('Link the scope to an app (optional)', [{ label: 'no app link' }, ...lzAppLinkRows(appRows)], pickApp, { filter: apps.length > 9, itemNoun: 'apps' })
      )}
      {phase === 'reuse' && (
        <Box flexDirection="column">
          {picker(
            `Stored ${providerLabel(draft.provider)} credentials (${draft.auth?.id ?? ''}) in your SWAO credential vault`,
            [...reuseOptions.map((o) => ({ label: `Use the stored credentials of ${o.lzId} / ${o.scopeId}`, detail: `${o.auth}, ${o.fields.length} field(s)` })), { label: 'Enter new credentials' }],
            pickReuse,
          )}
          <Text {...tone('muted')}>The vault is per user (every workspace) and keyed by landing zone and scope; values are never shown.</Text>
        </Box>
      )}
      {phase === 'cred' && current && (
        <Box flexDirection="column">
          <Text {...tone('muted')}>{`Credential ${credIdx + 1} of ${fields.length}; stored in the SWAO credential vault for ${draft.lzId} / ${draft.scopeId}, never shown.`}</Text>
          <PasswordInput key={`cred-${current.field}`} label={`${current.field}${current.required ? '' : ' (optional; leave it empty to skip)'}`} onSubmit={(v) => {
            if (current.required && v.trim() === '') { setError(`${current.field} is required`); return; }
            setError('');
            setDraft((d) => ({ ...d, values: { ...d.values, [current.field]: v } }));
            if (credIdx + 1 < fields.length) setCredIdx((n) => n + 1);
            else setPhase('confirm');
          }} />
        </Box>
      )}
      {phase === 'confirm' && (
        <ConfirmPanel title="Register this scope?" rows={confirmRows} onConfirm={() => { void connectAndProbe(draft); }} onBack={() => backToList()} />
      )}
      {phase === 'pick-migrate' && (
        picker('Move the legacy keys to the scope', migrations.map((m) => ({ label: `${m.lzId} / ${m.scopeId}`, detail: `${providerLabel(m.provider)}; ${legacy[m.provider]} key(s)` })), pickMigrate)
      )}
      {phase === 'pick-remove' && (
        picker(`Remove from landing zone ${draft.lzId}`, [undefined, ...draft.existingScopes.map((sc) => sc.id)].map((sc) => ({ label: sc === undefined ? 'the whole landing zone' : `scope ${sc}` })), pickRemove)
      )}
      {phase === 'confirm-remove' && (
        <ConfirmPanel
          title={removeScope === undefined ? `Remove landing zone ${draft.lzId}?` : `Remove scope ${removeScope} of ${draft.lzId}?`}
          rows={[{ label: 'Kept', value: `run data under landing-zones/${draft.lzId}/` }]}
          risk="Its keys are deleted from the SWAO credential vault and its registration from .swao.yml."
          onConfirm={() => { void removeSelected(draft.lzId, removeScope); }}
          onBack={() => setPhase('pick-remove')}
        />
      )}
      {phase === 'pick-refresh' && (
        picker('Scope to refresh', refreshScopes.map((t) => ({ label: `${t.lzId} / ${t.scopeId}`, detail: t.expired ? 'token expired' : 'session keys' })), pickRefresh)
      )}
      {phase === 'pick-sso-profile' && (
        picker('AWS profile for the sign-in', ssoChoices.map((p) => ({ label: p.name, detail: `role ${p.roleName}, SSO region ${p.ssoRegion}` })), pickSsoProfile)
      )}
      {phase === 'refreshing' && (
        <Box flexDirection="column">
          <Text {...tone('muted')}>{`Refreshing the AWS SSO session of ${refreshTarget?.lzId ?? ''} / ${refreshTarget?.scopeId ?? ''}; Esc stops waiting.`}</Text>
          {/* #4496: the sign-in URL and the code on full-width lines of their own, no indent, no frame: the URL copies as one piece. */}
          {liveLines.map((l, i) => (isSignInUrlLine(l)
            ? <Box key={i} marginTop={1}><Text bold>{l.trim()}</Text></Box>
            : isSignInCodeLine(l)
              ? <Box key={i} marginBottom={1}><Text bold>{l.trim()}</Text></Box>
              : <Text key={i} wrap="wrap">{l}</Text>))}
        </Box>
      )}
      {phase === 'confirm-profile' && profileOffer && (
        <ConfirmPanel
          title={`Use ${profileOffer.profile} for this scope from now on?`}
          rows={[
            { label: 'Scope', value: `${profileOffer.lzId} / ${profileOffer.scopeId}` },
            { label: 'Stored', value: 'aws_profile in .swao.yml, a profile name only' },
          ]}
          onConfirm={() => keepProfile(profileOffer)}
          onBack={() => { setProfileOffer(null); setPhase('result'); }}
        />
      )}
      {phase === 'working' && <Text {...tone('muted')}>{migrate ? `Moving ${providerLabel(migrate.provider)} keys...` : 'Working...'}</Text>}
      {phase === 'result' && (
        <Box flexDirection="column">
          <Text {...tone(!resultOk ? 'error' : resultWarn ? 'warning' : 'ok')}>{resultTitle}</Text>
          {/* #4298: one StatusRow per scope, the same level and words as the Setup Probe step; no identity, no CLI flag. */}
          {probe.map((p) => {
            const r = probeRow(p.readOnly, coverageOf(p));
            return <StatusRow key={p.scopeId} level={r.level} label={`Scope ${p.scopeId}`} summary={r.summary} detail={r.detail} />;
          })}
          {!resultOk || resultWarn ? lines.slice(-6).map((l, i) => <Text key={i} {...tone('muted')}>{l}</Text>) : null}
        </Box>
      )}
      {error ? <Text {...tone('error')}>{error}</Text> : null}
    </Box>
  );

  const subtitle = 'Landing zones and their scopes; SWAO only reads, credentials stay in the SWAO credential vault.';
  if (embedded) {
    // #4299: in the Setup Wizard the frame (title, key hints above the guidance box) is the wizard's ScreenLayout.
    return <SetupStepFrame title="Landing Zone Connections" subtitle={subtitle} keys={keys} guidance={guidance}>{body}</SetupStepFrame>;
  }
  return (
    <ScreenLayout
      header={header}
      title={{ title: 'Landing Zone Connections', subtitle }}
      keys={keys}
      guidance={{ entry: guidance, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpen.current = open; } }}
    >
      {body}
    </ScreenLayout>
  );
}

/** #4496: the aws_profile of a registered scope; undefined when unset or the file is unreadable. */
export function storedAwsProfile(workspace: string, lzId: string, scopeId: string): string | undefined {
  try {
    return readLandingZones(workspace).find((l) => l.id === lzId)?.scopes.find((s) => s.id === scopeId)?.aws_profile;
  } catch {
    return undefined;
  }
}

/** #4254 (Design 126 section 3): list rows indent two columns under their label, as SelectInput rows do. */
export const LZ_LIST_INDENT = 2;

/** #4254: the provider, display name and driver note of a registered landing zone row. */
export function lzListDetail(l: Pick<LzConnection, 'provider' | 'display' | 'driverAvailable'>): string {
  return `${providerWithDisplay(l.provider, l.display)}${l.driverAvailable ? '' : ', no live driver in this build'}`;
}

/**
 * #4496: the provider label, then the display name only when it adds
 * something: the default display name is the provider's full name, which the
 * label names already ("STACKIT; STACKIT", "AWS, Amazon Web Services; Amazon
 * Web Services" before).
 */
export function providerWithDisplay(provider: string, display: string | undefined): string {
  const label = providerLabel(provider);
  const d = (display ?? '').trim();
  if (d === '' || label.toLowerCase().includes(d.toLowerCase())) return label;
  return `${label}; ${d}`;
}

/** #4254: the scope id column of a landing zone: as wide as its longest scope id. */
export function scopeIdWidth(scopes: ReadonlyArray<{ id: string }>): number {
  return Math.max(0, ...scopes.map((s) => s.id.length));
}

/** #4494: the key hints of the grouped region picker of Add scope. */
export const GROUPED_REGION_KEYS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'cancel' }];

/** #4299 (Design 126 section 7.9): the key hints of each phase; Esc cancels a form, on the list it is the wizard's abort or back. */
export function keysFor(phase: Phase, embedded: boolean): readonly KeyHint[] {
  switch (phase) {
    case 'list':
      return embedded ? KEY_HINTS.menu : [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }];
    case 'provider': case 'pick-lz': case 'kind': case 'auth': case 'app': case 'reuse': case 'pick-migrate': case 'pick-remove':
    case 'pick-refresh': case 'pick-sso-profile':
      return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'cancel' }];
    case 'lz-id': case 'display': case 'scope-id': case 'regions': case 'target': case 'cred':
      return [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'cancel' }];
    case 'confirm': case 'confirm-remove': case 'confirm-profile':
      return [{ key: 'Enter', verb: 'confirm' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'cancel' }];
    case 'result':
      return [{ key: 'Enter', verb: 'back' }];
    case 'refreshing':
      return [{ key: 'Esc', verb: 'cancel' }];
    case 'working':
      return [];
    default: {
      const never: never = phase;
      return never;
    }
  }
}
