// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- gateway probe tests (#1402, #1410)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLlmGatewayProbe, classifyPingFailure } from './gateway-probe.js';

// #4292: per-test overrides of the connector discovery; undefined = the real function.
const loaderOverride = vi.hoisted(() => ({
  bundledDir: undefined as string | null | undefined,
  noConnectors: false,
}));
vi.mock('./connector-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./connector-loader.js')>();
  return {
    ...actual,
    resolveBundledConnectorsDir: () => (loaderOverride.bundledDir === undefined ? actual.resolveBundledConnectorsDir() : loaderOverride.bundledDir),
    listConnectors: (...args: Parameters<typeof actual.listConnectors>) =>
      (loaderOverride.noConnectors ? { connectors: [], warnings: [] } : actual.listConnectors(...args)),
  };
});

describe('classifyPingFailure (#1410)', () => {
  const opts = { credentialKey: 'openrouter-api-key', model: 'deepseek/deepseek-v4-flash' };

  it('maps 402 onto the no-credits hint', () => {
    expect(classifyPingFailure('HTTP 402 Payment Required', opts)).toContain('no credits');
    expect(classifyPingFailure('HTTP 402 Payment Required', opts)).toContain('openrouter-api-key');
  });

  it('maps 401/403 onto the authentication hint without echoing any value', () => {
    const msg = classifyPingFailure('HTTP 401 Unauthorized: invalid api key sk-or-v1-SHOULD-NOT-APPEAR', opts);
    expect(msg).toContain('authentication failed');
    expect(msg).toContain('openrouter-api-key');
  });

  it('maps model-not-found onto the model hint with the configured id', () => {
    const msg = classifyPingFailure('HTTP 404: model not found', opts);
    expect(msg).toContain("model 'deepseek/deepseek-v4-flash'");
  });

  it('maps OpenRouter 404 "No endpoints found" onto the model hint, not auth (#1816)', () => {
    // OpenRouter body: {"error":{"message":"No endpoints found for ~google/gemini-flash-latest.","code":404}}
    const raw = 'open-llm-provider request failed: 404 {"error":{"message":"No endpoints found for ~google/gemini-flash-latest. Please authenticate to see more endpoints.","code":404}}';
    const msg = classifyPingFailure(raw, opts);
    expect(msg).toContain("model 'deepseek/deepseek-v4-flash'");
    expect(msg).not.toContain('authentication failed');
  });

  it('maps timeouts and connection refusals onto reachability hints', () => {
    expect(classifyPingFailure('live ping timed out after 20000ms', opts)).toContain('endpoint unreachable or overloaded');
    expect(classifyPingFailure('fetch failed: ECONNREFUSED 127.0.0.1:11434', opts)).toContain('endpoint unreachable');
  });

  // #2897: ADFS JWT expiry -- distinct from wrong API key; re-login is the fix.
  it('maps "Jwt is expired" onto the token-expired hint, not the generic auth hint', () => {
    const msg = classifyPingFailure('HTTP 401 Unauthorized: Jwt is expired', opts);
    expect(msg).toContain('token expired');
    expect(msg).toContain('swao session setup');
    expect(msg).not.toContain('API key missing');
  });

  it('maps "token is expired" onto the token-expired hint (case-insensitive)', () => {
    const msg = classifyPingFailure('HTTP 401: Token is expired, please re-authenticate', opts);
    expect(msg).toContain('token expired');
  });

  it('falls back to the raw message when unclassified', () => {
    expect(classifyPingFailure('weird driver explosion', opts)).toBe('weird driver explosion');
  });

  // AWS SDK exception names (#2160) -- Bedrock throws named exceptions, not HTTP codes
  const bedrockOpts = { model: 'eu.anthropic.claude-sonnet-4-6' };

  it('maps AccessDeniedException onto IAM/credential hint', () => {
    const msg = classifyPingFailure('AccessDeniedException: User is not authorized to perform bedrock:InvokeModel', bedrockOpts);
    expect(msg).toContain('AWS credentials rejected');
    expect(msg).toContain('IAM bedrock:InvokeModel');
  });

  it('maps UnrecognizedClientException onto IAM/credential hint', () => {
    const msg = classifyPingFailure('UnrecognizedClientException: The security token included in the request is invalid.', bedrockOpts);
    expect(msg).toContain('AWS credentials rejected');
  });

  it('maps ValidationException onto model/region hint', () => {
    const msg = classifyPingFailure('ValidationException: The model ID provided is invalid.', bedrockOpts);
    expect(msg).toContain("model 'eu.anthropic.claude-sonnet-4-6'");
    expect(msg).toContain('region');
  });

  it('maps ResourceNotFoundException onto model/region hint', () => {
    const msg = classifyPingFailure('ResourceNotFoundException: Could not find model eu.anthropic.claude-sonnet-4-6', bedrockOpts);
    expect(msg).toContain("model 'eu.anthropic.claude-sonnet-4-6'");
  });

  it('maps ModelNotReadyException onto model-access hint', () => {
    const msg = classifyPingFailure('ModelNotReadyException: Model is not ready for inference', bedrockOpts);
    expect(msg).toContain('not enabled');
    expect(msg).toContain('Bedrock Console');
  });

  it('maps ThrottlingException onto quota hint', () => {
    const msg = classifyPingFailure('ThrottlingException: Rate exceeded', bedrockOpts);
    expect(msg).toContain('throttling');
    expect(msg).toContain('Bedrock Console');
  });
});

