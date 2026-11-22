// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- live model discovery when a model picker opens (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4475 (Design 090 section 7.4): a model picker reads the served models of its
// connector when it opens (5 s timeout), merges them into the workspace
// connector file (refreshConnectorModels) and lists them. One result per
// connector is kept for a few minutes, so a second LLM Provider on the same
// connector does not wait again. Offline or air-gapped: the catalogue, said so.

import { useEffect, useState } from 'react';
import { discoveryEnabled, refreshConnectorModels, type LoadedConnector, type ModelRefresh } from '@swao/module-llm-providers';

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; refresh: ModelRefresh }>();

/** Tests: forget the kept results. */
export function clearModelRefreshCache(): void {
  cache.clear();
}

export interface ModelRefreshState {
  status: 'running' | 'live' | 'catalogue' | 'off';
  refresh?: ModelRefresh;
}

function cacheKey(loaded: LoadedConnector, workspaceRoot: string | undefined): string {
  return `${workspaceRoot ?? ''}::${loaded.file.connector.id}`;
}

/**
 * Run the discovery of `loaded` once while `active`; `onRefreshed` receives the
 * connector with the merged catalogue (live only).
 */
export function useModelRefresh(
  loaded: LoadedConnector | undefined,
  workspaceRoot: string | undefined,
  active: boolean,
  onRefreshed?: (l: LoadedConnector) => void,
): ModelRefreshState {
  const key = loaded ? cacheKey(loaded, workspaceRoot) : '';
  const initial = (): ModelRefreshState => {
    if (!loaded) return { status: 'off' };
    if (!discoveryEnabled(loaded.file.connector)) return { status: 'off' };
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { status: hit.refresh.status, refresh: hit.refresh };
    return { status: 'running' };
  };
  const [state, setState] = useState<ModelRefreshState>(initial);

  useEffect(() => {
    setState(initial());
  }, [key]);

  useEffect(() => {
    if (!active || !loaded || state.status !== 'running') return;
    let cancelled = false;
    void refreshConnectorModels(loaded, { workspaceRoot })
      .then((refresh) => {
        // The workspace file is written by refreshConnectorModels even when the
        // picker has closed meanwhile; only the screen state is skipped.
        // Only a live list is kept: after a failure (key missing, offline) the
        // next opening asks again, for example once the key is stored in Setup.
        if (refresh.status === 'live') cache.set(key, { at: Date.now(), refresh });
        if (cancelled) return;
        setState({ status: refresh.status, refresh });
        if (refresh.status === 'live') onRefreshed?.(refresh.loaded);
      })
      .catch(() => { if (!cancelled) setState({ status: 'catalogue' }); });
    return () => { cancelled = true; };
  }, [active, key, state.status]);

  return state;
}
