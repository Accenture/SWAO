// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module, step flow of the Application Assessment
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (TUI-11, Design 126 sections 4.5, 7.2, 7.4 and 7.10): the step bar,
// the back targets and the text-input phases of the Application flow
// (AppAssessmentScreen.tsx), kept apart so they are tested without rendering.

import type { SelectOption } from '@swao/tui-kit';
import { apiTokenOptions, continueOption, type CredentialConnector } from './lz-catalog-flow.js';

export type AppPhase =
  | 'input-app'
  | 'input-app-new'
  | 'input-vcs-url'
  | 'input-vcs-ref'
  | 'input-source-subdir'
  | 'input-playwright-url'
  // #0885: credential reuse prompt when a matching URL is found in the store
  | 'input-playwright-url-reuse'
  // #0776-C: inline login sub-steps following the URL prompt
  | 'input-playwright-username'
  | 'input-playwright-password'
  // #0814: per-app credential hub + sub-steps (VCS + Playwright)
  | 'input-app-credentials'
  | 'input-app-cred-vcs-url'
  | 'input-app-cred-vcs-token'
  | 'input-app-cred-playwright-url'
  | 'input-app-cred-playwright-user'
  | 'input-app-cred-playwright-pass'
  | 'input-app-cred-playwright-mfa'
  // #2329: API token entry for an LLM gateway connector
  | 'input-app-cred-api-token'
  // #0800: per-app LLM override (L key from credential hub)
  | 'input-app-llm'
  | 'input-app-llm-save' // #4284
  | 'input-ingest-tip'
  | 'input-lenses'
  // #4283: save the confirmed lenses as the workspace default? (default No)
  | 'input-lenses-save'
  | 'input-regimes'
  | 'input-regimes-save' // #4284 save-as-default question (starts on No)
  | 'input-passes'
  | 'input-passes-save' // #4284
  | 'input-run-options' // #4255 stats, LLM cache, source path, iteration (were letter keys)
  | 'playwright-warn'
  | 'input-source-path'
  | 'input-iter'
  | 'pick-delete'
  | 'confirm-delete'
  | 'pick-rename'
  | 'input-rename'
  | 'op-done'
  | 'input-app-lz-provider'
  | 'input-app-lz-region'
  | 'input-app-lz-gap' // #4285 provider(s) without a region, named before the run
  // #2328: pre-flight LLM connectivity check before starting the run
  | 'preflight-llm'
  | 'running'
  // #0407 (sprint-040 round-6): explicit "assessment done -- press Enter
  // for BI export options" step so the operator can see the final
  // 100% green bar + summary before being whisked into the export menu.
  | 'assess-done'
  | 'challenge-prompt'
  // #4256: the export-prompt and export-running phases are gone (no path reached them; Export BI is its own screen).
  | 'done';

/** The step bar of the Application flow (section 4.5: names, no numbers). */
export const APP_STEPS = ['Application', 'Credentials', 'Inputs', 'Lenses', 'Frameworks', 'Passes', 'Target LZ', 'Run', 'Done'] as const;

/** The step of the bar each phase belongs to. */
export const APP_PHASE_STEP: Readonly<Record<AppPhase, number>> = {
  'input-app': 0, 'input-app-new': 0, 'input-vcs-url': 0, 'input-vcs-ref': 0, 'input-source-subdir': 0,
  'input-playwright-url': 0, 'input-playwright-url-reuse': 0, 'input-playwright-username': 0, 'input-playwright-password': 0,
  'pick-delete': 0, 'confirm-delete': 0, 'pick-rename': 0, 'input-rename': 0, 'op-done': 0,
  'input-app-credentials': 1, 'input-app-cred-vcs-url': 1, 'input-app-cred-vcs-token': 1, 'input-app-cred-playwright-url': 1,
  'input-app-cred-playwright-user': 1, 'input-app-cred-playwright-pass': 1, 'input-app-cred-playwright-mfa': 1,
  'input-app-cred-api-token': 1, 'input-app-llm': 1, 'input-app-llm-save': 1,
  'input-ingest-tip': 2,
  'input-lenses': 3, 'input-lenses-save': 3,
  'input-regimes': 4, 'input-regimes-save': 4,
  'input-passes': 5, 'input-passes-save': 5, 'input-run-options': 5, 'playwright-warn': 5, 'input-source-path': 5, 'input-iter': 5,
  'input-app-lz-provider': 6, 'input-app-lz-region': 6, 'input-app-lz-gap': 6,
  'preflight-llm': 7, running: 7,
  'assess-done': 8, 'challenge-prompt': 8, done: 8,
};

/**
 * Section 7.2: the phase the back key returns to, values kept; null where
 * the flow has no previous step (the app picker) or the run owns the keys.
 * `hasLenses`: the lens step is offered; `reuseFromHub`: the credential
 * reuse question was opened from the credential list.
 */
