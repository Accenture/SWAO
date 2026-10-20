// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- pre-LLM egress redaction choke point
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { redactPreLlm, recordRedaction, logPortfolio } from '@swao/core';

/**
 * Single egress choke point for every driver in this module (#3157,
 * #0354, CLAUDE.md §5.7). Every text string that is placed into an LLM
 * or embedding request body (prompt, system prompt, chat history, tool
 * results, vision text prompt, embedding input) MUST pass through this
 * function exactly once before the request body is built.
 *
 * Drivers call it directly rather than being wrapped at factory level so
 * that directly constructed drivers (connection-string parser, tests,
 * host code) are covered as well. Delegating layers (LlmCacheLayer,
 * UsageTrackingLlmProvider, gateway probe) must NOT call it, to avoid
 * double redaction and double-counted redaction report entries.
 *
 * Images passed to completeVision are not text and are not redacted;
 * see the LlmProvider.completeVision contract in types.ts.
 */
export function scrubForEgress(
  text: string,
  provider: string,
  model: string,
): string {
  const { text: scrubbed, counts } = redactPreLlm(text);
  recordRedaction({
    provider,
    model,
    input_chars: text.length,
    scrubbed_chars: scrubbed.length,
    counts,
  });
  // #3173: leave an audit trace of every egress scrub in the NDJSON event log.
  // COUNTS ONLY: never the prompt, the scrubbed text or any redacted value.
  // Info level, so the console mirror stays silent (MCP stdio is unaffected).
  try {
    let total = 0;
    for (const n of Object.values(counts)) total += n;
    logPortfolio('info', 'provider.llm.egress.redacted', `LLM egress redaction (${provider}): ${total} value(s) redacted`, {
      context: {
        provider,
        model,
        input_chars: text.length,
        scrubbed_chars: scrubbed.length,
        redaction_total: total,
        redactions: { ...counts },
      },
    });
  } catch { /* logging must never block an LLM call */ }
  return scrubbed;
}
