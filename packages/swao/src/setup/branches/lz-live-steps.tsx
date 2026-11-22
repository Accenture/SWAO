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

// #4195 SET-06 (Design 125 section 5.5): the step components Probe (20),
// Policy Baseline (30) and Org Evidence (40) of the Landing Zone Live branch.
// The logic lives in lz-live-logic.ts. Layout (section 9): no header and no
// guidance box of their own (the engine draws both), short lines, no CLI
// syntax. Esc belongs to the wizard; every step continues with Enter.
// #4254 / #4231 (Design 126): each step hands title, input kind and its
// guidance box to the wizard frame (SetupStepFrame); probe results are
// StatusRows, a write-capable login is `warn` with the Q-13 wording.

import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PickerRow, SelectInput, StatusRow, statusLabelWidth, tone, useHeaderWidth, useOptionGuidance, type GuidanceEntry, type KeyHint, type SelectOption } from '@swao/tui-kit';
import { providerLabel } from '@swao/core';
import { SetupStepFrame } from '../setup-frame.js';
import type { CommunityFrameworksProbeOptions } from '@swao/module-health-check';
import { defaultRunner, type ConnectionsCliRunner } from '../../tui/screens/LzConnectionsScreen.js';
import { probeRow } from '../../tui/screens/lz-connections-flow.js';
import {
  baselineLine,
  BASELINE_FIRST_RELEASE,
  BASELINE_FOLDER,
  BASELINE_MANUAL_PAGE,
  BASELINE_URL,
  COMMUNITY_CATALOGUE_FOLDER,
  ensureEvidenceFolders,
  evidenceRow,
  expectedEvidenceInputs,
  findPolicyBaselines,
  frameworksToSave,
  initialFrameworkSelection,
  resolveStoredFrameworks,
  lzEvidenceFolder,
  missingBaselineLines,
  probeArgs,
  probeSummaryLine,
  probeTotals,
  registeredLandingZones,
  saveLzFrameworks,
  staleNote,
  toProbeOutcome,
  workspaceFrameworks,
  wsRoot,
  type LzProbeOutcome,
  type WorkspaceFramework,
} from './lz-live-logic.js';
import type { SetupStepProps } from '../types.js';
import { logSetupStepComplete } from '../step-events.js';

function logStep(step: string, context: Record<string, unknown>): void {
  logSetupStepComplete(step, `Landing Zone Live setup step ${step} completed`, context); // #4263: dropped when the wizard cancels the step
}

const NO_LZ = 'No landing zone registered yet. Add one in the Landing Zones step of this setup.';

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export interface LzLiveProbeViewProps extends SetupStepProps {
  /** CLI runner (tests); default: this SWAO binary. */
  run?: ConnectionsCliRunner;
}

