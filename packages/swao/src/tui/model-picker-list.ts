// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- model picker list from the live served models (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4475 (Design 090 section 7.4): one list rule for every model picker (LLM
// Assessment, Setup LLM step) and `swao llm models`:
//   1. the curated catalogue entries the platform serves (or that were not
//      checked), in the order of the connector file;
//   2. the current model (.swao.yml) when it is not in the catalogue;
//   3. the other served models from discovery, sorted by id;
//   4. curated entries the platform does not serve: `notServed` (the CLI
//      prints them last, marked "not served").
// #4475 owner decision 2026-11-16: a picker never offers a not served model.
// It shows one only when it is the stored current model (`notServedCurrent`),
// as a line outside the option list ("not served, your current model"), so it
// can never be selected and no filter puts the cursor on it. The cursor starts
// on the current model, else the default, else the first entry.

import { bundledModelPrice, isChatServableId, isModelServed, servedAlternatives, type Connector } from '@swao/module-llm-providers';
import type { SelectOption } from '@swao/tui-kit';
import { modelOption, type ModelEntryLike } from './model-label.js';

export interface PickerModelEntry extends ModelEntryLike {
  discovered?: boolean;
  served?: boolean;
}

export interface PickerConnectorLike {
  name: string;
  /** #4491: with an id, a model without a price takes the packaged catalogue price. */
  id?: string;
  /** #4500: with a protocol, discovered ids its chat route cannot serve (OpenRouter :batch) are hidden. */
  protocol?: Connector['protocol'];
  models: { default: string; catalogue?: PickerModelEntry[]; discovered_at?: string };
}

export interface PickerModel {
  entry: PickerModelEntry;
  /** true served, false not served, undefined not checked. */
  served: boolean | undefined;
  mark?: 'current' | 'default';
  /** #4491: the price comes from the packaged connector file, not the workspace file. */
  priceSource?: 'bundled';
}

export interface PickerModelList {
  models: PickerModel[];
  /** Index into `models` of the entry the cursor starts on; -1 when no entry may be preselected. */
  initial: number;
  /** #4475: the models the platform does not serve (never options of a picker; the CLI lists them). */
  notServed: PickerModel[];
  /** #4475: the stored current model when the platform does not serve it (a picker shows notServedLine). */
  notServedCurrent?: PickerModel;
}

/**
 * The ordered picker models of a connector. `servedIds` is the live list of
 * this picker opening (undefined when discovery failed or is off); without it
 * the `served` marks of the last discovery in the connector file apply.
 */
