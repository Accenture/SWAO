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

// #4190 SET-01 / #4191 SET-02 (Design 125): the setup wizard is an engine
// over the setup registry (src/setup). It walks a plan: the generic workspace
// setup, its health check, the type selection, then per chosen assessment
// type its steps, its scoped health check (after the last configuration step,
// #4120) and its Ready. The step components and their side effects live in
// src/setup/branches/*; this file owns navigation, the step bar per branch,
// Esc handling and the workspace record (workspace.assessment_types,
// workspace.setup_state).
//
// #4254 TUI-10 (Design 126 sections 3, 4.5 and 7): one ScreenLayout frames
// every step (header, step bar, step title, content, key hints, guidance box);
// the steps report title, input kind and guidance through SetupStepFrame
// (setup/setup-frame.tsx). The plan is walked with useFlowNavigation: Shift+Tab
// (and Left arrow on a picker step) goes back, Esc aborts, after the
// AbortDialog once a step is done, and the last Ready finishes to the main menu.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useInput } from 'ink';
import { findWorkspace, logPortfolio, setWorkspaceRoot, SETUP_SCOPE_LABELS, type LicenceTier, type SetupAssessmentType, type SetupScope } from '@swao/core';
import { ScreenLayout, useFlowNavigation, KEY_HINTS, GuidancePresenceContext, useGuidancePresence, GuidanceOpenContext, useGuidanceOpen, useGuidanceOpenOwner, type GuidanceEntry, type LicenseStateView } from '@swao/tui-kit';
import { LicenseGuard } from '../../license/license-guard.js';
import { SWAO_VERSION } from '../../branding.js';
import { type SetupState } from './wizard/shared.js';
import { HealthCheckStep } from './wizard/steps/HealthCheckStep.js';
import { ReadyStep } from './wizard/steps/ReadyStep.js';
import {
  buildSetupPlan,
  defaultSetupRegistry,
  setupSubtitle,
  stepBarFor,
  entryLabel,
  type SetupHealthResult,
  type SetupPlanEntry,
  type SetupRegistry,
  type SetupRunMode,
} from '../../setup/index.js';
import { SetupChromeContext, type SetupChrome } from '../../setup/setup-frame.js';
import { TypeSelectionStep } from '../../setup/TypeSelectionStep.js';
import { BranchReadyStep } from '../../setup/BranchReadyStep.js';
import { SetupStartMenu } from '../../setup/SetupStartStep.js';
import { completeBranchSetup } from '../../setup/branch-check.js';
import { cancelSetupStep } from '../../setup/step-events.js';
import { TuiCrashBoundary, setTuiLocation, tuiExitCause } from '../crash-report.js';
import {
  inferAssessmentTypes,
  readAssessmentTypes,
  branchStates,
  branchStateNotes,
  writeAssessmentTypes,
} from '../../setup/workspace-state.js';

interface SetupWizardProps {
  onBack: () => void;
  /**
   * What to run. `auto` (default): a workspace that already records
   * workspace.assessment_types opens the Setup menu, any other starts the
   * first-run setup. Explicit modes are used by tests and deep links.
   */
  mode?: SetupRunMode | 'auto';
  /** Test seam: the step registry (default: the shipped registry). */
  registry?: SetupRegistry;
  /** Test seam: the workspace of an `auto` start (default: found from the working directory). */
  workspaceRoot?: string | null;
  /** Test seam: the licence tier (default: LicenseGuard). */
  tier?: LicenceTier;
}

const INITIAL_SESSION: SetupState = {
  workDir: '.',
  engagementName: '',
  clientCode: '',
  partnershipLead: '',
  llmProvider: 'anthropic',
  llmModel: '',
  ollamaEndpoint: '',
  openLlmBaseUrl: '',
};

function loadTier(): LicenceTier {
  try { return LicenseGuard.load().state.tier; } catch { return 'community'; }
}

interface HeaderBase { version: string; licenseState: LicenseStateView | null; licenseError: string | null }

