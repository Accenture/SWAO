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

// #4190 SET-01 (Design 125 section 11): registry test, every branch step has
// a type, ids are namespaced and unique, and an inconsistent set is refused.

import { describe, it, expect } from 'vitest';
import { SETUP_ASSESSMENT_TYPES, SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import { createSetupRegistry, SetupRegistryError, defaultSetupRegistry, type SetupBranchModule, type SetupStepDefinition } from './index.js';

const Noop = (): null => null;
const step = (id: string, scope: SetupStepDefinition['assessmentType'], order: number, label = `Step ${id.slice(-6)}`): SetupStepDefinition =>
  ({ id, label, assessmentType: scope, order, component: Noop });
const branch = (type: (typeof SETUP_ASSESSMENT_TYPES)[number], steps: SetupStepDefinition[] = []): SetupBranchModule => ({
  branch: { type, label: SETUP_ASSESSMENT_TYPE_LABELS[type], description: 'short', minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER[type] },
  steps,
});
const allBranches = (over: Partial<Record<(typeof SETUP_ASSESSMENT_TYPES)[number], SetupStepDefinition[]>> = {}): SetupBranchModule[] =>
  SETUP_ASSESSMENT_TYPES.map((t) => branch(t, over[t] ?? []));

function problems(fn: () => unknown): string[] {
  try { fn(); } catch (e) { if (e instanceof SetupRegistryError) return [...e.problems]; throw e; }
  return [];
}

describe('shipped setup registry (#4190)', () => {
  const reg = defaultSetupRegistry();

  it('has the five branches in Design 125 order and every step carries its scope', () => {
    expect(reg.branches().map((b) => b.branch.type)).toEqual([...SETUP_ASSESSMENT_TYPES]);
    for (const s of reg.generic) expect(s.assessmentType).toBe('generic');
    for (const b of reg.branches()) for (const s of b.steps) {
      expect(s.assessmentType).toBe(b.branch.type);
      expect(s.id.startsWith(`${b.branch.type}.`)).toBe(true);
    }
  });

  it('the generic setup is Init, LLM, Credentials, MCP Client (section 5.1)', () => {
    expect(reg.generic.map((s) => s.label)).toEqual(['Init', 'LLM', 'Credentials', 'MCP Client']);
  });

  it('the steps migrated from the linear wizard sit in their branches', () => {
    expect(reg.steps('application').map((s) => s.id)).toEqual(expect.arrayContaining(['application.playwright', 'application.test-code']));
    expect(reg.steps('lz-live').map((s) => s.id)).toContain('lz-live.connections');
    expect(reg.step('application.test-code')?.label).toBe('Test Code');
  });

  it('LZ live is the only branch above Community (012 F-136)', () => {
    expect(reg.branches().filter((b) => b.branch.minTier !== 'community').map((b) => b.branch.type)).toEqual(['lz-live']);
  });
});

describe('createSetupRegistry validation (#4190)', () => {
  it('accepts a consistent set and sorts steps by order', () => {
    const reg = createSetupRegistry({ steps: [step('generic.b', 'generic', 20), step('generic.a', 'generic', 10)] }, allBranches({ llm: [step('llm.y', 'llm', 20), step('llm.x', 'llm', 10)] }));
    expect(reg.generic.map((s) => s.id)).toEqual(['generic.a', 'generic.b']);
    expect(reg.steps('llm').map((s) => s.id)).toEqual(['llm.x', 'llm.y']);
    expect(reg.allSteps()).toHaveLength(4);
  });

  it('refuses a duplicate step id', () => {
    const p = problems(() => createSetupRegistry({ steps: [] }, allBranches({ service: [step('service.a', 'service', 10), step('service.a', 'service', 20)] })));
    expect(p.join('\n')).toContain('duplicate step id service.a');
  });

  it('refuses a step whose type is not its branch, and an id without the scope prefix', () => {
    const p = problems(() => createSetupRegistry({ steps: [] }, allBranches({ 'lz-live': [step('lz-live.x', 'application', 10), step('probe', 'lz-live', 20)] })));
    expect(p.join('\n')).toContain('declares assessmentType application but is registered under lz-live');
    expect(p.join('\n')).toContain('step id probe must start with "lz-live."');
  });

  it('refuses a missing or twice registered branch', () => {
    const missing = problems(() => createSetupRegistry({ steps: [] }, allBranches().filter((b) => b.branch.type !== 'llm')));
    expect(missing).toContain('branch llm is not registered');
    const twice = problems(() => createSetupRegistry({ steps: [] }, [...allBranches(), branch('service')]));
    expect(twice).toContain('branch service is registered twice');
  });

  it('refuses CLI syntax, a "--" or an over-long label (Design 125 section 9)', () => {
    const p = problems(() => createSetupRegistry({ steps: [step('generic.a', 'generic', 10, 'swao lz probe'), step('generic.b', 'generic', 20, 'A very long step label')] }, allBranches()));
    expect(p.some((x) => x.includes('no CLI syntax'))).toBe(true);
    expect(p.some((x) => x.includes('longer than'))).toBe(true);
  });

  it('refuses an engine label and a label used twice in a scope (the step bar keys by label)', () => {
    const p = problems(() => createSetupRegistry({ steps: [step('generic.a', 'generic', 10, 'Ready'), step('generic.b', 'generic', 20, 'X'), step('generic.c', 'generic', 30, 'X')] }, allBranches()));
    expect(p.join('\n')).toContain('label "Ready" is used by the engine');
    expect(p.join('\n')).toContain('label "X" is used twice in generic');
  });

  it('refuses a wrong branch tier and a duplicate order within a scope', () => {
    const b = allBranches();
    b[3] = { ...b[3]!, branch: { ...b[3]!.branch, minTier: 'community' } };
    expect(problems(() => createSetupRegistry({ steps: [] }, b)).join('\n')).toContain('branch lz-live minTier must be consultant');
    const p = problems(() => createSetupRegistry({ steps: [step('generic.a', 'generic', 10), step('generic.b', 'generic', 10)] }, allBranches()));
    expect(p.join('\n')).toContain('order 10 is used twice');
  });
});
