// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Signal, SignalOutcome } from './plugin-types.js';

/**
 * Canonical signal schema block to embed in every LLM prompt.
 * Forces the model to use exact field names and lowercase enum values.
 *
 * v0.10 (ADR-0025; design 020) adds the auditor-grade fields:
 * `outcome`, `false_positive_considered`, `false_positive_ruled_out`,
 * `derivation_chain`. The model is asked to emit them; the normaliser
 * fills conservative defaults when they are missing.
 */
export const SIGNAL_SCHEMA_HINT = `
Each Signal object in the "signals" array MUST contain EXACTLY these fields:
{
  "id":         "<PREFIX>-NN"         -- e.g. "DATA-01", "CTX-02", "SYNTH-01"
  "source":     "<source>"            -- MUST be one of (lowercase, exact): "static_analysis" | "dynamic_analysis" | "workshop" | "cmdb" | "cmdb_export" | "finops" | "llm_inference" | "incident" | "ops_runbook"
  "category":   "<category>"          -- MUST be one of (lowercase, exact): "application" | "infrastructure_platform" | "enablement" | "business_processes"
  "severity":   "<severity>"          -- MUST be one of (lowercase, exact): "critical" | "high" | "medium" | "low" | "informational" | "positive"
  "confidence": "<confidence>"        -- MUST be one of (lowercase, exact): "high" | "medium" | "low"
  "derivation": "<string>"            -- REQUIRED. >= 20 characters. Cite at least one signal_id ("CRYPTO-04") or evidence reference ("PKG-04", "INC-2025-0815"). State why the verdict holds.
  "evidence":   ["<string>", ...]     -- Required. Array of file paths or observable facts. At least one entry.

  "outcome":    "<outcome>"           -- v0.10. MUST be one of: "positive" | "negative" | "neutral" | "indeterminate".
                                          positive   = the assertion holds and supports the workload.
                                          negative   = the assertion does not hold; risk identified.
                                          neutral    = observed but not policy-relevant.
                                          indeterminate = not enough evidence to decide.

  -- The next two are REQUIRED if severity in {medium, high, critical} AND outcome = negative.
  --   Examples:
  --     "considered that this could be a test fixture; ruled out because the file path is in src/, not tests/"
  --     "considered that an EU proxy might mitigate; ruled out because providers.llm.endpoint points at api.anthropic.com directly"
  "false_positive_considered": true | false
  "false_positive_ruled_out":  "<string >= 20 chars>"

  "derivation_chain": ["<id>", ...]    -- v0.10. Optional. Ordered list of contributing signal IDs (e.g. "INV-01") or evidence IDs (e.g. "PKG-04") that produced this signal.
}
Do NOT use uppercase or mixed-case for enum values. Do NOT omit derivation or evidence.
For severity in {medium, high, critical} AND outcome = negative, do NOT skip false_positive_considered + false_positive_ruled_out: state the counter-hypothesis you considered and why you rejected it.
`.trim();

const CONFIDENCE_MAP: Record<string, Signal['confidence']> = {
  high: 'high',
  medium: 'medium',
  med: 'medium',
  low: 'low',
};

const SOURCE_MAP: Record<string, Signal['source']> = {
  static_analysis: 'static_analysis',
  dynamic_analysis: 'dynamic_analysis',
  workshop: 'workshop',
  cmdb: 'cmdb',
  cmdb_export: 'cmdb_export',
  finops: 'finops',
  llm_inference: 'llm_inference',
  incident: 'incident',
  ops_runbook: 'ops_runbook',
  ops_runbooks: 'ops_runbook',
  architecture_doc: 'llm_inference',
  architecture: 'llm_inference',
  static: 'static_analysis',
  dynamic: 'dynamic_analysis',
};

const CATEGORY_MAP: Record<string, Signal['category']> = {
  application: 'application',
  infrastructure_platform: 'infrastructure_platform',
  infrastructure: 'infrastructure_platform',
  enablement: 'enablement',
  business_processes: 'business_processes',
  business: 'business_processes',
};

const SEVERITY_MAP: Record<string, Signal['severity']> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  med: 'medium',
  low: 'low',
  informational: 'informational',
  info: 'informational',
  positive: 'positive',
};

