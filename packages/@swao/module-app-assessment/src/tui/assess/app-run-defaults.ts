// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4284 (Design 125 section 5.7, owner rule 2026-11-08): the frameworks, passes
// and app LLM override confirmed in the Application Assessment screen apply to
// that run only; they reach the run as `swao assess` flags (--regimes, --passes,
// --llm-provider). The app .swao.yml changes only when the owner answers yes to
// the save-as-default question, which starts on No (the pattern of the lens
// step, lens-save-default.ts, #4283, and of the LLM leg builder, #4198), and
// then only the changed keys are edited through the minimal-patch writer
// (patchSwaoYmlFile, @swao/core): comments and every other key stay.

import { join } from 'path';
import { patchSwaoYmlFile, type SwaoYmlEdit } from '@swao/core';

export const APP_SAVE_NO = 'no';
export const APP_SAVE_YES = 'yes';

/** What a save-as-default question is about; names the key it would edit. */
export type AppDefaultKind = 'regimes' | 'passes' | 'llm';

const KEY_OF: Record<AppDefaultKind, string> = {
  regimes: 'assessment.regimes_active',
  passes: 'assessment.pass_profile',
  llm: 'providers.llm.primary',
};

const NOUN_OF: Record<AppDefaultKind, string> = {
  regimes: 'frameworks',
  passes: 'passes',
  llm: 'LLM provider',
};

/** The save-as-default answers, No first so Enter keeps the default. */
export function appSaveOptions(kind: AppDefaultKind): Array<{ label: string; value: string; guidance: { title: string; what: string } }> {
  // #4213 (Design 126 section 9): one guidance entry per answer; the box follows the cursor.
  return [
    {
      label: `No, use the ${NOUN_OF[kind]} for this run only`,
      value: APP_SAVE_NO,
      guidance: { title: 'This run only', what: `The choice of ${NOUN_OF[kind]} applies to this run only; apps/<id>/.swao.yml stays unchanged.` },
    },
    {
      label: `Yes, save as the new default for this app (${KEY_OF[kind]})`,
      value: APP_SAVE_YES,
      guidance: { title: 'Save as default', what: `Writes ${KEY_OF[kind]} to apps/<id>/.swao.yml as the new default of this app; only that key changes, comments stay.` },
    },
  ];
}

/** Hint line under a save-as-default question. */
export function appSaveHint(kind: AppDefaultKind): string {
  return `No: this run only; apps/<id>/.swao.yml stays unchanged. Yes: only ${KEY_OF[kind]} changes, comments stay.`;
}

/** True when two selections differ as sets (order and duplicates ignored). */
export function selectionDiffers(chosen: readonly string[], stored: readonly string[]): boolean {
  const a = new Set(chosen);
  const b = new Set(stored);
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/** Default `passes.malware` block, added on save when malware is chosen and the app has none (#0886). */
const MALWARE_DEFAULT = {
  tools: {
    gitleaks: { enabled: true },
    osv: { enabled: true },
    clamav: { enabled: true },
    yara: { enabled: true },
    ort: { enabled: false },
  },
};

/** The minimal edits of a save-as-default answer. */
export function appDefaultEdits(
  choice:
    | { kind: 'regimes'; regimes: readonly string[] }
    | { kind: 'passes'; passes: readonly string[]; hasMalwareBlock: boolean }
    | { kind: 'llm'; provider: string },
): SwaoYmlEdit[] {
  switch (choice.kind) {
    case 'regimes':
      return [{ path: ['assessment', 'regimes_active'], value: [...choice.regimes] }];
    case 'passes':
      return [
        { path: ['assessment', 'pass_profile'], value: [...choice.passes] },
        ...(choice.passes.includes('malware') && !choice.hasMalwareBlock ? [{ path: ['passes', 'malware'], value: MALWARE_DEFAULT }] : []),
      ];
    case 'llm':
      return [{ path: ['providers', 'llm', 'primary'], value: choice.provider === 'workspace-default' ? undefined : { type: choice.provider } }];
    default: {
      const never: never = choice;
      return never;
    }
  }
}

/** Writes a save-as-default answer to apps/<app>/.swao.yml; the error text, or null when saved. */
export function saveAppDefault(workspace: string, app: string, edits: readonly SwaoYmlEdit[]): string | null {
  const r = patchSwaoYmlFile(join(workspace, 'apps', app, '.swao.yml'), edits);
  return r.ok ? null : `Not saved: ${r.error}`;
}

/**
 * `swao assess` flags of the run-time choices: --regimes when the framework step
 * was confirmed (none for an empty choice; nothing for the 'all' placeholder of a
 * workspace without frameworks), --llm-provider when the app LLM step chose one.
 */
export function appRunChoiceArgs(choice: { regimes: readonly string[] | null; llmProvider: string | null }): string[] {
  const args: string[] = [];
  if (choice.regimes !== null && !choice.regimes.includes('all')) {
    args.push('--regimes', choice.regimes.length > 0 ? choice.regimes.join(',') : 'none');
  }
  if (choice.llmProvider !== null) args.push('--llm-provider', choice.llmProvider);
  return args;
}

/**
 * #4284: the app LLM config this run uses in the screen (preflight ping, child
 * env), the same the CLI applies for --llm-provider: the stored app override,
 * none for workspace-default, or only the chosen provider type.
 */
export function runAppLlmConfig<T extends { type?: string }>(stored: T, runProvider: string | null): T {
  if (runProvider === null) return stored;
  return (runProvider === 'workspace-default' ? {} : { type: runProvider }) as T;
}
