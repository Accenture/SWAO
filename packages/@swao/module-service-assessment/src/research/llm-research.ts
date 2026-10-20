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
 * LLM-augmented service research (Design 103 §6.2.4, #3289, Design 110 D-07).
 *
 * Researches vendor-profile, certifications, data-residency, and
 * breach-history through the workspace LLM provider, in every licence tier.
 * The host passes a provider built by the @swao/module-llm-providers factory,
 * so the shared request helper (events in the SWAO logs, retries, the
 * `max_concurrency` limiter, #3284) and the egress redaction of every driver
 * (scrubForEgress, design 032 §2.1) apply to each call. This module depends
 * only on the `complete()` shape of that provider.
 *
 * Every source URL in a finding is the model's own claim: SWAO never fetches
 * it, so each is recorded as `cited_by: model`, `verified: false`, and the
 * topic confidence is capped at `medium` (§6.2.6: LLM results are unverified
 * until an analyst promotes them).
 */

import { z } from 'zod';
import { minConfidence } from './confidence.js';
import { LLM_RESEARCH_PROMPT_VERSION, buildLlmResearchPrompt, type LlmResearchPromptInput, type LlmResearchTopic } from './llm-prompts.js';
import {
  LLM_MDR_CLASSES, LLM_SKIP_REASONS, LlmFactsSchema, ResearchConfidenceSchema,
  type LlmBlock, type LlmFacts, type LlmFinding, type LlmTriState, type ResearchConfidence,
} from './schema.js';

/** The part of the LlmProvider interface (@swao/module-llm-providers) research uses. */
export interface ResearchLlm {
  readonly name: string;
  readonly model: string;
  complete(prompt: string): Promise<string>;
}

/** Highest confidence an LLM topic can reach without analyst review (§6.2.6). */
export const LLM_CONFIDENCE_CAP: ResearchConfidence = 'medium';

const MAX_FINDINGS = 20;
const MAX_SOURCES = 5;
const MAX_TEXT = 1000;
const MAX_ERROR = 300;

/** What the model must return (the JSON contract in llm-prompts.ts). Lenient on optional parts. */
export const LlmResearchResponseSchema = z.object({
  summary: z.string().nullable().optional(),
  findings: z.array(z.object({
    statement: z.string().min(1),
    confidence: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), ResearchConfidenceSchema).optional(),
    sources: z.array(z.union([
      z.string(),
      z.object({ url: z.string(), title: z.string().nullable().optional() }).passthrough(),
    ])).optional(),
  }).passthrough()),
  /** Structured facts (prompt version 1.1, #3308); optional, parsed leniently by parseLlmFacts. */
  facts: z.unknown().optional(),
}).passthrough();
export type LlmResearchResponse = z.infer<typeof LlmResearchResponseSchema>;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/**
 * Body of the first code fence, or null. Same result as group 1 of
 * `/```(?:json)?\s*([\s\S]*?)```/i`: after the first fence, an optional `json`
 * tag (any case) and whitespace, up to the next fence. A scan, because the
 * regex backtracks polynomially on long whitespace runs (CodeQL
 * js/polynomial-redos). Only the first fence can open a match: a later one
 * would itself be the closing fence. Exported for tests.
 */
export function fenceBody(text: string): string | null {
  const open = text.indexOf('```');
  if (open < 0) return null;
  let start = open + 3;
  if (text.slice(start, start + 4).toLowerCase() === 'json') start += 4;
  while (start < text.length && /\s/.test(text[start] as string)) start++;
  const close = text.indexOf('```', start);
  return close < 0 ? null : text.slice(start, close);
}

/** The JSON object in a model answer: code fences and text around the object are tolerated. */
export function extractJsonObject(text: string): unknown {
  const fenced = fenceBody(text);
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the response');
  return JSON.parse(candidate.slice(start, end + 1));
}

