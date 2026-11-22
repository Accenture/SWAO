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

// #3685: OTC AK/SK request signing, `SDK-HMAC-SHA256`. Sources:
// - Open Telekom Cloud API Usage Guidelines, "AK/SK Authentication"
//   (github.com/opentelekomcloud-docs/api-usage, doc/guidelines/source/
//   calling_apis/ak_sk_authentication/, commit 7649cc57): sign every request
//   with the AK/SK; X-Project-Id names the project, X-Domain-Id the account for
//   global services such as IAM. The guide ships the algorithm only inside its
//   Java SDK, so the wire format is taken from the official OTC Go SDK,
//   github.com/opentelekomcloud/gophertelekomcloud (Apache-2.0),
//   `signer_helper.go` `Sign` and `provider_client.go` (AK/SK branch):
//   - canonical request = method, canonical URI, canonical query, canonical
//     headers, signed headers, hex SHA-256 of the body, joined by "\n";
//   - canonical URI: the path with a trailing "/" added, every byte outside
//     `A-Za-z0-9.-_~` percent-encoded (upper-case hex), "/" kept;
//   - canonical query: keys and values encoded the same way ("/" encoded),
//     sorted by key, `key=value` joined by "&";
//   - canonical headers: names lower-cased and sorted, runs of whitespace
//     collapsed, `name:value\n`; signed headers the names joined by ";";
//   - string to sign = "SDK-HMAC-SHA256", the X-Sdk-Date time
//     (`yyyyMMddTHHmmssZ`, UTC), the scope `yyyyMMdd/<region>/<service>/sdk_request`,
//     hex SHA-256 of the canonical request, joined by "\n";
//   - signing key = HMAC chain from "SDK" + SK over the day, region,
//     service and "sdk_request"; the OTC client leaves region and service
//     empty, so the scope is `yyyyMMdd///sdk_request`;
//   - `Authorization: SDK-HMAC-SHA256 Credential=<AK>/<scope>, SignedHeaders=<..>, Signature=<hex>`;
//   - X-Project-Id, X-Domain-Id and X-Security-Token are set after signing
//     and are not signed.
// Verified live on 2026-11-04 against the test tenant with a temporary AK/SK
// (see the #3685 log). The signature, the AK and the security token are
// never logged or recorded (record.ts records no request header).

import { createHash, createHmac } from 'node:crypto';

export const OTC_SIGN_ALGORITHM = 'SDK-HMAC-SHA256';

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** Percent-encode every byte outside the unreserved set; `keepSlash` keeps "/" (paths). */
export function otcEncode(s: string, keepSlash: boolean): string {
  let out = '';
  for (const b of Buffer.from(s, 'utf-8')) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9._~-]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** `yyyyMMddTHHmmssZ` in UTC. */
export function otcSdkDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export interface OtcSignInput {
  method: string;
  url: string;
  /** Headers to sign (Host and X-Sdk-Date are added). */
  headers: Record<string, string>;
  body?: string;
  accessKey: string;
  secretKey: string;
  now?: Date;
}

export interface OtcSigned {
  /** Headers to send: the signed ones, X-Sdk-Date and Authorization (Host is signed but set by the transport from the URL). */
  headers: Record<string, string>;
  /** For tests: the intermediate values (never logged in production). */
  canonicalRequest: string;
  stringToSign: string;
}

function canonicalPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  // URL.pathname is already percent-encoded; decode once so a byte is encoded exactly once.
  const decoded = decodeURIComponent(p);
  return otcEncode(decoded.endsWith('/') ? decoded : `${decoded}/`, true);
}

function canonicalQuery(u: URL): string {
  const first = new Map<string, string>();
  for (const [k, v] of u.searchParams) if (!first.has(k)) first.set(k, v);
  return [...first.entries()]
    .map(([k, v]) => [otcEncode(k, false), otcEncode(v, false)] as const)
    .sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : a[0].toLowerCase() > b[0].toLowerCase() ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** Sign one request; returns the headers to send (callers add X-Project-Id / X-Domain-Id / X-Security-Token unsigned). */
export function signOtcRequest(i: OtcSignInput): OtcSigned {
  const u = new URL(i.url);
  const now = i.now ?? new Date();
  const sdkDate = otcSdkDate(now);
  const day = sdkDate.slice(0, 8);
  const headers: Record<string, string> = { ...i.headers, host: u.host, 'x-sdk-date': sdkDate };
  const names = Object.keys(headers).map((n) => n.trim().toLowerCase()).sort();
  const value = (n: string): string => {
    const k = Object.keys(headers).find((h) => h.trim().toLowerCase() === n) as string;
    return String(headers[k]).replace(/\s+/g, ' ');
  };
  const canonicalHeaders = names.map((n) => `${n}:${value(n)}\n`).join('');
  const signedHeaders = names.join(';');
  const method = i.method.toUpperCase();
  const query = method === 'POST' && i.body === undefined ? '' : canonicalQuery(u);
  const canonicalRequest = [method, canonicalPath(u.pathname), query, canonicalHeaders, signedHeaders, sha256Hex(i.body ?? '')].join('\n');
  const scope = `${day}///sdk_request`;
  const stringToSign = [OTC_SIGN_ALGORITHM, sdkDate, scope, sha256Hex(canonicalRequest)].join('\n');
  let key = hmac(`SDK${i.secretKey}`, day);
  for (const part of ['', '', 'sdk_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  const send: Record<string, string> = Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'host'));
  send['authorization'] = `${OTC_SIGN_ALGORITHM} Credential=${i.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: send, canonicalRequest, stringToSign };
}
