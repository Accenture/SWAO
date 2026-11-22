// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { currentLlmCallContext, llmCallContextFields, recordLlmCallUsage, roundCostUsd, withLlmCallContext } from './llm-call-context.js';

describe('LLM call context (#4270)', () => {
  it('outside every context: no fields, recording is a no-op', () => {
    expect(currentLlmCallContext()).toBeUndefined();
    expect(llmCallContextFields()).toEqual({});
    expect(() => recordLlmCallUsage(0.1)).not.toThrow();
  });

  it('nested contexts inherit the app id and add usage to every enclosing context', async () => {
    const outer = await withLlmCallContext({ caller: 'batch' }, async (b) => {
      await withLlmCallContext({ caller: 'app', appId: 'a1' }, async (a) => {
        await withLlmCallContext({ caller: 'topic' }, async () => {
          expect(llmCallContextFields()).toEqual({ caller: 'topic', app_id: 'a1' });
          recordLlmCallUsage(0.25);
          recordLlmCallUsage('not a number');
        });
        expect(a.llmCalls).toBe(2);
        expect(a.costUsd).toBeCloseTo(0.25, 10);
      });
      return b;
    });
    expect(outer.llmCalls).toBe(2);
    expect(outer.costUsd).toBeCloseTo(0.25, 10);
  });

  it('concurrent contexts never see each other', async () => {
    const seen = await Promise.all(['x', 'y'].map((id) => withLlmCallContext({ caller: `c.${id}`, appId: id }, async () => {
      await new Promise((r) => setTimeout(r, id === 'x' ? 10 : 0));
      return llmCallContextFields();
    })));
    expect(seen).toEqual([{ caller: 'c.x', app_id: 'x' }, { caller: 'c.y', app_id: 'y' }]);
  });

  it('rounds cost to six decimals', () => {
    expect(roundCostUsd(0.1 + 0.2)).toBe(0.3);
  });
});
