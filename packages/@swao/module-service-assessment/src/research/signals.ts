// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * RESEARCH.* signals for Pass 24 (Design 103 §6.2.2, #3154).
 *
 * Same pattern as SCAFFOLD.* and BINARY.*: `RES-NN` ids with a `code` naming
 * the Design 103 signal class, on the core Signal interface, written to
 * `apps/<id>/wsp/signals/research-signals.json` only, so the WSP signal id
 * vocabulary (SIGNAL_ID_REGEX) is unchanged. The signals are derived from the
 * final research stubs (fresh, unchanged, or analyst-promoted), so a run
 * without `--refresh` never empties the file.
 *
 * `source` is `static_analysis`: the closest core source value for a
 * deterministic rule over public-API data (no LLM, no workshop input).
 * Evidence carries public URLs and stub paths only, never intake data.
 *
 * #3304: signals from LLM findings (Design 103 §6.2.4) use `source:
 * llm_inference` and `assessor: llm`, are capped at `medium` severity and
 * confidence, never set `legacy_tier`, and mark every model-cited URL as not
 * verified.
 *
 * #3308: prompt version 1.1 adds a structured `facts` block, from which the
 * other five §6.2.4 classes are derived (VENDOR.PATCH_CADENCE_SLOW,
 * DATA.NO_EU_ENTITY, DATA.GDPR_ART9_NO_DPA, MDR.CLASS_UNCLEAR,
 * MDR.NOT_REGISTERED_BFARM). Only an explicit value emits: `unknown`, a null
 * number, an absent field, or a version 1.0 stub without facts never does.
 * The regulatory conditions of the design table come from the app `data`
 * block (ResearchAppContext); without it the conditional signals do not emit.
 */

import { join } from 'node:path';
import { z } from 'zod';
import { SignalSchema } from '@swao/core';
import { minConfidence } from './confidence.js';
import { BsiBlockSchema, CveBlockSchema, EolBlockSchema, KevBlockSchema, LlmBlockSchema, VtBlockSchema, type LlmBlock, type LlmFinding } from './schema.js';
import { readStub } from './stub-file.js';

export const RESEARCH_SIGNALS = {
  'CVE.CISA_KEV_MATCH':           { id: 'RES-01', severity: 'critical', category: 'application' },
  'CVE.CRITICAL_OPEN':            { id: 'RES-02', severity: 'critical', category: 'application' },
  'CVE.CRITICAL_PATCH_AVAILABLE': { id: 'RES-03', severity: 'high',     category: 'application' },
  'CVE.HIGH_SEVERITY_OPEN':       { id: 'RES-04', severity: 'high',     category: 'application' },
  'EOL.OS_PAST_EOS':              { id: 'RES-05', severity: 'high',     category: 'infrastructure_platform' },
  'EOL.OS_WITHIN_18_MONTHS':      { id: 'RES-06', severity: 'high',     category: 'infrastructure_platform' },
  'ADVISORY.BSI_CERT_BUND':       { id: 'RES-07', severity: 'medium',   category: 'application' },
  'BINARY.VT_DETECTION_RATIO':    { id: 'RES-08', severity: 'critical', category: 'application' },
  // #3304: from LLM findings (Design 103 §6.2.4); unverified, so never above medium and never a blocker.
  'VENDOR.BREACH_HISTORY':        { id: 'RES-09', severity: 'medium',   category: 'application' },
  // #3308: from the structured facts of prompt version 1.1. The design table rates some of these
  // high or critical; as model claims they are capped at medium, so medium is the definition.
  'VENDOR.PATCH_CADENCE_SLOW':    { id: 'RES-10', severity: 'medium',   category: 'application' },
  'DATA.NO_EU_ENTITY':            { id: 'RES-11', severity: 'medium',   category: 'application' },
  'DATA.GDPR_ART9_NO_DPA':        { id: 'RES-12', severity: 'medium',   category: 'application' },
  'MDR.CLASS_UNCLEAR':            { id: 'RES-13', severity: 'medium',   category: 'application' },
  'MDR.NOT_REGISTERED_BFARM':     { id: 'RES-14', severity: 'medium',   category: 'application' },
} as const;

/** Codes derived from LLM answers (#3304, #3308): `source: llm_inference`, `assessor: llm`, capped at medium. */
export const LLM_RESEARCH_SIGNAL_CODES: readonly ResearchSignalCode[] = [
  'VENDOR.BREACH_HISTORY', 'VENDOR.PATCH_CADENCE_SLOW', 'DATA.NO_EU_ENTITY', 'DATA.GDPR_ART9_NO_DPA',
  'MDR.CLASS_UNCLEAR', 'MDR.NOT_REGISTERED_BFARM',
];

/** Patch cadence above this many days emits VENDOR.PATCH_CADENCE_SLOW (Design 103 §6.2.4). */
export const PATCH_CADENCE_SLOW_DAYS = 90;

/**
 * Regulatory context of an app (#3308), read from the `data` block of its
 * `.swao.yml` (`data.regulatory`, `data.health_data`, `data.gdpr_art9`). Gates
 * DATA.NO_EU_ENTITY, DATA.GDPR_ART9_NO_DPA, and MDR.NOT_REGISTERED_BFARM.
 * Never sent to the LLM.
 */
export interface ResearchAppContext {
  regulatory: readonly string[];
  healthData: boolean | null;
  gdprArt9: boolean | null;
}

export type ResearchSignalCode = keyof typeof RESEARCH_SIGNALS;
export const RESEARCH_SIGNAL_CODES = Object.keys(RESEARCH_SIGNALS) as ResearchSignalCode[];
export const RESEARCH_SIGNALS_FILE = 'research-signals.json';

export const ResearchSignalSchema = SignalSchema.extend({
  id: z.string().regex(/^RES-\d{2}$/),
  code: z.enum(RESEARCH_SIGNAL_CODES as [ResearchSignalCode, ...ResearchSignalCode[]]),
});
export type ResearchSignal = z.infer<typeof ResearchSignalSchema>;

export const ResearchSignalsFileSchema = z.object({
  generated_at: z.string(),
  app_id: z.string(),
  signals: z.array(ResearchSignalSchema),
});
export type ResearchSignalsFile = z.infer<typeof ResearchSignalsFileSchema>;

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
type Confidence = 'high' | 'medium' | 'low';

const SEVERITY_RANK: Record<Severity, number> = { informational: 0, low: 1, medium: 2, high: 3, critical: 4 };

function researchSignal(
  code: ResearchSignalCode,
  args: { derivation: string; evidence: string[]; confidence: Confidence | null | undefined; severity?: Severity },
): ResearchSignal {
  const def = RESEARCH_SIGNALS[code];
  const fromLlm = LLM_RESEARCH_SIGNAL_CODES.includes(code);
  const severity: Severity = args.severity ?? def.severity;
  return {
    id: def.id,
    code,
    source: fromLlm ? 'llm_inference' : 'static_analysis',
    category: def.category,
    // #3304: model claims are unverified; never above medium, so never critical or a blocker.
    severity: fromLlm && SEVERITY_RANK[severity] > SEVERITY_RANK.medium ? 'medium' : severity,
    outcome: 'negative',
    derivation: args.derivation,
    evidence: args.evidence,
    confidence: (fromLlm ? minConfidence([args.confidence ?? 'medium', 'medium']) : args.confidence) ?? 'medium',
    assessor: fromLlm ? 'llm' : 'rule_engine',
  };
}

/**
 * A finding that reports the absence of an incident ("No publicly documented
 * breaches ...") despite the prompt asking for an empty list in that case.
 * Such a finding is not evidence of a breach. Only absence phrasings count, so
 * an incident stated as "No customer data was affected in the 2023 ..." is kept.
 */
const NEGATIVE_FINDING = /^\s*(?:there\s+(?:are|were|is|was|have\s+been|has\s+been)\s+no\b|no\s+(?:publicly\s+)?(?:documented|reported|known|public|disclosed|recorded|evidence)\b|none\s+(?:found|reported|documented|known)\b|nothing\s+(?:found|documented|reported|known|publicly)\b|not\s+aware\b|we\s+(?:found|could\s+find)\s+no\b)/i;

export const isNegativeFinding = (f: Pick<LlmFinding, 'statement'>): boolean => NEGATIVE_FINDING.test(f.statement);

/** Evidence line for a model-cited source: SWAO never opened the URL. */
const modelCited = (url: string): string => `${url} (cited by the model, not verified)`;

const BSI_SEVERITY: Record<string, Severity> = { kritisch: 'critical', hoch: 'high', mittel: 'medium', niedrig: 'low' };

/** Source blocks are read leniently: an unparseable or hand-edited block yields no signal rather than an error. */
function block<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

const stubRef = (topic: string): string => `wsp/inputs/research/${topic}.md`;

/** A researched LLM topic block without an error, or null (#3304, #3308). */
function researchedLlm(front: Record<string, unknown> | undefined): LlmBlock | null {
  const b = front?.['status'] === 'researched' ? block(LlmBlockSchema, front['llm']) : null;
  return b && !b.error ? b : null;
}

/**
 * One signal from a structured fact (#3308): the derivation names the model and
 * prompt version and states that the fact is unverified; the evidence is the
 * stub plus the model-cited fact sources. Without a cited source the confidence is low.
 */
function factSignal(code: ResearchSignalCode, topic: string, b: LlmBlock, statement: string): ResearchSignal {
  const sources = b.facts?.sources ?? [];
  return researchSignal(code, {
    confidence: sources.length > 0 ? 'medium' : 'low',
    derivation: `${statement} Structured fact LLM-researched by ${b.provider ?? 'unknown'} / ${b.model ?? 'unknown'} ` +
      `(prompt ${b.prompt_version ?? 'unknown'}); model-cited and unverified until an analyst reviews ${topic}.md (reviewed_by).`,
    evidence: [stubRef(topic), ...sources.map((s) => modelCited(s.url)).slice(0, 10)],
  });
}

const hasRegime = (ctx: ResearchAppContext | null | undefined, regime: string): boolean =>
  !!ctx && ctx.regulatory.some((r) => r.trim().toUpperCase() === regime);

/**
 * Derive RESEARCH.* signals from an app's research stubs (`apps/<id>/wsp/inputs/research/`).
 * `context` (#3308) gates the conditional LLM signals; without it they do not emit.
 */
export function researchSignals(researchDir: string, context?: ResearchAppContext | null): ResearchSignal[] {
  const out: ResearchSignal[] = [];
  const cveFront = readStub(join(researchDir, 'cve-summary.md'))?.front;
  const eolFront = readStub(join(researchDir, 'eol-status.md'))?.front;
  const vtFront = readStub(join(researchDir, 'virustotal.md'))?.front;
  const breachFront = readStub(join(researchDir, 'breach-history.md'))?.front;

  const cve = block(CveBlockSchema, cveFront?.['cve']);
  const kev = block(KevBlockSchema, cveFront?.['kev']);
  const bsi = block(BsiBlockSchema, cveFront?.['bsi']);

  if (kev && !kev.error && kev.matches.length > 0) {
    out.push(researchSignal('CVE.CISA_KEV_MATCH', {
      confidence: cve?.confidence ?? kev.confidence,
      derivation: `${kev.matches.length} CVE(s) found for this product are in the CISA Known Exploited Vulnerabilities catalogue (${kev.catalog_version ?? 'version n/a'}); actively exploited, a blocker for migration as-is.`,
      evidence: [stubRef('cve-summary'), ...kev.matches.slice(0, 10).map((m) => `https://nvd.nist.gov/vuln/detail/${m.cve}${m.due_date ? ` (CISA due ${m.due_date})` : ''}`)],
    }));
  }
  if (cve && !cve.error && !cve.note && cve.count !== null) {
    const severeRefs = (sev: string) => cve.top.filter((t) => t.severity === sev).slice(0, 10).map((t) => `${t.url} (CVSS ${t.score ?? 'n/a'})`);
    const patched = cve.patch_available === true;
    const lowerBound = cve.truncated ? ' NVD reported more results than were paged in, so the counts are a lower bound.' : '';
    if ((cve.critical_count ?? 0) > 0) {
      out.push(researchSignal(patched ? 'CVE.CRITICAL_PATCH_AVAILABLE' : 'CVE.CRITICAL_OPEN', {
        confidence: cve.confidence,
        derivation: `NVD keyword "${cve.query}" returned ${cve.critical_count} critical CVE(s); patch availability ${String(cve.patch_available)} (from NVD reference tags).${lowerBound}`,
        evidence: [stubRef('cve-summary'), ...severeRefs('CRITICAL')],
      }));
    }
    if ((cve.high_count ?? 0) > 0 && !patched) {
      out.push(researchSignal('CVE.HIGH_SEVERITY_OPEN', {
        confidence: cve.confidence,
        derivation: `NVD keyword "${cve.query}" returned ${cve.high_count} high-severity CVE(s) without a confirmed patch for every severe finding.${lowerBound}`,
        evidence: [stubRef('cve-summary'), ...severeRefs('HIGH')],
      }));
    }
  }
  if (bsi && !bsi.error && (bsi.alert_count ?? 0) > 0) {
    out.push(researchSignal('ADVISORY.BSI_CERT_BUND', {
      confidence: bsi.confidence,
      severity: (bsi.highest_severity ? BSI_SEVERITY[bsi.highest_severity] : undefined) ?? 'medium',
      derivation: `${bsi.alert_count} recent BSI CERT-Bund advisory(ies) match the vendor or product name; highest severity ${bsi.highest_severity ?? 'n/a'}. The feed covers recent advisories only.`,
      evidence: [stubRef('cve-summary'), ...bsi.alerts.slice(0, 10).map((a) => a.url)],
    }));
  }

  const eol = block(EolBlockSchema, eolFront?.['eol']);
  if (eol && !eol.error && eol.date) {
    const evidence = [stubRef('eol-status'), ...(eol.evidence_url ? [eol.evidence_url] : [])];
    if (eol.is_eol) {
      out.push(researchSignal('EOL.OS_PAST_EOS', {
        confidence: eol.confidence,
        derivation: `${eol.product} ${eol.cycle} reached end of support on ${eol.date}${eol.extended_support_until ? `; extended support until ${eol.extended_support_until}` : ''} (endoflife.date).`,
        evidence,
      }));
    } else if (eol.months_until_eol !== null && eol.months_until_eol <= 18) {
      out.push(researchSignal('EOL.OS_WITHIN_18_MONTHS', {
        confidence: eol.confidence,
        derivation: `${eol.product} ${eol.cycle} reaches end of support on ${eol.date}, ${eol.months_until_eol} month(s) from the research date (endoflife.date).`,
        evidence,
      }));
    }
  }

  const vt = block(VtBlockSchema, vtFront?.['vt']);
  if (vt && !vt.error && !vt.skipped_reason && (vt.malicious ?? 0) > 0) {
    out.push(researchSignal('BINARY.VT_DETECTION_RATIO', {
      confidence: vt.confidence,
      derivation: `VirusTotal reports ${vt.malicious} malicious engine verdict(s) (ratio ${vt.detection_ratio ?? 'n/a'}) for the supplied installer hash.`,
      evidence: [stubRef('virustotal'), ...(vt.permalink ? [vt.permalink] : [])],
    }));
  }

  // #3304: VENDOR.BREACH_HISTORY from LLM findings (Design 103 §6.2.4). The prompt asks for
  // no findings when nothing is documented, so a non-empty list is the `vendor_breaches` case.
  const breach = researchedLlm(breachFront);
  const incidents = breach ? breach.findings.filter((f) => !isNegativeFinding(f)) : [];
  if (breach && incidents.length > 0) {
    out.push(researchSignal('VENDOR.BREACH_HISTORY', {
      confidence: minConfidence([breach.confidence, ...incidents.map((f) => f.confidence)]),
      derivation: `${incidents.length} publicly reported security incident(s) or data breach(es) for this vendor or product, ` +
        `LLM-researched by ${breach.provider ?? 'unknown'} / ${breach.model ?? 'unknown'} (prompt ${breach.prompt_version ?? 'unknown'}); ` +
        `model-cited and unverified until an analyst reviews breach-history.md (reviewed_by): ${incidents.slice(0, 3).map((f) => f.statement).join(' | ')}`,
      evidence: [stubRef('breach-history'), ...incidents.flatMap((f) => f.sources.map((s) => modelCited(s.url))).slice(0, 10)],
    }));
  }

  // #3308: the five structured-fact signals of Design 103 §6.2.4. Only explicit values emit.
  const profile = researchedLlm(readStub(join(researchDir, 'vendor-profile.md'))?.front);
  const certs = researchedLlm(readStub(join(researchDir, 'certifications.md'))?.front);
  const residency = researchedLlm(readStub(join(researchDir, 'data-residency.md'))?.front);
  const art9 = hasRegime(context, 'GDPR_ART9') || context?.gdprArt9 === true;
  const healthData = context?.healthData === true || context?.gdprArt9 === true;

  const cadence = profile?.facts?.patch_cadence_days_estimate;
  if (profile && typeof cadence === 'number' && cadence > PATCH_CADENCE_SLOW_DAYS) {
    out.push(factSignal('VENDOR.PATCH_CADENCE_SLOW', 'vendor-profile', profile,
      `The vendor typically takes about ${cadence} days to patch a critical vulnerability (estimate), more than ${PATCH_CADENCE_SLOW_DAYS} days.`));
  }
  if (profile?.facts?.eu_entity === 'no' && art9) {
    out.push(factSignal('DATA.NO_EU_ENTITY', 'vendor-profile', profile,
      'The vendor has no legal entity in the European Union, and the app processes special-category data (GDPR Art. 9).'));
  }
  if (residency?.facts?.gdpr_dpa_available === 'no' && healthData) {
    out.push(factSignal('DATA.GDPR_ART9_NO_DPA', 'data-residency', residency,
      'No GDPR data processing agreement is offered for this product, and the app processes health data (GDPR Art. 9).'));
  }
  if (certs?.facts?.mdr_class === 'class_not_published') {
    out.push(factSignal('MDR.CLASS_UNCLEAR', 'certifications', certs,
      'The product is stated to be a medical device under EU MDR 2017/745, but no device class is published.'));
  }
  if (certs?.facts?.bfarm_listed === 'no' && certs.facts.mdr_class !== 'not_a_medical_device' && hasRegime(context, 'MDR')) {
    out.push(factSignal('MDR.NOT_REGISTERED_BFARM', 'certifications', certs,
      'The product is not listed in the German BfArM medical device database, and the app is in MDR scope.'));
  }
  return out;
}
