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

// LLM prompt-trace writer (#1709, #3447, Design 032 section 11.6).
//
// #3447: the per-pass trace (post-redaction prompt + raw model response) is
// masked at WRITE time. The post-run sweep (report-scrub.ts) only covers the
// run directory, and leg traces (LLM Assessment, <sink>/traces/) live outside
// it. Masking happens on the string fields BEFORE JSON.stringify, so the
// mask sees the text as the model wrote it (#3456 also lets the core pattern
// match backslash-escaped quotes after serialisation).
//
// - prompt: already redacted by scrubForEgress; guardSecretText masks any
//   remaining credential values and secret shapes.
// - response: never redacted before; redactReportText applies the report
//   redactor classes (including `credential`) and the secret guard.
//
// Raw values are never logged; only class counts reach the redaction report.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCredentialValues, guardSecretText, maskKnownSecret, recordRedaction } from '@swao/core';
import { redactReportText } from './report-scrub.js';
import type { PreLlmRedactionCounts } from './redact-pre-llm.js';

export interface LlmTraceInput {
  /** `<num>-<passKey>`, also the file name stem. */
  pass: string;
  callIndex: number;
  leg?: string;
  model: string;
  connector: string;
  /** Post-redaction prompt as sent to the provider. */
  scrubbedPrompt: string;
  /** Raw model response (unredacted). */
  response: string;
  responseTokens?: number;
  timestamp?: string;
}

export interface LlmTraceFile {
  pass: string;
  call_index: number;
  leg?: string;
  model: string;
  connector: string;
  timestamp: string;
  prompt: {
    chars: number;
    tokens_est: number;
    redacted_placeholders: number;
    note: string;
    content: string;
  };
  response: {
    chars: number;
    tokens?: number;
    parse_valid: boolean;
    content: string;
  };
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** #3447: build the masked trace object; pure, no I/O. */
/**
 * #3447: credential values named anywhere in the prompt or response. A model
 * often answers in JSON (`password = \"value\"`) and can repeat the same value
 * bare in prose, where no keyword precedes it. Masking every literal
 * occurrence closes that gap. Values are read from the raw text and from a
 * quote-unescaped view. #3456: the core credential pattern now matches
 * backslash-escaped quotes itself; the unescaped view stays as defence in
 * depth. A value that carries JSON escape sequences (`Zx\\fake`) is also
 * added in its decoded form, so a decoded repeat in prose is masked too.
 */
function harvestCredentialValues(...texts: string[]): string[] {
  const values = new Set<string>();
  const add = (v: string): void => {
    values.add(v);
    if (!v.includes('\\') || v.includes('"')) return;
    try {
      const decoded: unknown = JSON.parse(`"${v}"`);
      if (typeof decoded === 'string' && decoded.length >= 3) values.add(decoded);
    } catch {
      // Not a valid JSON string body: keep the raw form only.
    }
  };
  for (const t of texts) {
    for (const v of extractCredentialValues(t)) add(v);
    for (const v of extractCredentialValues(t.replace(/\\"/g, '"').replace(/\\'/g, "'"))) add(v);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function maskLiterals(text: string, values: readonly string[]): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const v of values) {
    const next = maskKnownSecret(out, v);
    if (next !== out) {
      count += out.split(v).length - 1;
      out = next;
    }
  }
  return { text: out, count };
}

/** #3447: build the masked trace object; pure, no I/O. */
export function buildMaskedLlmTrace(input: LlmTraceInput): { trace: LlmTraceFile; counts: PreLlmRedactionCounts; masked: number } {
  const known = harvestCredentialValues(input.scrubbedPrompt, input.response);
  const promptLit = maskLiterals(input.scrubbedPrompt, known);
  const responseLit = maskLiterals(input.response, known);
  const prompt = guardSecretText(promptLit.text);
  const response = redactReportText(responseLit.text);
  const counts: PreLlmRedactionCounts = { ...response.counts };
  counts.secret_shape += prompt.count;
  counts.credential += promptLit.count + responseLit.count;
  const masked = Object.values(counts).reduce((a, b) => a + b, 0);
  const trace: LlmTraceFile = {
    pass: input.pass,
    call_index: input.callIndex,
    leg: input.leg,
    model: input.model,
    connector: input.connector,
    timestamp: input.timestamp ?? new Date().toISOString(),
    prompt: {
      chars: prompt.text.length,
      tokens_est: Math.ceil(prompt.text.length / 4),
      redacted_placeholders: (prompt.text.match(/\[REDACTED/g) ?? []).length,
      note: 'post-redaction only -- [REDACTED...] markers in place',
      content: prompt.text,
    },
    response: {
      chars: response.text.length,
      tokens: input.responseTokens,
      // Shape check on the raw text; a boolean carries no value.
      parse_valid: isJson(input.response),
      content: response.text,
    },
  };
  return { trace, counts, masked };
}

/**
 * #3447: write one masked trace file to `dir` (run-dir `llm-traces/` or a
 * leg traces directory outside the run dir). Returns the file path.
 */
export function writeMaskedLlmTrace(dir: string, input: LlmTraceInput): string {
  const { trace, counts, masked } = buildMaskedLlmTrace(input);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${input.pass}-call-${input.callIndex}.json`);
  writeFileSync(file, JSON.stringify(trace, null, 2), 'utf-8');
  if (masked > 0) {
    // Audit trail only: class counts, never values.
    recordRedaction({
      surface: 'report_write',
      provider: 'llm-trace-writer',
      model: `${input.pass}-call-${input.callIndex}.json`,
      input_chars: input.scrubbedPrompt.length + input.response.length,
      scrubbed_chars: trace.prompt.content.length + trace.response.content.length,
      counts,
    });
  }
  return file;
}
