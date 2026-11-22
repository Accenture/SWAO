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

// #4191 SET-02 (Design 125 sections 4, 9, Q-06): the type selection, and the
// scoped health-check arguments of the wizard (#4197).

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { headerRuleWidth } from '@swao/tui-kit';
import { TypeSelectionStep, typeSelectionLine } from './TypeSelectionStep.js';
import { healthCheckArgs } from '../tui/screens/wizard/steps/HealthCheckStep.js';
import type { SetupAssessmentType } from '@swao/core';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('TypeSelectionStep (#4191)', () => {
  it('lists the five types with state; LZ live is greyed out with its tier on Community', () => {
    expect(typeSelectionLine('lz-live', 'community', false, undefined, false)).toBe('[-] Landing Zone Live Assessment  (needs Consultant)');
    expect(typeSelectionLine('application', 'community', true, 'ready', false)).toBe('[x] Application Assessment  (ready)');
    expect(typeSelectionLine('service', 'enterprise', false, 'needs-attention', true)).toBe('Service Portfolio Assessment  (needs attention)');
    // #4282: the menu names the cause of needs attention.
    expect(typeSelectionLine('service', 'enterprise', false, 'needs-attention', true, 'needs attention: waiting for Intake workbook')).toBe('Service Portfolio Assessment  (needs attention: waiting for Intake workbook)');
    expect(typeSelectionLine('lz-live', 'community', false, 'needs-attention', false, 'needs attention: missing Landing zones')).toBe('[-] Landing Zone Live Assessment  (needs Consultant)');
  });

  it('ticks with the number keys, refuses a gated type, and returns the ticked types in branch order', async () => {
    const got: Array<SetupAssessmentType[] | undefined> = [];
    const r = render(<TypeSelectionStep tier="community" initial={['llm', 'lz-live']} states={{}} onNext={(s) => got.push(s)} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Which assessments will you run?');
    for (const line of frame.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(headerRuleWidth(100));
    expect(frame).not.toMatch(/--|swao /);
    r.stdin.write('4'); // gated: no effect
    await tick();
    r.stdin.write('2'); // tick Service
    await tick();
    r.stdin.write('\r');
    await tick();
    r.unmount();
    expect(got).toEqual([['service', 'llm']]);
  });

  it('Esc is never the step\'s, in both modes (#4341, the wizard owns it); single mode picks one available type', async () => {
    const got: Array<SetupAssessmentType[] | undefined> = [];
    const r = render(<TypeSelectionStep tier="community" initial={[]} states={{}} onNext={(s) => got.push(s)} />);
    await tick();
    r.stdin.write('\u001B');
    await tick();
    r.unmount();
    expect(got).toEqual([]);
    const m = render(<TypeSelectionStep single tier="community" initial={[]} states={{}} onNext={(s) => got.push(s)} />);
    await tick();
    m.stdin.write('\u001B');
    await tick();
    m.unmount();
    expect(got).toEqual([]);
    const s = render(<TypeSelectionStep single tier="community" initial={[]} states={{}} onNext={(x) => got.push(x)} />);
    await tick();
    s.stdin.write('4'); // gated
    await tick();
    s.stdin.write('5');
    await tick();
    s.unmount();
    expect(got).toEqual([['llm']]);
  });
});

describe('wizard health check arguments (#4197)', () => {
  it('a scope adds --type; no scope keeps the full run', () => {
    expect(healthCheckArgs()).toEqual(['health-check']);
    expect(healthCheckArgs('lz-live')).toEqual(['health-check', '--type', 'lz-live']);
  });
});