const OUTCOME_MAP: Record<string, SignalOutcome> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
  indeterminate: 'indeterminate',
  // tolerate common synonyms an LLM might produce
  pass: 'positive',
  ok: 'positive',
  fail: 'negative',
  risk: 'negative',
  unknown: 'indeterminate',
};

/**
 * Pad a derivation string up to the v0.10 minimum length without
 * fabricating evidence. Adds an explicit annotation rather than silently
 * lengthening, so the audit log shows the padding occurred.
 */
function padDerivation(d: string): string {
  if (d.length >= 20) return d;
  const annotation = ' (LLM-emitted derivation was below v0.10 min length and was annotated by the normaliser)';
  return d + annotation;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSignal(s: any): Signal {
  const confidenceRaw = (typeof s.confidence === 'string' ? s.confidence.toLowerCase() : '') as string;
  const confidence: Signal['confidence'] = CONFIDENCE_MAP[confidenceRaw] ?? 'medium';

  const sourceRaw = (typeof s.source === 'string' ? s.source.toLowerCase() : '') as string;
  const source: Signal['source'] = SOURCE_MAP[sourceRaw] ?? 'llm_inference';

  const categoryRaw = (typeof s.category === 'string' ? s.category.toLowerCase() : '') as string;
  const category: Signal['category'] = CATEGORY_MAP[categoryRaw] ?? 'application';

  const severityRaw = typeof s.severity === 'string' ? s.severity.toLowerCase() : undefined;
  const severity: Signal['severity'] | undefined = severityRaw
    ? (SEVERITY_MAP[severityRaw] ?? 'informational')
    : undefined;

  const rawDerivation: string =
    typeof s.derivation === 'string' && s.derivation.trim().length > 0
      ? s.derivation
      : (typeof s.description === 'string' && s.description.trim().length > 0 ? s.description : 'LLM-inferred signal -- derivation not provided.');
  const derivation = padDerivation(rawDerivation);

  let evidence: string[];
  if (Array.isArray(s.evidence)) {
    evidence = s.evidence.map((e: unknown) => String(e));
  } else if (typeof s.evidence === 'string' && s.evidence.trim().length > 0) {
    evidence = [s.evidence];
  } else if (typeof s.source_file === 'string') {
    evidence = [s.source_file];
  } else {
    evidence = ['llm_inference'];
  }

  // ---- v0.10 auditor fields ----
  const outcomeRaw = typeof s.outcome === 'string' ? s.outcome.toLowerCase().trim() : undefined;
  const outcome: SignalOutcome | undefined = outcomeRaw ? OUTCOME_MAP[outcomeRaw] : undefined;

  const fpConsidered: boolean | undefined =
    typeof s.false_positive_considered === 'boolean' ? s.false_positive_considered : undefined;

  const fpRuledOutRaw =
    typeof s.false_positive_ruled_out === 'string' ? s.false_positive_ruled_out : undefined;
  // Drop strings shorter than 20 chars rather than fail validation downstream;
  // the doctor probe will warn on the resulting absence (which is more
  // honest than a padded boilerplate ruled-out narrative).
  const fpRuledOut =
    fpRuledOutRaw && fpRuledOutRaw.trim().length >= 20 ? fpRuledOutRaw : undefined;

  const chainRaw = Array.isArray(s.derivation_chain) ? s.derivation_chain : undefined;
  const derivationChain = chainRaw ? chainRaw.map((id: unknown) => String(id)).filter((x: string) => x.length > 0) : undefined;

  return {
    id: String(s.id ?? 'UNKNOWN-00'),
    source,
    category,
    severity,
    derivation,
    evidence,
    confidence,
    implies: Array.isArray(s.implies) ? s.implies.map(String) : undefined,
    signal_ref: typeof s.signal_ref === 'string' ? (s.signal_ref as Signal['signal_ref']) : undefined,
    outcome,
    false_positive_considered: fpConsidered,
    false_positive_ruled_out: fpRuledOut,
    derivation_chain: derivationChain && derivationChain.length > 0 ? derivationChain : undefined,
  };
}
