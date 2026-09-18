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

import React, { useState, useRef } from 'react';
import { Box, Text } from 'ink';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import type { ResolvedLeg, OrchestrationResult } from '@swao/module-llm-assessment';
import type { LoadedConnector } from '@swao/module-llm-providers';
import { Header } from '../components/Header.js';
import type { EligibleApp, PendingLeg } from './llm-assess/types.js';
import { AppPickerStage }    from './llm-assess/stages/AppPickerStage.js';
import { LegBuilderStage }   from './llm-assess/stages/LegBuilderStage.js';
import { ModelPickerStage }  from './llm-assess/stages/ModelPickerStage.js';
import { HealthCheckStage }  from './llm-assess/stages/HealthCheckStage.js';
import { ReviewConfigStage } from './llm-assess/stages/ReviewConfigStage.js';
import { RunningStage }      from './llm-assess/stages/RunningStage.js';
import { ResultStage }       from './llm-assess/stages/ResultStage.js';
export { LlmResultTable } from './llm-assess/LlmResultTable.js';
import { useLlmLoader }      from './llm-assess/hooks/useLlmLoader.js';
import { useLlmHealthCheck } from './llm-assess/hooks/useLlmHealthCheck.js';
import { useLlmRunning }     from './llm-assess/hooks/useLlmRunning.js';
import { useLlmHandlers }    from './llm-assess/hooks/useLlmHandlers.js';
import { useLlmKeyHandler }  from './llm-assess/hooks/useLlmKeyHandler.js';

type Stage =
  | 'loading' | 'picking-app' | 'no-apps' | 'no-legs' | 'build-legs'
  | 'pick-model' | 'pick-model-custom' | 'health-check' | 'review-config'
  | 'running' | 'saving' | 'done' | 'error';

export interface LlmAssessmentScreenProps {
  workspacePath?: string;
  onBack: () => void;
}

const MAX_LEGS = 5;
const MIN_LEGS = 2;

