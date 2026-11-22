// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module, step flow of the LZ Catalog Assessment
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (TUI-11, Design 126 sections 4.5, 7.2, 7.4 and 7.10): the step bar,
// the back targets and the credential list of the LZ Catalog flow
// (LzAssessmentScreen.tsx), kept apart so they are tested without rendering.

import type { SelectOption } from '@swao/tui-kit';

export type LzPhase =
  | 'input-app'
  | 'input-app-credentials'
  | 'input-app-cred-vcs-url'
  | 'input-app-cred-vcs-token'
  | 'input-app-cred-api-token'
  | 'input-app-llm'
  | 'input-app-llm-save' // #4284 save-as-default question (starts on No)
  | 'input-lz-target-source'
  | 'input-lz-provider'
  | 'input-lz-frameworks'
  | 'input-lz-region'
  | 'input-lz-gap' // #4285 provider(s) without a region, named before the run
  | 'preflight-llm'
  | 'running'
  | 'assess-done'
  | 'challenge-prompt'
  | 'done';

/** The step bar of the LZ Catalog flow (section 4.5: names, no numbers). */
export const LZ_CATALOG_STEPS = ['Application', 'Credentials', 'Providers', 'Frameworks', 'Regions', 'Run', 'Done'] as const;

/** The step of the bar each phase belongs to. */
export const LZ_CATALOG_PHASE_STEP: Readonly<Record<LzPhase, number>> = {
  'input-app': 0,
  'input-app-credentials': 1, 'input-app-cred-vcs-url': 1, 'input-app-cred-vcs-token': 1, 'input-app-cred-api-token': 1, 'input-app-llm': 1, 'input-app-llm-save': 1,
  'input-lz-target-source': 2, 'input-lz-provider': 2,
  'input-lz-frameworks': 3,
  'input-lz-region': 4, 'input-lz-gap': 4,
  'preflight-llm': 5, running: 5,
  'assess-done': 6, 'challenge-prompt': 6, done: 6,
};

/** The phases before the run (after the app picker): Esc aborts the flow (section 7.4). */
export const LZ_CATALOG_PRE_RUN: ReadonlySet<LzPhase> = new Set<LzPhase>([
  'input-app-credentials', 'input-app-cred-vcs-url', 'input-app-cred-vcs-token', 'input-app-cred-api-token', 'input-app-llm', 'input-app-llm-save',
  'input-lz-target-source', 'input-lz-provider', 'input-lz-frameworks', 'input-lz-region', 'input-lz-gap',
]);

/**
 * Section 7.2: the phase the back key returns to, values kept. The sub-steps
 * of the credentials return to the credential list.
 */
export function lzCatalogBackPhase(phase: LzPhase): LzPhase | null {
  switch (phase) {
    case 'input-app-credentials': return 'input-app';
    case 'input-app-cred-vcs-url':
    case 'input-app-cred-vcs-token':
    case 'input-app-cred-api-token':
    case 'input-app-llm': return 'input-app-credentials';
    case 'input-app-llm-save': return 'input-app-llm';
    case 'input-lz-target-source':
    case 'input-lz-provider': return 'input-app-credentials';
    case 'input-lz-frameworks': return 'input-lz-provider';
    case 'input-lz-region': return 'input-lz-frameworks';
    case 'input-lz-gap': return 'input-lz-region';
    case 'input-app':
    case 'preflight-llm':
    case 'running':
    case 'assess-done':
    case 'challenge-prompt':
    case 'done': return null;
  }
}

/** Section 7.10: the credential list entries (were the letter keys R, A, L, 1 to 9, [ and ]). */
export const CRED_CONTINUE = '__continue__';
export const CRED_VCS_URL = '__vcs-url__';
export const CRED_VCS_TOKEN = '__vcs-token__';
export const CRED_LLM = '__llm__';
export const CRED_API_PREFIX = 'api:';

export interface CredentialConnector {
  id: string;
  name: string;
  credentialKey?: string;
  envVar?: string;
}

/** The connector entries of a credential list, under "API tokens". */
export function apiTokenOptions(connectors: readonly CredentialConnector[], stored: (key: string) => boolean): SelectOption[] {
  return connectors.map((c) => ({
    label: c.name,
    value: `${CRED_API_PREFIX}${c.id}`,
    group: 'API tokens',
    detail: c.credentialKey ? (stored(c.credentialKey) ? 'stored' : 'not stored') : 'environment variable',
    guidance: {
      title: `${c.name} API key`,
      what: c.credentialKey
        ? `The API key of the ${c.name} LLM gateway connector, stored in the SWAO credential store.`
        : `${c.name} reads its key from the environment variable ${c.envVar ?? ''}; there is nothing to enter here.`,
    },
  }));
}

/** The first entry of a credential list: go on, or (edit mode) save and return to the apps. */
export function continueOption(editOnly: boolean, next: string): SelectOption {
  const label = editOnly ? 'Save and back to the apps' : 'Continue';
  return {
    label,
    value: CRED_CONTINUE,
    guidance: { title: label, what: editOnly ? 'Keeps the credentials stored so far and returns to the app list.' : `Goes on to ${next}. Every credential is optional.` },
  };
}

/** The credential list of the LZ Catalog flow; Continue first, so Enter goes on as before. */
export function lzCredentialOptions(opts: {
  app: string;
  editOnly: boolean;
  stored: (key: string) => boolean;
  connectors: readonly CredentialConnector[];
}): SelectOption[] {
  const state = (key: string): string => (opts.stored(key) ? 'stored' : 'not stored');
  return [
    continueOption(opts.editOnly, 'the cloud providers of this run'),
    {
      label: 'Repository URL', value: CRED_VCS_URL, group: 'Source', detail: state(`vcs-url-${opts.app}`),
      guidance: { title: 'Repository URL', what: 'The HTTPS clone URL of the source repository of this app, stored in the SWAO credential store for this app only.' },
    },
    {
      label: 'Access token', value: CRED_VCS_TOKEN, group: 'Source', detail: state(`vcs-token-${opts.app}`),
      guidance: { title: 'Access token', what: 'A personal access token to clone the repository, stored under the key of its host.' },
    },
    {
      label: 'LLM provider for this run', value: CRED_LLM, group: 'LLM',
      guidance: { title: 'LLM provider for this run', what: 'Chooses the LLM provider of this run; SWAO asks before it saves the choice as the default of the app.' },
    },
    ...apiTokenOptions(opts.connectors, opts.stored),
  ];
}
