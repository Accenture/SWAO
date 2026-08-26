// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * renderModeALlm unit tests -- Design 092 s8, L5 (#1428).
 *
 * Covers:
 *   1. renderModeALlm generates a valid HTML file from a minimal fixture.
 *   2. The output contains the expected slot section IDs.
 *   3. The output path and latest-llm.html pointer are written.
 *   4. Missing run dir produces a clear error (delegates to extractor).
 *   5. Narrative section is absent when narrative is not in the publication model.
 *   6. Narrative section is present when narrative is supplied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { renderModeALlm } from './renderer.js';

const RUN_TS = '2026-08-06T10-00-00';
const APP_ID = 'test-llm-app';

function writePubModel(root: string, extra?: Record<string, unknown>): void {
  const runDir = join(root, 'llm-assessments', 'swao', RUN_TS, 'comparison');
  mkdirSync(runDir, { recursive: true });
  const model = {
    schema_version: '1.0',
    kind: 'swao',
    app_id: APP_ID,
    created: '2026-08-06T10:00:00.000Z',
    analysis_mode: 'head-to-head',
    legs: [
      { id: 'leg-a', connector: 'openai',    model: 'gpt-4o',                  primary: true },
      { id: 'leg-b', connector: 'anthropic', model: 'claude-3-5-sonnet-20241022', primary: false },
    ],
    weights: { quality: 0.3, performance: 0.25, cost: 0.15, reliability: 0.3 },
    final: {
      score: { 'leg-a': 72.5, 'leg-b': 81.3 },
      rank:  { 'leg-a': 2,    'leg-b': 1 },
      weights: { quality: 0.3, performance: 0.25, cost: 0.15, reliability: 0.3 },
    },
    groups: [
      { group: 'performance', score: { 'leg-a': 65.0, 'leg-b': 78.0 }, rank: { 'leg-a': 2, 'leg-b': 1 }, light: { 'leg-a': 'warn', 'leg-b': 'ok' } },
    ],
    passGroups: [],
    bucketViews: [],
    findings: [
      { id: 'F-1', severity: 'warn', type: 'cost-unavailable', message: 'leg-a has no price row' },
    ],
    ...extra,
  };
  writeFileSync(join(runDir, 'publication-model.json'), JSON.stringify(model, null, 2), 'utf-8');
  writeFileSync(join(root, 'llm-assessments', 'swao', 'latest.txt'), RUN_TS + '\n', 'utf-8');
}

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-llm-renderer-'));
  writePubModel(tmpRoot);
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('renderModeALlm (#1428, Design 092 s8)', () => {
  it('writes an HTML file to apps/<id>/wsp/publications/', async () => {
    const result = await renderModeALlm({
      workspace: tmpRoot,
      appId: APP_ID,
      runTs: RUN_TS,
      swaoVersion: 'test',
    });
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.outputPath.endsWith('.html')).toBe(true);
    expect(result.bytes).toBeGreaterThan(1000);
  }, 20000);

  it('writes a latest-llm.html pointer file', async () => {
    await renderModeALlm({ workspace: tmpRoot, appId: APP_ID, runTs: RUN_TS });
    const pointer = join(tmpRoot, 'apps', APP_ID, 'wsp', 'publications', 'latest-llm.html');
    expect(existsSync(pointer)).toBe(true);
    const content = readFileSync(pointer, 'utf-8');
    expect(content).toContain('http-equiv="refresh"');
  }, 20000);

  it('output HTML contains the 7 expected section IDs', async () => {
    const result = await renderModeALlm({ workspace: tmpRoot, appId: APP_ID, runTs: RUN_TS });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('id="llm-header"');
    expect(html).toContain('id="llm-final-ranking"');
    expect(html).toContain('id="llm-group-breakdown"');
    expect(html).toContain('id="llm-pass-table"');
    expect(html).toContain('id="llm-findings"');
    expect(html).toContain('id="llm-methodology"');
  }, 20000);

  it('output HTML contains leg IDs in the header section', async () => {
    const result = await renderModeALlm({ workspace: tmpRoot, appId: APP_ID, runTs: RUN_TS });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('leg-a');
    expect(html).toContain('leg-b');
  }, 20000);

  it('output HTML contains finding severity badge', async () => {
    const result = await renderModeALlm({ workspace: tmpRoot, appId: APP_ID, runTs: RUN_TS });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('cost-unavailable');
  }, 20000);

  it('narrative section is absent when narrative not in model', async () => {
    const result = await renderModeALlm({ workspace: tmpRoot, appId: APP_ID, runTs: RUN_TS });
    const html = readFileSync(result.outputPath, 'utf-8');
    // renderLlmNarrative returns '' when narrative is absent
    expect(html).not.toContain('id="llm-narrative"');
  }, 20000);

  it('narrative section is present when narrative is in the model', async () => {
    const narrativeRoot = mkdtempSync(join(tmpdir(), 'swao-llm-narrative-'));
    try {
      writePubModel(narrativeRoot, { narrative: 'GPT-4o dominated on latency; Claude led on quality.' });
      const result = await renderModeALlm({ workspace: narrativeRoot, appId: APP_ID, runTs: RUN_TS });
      const html = readFileSync(result.outputPath, 'utf-8');
      expect(html).toContain('id="llm-narrative"');
      expect(html).toContain('GPT-4o dominated on latency');
    } finally {
      rmSync(narrativeRoot, { recursive: true, force: true });
    }
  }, 20000);

  it('throws a clear error when no run exists', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'swao-llm-empty-'));
    try {
      await expect(renderModeALlm({ workspace: emptyRoot, appId: APP_ID })).rejects.toThrow(
        /No LLM assessment runs found/,
      );
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
