// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- test call of a chosen model (#4500)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4500: checkConnectorModel resolves a ~ alias like the Health Check
// (never to a :batch variant) and calls the chosen model once; a model the
// platform rejects comes back as rejected. Fake node:http endpoint only.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkConnectorModel } from './gateway-probe.js';
import { getConnector } from './connector-loader.js';

let workspaceRoot: string;
let server: Server | undefined;
const KEYS = ['SWAO_CHECK_KEY', 'SWAO_LLM_MODEL_CHECK', 'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];
const saved: Record<string, string | undefined> = {};

async function serve(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += String(c); });
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function loadFake(base: string) {
  const dir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fake.yaml'), [
    'schema_version: "1.0"',
    'connector:',
    '  id: fake',
    '  name: Fake aggregator',
    '  protocol: openai-chat',
    `  base_url: ${base}`,
    '  auth:',
    '    env_var: SWAO_CHECK_KEY',
    '  models:',
    '    default: vendor/model-a',
    '    discovery_endpoint: /v1/models',
    '',
  ].join('\n'));
  const c = getConnector('fake', { workspaceRoot });
  if (!c) throw new Error('fake connector missing');
  return c;
}

const CHAT_OK = { id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } };

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env['SWAO_CHECK_KEY'] = 'check-key';
  workspaceRoot = mkdtempSync(join(tmpdir(), 'swao-check-'));
});

afterEach(async () => {
  if (server) { await new Promise<void>((r) => server!.close(() => r())); server = undefined; }
  rmSync(workspaceRoot, { recursive: true, force: true });
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('checkConnectorModel (#4500)', () => {
  it('resolves ~anthropic/claude-sonnet-latest to the chat model, not the :batch variant, and calls it', async () => {
    const called: string[] = [];
    const base = await serve((req, body, res) => {
      if (req.method === 'GET') {
        json(res, 200, { data: [{ id: 'anthropic/claude-sonnet-5.5' }, { id: 'anthropic/claude-sonnet-5.5:batch' }] });
        return;
      }
      called.push((JSON.parse(body) as { model: string }).model);
      json(res, 200, CHAT_OK);
    });
    const r = await checkConnectorModel(loadFake(base), '~anthropic/claude-sonnet-latest');
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.model).toBe('anthropic/claude-sonnet-5.5');
    expect(called).toEqual(['anthropic/claude-sonnet-5.5']);
  });

  it('a model the platform rejects (HTTP 404) comes back as rejected', async () => {
    const base = await serve((_req, _body, res) => json(res, 404, { error: { message: 'anthropic/claude-sonnet-5.5:batch cannot be used with the chat/completions endpoint', code: 404 } }));
    const r = await checkConnectorModel(loadFake(base), 'anthropic/claude-sonnet-5.5:batch');
    expect(r.status).toBe('fail');
    if (r.status !== 'fail') return;
    expect(r.rejected).toBe(true);
    expect(r.message).toContain("model 'anthropic/claude-sonnet-5.5:batch' rejected by the platform");
  });

  it('no stored key: skipped (the Credentials step tests it); SWAO_LLM_MODEL_CHECK=off: skipped without a request', async () => {
    let requests = 0;
    const base = await serve((_req, _body, res) => { requests++; json(res, 200, CHAT_OK); });
    const loaded = loadFake(base);
    delete process.env['SWAO_CHECK_KEY'];
    expect(await checkConnectorModel(loaded, 'vendor/model-a')).toEqual({ status: 'skipped', reason: 'no-key' });
    process.env['SWAO_CHECK_KEY'] = 'check-key';
    process.env['SWAO_LLM_MODEL_CHECK'] = 'off';
    expect(await checkConnectorModel(loaded, 'vendor/model-a')).toEqual({ status: 'skipped', reason: 'off' });
    expect(requests).toBe(0);
  });
});