/** Header blocks 1 and 2: the version and the licence line (as the host Header renders them). */
function useHeaderBase(): HeaderBase {
  return useMemo(() => {
    try {
      return { version: SWAO_VERSION, licenseState: LicenseGuard.load().state as LicenseStateView, licenseError: null };
    } catch (e) {
      return { version: SWAO_VERSION, licenseState: null, licenseError: (e as Error).message };
    }
  }, []);
}

/** Block 8 from the step chrome: the guidance entry of the step or of its highlighted option. */
// #4394: the box reports its open state to the wizard's GuidanceOpenContext itself.
function guidanceOf(chrome: SetupChrome | null) {
  return chrome?.guidance ? { entry: chrome.guidance } : null;
}

/**
 * #4342 (Design 126 section 3, audit gap U-5): the guidance of a plan entry
 * from the step registry, drawn by the frame when the step reports none and
 * renders no box of its own, so no step is shown without block 8.
 */
export function registryGuidance(entry: SetupPlanEntry): GuidanceEntry | null {
  switch (entry.kind) {
    case 'step':
      return entry.step.guidance ? { title: entry.step.label, what: entry.step.guidance } : null;
    case 'health-check':
      return { title: `Health Check, ${SETUP_SCOPE_LABELS[entry.scope]}`, what: 'The probes of this scope check what the setup configured; a failed probe names what to fix. The Ready summary follows once the probes finished.' };
    case 'type-selection':
    case 'ready':
      return null; // both report their guidance through SetupStepFrame
    default: {
      const never: never = entry;
      throw new Error(`unknown setup plan entry: ${JSON.stringify(never)}`);
    }
  }
}

