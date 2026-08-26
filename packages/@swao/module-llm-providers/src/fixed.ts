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

import type { LlmProvider } from './types.js';

export class FixedLlmProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'fixed-response';

  constructor(private readonly response: string) {}

  async complete(_prompt: string): Promise<string> {
    return this.response;
  }

  async completeVision(_prompt: string, _images: Buffer[]): Promise<string> {
    return this.response;
  }
}
