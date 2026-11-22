// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- swao llm models tests (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The CLI twin of the model pickers: same refresh, same list rule. The
// refresh is injected (no live platform call); the end-to-end path against a
// fake HTTP endpoint runs in module-llm-providers discovery.test.ts.

import { describe, it, expect } from 'vitest';
import type { LoadedConnector, ModelRefresh } from '@swao/module-llm-providers';
import { runLlmModels, type LlmModelsDeps } from './llm.js';

const LOADED: LoadedConnector = {
  path: '/ws/wsp/inputs/llm-gateway/openrouter.yaml',
  origin: 'workspace',
  file: {
    schema_version: '1.0',
    connector: {
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai-chat', base_url: 'https://openrouter.ai/api', path_prefix: '',
      auth: { header: 'Authorization', scheme: 'bearer' },
      models: { default: 'mistralai/mistral-large', catalogue: [{ id: 'mistralai/mistral-large' }, { id: 'anthropic/claude-sonnet-4' }] },
    },
  },
};

function deps(refresh: ModelRefresh, found = true): { d: LlmModelsDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out, err,
    d: {
      findWorkspace: () => '/ws',
      getConnector: () => (found ? LOADED : undefined),
      listConnectorIds: () => ['anthropic', 'openrouter'],
      refresh: async () => refresh,
      out: (s) => { out.push(s); },
      err: (s) => { err.push(s); },
    },
  };
}

const LIVE: ModelRefresh = {
  status: 'live',
  servedIds: ['mistralai/mistral-large', 'anthropic/claude-sonnet-5.5'],
  writtenPath: '/ws/wsp/inputs/llm-gateway/openrouter.yaml',
  loaded: {
    ...LOADED,
    file: {
      ...LOADED.file,
      connector: {
        ...LOADED.file.connector,
        models: {
          default: 'mistralai/mistral-large',
          discovered_at: '2026-11-16T07:00:00.000Z',
          catalogue: [
            { id: 'mistralai/mistral-large', served: true },
            { id: 'anthropic/claude-sonnet-4', served: false },
            { id: 'anthropic/claude-sonnet-5.5', discovered: true, cost: { input_per_million: 2, output_per_million: 10 } },
          ],
        },
      },
    },
  },
};

describe('swao llm models (#4475)', () => {
  it('prints the served models read live, the merge, prices, and marks the unserved model last', async () => {
    const { d, out } = deps(LIVE);
    expect(await runLlmModels({ connector: 'openrouter' }, d)).toBe(0);
    const text = out.join('');
    expect(text).toContain('OpenRouter [openrouter]: 2 served models read live');
    expect(text).toContain('Merged into wsp/inputs/llm-gateway/openrouter.yaml');
    expect(text).toMatch(/anthropic\/claude-sonnet-5\.5\s+\$2\/M in, \$10\/M out/);
    const rows = text.trim().split('\n').slice(2);
    expect(rows[rows.length - 1]).toMatch(/anthropic\/claude-sonnet-4\s+not served/);
  });

  it('offline: the catalogue, marked not checked live, exit 0', async () => {
    const { d, out } = deps({ status: 'catalogue', reason: 'unreachable', servedIds: [], loaded: LOADED });
    expect(await runLlmModels({ connector: 'openrouter' }, d)).toBe(0);
    expect(out.join('')).toContain('Catalogue, not checked live: the platform is not reachable (offline or air-gapped).');
    expect(out.join('')).not.toContain('not served');
  });

  it('JSON names the source and the served flag per model', async () => {
    const { d, out } = deps(LIVE);
    await runLlmModels({ connector: 'openrouter', json: true }, d);
    const j = JSON.parse(out.join('')) as { source: string; models: Array<{ id: string; served: boolean | null }> };
    expect(j.source).toBe('live');
    expect(j.models.find((m) => m.id === 'anthropic/claude-sonnet-4')!.served).toBe(false);
  });

  it('an unknown connector exits 1 and names the available ones', async () => {
    const { d, err } = deps(LIVE, false);
    expect(await runLlmModels({ connector: 'nope' }, d)).toBe(1);
    expect(err.join('')).toContain("connector 'nope' not found; available: anthropic, openrouter");
  });
});
