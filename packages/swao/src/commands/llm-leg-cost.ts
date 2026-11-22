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

// #4372: cost source and price preflight of an LLM Assessment candidate,
// shared by the CLI (assess --type llm) and the TUI (LLM Assessment screen)
// so both hosts decide the same way.

import { connectorModelHasPrice, getConnector, isOpenRouterConnector } from '@swao/module-llm-providers';
import { unpricedMessage } from '@swao/module-llm-assessment';

type ConnectorLoader = typeof getConnector;

/** Cost source of a leg before the run: local connectors have no platform billing. */
export function legCostSource(connector: string): 'local' | 'billed' {
  return connector === 'ollama' ? 'local' : 'billed';
}

/**
 * #4372: warning for a candidate whose connector carries no price for the
 * model (undefined when priced, local or the connector cannot be loaded).
 * OpenRouter reports the billed cost per call, so its warning says the cost
 * is measured only when the response carries it.
 */
export function legPriceWarning(
  leg: { connector: string; model: string },
  workspaceRoot: string,
  load: ConnectorLoader = getConnector,
): string | undefined {
  if (legCostSource(leg.connector) === 'local') return undefined;
  let loaded: ReturnType<ConnectorLoader>;
  try { loaded = load(leg.connector, { workspaceRoot, seedIfEmpty: true }); } catch { return undefined; }
  if (!loaded) return undefined;
  const connector = loaded.file.connector;
  if (connectorModelHasPrice(connector, leg.model)) return undefined;
  const base = unpricedMessage(leg);
  return isOpenRouterConnector(connector.id, connector.base_url)
    ? `${base}; the cost is taken from the OpenRouter billed usage of each call and is not measured when a response carries none`
    : `${base}; the cost dimension is not measured for this candidate`;
}
