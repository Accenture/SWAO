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
 * VirusTotal hash lookup (Design 103 §6.2.3, §19.6, #3090). Community tier with
 * the user's own `VT_API_KEY`; without a key no request is made. Only the
 * SHA256 of an installer leaves the client network; the key travels in the
 * `x-apikey` header. Hashes come from Pass 25 BINARY via
 * `apps/<id>/wsp/inputs/binary/binary-analysis.json`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { HttpError, RateLimiter, requestJson, type Clock, type HttpContext } from './http.js';
import { BinaryAnalysisFileSchema, type VtBlock } from './schema.js';

export const VT_BASE_URL = 'https://www.virustotal.com/api/v3';

/** Public API free tier: 4 lookups per minute. */
export function vtLimiter(clock?: Clock, override?: { max: number; windowMs: number }): RateLimiter {
  const cfg = override ?? { max: 4, windowMs: 60_000 };
  return new RateLimiter(cfg.max, cfg.windowMs, clock);
}

export function emptyVtBlock(): VtBlock {
  return { source: 'virustotal', fetched_at: null, confidence: null, sha256: null, detection_ratio: null, malicious: null, last_analysis_date: null, permalink: null };
}

/** First SHA256 recorded by Pass 25, or null when the file is absent or invalid. */
export function readBinaryHash(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = BinaryAnalysisFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')));
    return parsed.success ? (parsed.data.files[0]?.sha256.toLowerCase() ?? null) : null;
  } catch {
    return null;
  }
}

interface VtFileResponse {
  data?: { attributes?: { last_analysis_stats?: Record<string, number>; last_analysis_date?: number } };
}

export async function queryVirusTotal(
  ctx: HttpContext,
  input: { apiKey: string | null; sha256: string | null },
  opts: { limiter: RateLimiter; baseUrl?: string; now: Date },
): Promise<VtBlock> {
  const block = emptyVtBlock();
  if (!input.apiKey) return { ...block, skipped_reason: 'no_api_key' };
  if (!input.sha256) return { ...block, skipped_reason: 'no_binary_hash' };
  const fetchedAt = opts.now.toISOString();
  const permalink = `https://www.virustotal.com/gui/file/${input.sha256}`;
  try {
    const res = await requestJson<VtFileResponse>(ctx, `${opts.baseUrl ?? VT_BASE_URL}/files/${input.sha256}`, {
      limiter: opts.limiter,
      headers: { 'x-apikey': input.apiKey },
    });
    const stats = res.data?.attributes?.last_analysis_stats ?? {};
    const malicious = (stats['malicious'] ?? 0) + (stats['suspicious'] ?? 0);
    const total = Object.values(stats).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    const ts = res.data?.attributes?.last_analysis_date;
    return {
      ...block,
      fetched_at: fetchedAt,
      confidence: 'high',
      sha256: input.sha256,
      detection_ratio: total > 0 ? `${malicious}/${total}` : null,
      malicious,
      last_analysis_date: typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null,
      permalink,
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      return { ...block, fetched_at: fetchedAt, confidence: 'medium', sha256: input.sha256, note: 'hash_not_known_to_virustotal', permalink };
    }
    return { ...block, fetched_at: fetchedAt, confidence: 'low', sha256: input.sha256, error: e instanceof HttpError ? e.message : 'request failed' };
  }
}