export function appBackPhase(phase: AppPhase, ctx: { hasLenses: boolean; reuseFromHub: boolean }): AppPhase | null {
  switch (phase) {
    case 'input-app-new': return 'input-app';
    case 'input-vcs-url': return 'input-app-new';
    case 'input-vcs-ref': return 'input-vcs-url';
    case 'input-source-subdir': return 'input-vcs-ref';
    case 'input-playwright-url': return 'input-app-credentials';
    case 'input-playwright-url-reuse': return ctx.reuseFromHub ? 'input-app-cred-playwright-url' : 'input-playwright-url';
    case 'input-playwright-username': return 'input-playwright-url';
    case 'input-playwright-password': return 'input-playwright-username';
    case 'input-app-credentials': return 'input-app';
    case 'input-app-cred-vcs-url':
    case 'input-app-cred-vcs-token':
    case 'input-app-cred-playwright-url':
    case 'input-app-cred-playwright-user':
    case 'input-app-cred-playwright-pass':
    case 'input-app-cred-playwright-mfa':
    case 'input-app-cred-api-token':
    case 'input-app-llm': return 'input-app-credentials';
    case 'input-app-llm-save': return 'input-app-llm';
    case 'input-ingest-tip': return 'input-app-credentials';
    case 'input-lenses': return 'input-ingest-tip';
    case 'input-lenses-save': return 'input-lenses';
    case 'input-regimes': return ctx.hasLenses ? 'input-lenses' : 'input-ingest-tip';
    case 'input-regimes-save': return 'input-regimes';
    case 'input-passes': return 'input-regimes';
    case 'input-run-options':
    case 'playwright-warn': return 'input-passes';
    case 'input-passes-save':
    case 'input-source-path':
    case 'input-iter': return 'input-run-options';
    case 'pick-delete':
    case 'pick-rename':
    case 'op-done': return 'input-app';
    case 'confirm-delete': return 'pick-delete';
    case 'input-rename': return 'pick-rename';
    case 'input-app-lz-provider': return 'input-passes';
    case 'input-app-lz-region': return 'input-app-lz-provider';
    case 'input-app-lz-gap': return 'input-app-lz-region';
    case 'input-app':
    case 'preflight-llm':
    case 'running':
    case 'assess-done':
    case 'challenge-prompt':
    case 'done': return null;
  }
}

/** The phases where Esc aborts the flow (section 7.4): every step after the app picker and before the run. */
export function isAppPreRunPhase(phase: AppPhase): boolean {
  return phase !== 'input-app' && appBackPhase(phase, { hasLenses: true, reuseFromHub: false }) !== null;
}

/** Phases whose content is a text input: the left arrow moves the text cursor, Shift+Tab goes back (section 7.1). */
export const APP_TEXT_PHASES: ReadonlySet<AppPhase> = new Set<AppPhase>([
  'input-app-new', 'input-vcs-url', 'input-vcs-ref', 'input-source-subdir',
  'input-playwright-url', 'input-playwright-username', 'input-playwright-password',
  'input-app-cred-vcs-url', 'input-app-cred-vcs-token', 'input-app-cred-playwright-url', 'input-app-cred-playwright-user',
  'input-app-cred-playwright-pass', 'input-app-cred-playwright-mfa', 'input-app-cred-api-token',
  'input-rename', 'input-source-path', 'input-iter',
]);

/** Section 7.10: the credential list entries of the Application flow (were the letter keys R, A, T, U, P, M, L, 1 to 9, [ and ]). */
export const APP_CRED_VCS_URL = '__vcs-url__';
export const APP_CRED_VCS_TOKEN = '__vcs-token__';
export const APP_CRED_PW_URL = '__pw-url__';
export const APP_CRED_PW_USER = '__pw-user__';
export const APP_CRED_PW_PASS = '__pw-pass__';
export const APP_CRED_PW_MFA = '__pw-mfa__';
export const APP_CRED_LLM = '__llm__';

/** The credential list of the Application flow; Continue first, so Enter goes on as before. */
export function appCredentialOptions(opts: {
  editOnly: boolean;
  /** Stored state per entry value (the screen knows the credential keys). */
  stored: (value: string) => boolean;
  /** Detail shown next to the LLM entry (the provider of this run). */
  llmDetail: string;
  connectors: readonly CredentialConnector[];
  storedKey: (key: string) => boolean;
}): SelectOption[] {
  const entry = (label: string, value: string, group: string, what: string): SelectOption => ({
    label, value, group, detail: opts.stored(value) ? 'stored' : 'not stored', guidance: { title: label, what },
  });
  return [
    continueOption(opts.editOnly, 'the ingestion folder and the assessment settings of this run'),
    entry('Repository URL', APP_CRED_VCS_URL, 'Source', 'The HTTPS clone URL of the source repository of this app, stored in the SWAO credential store for this app only.'),
    entry('Access token', APP_CRED_VCS_TOKEN, 'Source', 'A personal access token to clone the repository, stored under the key of its host.'),
    entry('Target URL', APP_CRED_PW_URL, 'Dynamic crawl', 'The URL the Playwright crawl of Pass 10 opens. SWAO offers to reuse a login stored for the same URL.'),
    entry('Username', APP_CRED_PW_USER, 'Dynamic crawl', 'The login name of the crawl, stored in the SWAO credential store.'),
    entry('Password', APP_CRED_PW_PASS, 'Dynamic crawl', 'The login password of the crawl, stored in the SWAO credential store and never written to .swao.yml.'),
    entry('MFA secret', APP_CRED_PW_MFA, 'Dynamic crawl', 'The TOTP secret of the crawl login, when the application asks for a second factor.'),
    { label: 'LLM provider for this run', value: APP_CRED_LLM, group: 'LLM', detail: opts.llmDetail, guidance: { title: 'LLM provider for this run', what: 'Chooses the LLM provider of this run; SWAO asks before it saves the choice as the default of the app.' } },
    ...apiTokenOptions(opts.connectors, opts.storedKey),
  ];
}
