// useLlmHandlers -- handler functions extracted from LlmAssessmentScreen.tsx (#2376).

import type React from 'react';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { LoadedConnector } from '@swao/module-llm-providers';
import type { EligibleApp, PendingLeg } from '../types.js';
import { writeLlmLegsToSwaoYml, buildResolvedLegs } from '../legPersist.js';

const MIN_LEGS = 2;
const MAX_LEGS = 5;

interface HandlersCtx {
  eligibleApps:       EligibleApp[];
  loadedConnectors:   LoadedConnector[];
  configuredCredKeys: Set<string>;
  pendingLegs:        PendingLeg[];
  crawlAvailable:     boolean;
  resolvedLegs:       ResolvedLeg[];
  workspacePath:      string;
  healthStatus:       'running' | 'ok' | 'fail' | null;
  healthPermanent:    boolean;
  nextLegRef:         React.RefObject<PendingLeg | null>;
  // setters
  setSelectedApp:      (app: EligibleApp | null) => void;
  setCrawlAvailable:   (v: boolean) => void;
  setIncludeCrawl:     (v: boolean) => void;
  setPendingLegs:      React.Dispatch<React.SetStateAction<PendingLeg[]>>;
  setNextLeg:          (l: PendingLeg | null) => void;
  setBuildError:       (e: string) => void;
  setStage:            (s: string) => void;
  setResolvedLegs:     (legs: ResolvedLeg[]) => void;
  setErrorMsg:         (m: string) => void;
  setLlmCfg:           (cfg: SwaoYmlLlmAssessment | null) => void;
  setHealthStatus:     (s: 'running' | 'ok' | 'fail' | null) => void;
  setHealthMessage:    (m: string) => void;
  setHealthPermanent:  (p: boolean) => void;
}

export interface LlmHandlers {
  handleAppSelect:         (appId: string) => void;
  handleConnectorSelect:   (connectorId: string) => void;
  handleModelSelect:       (model: string) => void;
  handleHealthCheckConfirm: () => void;
}

export function useLlmHandlers(ctx: HandlersCtx): LlmHandlers {
  function handleAppSelect(appId: string): void {
    const app = ctx.eligibleApps.find((a) => a.id === appId);
    if (!app) return;
    ctx.setSelectedApp(app);
    const hasVaultUrl = ctx.configuredCredKeys.has(`playwright-url-${appId}`);
    const isCrawlAvailable = ctx.crawlAvailable || hasVaultUrl;
    ctx.setCrawlAvailable(isCrawlAvailable);
    ctx.setIncludeCrawl(isCrawlAvailable);
    ctx.setPendingLegs([]);
    ctx.setNextLeg(null);
    ctx.setBuildError('');
    ctx.setStage(ctx.loadedConnectors.length === 0 ? 'no-legs' : 'build-legs');
  }

  function handleConnectorSelect(connectorId: string): void {
    if (connectorId === '__done__') {
      if (ctx.pendingLegs.length >= MIN_LEGS) finaliseLegConfig(ctx.pendingLegs);
      return;
    }
    const loaded = ctx.loadedConnectors.find((c) => c.file.connector.id === connectorId);
    if (!loaded) return;
    const conn = loaded.file.connector;
    ctx.setNextLeg({ connectorId, connector: loaded, model: conn.models.default });
    ctx.setHealthStatus(null);
    ctx.setHealthMessage('');
    ctx.setBuildError('');
    ctx.setStage('pick-model');
  }

  function handleModelSelect(model: string): void {
    const leg = ctx.nextLegRef.current;
    if (!leg) return;
    ctx.setNextLeg({ ...leg, model });
    ctx.setHealthStatus(null);
    ctx.setHealthMessage('');
    ctx.setHealthPermanent(false);
    ctx.setStage('health-check');
  }

  function finaliseLegConfig(legs: PendingLeg[]): void {
    const { legDefs, resolved } = buildResolvedLegs(legs);
    try {
      writeLlmLegsToSwaoYml(ctx.workspacePath, legDefs);
    } catch (err: unknown) {
      ctx.setErrorMsg(`Could not write .swao.yml: ${err instanceof Error ? err.message : String(err)}`);
      ctx.setStage('error');
      return;
    }
    ctx.setLlmCfg({ legs: legDefs });
    ctx.setResolvedLegs(resolved);
    ctx.setStage('review-config');
  }

  function handleHealthCheckConfirm(): void {
    const leg = ctx.nextLegRef.current;
    if (!leg) return;
    if (ctx.healthStatus === 'fail' && ctx.healthPermanent) {
      ctx.setBuildError(
        `Model permanently unavailable (404 -- model removed from provider). Remove from llm-compare.yaml and pick a different model.`,
      );
      ctx.setNextLeg(null);
      ctx.setHealthPermanent(false);
      ctx.setStage('build-legs');
      return;
    }
    if (ctx.pendingLegs.some((l) => l.connectorId === leg.connectorId && l.model === leg.model)) {
      ctx.setBuildError(`Leg ${leg.connectorId} / ${leg.model} is already in the list. Pick a different model.`);
      ctx.setNextLeg(null);
      ctx.setStage('build-legs');
      return;
    }
    const newLegs = [...ctx.pendingLegs, leg];
    ctx.setPendingLegs(newLegs);
    ctx.setNextLeg(null);
    if (newLegs.length >= MAX_LEGS) {
      finaliseLegConfig(newLegs);
    } else {
      ctx.setStage('build-legs');
    }
  }

  return { handleAppSelect, handleConnectorSelect, handleModelSelect, handleHealthCheckConfirm };
}