describe('buildLlmGatewayProbe active-connector resolution (#1410)', () => {
  let dir: string;
  const savedConnector = process.env['SWAO_LLM_CONNECTOR'];
  const savedModel = process.env['SWAO_LLM_MODEL'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-gwprobe-'));
    delete process.env['SWAO_LLM_CONNECTOR'];
    delete process.env['SWAO_LLM_MODEL'];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedConnector === undefined) delete process.env['SWAO_LLM_CONNECTOR'];
    else process.env['SWAO_LLM_CONNECTOR'] = savedConnector;
    if (savedModel === undefined) delete process.env['SWAO_LLM_MODEL'];
    else process.env['SWAO_LLM_MODEL'] = savedModel;
  });

  it('warns (ok null, not a failure) when no LLM is configured (#3375)', async () => {
    // #3388: a real workspace (.swao.yml present) so the probe seeds + discovers
    // connectors; with no providers.llm it reports "no LLM configured".
    writeFileSync(join(dir, '.swao.yml'), 'workspace:\n  name: test\n');
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBeNull();
    expect(r.message).toMatch(/^\[WARNING\] no LLM configured; LLM passes will be skipped/);
  });

  it('stays discovery-only when a legacy provider slot without connector is configured (#3375)', async () => {
    writeFileSync(join(dir, '.swao.yml'), [
      'providers:',
      '  llm:',
      '    primary:',
      '      provider: anthropic',
      '      model: claude-sonnet-4-6',
      '',
    ].join('\n'), 'utf-8');
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('discovery-only');
  });

  it('warns when the active connector does not exist', async () => {
    // #3388: a real workspace so the probe seeds + discovers connectors before
    // checking the (non-existent) active connector from the env.
    writeFileSync(join(dir, '.swao.yml'), 'workspace:\n  name: test\n');
    process.env['SWAO_LLM_CONNECTOR'] = 'no-such-platform';
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("active connector 'no-such-platform' not found");
  });

  // #2897: credential key configured in connector YAML but not loaded in the
  // credential store -- should return ok: null (SKIP) with a session-setup hint,
  // not attempt the live ping and report a misleading 401 authentication failure.
  it('returns ok: null when the connector credential key is not in the credential store', async () => {
    writeFileSync(join(dir, '.swao.yml'), [
      'providers:',
      '  llm:',
      '    primary:',
      '      connector: auth-required',
      '      model: test-model',
    ].join('\n'), 'utf-8');
    const gwDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'auth-required.yaml'), [
      'schema_version: "1.0"',
      'connector:',
      '  id: auth-required',
      '  name: Auth Required Endpoint',
      '  protocol: openai-chat',
      '  base_url: https://api.example.com/v1',
      '  auth:',
      '    credential_key: missing-api-key-that-is-not-in-store',
      '  models:',
      '    default: test-model',
      '  meta:',
      '    source: user',
    ].join('\n'), 'utf-8');
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBeNull();
    expect(r.message).toContain('[N/A]');
    expect(r.message).toContain('missing-api-key-that-is-not-in-store');
    expect(r.message).toContain('swao session setup');
  });

  // #2897: connector has env_var configured (ADFS/token-based auth); env var absent in this
  // terminal -> ok: null + hint to run session-setup, NOT a live ping that would give a
  // misleading 401 from an expired vault token.
  it('returns ok: null with env-var hint when env_var connector is missing from process.env (#2897)', async () => {
    writeFileSync(join(dir, '.swao.yml'), [
      'providers:',
      '  llm:',
      '    primary:',
      '      connector: corp-genai-preprod',
      '      model: /Llama-3.3-70B',
    ].join('\n'), 'utf-8');
    const gwDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'corp-genai-preprod.yaml'), [
      'schema_version: "1.0"',
      'connector:',
      '  id: corp-genai-preprod',
      '  name: Corporate GenAI Hub (PREPROD)',
      '  protocol: openai-chat',
      '  base_url: https://genai-hub-preprod.example.com',
      '  auth:',
      '    credential_key: openai-api-key',
      '    env_var: SWAO_OPEN_LLM_API_KEY',
      '    header: Authorization',
      '    scheme: bearer',
      '    token_ttl_s: 3600',   // #4114: a session token; static keys are pinged from the vault
      '  models:',
      '    default: /Llama-3.3-70B',
      '  meta:',
      '    source: user',
    ].join('\n'), 'utf-8');
    delete process.env['SWAO_OPEN_LLM_API_KEY'];
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBeNull();
    expect(r.message).toContain('[N/A]');
    expect(r.message).toContain('SWAO_OPEN_LLM_API_KEY');
    expect(r.message).toContain('session setup');
  });

  // #2894 Part A: TLS error codes in err.cause are extracted into the classifyPingFailure message.
  it('classifyPingFailure maps TLS cert error codes onto the TLS hint (#2894)', () => {
    const tlsMsg = classifyPingFailure('fetch failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE (unable to verify the first certificate)', { model: 'test-model' });
    expect(tlsMsg).toContain('TLS certificate error');
    expect(tlsMsg).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('reads the active connector from the workspace .swao.yml and reports ping failures actionably', async () => {
    // Workspace connector pointing at a dead local endpoint: the live ping
    // must fail fast with the reachability hint, not hang or throw.
    writeFileSync(join(dir, '.swao.yml'), [
      'providers:',
      '  llm:',
      '    primary:',
      '      connector: dead-local',
      '      model: test-model',
    ].join('\n'), 'utf-8');
    const gwDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'dead-local.yaml'), [
      'schema_version: "1.0"',
      'connector:',
      '  id: dead-local',
      '  name: Dead Local Endpoint',
      '  protocol: openai-chat',
      '  base_url: http://127.0.0.1:9',   // port 9 (discard) -- nothing listens
      '  auth: {}',
      '  models:',
      '    default: test-model',
      '  meta:',
      '    source: user',
    ].join('\n'), 'utf-8');
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("connector 'dead-local' live ping FAILED");
  }, 30_000);

  // #2953: on pre-Design-090 workspaces, wsp/inputs/llm-gateway/ is not seeded.
  // buildLlmGatewayProbe scaffolds the directory on first health-check run -- but
  // #3388: only inside a real workspace (a .swao.yml present).
  it('scaffolds wsp/inputs/llm-gateway/ when absent in a real workspace (#2953)', async () => {
    writeFileSync(join(dir, '.swao.yml'), 'workspace:\n  name: test\n');
    const gatewayDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
    expect(existsSync(gatewayDir)).toBe(false);
    await buildLlmGatewayProbe(dir);
    expect(existsSync(gatewayDir)).toBe(true);
    expect(existsSync(join(gatewayDir, 'README.md'))).toBe(true);
  });

  // #3388: health-check resolves its workspace from process.cwd() when no
  // --workspace is given. The gateway probe must not scaffold or seed into a
  // non-workspace directory (no .swao.yml), or it litters wherever it is run.
  it('does NOT scaffold or seed in a non-workspace directory (#3388 litter guard)', async () => {
    // `dir` has no .swao.yml.
    await buildLlmGatewayProbe(dir);
    expect(existsSync(join(dir, 'wsp'))).toBe(false);
  });
});