export function SetupWizard({ onBack, mode = 'auto', registry, workspaceRoot, tier: tierProp }: SetupWizardProps) {
  const reg = useMemo(() => registry ?? defaultSetupRegistry(), [registry]);
  const tier = useMemo(() => tierProp ?? loadTier(), [tierProp]);
  const header = useHeaderBase();
  const existingWs = useMemo(() => (workspaceRoot !== undefined ? workspaceRoot : findWorkspace(process.cwd())), [workspaceRoot]);
  const startMenu = mode === 'auto' && !!existingWs && readAssessmentTypes(existingWs) !== undefined;

  const [runMode, setRunMode] = useState<SetupRunMode | 'menu' | 'pick-type'>(() =>
    mode !== 'auto' ? mode : startMenu ? 'menu' : { kind: 'first-run', selected: [] });
  const [session, setSession] = useState<SetupState>(() =>
    ({ ...INITIAL_SESSION, ...(mode !== 'auto' && mode.kind !== 'first-run' && existingWs ? { workDir: existingWs } : {}), ...(startMenu && existingWs ? { workDir: existingWs } : {}) }));
  const [chrome, setChrome] = useState<SetupChrome | null>(null);
  const reportChrome = useCallback((c: SetupChrome | null) => setChrome(c), []);
  // #4394 (Design 126 section 7.8): the one guidance open state of the wizard
  // (tui-kit guidance-open.ts), provided to the menu, the flow and every step.
  const guidance = useGuidanceOpenOwner();

  // #2385: wizard.abort when the wizard unmounts before reaching a Ready step.
  const finished = useRef(false);
  const entryRef = useRef<string>('init');
  // #4345: the reason tells a user Esc, Ctrl+C, a crash (a step's render
  // error, or an uncaught exception) and any other exit apart.
  const abortReason = useRef<'user_escape' | 'crash' | 'exit'>('exit');
  useEffect(() => () => {
    if (!finished.current) {
      const reason = abortReason.current !== 'exit' ? abortReason.current : tuiExitCause() ?? 'exit';
      try { logPortfolio('warn', 'wizard.abort', 'Setup Wizard exited before completion', { context: { last_step: entryRef.current, reason } }); } catch { /* best-effort */ }
    }
    setTuiLocation({ step: undefined });
  }, []);
  const onEntry = useCallback((entry: SetupPlanEntry) => {
    entryRef.current = entryLabel(entry);
    setTuiLocation({ step: entryRef.current });
    if (entry.kind === 'ready') finished.current = true;
  }, []);
  const onStepCrash = useCallback(() => { abortReason.current = 'crash'; }, []);

  // #4341 (Design 126 section 7.5, gate G-09): the Setup menu and its type
  // picker run without flow navigation; their Esc is the wizard's, not the
  // step's: an open guidance box closes first, then the type picker returns to
  // the menu and the menu leaves the Setup.
  const onMenu = (runMode === 'menu' || runMode === 'pick-type') && !!existingWs;
  useInput((_input, key) => {
    if (!key.escape || guidance.isOpen()) return;
    if (runMode === 'menu') onBack(); else setRunMode('menu');
  }, { isActive: onMenu });

  if ((runMode === 'menu' || runMode === 'pick-type') && existingWs) {
    return (
      <GuidanceOpenContext.Provider value={guidance}>
      <ScreenLayout
        header={{ ...header, subtitle: 'Workspace Setup' }}
        title={chrome?.title ? { title: chrome.title, subtitle: chrome.subtitle } : undefined}
        keys={chrome?.keys ?? KEY_HINTS.menu}
        guidance={guidanceOf(chrome)}
      >
        <SetupChromeContext.Provider value={reportChrome}>
          {runMode === 'menu' ? (
            <SetupStartMenu
              workspaceRoot={existingWs}
              onChoose={(c) => {
                if (c === 'type') setRunMode('pick-type');
                else if (c === 'generic') setRunMode({ kind: 'generic' });
                else setRunMode({ kind: 'first-run', selected: [] });
              }}
            />
          ) : (
            <TypeSelectionStep
              single
              title="Set up an assessment type"
              tier={tier}
              initial={[]}
              states={branchStates(existingWs)}
              notes={branchStateNotes(existingWs)}
              onNext={(sel) => {
                if (!sel || sel.length === 0) { setRunMode('menu'); return; }
                setRunMode({ kind: 'branch', type: sel[0]! });
              }}
            />
          )}
        </SetupChromeContext.Provider>
      </ScreenLayout>
      </GuidanceOpenContext.Provider>
    );
  }
  if (typeof runMode === 'string') return null;

  // A fresh flow (step index, reached step) per run mode; the first-run type
  // selection only extends the plan and keeps the flow.
  const flowKey = runMode.kind === 'branch' ? `branch:${runMode.type}` : runMode.kind;
  return (
    <GuidanceOpenContext.Provider value={guidance}>
    <SetupFlow
      key={flowKey}
      reg={reg}
      tier={tier}
      header={header}
      runMode={runMode}
      setRunMode={setRunMode}
      session={session}
      setSession={setSession}
      chrome={chrome}
      reportChrome={reportChrome}
      onBack={onBack}
      onAbort={(entry) => {
        // #4263: the step is cancelled, not completed.
        abortReason.current = 'user_escape';
        if (entry && entry.kind !== 'ready') cancelSetupStep(entry.kind === 'step' ? entry.step.id : entry.kind, 'user_escape');
        onBack();
      }}
      onEntry={onEntry}
      onCrash={onStepCrash}
    />
    </GuidanceOpenContext.Provider>
  );
}

interface SetupFlowProps {
  reg: SetupRegistry;
  tier: LicenceTier;
  header: HeaderBase;
  runMode: SetupRunMode;
  setRunMode: (m: SetupRunMode) => void;
  session: SetupState;
  setSession: (f: (s: SetupState) => SetupState) => void;
  chrome: SetupChrome | null;
  reportChrome: (c: SetupChrome | null) => void;
  onBack: () => void;
  onAbort: (entry: SetupPlanEntry | undefined) => void;
  onEntry: (entry: SetupPlanEntry) => void;
  /** #4345: a step's render error (the boundary shows the ErrorPanel). */
  onCrash: () => void;
}

