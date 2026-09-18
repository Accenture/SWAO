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

import { describe, it, expect, afterEach } from 'vitest';
import {
  parseConnectionString,
  fromConnectionString,
  LlmFactory,
} from './connection-string-parser.js';
import { OllamaLlmProvider } from './ollama.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { OpenAiLlmProvider } from './openai.js';

// #0569 -- open LLM interface: connection-string auto-detection.

describe('parseConnectionString -- URL detection', () => {
  it('auto-detects Anthropic from its API URL', () => {
    expect(parseConnectionString('https://api.anthropic.com/v1/messages')).toEqual({ provider: 'anthropic' });
  });

  it('auto-detects OpenAI from its API URL', () => {
    expect(parseConnectionString('https://api.openai.com/v1/chat/completions')).toEqual({ provider: 'openai' });
  });

  it('auto-detects Ollama from the localhost URL and keeps a clean base URL', () => {
    expect(parseConnectionString('http://localhost:11434')).toEqual({ provider: 'ollama', baseUrl: 'http://localhost:11434' });
  });

  it('auto-detects Ollama on a remote host using the well-known port', () => {
    expect(parseConnectionString('http://ollama.internal:11434/api/generate')).toEqual({
      provider: 'ollama',
      baseUrl: 'http://ollama.internal:11434',
    });
  });

  it('resolves to open-llm-provider (with base URL) for an unclassifiable custom HTTPS URL (Design 082 §4.9)', () => {
    expect(parseConnectionString('https://llm.acme.example/v1')).toEqual({
      provider: 'open-llm-provider',
      baseUrl: 'https://llm.acme.example',
    });
  });
});

