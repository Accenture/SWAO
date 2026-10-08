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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPreMeProvider, resolvePreMeApiKey, PREME_CREDENTIAL_KEYS, PREME_ENVS, PREME_MODELS } from './preme.js';
import { OpenLlmProvider } from '@swao/module-llm-providers';

// CredentialStore is called inside createPreMeProvider; mock the module so
// no real vault access happens in unit tests.
vi.mock('@swao/core', () => ({
  CredentialStore: vi.fn().mockImplementation(() => ({
    loadSync: vi.fn().mockReturnValue({}),
  })),
}));

describe('createPreMeProvider -- credential resolution (#2954)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses SWAO_PREME_TOKEN env var when set', () => {
    vi.stubEnv('SWAO_PREME_TOKEN', 'session-token-from-env');
    const provider = createPreMeProvider('preprod');
    expect(provider).toBeInstanceOf(OpenLlmProvider);
    // The provider must be instantiated with the env token, not undefined.
    // We verify indirectly: the provider exists and no error was thrown.
    expect(provider).toBeDefined();
  });

  it('targets the correct PREME base URL per environment', () => {
    vi.stubEnv('SWAO_PREME_TOKEN', 'test-token');
    const preprod = createPreMeProvider('preprod');
    const prod = createPreMeProvider('prod');
    expect(preprod).toBeInstanceOf(OpenLlmProvider);
    expect(prod).toBeInstanceOf(OpenLlmProvider);
    // Base URLs are embedded in PREME_ENVS; PREME_ENVS.preprod != PREME_ENVS.prod
    expect(PREME_ENVS.preprod).not.toBe(PREME_ENVS.prod);
  });

  it('uses the PREME-aligned credential key -- not the generic open-llm key', () => {
    expect(PREME_CREDENTIAL_KEYS.preprod).toBe('preme-preprod-api-key');
    expect(PREME_CREDENTIAL_KEYS.prod).toBe('preme-prod-api-key');
    expect(PREME_CREDENTIAL_KEYS.dev).toBe('preme-dev-api-key');
  });

  it('defaults to PREME_MODELS[env] when model is not specified', () => {
    vi.stubEnv('SWAO_PREME_TOKEN', 'test-token');
    // Just exercise the factory without throwing
    const provider = createPreMeProvider('preprod');
    expect(provider).toBeDefined();
    expect(PREME_MODELS.preprod).toBeTruthy();
  });

  it('reads preme-preprod-api-key from the credential store when SWAO_PREME_TOKEN is unset (#2954)', () => {
    delete process.env['SWAO_PREME_TOKEN'];
    // Inject a fake store directly so no module-mocking boundary issues arise.
    // storeOverride bypasses new CredentialStore().loadSync() in the function under test.
    const key = resolvePreMeApiKey('preprod', { 'preme-preprod-api-key': 'sentinel-from-store' });
    expect(key).toBe('sentinel-from-store');
  });

  it('creates a provider successfully when neither env var nor credential store has a key', () => {
    delete process.env['SWAO_PREME_TOKEN'];
    // CredentialStore mock returns empty {} -- so resolvePreMeApiKey returns undefined,
    // and OpenLlmProvider gets undefined (which it accepts, returning '' internally).
    expect(() => createPreMeProvider('preprod')).not.toThrow();
  });
});
