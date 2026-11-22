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

// L4 TUI flow for LLM Assessment (Design 092, #1427). Thin stage orchestrator
// after #2376 sprint-130 refactor. Stage-specific JSX lives in llm-assess/stages/;
// effects and handlers live in llm-assess/hooks/.

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Box, Text } from 'ink';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import type { ResolvedLeg, OrchestrationResult } from '@swao/module-llm-assessment';
import type { LoadedConnector } from '@swao/module-llm-providers';
import { KEY_HINTS, ScreenLayout, useFlowNavigation, type SelectOption } from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { LlmStageChromeContext, type LlmStageChrome } from './llm-assess/stage-frame.js';
import { LLM_REMOVE_LAST, removeLastLegOption } from './llm-assess/stages/LegBuilderStage.js';
import { modelLabel } from '../model-label.js';
import type { EligibleApp, PendingLeg, UnavailableApp } from './llm-assess/types.js';
import { AppPickerStage }    from './llm-assess/stages/AppPickerStage.js';
import { LegBuilderStage }   from './llm-assess/stages/LegBuilderStage.js';
import { ModelPickerStage }  from './llm-assess/stages/ModelPickerStage.js';
import { HealthCheckStage }  from './llm-assess/stages/HealthCheckStage.js';
import { ReviewConfigStage } from './llm-assess/stages/ReviewConfigStage.js';
import { SaveDefaultStage }  from './llm-assess/stages/SaveDefaultStage.js';
import { RunningStage }      from './llm-assess/stages/RunningStage.js';
import { ResultStage, LLM_RUN_AGAIN } from './llm-assess/stages/ResultStage.js';
export { LlmResultTable } from './llm-assess/LlmResultTable.js';
import { useLlmLoader }      from './llm-assess/hooks/useLlmLoader.js';
import { useLlmHealthCheck } from './llm-assess/hooks/useLlmHealthCheck.js';
import { useLlmRunning }     from './llm-assess/hooks/useLlmRunning.js';
import { useLlmHandlers }    from './llm-assess/hooks/useLlmHandlers.js';
import { LLM_DIRTY_STAGES, useLlmKeyHandler } from './llm-assess/hooks/useLlmKeyHandler.js';
import { defaultPendingLegs } from './llm-assess/preselect.js';
import { estimateLlmReview, readMeasuredLegs } from './llm-assess/review-estimate.js';
import type { LlmDefaults } from '../../setup/defaults.js';

type Stage =
  | 'loading' | 'picking-app' | 'no-apps' | 'no-legs' | 'build-legs'
  | 'pick-model' | 'pick-model-custom' | 'health-check' | 'save-default' | 'review-config'
  | 'running' | 'saving' | 'done' | 'error';

export interface LlmAssessmentScreenProps {
  workspacePath?: string;
  onBack: () => void;
}

/** #4255 (Design 126 sections 3 and 4.5): the step bar of the LLM Assessment flow (names, no numbers). */
export const LLM_STEPS = ['Application', 'LLM Providers', 'Check', 'Review', 'Run', 'Done'] as const;
/** #4255: the step of the bar each stage belongs to. */
export const LLM_STAGE_STEP: Readonly<Record<Stage, number>> = {
  loading: 0, 'picking-app': 0, 'no-apps': 0,
  'no-legs': 1, 'build-legs': 1, 'pick-model': 1, 'pick-model-custom': 1,
  'health-check': 2, 'save-default': 3, 'review-config': 3,
  running: 4, saving: 5, done: 5, error: 5,
};

/** #4255: the chrome of the loading stage, before a stage reports its own. */
const LOADING_CHROME: LlmStageChrome = {
  keys: [{ key: 'Esc', verb: 'abort' }],
  guidance: { title: 'LLM Assessment', what: 'Compares LLM Providers on the pass suite of one application: each provider runs the same passes, the results are scored side by side.' },
};

const MAX_LEGS = 5;
const MIN_LEGS = 2;

