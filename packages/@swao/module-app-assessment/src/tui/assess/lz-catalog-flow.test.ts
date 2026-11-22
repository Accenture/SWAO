// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module, tests of the LZ Catalog and Application step flows
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (TUI-11, Design 126 sections 4.5, 7.2, 7.4 and 7.10).

import { describe, it, expect } from 'vitest';
import {
  CRED_API_PREFIX, CRED_CONTINUE, CRED_LLM, CRED_VCS_TOKEN, CRED_VCS_URL,
  LZ_CATALOG_PHASE_STEP, LZ_CATALOG_PRE_RUN, LZ_CATALOG_STEPS, apiTokenOptions, lzCatalogBackPhase, lzCredentialOptions,
} from './lz-catalog-flow.js';
import { APP_CRED_PW_MFA, APP_PHASE_STEP, APP_STEPS, APP_TEXT_PHASES, appBackPhase, appCredentialOptions, isAppPreRunPhase } from './app-flow.js';

const connectors = [
  { id: 'gw', name: 'Gateway', credentialKey: 'provider:gw:token' },
  { id: 'env', name: 'Env connector', envVar: 'ENV_KEY' },
];

describe('LZ Catalog flow (#4255)', () => {
  it('maps every phase to a step of the bar; names without numbers', () => {
    for (const step of Object.values(LZ_CATALOG_PHASE_STEP)) expect(step).toBeLessThan(LZ_CATALOG_STEPS.length);
    expect(LZ_CATALOG_STEPS.every((l) => !/\d/.test(l))).toBe(true);
    expect(LZ_CATALOG_PHASE_STEP['input-lz-region']).toBe(LZ_CATALOG_STEPS.indexOf('Regions'));
  });

  it('back keeps to the previous step; the credential sub-steps return to the list; nothing before the app picker', () => {
    expect(lzCatalogBackPhase('input-app-credentials')).toBe('input-app');
    expect(lzCatalogBackPhase('input-app-cred-api-token')).toBe('input-app-credentials');
    expect(lzCatalogBackPhase('input-lz-frameworks')).toBe('input-lz-provider');
    expect(lzCatalogBackPhase('input-lz-gap')).toBe('input-lz-region');
    expect(lzCatalogBackPhase('input-app')).toBeNull();
    expect(lzCatalogBackPhase('running')).toBeNull();
    for (const p of LZ_CATALOG_PRE_RUN) expect(lzCatalogBackPhase(p)).not.toBeNull();
    expect(LZ_CATALOG_PRE_RUN.has('running')).toBe(false);
  });

  it('the credential list starts on Continue and replaces the letter keys; every entry has guidance', () => {
    const options = lzCredentialOptions({ app: 'a', editOnly: false, stored: (k) => k === 'vcs-url-a', connectors });
    expect(options.map((o) => o.value)).toEqual([CRED_CONTINUE, CRED_VCS_URL, CRED_VCS_TOKEN, CRED_LLM, `${CRED_API_PREFIX}gw`, `${CRED_API_PREFIX}env`]);
    expect(options[1]?.detail).toBe('stored');
    expect(options[2]?.detail).toBe('not stored');
    expect(options.every((o) => o.guidance !== undefined)).toBe(true);
    expect(options.map((o) => o.label).join(' ')).not.toMatch(/ -- |\|/);
    expect(lzCredentialOptions({ app: 'a', editOnly: true, stored: () => false, connectors: [] })[0]?.label).toBe('Save and back to the apps');
  });

  it('API token entries name the stored state or the environment variable', () => {
    const [gw, env] = apiTokenOptions(connectors, (k) => k === 'provider:gw:token');
    expect(gw?.detail).toBe('stored');
    expect(env?.detail).toBe('environment variable');
    expect(env?.guidance?.what).toContain('ENV_KEY');
  });
});

describe('Application flow (#4255)', () => {
  it('maps every phase to a step of the bar', () => {
    for (const step of Object.values(APP_PHASE_STEP)) expect(step).toBeLessThan(APP_STEPS.length);
    expect(APP_PHASE_STEP['input-app-lz-gap']).toBe(APP_STEPS.indexOf('Target LZ'));
  });

  it('back replaces the per-phase Esc targets (A-27)', () => {
    const ctx = { hasLenses: true, reuseFromHub: false };
    expect(appBackPhase('input-regimes', ctx)).toBe('input-lenses');
    expect(appBackPhase('input-regimes', { ...ctx, hasLenses: false })).toBe('input-ingest-tip');
    expect(appBackPhase('input-playwright-url-reuse', { ...ctx, reuseFromHub: true })).toBe('input-app-cred-playwright-url');
    expect(appBackPhase('confirm-delete', ctx)).toBe('pick-delete');
    expect(appBackPhase('input-app-lz-provider', ctx)).toBe('input-passes');
    expect(appBackPhase('input-app', ctx)).toBeNull();
    expect(isAppPreRunPhase('input-app')).toBe(false);
    expect(isAppPreRunPhase('input-passes')).toBe(true);
    expect(isAppPreRunPhase('assess-done')).toBe(false);
    expect(APP_TEXT_PHASES.has('input-vcs-url')).toBe(true);
    expect(APP_TEXT_PHASES.has('input-passes')).toBe(false);
  });

  it('the credential list holds the crawl entries (were T, U, P and M)', () => {
    const options = appCredentialOptions({ editOnly: false, stored: (v) => v === APP_CRED_PW_MFA, llmDetail: 'anthropic', connectors, storedKey: () => false });
    expect(options[0]?.value).toBe(CRED_CONTINUE);
    expect(options.find((o) => o.value === APP_CRED_PW_MFA)?.detail).toBe('stored');
    expect(options.filter((o) => o.group === 'Dynamic crawl').map((o) => o.label)).toEqual(['Target URL', 'Username', 'Password', 'MFA secret']);
    expect(options.every((o) => o.guidance !== undefined)).toBe(true);
  });
});
