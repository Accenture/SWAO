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

// PreMe-GenAI-Hub environment presets (Design 082 §6.2).
//
// This file provides named constants for the PreMe platform and a thin
// factory that wires them into OpenLlmProvider.
//
// IMPORTANT: This file is NOT exported from @swao/module-llm-providers.
//   - It lives only in the CLI layer (swao/packages/swao/src/providers/).
//   - It is not part of Community Edition's public API.
//   - No bearer tokens are committed here; tokens live in the credential store.
//
// Token management:
//   swao credential set open-llm-api-key-dev     <token>
//   swao credential set open-llm-api-key-preprod <token>
//   swao credential set open-llm-api-key-prod    <token>

import { OpenLlmProvider } from '@swao/module-llm-providers';

/** Base URL by PreMe environment. */
export const PREME_ENVS = {
  dev:     'https://preme-genai-hub.preme-vfz2.con.idst.ibaintern.de',
  preprod: 'https://preme-genai-hub-preprod.preme-plus.con.dst.baintern.de',
  prod:    'https://preme-genai-hub.preme-plus.con.dst.baintern.de',
} as const;

/** Known env name. */
export type PreMeEnv = keyof typeof PREME_ENVS;

/** Default models per environment (sprint-106 snapshot). */
export const PREME_MODELS = {
  dev:     'Mistral-Small-24B-Instruct-2506',
  preprod: 'Llama-3.3-70B-Instruct-FP8-Dynamic',
  prod:    'Mistral-Small-24B-Instruct-2501',
} as const;

/**
 * Build an OpenLlmProvider pre-configured for the PreMe-GenAI-Hub platform.
 *
 * @param env     Environment to target (default: 'prod').
 * @param model   Override model name (defaults to PREME_MODELS[env]).
 * @param apiKey  Bearer token.  Falls through to OpenLlmProvider credential
 *                resolution (open-llm-api-key-{env} from credential store)
 *                when undefined.
 */
export function createPreMeProvider(
  env: PreMeEnv = 'prod',
  model?: string,
  apiKey?: string,
): OpenLlmProvider {
  return new OpenLlmProvider(
    apiKey,
    model ?? PREME_MODELS[env],
    PREME_ENVS[env],
    undefined,  // modelPrefix defaults to '/' + model (vLLM path-prefix routing)
    0,          // temperature 0 -- deterministic assessment output
  );
}
