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

// #3403: TUI parity for assessment.test_code. The choice is written to the
// workspace .swao.yml (no new config file); an app .swao.yml that sets its
// own value wins at assess time.

// #4117: the step shows the option labels only; what each mode does to
// findings, scores and the publication lives in the central GuidanceBox
// (Design 070 section 2.5, Design 051 `assessment.test_code.mode`).

// #4254 / #4341 / #4230 (Design 126 sections 4.5, 7.7 and 9): a numbered
// SelectInput inside SetupStepFrame; each mode carries its own guidance entry
// and the box follows the highlighted mode. Keeping the current setting is
// the last list entry, never Esc; Esc belongs to the wizard.

import { SelectInput, useOptionGuidance, type GuidanceEntry, type GuidanceSection, type SelectOption } from '@swao/tui-kit';
import type { WizardTestCodeMode } from '../yaml-helpers.js';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';

// #4254 (run 9, Design 126 section 9.3): the explanation of a mode fits three
// lines at 80 columns; the rest of it is the mode's Details section.
export const TEST_CODE_CHOICES: ReadonlyArray<{ mode: WizardTestCodeMode; label: string; help: string; details?: string }> = [
  { mode: 'include', label: 'Analyse all code (default)', help: 'Test code is analysed like production code. Findings, scores and the publication are as before.' },
  { mode: 'tag', label: 'Analyse all code, mark test-code findings', help: 'Everything is analysed. A finding whose evidence is test code only is marked "test code" and lowered one severity step, so it weighs less in the scores.', details: 'The original severity is kept. The publication shows the marked findings and their count in the assessment scope. The secret scan keeps its severity.' },
  { mode: 'exclude', label: 'Exclude test code', help: 'No pass reads test folders and files, so they produce no findings and count in neither the scores nor the file totals.', details: 'The secret scan still covers them; its test-code findings are marked, never dropped. The publication shows how many test files were excluded.' },
];

/** The value of the keep entry (not a mode). */
export const TEST_CODE_KEEP = 'keep';

/** #4117: guidance sections of the step: scope, override and test-code detection. */
export function testCodeGuidance(): GuidanceSection[] {
  return [
    { label: 'Applies to', text: 'Application Assessments only. Service Portfolio, Landing Zone and LLM Assessments do not read source code and ignore this setting.' },
    { label: 'Saved as', text: 'assessment.test_code.mode in the workspace .swao.yml. An app .swao.yml that sets its own value overrides it for that app.' },
    { label: 'Test code is', text: 'Test folders (src/test/, test/, tests/, e2e/, systemtest/ and similar) and test files (*.test.*, *.spec.*, *Test.java, test_*.py, *_test.go and similar), plus test folders declared in Maven, Gradle, vitest and jest files.' },
  ];
}

/** #4341: the label of the last entry: keep the stored mode, or keep the default. */
export function testCodeKeepLabel(initial: WizardTestCodeMode | undefined): string {
  return initial ? `Keep the current setting (${initial})` : 'Skip this step (analyse all code)';
}

/** #4230: one option per mode, each with its own guidance entry, then the keep entry. */
export function testCodeOptions(initial: WizardTestCodeMode | undefined): SelectOption[] {
  const sections = testCodeGuidance();
  const keepLabel = testCodeKeepLabel(initial);
  return [
    ...TEST_CODE_CHOICES.map((c) => ({ label: c.label, value: c.mode, guidance: { title: c.label, what: c.help, sections: c.details ? [{ label: 'Details', text: c.details }, ...sections] : sections } })),
    {
      label: keepLabel,
      value: TEST_CODE_KEEP,
      guidance: { title: keepLabel, what: initial ? `Continues with the mode ${initial}; nothing is written.` : 'Continues without writing a mode; test code is analysed like production code.', sections },
    },
  ];
}

const STEP_GUIDANCE: GuidanceEntry = { title: 'Test code', what: 'How Application Assessments treat test code: analysed, marked or excluded.', sections: testCodeGuidance() };

export function TestCodeStep({ initial, onNext }: {
  initial?: WizardTestCodeMode;
  /** The chosen mode, or undefined when the operator kept the current value (the keep entry). */
  onNext: (mode?: WizardTestCodeMode) => void;
}) {
  const options = testCodeOptions(initial);
  const { entry, onCursorChange } = useOptionGuidance(STEP_GUIDANCE);
  // #4494 (Design 126 section 4): with a stored mode the cursor starts on the keep entry.
  const start = initial ? options.length - 1 : Math.max(0, TEST_CODE_CHOICES.findIndex((c) => c.mode === 'include'));
  return (
    <SetupStepFrame title="Test code" subtitle="How should Application Assessments treat test code?" kind="picker" guidance={entry}>
      <SelectInput
        label=""
        options={options}
        numbered
        initialIndex={start}
        visibleCount={options.length}
        showKeyHints={false}
        onCursorChange={onCursorChange}
        onSelect={(v) => onNext(v === TEST_CODE_KEEP ? undefined : (v as WizardTestCodeMode))}
      />
    </SetupStepFrame>
  );
}