const isHttpUrl = (u: string): boolean => {
  try {
    const p = new URL(u.trim());
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
};

/** Normalise a parsed response into findings; non-HTTP(S) URLs are dropped, a finding without a source is `low`. */
export function toFindings(resp: LlmResearchResponse): LlmFinding[] {
  return resp.findings.slice(0, MAX_FINDINGS).map((f) => {
    const sources = (f.sources ?? [])
      .map((s) => (typeof s === 'string' ? { url: s, title: null } : { url: s.url, title: s.title ?? null }))
      .filter((s) => isHttpUrl(s.url))
      .slice(0, MAX_SOURCES)
      .map((s) => ({ url: s.url.trim(), title: s.title ? clip(s.title, 200) : null, cited_by: 'model' as const, verified: false as const }));
    const confidence: ResearchConfidence = sources.length === 0 ? 'low' : f.confidence ?? 'low';
    return { statement: clip(f.statement.trim(), MAX_TEXT), confidence, sources };
  });
}

/** Fact fields each topic may set (#3308); a field outside its topic is ignored. */
export const LLM_TOPIC_FACT_KEYS: Record<LlmResearchTopic, readonly (keyof LlmFacts)[]> = {
  'vendor-profile': ['eu_entity', 'patch_cadence_days_estimate'],
  certifications: ['mdr_class', 'bfarm_listed'],
  'data-residency': ['gdpr_dpa_available'],
  'breach-history': [],
};

const YES = new Set(['yes', 'true', 'y', 'ja']);
const NO = new Set(['no', 'false', 'n', 'nein']);

/** yes / no / unknown from a model value; anything unrecognised is `unknown`. */
function triState(v: unknown): LlmTriState {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (typeof v !== 'string') return 'unknown';
  const t = v.trim().toLowerCase();
  return YES.has(t) ? 'yes' : NO.has(t) ? 'no' : 'unknown';
}

/** A positive day count from a number or numeric string; anything else is null. */
function days(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** An EU MDR class answer; case-insensitive on the class, anything unrecognised is `unknown`. */
function mdrClass(v: unknown): LlmFacts['mdr_class'] {
  if (typeof v !== 'string') return 'unknown';
  const t = v.trim().replace(/^class\s+/i, '').toLowerCase();
  return LLM_MDR_CLASSES.find((c) => c.toLowerCase() === t) ?? 'unknown';
}

/**
 * Structured facts of a topic (#3308), normalised leniently: an absent,
 * non-object, or partly invalid `facts` block never fails the topic; invalid
 * values become `unknown` (or null), so they never produce a signal. Only the
 * fields of `topic` are kept. Returns undefined when the topic has no fact
 * fields or the answer has no `facts` object (a version 1.0 answer).
 */
export function parseLlmFacts(topic: LlmResearchTopic, raw: unknown): LlmFacts | undefined {
  const keys = LLM_TOPIC_FACT_KEYS[topic];
  if (keys.length === 0 || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const facts: LlmFacts = {};
  for (const k of keys) {
    switch (k) {
      case 'eu_entity':
      case 'bfarm_listed':
      case 'gdpr_dpa_available':
        facts[k] = triState(r[k]);
        break;
      case 'patch_cadence_days_estimate':
        facts[k] = days(r[k]);
        break;
      case 'mdr_class':
        facts[k] = mdrClass(r[k]);
        break;
      case 'sources':
        break;
    }
  }
  const sources = (Array.isArray(r['sources']) ? r['sources'] : [])
    .map((s: unknown) => (typeof s === 'string' ? s : s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string' ? (s as { url: string }).url : ''))
    .filter(isHttpUrl)
    .slice(0, MAX_SOURCES)
    .map((url) => ({ url: url.trim(), title: null, cited_by: 'model' as const, verified: false as const }));
  if (sources.length > 0) facts.sources = sources;
  return LlmFactsSchema.parse(facts);
}

/** Topic confidence: the weakest finding, capped at LLM_CONFIDENCE_CAP; `low` when the model found nothing. */
export function llmTopicConfidence(findings: readonly LlmFinding[]): ResearchConfidence {
  if (findings.length === 0) return 'low';
  return minConfidence([...findings.map((f) => f.confidence), LLM_CONFIDENCE_CAP]) ?? 'low';
}

export function emptyLlmBlock(): LlmBlock {
  return {
    source: 'llm', fetched_at: null, confidence: null, provenance: null,
    provider: null, model: null, prompt_version: null, summary: null, findings: [],
  };
}

export interface LlmResearchOutcome {
  block: LlmBlock;
  /** Set when the topic could not be researched (LLM_SKIP_REASONS.error / .malformed). */
  skippedReason: string | null;
}

/**
 * Research one topic. Never throws: a provider error or a malformed answer is
 * returned as a skipped outcome so the other topics and apps continue.
 */
export async function researchTopicWithLlm(
  llm: ResearchLlm,
  topic: LlmResearchTopic,
  input: LlmResearchPromptInput,
  now: Date,
): Promise<LlmResearchOutcome> {
  const base: LlmBlock = {
    ...emptyLlmBlock(), fetched_at: now.toISOString(), provider: llm.name, model: llm.model, prompt_version: LLM_RESEARCH_PROMPT_VERSION,
  };
  let raw: string;
  try {
    raw = await llm.complete(buildLlmResearchPrompt(topic, input));
  } catch (e) {
    return { block: { ...base, error: clip((e as Error).message ?? String(e), MAX_ERROR) }, skippedReason: LLM_SKIP_REASONS.error };
  }
  let parsed: LlmResearchResponse;
  try {
    const r = LlmResearchResponseSchema.safeParse(extractJsonObject(raw));
    if (!r.success) throw new Error(`response does not match the research schema: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
    parsed = r.data;
  } catch (e) {
    return { block: { ...base, error: clip((e as Error).message, MAX_ERROR) }, skippedReason: LLM_SKIP_REASONS.malformed };
  }
  const findings = toFindings(parsed);
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? clip(parsed.summary.trim(), MAX_TEXT) : null;
  const facts = parseLlmFacts(topic, parsed.facts);
  return {
    block: { ...base, confidence: llmTopicConfidence(findings), provenance: 'LLM-researched', summary, findings, ...(facts ? { facts } : {}) },
    skippedReason: null,
  };
}

const TOPIC_TITLES: Record<LlmResearchTopic, string> = {
  'vendor-profile': 'Vendor profile',
  certifications: 'Certifications',
  'data-residency': 'Data residency',
  'breach-history': 'Breach history',
};

/** Generated Markdown body of an LLM topic stub. */
export function llmBody(topic: LlmResearchTopic, block: LlmBlock, skippedNote: string | null): string {
  const title = `## ${TOPIC_TITLES[topic]}`;
  if (skippedNote) return `${title}\n\n${skippedNote}`;
  const lines = [title, '', `LLM-researched by ${block.provider ?? 'unknown'} / ${block.model ?? 'unknown'} on ${block.fetched_at ?? 'unknown date'} (prompt ${block.prompt_version ?? 'unknown'}). Unverified: review the findings and sources, then set reviewed_by / reviewed_at to promote them to user-provided.`, ''];
  if (block.summary) lines.push(block.summary, '');
  if (block.facts) {
    const { sources, ...values } = block.facts;
    const shown = Object.entries(values).map(([k, v]) => `${k}: ${v ?? 'unknown'}`);
    if (shown.length > 0) lines.push(`Structured facts stated by the model (unverified): ${shown.join('; ')}.`);
    for (const s of sources ?? []) lines.push(`- Source for the facts cited by the model, not verified: ${s.url}`);
    lines.push('');
  }
  if (block.findings.length === 0) lines.push('No findings returned.');
  for (const f of block.findings) {
    lines.push(`- ${f.statement} (confidence ${f.confidence})`);
    for (const s of f.sources) lines.push(`  - Source cited by the model, not verified: ${s.url}${s.title ? ` (${s.title})` : ''}`);
  }
  return lines.join('\n');
}
