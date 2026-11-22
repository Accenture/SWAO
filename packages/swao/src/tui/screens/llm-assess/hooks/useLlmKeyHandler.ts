// useLlmKeyHandler -- useInput handler extracted from LlmAssessmentScreen.tsx (#2376).
//
// #4255 (Design 126 sections 7.2, 7.4 and 7.5): one Esc owner. Esc aborts the
// flow through useFlowNavigation (`requestAbort`: at once when nothing would
// be lost, after the AbortDialog once an application is chosen); the left
// arrow, or Shift+Tab in a text input, goes back one stage with the values
// kept (`llmBackStage`). Esc used to step back (and to remove the last LLM
// Provider); removing a provider is now a list entry of the provider step.

import { useInput } from 'ink';
import { guidanceOwnsKey } from '@swao/tui-kit';
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
  /** Esc: abort the flow (useFlowNavigation decides whether the AbortDialog asks first). */
  requestAbort:     () => void;
  /** True while the AbortDialog is open: it owns Enter and Esc. */
  dialogOpen:       boolean;
  /** The current stage is a text input: the left arrow moves the text cursor, Shift+Tab goes back. */
  textInput?:       boolean;
  setStage:         (s: string) => void;
  setNextLeg:       (l: PendingLeg | null) => void;
  setBuildError:    (e: string) => void;
  setIncludeCrawl:  React.Dispatch<React.SetStateAction<boolean>>;
  setPendingLegs:   React.Dispatch<React.SetStateAction<PendingLeg[]>>;
  setResolvedLegs:  (legs: ResolvedLeg[]) => void;
  handleHealthCheckConfirm: () => void;
  /** #4256: the finish screen shows its score table; Esc closes the table, not the screen. */
  finishDetailsOpenRef?: React.MutableRefObject<boolean>;
}

/** The stages of the flow before the run that hold input an abort would lose. */
export const LLM_DIRTY_STAGES: ReadonlySet<string> = new Set([
  'build-legs', 'pick-model', 'pick-model-custom', 'health-check', 'save-default', 'review-config',
]);

/**
 * #4255 (Design 126 section 7.2): the stage the back key returns to, or null
 * where there is no back (first step, run, finish). The values stay: the
 * chosen application, the providers of the list, the review legs (restored to
 * the list).
 */
export function llmBackStage(stage: string, healthStatus: 'running' | 'ok' | 'fail' | null = null): string | null {
  switch (stage) {
    case 'no-legs':
    case 'build-legs':
      return 'picking-app';
    case 'pick-model':
      return 'build-legs';
    case 'pick-model-custom':
      return 'pick-model';
    case 'health-check':
      return healthStatus === 'running' ? null : 'pick-model';
    case 'save-default':
    case 'review-config':
      return 'build-legs';
    default:
      return null;
  }
}

export function useLlmKeyHandler(ctx: KeyHandlerCtx): void {
  useInput((_input, key) => {
    // #4255: the AbortDialog owns Enter and Esc while it is open.
    if (ctx.dialogOpen) return;

    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and
    // PgDn only; the arrows, number keys and Enter keep working with it open.
    if (guidanceOwnsKey(key, ctx.guidanceOpenRef.current)) return;

    // #4256 (Design 126 section 7.6): the RunPanel of the running stage owns Esc
    // (AbortDialog, then cancel); this handler reads no key during the run.
    if (ctx.stage === 'running') return;

    // #4256: the open score table of the finish screen owns Esc and Enter (ResultStage).
    if (ctx.stage === 'done' && ctx.finishDetailsOpenRef?.current) return;

    // #4255 (Design 126 sections 7.4 and 7.5): Esc aborts the flow; it never steps back.
    if (key.escape) {
      ctx.requestAbort();
      return;
    }

    // #4255 (Design 126 section 7.2): back one stage, values kept.
    const backKey = (key.tab && key.shift) || (key.leftArrow && !ctx.textInput);
    if (backKey) {
      const to = llmBackStage(ctx.stage, ctx.healthStatus);
      if (to === null) return;
      if (ctx.stage === 'pick-model' || ctx.stage === 'pick-model-custom' || ctx.stage === 'health-check') {
        ctx.setBuildError('');
        if (to === 'build-legs') ctx.setNextLeg(null);
      }
      if (ctx.stage === 'review-config' || ctx.stage === 'save-default') {
        // #4198: back from the save-as-default question writes nothing; the
        // providers of the review return to the list.
        const restored: PendingLeg[] = ctx.resolvedLegs.map((rl) => {
          const loaded = ctx.loadedConnectors.find((c) => c.file.connector.id === rl.connector);
          if (!loaded) return null;
          return { connectorId: rl.connector, connector: loaded, model: rl.model };
        }).filter((l): l is PendingLeg => l !== null);
        ctx.setPendingLegs(restored);
        ctx.setResolvedLegs([]);
      }
      ctx.setStage(to);
      return;
    }

    // #4255: Tab switches the vision crawl on the review (KeyHints name no letter keys).
    if (key.tab && ctx.stage === 'review-config' && ctx.crawlAvailable) {
      ctx.setIncludeCrawl(prev => !prev);
      return;
    }

    // #4256 (Design 126 section 4.7): on the finish and error screens the What next
    // and What now menus (FinishPanel, ErrorPanel) own Enter.
    if (key.return) {
      if (ctx.stage === 'health-check' && ctx.healthStatus !== 'running') {
        ctx.handleHealthCheckConfirm();
      }
    }
  });
}
