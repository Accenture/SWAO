// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (TUI-11, Design 126 sections 3, 7 and 14): on ScreenLayout with the
// step bar and the licence line (A-21); Esc aborts through useFlowNavigation
// (AbortDialog once a landing zone is chosen), the left arrow goes back one
// step; the letter keys of the old screen are list entries (section 7.10).
//
// #3588: Landing Zone Live Assessment screen (Design 120 section 14.3):
// select landing zone, select scopes, read-only probe, select community
// frameworks, run (crawl + evaluate per scope), done menu. Every step maps to
// a CLI flag (lz-live-flow.ts); the screen runs the CLI, so a TUI run and a
// CLI run produce the same run folder.
//
// Write-capable credential (Design 120 section 6.3, owner decision
// 2026-11-02): a `refused` probe offers "continue with a write-capable
// credential for this run" behind an explicit second confirmation; it maps
// to --accept-write-capable-credentials and is never remembered.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { LicenseGuard, findWorkspace, selfSpawnCommand, providerLabel, lzScopeKindLabel, treeKillPid } from '@swao/core';
import {
  ConfirmPanel, CONFIRM_PANEL_KEYS, ErrorPanel, ERROR_PANEL_KEYS, FinishPanel, FINISH_MAIN_MENU, FINISH_PANEL_KEYS, KEY_HINTS, MultiSelect, PICKER_VISIBLE_COUNT, PickerRow, RunPanel, RUN_PANEL_KEYS, ScreenLayout, SelectInput,
  errorGuidance, guidanceOwnsKey, tone, useFlowNavigation, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type LicenseStateView, type MultiSelectOption, type SelectOption,
} from '@swao/tui-kit';
import {
  LIVE_DONE_ACTIONS,
  buildLiveAssessArgs,
  buildProbeArgs,
  liveRunStageLabel,
  doneActionArgs,
  evidenceResolveArgs,
  formatLiveBaselineSummary,
  formatLiveOrganisationalSummary,
  lzIngestionFolderHint,
  readLiveEvidenceRows,
  type LiveEvidenceRow,
  parseLiveRunDir,
  readLiveBaselineSummary,
  listLiveFrameworks,
  frameworksForLz,
  parseProbeOutput,
  probeDecision,
  probeRecovery,
  readRegisteredLandingZones,
  type LiveFrameworkOption,
  type LiveLzOption,
  type ProbeDecision,
} from './lz-live-flow.js';
import { LIVE_SHOW_OUTPUT, liveFinishGuidance, liveFinishView } from './lz-live-finish.js';

/** Runs one CLI call and returns exit code and merged output (injectable for tests). */
/** #4256: the optional signal stops the child process tree (Esc cancel of a probe or a run). */
export type LiveCliRunner = (args: string[], onLine: (line: string) => void, signal?: AbortSignal) => Promise<number>;

