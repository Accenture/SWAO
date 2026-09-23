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

// Process-path constants used by CredentialsStep and HealthCheckStep to spawn
// child processes via the same binary that is currently running.
export const BIN  = process.execPath;
// #2576-family: inside a pkg binary process.argv[1] is the snapshot bundle path;
// Commander.js rejects it as an unknown command. Use SELF_ARGS = [] in pkg, or
// the real entry script path in dev. Individual step files import SELF_ARGS.
const _wizIsPkg = Boolean((process as { pkg?: unknown }).pkg);
export const SELF_ARGS: string[] = _wizIsPkg ? [] : [process.argv[1] as string];
// Kept for backward compat with CredentialsStep which guards inline.
export const SELF = process.argv[1] as string;

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
}

// #0760: module-level flag tracks whether any GuidanceBox in the wizard is
// currently expanded. The root useInput guard reads it to prevent Escape from
// navigating away when the user intends to close the guidance panel.
// One SetupWizard renders at a time so a module-level flag is safe here.
export let _wizardGuidanceOpen = false;
export const setWizardGuidanceOpen = (open: boolean): void => { _wizardGuidanceOpen = open; };
