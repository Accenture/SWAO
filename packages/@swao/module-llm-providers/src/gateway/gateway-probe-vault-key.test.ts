// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4114: the health-check LLM gateway probe skipped the live ping whenever the
// connector's env var was not set and called a stored vault key "may be expired",
// seconds after the setup wizard had pinged successfully with that key. A static
// API key in the vault is now used for the ping; the expiry hint stays for
// session-token connectors only. The vault is mocked; the endpoint is a local
// HTTP server that accepts only the vault key.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VAULT: Record<string, string> = {};

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  class MockCredentialStore {
    loadSync(): Record<string, string> { return { ...VAULT }; }
  }
  return { ...actual, CredentialStore: MockCredentialStore };
});

const { buildLlmGatewayProbe, isSessionTokenConnector } = await import('./gateway-probe.js');

const STATIC_KEY = 'vault-static-key-4114-do-not-print';
let server: Server;
let baseUrl = '';
let lastAuth: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastAuth = req.headers['authorization'];
    req.resume();
    req.on('end', () => {
      if (lastAuth !== `Bearer ${STATIC_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

let dir: string;
const saved = { connector: process.env['SWAO_LLM_CONNECTOR'], model: process.env['SWAO_LLM_MODEL'], key: process.env['SWAO_TEST_4114_KEY'] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-gwprobe-4114-'));
  delete process.env['SWAO_LLM_CONNECTOR'];
  delete process.env['SWAO_LLM_MODEL'];
  delete process.env['SWAO_TEST_4114_KEY'];
  for (const k of Object.keys(VAULT)) delete VAULT[k];
  lastAuth = undefined;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [env, v] of [['SWAO_LLM_CONNECTOR', saved.connector], ['SWAO_LLM_MODEL', saved.model], ['SWAO_TEST_4114_KEY', saved.key]] as const) {
    if (v === undefined) delete process.env[env]; else process.env[env] = v;
  }
});

function workspace(extraAuth: string[] = []): void {
  writeFileSync(join(dir, '.swao.yml'), [
    'providers:',
    '  llm:',
    '    primary:',
    '      connector: local-4114',
    '      model: test-model',
  ].join('\n'), 'utf-8');
  const gwDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(gwDir, { recursive: true });
  writeFileSync(join(gwDir, 'local-4114.yaml'), [
    'schema_version: "1.0"',
    'connector:',
    '  id: local-4114',
    '  name: Local test endpoint',
    '  protocol: openai-chat',
    `  base_url: ${baseUrl}`,
    '  path_prefix: ""',
    '  auth:',
    '    credential_key: local-4114-api-key',
    '    env_var: SWAO_TEST_4114_KEY',
    '    header: Authorization',
    '    scheme: bearer',
    ...extraAuth,
    '  models:',
    '    default: test-model',
    '  meta:',
    '    source: user',
  ].join('\n'), 'utf-8');
}

describe('LLM gateway probe with a vault API key (#4114)', () => {
  it('pings with a static API key from the vault when the env var is not set, and passes', async () => {
    workspace();
    VAULT['local-4114-api-key'] = STATIC_KEY;
    const r = await buildLlmGatewayProbe(dir);
    expect(lastAuth).toBe(`Bearer ${STATIC_KEY}`);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('live ping OK');
    expect(r.message).not.toContain('may be expired');
    expect(r.message).not.toContain(STATIC_KEY);
  }, 30_000);

  it('reports the HTTP error when the endpoint rejects the vault key', async () => {
    workspace();
    VAULT['local-4114-api-key'] = 'a-wrong-static-key';
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/authentication failed/);
    expect(r.message).toContain('local-4114-api-key'); // key name only
    expect(r.message).not.toContain('a-wrong-static-key');
  }, 60_000);

  it('a session-token connector keeps the skip with the "may be expired" hint and does not ping', async () => {
    workspace(['    token_ttl_s: 3600']);
    VAULT['local-4114-api-key'] = STATIC_KEY;
    const r = await buildLlmGatewayProbe(dir);
    expect(lastAuth).toBeUndefined();
    expect(r.ok).toBeNull();
    expect(r.message).toContain('may be expired');
    expect(r.message).toContain('session setup');
    expect(r.message).not.toContain(STATIC_KEY);
  });

  it('a static connector with no env var and no vault entry skips without the expiry hint', async () => {
    workspace();
    const r = await buildLlmGatewayProbe(dir);
    expect(lastAuth).toBeUndefined();
    expect(r.ok).toBeNull();
    expect(r.message).toContain('not in the credential vault');
    expect(r.message).not.toContain('may be expired');
  });

  it('isSessionTokenConnector: token_command or token_ttl_s mark a session token', () => {
    expect(isSessionTokenConnector({ token_command: 'get-token' })).toBe(true);
    expect(isSessionTokenConnector({ token_ttl_s: 3600 })).toBe(true);
    expect(isSessionTokenConnector({})).toBe(false);
    expect(isSessionTokenConnector(undefined)).toBe(false);
  });
});
