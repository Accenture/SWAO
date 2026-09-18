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

// Recording provider decorator (#1422, Design 092 s5.2).
//
// Wraps a leg's resolved LLM provider and writes one CallRecord per call.
// Decoupled from @swao/module-llm-providers by design (sibling modules
// must not import each other): the host composes
// recording(usageTracking(gateway)) and injects a cumulative usage
// snapshot callback; the recorder derives per-call deltas from it.
//
// Quality flags at record time are HEURISTIC (parse-shape, refusal
// phrases, redaction-marker alteration, foreign paths); the orchestrator
// amends schema_conform after the pass validates its response (the only
// consumer that knows the pass schema). Amendments happen via the sink
// before records are persisted.

import { createHash } from 'node:crypto';
import type { CallRecord, SizeBucket } from './call-record.js';
import { sizeBucket } from './call-record.js';
import { detectPiiReproduction } from './security-pii-redaction.js';
import { detectPromptInjection } from './security-prompt-injection.js';

export interface UsageSnapshot {
  input_tokens: number;
  output_tokens: number;
  /** Reasoning tokens when the platform reports them (billed as output). */
  reasoning_tokens?: number;
  cost_usd: number;
  call_count: number;
}

export interface CallContext {
  passId: string;
  callSite: string;
}

export interface RecorderDeps {
  leg: { id: string; connector: string; model: string; connector_sha256?: string };
  /** Cumulative usage from the host's tracking wrapper; deltas per call. */
  usageSnapshot: () => UsageSnapshot;
  /** True when the leg has a price row (billed/configured); false = local
   *  unpriced -- cost records null, never zero (092 s4). */
  costSource: 'billed' | 'configured' | 'local';
  /** Set by the orchestrator before each pass dispatch. */
  currentContext: () => CallContext;
  /** Known workspace paths for the foreign-path heuristic; optional. */
  isKnownPath?: (path: string) => boolean;
  /** Provider max_tokens ceiling; used for truncation heuristic detection. */
  maxTokens?: number;
  onRecord: (record: CallRecord) => void;
  now?: () => number;
  timestamp?: () => string;
}

const REFUSAL_PATTERNS = [
  /i can(?:'|no)t (?:help|assist|comply)/i,
  /i(?:'m| am) (?:unable|not able) to (?:help|assist|provide|comply)/i,
  /against (?:my|our) (?:policy|guidelines)/i,
  /i must (?:decline|refuse)/i,
];

/** Redaction placeholders as emitted by the SWAO redactor.
 *  Bounded repetition ({0,512}) prevents ReDoS on adversarial input. */
const REDACTION_MARKER_RE = /\[REDACTED[^\]\n]{0,512}\]/g;

/** Candidate file paths in a response (cheap heuristic; grounded checking
 *  proper lives in the content comparison).
 *  Uses a bounded character class that excludes '.' so there is no overlap
 *  with the adjacent '\.' literal -- no backtracking is possible. */
const PATH_RE = /(?:\.\/|\/|[A-Za-z]:\\|src\/|app\/)[\w/\\-]{2,200}\.\w{1,8}/g;

export function looksParseable(response: string): boolean {
  // Use indexOf instead of a backtracking regex to extract fenced code blocks.
  let candidate = response;
  const fenceIdx = response.indexOf('```');
  if (fenceIdx >= 0) {
    const nlIdx = response.indexOf('\n', fenceIdx);
    const closeIdx = nlIdx >= 0 ? response.indexOf('\n```', nlIdx + 1) : -1;
    if (nlIdx >= 0 && closeIdx >= 0) {
      candidate = response.slice(nlIdx + 1, closeIdx);
    }
  }
  // Try JSON first (most passes produce JSON).
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      JSON.parse(candidate.slice(first, last + 1));
      return true;
    } catch { /* not JSON, try YAML */ }
  }
  // Accept YAML-structured responses (challenge passes produce YAML, #1959).
  // Heuristic: first non-empty line is a top-level "key: value" pair.
  const firstMeaningfulLine = candidate.split('\n').find(l => l.trim().length > 0) ?? '';
  return /^[a-z_][a-z0-9_-]*\s*:\s*\S/i.test(firstMeaningfulLine);
}