export function LzLiveProbeView({ ctx, onNext, run: runProp }: LzLiveProbeViewProps): JSX.Element {
  const root = wsRoot(ctx.workspaceRoot);
  const lzs = useMemo(() => registeredLandingZones(root), [root]);
  const run = useMemo(() => runProp ?? defaultRunner(root), [runProp, root]);
  const [phase, setPhase] = useState<'ask' | 'working' | 'result'>('ask');
  const [outcomes, setOutcomes] = useState<LzProbeOutcome[]>([]);
  const headerWidth = useHeaderWidth();

  useEffect(() => {
    if (phase !== 'working') return;
    let cancelled = false;
    void (async () => {
      const out: LzProbeOutcome[] = [];
      for (const lz of lzs) {
        const lines: string[] = [];
        let code = 1;
        try { code = await run(probeArgs(lz.id), (l) => { lines.push(l); }); } catch { /* reported as not probed */ }
        out.push(toProbeOutcome(lz.id, code, lines));
      }
      if (!cancelled) { setOutcomes(out); setPhase('result'); }
    })();
    return () => { cancelled = true; };
  }, [phase, lzs, run]);

  // #4256 follow-up (Design 126 sections 7.7 and 7.10): the probe, the repeat
  // and the skip are list entries (were the letter keys P and S named only in
  // the step text); "Skip this step" is the last visible entry.
  useInput((_input, key) => {
    if (phase === 'working') return;
    if (lzs.length === 0 && key.return) { logStep('lz-live.probe', { landing_zones: 0 }); onNext({ status: 'skipped', summary: 'no landing zone to probe' }); }
  });
  const onProbeChoice = (value: string): void => {
    if (value === PROBE_RUN || value === PROBE_AGAIN) { setPhase('working'); return; }
    if (value === PROBE_SKIP) { logStep('lz-live.probe', { probed: false }); onNext({ status: 'skipped', summary: 'probe skipped' }); return; }
    const t = probeTotals(outcomes);
    logStep('lz-live.probe', { probed: true, scopes: t.scopes, write_capable: t.writeCapable, unverifiable: t.unverifiable });
    onNext({ status: 'done', summary: probeSummaryLine(t) });
  };
  const choices = phase === 'result' ? PROBE_RESULT_OPTIONS : PROBE_ASK_OPTIONS;
  const { entry: probeEntry, onCursorChange } = useOptionGuidance(PROBE_ASK_OPTIONS[0]!.guidance!);

  const totals = probeTotals(outcomes);
  // #4295 / #4348: the shared label column rule; a long "lz / scope" label widens the column instead of wrapping.
  const probeLabelWidth = statusLabelWidth(
    outcomes.flatMap((o) => (o.rows.length === 0 ? [o.lzId] : o.rows.map((r) => `${o.lzId} / ${r.scopeId}`))),
    headerWidth,
    { min: PROBE_LABEL_WIDTH },
  );
  return (
    <SetupStepFrame
      title="Probe"
      subtitle="Checks the login, the read-only state and the coverage of each scope."
      kind="confirm"
      keys={lzs.length === 0 ? NEXT_KEYS : PROBE_KEYS}
      guidance={lzs.length === 0 || phase === 'working' ? PROBE_GUIDANCE : probeEntry}
    >
      {lzs.length === 0 ? <Text {...tone('warning')}>{NO_LZ}</Text> : null}
      {lzs.length > 0 && phase === 'ask' ? (
        <Box flexDirection="column">
          {lzs.map((lz) => <Text key={lz.id}>{`  ${lz.id} (${providerLabel(lz.provider)}): ${lz.scopes.length} scope${lz.scopes.length === 1 ? '' : 's'}`}</Text>)}
        </Box>
      ) : null}
      {phase === 'working' ? <Text {...tone('muted')}>Probing, SWAO only reads...</Text> : null}
      {phase === 'result' ? (
        <Box flexDirection="column">
          {outcomes.map((o) => (
            <Box key={o.lzId} flexDirection="column">
              {o.rows.length === 0
                ? <StatusRow level="fail" label={o.lzId} summary={`not probed (exit ${o.code})`} detail={o.reason ? `${o.reason}; check its logins in the Landing Zones step.` : "Check its logins in the Landing Zones step."} labelWidth={probeLabelWidth} />
                : o.rows.map((r) => {
                  const row = probeRow(r.readOnly, r.coverage);
                  return <StatusRow key={r.scopeId} level={row.level} label={`${o.lzId} / ${r.scopeId}`} summary={row.summary} detail={row.detail} labelWidth={probeLabelWidth} />;
                })}
            </Box>
          ))}
          {totals.writeCapable > 0 ? <Box marginTop={1}><Text>A write-capable login needs a confirmation per run; SWAO still only reads.</Text></Box> : null}
          {totals.unverifiable > 0 ? <Text>An unverified login needs to be accepted per run.</Text> : null}
        </Box>
      ) : null}
      {lzs.length > 0 && phase !== 'working' ? (
        <Box marginTop={1}>
          <SelectInput key={phase} label="Probe" options={choices} visibleCount={choices.length} showKeyHints={false} onCursorChange={onCursorChange} onSelect={onProbeChoice} />
        </Box>
      ) : null}
    </SetupStepFrame>
  );
}

