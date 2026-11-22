// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LLM Assessment review on ConfirmPanel (#4255)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import { ReviewConfigStage, reviewConfigKeys } from './ReviewConfigStage.js';

const EST = { legs: [{ connector: 'openrouter', model: 'm-1', calls: { pass: 5, challenge: 5, 'lz-challenge': 4, source: 'suite' as const }, usd: null, basis: 'unknown' as const }], knownUsd: null, unknownLegs: 1 };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
const legs = [
  { id: 'a', connector: 'openrouter', model: 'm-1', primary: true },
  { id: 'b', connector: 'mistral', model: 'm-2', primary: false },
] as unknown as ResolvedLeg[];

describe('ReviewConfigStage (#4255)', () => {
  it('renders the confirmation as a ConfirmPanel with KeyHints and no double hyphen; Enter confirms', async () => {
    const onConfirm = vi.fn();
    const { lastFrame, stdin } = render(
      <ReviewConfigStage selectedApp={{ id: 'demo-app', passCount: 14 }} resolvedLegs={legs} estimate={EST}
        crawlAvailable includeCrawl={false} guidanceOpen={false} onGuidanceOpenChange={() => undefined} onConfirm={onConfirm} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Start the LLM Assessment');
    expect(frame).toContain('demo-app');
    expect(frame).toContain('openrouter');
    expect(frame).toContain('Tab toggle vision crawl');
    expect(frame).not.toMatch(/ -- /);
    await tick();
    stdin.write('\r');
    await tick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('names Tab only when a vision crawl is available', () => {
    expect(reviewConfigKeys(false).map((k) => k.key)).toEqual(['Enter', '←', 'Esc']);
    expect(reviewConfigKeys(true).map((k) => k.key)).toEqual(['Enter', 'Tab', '←', 'Esc']);
  });
});

describe('ReviewConfigStage names an outdated connector file (#4491)', () => {
  it('a leg connector whose unedited workspace seed is older than the packaged file is named', async () => {
    const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { createHash } = await import('node:crypto');
    const { resolveBundledConnectorsDir } = await import('@swao/module-llm-providers');
    const bundled = resolveBundledConnectorsDir();
    expect(bundled).not.toBeNull();
    const ws = mkdtempSync(join(tmpdir(), 'swao-4491-review-'));
    try {
      const gw = join(ws, 'wsp', 'inputs', 'llm-gateway');
      mkdirSync(gw, { recursive: true });
      const text = readFileSync(join(bundled!, 'anthropic.yaml'), 'utf-8');
      const old = text.split('\n').map((l) => (l.trimStart().startsWith('last_reviewed:') ? '    last_reviewed: "2026-08-05"' : l)).join('\n');
      writeFileSync(join(gw, 'anthropic.yaml'), old);
      writeFileSync(join(gw, '.seeded.json'), JSON.stringify({ files: { 'anthropic.yaml': createHash('sha256').update(old).digest('hex') } }));
      const anthropicLegs = [{ id: 'a', connector: 'anthropic', model: 'claude-haiku-5-5', primary: true }] as unknown as ResolvedLeg[];
      const { lastFrame } = render(
        <ReviewConfigStage selectedApp={{ id: 'demo-app', passCount: 14 }} resolvedLegs={anthropicLegs} estimate={EST}
          crawlAvailable={false} includeCrawl={false} guidanceOpen={false} onGuidanceOpenChange={() => undefined} onConfirm={() => undefined}
          workspacePath={ws} />,
      );
      const flat = (lastFrame() ?? '').split(/\s+/).join(' ');
      expect(flat).toContain('Connector files');
      expect(flat).toContain('anthropic.yaml is older than the packaged one');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
