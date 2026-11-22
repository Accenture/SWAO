// #4231 criterion 2 (Design 126 sections 3 and 9.1, gate G-05): every Setup
// Wizard step shows a guidance box. A step reports its own guidance through
// SetupStepFrame, or the wizard frame draws the registry guidance of the plan
// entry (#4342, registryGuidance). This gate pins the second path for every
// plan entry of every run mode: each registered step carries a non-empty
// `guidance`, so the frame always has a box to draw, and every step and
// health-check entry yields a guidance entry. The LZ Live steps Probe, Policy
// Baseline and Org Evidence also report their own entries (lz-live-steps.test.tsx).
import { describe, it, expect, vi } from 'vitest';
import { SETUP_ASSESSMENT_TYPES } from '@swao/core';

vi.mock('../../../license/license-guard.js', () => ({
  LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' } })) },
}));

import { registryGuidance } from '../SetupWizard.js';
import { defaultSetupRegistry } from '../../../setup/index.js';
import { buildSetupPlan } from '../../../setup/plan.js';
import type { SetupPlanEntry, SetupRunMode } from '../../../setup/types.js';

describe('G-05 every Setup Wizard step has a guidance box (#4231)', () => {
  const reg = defaultSetupRegistry();

  it('every registered step carries a non-empty guidance text', () => {
    const missing = reg.allSteps().filter((s) => !s.guidance || s.guidance.trim().length === 0).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('every step and health-check entry of every run mode yields a guidance entry', () => {
    const modes: SetupRunMode[] = [
      { kind: 'generic' },
      { kind: 'first-run', selected: [...SETUP_ASSESSMENT_TYPES] },
      ...SETUP_ASSESSMENT_TYPES.map((type): SetupRunMode => ({ kind: 'branch', type })),
    ];
    const without: string[] = [];
    for (const mode of modes) {
      const plan: SetupPlanEntry[] = buildSetupPlan(reg, mode, { workspaceRoot: '.', tier: 'enterprise' });
      for (const entry of plan) {
        if (entry.kind !== 'step' && entry.kind !== 'health-check') continue;
        const g = registryGuidance(entry);
        if (!g || g.what.trim() === '') without.push(entry.kind === 'step' ? entry.step.id : `health-check:${entry.scope}`);
      }
    }
    expect(without).toEqual([]);
  });

  it('the LZ Live branch covers Landing Zones, Probe, Policy Baseline and Org Evidence', () => {
    const ids = reg.branch('lz-live').steps.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['lz-live.connections', 'lz-live.probe', 'lz-live.baseline', 'lz-live.evidence']));
  });
});
