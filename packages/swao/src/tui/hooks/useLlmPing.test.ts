// Tests for buildPingRequest (pure) and isPermanentFailure (pure).
// The useLlmPing React hook is not unit-tested here -- Ink/React test setup is
// deferred to the dedicated TUI test sprint (Design 098 section 7.3).

import { describe, it, expect } from 'vitest';
import { buildPingRequest, isPermanentFailure } from './useLlmPing.js';

const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';

// ── buildPingRequest -- anthropic direct ─────────────────────────────────────

describe('buildPingRequest -- anthropic direct', () => {
  it('uses Anthropic API endpoint', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'sk-ant-test' });
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('sets method POST', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'key' });
    expect(req.method).toBe('POST');
  });

  it('injects x-api-key and anthropic-version headers', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'sk-ant-abc' });
    expect(req.headers['x-api-key']).toBe('sk-ant-abc');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers['Content-Type']).toBe('application/json');
  });

  it('does not inject Authorization header', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'key' });
    expect(req.headers['Authorization']).toBeUndefined();
  });

  it('uses default model when model not specified', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'key' });
    const body = JSON.parse(req.body) as { model: string };
    expect(body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('uses caller-supplied model when provided', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'key', model: 'claude-opus-5' });
    const body = JSON.parse(req.body) as { model: string };
    expect(body.model).toBe('claude-opus-5');
  });

  it('sets max_tokens 16 and correct message body', () => {
    const req = buildPingRequest({ kind: 'anthropic', apiKey: 'key' });
    const body = JSON.parse(req.body) as { max_tokens: number; messages: Array<{ role: string; content: string }> };
    expect(body.max_tokens).toBe(16);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe(PING_PROMPT);
  });
});

// ── buildPingRequest -- openai direct ────────────────────────────────────────

describe('buildPingRequest -- openai direct', () => {
  it('uses OpenAI API endpoint', () => {
    const req = buildPingRequest({ kind: 'openai', apiKey: 'sk-test' });
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('injects Bearer Authorization header', () => {
    const req = buildPingRequest({ kind: 'openai', apiKey: 'sk-abc' });
    expect(req.headers['Authorization']).toBe('Bearer sk-abc');
  });

  it('does not inject x-api-key header', () => {
    const req = buildPingRequest({ kind: 'openai', apiKey: 'key' });
    expect(req.headers['x-api-key']).toBeUndefined();
  });

  it('uses default model gpt-4o-mini when model not specified', () => {
    const req = buildPingRequest({ kind: 'openai', apiKey: 'key' });
    const body = JSON.parse(req.body) as { model: string };
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('uses caller-supplied model when provided', () => {
    const req = buildPingRequest({ kind: 'openai', apiKey: 'key', model: 'gpt-4o' });
    const body = JSON.parse(req.body) as { model: string };
    expect(body.model).toBe('gpt-4o');
  });
});

// ── buildPingRequest -- gateway: anthropic-messages protocol ─────────────────

describe('buildPingRequest -- gateway anthropic-messages protocol', () => {
  const connector = {
    protocol: 'anthropic-messages',
    base_url: 'https://gw.example.com/',
    models: { default: 'claude-3-haiku' },
  };

  it('appends /v1/messages to base_url (trailing slash stripped)', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: 'gw-key' });
    expect(req.url).toBe('https://gw.example.com/v1/messages');
  });

  it('injects x-api-key and anthropic-version headers', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: 'gw-key' });
    expect(req.headers['x-api-key']).toBe('gw-key');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('uses the connector default model in the request body', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: 'key' });
    const body = JSON.parse(req.body) as { model: string };
    expect(body.model).toBe('claude-3-haiku');
  });
});

// ── buildPingRequest -- gateway: ollama protocol ─────────────────────────────

describe('buildPingRequest -- gateway ollama protocol', () => {
  const connector = {
    protocol: 'ollama',
    base_url: 'http://localhost:11434',
    models: { default: 'llama3' },
  };

  it('appends /api/chat to base_url', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: '' });
    expect(req.url).toBe('http://localhost:11434/api/chat');
  });

  it('does not inject Authorization or x-api-key headers', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: '' });
    expect(req.headers['Authorization']).toBeUndefined();
    expect(req.headers['x-api-key']).toBeUndefined();
  });

  it('sets stream: false in the request body', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: '' });
    const body = JSON.parse(req.body) as { stream: boolean };
    expect(body.stream).toBe(false);
  });

  it('uses the connector default model', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: '' });
    const body = JSON.parse(req.body) as { model: string };
    expect(body.model).toBe('llama3');
  });
});

// ── buildPingRequest -- gateway: openai-compatible (default) protocol ────────

describe('buildPingRequest -- gateway openai-compatible protocol', () => {
  const connector = {
    protocol: 'openai-compatible',
    base_url: 'https://azure-oai.example.com',
    models: { default: 'gpt-4o-mini-azure' },
  };

  it('appends /v1/chat/completions to base_url', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: 'azure-key' });
    expect(req.url).toBe('https://azure-oai.example.com/v1/chat/completions');
  });

  it('injects Bearer Authorization header', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: 'azure-key' });
    expect(req.headers['Authorization']).toBe('Bearer azure-key');
  });

  it('does not inject x-api-key header', () => {
    const req = buildPingRequest({ kind: 'gateway', connector, apiKey: 'key' });
    expect(req.headers['x-api-key']).toBeUndefined();
  });
});

// ── isPermanentFailure ────────────────────────────────────────────────────────

describe('isPermanentFailure', () => {
  it('returns true for 401 Unauthorized', () => {
    expect(isPermanentFailure(401)).toBe(true);
  });

  it('returns true for 403 Forbidden', () => {
    expect(isPermanentFailure(403)).toBe(true);
  });

  it('returns true for 404 Not Found (model removed)', () => {
    expect(isPermanentFailure(404)).toBe(true);
  });

  it('returns false for 429 Too Many Requests (rate-limit -- transient)', () => {
    expect(isPermanentFailure(429)).toBe(false);
  });

  it('returns false for 5xx server errors (transient)', () => {
    expect(isPermanentFailure(500)).toBe(false);
    expect(isPermanentFailure(503)).toBe(false);
  });

  it('returns false for 2xx success codes', () => {
    expect(isPermanentFailure(200)).toBe(false);
    expect(isPermanentFailure(201)).toBe(false);
  });

  it('returns true for 400 Bad Request', () => {
    expect(isPermanentFailure(400)).toBe(true);
  });
});
