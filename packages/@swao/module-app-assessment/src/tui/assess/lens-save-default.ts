// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application Assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4283 (Design 125 section 5.7, owner decision 2026-11-09): the lenses
// confirmed in the Application Assessment apply to that run only. The
// workspace default (`assessment.lenses`) changes only when the owner answers
// yes to the save-as-default question, which starts on No (same pattern as
// the LLM leg builder, SaveDefaultStage.tsx, #4198).

export const LENS_SAVE_NO = 'no';
export const LENS_SAVE_YES = 'yes';

/** The save-as-default answers, No first so Enter keeps the default. */
// #4213 (Design 126 section 9): one guidance entry per answer; the box follows the cursor.
export const LENS_SAVE_OPTIONS: ReadonlyArray<{ label: string; value: string; guidance: { title: string; what: string } }> = [
  { label: 'No, use them for this run only', value: LENS_SAVE_NO, guidance: { title: 'This run only', what: 'The lenses apply to this run only; the workspace .swao.yml stays unchanged.' } },
  { label: 'Yes, save them as the workspace default (assessment.lenses)', value: LENS_SAVE_YES, guidance: { title: 'Save as default', what: 'Writes assessment.lenses to the workspace .swao.yml as the new default; only that key changes.' } },
];

/**
 * True when the confirmed lenses differ (as a set) from the workspace default,
 * so the save-as-default question is worth asking. No question when nothing
 * can be saved or the choice equals the default (an empty choice with no
 * default included).
 */
export function lensSaveQuestionNeeded(chosen: readonly string[], stored: readonly string[], canSave: boolean): boolean {
  if (!canSave) return false;
  const a = new Set(chosen);
  const b = new Set(stored);
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/** The `swao assess` arguments that record the lenses of this run (`lenses_used`); `none` for no lens. */
export function lensRunArgs(lensStepShown: boolean, chosen: readonly string[]): string[] {
  return lensStepShown ? ['--lenses', chosen.length > 0 ? chosen.join(',') : 'none'] : [];
}
