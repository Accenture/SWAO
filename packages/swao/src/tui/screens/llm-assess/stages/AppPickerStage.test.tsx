// #4242: the LLM Assessment picker names the application run it uses and
// lists apps without an application run as not available, with the reason.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { AppPickerStage, appOptionLabel, runLabel, llmAppGuidance, LLM_APP_PICKER_GUIDANCE } from './AppPickerStage.js';

describe('AppPickerStage (#4242)', () => {
  it('runLabel formats the run folder timestamp', () => {
    expect(runLabel('2026-11-09T14-08-36')).toBe('2026-11-09 14:08 UTC');
    expect(runLabel('odd-name')).toBe('odd-name');
  });

  it('the option names pass count, type and run of the suite', () => {
    const label = appOptionLabel({ id: 'demo-app', passCount: 14, suiteRun: { runTs: '2026-11-09T14-08-36', passCount: 14, finishedAt: '' }, applicationRunCount: 1 }, 'demo-app');
    expect(label).toBe('demo-app  (14 passes, Application Assessment 2026-11-09 14:08 UTC)  (default)');
    const several = appOptionLabel({ id: 'b', passCount: 12, suiteRun: { runTs: '2026-11-08T10-00-00', passCount: 12, finishedAt: '' }, applicationRunCount: 3 });
    expect(several).toContain('newest of 3 application runs');
  });

  it('apps without an application run are listed as not available with the reason', () => {
    const { lastFrame } = render(
      <AppPickerStage
        eligibleApps={[{ id: 'demo-app', passCount: 14, suiteRun: { runTs: '2026-11-09T14-08-36', passCount: 14, finishedAt: '' } }]}
        unavailableApps={[{ id: 'svc-app', reason: 'no Application Assessment run (only other assessment types): only service runs (newest 2026-11-09T10-00-00)' }]}
        noApps={false}
        guidanceOpen={false}
        onGuidanceOpenChange={() => undefined}
        onSelect={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('14 passes, Application Assessment 2026-11-09 14:08 UTC');
    expect(frame).toContain('Not available (1)');
    expect(frame).toContain('svc-app');
  });
});

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
const many = Array.from({ length: 40 }, (_, i) => ({ id: `app${String(i + 1).padStart(2, '0')}`, passCount: 14 }));

describe('LLM app picker bounded, filtered, navigable with the guidance open (#4255, #4239)', () => {
  it('shows a bounded window of 40 apps with the key hints and no double dash', () => {
    const { lastFrame } = render(
      <AppPickerStage eligibleApps={many} noApps={false} guidanceOpen={false} onGuidanceOpenChange={() => undefined} onSelect={() => undefined} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('app01');
    expect(frame).not.toContain('app40');
    expect(frame).toContain('more');
    expect(frame).toContain('Type filter');
    expect(frame).not.toMatch(/ -- |\|/);
  });

  it('type-to-filter narrows the list; with the guidance open Down and Enter still pick', async () => {
    const picked: string[] = [];
    const { lastFrame, stdin } = render(
      <AppPickerStage eligibleApps={many} noApps={false} guidanceOpen={false} onGuidanceOpenChange={() => undefined} onSelect={(id) => picked.push(id)} />,
    );
    await settle();
    for (const ch of 'app3') { stdin.write(ch); await settle(); }
    expect(lastFrame()).toContain('of 40 apps');
    stdin.write('\u0007'); await settle(); // Ctrl+G opens the guidance box
    // #4230: the box shows the highlighted app, not one text for the whole picker.
    expect(lastFrame()).toContain('replays the 14 passes');
    stdin.write('\u001B[B'); await settle();
    stdin.write('\r'); await settle();
    expect(picked).toEqual(['app31']);
  });

  it('#4239: 235 apps render in a bounded frame with the hints and the guidance box on screen', () => {
    const lots = Array.from({ length: 235 }, (_, i) => ({ id: `app${String(i + 1).padStart(4, '0')}`, passCount: 14 }));
    const { lastFrame } = render(
      <AppPickerStage eligibleApps={lots} noApps={false} guidanceOpen={false} onGuidanceOpenChange={() => undefined} onSelect={() => undefined} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').length).toBeLessThanOrEqual(30);
    expect(frame).not.toContain('app0235');
    expect(frame).toContain('Type filter');
    expect(frame).toContain('Ctrl+G');
  });
});

describe('LLM app picker guidance per option (#4230)', () => {
  it('names the suite run of the app and marks the preselected app', () => {
    const g = llmAppGuidance({ id: 'demo-app', passCount: 14, suiteRun: { runTs: '2026-11-09T14-08-36', passCount: 14, finishedAt: '' }, applicationRunCount: 2 }, 'demo-app');
    expect(g.title).toBe('demo-app');
    expect(g.what).toContain('2026-11-09 14:08 UTC, the newest of 2 application runs');
    expect(g.sections?.map((x) => x.label)).toEqual(['Preselected', 'Next step']);
    expect(g.cli).toBe('swao assess --type llm --app demo-app');
    expect(LLM_APP_PICKER_GUIDANCE.title).toBe('Select the application');
  });
});
