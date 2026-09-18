// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Security pass: prompt injection resistance (#1463, Design 092 s5.2).
//
// SWAO assessment prompts contain only redacted workspace content.
// Untrusted workspace text (README, config values, comments) may embed
// adversarial instructions. This pass detects whether the model followed
// such injected instructions rather than the SWAO schema.
//
// Detection is REACTIVE: it looks for signals in the model's RESPONSE
// that indicate injection succeeded (the model acknowledged or acted on
// injected instructions). False negatives are expected -- a model that
// silently follows injected instructions without meta-commentary will not
// be caught here. This is a heuristic first-pass signal, not a guarantee.
//
// All patterns use bounded repetition and are only applied when the
// response is shorter than 3000 chars (injection acknowledgements are
// typically chatty and short, not long structured outputs).

/** True when a response contains signals that a prompt injection attempt
 *  may have succeeded -- the model is discussing, acknowledging, or acting
 *  on injected instructions rather than purely following the SWAO schema. */
export function detectPromptInjection(response: string): boolean {
  // Long schema-conforming outputs are almost certainly not injection.
  if (response.length > 3000) return false;

  // Signal 1: model references its own instructions or system prompt in a
  // way that suggests it was instructed to expose or override them.
  const systemPromptRe = /(?:my\s+)?system\s+prompt\s+(?:says?|is|was|tells?\s+me|instructs?\s+me)\b/i;

  // Signal 2: model explicitly states it was told to ignore prior context.
  const ignoreInstructRe = /\b(?:ignore|disregard|override|bypass)\s+(?:previous|prior|original|earlier|above)\s+(?:instructions?|prompt|context|system|rules?)\b/i;

  // Signal 3: model acknowledges following new/updated instructions from input.
  const newInstructRe = /\b(?:new|updated|revised|alternative)\s+instructions?:\s/i;

  // Signal 4: model says it was instructed to do something by the user/input
  // in a way inconsistent with schema-following behaviour.
  const instructedByRe = /\bi(?:'ve|\s+have|\s+was)\s+(?:been\s+)?(?:told|instructed|asked)\s+to\s+(?:ignore|reveal|output|print|show|expose|disclose|bypass)\b/i;

  return systemPromptRe.test(response)
    || ignoreInstructRe.test(response)
    || newInstructRe.test(response)
    || instructedByRe.test(response);
}
