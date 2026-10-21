import { describe, it, expect } from 'vitest';
import { buildPreflightRequest } from './preflight-request.js';
import type { LocalConnectorInfo } from './types.js';

const base: LocalConnectorInfo = {
  id: 'corp-gateway', name: 'Corporate gateway', credentialKey: 'corp-gateway-api-key', envVar: 'SWAO_CORP_GATEWAY_TOKEN',
  baseUrl: 'https://llm.example.internal', protocol: 'openai-chat', defaultModel: '/Llama-3.3-70B-Instruct-FP8-Dynamic',
};

describe('buildPreflightRequest (#3385)', () => {
  it('openai-chat without /v1 in base_url calls /v1/chat/completions', () => {
    expect(buildPreflightRequest(base, 'k').url).toBe('https://llm.example.internal/v1/chat/completions');
  });
  it('keeps a base_url that already ends in /v1 (no double /v1)', () => {
    expect(buildPreflightRequest({ ...base, baseUrl: 'https://api.example.com/v1/' }, 'k').url).toBe('https://api.example.com/v1/chat/completions');
  });
  it('pings the run model, not the connector default', () => {
    const r = buildPreflightRequest({ ...base, model: '/qwen38-27b-8fp' }, 'k');
    expect(r.model).toBe('/qwen38-27b-8fp');
    expect(r.body['model']).toBe('/qwen38-27b-8fp');
  });
  it('falls back to the connector default when the run has no model', () => {
    expect(buildPreflightRequest(base, 'k').model).toBe('/Llama-3.3-70B-Instruct-FP8-Dynamic');
  });
  it('sends a bearer token for openai-chat', () => {
    expect(buildPreflightRequest(base, 'tok').headers['Authorization']).toBe('Bearer tok');
  });
  it('anthropic-messages keeps /v1/messages and the x-api-key header', () => {
    const r = buildPreflightRequest({ ...base, protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' }, 'k');
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['x-api-key']).toBe('k');
  });
  it('ollama uses /api/chat', () => {
    expect(buildPreflightRequest({ ...base, protocol: 'ollama', baseUrl: 'http://localhost:11434' }, 'k').url).toBe('http://localhost:11434/api/chat');
  });
});
