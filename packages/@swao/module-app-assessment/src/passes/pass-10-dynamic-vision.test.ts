// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassContext, CrawlResult } from '@swao/core';
import { runDynamicPass } from './pass-10-dynamic.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<PassContext> = {}): PassContext {
  return {
    appId: 'test-app',
    sourcePath: '/src',
    workspacePath: '/wsp',
    iter: 1,
    assessedAt: '2026-09-20T00:00:00.000Z',
    passesDir: undefined,
    ...overrides,
  };
}

function makeMinimalCrawl(screens: Partial<import('@swao/core').ScreenArtefact>[] = []): CrawlResult {
  return {
    targetUrl: 'https://example.com',
    screenCount: screens.length,
    screens: screens.map((s, i) => ({
      index: i,
      url: `https://example.com/page-${i}`,
      title: `Page ${i}`,
      timestamp: '2026-09-20T00:00:00.000Z',
      slug: `page-${i}`,
      screenshotJpeg: Buffer.from('fake-jpeg'),
      domSnapshot: '',
      a11yJson: null,
      networkEntries: [],
      consoleEntries: [],
      a11yViolations: 0,
      ...s,
    })),
    durationMs: 100,
    engineVersion: 'test',
  };
}

// ---------------------------------------------------------------------------
// Fixture LLM responses
// ---------------------------------------------------------------------------

const FIXTURE_PII_AND_WIDGET = JSON.stringify([
  { finding_type: 'pii_exposure', description: 'Patient name "John Doe" visible in header', severity: 'high' },
  { finding_type: 'third_party_widget', description: 'Google Analytics script tag detected in DOM', severity: 'medium' },
]);

const FIXTURE_MISSING_CONSENT = JSON.stringify([
  { finding_type: 'missing_consent', description: 'No GDPR consent banner displayed on public-facing page', severity: 'high' },
]);

const FIXTURE_EMPTY = '[]';

const FIXTURE_NON_JSON = 'I analyzed the screenshot and found no issues.';

const FIXTURE_MARKDOWN_WRAPPED = '```json\n' + JSON.stringify([
  { finding_type: 'version_leakage', description: 'API version v1.2.3 exposed in footer', severity: 'low' },
]) + '\n```';

const FIXTURE_PARTIAL_VALID = JSON.stringify([
  { finding_type: 'pii_exposure', description: 'Visible ID', severity: 'critical' },
  { /* missing required fields */ },
  { finding_type: 'missing_label', description: 'No label', severity: 'informational' },
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pass-10-dynamic vision signal emission (#2814)', () => {
  let completeVisionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    completeVisionMock = vi.fn();
  });

  it('emits DYN-VIS-<screen>-<N> signals for each finding in a valid JSON array', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_PII_AND_WIDGET);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(2);
    expect(visSignals[0].id).toBe('DYN-VIS-0-1');
    expect(visSignals[0].severity).toBe('high');
    expect(visSignals[0].category).toBe('application');
    expect(visSignals[1].id).toBe('DYN-VIS-0-2');
    expect(visSignals[1].severity).toBe('medium');
    expect(visSignals[1].category).toBe('application');
  });

  it('emits missing_consent finding with data_residency category', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_MISSING_CONSENT);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(1);
    expect(visSignals[0].category).toBe('application');
    expect(visSignals[0].severity).toBe('high');
  });

  it('emits zero DYN-VIS signals when LLM returns empty array', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_EMPTY);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(0);
    expect((result.assessment as Record<string, unknown>)['vision_screens_analysed']).toBe(1);
  });

  it('emits zero DYN-VIS signals when LLM returns non-JSON prose', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_NON_JSON);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(0);
  });

  it('handles markdown-wrapped JSON (strips code fences)', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_MARKDOWN_WRAPPED);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(1);
    expect(visSignals[0].severity).toBe('low');
  });

  it('skips malformed findings but emits valid ones from the same response', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_PARTIAL_VALID);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(2);
    expect(visSignals[0].id).toBe('DYN-VIS-0-1');
    expect(visSignals[1].id).toBe('DYN-VIS-0-2');
  });

  it('emits signals for each screen independently with correct indices', async () => {
    completeVisionMock
      .mockResolvedValueOnce(JSON.stringify([{ finding_type: 'pii_exposure', description: 'PII on screen 0', severity: 'high' }]))
      .mockResolvedValueOnce('[]')
      .mockResolvedValueOnce(JSON.stringify([{ finding_type: 'missing_consent', description: 'No consent on screen 2', severity: 'medium' }]));

    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}, {}, {}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 3 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(2);
    expect(visSignals[0].id).toBe('DYN-VIS-0-1');
    expect(visSignals[1].id).toBe('DYN-VIS-2-1');
    expect((result.assessment as Record<string, unknown>)['vision_screens_analysed']).toBe(3);
    expect((result.assessment as Record<string, unknown>)['vision_signals_emitted']).toBe(2);
  });

  it('skips vision phase when no completeVision method available', async () => {
    const ctx = makeCtx({ llm: { complete: vi.fn() } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 1 });

    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(0);
    expect((result.assessment as Record<string, unknown>)['vision_screens_analysed']).toBe(0);
  });

  it('skips screens without JPEG buffer', async () => {
    completeVisionMock.mockResolvedValue(FIXTURE_PII_AND_WIDGET);
    const ctx = makeCtx({ llm: { completeVision: completeVisionMock } as unknown as PassContext['llm'] });
    const crawl = makeMinimalCrawl([{ screenshotJpeg: null as unknown as Buffer }, {}]);
    const result = await runDynamicPass(ctx, crawl, { maxScreens: 2 });

    expect(completeVisionMock).toHaveBeenCalledTimes(1);
    const visSignals = result.signals.filter(s => s.id.startsWith('DYN-VIS-'));
    expect(visSignals).toHaveLength(2);
    expect(visSignals[0].id).toBe('DYN-VIS-1-1');
  });
});