/** The hint line of the LZ Live steps: Enter goes on, the Left arrow (or Shift+Tab) goes back, Esc aborts (Design 126 section 7.9). */
const NEXT_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];

/** #4256 follow-up: the list keys of the probe step (the entries replace the letter keys P and S). */
const PROBE_KEYS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];

const PROBE_RUN = 'probe';
const PROBE_AGAIN = 'again';
const PROBE_SKIP = 'skip';
const PROBE_CONTINUE = 'continue';
export const PROBE_ASK_OPTIONS: SelectOption[] = [
  { label: 'Probe all scopes now', value: PROBE_RUN, guidance: { title: 'Probe all scopes now', what: 'Signs in to every registered scope with its stored login and checks who the login is, whether it can only read, and which API routes it can read. SWAO sends read requests only.', cli: 'swao lz probe <lz-id>' } },
  { label: 'Skip this step', value: PROBE_SKIP, guidance: { title: 'Skip this step', what: 'Goes on without a probe. The Landing Zone Live Assessment probes the scopes again at the start of each run.' } },
];
export const PROBE_RESULT_OPTIONS: SelectOption[] = [
  { label: 'Continue', value: PROBE_CONTINUE, guidance: { title: 'Continue', what: 'Keeps this probe result and goes on to the next step. A write-capable or unverified login is confirmed at each run; SWAO still only reads.' } },
  { label: 'Probe again', value: PROBE_AGAIN, guidance: { title: 'Probe again', what: 'Probes every scope once more, for example after a login was changed in Landing Zone Connections.', cli: 'swao lz probe <lz-id>' } },
];

/** Label column of the probe rows ("otc-prod / app-payments") at least; wider labels widen it (#4295 / #4348). */
const PROBE_LABEL_WIDTH = 26;

/** #4298: the probe row rule is shared with Landing Zone Connections (lz-connections-flow.ts). */
export { probeRow };

const PROBE_GUIDANCE: GuidanceEntry = {
  title: 'Probe',
  what: 'The probe signs in to each registered scope with its stored login and checks who the login is, whether it can only read, and which API routes it can read (the coverage). SWAO sends read requests only; nothing in the landing zone is changed.',
  sections: [
    { label: 'Write-capable', text: 'Shown as warn: write-capable, accepted for this run; SWAO only reads. The login could also change resources; the Landing Zone Live Assessment asks you to accept it at the start of each run.' },
    { label: 'Unverified', text: 'The provider did not let SWAO confirm the read-only state; a run asks you to accept the login.' },
    { label: 'Coverage', text: 'Routes the login can read. A route it cannot read leaves its controls not evaluated; a login that reads nothing is shown as fail.' },
  ],
};

export function LzLiveProbeStep(props: SetupStepProps): JSX.Element {
  return <LzLiveProbeView {...props} />;
}

// ---------------------------------------------------------------------------
// Policy Baseline and frameworks per landing zone (section 5.7)
// ---------------------------------------------------------------------------

export interface LzLiveBaselineViewProps extends SetupStepProps {
  /** Community frameworks probe options (tests: bundled dir, capability tags). */
  probe?: CommunityFrameworksProbeOptions;
}