const STAGE_SUBTITLE: Record<Stage, string> = {
  loading: 'LLM Assessment', 'picking-app': 'Select Application', 'no-apps': 'No Eligible Apps',
  'no-legs': 'No Connectors', 'build-legs': 'Select LLM Providers', 'pick-model': 'Select Model',
  'pick-model-custom': 'Custom Model', 'health-check': 'Connectivity Check',
  'review-config': 'Review Configuration', running: 'Running',
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
  const [selectedApp,        setSelectedApp]       = useState<EligibleApp | null>(null);
  const [llmCfg,             setLlmCfg]            = useState<SwaoYmlLlmAssessment | null>(null);
  const [resolvedLegs,       setResolvedLegs]      = useState<ResolvedLeg[]>([]);
  const [progressLines,      setProgress]          = useState<string[]>([]);
  const [legCallLines,       setLegCallLines]      = useState<string[]>([]);
  const [result,             setResult]            = useState<OrchestrationResult | null>(null);
  const [loadedConnectors,   setLoadedConnectors]  = useState<LoadedConnector[]>([]);
  const [configuredCredKeys, setConfiguredCredKeys] = useState<Set<string>>(new Set());
  const [crawlAvailable,     setCrawlAvailable]    = useState(false);
  const [includeCrawl,       setIncludeCrawl]      = useState(false);
  const [pendingLegs,        setPendingLegs]       = useState<PendingLeg[]>([]);
  const [nextLeg,            setNextLeg]           = useState<PendingLeg | null>(null);
  const [buildError,         setBuildError]        = useState('');
  const [guidanceOpen,       setGuidanceOpen]      = useState(false);

  const guidanceOpenRef        = useRef(false);
  const nextLegRef             = useRef<PendingLeg | null>(null);
  nextLegRef.current = nextLeg;
  const legWorkspaceForPollRef = useRef<string | null>(null);
  const runStartedAtRef        = useRef<number>(0);

  const onGuidanceChange = (open: boolean): void => { guidanceOpenRef.current = open; setGuidanceOpen(open); };

  // Effects
  useLlmLoader({
    stage, workspacePathProp,
    onDone: (noApps, s) => {
      setWp(s.workspacePath); setEligibleApps(s.eligibleApps); setLlmCfg(s.llmCfg);
      setLoadedConnectors(s.loadedConnectors); setConfiguredCredKeys(s.configuredCredKeys);
      setCrawlAvailable(s.crawlAvailable); setIncludeCrawl(s.includeCrawlInitial);
      setStage(noApps ? 'no-apps' : 'picking-app');
    },
    onError: (msg) => { setErrorMsg(msg); setStage('error'); },
  });

  const healthCheck = useLlmHealthCheck(stage, nextLegRef);

  useLlmRunning({
    stage, selectedApp, resolvedLegs, workspacePath, includeCrawl, llmCfg,
    setStage: (s) => setStage(s as Stage), setResult, setErrorMsg, setProgress, setLegCallLines,
    result, legWorkspaceForPollRef, runStartedAtRef,
  });

  const handlers = useLlmHandlers({
    eligibleApps, loadedConnectors, configuredCredKeys, pendingLegs, crawlAvailable,
    resolvedLegs, workspacePath, healthStatus: healthCheck.healthStatus,
    healthPermanent: healthCheck.healthPermanent, nextLegRef,
    setSelectedApp, setCrawlAvailable, setIncludeCrawl, setPendingLegs,
    setNextLeg, setBuildError, setStage: (s) => setStage(s as Stage),
    setResolvedLegs, setErrorMsg, setLlmCfg,
    setHealthStatus: healthCheck.setHealthStatus,
    setHealthMessage: healthCheck.setHealthMessage,
    setHealthPermanent: healthCheck.setHealthPermanent,
  });

  useLlmKeyHandler({
    stage, pendingLegs, resolvedLegs, loadedConnectors, crawlAvailable,
    healthStatus: healthCheck.healthStatus, guidanceOpenRef, onBack,
    setStage: (s) => setStage(s as Stage), setNextLeg, setBuildError,
    setIncludeCrawl, setPendingLegs, setResolvedLegs,
    handleHealthCheckConfirm: handlers.handleHealthCheckConfirm,
  });

  // Derived values
  const hasCredential = (c: LoadedConnector): boolean => {
    const key = c.file.connector.auth.credential_key;
    return !key || configuredCredKeys.has(key);
  };
  const buildLegOptions = [
    ...loadedConnectors.map((c) => ({
      label: `${c.file.connector.name}  [${c.file.connector.id}]` + (hasCredential(c) ? '' : '  [no key -- run swao setup]'),
      value: c.file.connector.id,
    })),
    ...(pendingLegs.length >= MIN_LEGS
      ? [{ label: `--- Done  (${pendingLegs.length} LLM Provider(s) ready)`, value: '__done__' }]
      : []),
  ];
  const costEstimate = selectedApp && resolvedLegs.length > 0 ? selectedApp.passCount * resolvedLegs.length * 0.002 : 0;
  const prevLegHint  = llmCfg?.legs ? llmCfg.legs.map((l) => `${l.connector} / ${l.model}`).join(', ') : 'none';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header contextPrefix="LLM Assessment" subtitle={STAGE_SUBTITLE[stage]} />

      {stage === 'loading' && <Text>Loading workspace...</Text>}

      {(stage === 'no-apps' || stage === 'picking-app') && (
        <AppPickerStage
          eligibleApps={eligibleApps} noApps={stage === 'no-apps'}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onSelect={handlers.handleAppSelect}
        />
      )}
      {(stage === 'no-legs' || stage === 'build-legs') && (
        <LegBuilderStage
          noLegs={stage === 'no-legs'} pendingLegs={pendingLegs}
          buildLegOptions={buildLegOptions} buildError={buildError}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          prevLegHint={prevLegHint} minLegs={MIN_LEGS} maxLegs={MAX_LEGS}
          onConnectorSelect={handlers.handleConnectorSelect}
        />
      )}
      {(stage === 'pick-model' || stage === 'pick-model-custom') && nextLeg && (
        <ModelPickerStage
          isCustom={stage === 'pick-model-custom'} pendingLegCount={pendingLegs.length}
          nextLeg={nextLeg} guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
          onModelSelect={handlers.handleModelSelect}
          onCustom={() => setStage('pick-model-custom')}
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
      {stage === 'review-config' && selectedApp && resolvedLegs.length > 0 && (
        <ReviewConfigStage
          selectedApp={selectedApp} resolvedLegs={resolvedLegs} costEstimate={costEstimate}
          crawlAvailable={crawlAvailable} includeCrawl={includeCrawl}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
        />
      )}
      {stage === 'running' && selectedApp && (
        <RunningStage
          resolvedLegs={resolvedLegs} progressLines={progressLines}
          legCallLines={legCallLines} selectedAppId={selectedApp.id}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
        />
      )}
      {(stage === 'saving' || stage === 'done' || stage === 'error') && (
        <ResultStage
          stage={stage} result={result} legs={resolvedLegs} errorMsg={errorMsg}
          guidanceOpen={guidanceOpen} onGuidanceOpenChange={onGuidanceChange}
        />
      )}
    </Box>
  );
}
