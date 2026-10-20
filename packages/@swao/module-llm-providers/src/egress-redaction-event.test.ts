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

// #3173: LLM egress redaction left no trace in the NDJSON event log. Every
// scrubForEgress call now emits provider.llm.egress.redacted carrying the
// redaction COUNTS by category and the character totals; never the prompt,
// the scrubbed text or the redacted values. Uses the REAL @swao/core
// redactor; only logPortfolio is captured.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { logged } = vi.hoisted(() => ({
  logged: [] as Array<{ level: string; code: string; message: string; context: Record<string, unknown> }>,
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (level: string, code: string, message: string, opts?: { context?: Record<string, unknown> }) => {
      logged.push({ level, code, message, context: opts?.context ?? {} });
    },
  };
});

import { scrubForEgress } from './egress-redaction.js';
import { OllamaLlmProvider } from './ollama.js';

const SECRET = 'sk-abcdef0123456789ABCDEF01'; // secret-scan-exempt: fake key fixture the redactor must mask
const EMAIL = 'alice@client.example';
const PLANTED = `Workload owner ${EMAIL}; export ANTHROPIC_KEY=${SECRET} for the batch job.`;
const ORIGINAL_FETCH = global.fetch;

const redactedEvents = () => logged.filter((e) => e.code === 'provider.llm.egress.redacted');

beforeEach(() => { logged.length = 0; });
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe('provider.llm.egress.redacted event (#3173)', () => {
  it('logs redaction counts by category and character totals for a scrub', () => {
    const scrubbed = scrubForEgress(PLANTED, 'anthropic', 'claude-sonnet-4-6');
    const events = redactedEvents();
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.level).toBe('info');
    expect(ev.context['provider']).toBe('anthropic');
    expect(ev.context['model']).toBe('claude-sonnet-4-6');
    expect(ev.context['input_chars']).toBe(PLANTED.length);
    expect(ev.context['scrubbed_chars']).toBe(scrubbed.length);
    const redactions = ev.context['redactions'] as Record<string, number>;
    expect(redactions['email']).toBe(1);
    const secretLike = (redactions['secret_shape'] ?? 0) + (redactions['api_key_shape'] ?? 0) + (redactions['bearer_token'] ?? 0);
    expect(secretLike).toBeGreaterThanOrEqual(1);
    const total = Object.values(redactions).reduce((a, b) => a + b, 0);
    expect(ev.context['redaction_total']).toBe(total);
  });

  it('never carries the prompt, the scrubbed text or the redacted values', () => {
    const scrubbed = scrubForEgress(PLANTED, 'openai', 'gpt-4o');
    const serialised = JSON.stringify(redactedEvents());
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(EMAIL);
    expect(serialised).not.toContain('Workload owner');
    expect(serialised).not.toContain(scrubbed);
  });

  it('logs a zero-count event for a clean prompt, so the log shows redaction ran', () => {
    scrubForEgress('No personal data in this prompt.', 'ollama', 'llama3');
    const events = redactedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.context['redaction_total']).toBe(0);
  });

  it('is emitted on a real driver call path (Ollama complete)', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: '{"ok":true}', prompt_eval_count: 1, eval_count: 1 }),
      text: async () => '{"response":"{}"}',
    })) as unknown as typeof fetch;
    await new OllamaLlmProvider('llama3', 'http://ollama.test').complete(PLANTED);
    const events = redactedEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.context['provider']).toBe('ollama');
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });
});
