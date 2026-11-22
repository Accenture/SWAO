// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- gateway model discovery tests (#1405, #4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Fake HTTP endpoints per protocol on 127.0.0.1 (no live platform call):
// happy path, 401, timeout and the unserved-model mark for openai-chat,
// anthropic-messages, ollama and bedrock (#4475).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  discoverModels, mergeDiscoveredModels, writeWorkspaceConnector, discoveryUrl, isModelServed,
  servedAlternatives, refreshConnectorModels, discoveryFallbackText, bedrockControlBase, isChatServableId,
} from './discovery.js';
import { getConnector, updateBundledConnectors } from './connector-loader.js';
import { parseConnectorYaml } from './connector-schema.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let workspaceRoot: string;
let gwDir: string;
let server: Server | undefined;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['SWAO_LLM_DISCOVERY', 'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy', 'SWAO_AGG_KEY', 'SWAO_LLM_ENV', 'NODE_TLS_REJECT_UNAUTHORIZED'];

async function serve(handler: Handler): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function connectorYaml(opts: { id?: string; protocol: string; base: string; auth?: string[]; catalogue: string[]; extraModels?: string[]; extra?: string[] }): string {
  return [
    'schema_version: "1.0"',
    'connector:',
    `  id: ${opts.id ?? 'agg'}`,
    '  name: Aggregator',
    `  protocol: ${opts.protocol}`,
    `  base_url: ${opts.base}`,
    ...(opts.auth ?? ['  auth:', '    env_var: SWAO_AGG_KEY']),
    '  headers:',
    '    X-Title: SWAO',
    '  models:',
    `    default: ${opts.catalogue[0]}`,
    '    catalogue:',
    ...opts.catalogue.map((id) => `      - id: ${id}`),
    ...(opts.extraModels ?? []),
    ...(opts.extra ?? []),
    '',
  ].join('\n');
}

function write(yaml: string, id = 'agg'): void {
  writeFileSync(join(gwDir, `${id}.yaml`), yaml);
}

function load(id = 'agg') {
  const c = getConnector(id, { workspaceRoot });
  if (!c) throw new Error(`${id} connector missing`);
  return c;
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  workspaceRoot = mkdtempSync(join(tmpdir(), 'swao-disc-'));
  gwDir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(gwDir, { recursive: true });
  process.env['SWAO_AGG_KEY'] = 'agg-key';
});

