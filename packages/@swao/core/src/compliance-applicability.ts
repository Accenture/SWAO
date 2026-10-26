// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core: compliance control applicability
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #3425 follow-up: the single Design 104 Q-CODE-7 `applies_when` matcher.
 * Pass 11 (`@swao/module-framework` compliance-evaluator) and the publication
 * extractor (augmentation of catalogue controls Pass 11 did not assess) both
 * call this, so a control is N/A under exactly the same condition in both.
 *
 * Semantics:
 *   - an empty or absent `applies_when` always applies;
 *   - otherwise every key must be present in `frameworkContext` and its value
 *     must equal one of the catalogue alternatives (`|`-separated, trimmed,
 *     e.g. "energy|water");
 *   - context values are stringified, so an unquoted YAML scalar
 *     (`has_ot_systems: true`) matches the catalogue string "true";
 *   - a null context value counts as absent.
 */
export function appliesWhenMatches(
  appliesWhen: Readonly<Record<string, unknown>> | null | undefined,
  frameworkContext: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (!appliesWhen || Object.keys(appliesWhen).length === 0) return true;
  if (!frameworkContext) return false;
  return Object.entries(appliesWhen).every(([k, v]) => {
    const actual = frameworkContext[k];
    if (actual === undefined || actual === null) return false;
    const wanted = String(v).split('|').map((x) => x.trim());
    return wanted.includes(String(actual).trim());
  });
}

// ---------------------------------------------------------------------------
// Why an UNKNOWN control was not evaluated (#3425 follow-up, #3426, #3436)
// ---------------------------------------------------------------------------

/**
 * Reason a Pass 11 control carries UNKNOWN without a model verdict:
 *   - `out_of_scope`: its `assessment_type_scope` excludes the run's type
 *     (#3425; rule engine, no LLM call);
 *   - `insufficient_evidence`: the LLM proposed GAP but cited only
 *     missing-input / skipped-pass signals (#3426 post-check);
 *   - `llm_unavailable`: the control's LLM batch failed or returned no usable
 *     answer (#3436; retries exhausted, unparseable or missing evaluation).
 * Pass 11 writes it as `not_evaluated_reason` on the WSP control and starts the
 * rationale with the matching prefix below, so a consumer that only sees the
 * rationale (the publication model carries `rationale`, not the field) still
 * classifies the control the same way.
 */
export const COMPLIANCE_NOT_EVALUATED_REASONS = ['out_of_scope', 'insufficient_evidence', 'llm_unavailable'] as const;
export type ComplianceNotEvaluatedReason = (typeof COMPLIANCE_NOT_EVALUATED_REASONS)[number];

/** Rationale prefix per reason; Pass 11 rationales start with exactly this text. */
export const NOT_EVALUATED_RATIONALE_PREFIX: Readonly<Record<ComplianceNotEvaluatedReason, string>> = {
  out_of_scope: 'Not evaluated: the control is scoped to assessment types',
  insufficient_evidence: 'Not assessed (insufficient evidence',
  llm_unavailable: 'Not evaluated: the compliance LLM evaluation',
};

function isNotEvaluatedReason(v: unknown): v is ComplianceNotEvaluatedReason {
  return typeof v === 'string' && (COMPLIANCE_NOT_EVALUATED_REASONS as readonly string[]).includes(v);
}

/**
 * Classify why a control was not evaluated: the structured
 * `not_evaluated_reason` wins, else the rationale prefix; null when neither
 * marks it (an ordinary UNKNOWN or a real verdict).
 */
export function complianceNotEvaluatedReason(
  c: { not_evaluated_reason?: unknown; rationale?: unknown } | null | undefined,
): ComplianceNotEvaluatedReason | null {
  if (!c) return null;
  if (isNotEvaluatedReason(c.not_evaluated_reason)) return c.not_evaluated_reason;
  if (typeof c.rationale !== 'string') return null;
  const r = c.rationale.trimStart();
  for (const reason of COMPLIANCE_NOT_EVALUATED_REASONS) {
    if (r.startsWith(NOT_EVALUATED_RATIONALE_PREFIX[reason])) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// #3414: evidence-quality guard markers (Pass 11 writes, publication reads)
// ---------------------------------------------------------------------------

/**
 * Rationale prefix of a GAP that Pass 11 capped at PARTIAL because no cited
 * signal is verified evidence (#3414). Deliberately not one of the
 * NOT_EVALUATED_RATIONALE_PREFIX values: the control was evaluated, only the
 * strength of the verdict is limited.
 */
export const UNVERIFIED_EVIDENCE_RATIONALE_PREFIX = 'Capped at PARTIAL (unverified evidence)';

/** Marker of the trailing evidence-basis sentence Pass 11 appends to a control rationale (#3414). */
export const EVIDENCE_BASIS_MARKER = 'Evidence basis:';

/** "Evidence basis: based on N signals, M in test code, K low confidence." (#3414) */
export function formatEvidenceBasis(signals: number, testCode: number, lowConfidence: number): string {
  if (signals === 0) return `${EVIDENCE_BASIS_MARKER} no cited signals.`;
  return `${EVIDENCE_BASIS_MARKER} based on ${signals} signal${signals === 1 ? '' : 's'}, ${testCode} in test code, ${lowConfidence} low confidence.`;
}

/**
 * Split a control rationale into the model or rule text and the trailing
 * evidence-basis sentence (null when absent), so a view that shortens the
 * rationale keeps the evidence line visible (#3414).
 */
export function splitEvidenceBasis(rationale: string): { body: string; basis: string | null } {
  const i = rationale.lastIndexOf(` ${EVIDENCE_BASIS_MARKER} `);
  if (i < 0) return { body: rationale, basis: null };
  return { body: rationale.slice(0, i), basis: rationale.slice(i + 1) };
}