// #4461 (owner dev10: 3 live pings, 12.1 s): the active connectors are pinged at the same time.
describe('LLM gateway probe pings the connectors concurrently (#4461)', () => {
  let dir: string;
  const savedConnector = process.env['SWAO_LLM_CONNECTOR'];
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-gwpar-')); delete process.env['SWAO_LLM_CONNECTOR']; });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedConnector === undefined) delete process.env['SWAO_LLM_CONNECTOR'];
    else process.env['SWAO_LLM_CONNECTOR'] = savedConnector;
  });

  it('two connectors answer in about one ping time, in the order of the workspace slots', async () => {
    const { createServer } = await import('node:http');
    let inFlight = 0;
    let maxInFlight = 0;
    const server = createServer((req, res) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      req.resume();
      setTimeout(() => {
        inFlight -= 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: 'test-model', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      }, 500);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      writeFileSync(join(dir, '.swao.yml'), ['providers:', '  llm:', '    primary:', '      connector: slow-a', '      model: test-model', '    secondary:', '      connector: slow-b', '      model: test-model', ''].join(String.fromCharCode(10)), 'utf-8');
      const gwDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(gwDir, { recursive: true });
      for (const id of ['slow-a', 'slow-b']) {
        writeFileSync(join(gwDir, id + '.yaml'), ['schema_version: "1.0"', 'connector:', '  id: ' + id, '  name: Slow ' + id, '  protocol: openai-chat', '  base_url: http://127.0.0.1:' + port + '/v1', '  auth: {}', '  models:', '    default: test-model', '  meta:', '    source: user', ''].join(String.fromCharCode(10)), 'utf-8');
      }
      const r = await buildLlmGatewayProbe(dir);
      expect(r.ok).toBe(true);
      expect(r.message).toContain('2 connectors checked: primary, secondary');
      expect(maxInFlight).toBe(2);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 30_000);
});

