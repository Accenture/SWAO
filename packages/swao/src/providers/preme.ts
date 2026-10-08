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
// Token management -- credential store keys (aligned with connector yaml credential_key):
//   swao credential set preme-dev-api-key     <token>
//   swao credential set preme-preprod-api-key <token>
//   swao credential set preme-prod-api-key    <token>
//
// Token acquisition (#2955):
//   Manual:  https://services.con.dst.baintern.de/wtfdemo/adfs/ (click ADG Access Token)
//   CI/CD:   POST https://sts.arbeitsagentur.de/adfs/oauth2/token/
//            grant_type=client_credentials, client_id, client_secret, resource=<PREME_BASE_URL>

import { OpenLlmProvider } from '@swao/module-llm-providers';
import { CredentialStore } from '@swao/core';

/** Base URL by PreMe environment. */
export const PREME_ENVS = {
  dev:     'https://preme-genai-hub.preme-vfz2.con.idst.ibaintern.de',
  preprod: 'https://preme-genai-hub-preprod.preme-plus.con.dst.baintern.de',
  prod:    'https://preme-genai-hub.preme-plus.con.dst.baintern.de',
} as const;

/**
 * ADFS STS base URL by PreMe environment (#2955).
 * Token endpoint: PREME_STS[env] + '/oauth2/token/'
 */
export const PREME_STS = {
  dev:     'https://sts-i.arbeitsagentur.de/adfs',
  preprod: 'https://sts.arbeitsagentur.de/adfs',
  prod:    'https://sts.arbeitsagentur.de/adfs',
} as const;

/**
 * SWAO credential store key names -- aligned with preme-{env}.yaml auth.credential_key.
 * Use these instead of the old open-llm-api-key-{env} pattern.
 */
export const PREME_CREDENTIAL_KEYS = {
  dev:     'preme-dev-api-key',
  preprod: 'preme-preprod-api-key',
  prod:    'preme-prod-api-key',
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
 * @param apiKey  Bearer token. When undefined, resolves from SWAO_PREME_TOKEN
 *                env var then from the credential store key PREME_CREDENTIAL_KEYS[env]
 *                (e.g. 'preme-preprod-api-key' for preprod). (#2954)
 */
export function createPreMeProvider(
  env: PreMeEnv = 'prod',
  model?: string,
  apiKey?: string,
): OpenLlmProvider {
  // #2954: resolve via PREME-specific paths before falling through to OpenLlmProvider's
  // generic open-llm-api-key-{env} lookup, which would miss the preme-{env}-api-key entry.
  const resolvedKey = apiKey ?? resolvePreMeApiKey(env);
  return new OpenLlmProvider(
    resolvedKey,
    model ?? PREME_MODELS[env],
    PREME_ENVS[env],
    undefined,  // modelPrefix defaults to '/' + model (vLLM path-prefix routing)
    0,          // temperature 0 -- deterministic assessment output
  );
}

export function resolvePreMeApiKey(
  env: PreMeEnv,
  storeOverride?: Record<string, string>,
): string | undefined {
  const fromEnv = process.env['SWAO_PREME_TOKEN'];
  if (fromEnv) return fromEnv;
  try {
    const store = storeOverride ?? new CredentialStore().loadSync();
    const credKey = PREME_CREDENTIAL_KEYS[env];
    if (credKey in store && store[credKey]) return store[credKey];
  } catch {
    // credential store unavailable
  }
  return undefined;
}
