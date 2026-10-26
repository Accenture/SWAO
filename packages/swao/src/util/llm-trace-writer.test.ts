// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3447: LLM prompt traces are masked at write time, in the run dir and in a
// leg traces directory outside the run dir (never reached by the sweep).
// Drives the host composition: a mocked provider behind
// UsageTrackingLlmProvider, getFirstTrace() -> writeMaskedLlmTrace().

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageTrackingLlmProvider } from '@swao/module-llm-providers';
import type { LlmProvider, LlmTrace } from '@swao/module-llm-providers';
import { buildMaskedLlmTrace, writeMaskedLlmTrace } from './llm-trace-writer.js';

const PLANTED = 'Zx9-fake-Pw42'; // gitleaks:allow (synthetic #3447 fixture)
const PLANTED_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; // gitleaks:allow (synthetic)

/** Mocked provider: the raw response repeats a credential in prose and JSON. */
class LeakyProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'leaky';
  private last: LlmTrace | undefined;
  async complete(prompt: string): Promise<string> {
    const response =
      `{"finding":"hard-coded password = \\"${PLANTED}\\" in config"}\n` +
      `Note: the token ${PLANTED_TOKEN} and password = "${PLANTED}" were seen.`;
    // The prompt was scrubbed for egress, but a credential slipped through.
    this.last = { scrubbedPrompt: `${prompt} db password = "${PLANTED}"`, response };
    return response;
  }
  getLastTrace(): LlmTrace | undefined { return this.last; }
}

describe('writeMaskedLlmTrace (#3447)', () => {
  let root: string | undefined;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

  it('never writes the planted credential into run-dir or out-of-run-dir trace files', async () => {
    root = mkdtempSync(join(tmpdir(), 'swao-trace-'));
    const runDir = join(root, 'workspace', 'apps', 'a', 'wsp', 'runs', '2026-10-24T00-00-00');
    // Leg traces dir: derived from the sink path, outside any run dir.
    const legTracesDir = join(root, 'llm-assessments', 'swao', 'legs', 'or--x', 'traces');

    const tracker = new UsageTrackingLlmProvider(new LeakyProvider());
    await tracker.complete('classify this');
    const first = tracker.getFirstTrace();
    expect(first?.response).toContain(PLANTED);

    const files: string[] = [];
    for (const dir of [join(runDir, 'llm-traces'), legTracesDir]) {
      files.push(writeMaskedLlmTrace(dir, {
        pass: '03-data',
        callIndex: 1,
        model: 'leaky',
        connector: 'stub',
        scrubbedPrompt: first!.scrubbedPrompt,
        response: first!.response,
      }));
    }

    expect(files[0]).toBe(join(runDir, 'llm-traces', '03-data-call-1.json'));
    expect(files[1]).toBe(join(legTracesDir, '03-data-call-1.json'));
    for (const f of files) {
      const raw = readFileSync(f, 'utf-8');
      expect(raw).not.toContain(PLANTED);
      expect(raw).not.toContain(PLANTED_TOKEN);
      const parsed = JSON.parse(raw) as { response: { content: string; parse_valid: boolean }; prompt: { content: string } };
      expect(parsed.response.content).toContain('password');
      expect(parsed.prompt.content).toContain('classify this');
      expect(parsed.response.parse_valid).toBe(false);
    }
  });

  // #3456: a JSON answer whose credential value itself contains an escape
  // sequence, repeated decoded in prose.
  it('masks an escaped credential value that contains a backslash escape (#3456)', () => {
    const decoded = 'Zx9\\fake1'; // gitleaks:allow (synthetic #3456 fixture)
    const response = `${JSON.stringify({ finding: `password = "${decoded}" in config` })}\nRepeated: ${decoded}`;
    const { trace } = buildMaskedLlmTrace({
      pass: '03-data',
      callIndex: 1,
      model: 'm',
      connector: 'c',
      scrubbedPrompt: 'classify this',
      response,
    });
    expect(trace.response.content).not.toContain(decoded);
    expect(trace.response.content).not.toContain(JSON.stringify(decoded).slice(1, -1));
    expect(trace.response.content).toContain('***(');
  });

  it('keeps clean traces unchanged and reports parse_valid on the raw response', () => {
    const { trace, masked } = buildMaskedLlmTrace({
      pass: '09-synth',
      callIndex: 1,
      model: 'm',
      connector: 'c',
      scrubbedPrompt: 'summarise [REDACTED:email] and [REDACTED:email]',
      response: '{"summary":"ok"}',
      timestamp: '2026-10-24T00:00:00.000Z',
    });
    expect(masked).toBe(0);
    expect(trace.response.content).toBe('{"summary":"ok"}');
    expect(trace.response.parse_valid).toBe(true);
    expect(trace.prompt.redacted_placeholders).toBe(2);
  });
});

// #3447: assess.ts must write traces only through the masking writer.
describe('assess.ts trace call site (#3447)', () => {
  it('writes llm-traces through writeMaskedLlmTrace, never a raw writeFileSync of the trace', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'commands', 'assess.ts'), 'utf-8');
    expect(src).toContain('writeMaskedLlmTrace(traceOutDir,');
    expect(src).not.toMatch(/writeFileSync\([^)]*traceOutDir/);
  });
});