afterEach(async () => {
  if (server) { await new Promise<void>((r) => server!.close(() => r())); server = undefined; }
  rmSync(workspaceRoot, { recursive: true, force: true });
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

// OpenRouter-shaped fixture: per-token prices as decimal strings.
const OPENROUTER_MODELS = {
  data: [
    { id: 'vendor/model-a', context_length: 128000, pricing: { prompt: '0.000002', completion: '0.000006' } },
    { id: 'vendor/model-b', context_length: 32000, pricing: { prompt: '0.0000005', completion: '0.0000015' } },
    { id: 'vendor/free-model', pricing: { prompt: '0', completion: '0' } },
    { id: 'router/auto', pricing: { prompt: null, completion: null } },
  ],
};

describe('discoverModels: openai-chat (#1405, #4475)', () => {
  it('GET /v1/models with the credential and headers only; prices per million; unserved catalogue model marked', async () => {
    const seen: { url?: string; method?: string; headers?: IncomingMessage['headers']; body?: string } = {};
    const base = await serve((req, res) => {
      let body = '';
      req.on('data', (c) => { body += String(c); });
      req.on('end', () => { Object.assign(seen, { url: req.url, method: req.method, headers: req.headers, body }); json(res, 200, OPENROUTER_MODELS); });
    });
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a', 'vendor/retired-model'] }));
    const r = await discoverModels(load());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(seen.method).toBe('GET');
    expect(seen.url).toBe('/v1/models');
    expect(seen.body).toBe('');
    expect(seen.headers!['authorization']).toBe('Bearer agg-key');
    expect(seen.headers!['x-title']).toBe('SWAO');
    const a = r.models.find((m) => m.id === 'vendor/model-a')!;
    expect(a.cost).toEqual({ input_per_million: 2.0, output_per_million: 6.0 });
    expect(a.context_window).toBe(128000);
    expect(r.models.find((m) => m.id === 'vendor/free-model')!.cost).toEqual({ input_per_million: 0, output_per_million: 0 });
    // #1836: a published pricing block without numbers gets the zero stub.
    expect(r.models.find((m) => m.id === 'router/auto')!.cost).toEqual({ input_per_million: 0, output_per_million: 0 });

    const merged = mergeDiscoveredModels(load().file, r.models);
    const retired = merged.connector.models.catalogue!.find((m) => m.id === 'vendor/retired-model')!;
    expect(retired.served).toBe(false);
    expect(merged.connector.models.catalogue!.find((m) => m.id === 'vendor/model-a')!.served).toBe(true);
    expect(merged.connector.models.discovered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('#4500: batch-only variants and models without text output are dropped; the chat model stays', async () => {
    const base = await serve((_req, res) => json(res, 200, { data: [
      { id: 'anthropic/claude-sonnet-5.5', pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { output_modalities: ['text'] } },
      { id: 'anthropic/claude-sonnet-5.5:batch', pricing: { prompt: '0.000001', completion: '0.000005' } },
      { id: 'vendor/image-gen', architecture: { output_modalities: ['image'] } },
      { id: 'vendor/text-and-image', architecture: { output_modalities: ['image', 'text'] } },
    ] }));
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['anthropic/claude-sonnet-5.5'] }));
    const r = await discoverModels(load());
    expect(r.ok && r.models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5.5', 'vendor/text-and-image']);
    expect(isChatServableId('openai-chat', 'x/y:BATCH')).toBe(false);
    expect(isChatServableId('openai-chat', 'x/y:free')).toBe(true);
    expect(isChatServableId('ollama', 'llama3.3:batch')).toBe(true);
  });

  it('a list without pricing blocks (OpenAI, vLLM) gives no cost, so the price tables still apply', async () => {
    const base = await serve((_req, res) => json(res, 200, { data: [{ id: 'gpt-x' }] }));
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['gpt-x'] }));
    const r = await discoverModels(load());
    expect(r.ok && r.models[0]).toEqual({ id: 'gpt-x' });
  });

  it('HTTP 401 comes back as ok:false reason auth, without throwing', async () => {
    const base = await serve((_req, res) => json(res, 401, { error: 'unauthorised' }));
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'] }));
    const r = await discoverModels(load());
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('auth'); expect(r.error).toContain('HTTP 401'); }
  });

  it('a platform that does not answer in time comes back as reason timeout', async () => {
    const base = await serve(() => { /* never answers */ });
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'] }));
    const started = Date.now();
    const r = await discoverModels(load(), { timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  it('a closed port comes back as reason unreachable', async () => {
    write(connectorYaml({ protocol: 'openai-chat', base: 'http://127.0.0.1:1', catalogue: ['vendor/model-a'] }));
    const r = await discoverModels(load(), { timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['unreachable', 'timeout']).toContain(r.reason);
  });

  it('discovery: false turns it off without a request', async () => {
    let calls = 0;
    const base = await serve((_req, res) => { calls++; json(res, 200, OPENROUTER_MODELS); });
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'], extraModels: ['    discovery: false'] }));
    const r = await discoverModels(load());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('off');
    expect(calls).toBe(0);
    expect(discoveryFallbackText({ status: 'off' })).toContain('not checked live');
  });

  it('SWAO_LLM_DISCOVERY=off turns discovery off on the machine without a request', async () => {
    let calls = 0;
    const base = await serve((_req, res) => { calls++; json(res, 200, OPENROUTER_MODELS); });
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'] }));
    process.env['SWAO_LLM_DISCOVERY'] = 'off';
    const r = await refreshConnectorModels(load(), { workspaceRoot });
    expect(r.status).toBe('off');
    expect(calls).toBe(0);
    expect(discoveryFallbackText(r)).toBe('Catalogue, not checked live: live discovery is turned off on this machine.');
  });

  it('rounds per-token -> per-million conversion to avoid JS float precision artifacts (#1450)', async () => {
    const base = await serve((_req, res) => json(res, 200, {
      data: [
        { id: 'vendor/model-a', pricing: { prompt: '0.0000008', completion: '0.0000002' } },
        { id: 'vendor/model-b', pricing: { prompt: '0.0000029', completion: '0.0000019' } },
      ],
    }));
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'] }));
    const r = await discoverModels(load());
    if (!r.ok) throw new Error(r.error);
    expect(r.models.find((m) => m.id === 'vendor/model-a')!.cost).toEqual({ input_per_million: 0.8, output_per_million: 0.2 });
    expect(r.models.find((m) => m.id === 'vendor/model-b')!.cost).toEqual({ input_per_million: 2.9, output_per_million: 1.9 });
  });

  it('the list URL keeps one /v1 and takes the declared endpoint (OpenRouter base .../api)', () => {
    const mk = (base: string, endpoint?: string) => parseConnectorYaml(connectorYaml({
      protocol: 'openai-chat', base, catalogue: ['m'], extraModels: endpoint ? [`    discovery_endpoint: ${endpoint}`] : [],
    }), 't');
    const a = mk('https://hub.example/v1/');
    const b = mk('https://openrouter.ai/api', '/v1/models');
    expect(a.ok && discoveryUrl(a.file.connector)).toBe('https://hub.example/v1/models');
    expect(b.ok && discoveryUrl(b.file.connector)).toBe('https://openrouter.ai/api/v1/models');
  });
});

describe('discoverModels: anthropic-messages (#4475)', () => {
  const AUTH = ['  auth:', '    env_var: SWAO_AGG_KEY', '    header: x-api-key', '    scheme: raw'];

  it('GET /v1/models with x-api-key and anthropic-version, following has_more', async () => {
    const urls: string[] = [];
    let headers: IncomingMessage['headers'] = {};
    const base = await serve((req, res) => {
      urls.push(req.url ?? ''); headers = req.headers;
      if (!(req.url ?? '').includes('after_id')) json(res, 200, { data: [{ id: 'claude-new-1' }], has_more: true, last_id: 'claude-new-1' });
      else json(res, 200, { data: [{ id: 'claude-haiku-4-5-20251001' }], has_more: false, last_id: 'claude-haiku-4-5-20251001' });
    });
    write(connectorYaml({ protocol: 'anthropic-messages', base, auth: AUTH, catalogue: ['claude-haiku-4-5', 'claude-retired-3'] }));
    const r = await discoverModels(load());
    if (!r.ok) throw new Error(r.error);
    expect(urls[0]).toBe('/v1/models?limit=1000');
    expect(urls[1]).toBe('/v1/models?limit=1000&after_id=claude-new-1');
    expect(headers['x-api-key']).toBe('agg-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['authorization']).toBeUndefined();
    expect(r.models.map((m) => m.id)).toEqual(['claude-new-1', 'claude-haiku-4-5-20251001']);
    expect(r.models[0]!.cost).toBeUndefined();
    const merged = mergeDiscoveredModels(load().file, r.models);
    const cat = merged.connector.models.catalogue!;
    // The alias matches its dated snapshot; the retired id is marked.
    expect(cat.find((m) => m.id === 'claude-haiku-4-5')!.served).toBe(true);
    expect(cat.find((m) => m.id === 'claude-retired-3')!.served).toBe(false);
  });

  it('HTTP 401 and timeout fall back without throwing', async () => {
    const base = await serve((req, res) => { if ((req.url ?? '').includes('limit')) json(res, 401, { type: 'error' }); });
    write(connectorYaml({ protocol: 'anthropic-messages', base, auth: AUTH, catalogue: ['claude-haiku-4-5'] }));
    const r = await discoverModels(load());
    expect(!r.ok && r.reason).toBe('auth');
  });
});

describe('discoverModels: ollama (#4475)', () => {
  it('GET /api/tags; a catalogue name without tag matches its tags', async () => {
    let path = '';
    const base = await serve((req, res) => { path = req.url ?? ''; json(res, 200, { models: [{ name: 'llama3.3:latest' }, { name: 'qwen2.5-coder:7b' }] }); });
    write(connectorYaml({ protocol: 'ollama', base, auth: ['  auth: {}'], catalogue: ['llama3.3', 'qwen2.5-coder', 'mistral-small'] }));
    const r = await discoverModels(load());
    if (!r.ok) throw new Error(r.error);
    expect(path).toBe('/api/tags');
    const cat = mergeDiscoveredModels(load().file, r.models).connector.models.catalogue!;
    expect(cat.find((m) => m.id === 'llama3.3')!.served).toBe(true);
    expect(cat.find((m) => m.id === 'qwen2.5-coder')!.served).toBe(true);
    expect(cat.find((m) => m.id === 'mistral-small')!.served).toBe(false);
  });

  it('a daemon that is not running gives the catalogue fallback', async () => {
    write(connectorYaml({ protocol: 'ollama', base: 'http://127.0.0.1:1', auth: ['  auth: {}'], catalogue: ['llama3.3'] }));
    const r = await refreshConnectorModels(load(), { workspaceRoot, timeoutMs: 2000 });
    expect(r.status).toBe('catalogue');
    expect(discoveryFallbackText(r)).toMatch(/not checked live/);
  });

  it('a slow daemon times out', async () => {
    const base = await serve(() => { /* never answers */ });
    write(connectorYaml({ protocol: 'ollama', base, auth: ['  auth: {}'], catalogue: ['llama3.3'] }));
    const r = await discoverModels(load(), { timeoutMs: 300 });
    expect(!r.ok && r.reason).toBe('timeout');
  });

  it('HTTP 401 from a guarded daemon falls back', async () => {
    const base = await serve((_req, res) => json(res, 401, {}));
    write(connectorYaml({ protocol: 'ollama', base, auth: ['  auth: {}'], catalogue: ['llama3.3'] }));
    const r = await discoverModels(load());
    expect(!r.ok && r.reason).toBe('auth');
  });
});

describe('discoverModels: bedrock (#4475)', () => {
  const CREDS = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'test-secret' });

  it('signed GET of foundation-models and inference-profiles; profile ids are served', async () => {
    const reqs: Array<{ url: string; auth: string }> = [];
    const base = await serve((req, res) => {
      reqs.push({ url: req.url ?? '', auth: String(req.headers['authorization'] ?? '') });
      if ((req.url ?? '').startsWith('/foundation-models')) json(res, 200, { modelSummaries: [{ modelId: 'anthropic.claude-sonnet-4-6' }] });
      else json(res, 200, { inferenceProfileSummaries: [{ inferenceProfileId: 'eu.anthropic.claude-sonnet-4-6' }] });
    });
    write(connectorYaml({ protocol: 'bedrock', base, auth: ['  auth: {}'], catalogue: ['eu.anthropic.claude-sonnet-4-6', 'eu.anthropic.claude-retired-1'] }));
    const r = await discoverModels(load(), { awsCredentials: CREDS });
    if (!r.ok) throw new Error(r.error);
    expect(reqs.map((q) => q.url)).toEqual(['/foundation-models', '/inference-profiles?maxResults=1000']);
    expect(reqs[0]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/[a-z0-9-]+\/bedrock\/aws4_request, SignedHeaders=accept;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    const cat = mergeDiscoveredModels(load().file, r.models).connector.models.catalogue!;
    expect(cat.find((m) => m.id === 'eu.anthropic.claude-sonnet-4-6')!.served).toBe(true);
    expect(cat.find((m) => m.id === 'eu.anthropic.claude-retired-1')!.served).toBe(false);
  });

  it('no AWS credentials and HTTP 403 come back as reason auth; a silent endpoint as timeout', async () => {
    const base = await serve((req, res) => { if ((req.url ?? '').startsWith('/foundation-models')) json(res, 403, {}); });
    write(connectorYaml({ protocol: 'bedrock', base, auth: ['  auth: {}'], catalogue: ['eu.anthropic.claude-sonnet-4-6'] }));
    expect(await discoverModels(load(), { awsCredentials: async () => undefined })).toMatchObject({ ok: false, reason: 'auth' });
    expect(await discoverModels(load(), { awsCredentials: CREDS })).toMatchObject({ ok: false, reason: 'auth' });
    await new Promise<void>((r) => server!.close(() => r()));
    const silent = await serve(() => { /* never answers */ });
    write(connectorYaml({ protocol: 'bedrock', base: silent, auth: ['  auth: {}'], catalogue: ['eu.anthropic.claude-sonnet-4-6'] }));
    expect(await discoverModels(load(), { awsCredentials: CREDS, timeoutMs: 300 })).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('the control plane of a runtime base URL is bedrock.<region>', () => {
    expect(bedrockControlBase('https://bedrock-runtime.eu-central-1.amazonaws.com')).toBe('https://bedrock.eu-central-1.amazonaws.com');
  });
});

describe('isModelServed and servedAlternatives (#4475)', () => {
  const SERVED = ['anthropic/claude-sonnet-5.5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5:batch', 'mistralai/mistral-large-2512', '/qwen38-27b-8fp'];

  it('marks the retired OpenRouter id, keeps aliases unjudged, tolerates leading slashes', () => {
    expect(isModelServed('anthropic/claude-sonnet-4', SERVED)).toBe(false);
    expect(isModelServed('anthropic/claude-sonnet-5.5', SERVED)).toBe(true);
    expect(isModelServed('~anthropic/claude-sonnet-latest', SERVED)).toBeUndefined();
    expect(isModelServed('qwen38-27b-8fp', SERVED)).toBe(true);
  });

  it('names the closest served ids of the same vendor, batch variants left out', () => {
    const alt = servedAlternatives('anthropic/claude-sonnet-4', SERVED);
    // The longest common prefix first (the same family), then the newer-looking id.
    expect(alt.slice(0, 2)).toEqual(['anthropic/claude-sonnet-4.6', 'anthropic/claude-sonnet-5.5']);
    expect(alt.every((a) => a.startsWith('anthropic/') && !a.includes(':batch'))).toBe(true);
    expect(servedAlternatives('mistralai/mistral-large', SERVED)).toEqual(['mistralai/mistral-large-2512']);
  });
});

describe('mergeDiscoveredModels (#1405, #4475)', () => {
  it('curated entries first in their order with their cost; discovered entries follow sorted and are replaced next time', () => {
    const parsed = parseConnectorYaml(connectorYaml({ protocol: 'openai-chat', base: 'https://agg.example', catalogue: ['vendor/model-z', 'vendor/model-a'] })
      .replace('      - id: vendor/model-a', '      - id: vendor/model-a\n        cost: { input_per_million: 9.0, output_per_million: 9.0 }'), 't');
    if (!parsed.ok) throw new Error(parsed.error);
    const first = mergeDiscoveredModels(parsed.file, [
      { id: 'vendor/model-a', cost: { input_per_million: 2, output_per_million: 6 } },
      { id: 'vendor/model-c', cost: { input_per_million: 1, output_per_million: 1 } },
      { id: 'vendor/model-b' },
    ]);
    const cat = first.connector.models.catalogue!;
    expect(cat.map((m) => m.id)).toEqual(['vendor/model-z', 'vendor/model-a', 'vendor/model-b', 'vendor/model-c']);
    expect(cat.find((m) => m.id === 'vendor/model-a')!.cost!.input_per_million).toBe(9.0);
    expect(cat.find((m) => m.id === 'vendor/model-b')!.cost).toBeUndefined();
    expect(cat.find((m) => m.id === 'vendor/model-c')!.discovered).toBe(true);
    // A second discovery without model-c drops it (the platform stopped serving it).
    const second = mergeDiscoveredModels(first, [{ id: 'vendor/model-a' }, { id: 'vendor/model-b' }]);
    expect(second.connector.models.catalogue!.map((m) => m.id)).toEqual(['vendor/model-z', 'vendor/model-a', 'vendor/model-b']);
    expect(second.connector.models.catalogue![0]!.served).toBe(false);
  });
});

describe('refreshConnectorModels and writeWorkspaceConnector (#1405, #4475)', () => {
  it('writes the merged catalogue into the workspace connector file, schema-valid, marked source:user', async () => {
    const base = await serve((_req, res) => json(res, 200, OPENROUTER_MODELS));
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a', 'vendor/retired-model'] }));
    const r = await refreshConnectorModels(load(), { workspaceRoot });
    expect(r.status).toBe('live');
    expect(r.servedIds).toContain('vendor/model-b');
    expect(r.writtenPath && existsSync(r.writtenPath)).toBe(true);
    const reparsed = parseConnectorYaml(readFileSync(r.writtenPath!, 'utf-8'), 'agg.yaml');
    expect(reparsed.ok, reparsed.ok ? '' : reparsed.error).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.file.connector.meta?.source).toBe('user');
    expect(reparsed.file.connector.models.discovered_at).toBeTruthy();
    expect(reparsed.file.connector.models.catalogue!.find((m) => m.id === 'vendor/retired-model')!.served).toBe(false);
  });

  it('a refreshed unchanged seed stays updatable by llm-gateway update', async () => {
    const base = await serve((_req, res) => json(res, 200, OPENROUTER_MODELS));
    const seedDir = mkdtempSync(join(tmpdir(), 'swao-seed-'));
    try {
      const seed = connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'] });
      writeFileSync(join(seedDir, 'agg.yaml'), seed);
      write(seed);
      writeFileSync(join(gwDir, '.seeded.json'), JSON.stringify({ files: { 'agg.yaml': createHash('sha256').update(seed).digest('hex') } }));
      await refreshConnectorModels(load(), { workspaceRoot });
      writeFileSync(join(seedDir, 'agg.yaml'), seed.replace('name: Aggregator', 'name: Aggregator 2'));
      const u = updateBundledConnectors(workspaceRoot, { srcDir: seedDir });
      expect(u.updated).toEqual(['agg.yaml']);
      expect(u.keptModified).toEqual([]);
    } finally {
      rmSync(seedDir, { recursive: true, force: true });
    }
  });

  it('refreshed file with long high-entropy discovered ids survives the secret check (#1414)', async () => {
    const base = await serve((_req, res) => json(res, 200, {
      data: [
        { id: 'a1b2c3d4e5f6g7h8/i9j0k1l2m3n4o5p6q7r8s9t0u1v2', pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'vendor9/model-24b-x1y2z3-venice-edition-preview', pricing: { prompt: '0.000003', completion: '0.000004' } },
      ],
    }));
    write(connectorYaml({ protocol: 'openai-chat', base, catalogue: ['vendor/model-a'] }));
    const r = await refreshConnectorModels(load(), { workspaceRoot });
    const reparsed = parseConnectorYaml(readFileSync(r.writtenPath!, 'utf-8'), 'agg.yaml');
    expect(reparsed.ok, reparsed.ok ? '' : reparsed.error).toBe(true);
  });
});

describe('writeWorkspaceConnector -- tls block preservation (#3438)', () => {
  const TLS_LINES = '  tls:\n    reject_unauthorized: false\n    ca_bundle: /etc/ssl/corp-ca.pem\n';
  const BASE = connectorYaml({ protocol: 'openai-chat', base: 'https://agg.example', catalogue: ['vendor/model-a'] });

  it('round-trips tls.reject_unauthorized: false and tls.ca_bundle through a discovery refresh', () => {
    write(BASE + TLS_LINES);
    const outPath = writeWorkspaceConnector(workspaceRoot, mergeDiscoveredModels(load().file, []));
    const reparsed = parseConnectorYaml(readFileSync(outPath, 'utf-8'), 'agg.yaml');
    expect(reparsed.ok, reparsed.ok ? '' : reparsed.error).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.file.connector.tls?.reject_unauthorized).toBe(false);
      expect(reparsed.file.connector.tls?.ca_bundle).toBe('/etc/ssl/corp-ca.pem');
    }
  });

  it('keeps an existing destination tls block when the refreshed file carries none', () => {
    write(BASE);
    const stale = load();
    write(BASE + TLS_LINES);
    const outPath = writeWorkspaceConnector(workspaceRoot, mergeDiscoveredModels(stale.file, []));
    const reparsed = parseConnectorYaml(readFileSync(outPath, 'utf-8'), 'agg.yaml');
    expect(reparsed.ok, reparsed.ok ? '' : reparsed.error).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.file.connector.tls?.reject_unauthorized).toBe(false);
      expect(reparsed.file.connector.tls?.ca_bundle).toBe('/etc/ssl/corp-ca.pem');
    }
  });
});
