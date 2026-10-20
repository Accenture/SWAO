// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- egress redaction tests (#3157)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
//
// Every LLM egress path must apply pre-LLM redaction (CLAUDE.md §5.7).
// These tests use the REAL @swao/core redactor (no identity mock) and plant
// a secret-shaped value and an e-mail address in every text field a caller
// controls, then assert the outgoing request body never contains them.
//
// Transports are mocked at the wire: global fetch (Anthropic, OpenAI,
// Ollama), undici fetch (OpenLlmProvider, embeddings), and the Bedrock
// client send / ConverseCommand input.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const { undiciFetchMock, bedrockSend, converseInputs } = vi.hoisted(() => ({
  undiciFetchMock: vi.fn(),
  bedrockSend: vi.fn(),
  converseInputs: [] as unknown[],
}));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: undiciFetchMock };
});

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(function MockClient() { return { send: bedrockSend }; }),
  ConverseCommand: vi.fn(function MockCmd(input: unknown) { converseInputs.push(input); return input; }),
}));

import { OllamaLlmProvider } from './ollama.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { OpenAiLlmProvider } from './openai.js';
import { OpenLlmProvider, OpenLlmEmbeddingProvider } from './open-llm-provider.js';
import { BedrockLlmProvider } from './bedrock.js';
import { createLlmProvider } from './factory.js';
import { createProviderFromConnector } from './gateway/resolve.js';
import { getConnector } from './gateway/connector-loader.js';
import type { LlmProvider } from './types.js';

// Values the core redactor tests already prove are scrubbed.
const SECRET = 'sk-abcdef0123456789ABCDEF01'; // secret-scan-exempt: fake key fixture the redactor must mask
const EMAIL = 'alice@client.example';
const PLANTED = `Workload owner ${EMAIL}; export ANTHROPIC_KEY=${SECRET} for the batch job.`;

const ORIGINAL_FETCH = global.fetch;

/** Every request body string captured from any transport in this test. */
let bodies: string[];

function expectClean(): void {
  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) {
    expect(b).not.toContain(SECRET);
    expect(b).not.toContain(EMAIL);
  }
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function sse(text: string): Response {
  const enc = new TextEncoder();
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'message_delta', usage: { output_tokens: 50 }, delta: { stop_reason: 'end_turn' } },
  ];
  const payload = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode(payload)); c.close(); },
    }),
  } as unknown as Response;
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

const openAiChat = (content: string) => jsonResponse({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 50 },
});

const ollamaGenerate = (response: string) => jsonResponse({ response, prompt_eval_count: 10, eval_count: 50 });

/** Install a global fetch mock that records every request body. */
function stubGlobalFetch(respond: (callIndex: number) => Response): void {
  let i = 0;
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''));
    return respond(i++);
  }) as unknown as typeof fetch;
}

/** Install the undici fetch mock that records every request body. */
function stubUndiciFetch(respond: (callIndex: number) => Response): void {
  let i = 0;
  undiciFetchMock.mockImplementation(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''));
    return respond(i++);
  });
}

function stubBedrock(): void {
  bedrockSend.mockImplementation(async () => {
    bodies.push(JSON.stringify(converseInputs[converseInputs.length - 1]));
    return { output: { message: { content: [{ text: '{"ok":true}' }] } }, usage: { inputTokens: 10, outputTokens: 50 } };
  });
}

