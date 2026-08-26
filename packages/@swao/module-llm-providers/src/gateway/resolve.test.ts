// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- gateway resolution tests (#1397 #1398 #1399)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProviderFromConnector } from './resolve.js';
import { getConnector } from './connector-loader.js';
import { createLlmProvider } from '../factory.js';

let workspaceRoot: string;
let gwDir: string;

function writeConnector(name: string, lines: string[]): void {
  writeFileSync(join(gwDir, name), lines.join('\n') + '\n');
}

const BASE_LINES = [
  'schema_version: "1.0"',
  'connector:',
  '  id: test-hub',
  '  name: Test Hub',
  '  protocol: openai-chat',
  '  base_url: https://hub.example.internal',
  '  auth:',
  '    env_var: SWAO_TEST_HUB_KEY',
  '    header: X-Hub-Key',
  '    scheme: raw',
  '  headers:',
  '    X-Route: swao',
  '  models:',
  '    default: default-model',
  '    catalogue:',
  '      - id: default-model',
  '        cost: { input_per_million: 2.0, output_per_million: 4.0 }',
  '      - id: other-model',
  '  defaults:',
  '    temperature: 0',
  '    max_tokens: 4096',
  '  request_overrides:',
  '    reasoning: { enabled: true }',
  '  cost_per_token:',
  '    input_per_million: 1.0',
  '    output_per_million: 1.0',
  '  environments:',
  '    prod: {}',
  '    dev:',
  '      base_url: https://hub-dev.example.internal',
];

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'swao-gwres-'));
  gwDir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(gwDir, { recursive: true });
  process.env['SWAO_TEST_HUB_KEY'] = 'test-key-123';
  delete process.env['SWAO_LLM_ENV'];
  delete process.env['SWAO_LLM_CONNECTOR'];
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env['SWAO_TEST_HUB_KEY'];
  vi.unstubAllGlobals();
});

function load(id = 'test-hub') {
  const c = getConnector(id, { workspaceRoot });
  if (!c) throw new Error(`connector ${id} not found in test workspace`);
  return c;
}

describe('createProviderFromConnector (#1397-#1399)', () => {
  it('builds an openai-chat provider with provenance', () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    const r = createProviderFromConnector(load(), {});
    expect(r.provider.name).toBe('open-llm-provider');
    expect(r.provider.model).toBe('default-model');
    expect(r.provenance.connector_id).toBe('test-hub');
    expect(r.provenance.connector_origin).toBe('workspace');
    expect(r.provenance.base_url).toBe('https://hub.example.internal');
    expect(r.provenance.connector_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('environment overlay switches base_url (env param beats active_env)', () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    const r = createProviderFromConnector(load(), { env: 'dev' });
    expect(r.provenance.base_url).toBe('https://hub-dev.example.internal');
  });

  it('unknown environment errors with available names', () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    expect(() => createProviderFromConnector(load(), { env: 'staging' }))
      .toThrow(/environment 'staging' not defined.*prod.*dev/s);
  });

  it('sends connector headers, raw auth scheme, request_overrides, and per-model cost', async () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    const captured: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: {
          prompt_tokens: 1000, completion_tokens: 500,
          completion_tokens_details: { reasoning_tokens: 200 },
        },
      }), { status: 200 });
    });

    const r = createProviderFromConnector(load(), {});
    const out = await r.provider.complete('analyse this');
    expect(out).toBe('{"ok":true}');

    // URL: path_prefix '' disables model-path routing.
    expect(captured.url).toBe('https://hub.example.internal/v1/chat/completions');
    const headers = captured.init!.headers as Record<string, string>;
    expect(headers['X-Route']).toBe('swao');
    expect(headers['X-Hub-Key']).toBe('test-key-123'); // raw scheme, custom header
    expect(headers['Authorization']).toBeUndefined();

    const body = JSON.parse(String(captured.init!.body)) as Record<string, unknown>;
    expect(body['reasoning']).toEqual({ enabled: true });      // request_overrides merged
    expect(body['model']).toBe('default-model');               // reserved key intact
    expect(body['max_completion_tokens']).toBe(4096);          // defaults.max_tokens

    // Per-model catalogue cost beats connector cost_per_token:
    // 1000 in * 2.0 + 500 out * 4.0 per million = 0.004.
    const usage = r.provider.getLastUsage?.();
    expect(usage?.cost_usd).toBeCloseTo(0.004, 6);
  });

  it('falls back to connector-level cost for non-catalogue models (warning, not error)', async () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    const r = createProviderFromConnector(load(), { model: 'surprise-model' });
    expect(r.provenance.model).toBe('surprise-model');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    }), { status: 200 }));
    await r.provider.complete('x');
    // connector cost_per_token 1.0/1.0 -> 2.0 USD for 1M+1M
    expect(r.provider.getLastUsage?.()?.cost_usd).toBeCloseTo(2.0, 6);
  });

  it('builds an ollama provider from an ollama-protocol connector', () => {
    writeConnector('local.yaml', [
      'schema_version: "1.0"',
      'connector:',
      '  id: local',
      '  name: Local',
      '  protocol: ollama',
      '  base_url: http://localhost:11434',
      '  models:',
      '    default: llama3.3',
    ]);
    const r = createProviderFromConnector(load('local'), {});
    expect(r.provider.name).toBe('ollama');
    expect(r.provider.model).toBe('llama3.3');
  });
});

describe('createLlmProvider gateway path (#1398)', () => {
  it('resolves a connector id from config and records provenance', async () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    const { getLastGatewayProvenance } = await import('../factory.js');
    const p = createLlmProvider(undefined, undefined, { connector: 'test-hub', workspaceRoot });
    expect(p.model).toBe('default-model');
    expect(getLastGatewayProvenance()?.connector_id).toBe('test-hub');
  });

  it('unknown connector id errors naming the available connectors', () => {
    writeConnector('test-hub.yaml', BASE_LINES);
    expect(() => createLlmProvider(undefined, undefined, { connector: 'nope', workspaceRoot }))
      .toThrow(/Unknown LLM connector 'nope'.*test-hub/s);
  });

  it('legacy type path is untouched when no connector is set (backwards compat)', () => {
    // ollama needs no key; the legacy switch must behave exactly as before.
    const p = createLlmProvider(undefined, undefined, { type: 'ollama', model: 'llama3.3' });
    expect(p.name).toBe('ollama');
    expect(p.model).toBe('llama3.3');
  });
});
