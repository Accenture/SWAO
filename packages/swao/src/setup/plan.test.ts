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

// #4190 SET-01 (Design 125 sections 4, 11): plan and step bar per branch.

import { describe, it, expect } from 'vitest';
import { fitStepBar, stepBarWidth } from '@swao/tui-kit';
import { SETUP_ASSESSMENT_TYPES, SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import {
  createSetupRegistry,
  buildSetupPlan,
  stepBarFor,
  defaultSetupRegistry,
  entryLabel,
  setupSubtitle,
  type SetupPlanEntry,
  type SetupStepDefinition,
  type SetupPlanContext,
} from './index.js';

const Noop = (): null => null;
const step = (id: string, scope: SetupStepDefinition['assessmentType'], order: number, label: string, extra: Partial<SetupStepDefinition> = {}): SetupStepDefinition =>
  ({ id, label, assessmentType: scope, order, component: Noop, ...extra });

const reg = createSetupRegistry(
  { steps: [step('generic.init', 'generic', 10, 'Init'), step('generic.llm', 'generic', 20, 'LLM')] },
  SETUP_ASSESSMENT_TYPES.map((t) => ({
    branch: { type: t, label: SETUP_ASSESSMENT_TYPE_LABELS[t], description: 'short', minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER[t] },
    steps: t === 'application'
      ? [step('application.tools', 'application', 50, 'Tools'), step('application.app', 'application', 10, 'App')]
      : t === 'lz-live'
        ? [step('lz-live.zones', 'lz-live', 10, 'Landing Zones'), step('lz-live.baseline', 'lz-live', 30, 'Baseline', { isApplicable: (c) => c.tier !== 'community' })]
        : [],
  })),
);

const labels = (plan: SetupPlanEntry[]): string[] => plan.map(entryLabel);
const ctx = (tier: SetupPlanContext['tier']): SetupPlanContext => ({
  workspaceRoot: '.', tier,
  session: { workDir: '.', engagementName: '', clientCode: '', partnershipLead: '', llmProvider: 'anthropic', llmModel: '', ollamaEndpoint: '', openLlmBaseUrl: '' },
});

describe('buildSetupPlan (#4190)', () => {
  it('first run: generic, generic health check, type selection, then each selected branch in branch order', () => {
    const plan = buildSetupPlan(reg, { kind: 'first-run', selected: ['lz-live', 'application'] });
    expect(labels(plan)).toEqual([
      'Init', 'LLM', 'Health Check', 'Assessments',
      'App', 'Tools', 'Health Check', 'Ready',
      'Landing Zones', 'Baseline', 'Health Check', 'Ready',
    ]);
    // #4120: each branch health check directly follows its last configuration step.
    const appHc = plan.findIndex((e) => e.kind === 'health-check' && e.scope === 'application');
    expect(plan[appHc - 1]).toMatchObject({ kind: 'step', scope: 'application' });
    expect(plan[appHc + 1]).toEqual({ kind: 'ready', scope: 'application' });
  });

  it('first run with no type selected ends with the generic Ready', () => {
    expect(labels(buildSetupPlan(reg, { kind: 'first-run', selected: [] }))).toEqual(['Init', 'LLM', 'Health Check', 'Assessments', 'Ready']);
  });

  it('a single branch run has only the branch, its health check and its Ready', () => {
    const plan = buildSetupPlan(reg, { kind: 'branch', type: 'service' });
    expect(plan).toEqual([{ kind: 'health-check', scope: 'service' }, { kind: 'ready', scope: 'service' }]);
    expect(labels(buildSetupPlan(reg, { kind: 'generic' }))).toEqual(['Init', 'LLM', 'Health Check', 'Ready']);
  });

  it('drops a step whose isApplicable is false for the context', () => {
    expect(labels(buildSetupPlan(reg, { kind: 'branch', type: 'lz-live' }, ctx('community')))).toEqual(['Landing Zones', 'Health Check', 'Ready']);
    expect(labels(buildSetupPlan(reg, { kind: 'branch', type: 'lz-live' }, ctx('consultant')))).toEqual(['Landing Zones', 'Baseline', 'Health Check', 'Ready']);
  });
});

describe('stepBarFor (#4190, Design 125 section 4)', () => {
  const plan = buildSetupPlan(reg, { kind: 'first-run', selected: ['application', 'lz-live'] });

  it('shows the finished workspace part as one entry and the steps of the active branch only', () => {
    const inApp = stepBarFor(plan, plan.findIndex((e) => e.kind === 'step' && e.step.id === 'application.tools'));
    expect(inApp.labels).toEqual(['Workspace', 'App', 'Tools', 'Health Check', 'Ready']);
    expect(inApp.labels[inApp.currentIndex]).toBe('Tools');
    expect(inApp.currentIndex).toBe(2);
    expect(inApp.scope).toBe('application');

    const inLz = stepBarFor(plan, plan.findIndex((e) => e.kind === 'ready' && e.scope === 'lz-live'));
    expect(inLz.labels).toEqual(['Workspace', 'Landing Zones', 'Baseline', 'Health Check', 'Ready']);
    expect(inLz.currentIndex).toBe(4);
  });

  it('a single branch run has no Workspace entry', () => {
    const solo = buildSetupPlan(reg, { kind: 'branch', type: 'application' });
    expect(stepBarFor(solo, 0)).toEqual({ labels: ['App', 'Tools', 'Health Check', 'Ready'], currentIndex: 0, scope: 'application' });
  });

  it('during the generic part the bar has the generic entries only', () => {
    const bar = stepBarFor(plan, 1);
    expect(bar.labels).toEqual(['Init', 'LLM', 'Health Check', 'Assessments']);
    expect(bar.currentIndex).toBe(1);
    expect(bar.scope).toBe('generic');
  });

  it('names the branch in the subtitle', () => {
    expect(setupSubtitle('generic')).toBe('Workspace Setup');
    expect(setupSubtitle('lz-live')).toBe('Setup: Landing Zone Live Assessment');
  });
});

// #4254: the local fitStepBar is removed; the central one (tui-kit StepBar,
// used by ScreenLayout) must fit every bar of the shipped wizard.
describe('step bars of the shipped wizard (#4110, #4254)', () => {
  it('every bar of the shipped wizard fits the header rule at 100, 80 and the narrowest terminal', () => {
    const reg = defaultSetupRegistry();
    const modes = [
      { kind: 'first-run' as const, selected: [...SETUP_ASSESSMENT_TYPES] },
      ...SETUP_ASSESSMENT_TYPES.map((type) => ({ kind: 'branch' as const, type })),
    ];
    for (const width of [98, 78, 63]) {
      for (const mode of modes) {
        const plan = buildSetupPlan(reg, mode);
        plan.forEach((_e, i) => {
          const bar = stepBarFor(plan, i);
          const fitted = fitStepBar(bar.labels, bar.currentIndex, width);
          expect(stepBarWidth(fitted.labels, fitted.gap, fitted.bulletGap), `${JSON.stringify(mode)} entry ${i} at ${width}`).toBeLessThanOrEqual(width);
          expect(fitted.labels[bar.currentIndex]).toBe(bar.labels[bar.currentIndex]);
        });
      }
    }
  });
});
