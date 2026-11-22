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

// #4191 SET-02 (Design 125 section 4, "Later"): the Setup entry for a
// workspace that was set up before. Short menu lines; details in the guidance.

// #4254 (Design 126 sections 4.1 and 9): a numbered SelectInput; the guidance
// box follows the highlighted entry; the frame comes from the wizard.
// #4341 (run 9): Esc is the wizard's (SetupWizard.tsx), not the menu's.

import { SelectInput, KEY_HINTS, useOptionGuidance, type GuidanceEntry, type SelectOption } from '@swao/tui-kit';
import { SetupStepFrame } from './setup-frame.js';

export const SETUP_START_CHOICES = [
  { id: 'type', label: 'Set up an assessment type', detail: 'Runs the steps, health check and Ready summary of one assessment type.' },
  { id: 'generic', label: 'Workspace setup', detail: 'Engagement, LLM, credentials and MCP client, with the workspace health check.' },
  { id: 'full', label: 'Full setup', detail: 'Workspace setup, then the choice of assessment types and their setup.' },
] as const;
export type SetupStartChoice = (typeof SETUP_START_CHOICES)[number]['id'];

const MENU_GUIDANCE: GuidanceEntry = {
  title: 'Setup',
  what: 'This workspace was set up before. Set up one more assessment type, repeat the workspace setup, or run the full setup again; nothing already configured is lost.',
};

/** #4230: the entries of the Setup menu, each with its guidance entry. */
export function setupStartOptions(workspaceRoot: string): SelectOption[] {
  return SETUP_START_CHOICES.map((c) => ({
    label: c.label,
    value: c.id,
    guidance: { title: c.label, what: c.detail, sections: [{ label: 'Workspace', text: workspaceRoot }] },
  }));
}

export function SetupStartMenu({ workspaceRoot, onChoose }: { workspaceRoot: string; onChoose: (c: SetupStartChoice) => void }) {
  const options = setupStartOptions(workspaceRoot);
  const { entry, onCursorChange } = useOptionGuidance(MENU_GUIDANCE);
  return (
    <SetupStepFrame title="Setup" subtitle="Choose what to set up in this workspace." keys={KEY_HINTS.menu} guidance={entry}>
      <SelectInput
        label="Set up"
        options={options}
        numbered
        visibleCount={SETUP_START_CHOICES.length}
        showKeyHints={false}
        onCursorChange={onCursorChange}
        onSelect={(v) => onChoose(v as SetupStartChoice)}
      />
    </SetupStepFrame>
  );
}