describe('parseConnectionString -- provider-prefixed form', () => {
  it('parses anthropic:<model>', () => {
    expect(parseConnectionString('anthropic:claude-opus-4-8')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
  });

  it('parses openai:<model>', () => {
    expect(parseConnectionString('openai:gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('parses ollama:<url> into a base URL', () => {
    expect(parseConnectionString('ollama:http://localhost:11434')).toEqual({ provider: 'ollama', baseUrl: 'http://localhost:11434' });
  });

  it('parses an inline api key (sk-...)', () => {
    expect(parseConnectionString('anthropic:sk-ant-secret')).toEqual({ provider: 'anthropic', apiKey: 'sk-ant-secret' });
  });

  it('is case-insensitive on the provider prefix', () => {
    expect(parseConnectionString('Anthropic:claude-opus-4-8')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
  });
});

describe('parseConnectionString -- bare model names', () => {
  it('maps a claude-* model to anthropic', () => {
    expect(parseConnectionString('claude-sonnet-4-6')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('maps a gpt-* model to openai', () => {
    expect(parseConnectionString('gpt-4o-mini')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('maps a llama-* model to ollama', () => {
    expect(parseConnectionString('llama3.1:8b')).toEqual({ provider: 'ollama', model: 'llama3.1:8b' });
  });

  it('returns provider null for an unknown bare token', () => {
    expect(parseConnectionString('some-private-model')).toEqual({ provider: null });
  });
});

describe('parseConnectionString -- edge cases', () => {
  it('returns provider null for an empty string', () => {
    expect(parseConnectionString('')).toEqual({ provider: null });
  });

  it('trims surrounding whitespace', () => {
    expect(parseConnectionString('  anthropic:claude-opus-4-8  ')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
  });

  it('bounds a pathologically long input without hanging', () => {
    const huge = `${'/'.repeat(50000)}`;
    const out = parseConnectionString(`http://localhost:11434${huge}`);
    expect(out.provider).toBe('ollama');
  });
});

describe('fromConnectionString', () => {
  const savedEnv: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of Object.keys(savedEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
      delete savedEnv[k];
    }
  });
  function stashEnv(...keys: string[]) {
    for (const k of keys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }

  it('builds an Ollama provider from a localhost URL (no key needed)', async () => {
    const p = await fromConnectionString('http://localhost:11434');
    expect(p).toBeInstanceOf(OllamaLlmProvider);
    expect(p.name).toBe('ollama');
  });

  it('builds an Anthropic provider when an inline key is supplied', async () => {
    const p = await fromConnectionString('anthropic:sk-ant-test');
    expect(p).toBeInstanceOf(AnthropicLlmProvider);
    expect(p.name).toBe('anthropic');
  });

  it('builds an OpenAI provider from a key env var without prompting', async () => {
    stashEnv('SWAO_OPENAI_API_KEY', 'OPENAI_API_KEY');
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-openai-test';
    const p = await fromConnectionString('openai:gpt-4o', { interactive: false });
    expect(p).toBeInstanceOf(OpenAiLlmProvider);
  });

  it('fails fast in non-interactive mode when the provider cannot be detected', async () => {
    await expect(fromConnectionString('some-private-model', { interactive: false })).rejects.toThrow(
      /Could not detect an LLM provider/,
    );
  });

  it('prompts for the provider in interactive mode and builds it (bare token -- still null)', async () => {
    // 'some-private-model' has no URL form, so provider remains null and the prompt fires.
    const p = await fromConnectionString('some-private-model', {
      interactive: true,
      promptFn: async () => 'ollama',
    });
    expect(p).toBeInstanceOf(OllamaLlmProvider);
  });

  it('prompts for an API key in interactive mode when none is configured', async () => {
    stashEnv('SWAO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
    const prompts: string[] = [];
    const p = await fromConnectionString('anthropic:claude-opus-4-8', {
      interactive: true,
      promptFn: async (q) => {
        prompts.push(q);
        return 'sk-ant-prompted';
      },
    });
    expect(p).toBeInstanceOf(AnthropicLlmProvider);
    expect(prompts.some((q) => /Enter API key for anthropic/.test(q))).toBe(true);
  });

  it('rejects an invalid interactive provider answer', async () => {
    await expect(
      fromConnectionString('some-private-model', { interactive: true, promptFn: async () => 'nonsense' }),
    ).rejects.toThrow(/Unknown LLM provider/);
  });
});

describe('parseConnectionString -- open-llm-provider (Design 082 §4.9)', () => {
  it('parses open-llm-provider:<url> with path prefix as model prefix and infers model', () => {
    const result = parseConnectionString(
      'open-llm-provider:https://preme-genai-hub.preme-plus.con.dst.baintern.de/Mistral-Small-24B-Instruct-2501',
    );
    expect(result.provider).toBe('open-llm-provider');
    expect(result.baseUrl).toBe('https://preme-genai-hub.preme-plus.con.dst.baintern.de');
    expect(result.modelPrefix).toBe('/Mistral-Small-24B-Instruct-2501');
    expect(result.model).toBe('Mistral-Small-24B-Instruct-2501');
  });

  it('parses open-llm-provider:<url> without path as empty modelPrefix', () => {
    const result = parseConnectionString('open-llm-provider:https://host.example.com');
    expect(result.provider).toBe('open-llm-provider');
    expect(result.baseUrl).toBe('https://host.example.com');
    expect(result.modelPrefix).toBe('');
    expect(result.model).toBeUndefined();
  });

  it('unrecognised HTTPS URL resolves to open-llm-provider', () => {
    const result = parseConnectionString('https://custom-llm.internal.corp/api');
    expect(result.provider).toBe('open-llm-provider');
    expect(result.baseUrl).toBe('https://custom-llm.internal.corp');
  });
});

describe('fromConnectionString -- open-llm-provider (Design 082 §4.9)', () => {
  afterEach(() => {
    delete process.env['SWAO_OPEN_LLM_MODEL'];
    delete process.env['SWAO_OPEN_LLM_URL'];
  });

  it('builds an OpenLlmProvider from a prefixed connection string', async () => {
    process.env['SWAO_OPEN_LLM_MODEL'] = 'Mistral-Small-24B-Instruct-2501';
    const { OpenLlmProvider } = await import('./open-llm-provider.js');
    const p = await fromConnectionString(
      'open-llm-provider:https://preme-genai-hub.example.com/Mistral-Small-24B-Instruct-2501',
    );
    expect(p).toBeInstanceOf(OpenLlmProvider);
    expect(p.name).toBe('open-llm-provider');
    expect(p.model).toBe('Mistral-Small-24B-Instruct-2501');
  });

  it('builds an OpenLlmProvider from an unrecognised HTTPS URL with env-resolved model', async () => {
    process.env['SWAO_OPEN_LLM_MODEL'] = 'my-model';
    const { OpenLlmProvider } = await import('./open-llm-provider.js');
    const p = await fromConnectionString('https://llm.internal.corp/v1');
    expect(p).toBeInstanceOf(OpenLlmProvider);
    expect(p.name).toBe('open-llm-provider');
  });
});

describe('LlmFactory surface', () => {
  it('exposes fromConnectionString and create', () => {
    expect(typeof LlmFactory.fromConnectionString).toBe('function');
    expect(typeof LlmFactory.create).toBe('function');
  });
});
