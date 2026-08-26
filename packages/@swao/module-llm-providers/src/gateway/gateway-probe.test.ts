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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLlmGatewayProbe, classifyPingFailure } from './gateway-probe.js';

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

  it('falls back to the raw message when unclassified', () => {
    expect(classifyPingFailure('weird driver explosion', opts)).toBe('weird driver explosion');
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

  it('stays discovery-only when no connector is active', async () => {
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('discovery-only');
  });

  it('warns when the active connector does not exist', async () => {
    process.env['SWAO_LLM_CONNECTOR'] = 'no-such-platform';
    const r = await buildLlmGatewayProbe(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("active connector 'no-such-platform' not found");
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
});
