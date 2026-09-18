// useLlmKeyHandler -- useInput handler extracted from LlmAssessmentScreen.tsx (#2376).

import { useInput } from 'ink';
import type React from 'react';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { LoadedConnector } from '@swao/module-llm-providers';
import type { PendingLeg } from '../types.js';

interface KeyHandlerCtx {
  stage:            string;
  pendingLegs:      PendingLeg[];
  resolvedLegs:     ResolvedLeg[];
  loadedConnectors: LoadedConnector[];
  crawlAvailable:   boolean;
  healthStatus:     'running' | 'ok' | 'fail' | null;
  guidanceOpenRef:  React.MutableRefObject<boolean>;
  onBack:           () => void;
  setStage:         (s: string) => void;
  setNextLeg:       (l: PendingLeg | null) => void;
  setBuildError:    (e: string) => void;
  setIncludeCrawl:  React.Dispatch<React.SetStateAction<boolean>>;
  setPendingLegs:   React.Dispatch<React.SetStateAction<PendingLeg[]>>;
  setResolvedLegs:  (legs: ResolvedLeg[]) => void;
  handleHealthCheckConfirm: () => void;
}

export function useLlmKeyHandler(ctx: KeyHandlerCtx): void {
  useInput((_input, key) => {
    const isTerminal = ctx.stage === 'done' || ctx.stage === 'error' || ctx.stage === 'saving';
    if (ctx.guidanceOpenRef.current && !isTerminal) return;

    if (key.escape) {
      if (['picking-app', 'no-apps', 'error', 'saving', 'done', 'no-legs'].includes(ctx.stage)) {
        ctx.onBack();
      } else if (ctx.stage === 'build-legs') {
        if (ctx.pendingLegs.length === 0) {
          ctx.onBack();
        } else {
          ctx.setPendingLegs(prev => prev.slice(0, -1));
          ctx.setBuildError('');
        }
      } else if (ctx.stage === 'pick-model' || ctx.stage === 'pick-model-custom') {
        ctx.setNextLeg(null);
        ctx.setBuildError('');
        ctx.setStage('build-legs');
      } else if (ctx.stage === 'health-check') {
        if (ctx.healthStatus !== 'running') ctx.setStage('pick-model');
      } else if (ctx.stage === 'review-config') {
        const restored: PendingLeg[] = ctx.resolvedLegs.map((rl) => {
          const loaded = ctx.loadedConnectors.find((c) => c.file.connector.id === rl.connector);
          if (!loaded) return null;
          return { connectorId: rl.connector, connector: loaded, model: rl.model };
        }).filter((l): l is PendingLeg => l !== null);
        ctx.setPendingLegs(restored);
        ctx.setResolvedLegs([]);
        ctx.setStage('build-legs');
      }
    }

    if (_input === 'c' && ctx.stage === 'review-config' && ctx.crawlAvailable) {
      ctx.setIncludeCrawl(prev => !prev);
      return;
    }

    if (key.return) {
      if (ctx.stage === 'done' || ctx.stage === 'error') {
        ctx.onBack();
      } else if (ctx.stage === 'review-config') {
        ctx.setStage('running');
      } else if (ctx.stage === 'health-check' && ctx.healthStatus !== 'running') {
        ctx.handleHealthCheckConfirm();
      }
    }
  });
}
