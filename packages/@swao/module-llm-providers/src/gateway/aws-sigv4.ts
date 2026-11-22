// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- AWS Signature Version 4 for read-only GET calls
//  (Bedrock model discovery, #4475, Design 090 section 7.4)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The Bedrock control plane (ListFoundationModels, ListInferenceProfiles) is
// not part of @aws-sdk/client-bedrock-runtime, the only AWS package this
// module depends on. The two list calls are plain signed GET requests, so
// they are signed here with node:crypto instead of adding a dependency.
// Credentials come from the caller; nothing here reads or logs them.

import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, s: string): Buffer {
  return createHmac('sha256', key).update(s, 'utf8').digest();
}

/** RFC 3986 encoding as SigV4 wants it (unreserved characters stay). */
function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `20150830T123600Z` for a Date. */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Sign a request with AWS Signature Version 4 and return the headers to send
 * (the given headers plus host, x-amz-date, x-amz-security-token when a
 * session token is set, and Authorization). The body is empty (GET).
 */
export function signAwsRequest(opts: {
  method: string;
  url: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  headers?: Record<string, string>;
  now?: Date;
}): Record<string, string> {
  const u = new URL(opts.url);
  const date = amzDate(opts.now ?? new Date());
  const day = date.slice(0, 8);
  const headers: Record<string, string> = { ...(opts.headers ?? {}), host: u.host, 'x-amz-date': date };
  if (opts.credentials.sessionToken) headers['x-amz-security-token'] = opts.credentials.sessionToken;

  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) lower.set(k.toLowerCase(), v.trim().replace(/\s+/g, ' '));
  const names = [...lower.keys()].sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower.get(n)}\n`).join('');
  const signedHeaders = names.join(';');

  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = u.pathname.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/') || '/';

  const canonicalRequest = [opts.method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, sha256Hex('')].join('\n');
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
