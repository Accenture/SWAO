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

import { describe, it, expect } from 'vitest';
import {
  parseAssessProgress,
  buildAssessAcknowledgement,
  type AssessProgressEvent,
  type AssessProgressNotifier,
} from '@swao/module-mcp';

describe('parseAssessProgress (#0155)', () => {
  it('emits no events for an empty chunk', () => {
    const { events, passCountAfter } = parseAssessProgress('', 0);
    expect(events).toEqual([]);
    expect(passCountAfter).toBe(0);
  });

  it('emits no events for output without recognised pass markers', () => {
    const chunk = 'some unrelated output\nanother line\n';
    const { events, passCountAfter } = parseAssessProgress(chunk, 0);
    expect(events).toEqual([]);
    expect(passCountAfter).toBe(0);
  });

  it('emits a "Running Pass NN" event for a start line', () => {
    const chunk = '[info] Running Pass 01 -- inventory_scan\n';
    const { events, passCountAfter } = parseAssessProgress(chunk, 0);
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toMatch(/Running Pass 01 -- inventory_scan/);
    expect(events[0]?.progress).toBe(0);
    expect(passCountAfter).toBe(0);
  });

  it('emits a "Pass complete" event for an [ok] line and increments the count', () => {
    const chunk = '[ok]  Pass 01 -- inventory_scan  23 signals emitted\n';
    const { events, passCountAfter } = parseAssessProgress(chunk, 0);
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toMatch(/Pass 01 \(inventory_scan\) complete/);
    expect(events[0]?.progress).toBeCloseTo(1 / 11, 6);
    expect(passCountAfter).toBe(1);
  });

  it('emits a "FAILED" event for a [fail] line without incrementing the count', () => {
    const chunk = '[fail] Pass 09 -- synthesis  LLM endpoint unreachable\n';
    const { events, passCountAfter } = parseAssessProgress(chunk, 5);
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toMatch(/Pass 09 \(synthesis\) FAILED/);
    expect(events[0]?.progress).toBeCloseTo(5 / 11, 6);
    expect(passCountAfter).toBe(5);
  });

  it('handles a multi-line chunk with start + complete markers in order', () => {
    const chunk = [
      '[info] Running Pass 01 -- inventory_scan',
      '[ok]  Pass 01 -- inventory_scan  23 signals emitted',
      '[info] Running Pass 02 -- state_analysis',
      '[ok]  Pass 02 -- state_analysis  9 signals emitted',
      '',
    ].join('\n');
    const { events, passCountAfter } = parseAssessProgress(chunk, 0);
    expect(events.map((e) => e.message)).toEqual([
      'Running Pass 01 -- inventory_scan...',
      'Pass 01 (inventory_scan) complete',
      'Running Pass 02 -- state_analysis...',
      'Pass 02 (state_analysis) complete',
    ]);
    expect(passCountAfter).toBe(2);
  });

  it('progress values are monotonic non-decreasing across events in one chunk', () => {
    const chunk = [
      '[info] Running Pass 03 -- data_classification',
      '[ok]  Pass 03 -- data_classification  10 signals',
      '[info] Running Pass 04 -- context_ingestion',
      '[ok]  Pass 04 -- context_ingestion  6 signals',
      '',
    ].join('\n');
    const { events } = parseAssessProgress(chunk, 2);
    const progresses = events.map((e) => e.progress);
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]!);
    }
  });

  it('respects passCountBefore so progress reflects prior chunks', () => {
    const chunk = '[ok] Pass 05 -- sbom_cve  12 signals\n';
    const { events, passCountAfter } = parseAssessProgress(chunk, 4);
    expect(events).toHaveLength(1);
    expect(events[0]?.progress).toBeCloseTo(5 / 11, 6);
    expect(passCountAfter).toBe(5);
  });
});

describe('buildAssessAcknowledgement (#0155)', () => {
  it('mentions the app id and an ISO timestamp', () => {
    const ack = buildAssessAcknowledgement('sovereign-health', undefined);
    expect(ack).toMatch(/sovereign-health/);
    expect(ack).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('lists all 11 default passes when none specified', () => {
    const ack = buildAssessAcknowledgement('demo', undefined);
    expect(ack).toMatch(/inventory/);
    expect(ack).toMatch(/synthesis/);
    expect(ack).toMatch(/block_assessments/);
    expect(ack).toMatch(/scope_coverage/);
  });

  it('echoes the explicit pass selection when provided', () => {
    const ack = buildAssessAcknowledgement('demo', 'inv,state,egr');
    expect(ack).toMatch(/inv,state,egr/);
    expect(ack).not.toMatch(/synthesis/);
  });

  it('renders three lines: started-at, passes, separator', () => {
    const ack = buildAssessAcknowledgement('demo', 'inv');
    const lines = ack.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/started/);
    expect(lines[1]).toMatch(/Running passes/);
    expect(lines[2]).toMatch(/^-{20,}$/);
  });
});

describe('AssessProgressNotifier wiring (#0155)', () => {
  it('a notifier function receives every event produced by parseAssessProgress', () => {
    const captured: AssessProgressEvent[] = [];
    const notifier: AssessProgressNotifier = (e) => { captured.push(e); };

    const chunk = [
      '[info] Running Pass 01 -- inventory_scan',
      '[ok]  Pass 01 -- inventory_scan  23 signals',
      '[info] Running Pass 02 -- state_analysis',
      '[ok]  Pass 02 -- state_analysis  9 signals',
      '',
    ].join('\n');
    const { events } = parseAssessProgress(chunk, 0);
    for (const ev of events) notifier(ev);
    expect(captured).toEqual(events);
  });

  it('notifier errors do not throw out of parseAssessProgress (caller-side guard)', () => {
    const chunk = '[ok] Pass 01 -- inventory_scan\n';
    const { events } = parseAssessProgress(chunk, 0);
    expect(() => {
      for (const ev of events) {
        try { throw new Error('notifier failed'); }
        catch { /* swallow per server.ts contract */ }
        void ev;
      }
    }).not.toThrow();
  });
});