describe('LLM gateway probe without connectors (#4292)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-gw-4292-')); });
  afterEach(() => {
    loaderOverride.bundledDir = undefined;
    loaderOverride.noConnectors = false;
    rmSync(dir, { recursive: true, force: true });
  });

  it('outside a workspace the probe is info (not a workspace), not a failure, and writes nothing', async () => {
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBeNull();
    expect(r.message).toMatch(/^\[N\/A\] not a workspace: connectors are seeded by setup/);
    expect(r.message).not.toContain('bundled seeds missing');
    expect(existsSync(join(dir, 'wsp'))).toBe(false);
    expect((await buildLlmGatewayProbe(null)).ok).toBeNull();
  });

  it('outside a workspace it stays info even when the bundled seeds are absent', async () => {
    loaderOverride.bundledDir = null;
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBeNull();
    expect(r.message).not.toContain('bundled seeds missing');
  });

  it('in a workspace the build-artefact message appears only when resolveBundledConnectorsDir() returns null', async () => {
    writeFileSync(join(dir, '.swao.yml'), 'name: demo\n');
    loaderOverride.noConnectors = true;
    loaderOverride.bundledDir = null;
    const missing = await buildLlmGatewayProbe(dir);
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('bundled seeds missing from the build');

    loaderOverride.bundledDir = join(dir, 'seeds');
    const present = await buildLlmGatewayProbe(dir);
    expect(present.ok).toBe(false);
    expect(present.message).not.toContain('bundled seeds missing');
    expect(present.message).toContain('none could be seeded');
  });

  it('no probe message carries a double hyphen separator', async () => {
    const opts = { credentialKey: 'k', model: 'm', baseUrl: 'https://api.openai.com/v1' };
    const raws = ['AccessDeniedException', 'ValidationException', 'ModelNotReadyException', 'ThrottlingException', 'HTTP 503', 'HTTP 402',
      'HTTP 404', 'HTTP 401 jwt is expired', 'HTTP 401', 'ERR_TLS_CERT_ALTNAME_INVALID', 'request timed out', 'fetch failed'];
    for (const raw of raws) expect(classifyPingFailure(raw, opts)).not.toContain(' -- ');
    expect(classifyPingFailure('HTTP 401', { model: 'm' })).not.toContain(' -- ');
    expect((await buildLlmGatewayProbe(dir)).message).not.toContain(' -- ');
  });
});