/** The step flow of one run mode (Design 126 section 4.5, #4254). */
function SetupFlow({ reg, tier, header, runMode, setRunMode, session, setSession, chrome, reportChrome, onBack, onAbort, onEntry, onCrash }: SetupFlowProps) {
  const [health, setHealth] = useState<Partial<Record<SetupScope, SetupHealthResult>>>({});
  const plan = useMemo<SetupPlanEntry[]>(
    () => buildSetupPlan(reg, runMode, { workspaceRoot: session.workDir, tier, session }),
    // The plan depends on the mode, the tier and the workspace; the rest of the
    // session only feeds isApplicable and must not reshuffle the running plan.
    [reg, JSON.stringify(runMode), tier, session.workDir],
  );
  // #3589 / #4190: the plan index whose step owns Esc (an embedded screen, or a
  // step where Esc means "keep"). Keyed by index, so the capture ends with its entry.
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  // Section 7.4: an abort asks first once a step of this flow is done.
  const [anyDone, setAnyDone] = useState(false);
  const [onReady, setOnReady] = useState(false);
  const entryRef = useRef<SetupPlanEntry | undefined>(undefined);
  const kind = chrome?.kind;
  const stepBack = chrome?.back;
  // #4342: whether the step content renders a guidance box of its own.
  const presence = useGuidancePresence();
  // #4394: the wizard's guidance open state (provided by SetupWizard).
  const guidance = useGuidanceOpen();
  const nav = useFlowNavigation({
    // #0760 / #4254: Esc closes an open guidance box first, also a box a step renders itself.
    guidance,
    steps: plan.map(entryLabel),
    // #4341: on a Ready step everything is saved, so Esc leaves without the dialog.
    dirty: anyDone && !onReady,
    onExit: () => onAbort(entryRef.current),
    onFinish: onBack,
    // The arrows belong to the step while it takes text or has not said what it
    // takes (section 7.2). A step with sub-steps goes back inside itself: the
    // listener below then owns Shift+Tab, the Left arrow and Esc.
    textInput: kind === undefined || kind === 'textInput',
    active: capturedAt === null && !stepBack,
    // #4341: arrows never advance a step without the step's own completion.
    arrowForward: false,
  });
  const index = Math.min(nav.current, plan.length - 1);
  const entry = plan[index];
  entryRef.current = entry;
  // #4345: the step goes into a tui.crash record of its own first render.
  if (entry) setTuiLocation({ step: entryLabel(entry) });

  // #0804: reset the guidance open state on every entry change.
  useEffect(() => { guidance.setOpen(false); }, [index, guidance]);
  useEffect(() => { if (entry) onEntry(entry); }, [entry, onEntry]);
  useEffect(() => { setOnReady(entry?.kind === 'ready'); }, [entry]);

  // A step with sub-steps goes back inside itself (Left arrow off a text input, Shift+Tab);
  // Esc still aborts the flow (after an open guidance box closes).
  useInput((_input, key) => {
    if (!stepBack || nav.dialogOpen) return;
    if (key.escape) { if (!guidance.isOpen()) nav.requestAbort(); return; }
    if ((key.tab && key.shift) || (key.leftArrow && kind !== 'textInput')) stepBack();
  }, { isActive: capturedAt === null && !!stepBack });

  if (!entry) return null;
  const bar = stepBarFor(plan, index);
  const stepNumber = bar.currentIndex + 1;
  const hasLaterBranch = plan.slice(index + 1).some((e) => e.kind === 'ready');
  const next = (): void => { setAnyDone(true); nav.next(); };

  const renderEntry = (): JSX.Element | null => {
    switch (entry.kind) {
      case 'step': {
        const C = entry.step.component;
        return (
          <C
            key={entry.step.id}
            ctx={{ workspaceRoot: session.workDir, tier, scope: entry.scope, scopeLabel: SETUP_SCOPE_LABELS[entry.scope], session }}
            stepNumber={stepNumber}
            stepCount={bar.labels.length}
            onNext={next}
            updateSession={(patch) => setSession((s) => ({ ...s, ...patch }))}
            setEscapeCaptured={(c) => setCapturedAt((at) => (c ? index : at === index ? null : at))}
            setGuidanceOpen={guidance.setOpen}
          />
        );
      }
      case 'health-check': {
        const scope = entry.scope;
        return (
          <HealthCheckStep
            key={`health-check-${scope}`}
            scope={scope}
            stepNumber={stepNumber}
            title={`Health Check, ${SETUP_SCOPE_LABELS[scope]}`}
            onNext={(summary) => {
              const result: SetupHealthResult | undefined = summary
                ? { scope, probeCount: summary.probeCount, failCount: summary.failCount, warnCount: summary.warnCount, failedProbes: summary.failedProbes ?? [], warnedProbes: summary.warnedProbes ?? [], ...(summary.incomplete ? { incomplete: summary.incomplete } : {}) }
                : undefined;
              if (result) setHealth((h) => ({ ...h, [scope]: result }));
              try { setWorkspaceRoot(session.workDir); } catch { /* best-effort */ }
              if (scope === 'generic') {
                // #1766: wsp.setup.complete after the workspace health check.
                try {
                  logPortfolio('info', 'wsp.setup.complete', 'Workspace setup completed', {
                    context: { steps_completed: reg.generic.length, workspace: session.workDir, provider: session.llmProvider, model: session.llmModel || null },
                  });
                } catch { /* best-effort */ }
              } else {
                // Design 125 section 7: the branch state from its scoped health check.
                // #4282 (D-8): one rule for every branch; the cause is recorded and logged.
                completeBranchSetup(reg, session.workDir, scope, result);
              }
              next();
            }}
          />
        );
      }
      case 'type-selection': {
        const recorded = readAssessmentTypes(session.workDir);
        return (
          <TypeSelectionStep
            key="type-selection"
            tier={tier}
            initial={recorded ?? inferAssessmentTypes(session.workDir)}
            states={branchStates(session.workDir)}
            notes={branchStateNotes(session.workDir)}
            onNext={(sel) => {
              const selected: SetupAssessmentType[] = sel ?? recorded ?? [];
              if (sel !== undefined || recorded === undefined) writeAssessmentTypes(session.workDir, selected);
              try { logPortfolio('info', 'wizard.assessment_types.selected', 'Assessment types selected', { context: { types: selected, kept: sel === undefined } }); } catch { /* best-effort */ }
              setRunMode({ kind: 'first-run', selected });
              next();
            }}
          />
        );
      }
      case 'ready':
        if (entry.scope === 'generic') {
          return <ReadyStep key="ready-generic" state={session} health={health.generic} onBack={onBack} />;
        }
        return (
          <BranchReadyStep
            key={`ready-${entry.scope}`}
            registry={reg}
            type={entry.scope}
            workspaceRoot={session.workDir}
            health={health[entry.scope]}
            hasNext={hasLaterBranch}
            onNext={() => (hasLaterBranch ? next() : onBack())}
          />
        );
      default: {
        const never: never = entry;
        throw new Error(`unknown setup plan entry: ${JSON.stringify(never)}`);
      }
    }
  };

  // While the AbortDialog is open the step is not rendered (it must not read Enter).
  // #4342 (U-5): a step that reports no chrome gets the hint line of the input
  // the navigation assumes for it (a text input: Shift+Tab back, section 7.2)
  // and the registry guidance unless it renders a box itself.
  const keys = nav.dialogOpen ? KEY_HINTS.abortDialog : chrome?.keys ?? nav.hints(kind ?? 'textInput');
  const fallback = registryGuidance(entry);
  const box = nav.dialogOpen
    ? null
    : chrome?.guidance
      ? guidanceOf(chrome)
      : !presence.present && fallback ? { entry: fallback } : null;
  return (
    <ScreenLayout
      header={{ ...header, subtitle: setupSubtitle(bar.scope), stepInfo: `Step ${stepNumber} of ${bar.labels.length}` }}
      steps={{ labels: bar.labels, current: bar.currentIndex }}
      title={!nav.dialogOpen && chrome?.title ? { title: chrome.title, subtitle: chrome.subtitle } : undefined}
      keys={keys}
      guidance={box}
    >
      <SetupChromeContext.Provider value={reportChrome}>
        <GuidancePresenceContext.Provider value={presence.report}>
          {nav.dialog ?? (
            // #4345: a render error of the step shows the ErrorPanel (Back to the
            // main menu) inside the wizard frame and logs tui.crash.
            <TuiCrashBoundary key={`${index}:${entryLabel(entry)}`} where="step" onBack={onBack} onCrash={onCrash}>
              {renderEntry()}
            </TuiCrashBoundary>
          )}
        </GuidancePresenceContext.Provider>
      </SetupChromeContext.Provider>
    </ScreenLayout>
  );
}
