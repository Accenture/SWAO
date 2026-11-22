// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, model labels on screen (#4220)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4220 (Design 126 section 5.3): a model picker row names the model in
// words; the technical parts (price, current or default mark) go to the dim
// detail column, and the raw id, the alias rule and the context window to the
// guidance box of the highlighted row. A latest alias (`~vendor/family-latest`,
// alias-resolver.ts in module-llm-providers) reads "DeepSeek Pro (latest)" on
// screen; the raw id stays in .swao.yml.

import type { GuidanceEntry, SelectOption } from '@swao/tui-kit';

/** Vendor and family words with their usual spelling. */
const WORD_SPELLING: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek', openai: 'OpenAI', gpt: 'GPT', anthropic: 'Anthropic', claude: 'Claude',
  llama: 'Llama', mistral: 'Mistral', mistralai: 'Mistral AI', gemini: 'Gemini', google: 'Google',
  qwen: 'Qwen', meta: 'Meta', 'meta-llama': 'Meta Llama', ai: 'AI', vl: 'VL', moe: 'MoE',
};

/** True for a SWAO latest alias (`~vendor/family-latest`). */
export function isLatestAlias(id: string): boolean {
  return id.startsWith('~');
}

function spell(word: string): string {
  const known = WORD_SPELLING[word.toLowerCase()];
  if (known) return known;
  if (/^\d/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The model as the operator reads it. `~deepseek/deepseek-pro-latest` reads
 * "DeepSeek Pro (latest)"; a concrete id (`anthropic/claude-sonnet-4`) stays as
 * it is, because it is what the platform and .swao.yml use.
 */
export function modelLabel(id: string): string {
  if (!isLatestAlias(id)) return id;
  const bare = id.slice(1);
  const slash = bare.indexOf('/');
  const family = slash >= 0 ? bare.slice(slash + 1) : bare;
  const at = family.indexOf('-latest');
  const base = at >= 0 ? family.slice(0, at) : family;
  const words = base.split('-').filter((w) => w !== '').map(spell);
  return words.length > 0 ? `${words.join(' ')} (latest)` : id;
}

/** One catalogue entry as the picker needs it (connector-schema ModelEntrySchema). */
export interface ModelEntryLike {
  id: string;
  context_window?: number;
  cost?: { input_per_million: number; output_per_million: number };
  notes?: string;
}

/** Discovered per-million prices carry float noise; trim for display, the file keeps full precision. */
function fmtCost(v: number): string {
  return String(+v.toFixed(4));
}

/** The guidance entry of one model row: the raw id, the alias rule, price and context window. */
export function modelGuidanceEntry(m: ModelEntryLike, connectorName: string): GuidanceEntry {
  const sections = [
    { label: 'Model id', text: m.id },
    ...(isLatestAlias(m.id)
      ? [{ label: 'Latest', text: 'An alias: at run time SWAO uses the newest model of this family the platform lists; .swao.yml keeps the alias.' }]
      : []),
    ...(m.cost ? [{ label: 'Price', text: `$${fmtCost(m.cost.input_per_million)} per million input tokens, $${fmtCost(m.cost.output_per_million)} per million output tokens` }] : []),
    ...(m.context_window ? [{ label: 'Context', text: `${m.context_window} tokens` }] : []),
    ...(m.notes ? [{ label: 'Notes', text: m.notes }] : []),
  ];
  return { title: modelLabel(m.id), what: `A model of ${connectorName}. Enter uses it for this connector; the id is written to .swao.yml.`, sections };
}

/**
 * A model picker row: the model in words as the label, the price and the
 * current or default mark in the dim detail column, the rest in the guidance.
 */
export function modelOption(m: ModelEntryLike, connectorName: string, mark?: 'current' | 'default'): SelectOption {
  const price = m.cost ? `$${fmtCost(m.cost.input_per_million)}/M in, $${fmtCost(m.cost.output_per_million)}/M out` : '';
  const detail = [mark ?? '', price].filter((p) => p !== '').join(', ');
  return { label: modelLabel(m.id), value: m.id, ...(detail !== '' ? { detail } : {}), guidance: modelGuidanceEntry(m, connectorName) };
}

/** The "Other model" row of a model picker: the explanation in the detail column. */
export const OTHER_MODEL_OPTION: SelectOption = {
  label: 'Other model',
  value: '__custom__',
  detail: 'type any model id the platform serves',
  guidance: { title: 'Other model', what: 'Type any model id the platform serves, for example a vendor-prefixed id on an aggregator (mistralai/mistral-large).' },
};