export function LzLiveBaselineView({ ctx, onNext, probe }: LzLiveBaselineViewProps): JSX.Element {
  const root = wsRoot(ctx.workspaceRoot);
  const state = useMemo(() => findPolicyBaselines(root, probe ?? {}), [root, probe]);
  const lzs = useMemo(() => registeredLandingZones(root), [root]);
  const frameworks = useMemo(() => workspaceFrameworks(root), [root]);
  const pick = lzs.length > 0 && frameworks.length > 0;
  const [phase, setPhase] = useState<'baseline' | 'frameworks'>('baseline');
  const [lzIdx, setLzIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<string[]>([]);
  const [saved, setSaved] = useState({ count: 0, changed: false });
  const [error, setError] = useState('');

  const lz = lzs[lzIdx];
  const startLz = (i: number): void => {
    const next = lzs[i];
    if (!next) return;
    setLzIdx(i);
    // #4494 (Design 126 section 4): with frameworks set for the landing zone the cursor starts on the keep entry.
    setCursor(next.frameworks.length > 0 ? frameworks.length : 0);
    const init = initialFrameworkSelection(next, frameworks, state.baselines);
    setInitial(init);
    setSel(new Set(init));
  };

  const finish = (r: { count: number; changed: boolean }): void => {
    const valid = state.baselines.filter((b) => b.status === 'ok').length;
    const base = state.baselines.length === 0 ? 'no policy baseline' : `${valid} valid baseline${valid === 1 ? '' : 's'}`;
    logStep('lz-live.baseline', { baselines: state.baselines.length, valid, frameworks_set: r.count, changed: r.changed });
    onNext({ status: r.changed ? 'done' : 'kept', summary: pick ? `${base}, frameworks set for ${r.count} of ${lzs.length} landing zone${lzs.length === 1 ? '' : 's'}` : base });
  };

  useInput((input, key) => {
    if (phase === 'baseline') {
      if (!key.return) return;
      if (pick) { startLz(0); setPhase('frameworks'); return; }
      finish({ count: 0, changed: false });
      return;
    }
    if (!lz) return;
    // #4254 (run 9, Design 126 section 7.7): the last row keeps the current frameworks (was the letter S).
    const keepAt = frameworks.length;
    if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor((c) => Math.min(keepAt, c + 1)); return; }
    if (input === ' ') {
      const id = frameworks[cursor]?.id;
      if (!id) return;
      setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
      return;
    }
    const advance = (r: { count: number; changed: boolean }): void => {
      setSaved(r);
      setError('');
      if (lzIdx + 1 < lzs.length) startLz(lzIdx + 1);
      else finish(r);
    };
    if (key.return && cursor === keepAt) { advance({ count: saved.count + (lz.frameworks.length > 0 ? 1 : 0), changed: saved.changed }); return; }
    if (key.return) {
      try {
        const toSave = frameworksToSave(lz, frameworks, initial, [...sel]);
        const outcome = toSave === null ? 'unchanged' : saveLzFrameworks(root, lz.id, toSave);
        const set = toSave === null ? lz.frameworks.length > 0 : toSave.length > 0;
        advance({ count: saved.count + (set ? 1 : 0), changed: saved.changed || outcome === 'saved' });
      } catch (e) {
        setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });

  if (phase === 'frameworks' && lz) {
    const unoffered = resolveStoredFrameworks(lz.frameworks, frameworks).unoffered;
    return (
      <SetupStepFrame
        title="Policy Baseline"
        subtitle="Frameworks per landing zone, preselected in the Landing Zone Live Assessment."
        kind="multiSelect"
        back={() => setPhase('baseline')}
        guidance={frameworks[cursor] ? baselineFrameworkGuidance(frameworks[cursor]!, sel.has(frameworks[cursor]!.id), lz.id) : cursor === frameworks.length ? FRAMEWORKS_KEEP_GUIDANCE : FRAMEWORKS_GUIDANCE}
      >
        <Text {...tone('brand')}>{`Frameworks for ${lz.id} (${lzIdx + 1} of ${lzs.length})`}</Text>
        <Box marginTop={1} flexDirection="column">
          {frameworks.map((f, i) => (
            <PickerRow key={f.id} selected={i === cursor} indent={false} wrap="wrap">
              <Text {...tone(i === cursor ? 'selection' : 'text')}>{`${sel.has(f.id) ? '[x]' : '[ ]'} ${f.id} (${f.version})`}</Text>
            </PickerRow>
          ))}
          <PickerRow selected={cursor === frameworks.length} indent={false} wrap="wrap">
            <Text {...tone(cursor === frameworks.length ? 'selection' : 'text')}>{FRAMEWORKS_KEEP_LABEL}</Text>
          </PickerRow>
        </Box>
        {unoffered.length > 0 ? <Text {...tone('muted')}>{`Kept, not in the workspace catalogue: ${unoffered.join(', ')}`}</Text> : null}
        {error ? <Text {...tone('error')}>{error}</Text> : null}
      </SetupStepFrame>
    );
  }

  return (
    <SetupStepFrame
      title="Policy Baseline"
      subtitle="Your organisation policies, measured on every landing zone."
      kind="confirm"
      keys={NEXT_KEYS}
      guidance={BASELINE_GUIDANCE}
    >
      <Box flexDirection="column">
        {state.error ? <Text {...tone('warning')}>{`Community frameworks could not be read: ${state.error}`}</Text> : null}
        {!state.error && state.baselines.length === 0 ? missingBaselineLines().map((l, i) => <Text key={i} {...tone(i === 0 ? 'warning' : 'text')}>{l}</Text>) : null}
        {state.baselines.map((b) => (
          <Box key={b.id} flexDirection="column">
            <Text {...tone(b.status === 'invalid' ? 'error' : b.stale || b.notSet > 0 ? 'warning' : 'ok')}>{baselineLine(b)}</Text>
            {staleNote(b) ? <Text {...tone('muted')}>{`  ${staleNote(b)}`}</Text> : null}
            {b.status === 'invalid' ? b.messages.slice(0, 2).map((m, i) => <Text key={i} {...tone('muted')}>{`  ${m}`}</Text>) : null}
          </Box>
        ))}
      </Box>
      {lzs.length === 0 ? <Text {...tone('muted')}>{NO_LZ}</Text> : null}
      {pick ? <Box marginTop={1}><Text {...tone('muted')}>Enter goes on to the frameworks of each landing zone.</Text></Box> : null}
    </SetupStepFrame>
  );
}

const BASELINE_GUIDANCE: GuidanceEntry = {
  title: 'Policy Baseline',
  what: 'The Client LZ Policy Baseline holds the policies of your organisation, for example allowed regions, encryption and tagging. SWAO measures every landing zone against them besides the frameworks; each policy is enabled, disabled or not yet reviewed in policy-baseline.yaml.',
  sections: [
    { label: 'Where to get it', text: `Copy the folder ${BASELINE_URL} into ${COMMUNITY_CATALOGUE_FOLDER}${BASELINE_FOLDER}/ of the workspace and edit policy-baseline.yaml there. SWAO never downloads or updates it.` },
    { label: 'Availability', text: `The template is public on GitHub from ${BASELINE_FIRST_RELEASE}; until then the link answers not found. The ${BASELINE_MANUAL_PAGE} describes every file.` },
    { label: 'How SWAO uses it', text: 'Each enabled policy becomes a control of the Landing Zone Live Assessment; a policy not reviewed is reported as not reviewed.' },
  ],
};

/** #4230: the guidance of one highlighted framework of the Policy Baseline list. */
export function baselineFrameworkGuidance(f: WorkspaceFramework, ticked: boolean, lzId: string): GuidanceEntry {
  return {
    title: `${f.id}${f.name ? `: ${f.name}` : ''}`,
    what: `${ticked ? 'Ticked: preselected' : 'Not ticked: not preselected'} when a Landing Zone Live Assessment of ${lzId} starts; the assessment can still change the choice. Saved per landing zone in the workspace .swao.yml.`,
    sections: [
      ...(f.description ? [{ label: 'About', text: f.description }] : []),
      { label: 'Authority', text: f.authority ?? 'not specified' },
      { label: 'Version', text: f.version },
      { label: 'Folder', text: `wsp/inputs/catalogs/community/${f.folder}/` },
    ],
  };
}

const FRAMEWORKS_GUIDANCE: GuidanceEntry = {
  title: 'Frameworks per landing zone',
  what: 'The frameworks ticked here are preselected when you start a Landing Zone Live Assessment of this landing zone; the assessment still lets you change them. Saved per landing zone in the workspace .swao.yml.',
  sections: [{ label: 'Keep', text: 'The last entry keeps the current choice and goes on; nothing is written.' }],
};

/** #4254 (run 9): the last entry of the frameworks list (was the letter S). */
export const FRAMEWORKS_KEEP_LABEL = 'Keep the current frameworks and continue';
const FRAMEWORKS_KEEP_GUIDANCE: GuidanceEntry = {
  title: FRAMEWORKS_KEEP_LABEL,
  what: 'Goes on with the frameworks stored for this landing zone; the ticks of this list are not saved and nothing is written.',
};

export function LzLiveBaselineStep(props: SetupStepProps): JSX.Element {
  return <LzLiveBaselineView {...props} />;
}

// ---------------------------------------------------------------------------
// Org Evidence (optional)
// ---------------------------------------------------------------------------

export function LzLiveEvidenceStep({ ctx, onNext }: SetupStepProps): JSX.Element {
  const root = wsRoot(ctx.workspaceRoot);
  const lzs = useMemo(() => registeredLandingZones(root), [root]);
  // #4346: on entry the step creates the missing ingestion folders itself (idempotent; never deletes or overwrites).
  const [outcomes] = useState(() => ensureEvidenceFolders(root, lzs.map((lz) => lz.id)));
  const expected = useMemo(() => expectedEvidenceInputs(root), [root]);

  useInput((_input, key) => {
    if (key.return) {
      const docs = outcomes.reduce((n, s) => n + s.documents, 0);
      logStep('lz-live.evidence', { landing_zones: outcomes.length, documents: docs, created: outcomes.filter((o) => o.status === 'created').length, failed: outcomes.filter((o) => o.status === 'failed').length });
      onNext(outcomes.length === 0
        ? { status: 'skipped', summary: 'no landing zone' }
        : { status: 'kept', summary: `${docs} organisational document${docs === 1 ? '' : 's'} in ${outcomes.length} ingestion folder${outcomes.length === 1 ? '' : 's'}` });
    }
  });

  return (
    <SetupStepFrame
      title="Org Evidence"
      subtitle="Optional: documents for the governance controls; the technical checks run without them."
      kind="confirm"
      keys={NEXT_KEYS}
      guidance={evidenceGuidance(lzs[0]?.id, expected)}
    >
      <Box flexDirection="column">
        {lzs.length === 0 ? <Text {...tone('warning')}>{NO_LZ}</Text> : null}
        {outcomes.map((o) => {
          const row = evidenceRow(o);
          return <StatusRow key={o.lzId} level={row.level} label={o.lzId} summary={row.summary} labelWidth={PROBE_LABEL_WIDTH} />;
        })}
      </Box>
    </SetupStepFrame>
  );
}

/** #4346: the guidance of Org Evidence, with the expected document names and the naming example (no longer in the body). */
export function evidenceGuidance(firstLzId: string | undefined, expected: readonly string[]): GuidanceEntry {
  const example = `${lzEvidenceFolder(firstLzId ?? '<landing zone>')}ict_risk_management_framework.pdf`;
  return {
    title: 'Org Evidence',
    what: 'Organisational evidence are documents of the client organisation that no API can read, for example the ICT risk management framework, the incident response plan, the business continuity plan, the exit strategy and the outsourcing register. Without them those governance controls stay not evaluated.',
    sections: [
      { label: 'Controls', text: 'The governance controls of DORA, NIS2 and the sovereignty frameworks, for example ICT risk management, incident reporting and exit planning.' },
      { label: 'Where', text: 'One ingestion folder per landing zone, created by this step. SWAO classifies and indexes the documents at the next run.' },
      { label: 'File names', text: `Name each file after the expected input, for example ${example}.` },
      { label: 'Expected', text: expected.length > 0 ? expected.join(', ') : 'No framework of the workspace catalogue expects an organisational document yet.' },
      { label: 'Keys', text: 'Enter goes on.' },
    ],
  };
}
