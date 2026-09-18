// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- gateway discovery + pricing tests (#1405)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverModels, mergeDiscoveredModels, writeWorkspaceConnector } from './discovery.js';
import { getConnector } from './connector-loader.js';
import { parseConnectorYaml } from './connector-schema.js';

let workspaceRoot: string;
let gwDir: string;

const CONNECTOR = [
  'schema_version: "1.0"',
  'connector:',
  '  id: agg',
  '  name: Aggregator',
  '  protocol: openai-chat',
  '  base_url: https://agg.example',
  '  auth:',
  '    env_var: SWAO_AGG_KEY',
  '  headers:',
  '    X-Title: SWAO',
  '  models:',
  '    default: vendor/model-a',
  '    catalogue:',
  '      - id: vendor/model-a',
  '        cost: { input_per_million: 9.0, output_per_million: 9.0 }',
  '    discovery_endpoint: /v1/models',
  '',
].join('\n');

// OpenRouter-shaped fixture: per-token prices as decimal strings.
const MODELS_RESPONSE = {
  data: [
    { id: 'vendor/model-a', context_length: 128000, pricing: { prompt: '0.000002', completion: '0.000006' } },
    { id: 'vendor/model-b', context_length: 32000, pricing: { prompt: '0.0000005', completion: '0.0000015' } },
    { id: 'vendor/free-model', pricing: { prompt: '0', completion: '0' } },
  ],
};

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'swao-disc-'));
  gwDir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(gwDir, { recursive: true });
  writeFileSync(join(gwDir, 'agg.yaml'), CONNECTOR);
  process.env['SWAO_AGG_KEY'] = 'agg-key';
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env['SWAO_AGG_KEY'];
  vi.unstubAllGlobals();
});

function load() {
  const c = getConnector('agg', { workspaceRoot });
  if (!c) throw new Error('agg connector missing');
  return c;
}

describe('discoverModels (#1405)', () => {
  it('fetches the discovery endpoint with auth + headers and normalises pricing to per-million', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured.url = url; captured.init = init;
      return new Response(JSON.stringify(MODELS_RESPONSE), { status: 200 });
    });
    const r = await discoverModels(load());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.url).toBe('https://agg.example/v1/models');
    const headers = captured.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer agg-key');
    expect(headers['X-Title']).toBe('SWAO');
    const a = r.models.find(m => m.id === 'vendor/model-a')!;
    expect(a.cost).toEqual({ input_per_million: 2.0, output_per_million: 6.0 });
    expect(a.context_window).toBe(128000);
    const free = r.models.find(m => m.id === 'vendor/free-model')!;
    expect(free.cost).toEqual({ input_per_million: 0, output_per_million: 0 });
  });

  it('returns ok:false on HTTP 401 without throwing (static-only fallback)', async () => {
    vi.stubGlobal('fetch', async () => new Response('unauthorised', { status: 401 }));
    const r = await discoverModels(load());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('HTTP 401');
  });

  it('returns ok:false on timeout/network error without throwing', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('fetch failed'); });
    const r = await discoverModels(load());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('fetch failed');
  });

  it('returns ok:false when the connector has no discovery endpoint', async () => {
    writeFileSync(join(gwDir, 'agg.yaml'), CONNECTOR.replace('    discovery_endpoint: /v1/models\n', ''));
    const r = await discoverModels(load());
    expect(r.ok).toBe(false);
  });

  it('rounds per-token -> per-million conversion to avoid JS float precision artifacts (#1450)', async () => {
    // 0.0000008 * 1_000_000 = 0.7999999999999999 in binary float without rounding
    const response = {
      data: [
        { id: 'vendor/model-a', pricing: { prompt: '0.0000008', completion: '0.0000002' } },
        { id: 'vendor/model-b', pricing: { prompt: '0.0000029', completion: '0.0000019' } },
      ],
    };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response), { status: 200 }));
    const r = await discoverModels(load());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.models.find(m => m.id === 'vendor/model-a')!;
    expect(a.cost?.input_per_million).toBe(0.8);
    expect(a.cost?.output_per_million).toBe(0.2);
    const b = r.models.find(m => m.id === 'vendor/model-b')!;
    expect(b.cost?.input_per_million).toBe(2.9);
    expect(b.cost?.output_per_million).toBe(1.9);
  });
});

describe('mergeDiscoveredModels (#1405)', () => {
  it('adds new models, keeps curated cost on existing entries, sorts and dedupes', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(MODELS_RESPONSE), { status: 200 }));
    const loaded = load();
    const r = await discoverModels(loaded);
    if (!r.ok) throw new Error(r.error);
    const merged = mergeDiscoveredModels(loaded.file, r.models);
    const cat = merged.connector.models.catalogue!;
    expect(cat.map(m => m.id)).toEqual(['vendor/free-model', 'vendor/model-a', 'vendor/model-b']);
    // Curated cost (9.0) wins over the discovered price for model-a.
    expect(cat.find(m => m.id === 'vendor/model-a')!.cost!.input_per_million).toBe(9.0);
    // Discovered model carries its normalised pricing.
    expect(cat.find(m => m.id === 'vendor/model-b')!.cost!.output_per_million).toBeCloseTo(1.5, 6);
    expect(merged.connector.meta?.fetched_at).toBeTruthy();
  });
});

describe('writeWorkspaceConnector (#1405)', () => {
  it('writes a schema-valid workspace override marked source:user', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(MODELS_RESPONSE), { status: 200 }));
    const loaded = load();
    const r = await discoverModels(loaded);
    if (!r.ok) throw new Error(r.error);
    const merged = mergeDiscoveredModels(loaded.file, r.models);
    const outPath = writeWorkspaceConnector(workspaceRoot, merged);
    expect(existsSync(outPath)).toBe(true);
    const reparsed = parseConnectorYaml(readFileSync(outPath, 'utf-8'), 'agg.yaml');
    expect(reparsed.ok, reparsed.ok ? '' : reparsed.error).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.file.connector.meta?.source).toBe('user');
      expect(reparsed.file.connector.models.catalogue).toHaveLength(3);
    }
  });

  it('refreshed file with long high-entropy discovered ids survives the secret check (#1414)', async () => {
    // End-to-end regression for the QA failure: discovery wrote 340 real
    // ids and the loader refused its own output. Property-shaped fixture
    // (no real model names -- catalogues change weekly): worst-case ids
    // are long, digit-mixed, slash-separated.
    const response = {
      data: [
        { id: 'a1b2c3d4e5f6g7h8/i9j0k1l2m3n4o5p6q7r8s9t0u1v2', pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'vendor9/model-24b-x1y2z3-venice-edition-preview', pricing: { prompt: '0.000003', completion: '0.000004' } },
      ],
    };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response), { status: 200 }));
    const loaded = load();
    const r = await discoverModels(loaded);
    if (!r.ok) throw new Error(r.error);
    const outPath = writeWorkspaceConnector(workspaceRoot, mergeDiscoveredModels(loaded.file, r.models));
    const reparsed = parseConnectorYaml(readFileSync(outPath, 'utf-8'), 'agg.yaml');
    expect(reparsed.ok, reparsed.ok ? '' : reparsed.error).toBe(true);
  });
});
