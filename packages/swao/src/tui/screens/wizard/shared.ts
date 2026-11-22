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

// Shared constants, types, and mutable state for the SetupWizard step system.
// All step components import from here to avoid circular dependencies.

// #2576-family / #4241: the steps spawn the running binary through the central
// self-spawn helper selfSpawnCommand in @swao/core (BIN, SELF_ARGS and SELF
// were removed from here).

// #1400 sprint-113: `gw:<connector-id>` selects a SWAO LLM-Gateway connector
// (Design 090); the literal values remain for the legacy fallback path.
export type LlmProvider = 'anthropic' | 'openai' | 'ollama' | 'open-llm-provider' | 'skip' | `gw:${string}`;

export interface SetupState {
  workDir: string;
  engagementName: string;
  clientCode: string;
  partnershipLead: string;
  llmProvider: LlmProvider;
  llmModel: string;
  ollamaEndpoint: string;
  openLlmBaseUrl: string;
  // #2355: secondary LLM provider (set when llm-secondary step completes)
  llmSecondaryProvider?: LlmProvider;
  llmSecondaryModel?: string;
  // #2815: vision screen count (set when Playwright step completes with Playwright installed)
  visionMaxScreens?: number;
  // #3403: assessment.test_code.mode chosen in the test-code step (undefined = kept as is)
  testCodeMode?: 'include' | 'tag' | 'exclude';
  /**
   * #4392 (TUI/CLI parity with swao init): the saved default workspace before
   * the init step replaced it, set only when the step changed it ('' = none
   * was saved). The Ready step names it.
   */
  previousDefaultWorkspace?: string;
  // #3306: LZ catalogue targets written by the LZ targets step ([] = skipped)
  /** #3378: removed from the setup wizard (LZ targets are chosen per assessment). */
}

// #4394: the guidance box open state has one owner, the tui-kit guidance
// module (useGuidanceOpen / GuidanceOpenContext, provided by SetupWizard).
