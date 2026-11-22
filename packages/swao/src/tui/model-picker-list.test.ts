// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- model picker list rule tests (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { notServedLine, notServedSuggestion, pickerModelList, pickerModelOption, type PickerConnectorLike } from './model-picker-list.js';

// The owner's case (#4475): the stale OpenRouter seed with the current model
// anthropic/claude-sonnet-4, which OpenRouter no longer serves.
const STALE: PickerConnectorLike = {
  name: 'OpenRouter',
  models: {
    default: 'mistralai/mistral-large',
    catalogue: [{ id: 'mistralai/mistral-large' }, { id: 'anthropic/claude-sonnet-4' }, { id: 'meta-llama/llama-3.3-70b-instruct' }],
  },
};
const SERVED = ['mistralai/mistral-large', 'meta-llama/llama-3.3-70b-instruct', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5'];

describe('pickerModelList (#4475)', () => {
  it('live: served catalogue first, then the other served models; the unserved current model is no option, only notServedCurrent', () => {
    const merged: PickerConnectorLike = {
      ...STALE,
      models: { ...STALE.models, catalogue: [...STALE.models.catalogue!, { id: 'anthropic/claude-sonnet-5.5', discovered: true }, { id: 'anthropic/claude-haiku-5.5', discovered: true }] },
    };
    const list = pickerModelList(merged, { current: 'anthropic/claude-sonnet-4', servedIds: SERVED });
    // #4475 owner decision 2026-11-16: never an option, so neither the cursor nor a filter can reach it.
    expect(list.models.map((m) => m.entry.id)).toEqual([
      'mistralai/mistral-large', 'meta-llama/llama-3.3-70b-instruct',
      'anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5',
    ]);
    expect(list.models.every((m) => m.served !== false)).toBe(true);
    const last = list.notServedCurrent!;
    expect(last.entry.id).toBe('anthropic/claude-sonnet-4');
    expect(last.served).toBe(false);
    expect(last.mark).toBe('current');
    expect(notServedLine(last)).toBe('anthropic/claude-sonnet-4: not served, your current model. Pick a served model below.');
    // The current model is not served: the cursor starts on the default instead.
    expect(list.models[list.initial]!.entry.id).toBe('mistralai/mistral-large');
    // The CLI still lists it (notServed).
    expect(list.notServed.map((m) => m.entry.id)).toEqual(['anthropic/claude-sonnet-4']);
    const opt = pickerModelOption(last, 'OpenRouter');
    expect(opt.detail).toContain('not served');
    expect(opt.guidance?.sections?.[0]?.label).toBe('Not served');
  });

  it('a current model outside the catalogue is listed and preselected when served', () => {
    const list = pickerModelList(STALE, { current: 'anthropic/claude-haiku-5.5', servedIds: SERVED });
    expect(list.models[list.initial]!.entry.id).toBe('anthropic/claude-haiku-5.5');
  });

  it('offline: the catalogue in file order, unchecked; the marks of the last discovery in the file still apply', () => {
    const fromFile: PickerConnectorLike = {
      ...STALE,
      models: { ...STALE.models, discovered_at: '2026-11-16T07:00:00Z', catalogue: STALE.models.catalogue!.map((e) => (e.id === 'anthropic/claude-sonnet-4' ? { ...e, served: false } : e)) },
    };
    const off = pickerModelList(STALE, { current: 'anthropic/claude-sonnet-4' });
    expect(off.models.every((m) => m.served === undefined)).toBe(true);
    expect(off.models[off.initial]!.entry.id).toBe('anthropic/claude-sonnet-4');
    const marked = pickerModelList(fromFile, { current: 'anthropic/claude-sonnet-4' });
    expect(marked.models.map((m) => m.entry.id)).not.toContain('anthropic/claude-sonnet-4');
    expect(marked.notServedCurrent?.entry.id).toBe('anthropic/claude-sonnet-4');
    expect(marked.models[marked.initial]!.entry.id).toBe('mistralai/mistral-large');
  });

  it('a not served catalogue model that is not the current model is not shown by a picker at all', () => {
    const list = pickerModelList(STALE, { current: 'mistralai/mistral-large', servedIds: SERVED });
    expect(list.models.map((m) => m.entry.id)).not.toContain('anthropic/claude-sonnet-4');
    expect(list.notServedCurrent).toBeUndefined();
  });

  it('#4500: discovered batch-only ids of an older connector file are never offered (openai-chat)', () => {
    const old: PickerConnectorLike = {
      ...STALE,
      protocol: 'openai-chat',
      models: { ...STALE.models, catalogue: [...STALE.models.catalogue!, { id: 'anthropic/claude-sonnet-5.5', discovered: true }, { id: 'anthropic/claude-sonnet-5.5:batch', discovered: true }] },
    };
    const ids = pickerModelList(old).models.map((m) => m.entry.id);
    expect(ids).toContain('anthropic/claude-sonnet-5.5');
    expect(ids).not.toContain('anthropic/claude-sonnet-5.5:batch');
  });

  it('no model at all may be preselected when nothing is served: initial -1', () => {
    const list = pickerModelList(STALE, { servedIds: ['other/model'] });
    expect(list.initial).toBe(-1);
  });
});

describe('notServedSuggestion (#4475)', () => {
  it('names served ids of the same vendor after a live discovery, nothing before one', () => {
    const merged: PickerConnectorLike = {
      ...STALE,
      models: {
        ...STALE.models,
        discovered_at: '2026-11-16T07:00:00Z',
        catalogue: [
          { id: 'anthropic/claude-sonnet-4', served: false },
          { id: 'anthropic/claude-sonnet-5.5', discovered: true },
          { id: 'mistralai/mistral-large' },
        ],
      },
    };
    expect(notServedSuggestion('anthropic/claude-sonnet-4', merged)).toBe('Served models of the same vendor: anthropic/claude-sonnet-5.5.');
    expect(notServedSuggestion('anthropic/claude-sonnet-4', STALE)).toBe('');
  });
});

describe('bundled price fallback (#4491)', () => {
  it('a served model without a price in the workspace file takes the packaged price, labelled bundled price', () => {
    const oldSeed: PickerConnectorLike = {
      id: 'anthropic',
      name: 'Anthropic Claude',
      models: { default: 'claude-haiku-4-5-20251001', catalogue: [{ id: 'claude-haiku-4-5-20251001', cost: { input_per_million: 1, output_per_million: 5 } }, { id: 'claude-haiku-5-5', discovered: true }] },
    };
    const list = pickerModelList(oldSeed);
    const haiku55 = list.models.find((m) => m.entry.id === 'claude-haiku-5-5')!;
    expect(haiku55.entry.cost).toEqual({ input_per_million: 0.1, output_per_million: 0.5 });
    expect(haiku55.priceSource).toBe('bundled');
    expect(pickerModelOption(haiku55, 'Anthropic Claude').detail).toContain('bundled price');
    // A workspace price wins and is not labelled.
    const own = list.models.find((m) => m.entry.id === 'claude-haiku-4-5-20251001')!;
    expect(own.priceSource).toBeUndefined();
  });
});