beforeEach(() => {
  bodies = [];
  converseInputs.length = 0;
  undiciFetchMock.mockReset();
  bedrockSend.mockReset();
  delete process.env['SWAO_LLM_CONNECTOR'];
  delete process.env['SWAO_LLM_ENV'];
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

const IMAGE = Buffer.from([0xff, 0xd8, 0xff]);

// ---------------------------------------------------------------------------
// Direct driver paths
// ---------------------------------------------------------------------------

describe('pre-LLM redaction on every driver (#3157)', () => {
  it('Ollama complete() scrubs the prompt', async () => {
    stubGlobalFetch(() => ollamaGenerate('{"ok":true}'));
    await new OllamaLlmProvider('llama3', 'http://ollama.test').complete(PLANTED);
    expectClean();
  });

  it('Ollama completeVision() scrubs the text prompt', async () => {
    stubGlobalFetch(() => ollamaGenerate('ok'));
    await new OllamaLlmProvider('llava', 'http://ollama.test').completeVision(PLANTED, [IMAGE]);
    expectClean();
  });

  it('Anthropic complete() scrubs the prompt', async () => {
    stubGlobalFetch(() => sse('{"ok":true}'));
    await new AnthropicLlmProvider('sk-ant-test-0000', 'claude-sonnet-4-6').complete(PLANTED);
    expectClean();
  });

  it('Anthropic completeVision() scrubs the text prompt', async () => {
    // #3221 / #3225: vision now streams through the shared instrumented helper.
    stubGlobalFetch(() => sse('ok'));
    await new AnthropicLlmProvider('sk-ant-test-0000', 'claude-sonnet-4-6').completeVision(PLANTED, [IMAGE]);
    expectClean();
  });

  it('Anthropic completeWithTools() scrubs system, every history turn and tool results', async () => {
    stubGlobalFetch((i) => i === 0
      ? jsonResponse({
          content: [{ type: 'tool_use', id: 't1', name: 'lookup', input: {} }],
          stop_reason: 'tool_use',
          usage: {},
        })
      : jsonResponse({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: {} }));
    await new AnthropicLlmProvider('sk-ant-test-0000', 'claude-sonnet-4-6').completeWithTools({
      system: `Workspace context: ${PLANTED}`,
      messages: [
        { role: 'user', content: PLANTED },
        { role: 'assistant', content: PLANTED },
        { role: 'user', content: 'next question' },
      ],
      tools: [{ name: 'lookup', description: 'd', input_schema: { type: 'object' } }],
      onToolCall: async () => `tool output ${PLANTED}`,
    });
    expect(bodies).toHaveLength(2);
    expectClean();
  });

  it('OpenAI complete() scrubs the prompt', async () => {
    stubGlobalFetch(() => openAiChat('{"ok":true}'));
    await new OpenAiLlmProvider('sk-openai-test', 'gpt-4o').complete(PLANTED);
    expectClean();
  });

  it('OpenAI completeVision() scrubs the text prompt', async () => {
    stubGlobalFetch(() => openAiChat('ok'));
    await new OpenAiLlmProvider('sk-openai-test', 'gpt-4o').completeVision(PLANTED, [IMAGE]);
    expectClean();
  });

  it('OpenLlmProvider complete() scrubs the prompt', async () => {
    stubUndiciFetch(() => openAiChat('{"ok":true}'));
    await new OpenLlmProvider('key', 'm', 'https://hub.test', '').complete(PLANTED);
    expectClean();
  });

  it('OpenLlmProvider completeVision() scrubs the text prompt', async () => {
    stubUndiciFetch(() => openAiChat('ok'));
    await new OpenLlmProvider('key', 'm', 'https://hub.test', '').completeVision(PLANTED, [IMAGE]);
    expectClean();
  });

  it('OpenLlmProvider completeWithTools() scrubs system, every history turn and tool results', async () => {
    stubUndiciFetch((i) => i === 0
      ? jsonResponse({
          choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'lookup', arguments: '{}' } }] } }],
        })
      : jsonResponse({ choices: [{ message: { content: 'done' } }] }));
    await new OpenLlmProvider('key', 'm', 'https://hub.test', '').completeWithTools({
      system: `Workspace context: ${PLANTED}`,
      messages: [
        { role: 'user', content: PLANTED },
        { role: 'assistant', content: PLANTED },
        { role: 'user', content: 'next question' },
      ],
      tools: [{ name: 'lookup', description: 'd', input_schema: { type: 'object' } }],
      onToolCall: async () => `tool output ${PLANTED}`,
    });
    expect(bodies).toHaveLength(2);
    expectClean();
  });

  it('OpenLlmEmbeddingProvider embed() scrubs the input', async () => {
    stubUndiciFetch(() => jsonResponse([0.1, 0.2]));
    await new OpenLlmEmbeddingProvider('https://tei.test', 'nomic').embed(PLANTED);
    expectClean();
  });

  it('Bedrock complete() scrubs the prompt', async () => {
    stubBedrock();
    await new BedrockLlmProvider('eu.anthropic.claude-sonnet-4-6', 'https://bedrock-runtime.eu-central-1.amazonaws.com').complete(PLANTED);
    expectClean();
  });
});