// #4241: the central self-spawn helper; passing the script path while clearing
// PKG_EXECPATH made the binary read its snapshot path as the command.
const defaultRunner = (cwd: string | undefined): LiveCliRunner => (args, onLine, signal) => new Promise((resolve) => {
  const selfCmd = selfSpawnCommand(args, { env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const child = spawn(selfCmd.command, selfCmd.args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, windowsHide: true, env: selfCmd.env });
  // #4256 (Design 126 section 7.6): a cancel stops the child tree (by PID; taskkill /T on Windows).
  signal?.addEventListener('abort', () => { if (child.pid !== undefined) void treeKillPid(child.pid); else child.kill(); }, { once: true });
  const push = (chunk: Buffer): void => { for (const l of chunk.toString('utf-8').split('\n')) { const t = l.replace(/\r$/, ''); if (t) onLine(t); } };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  child.on('close', (code) => resolve(code ?? 1));
  child.on('error', () => resolve(1));
});

type Phase = 'lz' | 'scopes' | 'probing' | 'probe-result' | 'confirm-write' | 'frameworks' | 'running' | 'done' | 'evidence';

/** #3956: rows of the evidence list shown at once. */
const EVIDENCE_WINDOW = 12;

export interface LzLiveAssessmentScreenProps {
  onBack: () => void;
  version: string;
  /** Workspace root; defaults to the one found from the current directory. */
  workspace?: string;
  /** CLI runner; defaults to spawning this SWAO binary. */
  run?: LiveCliRunner;
  /**
   * #4127: opens Landing Zone Connections (add, probe, remove landing zones)
   * from step 1. The host passes it (the screen lives in the swao package);
   * without it step 1 points at the Landing Zone Live setup.
   */
  onManageConnections?: () => void;
}

/** #4255: the step bar of the flow (Design 126 section 4.5: names, no numbers). */
export const LZ_LIVE_STEPS = ['Landing zone', 'Scopes', 'Probe', 'Frameworks', 'Run', 'Done'] as const;

/** #4255: the step of the bar each phase belongs to. */
export const LZ_LIVE_PHASE_STEP: Readonly<Record<Phase, number>> = {
  lz: 0, scopes: 1, probing: 2, 'probe-result': 2, 'confirm-write': 2, frameworks: 3, running: 4, done: 5, evidence: 5,
};

/** The phases before the run: Esc aborts the flow, the left arrow goes back one step. */
const PRE_RUN: ReadonlySet<Phase> = new Set<Phase>(['lz', 'scopes', 'probe-result', 'confirm-write', 'frameworks']);

/** #4255 (section 7.10): step 1 entry that opens Landing Zone Connections (was the letter key a). */
export const LZ_LIVE_MANAGE = '__manage__';
/** #4255: probe answers as list entries (were the letter keys c, y and n). */
export const LZ_LIVE_PROBE_WRITE = 'write';
export const LZ_LIVE_PROBE_ACCEPT = 'accept';
export const LZ_LIVE_PROBE_BACK = 'back';

/** #4230: the guidance of one landing zone of step 1. */
export function lzOptionGuidance(l: LiveLzOption): GuidanceEntry {
  const plz = l.scopes.filter((s) => s.kind === 'platform').length;
  const alz = l.scopes.length - plz;
  return {
    title: l.display ?? l.id,
    what: `${providerLabel(l.provider)} landing zone ${l.id} with ${l.scopes.length} scope(s): ${plz} platform landing zone (PLZ) and ${alz} application landing zone (ALZ) scope(s). You choose the scopes to read next.`,
    cli: `swao assess --type landing-zone-live --lz ${l.id}`,
  };
}

/** #4230: the guidance of one scope of step 2, PLZ and ALZ in plain words. */
export function scopeOptionGuidance(scope: { id: string; kind: string }): GuidanceEntry {
  const what = scope.kind === 'platform'
    ? 'The platform landing zone (PLZ) holds the shared foundation: identity, network, logging and the policies every workload inherits. SWAO reads its settings and reports them per control.'
    : 'An application landing zone (ALZ) holds the resources of one workload on top of the platform. SWAO reads its settings and reports them for that workload.';
  return { title: `${scope.id}: ${lzScopeKindLabel(scope.kind)}`, what, cli: `--scope ${scope.id}` };
}

/** #4230: the guidance of one community framework of step 4. */
export function frameworkOptionGuidance(f: LiveFrameworkOption): GuidanceEntry {
  return {
    title: `${f.id}: ${f.name}`,
    what: f.hasServiceMapping
      ? `Version ${f.version}. The framework maps its controls to the cloud services, so every read setting is evaluated against it.`
      : `Version ${f.version}. The framework has no service mapping (service-controls.yaml), so its services stay grey (not evaluated).`,
  };
}

export function LzLiveAssessmentScreen({ onBack, version, workspace: wsProp, run: runProp, onManageConnections }: LzLiveAssessmentScreenProps): JSX.Element {
  const workspace = useMemo(() => wsProp ?? findWorkspace(process.cwd()) ?? undefined, [wsProp]);
  const run = useMemo(() => runProp ?? defaultRunner(workspace), [runProp, workspace]);
  const license = useMemo(() => {
    try { return { state: LicenseGuard.load().state as LicenseStateView, error: null as string | null }; }
    catch (e) { return { state: null as LicenseStateView | null, error: (e as Error).message }; }
  }, []);
  const lzs = useMemo<LiveLzOption[]>(() => (workspace ? readRegisteredLandingZones(workspace) : []), [workspace]);
  const frameworks = useMemo<LiveFrameworkOption[]>(() => (workspace ? listLiveFrameworks(workspace) : []), [workspace]);

  const [phase, setPhase] = useState<Phase>('lz');
  const [cursor, setCursor] = useState(0);
  const [lz, setLz] = useState<LiveLzOption | null>(null);
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [fwSel, setFwSel] = useState<Set<string>>(() => new Set(frameworks.filter((f) => f.preselected).map((f) => f.id)));
  const [decision, setDecision] = useState<ProbeDecision | null>(null);
  const [acceptWrite, setAcceptWrite] = useState(false);
  const [acceptUnverified, setAcceptUnverified] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [notice, setNotice] = useState<string>('');
  // #4256: the finish screen shows the run output or the output of a done action on request.
  const [doneOutput, setDoneOutput] = useState(false);
  const guidanceOpen = useRef(false);
  // #4256: RunPanel needs the open state of the box as state (Esc closes the box first), the
  // AbortController of the probe or run and a timer.
  const [boxOpen, setBoxOpen] = useState(false);
  const runAbortRef = useRef<AbortController | null>(null);
  const [runStart, setRunStart] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (phase !== 'probing' && phase !== 'running') return undefined;
    setRunStart(Date.now());
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  // #3956 (Design 123 section 9.5): evidence references of this run and the resolved lines of the selected one.
  const [evidence, setEvidence] = useState<LiveEvidenceRow[]>([]);
  const [resolved, setResolved] = useState<string[]>([]);
  const [runLines, setRunLines] = useState<string[]>([]);

  // #4255: Esc aborts the flow (AbortDialog once a landing zone is chosen). The
  // screen reads the keys itself (the phases are its steps), so the hook only
  // provides the dialog and the abort decision.
  const nav = useFlowNavigation({ steps: LZ_LIVE_STEPS, dirty: lz !== null, onExit: onBack, what: 'assessment', active: false });

  const scopeIds = lz ? lz.scopes.filter((s) => scopes.has(s.id)).map((s) => s.id) : [];
  // #3875 (Design 123 section 9.4): baseline summary of this run (verdicts and counts only).
  const baselineLines = useMemo(() => {
    if (phase !== 'done') return [];
    const dir = parseLiveRunDir(lines, workspace);
    if (!dir) return [];
    // #4050: organisational controls decided from landing-zones/<lz-id>/ingestion/.
    return [...formatLiveBaselineSummary(readLiveBaselineSummary(dir)), ...formatLiveOrganisationalSummary(dir)];
  }, [phase, lines, workspace]);

  // Step 3: read-only probe of the selected scopes.
  useEffect(() => {
    if (phase !== 'probing' || !lz) return;
    let cancelled = false;
    const ac = new AbortController();
    runAbortRef.current = ac;
    void (async () => {
      const out: string[] = [];
      for (const args of buildProbeArgs(lz.id, scopeIds, lz.scopes.map((s) => s.id))) {
        if (cancelled || ac.signal.aborted) return;
        await run(args, (l) => out.push(l), ac.signal);
      }
      // #4256: a cancel (RunPanel aborts before the screen leaves the phase) keeps the screen where the cancel put it.
      if (cancelled || ac.signal.aborted) return;
      const d = probeDecision(parseProbeOutput(out.join('\n')), scopeIds);
      setLines(out);
      setDecision(d);
      setCursor(0);
      setPhase(d.kind === 'proceed' ? 'frameworks' : 'probe-result');
    })();
    return () => { cancelled = true; ac.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Steps 5 and 6: crawl and evaluate through the CLI.
  useEffect(() => {
    if (phase !== 'running' || !lz) return;
    let cancelled = false;
    const ac = new AbortController();
    runAbortRef.current = ac;
    const out: string[] = [];
    setLines([]);
    void (async () => {
      const code = await run(buildLiveAssessArgs({ lzId: lz.id, scopes: scopeIds, frameworks: [...fwSel], acceptWriteCapableCredentials: acceptWrite, acceptUnverifiedReadOnly: acceptUnverified }), (l) => { out.push(l); if (!cancelled) setLines([...out]); }, ac.signal);
      if (cancelled || ac.signal.aborted) return;
      setRunLines([...out]);
      setExitCode(code);
      setCursor(0);
      setDoneOutput(false);
      setPhase('done');
    })();
    // #4256: leaving the run phase (cancel) or the screen stops the child tree.
    return () => { cancelled = true; ac.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // #4241 / #4255: a failed probe ends on ErrorPanel with recovery entries; Enter is never dead.
  const probeFailed = phase === 'probe-result' && decision?.kind === 'error';
  const recovery = useMemo(() => probeRecovery(lines, scopeIds), [lines, scopeIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const onRecovery = (value: string): void => {
    if (value === 'retry') { setPhase('probing'); return; }
    if (value === 'without-scope') {
      setScopes(new Set(recovery.answeredScopes));
      setPhase('probing');
      return;
    }
    setCursor(0);
    setPhase('scopes');
  };

  const onLzSelect = (value: string): void => {
    if (value === LZ_LIVE_MANAGE) { onManageConnections?.(); return; }
    const chosen = lzs.find((l) => l.id === value);
    if (!chosen) return;
    setLz(chosen);
    setScopes(new Set(chosen.scopes.map((s) => s.id)));
    // #4198 (Design 125 section 5.7): the frameworks stored for this landing zone.
    setFwSel((cur) => frameworksForLz(chosen, frameworks, cur));
    setPhase('scopes');
  };

  const onProbeAnswer = (value: string): void => {
    if (value === LZ_LIVE_PROBE_WRITE) { setPhase('confirm-write'); return; }
    if (value === LZ_LIVE_PROBE_ACCEPT) { setAcceptUnverified(true); setPhase('frameworks'); return; }
    setPhase('scopes');
  };

  /** #4255: the left arrow goes back one step before the run; values are kept. */
  const backOneStep = (): void => {
    switch (phase) {
      case 'scopes': setPhase('lz'); return;
      case 'probe-result': setPhase('scopes'); return;
      case 'confirm-write': setPhase('probe-result'); return;
      case 'frameworks': setPhase('scopes'); return;
      default: return;
    }
  };

  // #4256: a What next entry of the finish screen (were the number keys 1 to 6).
  const onDoneSelect = (value: string): void => {
    if (value === FINISH_MAIN_MENU) { onBack(); return; }
    if (value === LIVE_SHOW_OUTPUT) { setLines(runLines); setDoneOutput(true); return; }
    const picked = LIVE_DONE_ACTIONS.find((x) => x.id === value);
    if (!picked || !lz) return;
    // #3956: the evidence list of this run (references only; Enter resolves through swao lz evidence).
    if (picked.id === 'evidence') {
      const dir = parseLiveRunDir(runLines, workspace);
      const rows = dir ? readLiveEvidenceRows(dir) : [];
      if (rows.length === 0) { setNotice('No evidence map in this run.'); return; }
      setEvidence(rows);
      setResolved([]);
      setCursor(0);
      setPhase('evidence');
      return;
    }
    const r = doneActionArgs(picked.id, lz.id, lz.provider);
    if (r === null) { onBack(); return; }
    if ('notice' in r) { setNotice(r.notice); return; }
    setNotice(`Running swao ${r.args.join(' ')} ...`);
    const out: string[] = [];
    void run(r.args, (l) => out.push(l)).then((code) => {
      // #3589 / #3830 / #3885: the catalogue dry run, swao lz diff and swao lz hierarchy show their lines in the output pane.
      if (r.followUp) { setLines(out); setDoneOutput(true); }
      setNotice(code === 0 ? (r.followUp ?? `Done: ${out[out.length - 1] ?? ''}`) : `Failed (exit ${code}): ${out.slice(-2).join(' ')}`);
    });
  };

  useInput((input, key) => {
    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and PgDn only.
    if (guidanceOwnsKey(key, guidanceOpen.current)) return;
    if (nav.dialogOpen) return; // the AbortDialog owns Enter and Esc
    if (phase === 'probing' || phase === 'running') return;
    const move = (n: number): void => {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(Math.max(0, n - 1), c + 1));
    };
    if (PRE_RUN.has(phase)) {
      if (key.escape) { nav.requestAbort(); return; }
      if (key.leftArrow) backOneStep();
      return;
    }
    switch (phase) {
      case 'done': {
        // #4256 (Design 126 section 4.7): FinishPanel owns Enter and the arrows (no number keys).
        if (key.escape) onBack();
        return;
      }
      case 'evidence': {
        if (key.escape) { setResolved([]); setPhase('done'); return; }
        move(evidence.length);
        const row = evidence[cursor];
        if (!row) return;
        const open = input === 'o';
        if (key.return || open) {
          const out: string[] = [];
          setNotice(`Running swao ${evidenceResolveArgs(row.ref, open).join(' ')} ...`);
          void run(evidenceResolveArgs(row.ref, open), (l) => out.push(l)).then((code) => {
            setResolved(out);
            setNotice(code === 0 ? (open ? 'Console link opened; the console login decides access.' : 'Resolved locally. Press o to open the console link.') : `Failed (exit ${code}).`);
          });
        }
        return;
      }
      default:
        return;
    }
  });

  // #4213 (run 9): the evidence rows are central PickerRows (the picker marker, not "> ").
  const row = (active: boolean, mark: string, label: string, detail = ''): JSX.Element => (
    <PickerRow key={label} selected={active} indent={false} wrap="wrap">
      <Text {...tone(active ? 'selection' : 'text')}>{mark}</Text>
      <Text {...tone(active ? 'selection' : 'text')} bold={active}>{label}</Text>
      {detail ? <Text {...tone('muted')}>{'  '}{detail}</Text> : null}
    </PickerRow>
  );

  // Step options with their guidance (#4230: the box follows the highlighted option).
  const lzOptions: SelectOption[] = [
    ...lzs.map((l) => ({ label: l.display ?? l.id, value: l.id, detail: `${providerLabel(l.provider)}; ${l.scopes.length} scope(s)`, guidance: lzOptionGuidance(l) })),
    ...(onManageConnections ? [{
      label: 'Add or manage landing zones', value: LZ_LIVE_MANAGE, group: lzs.length > 0 ? 'Manage' : undefined, detail: 'Landing Zone Connections',
      guidance: { title: 'Add or manage landing zones', what: 'Opens Landing Zone Connections: add a landing zone, probe its scopes or remove one. The assessment starts again from this step afterwards.' },
    }] : []),
  ];
  const scopeOptions: MultiSelectOption[] = (lz?.scopes ?? []).map((sc) => ({ label: sc.id, value: sc.id, detail: lzScopeKindLabel(sc.kind), guidance: scopeOptionGuidance(sc) }));
  const fwOptions: MultiSelectOption[] = frameworks.map((f) => ({ label: f.id, value: f.id, detail: `${f.version}, ${f.hasServiceMapping ? 'service mapping' : 'no service mapping (grey)'}`, guidance: frameworkOptionGuidance(f) }));
  const probeOptions: SelectOption[] = decision?.kind === 'refused'
    ? [
      { label: 'Continue with the write-capable credential for this run', value: LZ_LIVE_PROBE_WRITE, guidance: { title: 'Continue with the write-capable credential', what: 'Asks once more, then runs with this credential for this run only. SWAO still sends read requests only; the choice is stamped into the scan (read_only_overrides) and not remembered.', cli: '--accept-write-capable-credentials' } },
      { label: 'Back to the scopes', value: LZ_LIVE_PROBE_BACK, guidance: { title: 'Back to the scopes', what: 'Stops here without any assessment call. Replace the credential with a read-only one and probe again.' } },
    ]
    : [
      { label: 'Accept for this run only', value: LZ_LIVE_PROBE_ACCEPT, guidance: { title: 'Accept for this run only', what: 'The roles of the credential could not be read, so read-only is not verified. The run continues for this run only and the scan records it.' } },
      { label: 'Back to the scopes', value: LZ_LIVE_PROBE_BACK, guidance: { title: 'Back to the scopes', what: 'Stops here without any assessment call.' } },
    ];

  const stepGuidance: Record<Phase, GuidanceEntry> = {
    lz: { title: 'Select landing zone', what: `The landing zones registered in .swao.yml, added in ${onManageConnections ? 'Landing Zone Connections (the last entry) or ' : ''}the Landing Zone Live setup.`, cli: 'swao assess --type landing-zone-live --lz <lz-id>' },
    scopes: { title: 'Select scopes', what: 'The platform landing zone (PLZ) and the application landing zones (ALZ) of this landing zone. SWAO probes and reads the selected scopes only.', cli: '--scope <id> (repeatable)' },
    probing: { title: 'Read-only probe', what: 'Checks identity, read-only result and coverage per scope before anything is read.', cli: 'swao lz probe <lz-id>' },
    'probe-result': probeFailed
      ? errorGuidance({ title: 'Read-only probe failed', remedy: 'The probe got no answer for the named scopes: the token may have expired, the credential may be missing, or the licence tier may not include Landing Zone Live. Probe again after fixing it, continue with the scopes that answered, or go back to the scopes.', cli: `swao lz probe ${lz?.id ?? '<lz-id>'}` })
      : { title: 'Read-only probe', what: 'SWAO only reads. A refused probe means the credential can write; an unverifiable one means the roles could not be read.' },
    'confirm-write': { title: 'Confirm write-capable credential', what: 'This run continues with a credential that can write. SWAO still sends read requests only. The choice is stamped into the scan (read_only_overrides) and not remembered.', cli: '--accept-write-capable-credentials' },
    frameworks: { title: 'Select community frameworks', what: 'Frameworks installed in the workspace community catalogue only; never fetched from GitHub. Preselected from the landing zone, else assessment.frameworks or regimes_active.', cli: '--frameworks <id,...>' },
    running: { title: 'Run', what: 'Probe, crawl, evaluate and diff per scope; writes landing-zones/<lz-id>/wsp/runs/<ts>/.', cli: 'swao assess --type landing-zone-live' },
    done: liveFinishGuidance(lz?.id ?? '<lz-id>'),
    evidence: { title: 'Evidence references', what: 'Every finding of this run has a reference without native ids. Enter resolves it from the local evidence map (native id, scope, setting, console link); o opens the console link.', cli: 'swao lz evidence <ref> [--open]' },
  };
  const { entry: optionEntry, onCursorChange } = useOptionGuidance(stepGuidance[phase]);
  // Pickers report the highlighted option; phases without a picker show the step entry.
  const pickerPhase = phase === 'lz' || phase === 'scopes' || phase === 'frameworks' || (phase === 'probe-result' && !probeFailed);
  // #4256 (A-20): the run guidance names the stage that runs now.
  const entry = pickerPhase ? optionEntry
    : phase === 'running' ? { ...stepGuidance.running, title: `Run: ${liveRunStageLabel(lines)}` }
      : stepGuidance[phase];

  const keys: readonly KeyHint[] = (() => {
    switch (phase) {
      case 'lz': return KEY_HINTS.picker.filter((h) => h.verb !== 'back');
      case 'scopes': case 'frameworks': return KEY_HINTS.multiSelect;
      case 'probe-result': return probeFailed ? ERROR_PANEL_KEYS : KEY_HINTS.picker;
      case 'confirm-write': return CONFIRM_PANEL_KEYS;
      case 'done': return FINISH_PANEL_KEYS;
      case 'probing': case 'running': return RUN_PANEL_KEYS; // #4256: Esc cancel only
      case 'evidence': return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }];
      default: return [];
    }
  })();
  // The hook reads no keys here (active: false), so its contentActive is always false.
  const active = !nav.dialogOpen;
  // ErrorPanel and ConfirmPanel draw their own title (section 4.9).
  const ownTitle = probeFailed || phase === 'confirm-write' || phase === 'done';
  const subtitle = lz ? `Landing zone ${lz.id} (${providerLabel(lz.provider)})${scopeIds.length > 0 && phase !== 'scopes' && phase !== 'lz' ? `, scopes ${scopeIds.join(', ')}` : ''}` : 'Read the settings of a registered landing zone and evaluate them.';

  return (
    <ScreenLayout
      header={{ subtitle: 'Landing Zone Live Assessment', version, licenseState: license.state, licenseError: license.error }}
      steps={{ labels: [...LZ_LIVE_STEPS], current: LZ_LIVE_PHASE_STEP[phase] }}
      title={ownTitle ? undefined : { title: stepGuidance[phase].title, subtitle }}
      keys={keys}
      guidance={{ entry, onOpenChange: (open) => { guidanceOpen.current = open; setBoxOpen(open); nav.onGuidanceOpenChange(open); } }}
    >
      {nav.dialog}
      {phase === 'lz' && (lzOptions.length === 0
        ? <Text {...tone('warning')}>No landing zone registered. Add one in the Landing Zone Live setup (Setup) first.</Text>
        : (
          <Box flexDirection="column">
            {lzs.length === 0 && <Text {...tone('warning')}>No landing zone registered yet. Add one in Landing Zone Connections.</Text>}
            <SelectInput label="Landing zone" options={lzOptions} onSelect={onLzSelect} onCursorChange={onCursorChange} filter={lzOptions.length > 9} itemNoun="landing zones" visibleCount={PICKER_VISIBLE_COUNT} showKeyHints={false} active={active} />
          </Box>
        ))}
      {phase === 'scopes' && lz && (
        <MultiSelect key={`scopes-${lz.id}`} label="Scopes to read" options={scopeOptions} initialSelected={[...scopes]} onConfirm={(values) => { setScopes(new Set(values)); setAcceptWrite(false); setAcceptUnverified(false); setPhase('probing'); }} onCursorChange={onCursorChange} visibleCount={PICKER_VISIBLE_COUNT} showKeyHints={false} active={active} />
      )}
      {/* #4256 (Design 126 sections 4.6 and 7.6): the probe is short, Esc cancels at once and
          returns to the scopes; nothing is written. */}
      {phase === 'probing' && lz && (
        <RunPanel
          key="probe"
          title={`Probing ${scopeIds.length} scope(s) of ${lz.id}`}
          progress={{ stage: 1, stages: 1, label: 'Read-only probe: login, read-only state and coverage per scope', elapsedMs: Math.max(0, now - runStart) }}
          lines={[]}
          abort={runAbortRef.current ?? undefined}
          confirmCancel={false}
          onCancel={() => { runAbortRef.current?.abort(); setPhase('scopes'); }}
          guidanceOpen={boxOpen}
        />
      )}
      {phase === 'probe-result' && decision && decision.kind !== 'proceed' && (
        decision.kind === 'error'
          ? (
            <ErrorPanel
              title="Read-only probe failed"
              cause={[`No probe result for ${recovery.failedScopes.length === 1 ? 'scope' : 'scopes'} ${recovery.failedScopes.join(', ') || decision.message}.`, ...lines.slice(-4)].join(String.fromCharCode(10))}
              recovery={recovery.options}
              onSelect={onRecovery}
              active={active}
            />
          )
          : (
            <Box flexDirection="column">
              {decision.scopes.map((sc) => (
                <Box key={sc.scopeId} flexDirection="column">
                  {/* #4259 (Q-13): a write-capable or unverifiable login is warn on every screen; the question below decides. */}
                  <Text {...tone('warning')}>Scope {sc.scopeId}: read-only {sc.readOnly}</Text>
                  {sc.detail.map((d, i) => <Text key={i} {...tone('muted')}>  {d}</Text>)}
                </Box>
              ))}
              <Text>{decision.kind === 'refused' ? 'The credential is write-capable.' : 'Read-only could not be verified.'}</Text>
              <Box marginTop={1}>
                <SelectInput key={`probe-${decision.kind}`} label="How to go on" options={probeOptions} onSelect={onProbeAnswer} onCursorChange={onCursorChange} visibleCount={PICKER_VISIBLE_COUNT} showKeyHints={false} active={active} />
              </Box>
            </Box>
          )
      )}
      {phase === 'confirm-write' && lz && (
        <ConfirmPanel
          title="Continue with a write-capable credential?"
          subtitle="For this run only; SWAO still sends read requests only."
          rows={[
            { label: 'Landing zone', value: `${lz.id} (${providerLabel(lz.provider)})` },
            { label: 'Scopes', value: scopeIds.join(', ') },
          ]}
          risk="The credential can write. The choice is stamped into the scan and not remembered."
          onConfirm={() => { setAcceptWrite(true); setPhase('frameworks'); }}
          active={active}
        />
      )}
      {phase === 'frameworks' && (frameworks.length === 0
        ? <Text {...tone('warning')}>No community framework in wsp/inputs/catalogs/community/. Copy a framework folder from the GitHub repository (https://github.com/Accenture/SWAO/tree/main/community-frameworks) into it, or build your own.</Text>
        : <MultiSelect key={`fw-${lz?.id ?? ''}`} label="Community frameworks" options={fwOptions} initialSelected={[...fwSel]} onConfirm={(values) => { setFwSel(new Set(values)); setPhase('running'); }} onCursorChange={onCursorChange} visibleCount={PICKER_VISIBLE_COUNT} showKeyHints={false} active={active} />)}
      {/* #4050: the folder the run reads organisational documents from (CLI parity). */}
      {phase === 'frameworks' && lz && <Text {...tone('muted')}>{lzIngestionFolderHint(lz.id)}</Text>}
      {/* #3885: the done pane keeps more lines so a tenant tree fits. */}
      {/* #4256: the run asks first (AbortDialog); the cancel stops the child tree and returns to
          the Frameworks step, the step that started the run. */}
      {phase === 'running' && lz && (
        <RunPanel
          key="run"
          title={`Assessing the landing zone ${lz.id}`}
          progress={{ stage: 1, stages: 1, label: liveRunStageLabel(lines), elapsedMs: Math.max(0, now - runStart) }}
          lines={lines}
          maxLines={8}
          abort={runAbortRef.current ?? undefined}
          onCancel={() => { runAbortRef.current?.abort(); setPhase('frameworks'); }}
          guidanceOpen={boxOpen}
        />
      )}
      {/* #4256 (Design 126 section 4.7): FinishPanel with the run folder, the summaries and What next. */}
      {phase === 'done' && lz && (() => {
        const view = liveFinishView({ lzLabel: `${lz.id} (${providerLabel(lz.provider)})`, scopes: scopeIds, frameworks: [...fwSel], exitCode, runDir: parseLiveRunDir(runLines), summaryLines: baselineLines });
        return <FinishPanel title={view.title} level={view.level} rows={view.rows} next={view.next} onSelect={onDoneSelect} active={active} />;
      })()}
      {/* #3885: the output of the run or of a done action keeps enough lines for a tenant tree. */}
      {phase === 'done' && doneOutput && lines.slice(-24).map((l, i) => <Text key={`o${i}`} {...tone('muted')}>{l}</Text>)}
      {phase === 'evidence' && (() => {
        const start = Math.max(0, Math.min(cursor - Math.floor(EVIDENCE_WINDOW / 2), evidence.length - EVIDENCE_WINDOW));
        return (
          <Box flexDirection="column">
            <Text {...tone('muted')}>{evidence.length} reference(s); showing {start + 1}-{Math.min(evidence.length, start + EVIDENCE_WINDOW)}</Text>
            {evidence.slice(start, start + EVIDENCE_WINDOW).map((e, i) => row(start + i === cursor, '', e.ref, `${e.kind}  ${e.title}${e.status ? ` (${e.status})` : ''}`))}
            {resolved.map((l, i) => <Text key={`ev${i}`} {...tone('muted')}>{l}</Text>)}
          </Box>
        );
      })()}
      {notice ? <Text {...tone('accent')}>{notice}</Text> : null}
    </ScreenLayout>
  );
}
