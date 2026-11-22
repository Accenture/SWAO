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

// #4198 SET-10 (Design 125 sections 5.7, 11): the LLM Assessment preselects
// the subject app and the candidates the LLM setup stored.

import { describe, it, expect } from 'vitest';
import type { LoadedConnector } from '@swao/module-llm-providers';
import { orderAppsWithDefault, defaultPendingLegs } from './preselect.js';
import { useLlmHandlers } from './hooks/useLlmHandlers.js';

const conn = (id: string, def: string): LoadedConnector => ({ file: { connector: { id, name: id, models: { default: def } } } } as unknown as LoadedConnector);

describe('LLM Assessment preselection (#4198)', () => {
  it('lists the stored subject app first; an unknown subject keeps the order', () => {
    const apps = [{ id: 'api', passCount: 3 }, { id: 'web', passCount: 5 }];
    expect(orderAppsWithDefault(apps, 'web').map((a) => a.id)).toEqual(['web', 'api']);
    expect(orderAppsWithDefault(apps, 'gone').map((a) => a.id)).toEqual(['api', 'web']);
    expect(orderAppsWithDefault(apps, undefined).map((a) => a.id)).toEqual(['api', 'web']);
  });

  it('maps the stored candidates to legs, with the connector default model and without unknown connectors', () => {
    const legs = defaultPendingLegs([{ connector: 'anthropic', model: 'm1' }, { connector: 'missing' }, { connector: 'ollama' }], [conn('anthropic', 'a-def'), conn('ollama', 'o-def')]);
    expect(legs.map((l) => `${l.connectorId}/${l.model}`)).toEqual(['anthropic/m1', 'ollama/o-def']);
    expect(defaultPendingLegs([{ connector: 'a' }, { connector: 'a' }, { connector: 'a' }], [conn('a', 'd')], 2)).toHaveLength(2);
  });

  it('choosing the app starts the leg builder with the preselected legs (not an empty list)', () => {
    let pending: unknown = 'unset';
    const noop = (): void => undefined;
    const h = useLlmHandlers({
      eligibleApps: [{ id: 'web', passCount: 1 }], loadedConnectors: [conn('a', 'd')], configuredCredKeys: new Set(), pendingLegs: [],
      crawlAvailable: false, resolvedLegs: [], workspacePath: '/ws', healthStatus: null, healthPermanent: false, nextLegRef: { current: null },
      defaultLegs: defaultPendingLegs([{ connector: 'a' }], [conn('a', 'd')]),
      setSelectedApp: noop, setCrawlAvailable: noop, setIncludeCrawl: noop,
      setPendingLegs: ((v: unknown) => { pending = v; }) as never,
      setNextLeg: noop, setBuildError: noop, setStage: noop, setResolvedLegs: noop, setErrorMsg: noop, setLlmCfg: noop,
      setHealthStatus: noop, setHealthMessage: noop, setHealthPermanent: noop,
    });
    h.handleAppSelect('web');
    expect((pending as Array<{ connectorId: string }>).map((l) => l.connectorId)).toEqual(['a']);
  });
});