export function detectRefusal(response: string): boolean {
  return response.length < 2000 && REFUSAL_PATTERNS.some((re) => re.test(response));
}

/** Markers the model ALTERED (present in a mangled form) rather than
 *  echoed verbatim (092 s5.2: echoing is fine, altering is flagged). */
export function detectAlteredMarkers(prompt: string, response: string): boolean {
  const promptMarkers = new Set(prompt.match(REDACTION_MARKER_RE) ?? []);
  if (promptMarkers.size === 0) return false;
  const responseMarkers = response.match(/\[REDACT[^\]\n]{0,512}\]/gi) ?? [];
  return responseMarkers.some((m) => !promptMarkers.has(m));
}

export function countForeignPaths(response: string, isKnownPath?: (p: string) => boolean): number {
  if (!isKnownPath) return 0;
  const candidates = response.match(PATH_RE) ?? [];
  return new Set(candidates.filter((p) => !isKnownPath(p))).size;
}

export interface RecordingProvider {
  complete(prompt: string): Promise<string>;
  /** Wraps the provider's vision path when present; writes a CallRecord with
   *  call_type 'vision' so vision calls appear in per-leg NDJSON. */
  completeVision?(prompt: string, images: Buffer[]): Promise<string>;
  /** Records written so far (also delivered via onRecord). */
  records(): readonly CallRecord[];
  /** Orchestrator amendment: pass-schema validation outcome for the last
   *  call of a (passId, callIndex) -- the recorder cannot know it. */
  amendSchemaConform(passId: string, callIndex: number, conform: boolean): void;
}