// ---------------------------------------------------------------------------
// Factory paths: legacy `type:` switch and the LLM gateway connector path
// ---------------------------------------------------------------------------

describe('pre-LLM redaction via the factory and gateway paths (#3157)', () => {
  let workspaceRoot: string;
  let gwDir: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'swao-egress-'));
    gwDir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(gwDir, { recursive: true });
    process.env['SWAO_EGRESS_TEST_KEY'] = 'test-key-123';
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    delete process.env['SWAO_EGRESS_TEST_KEY'];
  });

  function gatewayProvider(protocol: string, baseUrl: string, model: string): LlmProvider {
    const id = `egress-${protocol}`;
    writeFileSync(join(gwDir, `${id}.yaml`), [
      'schema_version: "1.0"',
      'connector:',
      `  id: ${id}`,
      `  name: Egress ${protocol}`,
      `  protocol: ${protocol}`,
      `  base_url: ${baseUrl}`,
      '  auth:',
      '    env_var: SWAO_EGRESS_TEST_KEY',
      '  models:',
      `    default: ${model}`,
    ].join('\n') + '\n');
    const loaded = getConnector(id, { workspaceRoot });
    if (!loaded) throw new Error(`connector ${id} not loaded`);
    return createProviderFromConnector(loaded, {}).provider;
  }

  it('legacy type: ollama path scrubs the prompt', async () => {
    stubGlobalFetch(() => ollamaGenerate('{"ok":true}'));
    const p = createLlmProvider(undefined, undefined, { type: 'ollama', model: 'llama3' });
    await p.complete(PLANTED);
    expectClean();
  });

  it('gateway protocol: ollama scrubs the prompt', async () => {
    stubGlobalFetch(() => ollamaGenerate('{"ok":true}'));
    await gatewayProvider('ollama', 'http://ollama.test', 'llama3').complete(PLANTED);
    expectClean();
  });

  it('gateway protocol: anthropic-messages scrubs the prompt', async () => {
    stubGlobalFetch(() => sse('{"ok":true}'));
    await gatewayProvider('anthropic-messages', 'https://anthropic-gw.test', 'claude-sonnet-4-6').complete(PLANTED);
    expectClean();
  });

  it('gateway protocol: openai-chat scrubs the prompt', async () => {
    stubUndiciFetch(() => openAiChat('{"ok":true}'));
    await gatewayProvider('openai-chat', 'https://hub.test', 'm').complete(PLANTED);
    expectClean();
  });

  it('gateway protocol: bedrock scrubs the prompt', async () => {
    stubBedrock();
    await gatewayProvider('bedrock', 'https://bedrock-runtime.eu-central-1.amazonaws.com', 'eu.anthropic.claude-sonnet-4-6').complete(PLANTED);
    expectClean();
  });
});

// ---------------------------------------------------------------------------
// Structural guard: every network-egress source file routes through the
// shared choke point, and no driver calls the core redactor directly
// (which would invite double redaction or a forgotten path).
// ---------------------------------------------------------------------------

describe('egress choke-point guard (#3157)', () => {
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(srcDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'egress-redaction.ts');

  it('every driver that builds a model request imports scrubForEgress', () => {
    const egress = files.filter(f => {
      const s = readFileSync(join(srcDir, f), 'utf-8');
      return /\b(?:fetch|undiciFetch)\(/.test(s) || /\.send\(\s*new /.test(s);
    });
    expect(egress.sort()).toEqual(
      ['anthropic.ts', 'bedrock.ts', 'ollama.ts', 'open-llm-provider.ts', 'openai.ts'],
    );
    for (const f of egress) {
      expect(readFileSync(join(srcDir, f), 'utf-8'), f).toContain("from './egress-redaction.js'");
    }
  });

  it('no driver imports redactPreLlm directly', () => {
    for (const f of files) {
      const s = readFileSync(join(srcDir, f), 'utf-8');
      expect(/import\s*\{[^}]*\bredactPreLlm\b[^}]*\}\s*from\s*'@swao\/core'/.test(s), f).toBe(false);
    }
  });
});
