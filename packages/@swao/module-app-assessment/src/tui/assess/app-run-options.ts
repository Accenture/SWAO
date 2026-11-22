// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module, run options of the Application flow
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (Design 126 section 7.10): the options of one run (stats table, LLM
// cache, source path override, iteration number) are list entries of the
// Run options sub-step of the Passes step; before, the letter keys S, C, P
// and I were named only in the step body and the guidance. Continue is the
// first entry, so Enter goes on as before.

import type { GuidanceEntry, SelectOption } from '@swao/tui-kit';

export const RUN_OPT_CONTINUE = 'continue';
export const RUN_OPT_STATS = 'stats';
export const RUN_OPT_CACHE = 'cache';
export const RUN_OPT_SOURCE = 'source';
export const RUN_OPT_ITER = 'iter';

/** The step entry of the Run options sub-step. */
export const RUN_OPTIONS_GUIDANCE: GuidanceEntry = {
  title: 'Run options',
  what: 'Options of this run only; nothing is written to .swao.yml. Enter on a switch turns it on or off; Continue goes on to the Target LZ step.',
};

export interface AppRunOptionState {
  showStats: boolean;
  useCassette: boolean;
  sourcePath: string;
  iter: string;
}

/** The entries of the Run options list, each with its state and its guidance. */
export function appRunOptions(s: AppRunOptionState): SelectOption[] {
  return [
    { label: 'Continue', value: RUN_OPT_CONTINUE, guidance: { title: 'Continue', what: 'Keeps these options and goes on to the Target LZ step.' } },
    {
      label: `Stats table: ${s.showStats ? 'on' : 'off'}`, value: RUN_OPT_STATS, detail: 'Enter turns it on or off',
      guidance: { title: 'Stats table', what: 'Shows the time and the token cost of each pass at the end of the run.', cli: 'swao assess --app <id> --stats' },
    },
    {
      label: `LLM cache: ${s.useCassette ? 'on, reuse cached answers' : 'off, always fresh'}`, value: RUN_OPT_CACHE, detail: 'Enter turns it on or off',
      guidance: { title: 'LLM cache', what: 'On: a rerun reuses the cached LLM answers, faster and without API cost. Off: every LLM pass asks the model again.', cli: 'swao assess --app <id> --no-cache' },
    },
    {
      label: `Source path: ${s.sourcePath.trim() ? s.sourcePath.trim() : 'from .swao.yml'}`, value: RUN_OPT_SOURCE, detail: 'Enter changes it',
      guidance: { title: 'Source path', what: 'Overrides source.path of the app for this run only, for example a local checkout. An empty entry clears the override.', cli: 'swao assess --app <id> --source-path <dir>' },
    },
    {
      label: `Iteration number: ${s.iter}`, value: RUN_OPT_ITER, detail: 'Enter changes it',
      guidance: { title: 'Iteration number', what: 'Tags the run manifest with an iteration counter, to compare repeated runs of the same app.', cli: 'swao assess --app <id> --iter <n>' },
    },
  ];
}
