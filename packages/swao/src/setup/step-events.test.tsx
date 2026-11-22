// #4263: a Setup step cancelled with Esc logs wizard.step.cancelled and never
// wizard.step.complete; the shared logger is tested on two steps (LZ Catalog
// Targets and Service Intake Input), each next to a wizard-like Esc handler,
// plus the regression guard: "keep" with zero targets still completes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ code: string; context: Record<string, unknown> }> }));
vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: vi.fn((_l: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => { calls.push({ code, context: o?.context ?? {} }); }),
  };
});

import { cancelSetupStep, flushSetupStepEvents, logSetupStepComplete } from './step-events.js';
import { LzCatalogTargetsStep } from './branches/lz-catalog.js';
import { ServiceIntakeStep } from './branches/service.js';
import type { SetupStepProps, SetupStepResult } from './types.js';

const ESC = '\u001B';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const dirs: string[] = [];
beforeEach(() => { calls.length = 0; flushSetupStepEvents(); calls.length = 0; });
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(yml = 'engagement:\n  name: x\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4263-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  return d;
}

function props(workspaceRoot: string, results: Array<SetupStepResult | undefined>): SetupStepProps {
  return {
    ctx: { workspaceRoot, tier: 'enterprise', scope: 'lz-catalog', scopeLabel: 'x', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1, stepCount: 3, onNext: (r) => results.push(r), updateSession: () => {}, setEscapeCaptured: () => {}, setGuidanceOpen: () => {},
  };
}

/** The wizard's Esc handler (SetupWizard.tsx): the step does not capture Esc, so the wizard leaves it. */
function WizardEsc({ step }: { step: string }) {
  useInput((_i, key) => { if (key.escape) cancelSetupStep(step, 'user_escape'); });
  return <Text>wizard</Text>;
}

const codes = (): string[] => calls.map((c) => c.code);

describe('cancelled setup steps (#4263)', () => {
  it('Esc at LZ Catalog Targets: wizard.step.cancelled with reason user_escape, no completion', async () => {
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<><WizardEsc step="lz-catalog.targets" /><LzCatalogTargetsStep {...props(ws(), results)} listProviders={() => ['aws']} loadRegions={() => []} /></>);
    await tick();
    r.stdin.write(ESC); await tick(80);
    expect(codes()).toEqual(['wizard.step.cancelled']);
    expect(calls[0]!.context).toEqual({ step: 'lz-catalog.targets', reason: 'user_escape' });
    r.unmount();
  });

  it('Esc at Service Intake Input: the same rule through the shared logger', async () => {
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<><WizardEsc step="service.intake" /><ServiceIntakeStep {...props(ws(), results)} parse={async () => { throw new Error('none'); }} /></>);
    await tick(80);
    r.stdin.write(ESC); await tick(80);
    expect(codes()).toEqual(['wizard.step.cancelled']);
    expect(codes()).not.toContain('wizard.step.complete');
    r.unmount();
  });

  it('regression guard: "keep" with zero targets (Enter, no Esc) still completes and advances', async () => {
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LzCatalogTargetsStep {...props(ws(), results)} listProviders={() => []} loadRegions={() => []} />);
    await tick();
    r.stdin.write('\r'); await tick(80);
    expect(results).toEqual([{ status: 'skipped' }]);
    expect(calls).toEqual([{ code: 'wizard.step.complete', context: { step: 'lz-catalog.targets', targets: 0 } }]);
    r.unmount();
  });

  it('a completion queued outside a cancelled key event is written', () => {
    logSetupStepComplete('a', 'A done', { n: 1 });
    flushSetupStepEvents();
    cancelSetupStep('b', 'user_escape');
    logSetupStepComplete('b', 'B kept');
    flushSetupStepEvents();
    logSetupStepComplete('c', 'C done');
    flushSetupStepEvents();
    expect(calls.map((c) => [c.code, c.context['step']])).toEqual([
      ['wizard.step.complete', 'a'], ['wizard.step.cancelled', 'b'], ['wizard.step.complete', 'c'],
    ]);
  });
});
