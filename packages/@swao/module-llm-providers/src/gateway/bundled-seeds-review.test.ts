// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- bundled connector review gate (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4475: a bundled model list goes stale (OpenRouter stopped serving
// anthropic/claude-sonnet-4 while the seed still offered it). Every bundled
// connector (meta.source: bundled) must have been reviewed within the last 90
// days, and must declare live discovery (discovery_endpoint or discovery) or
// turn it off explicitly (discovery: false). Refresh the catalogue against the
// platform's served list and bump meta.last_reviewed when this fails.

import { describe, it, expect } from 'vitest';
import { listConnectors, resolveBundledConnectorsDir } from '../index.js';

const MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;

describe('bundled LLM gateway seeds are reviewed and declare discovery (#4475)', () => {
  const dir = resolveBundledConnectorsDir();
  const bundled = listConnectors(dir ? { overrideDir: dir } : {}).connectors
    .filter((c) => c.file.connector.meta?.source === 'bundled');

  it('finds the bundled seeds', () => {
    expect(bundled.length).toBeGreaterThanOrEqual(7);
  });

  it(`flags a bundled last_reviewed older than ${MAX_AGE_DAYS} days`, () => {
    const now = Date.now();
    const stale = bundled
      .map((c) => ({ id: c.file.connector.id, reviewed: c.file.connector.meta?.last_reviewed ?? '' }))
      .filter(({ reviewed }) => {
        const t = Date.parse(`${reviewed}T00:00:00Z`);
        return !Number.isFinite(t) || now - t > MAX_AGE_DAYS * DAY_MS;
      })
      .map(({ id, reviewed }) => `${id} (last_reviewed ${reviewed || 'missing'})`);
    expect(stale, `stale bundled catalogues: ${stale.join(', ')}`).toEqual([]);
  });

  it('every bundled connector declares discovery or discovery: false', () => {
    const undeclared = bundled
      .filter((c) => c.file.connector.models.discovery_endpoint === undefined && c.file.connector.models.discovery === undefined)
      .map((c) => c.file.connector.id);
    expect(undeclared).toEqual([]);
  });

  it('no bundled catalogue offers anthropic/claude-sonnet-4 (not served by OpenRouter since 2026-11)', () => {
    const offered = bundled.flatMap((c) => (c.file.connector.models.catalogue ?? []).map((m) => `${c.file.connector.id}:${m.id}`));
    expect(offered).not.toContain('openrouter:anthropic/claude-sonnet-4');
  });
});
