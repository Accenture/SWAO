// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Per-call usage accessors (#3301, Design 110 E-05).
//
// Every driver and wrapper in this module implements the `*Detailed()`
// methods, whose result carries the call's own usage. These helpers prefer
// them and fall back to the deprecated shared `getLastUsage()` state only
// for third-party providers or fixtures that do not implement them.

import type { LlmCompletion, LlmProvider, LlmToolChatParams } from './types.js';

type TextProvider = Pick<LlmProvider, 'complete' | 'completeDetailed' | 'getLastUsage' | 'getLastTrace'>;

/** Fallback trace: the provider's last trace, only when it belongs to this call. */
function ownTrace(p: Pick<LlmProvider, 'getLastTrace'>, text: string): LlmCompletion['trace'] {
  const t = p.getLastTrace?.();
  return t && t.response === text ? t : undefined;
}

/** `complete()` with the call's own usage. */
export async function completeWithUsage(p: TextProvider, prompt: string): Promise<LlmCompletion> {
  if (p.completeDetailed) return p.completeDetailed(prompt);
  const text = await p.complete(prompt);
  return { text, usage: p.getLastUsage?.(), trace: ownTrace(p, text) };
}

/** `completeVision()` with the call's own usage. The provider must support vision. */
export async function completeVisionWithUsage(
  p: Pick<LlmProvider, 'completeVision' | 'completeVisionDetailed' | 'getLastUsage' | 'getLastTrace'>,
  prompt: string,
  images: Buffer[],
): Promise<LlmCompletion> {
  if (p.completeVisionDetailed) return p.completeVisionDetailed(prompt, images);
  if (!p.completeVision) throw new Error('LLM provider does not support vision');
  const text = await p.completeVision(prompt, images);
  return { text, usage: p.getLastUsage?.(), trace: ownTrace(p, text) };
}

/** `completeWithTools()` with the usage of the whole tool loop. The provider must support tools. */
export async function completeWithToolsWithUsage(
  p: Pick<LlmProvider, 'completeWithTools' | 'completeWithToolsDetailed' | 'getLastUsage' | 'getLastTrace'>,
  params: LlmToolChatParams,
): Promise<LlmCompletion> {
  if (p.completeWithToolsDetailed) return p.completeWithToolsDetailed(params);
  if (!p.completeWithTools) throw new Error('LLM provider does not support tool calling');
  const text = await p.completeWithTools(params);
  return { text, usage: p.getLastUsage?.(), trace: ownTrace(p, text) };
}