export function pickerModelList(conn: PickerConnectorLike, opts: { current?: string; servedIds?: readonly string[] } = {}): PickerModelList {
  const catalogue = conn.models.catalogue ?? [];
  const live = opts.servedIds !== undefined;
  const servedOf = (e: PickerModelEntry): boolean | undefined => {
    if (live) return isModelServed(e.id, opts.servedIds!);
    return e.served === false ? false : e.served;
  };
  const mark = (id: string): PickerModel['mark'] =>
    id === opts.current ? 'current' : id === conn.models.default ? 'default' : undefined;

  const curated = catalogue.filter((e) => !e.discovered);
  // #4500: a connector file written before the batch rule may still hold
  // batch-only ids from an earlier discovery; they are never offered.
  const discovered = catalogue.filter((e) => e.discovered && (!conn.protocol || isChatServableId(conn.protocol, e.id)));
  const servedCurated: PickerModel[] = [];
  const unserved: PickerModel[] = [];
  for (const e of curated) {
    const served = servedOf(e);
    (served === false ? unserved : servedCurated).push({ entry: e, served, ...(mark(e.id) ? { mark: mark(e.id) } : {}) });
  }
  const listed = new Set(catalogue.map((e) => e.id));
  const currentRow: PickerModel[] = [];
  if (opts.current && !listed.has(opts.current) && !opts.current.startsWith('__')) {
    const served = live ? isModelServed(opts.current, opts.servedIds!) : undefined;
    const row: PickerModel = { entry: { id: opts.current }, served, mark: 'current' };
    (served === false ? unserved : currentRow).push(row);
  }
  const rest: PickerModel[] = discovered
    .map((e) => ({ entry: e, served: live ? isModelServed(e.id, opts.servedIds!) : (e.served === false ? false : true) }))
    .filter((m) => m.served !== false)
    .map((m) => ({ ...m, ...(mark(m.entry.id) ? { mark: mark(m.entry.id) } : {}) }))
    .sort((a, b) => a.entry.id.localeCompare(b.entry.id));

  // #4491: a model without a price in the workspace file takes the price of the
  // packaged connector file when that lists it (labelled bundled price).
  const models = [...servedCurated, ...currentRow, ...rest].map((m) => withBundledPrice(m, conn.id));
  let initial = models.findIndex((m) => m.entry.id === opts.current);
  if (initial < 0) initial = models.findIndex((m) => m.entry.id === conn.models.default);
  if (initial < 0) initial = models.length > 0 ? 0 : -1;
  const notServedCurrent = opts.current ? unserved.find((m) => m.entry.id === opts.current) : undefined;
  return { models, initial, notServed: unserved, ...(notServedCurrent ? { notServedCurrent } : {}) };
}

/** #4491: fill a missing price from the packaged catalogue of the connector. */
export function withBundledPrice(m: PickerModel, connectorId: string | undefined): PickerModel {
  if (m.entry.cost || !connectorId) return m;
  const cost = bundledModelPrice(connectorId, m.entry.id);
  return cost ? { ...m, entry: { ...m.entry, cost }, priceSource: 'bundled' } : m;
}

/** #4475: the line a picker shows for a stored current model the platform does not serve. */
export function notServedLine(m: PickerModel): string {
  return `${m.entry.id}: not served, your current model. Pick a served model below.`;
}

/** The SelectInput option of one picker model: the marks and the price in the dim detail column. */
export function pickerModelOption(m: PickerModel, connectorName: string): SelectOption {
  const base = modelOption(m.entry, connectorName, m.mark);
  const opt = m.priceSource === 'bundled' ? { ...base, detail: [base.detail ?? '', 'bundled price'].filter((p) => p !== '').join(', ') } : base;
  if (m.served !== false) return opt;
  const detail = ['not served', opt.detail ?? ''].filter((p) => p !== '').join(', ');
  return {
    ...opt,
    detail,
    guidance: {
      ...opt.guidance!,
      sections: [
        { label: 'Not served', text: 'The platform did not list this model when SWAO read its served models; a call would be rejected (HTTP 404). Pick a served model.' },
        ...(opt.guidance?.sections ?? []),
      ],
    },
  };
}

/** #4475: the line under the connector name: how the list was read. */
export function pickerSourceLine(status: 'running' | 'live' | 'catalogue' | 'off', count: number, fallback: string): string {
  switch (status) {
    case 'running': return 'Reading the served models from the platform (up to 5 seconds)...';
    case 'live': return `Served models read live from the platform: ${count} models.`;
    case 'catalogue':
    case 'off': return fallback;
    default: {
      const never: never = status;
      return String(never);
    }
  }
}

/**
 * #4475: the Connectivity check on HTTP 404 (model not found) names the closest
 * served ids of the same vendor, from the served models of the last discovery
 * in the connector file. Empty when the list was never read live.
 */
export function notServedSuggestion(model: string, conn: PickerConnectorLike): string {
  if (!conn.models.discovered_at) return '';
  const served = (conn.models.catalogue ?? []).filter((e) => e.served !== false).map((e) => e.id);
  const alt = servedAlternatives(model, served);
  return alt.length > 0 ? `Served models of the same vendor: ${alt.join(', ')}.` : '';
}
