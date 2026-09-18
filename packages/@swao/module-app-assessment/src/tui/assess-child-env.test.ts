// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App-assessment module -- child env builder tests (#1409)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildChildEnv } from './AssessScreen.js';

// buildChildEnv copies process.env; clear LLM vars so a developer machine's
// environment cannot leak into the assertions.
const LLM_VARS = ['SWAO_LLM_CONNECTOR', 'SWAO_LLM_MODEL', 'SWAO_LLM_PROVIDER',
  'SWAO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', 'SWAO_ANTHROPIC_MODEL',
  'SWAO_OPENAI_API_KEY', 'OPENAI_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const v of LLM_VARS) { saved[v] = process.env[v]; delete process.env[v]; } });
afterEach(() => { for (const v of LLM_VARS) { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]; } });

// QA regression 2026-08-06: workspace configured `connector: openrouter` but
// the spawned assess child received SWAO_LLM_PROVIDER=anthropic (stored key
// fallback) and silently ran claude-haiku while the banner said "Gateway:".

describe('buildChildEnv gateway wiring (#1409)', () => {
  const creds = { 'anthropic-api-key': 'sk-ant-test', 'openai-api-key': 'sk-oai-test' };

  it('passes the connector + model to the child and skips the legacy key fallback', () => {
    const env = buildChildEnv(null, creds, { connector: 'openrouter', model: 'deepseek/deepseek-v4-flash' }, {});
    expect(env['SWAO_LLM_CONNECTOR']).toBe('openrouter');
    expect(env['SWAO_LLM_MODEL']).toBe('deepseek/deepseek-v4-flash');
    // The stored anthropic key must NOT reroute a gateway workspace.
    expect(env['SWAO_LLM_PROVIDER']).toBeUndefined();
    expect(env['SWAO_ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('per-app connector overrides the workspace connector (#0800 precedence)', () => {
    const env = buildChildEnv(null, creds, { connector: 'openrouter', model: 'a' }, { connector: 'ollama' });
    expect(env['SWAO_LLM_CONNECTOR']).toBe('ollama');
  });

  it('legacy type-based configs still use the key-based env injection', () => {
    const env = buildChildEnv(null, creds, { type: 'anthropic', model: 'claude-haiku-4-5' }, {});
    expect(env['SWAO_LLM_CONNECTOR']).toBeUndefined();
    expect(env['SWAO_LLM_PROVIDER']).toBe('anthropic');
    expect(env['SWAO_ANTHROPIC_API_KEY']).toBe('sk-ant-test');
    expect(env['SWAO_ANTHROPIC_MODEL']).toBe('claude-haiku-4-5');
  });
});