const STAGE_SUBTITLE: Record<Stage, string> = {
  loading: 'LLM Assessment', 'picking-app': 'Select Application', 'no-apps': 'No Eligible Apps',
  'no-legs': 'No Connectors', 'build-legs': 'Select LLM Providers', 'pick-model': 'Select Model',
  'pick-model-custom': 'Custom Model', 'health-check': 'Connectivity Check',
  'save-default': 'Save as Default', 'review-config': 'Review Configuration', running: 'Running',
  saving: 'Complete', done: 'Complete', error: 'Error',
};

export function LlmAssessmentScreen({
  workspacePath: workspacePathProp,
  onBack,
}: LlmAssessmentScreenProps): React.JSX.Element {
  const [stage,              setStage]             = useState<Stage>('loading');
  const [errorMsg,           setErrorMsg]          = useState('');
  const [workspacePath,      setWp]               = useState('');
  const [eligibleApps,       setEligibleApps]      = useState<EligibleApp[]>([]);
  const [unavailableApps,    setUnavailableApps]   = useState<UnavailableApp[]>([]);
  const [selectedApp,        setSelectedApp]       = useState<EligibleApp | null>(null);
  const [llmCfg,             setLlmCfg]            = useState<SwaoYmlLlmAssessment | null>(null);
  const [resolvedLegs,       setResolvedLegs]      = useState<ResolvedLeg[]>([]);
  const [progressLines,      setProgress]          = useState<string[]>([]);
  const [legCallLines,       setLegCallLines]      = useState<string[]>([]);
  // #4472: passes the running leg has completed (moves the Stage bar).
  const [legPassesDone,      setLegPassesDone]     = useState(0);
  // #4472: the leg the passes done belong to.
  const [legPassesLeg,       setLegPassesLeg]      = useState<string | undefined>(undefined);
  const [result,             setResult]            = useState<OrchestrationResult | null>(null);
  const [loadedConnectors,   setLoadedConnectors]  = useState<LoadedConnector[]>([]);
  const [configuredCredKeys, setConfiguredCredKeys] = useState<Set<string>>(new Set());
  const [crawlAvailable,     setCrawlAvailable]    = useState(false);
  const [includeCrawl,       setIncludeCrawl]      = useState(false);
  const [pendingLegs,        setPendingLegs]       = useState<PendingLeg[]>([]);
  const [nextLeg,            setNextLeg]           = useState<PendingLeg | null>(null);
  const [buildError,         setBuildError]        = useState('');
  const [guidanceOpen,       setGuidanceOpen]      = useState(false);
  const [llmDefaults,        setLlmDefaults]       = useState<LlmDefaults>({ candidates: [], source: 'none' });

  const guidanceOpenRef        = useRef(false);
  const nextLegRef             = useRef<PendingLeg | null>(null);
  nextLegRef.current = nextLeg;
  const legWorkspaceForPollRef = useRef<string | null>(null);
  const runStartedAtRef        = useRef<number>(0);
  // #4243: preparation status line of a running assessment.
  const [statusLine,         setStatusLine]        = useState<string | null>(null);
  const abortRef               = useRef<AbortController | null>(null);

  // #4255 / #4257 (Design 126 sections 3, 5.2 and 7): one ScreenLayout for every
  // stage; a stage hands its key hints and guidance entry up (LlmStageFrame).
  const header = useScreenHeader('LLM Assessment');
  const [chrome, setChrome] = useState<LlmStageChrome>(LOADING_CHROME);
  const reportChrome = useCallback((c: LlmStageChrome | null) => { if (c) setChrome(c); }, []);
  // #4255 (Design 126 sections 7.4 and 7.5): Esc aborts the flow; the AbortDialog
  // asks once an application is chosen. The screen reads the keys (its stages are
  // the steps), the hook provides the dialog and the decision.
  const nav = useFlowNavigation({ steps: LLM_STEPS, dirty: LLM_DIRTY_STAGES.has(stage), onExit: onBack, what: 'assessment', active: false });
  const onGuidanceChange = (open: boolean): void => { guidanceOpenRef.current = open; setGuidanceOpen(open); nav.onGuidanceOpenChange(open); };
  // A new stage starts with the guidance box collapsed (the layout is keyed by stage).
  useEffect(() => { guidanceOpenRef.current = false; setGuidanceOpen(false); nav.onGuidanceOpenChange(false); }, [stage]);

  // Effects
  useLlmLoader({
    stage, workspacePathProp,
    onDone: (noApps, s) => {
      setWp(s.workspacePath); setEligibleApps(s.eligibleApps); setUnavailableApps(s.unavailableApps); setLlmCfg(s.llmCfg);
      setLoadedConnectors(s.loadedConnectors); setConfiguredCredKeys(s.configuredCredKeys);
      setCrawlAvailable(s.crawlAvailable); setIncludeCrawl(s.includeCrawlInitial);
      setLlmDefaults(s.defaults);
      setStage(noApps ? 'no-apps' : 'picking-app');
    },
    onError: (msg) => { setErrorMsg(msg); setStage('error'); },
  });

  const healthCheck = useLlmHealthCheck(stage, nextLegRef);

  useLlmRunning({
    stage, selectedApp, resolvedLegs, workspacePath, includeCrawl, llmCfg,
    setStage: (s) => setStage(s as Stage), setResult, setErrorMsg, setProgress, setLegCallLines, setLegPassesDone: (n: number, legId?: string) => { setLegPassesDone(n); setLegPassesLeg(legId); },
    result, legWorkspaceForPollRef, runStartedAtRef, setStatusLine, abortRef,
  });

  const handlers = useLlmHandlers({
    eligibleApps, loadedConnectors, configuredCredKeys, pendingLegs, crawlAvailable,
    resolvedLegs, workspacePath, healthStatus: healthCheck.healthStatus,
    healthPermanent: healthCheck.healthPermanent, nextLegRef,
    defaultLegs: defaultPendingLegs(llmDefaults.candidates, loadedConnectors, MAX_LEGS),
    setSelectedApp, setCrawlAvailable, setIncludeCrawl, setPendingLegs,
    setNextLeg, setBuildError, setStage: (s) => setStage(s as Stage),
    setResolvedLegs, setErrorMsg, setLlmCfg,
    setHealthStatus: healthCheck.setHealthStatus,
    setHealthMessage: healthCheck.setHealthMessage,
    setHealthPermanent: healthCheck.setHealthPermanent,
  });

  // #4256: the score table of the finish screen owns Enter and Esc while open.
  const finishDetailsOpenRef = useRef(false);
  // #4255: the stages whose input is a text field (the left arrow moves the text cursor).
  const textInputStage = stage === 'pick-model-custom' || (stage === 'pick-model' && !!nextLeg && (nextLeg.connector.file.connector.models.catalogue ?? []).length === 0);
  useLlmKeyHandler({
    stage, pendingLegs, resolvedLegs, loadedConnectors, crawlAvailable,
    healthStatus: healthCheck.healthStatus, guidanceOpenRef,
    requestAbort: nav.requestAbort, dialogOpen: nav.dialogOpen, textInput: textInputStage,
    setStage: (s) => setStage(s as Stage), setNextLeg, setBuildError,
    setIncludeCrawl, setPendingLegs, setResolvedLegs,
    handleHealthCheckConfirm: handlers.handleHealthCheckConfirm,
    finishDetailsOpenRef,
  });

  // Derived values
  const hasCredential = (c: LoadedConnector): boolean => {
    const key = c.file.connector.auth.credential_key;
    return !key || configuredCredKeys.has(key);
  };
  // #4220: the connector name as the label; the id and a missing key in the dim detail column.
  const buildLegOptions: SelectOption[] = [
    ...loadedConnectors.map((c) => ({
      label: c.file.connector.name,
      value: c.file.connector.id,
      detail: hasCredential(c) ? c.file.connector.id : `${c.file.connector.id}, no key set in Setup`,
      // #4230: the guidance follows the highlighted connector.
      guidance: {
        title: c.file.connector.name,
        what: `Adds one LLM Provider on the connector ${c.file.connector.name} (${c.file.connector.id}); you pick its model next. Add it again with another model to compare models of one connector.`,
        sections: hasCredential(c) ? [] : [{ label: 'Auth', text: 'No key is stored for this connector; the connectivity check fails until the key is set in Setup.' }],
      },
    })),
    // #4255: removing a provider is a list entry (Esc used to remove the last one).
    ...(pendingLegs.length > 0
      ? [removeLastLegOption(pendingLegs.length, `${pendingLegs[pendingLegs.length - 1]!.connectorId} / ${modelLabel(pendingLegs[pendingLegs.length - 1]!.model)}`)]
      : []),
    ...(pendingLegs.length >= MIN_LEGS
      ? [{
        label: 'Done', value: '__done__', detail: `${pendingLegs.length} LLM Provider(s) ready`,
        guidance: { title: 'Done', what: `Ends the list with ${pendingLegs.length} LLM Providers and moves on to the save as default question and the review of this run.` },
      }]
      : []),
  ];
  // #4497: per LLM Provider: the measured cost of an earlier run of the app, else the calls times the model price.
  const reviewEstimate = useMemo(() => (stage === 'review-config' && selectedApp && resolvedLegs.length > 0
    ? estimateLlmReview({
      legs: resolvedLegs,
      passCount: selectedApp.passCount,
      connectors: (id) => loadedConnectors.find((c) => c.file.connector.id === id)?.file.connector,
      ...(workspacePath ? { measured: readMeasuredLegs(workspacePath, selectedApp.id) } : {}),
    })
    : undefined), [stage, selectedApp, resolvedLegs, loadedConnectors, workspacePath]);
  const prevLegHint  = llmCfg?.legs ? llmCfg.legs.map((l) => `${l.connector} / ${modelLabel(l.model ?? 'default')}`).join(', ') : 'none';

  // #4255 (Design 126 section 7.2): back to the application keeps the provider list;
  // the same application again goes on to the kept list, another one starts from the defaults.
  const onAppSelect = (appId: string): void => {
    if (selectedApp?.id === appId && pendingLegs.length > 0) { setNextLeg(null); setBuildError(''); setStage('build-legs'); return; }
    handlers.handleAppSelect(appId);
  };
  // #4255: the provider step routes its remove entry here, before the connector handler.
  const onConnectorSelect = (value: string): void => {
    if (value === LLM_REMOVE_LAST) { setPendingLegs((prev) => prev.slice(0, -1)); setBuildError(''); return; }
    handlers.handleConnectorSelect(value);
  };

  // #4255 / #4257 (Design 126 section 3): ScreenLayout draws header, licence
  // line, step bar, content, key hints and guidance box in that order; the
  // AbortDialog replaces the stage content while it is open (its keys are the
  // dialog's). Keyed by stage, so each stage starts with the box collapsed.
  return (
    <ScreenLayout
      key={stage}
      header={header}
      steps={{ labels: [...LLM_STEPS], current: LLM_STAGE_STEP[stage] }}
      // Block 4: the stage name; the run and finish screens name their state in the panel (as Service, #4256).
      title={stage === 'running' || stage === 'done' || stage === 'saving' || stage === 'error' ? undefined : { title: STAGE_SUBTITLE[stage] }}
      keys={nav.dialogOpen ? KEY_HINTS.abortDialog : chrome.keys}
      guidance={{ entry: chrome.guidance, initiallyCollapsed: true, onOpenChange: onGuidanceChange }}
    >
    <LlmStageChromeContext.Provider value={reportChrome}>
    {nav.dialog ?? (
    <Box flexDirection="column">
      {stage === 'loading' && <Text>Loading workspace...</Text>}

      {(stage === 'no-apps' || stage === 'picking-app') && (
        <AppPickerStage
          eligibleApps={eligibleApps} unavailableApps={unavailableApps} noApps={stage === 'no-apps'}
          defaultAppId={llmDefaults.subjectApp}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onSelect={onAppSelect}
        />
      )}
      {(stage === 'no-legs' || stage === 'build-legs') && (
        <LegBuilderStage
          noLegs={stage === 'no-legs'} pendingLegs={pendingLegs}
          buildLegOptions={buildLegOptions} buildError={buildError}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          prevLegHint={prevLegHint} minLegs={MIN_LEGS} maxLegs={MAX_LEGS}
          onConnectorSelect={onConnectorSelect}
        />
      )}
      {(stage === 'pick-model' || stage === 'pick-model-custom') && nextLeg && (
        <ModelPickerStage
          isCustom={stage === 'pick-model-custom'} pendingLegCount={pendingLegs.length}
          nextLeg={nextLeg} guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onModelSelect={handlers.handleModelSelect}
          onCustom={() => setStage('pick-model-custom')}
          // #4475: the served models merged into the workspace connector file; the leg
          // and the next LLM Provider on this connector use the refreshed catalogue.
          workspacePath={workspacePath || undefined}
          onConnectorRefreshed={(l) => {
            setNextLeg((prev) => (prev && prev.connectorId === l.file.connector.id ? { ...prev, connector: l } : prev));
            setLoadedConnectors((prev) => prev.map((c) => (c.file.connector.id === l.file.connector.id ? l : c)));
          }}
        />
      )}
      {stage === 'health-check' && nextLeg && (
        <HealthCheckStage
          pendingLegCount={pendingLegs.length} nextLeg={nextLeg}
          healthStatus={healthCheck.healthStatus} healthMessage={healthCheck.healthMessage}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onConfirm={handlers.handleHealthCheckConfirm}
        />
      )}
      {stage === 'save-default' && resolvedLegs.length > 0 && (
        <SaveDefaultStage
          resolvedLegs={resolvedLegs} setupCandidates={llmDefaults.candidatesFrom === 'assessment.llm'}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onAnswer={handlers.handleSaveDefault}
        />
      )}
      {stage === 'review-config' && selectedApp && resolvedLegs.length > 0 && reviewEstimate && (
        <ReviewConfigStage
          selectedApp={selectedApp} resolvedLegs={resolvedLegs} estimate={reviewEstimate}
          workspacePath={workspacePath || undefined}
          crawlAvailable={crawlAvailable} includeCrawl={includeCrawl}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onConfirm={() => setStage('running')}
        />
      )}
      {stage === 'running' && selectedApp && (
        <RunningStage
          resolvedLegs={resolvedLegs} progressLines={progressLines}
          legCallLines={legCallLines} selectedAppId={selectedApp.id}
          legPassesDone={legPassesDone} {...(legPassesLeg ? { legPassesLeg } : {})} {...(selectedApp.suiteRun ? { passTotal: selectedApp.suiteRun.passCount } : {})}
          statusLine={statusLine} abort={abortRef.current}
          // #4256 (Design 126 section 7.6): after the AbortDialog the orchestrator is aborted (the run
          // folder is marked cancelled, finished legs are kept) and the flow returns to the review.
          onCancel={() => { abortRef.current?.abort(); setProgress([]); setLegCallLines([]); setStatusLine(null); setStage('review-config'); }}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
        />
      )}
      {(stage === 'saving' || stage === 'done' || stage === 'error') && (
        <ResultStage
          stage={stage} result={result} legs={resolvedLegs} errorMsg={errorMsg}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          // #4256: What next; Run again returns to the review of the same LLM Providers.
          onNext={(v) => { if (v === LLM_RUN_AGAIN && resolvedLegs.length > 0 && selectedApp) { setResult(null); setProgress([]); setLegCallLines([]); setStatusLine(null); setErrorMsg(''); setStage('review-config'); } else onBack(); }}
          onDetailsChange={(open) => { finishDetailsOpenRef.current = open; }}
        />
      )}
    </Box>
    )}
    </LlmStageChromeContext.Provider>
    </ScreenLayout>
  );
}