export function createRecordingProvider(
  inner: { complete(prompt: string): Promise<string>; completeVision?(prompt: string, images: Buffer[]): Promise<string> },
  deps: RecorderDeps,
): RecordingProvider {
  const now = deps.now ?? (() => Date.now());
  const timestamp = deps.timestamp ?? (() => new Date().toISOString());
  const records: CallRecord[] = [];
  const callIndexByPass = new Map<string, number>();

  function nextIndex(passId: string): number {
    const i = callIndexByPass.get(passId) ?? 0;
    callIndexByPass.set(passId, i + 1);
    return i;
  }

  const result: RecordingProvider = {
    records: () => records,

    amendSchemaConform(passId, callIndex, conform) {
      const r = records.find((c) => c.pass_id === passId && c.call_index === callIndex);
      if (r) r.quality.schema_conform = conform;
    },

    async complete(prompt: string): Promise<string> {
      const { passId, callSite } = deps.currentContext();
      const callIndex = nextIndex(passId);
      const before = deps.usageSnapshot();
      const started = timestamp();
      const t0 = now();
      const tokensEst = Math.ceil(prompt.length / 4);
      const bucket: SizeBucket = sizeBucket(tokensEst);

      const base = {
        leg: { ...deps.leg },
        pass_id: passId,
        call_site: callSite,
        call_index: callIndex,
        prompt: {
          sha256: createHash('sha256').update(prompt, 'utf-8').digest('hex'),
          chars: prompt.length,
          tokens_est: tokensEst,
          size_bucket: bucket,
        },
      };

      try {
        const response = await inner.complete(prompt);
        const after = deps.usageSnapshot();
        const totalMs = now() - t0;
        const promptTok = Math.max(0, after.input_tokens - before.input_tokens);
        const completionTok = Math.max(0, after.output_tokens - before.output_tokens);
        const reasoningTok = after.reasoning_tokens !== undefined && before.reasoning_tokens !== undefined
          ? Math.max(0, after.reasoning_tokens - before.reasoning_tokens)
          : undefined;
        const costDelta = after.cost_usd - before.cost_usd;
        const retries = Math.max(0, after.call_count - before.call_count - 1);

        // #1696: detect output-token ceiling hit. Prefer deps.maxTokens (the
        // provider's actual max_tokens, e.g. 32768 for Anthropic claude-sonnet-4-*).
        // Falls back to SWAO_TOKEN_CEILING env var (default 32768). A ceiling hit
        // means the response was truncated mid-output -- treat as DNF so quality
        // scores reflect the real outcome rather than silently inflating to 100.
        // #2015: raised default from 8192 to 32768 to match provider defaults.
        const CEILING = deps.maxTokens ?? parseInt(process.env['SWAO_TOKEN_CEILING'] ?? '32768', 10);
        const ceilingHit = completionTok > 0 && completionTok >= CEILING;
        // #1690: record which response field the provider used.
        const rawContentSource = (inner as { getLastContentSource?(): string | undefined }).getLastContentSource?.();
        const contentSource: 'content' | 'reasoning_content' | undefined =
          rawContentSource === 'content' || rawContentSource === 'reasoning_content' ? rawContentSource : undefined;

        const parseValid = looksParseable(response);
        const record: CallRecord = {
          ...base,
          timing: { started, total_ms: totalMs },
          tokens: {
            prompt: promptTok || tokensEst,
            completion: completionTok,
            ...(reasoningTok !== undefined ? { reasoning: reasoningTok } : {}),
          },
          cost_usd: {
            computed: deps.costSource === 'local' ? null : Math.max(0, Math.round(costDelta * 1e6) / 1e6),
            source: deps.costSource,
          },
          quality: {
            parse_valid: parseValid,
            // Amended by the orchestrator after pass-schema validation.
            schema_conform: parseValid,
            truncated: ceilingHit || (deps.maxTokens !== undefined && completionTok > 0
              ? completionTok >= deps.maxTokens && !parseValid
              : false),
            refusal_detected: detectRefusal(response),
            ...(contentSource ? { content_source: contentSource } : {}),
          },
          reliability: {
            retries,
            rate_limited: false,
            dnf: ceilingHit,
            ...(ceilingHit ? { error: `output token ceiling hit (${completionTok} >= ${CEILING})` } : {}),
          },
          security: {
            redaction_marker_altered: detectAlteredMarkers(prompt, response),
            foreign_path_count: countForeignPaths(response, deps.isKnownPath),
            pii_reproduction_detected: detectPiiReproduction(prompt, response),
            prompt_injection_detected: detectPromptInjection(response),
          },
          response_sha256: createHash('sha256').update(response, 'utf-8').digest('hex'),
        };
        records.push(record);
        deps.onRecord(record);
        return response;
      } catch (err) {
        const after = deps.usageSnapshot();
        const record: CallRecord = {
          ...base,
          timing: { started, total_ms: now() - t0 },
          tokens: { prompt: tokensEst, completion: 0 },
          cost_usd: { computed: deps.costSource === 'local' ? null : Math.max(0, Math.round((after.cost_usd - before.cost_usd) * 1e6) / 1e6), source: deps.costSource },
          quality: { parse_valid: false, schema_conform: false, truncated: false, refusal_detected: false },
          reliability: {
            retries: Math.max(0, after.call_count - before.call_count - 1),
            rate_limited: /429|rate.?limit/i.test((err as Error).message ?? ''),
            error: (err as Error).message?.slice(0, 300),
            dnf: true,
          },
          security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
        };
        records.push(record);
        deps.onRecord(record);
        throw err;
      }
    },
  };

  // Wire vision recording when the provider supports it.
  if (inner.completeVision) {
    const innerVision = inner.completeVision.bind(inner);
    result.completeVision = async (prompt: string, images: Buffer[]): Promise<string> => {
      const { passId, callSite } = deps.currentContext();
      const callIndex = nextIndex(passId);
      const before = deps.usageSnapshot();
      const started = timestamp();
      const t0 = now();
      const tokensEst = Math.ceil(prompt.length / 4);
      const bucket: SizeBucket = sizeBucket(tokensEst);
      const imageBytesTotal = images.reduce((acc, b) => acc + b.length, 0);

      const base = {
        leg: { ...deps.leg },
        pass_id: passId,
        call_site: callSite,
        call_index: callIndex,
        call_type: 'vision' as const,
        image_count: images.length,
        image_bytes_total: imageBytesTotal,
        prompt: {
          sha256: createHash('sha256').update(prompt, 'utf-8').digest('hex'),
          chars: prompt.length,
          tokens_est: tokensEst,
          size_bucket: bucket,
        },
      };

      try {
        const response = await innerVision(prompt, images);
        const after = deps.usageSnapshot();
        const totalMs = now() - t0;
        const promptTok = Math.max(0, after.input_tokens - before.input_tokens);
        // #2011: vision providers often report 0 output_tokens; fall back to a
        // character-based estimate (same pattern as promptTok || tokensEst above).
        const completionEst = Math.ceil(response.length / 4);
        const completionTok = Math.max(0, after.output_tokens - before.output_tokens) || completionEst;
        const reasoningTok = after.reasoning_tokens !== undefined && before.reasoning_tokens !== undefined
          ? Math.max(0, after.reasoning_tokens - before.reasoning_tokens)
          : undefined;
        const costDelta = after.cost_usd - before.cost_usd;
        const retries = Math.max(0, after.call_count - before.call_count - 1);
        // #2015: use deps.maxTokens (provider actual) before env var fallback; default 32768.
        const CEILING = deps.maxTokens ?? parseInt(process.env['SWAO_TOKEN_CEILING'] ?? '32768', 10);
        const ceilingHit = completionTok > 0 && completionTok >= CEILING;
        const parseValid = looksParseable(response);

        const record: CallRecord = {
          ...base,
          timing: { started, total_ms: totalMs },
          tokens: {
            prompt: promptTok || tokensEst,
            completion: completionTok,
            ...(reasoningTok !== undefined ? { reasoning: reasoningTok } : {}),
          },
          cost_usd: {
            computed: deps.costSource === 'local' ? null : Math.max(0, Math.round(costDelta * 1e6) / 1e6),
            source: deps.costSource,
          },
          quality: {
            parse_valid: parseValid,
            schema_conform: parseValid,
            truncated: ceilingHit || (deps.maxTokens !== undefined && completionTok > 0
              ? completionTok >= deps.maxTokens && !parseValid
              : false),
            refusal_detected: detectRefusal(response),
          },
          reliability: {
            retries,
            rate_limited: false,
            dnf: ceilingHit,
            ...(ceilingHit ? { error: `output token ceiling hit (${completionTok} >= ${CEILING})` } : {}),
          },
          // Vision prompts carry no REDACTED markers; other heuristics still apply.
          security: {
            redaction_marker_altered: false,
            foreign_path_count: countForeignPaths(response, deps.isKnownPath),
            pii_reproduction_detected: detectPiiReproduction(prompt, response),
            prompt_injection_detected: detectPromptInjection(response),
          },
          response_sha256: createHash('sha256').update(response, 'utf-8').digest('hex'),
        };
        records.push(record);
        deps.onRecord(record);
        return response;
      } catch (err) {
        const after = deps.usageSnapshot();
        const record: CallRecord = {
          ...base,
          timing: { started, total_ms: now() - t0 },
          tokens: { prompt: tokensEst, completion: 0 },
          cost_usd: { computed: deps.costSource === 'local' ? null : Math.max(0, Math.round((after.cost_usd - before.cost_usd) * 1e6) / 1e6), source: deps.costSource },
          quality: { parse_valid: false, schema_conform: false, truncated: false, refusal_detected: false },
          reliability: {
            retries: Math.max(0, after.call_count - before.call_count - 1),
            rate_limited: /429|rate.?limit/i.test((err as Error).message ?? ''),
            error: (err as Error).message?.slice(0, 300),
            dnf: true,
          },
          security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
        };
        records.push(record);
        deps.onRecord(record);
        throw err;
      }
    };
  }

  return result;
}
