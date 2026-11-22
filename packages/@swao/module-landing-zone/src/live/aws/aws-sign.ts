// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3574: AWS Signature Version 4 for the `aws` live driver (AWS General
// Reference, "Create a signed AWS API request"). Unlike the Pass 23 signer
// (`packages/swao/src/lzr/util/aws-sign.ts:44`, GET only, query string taken
// from URLSearchParams unsorted), this one sorts and RFC 3986-encodes the
// canonical query, signs a request body and every header the driver sends
// (`content-type`, `x-amz-target`), and signs the host the request actually
// goes to, so a loopback mock override stays consistent (Design 121 section 6).

import { createHash, createHmac } from 'node:crypto';

const sha256hex = (data: string): string => createHash('sha256').update(data, 'utf-8').digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf-8').digest();

/** RFC 3986 unreserved characters stay; everything else is percent-encoded (uppercase hex). */
export function awsUriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function canonicalQuery(url: URL): string {
  const pairs = [...url.searchParams.entries()].map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as const);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export interface AwsSigningInput {
  method: 'GET' | 'POST';
  url: URL;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Extra headers to send and sign (lowercase names). */
  headers?: Record<string, string>;
  body?: string;
  /** Fixed time for tests; defaults to now. */
  now?: Date;
}

/** Returns the full header set to send (lowercase names), Authorization included. */
export function signAwsV4(input: AwsSigningInput): Record<string, string> {
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const body = input.body ?? '';
  const headers: Record<string, string> = { ...(input.headers ?? {}), host: input.url.host, 'x-amz-date': amzDate };
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method,
    input.url.pathname || '/',
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    sha256hex(body),
  ].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, input.region), input.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf-8').digest('hex');
  return {
    ...lower,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
