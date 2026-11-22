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

// #3589 (Design 120 section 14.2): Workspace Setup step "Landing Zone
// Connections" of the Landing Zone Live branch. Open shows the Landing Zone
// Connections screen embedded (no longer a Tools item, #4127); its "Continue
// the setup" item continues. #4297 (Design 126 sections 3, 5, 7 and 9): Open
// first and preselected, Skip second, the subtitle names the SWAO credential
// vault, the menu is a SelectInput with one guidance entry per option and the
// key hints come from the wizard frame (SetupStepFrame), not a hand-written
// footer. Skip leaves the branch without a landing zone; the Ready step lists
// "no live landing zone registered" (probeCheck, Design 125 rule D-8).

import { useState } from 'react';
import { resolve } from 'node:path';
import { SelectInput, useOptionGuidance, type GuidanceEntry, type SelectOption } from '@swao/tui-kit';
import { providerLabel } from '@swao/core';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';
import { LzConnectionsScreen, type LzConnectionsScreenProps } from '../../LzConnectionsScreen.js';

export const LZ_CONNECTIONS_STEP_CHOICES = [
  { id: 'open', label: 'Open Landing Zone Connections' },
  { id: 'skip', label: 'Skip (add a live landing zone later in this setup)' },
] as const;

/** The providers named in the subtitle, through the central name map (#4296): T Cloud Public by its current name, the others by abbreviation. */
const SUBTITLE_PROVIDERS = [['otc', 'full'], ['aws', 'abbr'], ['stackit', 'abbr']] as const;

export const LZ_CONNECTIONS_STEP_SUBTITLE = `Register a live landing zone (${SUBTITLE_PROVIDERS.map(([p, form]) => providerLabel(p, form)).join(', ')}, ...). SWAO only reads. Credentials are stored in the SWAO credential vault, never in .swao.yml.`;

// The guidance cli line of the step and its entries (Design 126 section 9.3).
const CLI_FIELD = { cli: 'swao lz connect / probe / list / remove' } as const;

const STEP_GUIDANCE: GuidanceEntry = {
  title: 'Landing Zone Connections',
  what: 'A live landing zone is a cloud tenant SWAO reads with a login of yours: the platform landing zone (PLZ) and the application landing zones (ALZ) in it. The Landing Zone Live Assessment needs at least one.',
  ...CLI_FIELD,
};

/** #4297: one guidance entry per option. */
export const LZ_CONNECTIONS_STEP_GUIDANCE: Record<(typeof LZ_CONNECTIONS_STEP_CHOICES)[number]['id'], GuidanceEntry> = {
  open: {
    title: 'Open Landing Zone Connections',
    what: 'Registers a landing zone: the provider, a short name, then each scope (PLZ or ALZ) with its login. A read-only probe checks each scope.',
    sections: [
      { label: 'Scopes', text: 'The platform landing zone (PLZ) or an application landing zone (ALZ), each with its auth method and login; the probe runs right after.' },
      { label: 'Credentials', text: 'Entered masked and stored in the SWAO credential vault of your user, keyed by landing zone and scope; never written to .swao.yml or shown on screen.' },
      { label: 'Roles', text: 'Prefer a read-only role (ROLES.md of each provider driver). A write-capable login works too: SWAO only reads and every run asks for confirmation.' },
    ],
    ...CLI_FIELD,
  },
  skip: {
    title: 'Skip',
    what: 'Goes on without a live landing zone; the Probe, Policy Baseline and Org Evidence steps then have nothing to check.',
    sections: [
      { label: 'Ready', text: 'shows "no live landing zone registered"; the Landing Zone Live Assessment is not ready yet.' },
      { label: 'Later', text: 'Run the Landing Zone Live setup again from Workspace Setup, or open step 1 of the Landing Zone Live Assessment, to add a landing zone.' },
    ],
    ...CLI_FIELD,
  },
};

export interface LzConnectionsStepProps {
  workspace: string;
  /** Called with true when the operator opened the screen, false when skipped. */
  onNext: (opened: boolean) => void;
  /** Tells the wizard whether the embedded screen owns Esc (its forms do; its list leaves Esc to the wizard). */
  onOpenChange?: (open: boolean) => void;
  /** Test seams passed to the embedded screen. */
  screen?: Pick<LzConnectionsScreenProps, 'run' | 'store' | 'drivers'>;
}

export function LzConnectionsStep({ workspace, onNext, onOpenChange, screen }: LzConnectionsStepProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { entry, onCursorChange } = useOptionGuidance(STEP_GUIDANCE);

  if (open) {
    return <LzConnectionsScreen embedded workspace={resolve(workspace)} onBack={() => onNext(true)} onEscapeCaptureChange={onOpenChange} {...screen} />;
  }

  const options: SelectOption[] = LZ_CONNECTIONS_STEP_CHOICES.map((c) => ({ label: c.label, value: c.id, guidance: LZ_CONNECTIONS_STEP_GUIDANCE[c.id] }));
  return (
    <SetupStepFrame title="Landing Zone Connections" subtitle={LZ_CONNECTIONS_STEP_SUBTITLE} kind="picker" guidance={entry}>
      <SelectInput
        label="Landing zones"
        options={options}
        numbered
        visibleCount={options.length}
        showKeyHints={false}
        onCursorChange={onCursorChange}
        onSelect={(v) => {
          if (v === 'open') setOpen(true);
          else onNext(false);
        }}
      />
    </SetupStepFrame>
  );
}
