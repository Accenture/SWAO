// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Minimal AWS Signature Version 4 implementation.
 * Produces the Authorization header for AWS REST API calls.
 * Only supports GET requests with no body (covers EKS/RDS list operations).
 */
import { createHash, createHmac } from 'crypto';

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf-8').digest();
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secret}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export interface AwsRequestHeaders {
  Authorization: string;
  'X-Amz-Date': string;
  'X-Amz-Security-Token'?: string;
  host: string;
}

export function signAwsRequest(opts: {
  method: 'GET';
  url: URL;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): AwsRequestHeaders {
  const { method, url, region, service, accessKeyId, secretAccessKey, sessionToken } = opts;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const host = url.hostname;
  const canonicalUri = url.pathname || '/';
  const canonicalQueryString = url.searchParams.toString();

  const headersToBeSigned: Record<string, string> = { host, 'x-amz-date': amzDate };
  if (sessionToken) headersToBeSigned['x-amz-security-token'] = sessionToken;
  const signedHeaderNames = Object.keys(headersToBeSigned).sort().join(';');
  const canonicalHeaders = Object.keys(headersToBeSigned)
    .sort()
    .map((k) => `${k}:${headersToBeSigned[k]}`)
    .join('\n') + '\n';

  const payloadHash = sha256hex('');
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaderNames, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const signature = hmacSha256(signingKey(secretAccessKey, dateStamp, region, service), stringToSign).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  const result: AwsRequestHeaders = { Authorization: authorization, 'X-Amz-Date': amzDate, host };
  if (sessionToken) result['X-Amz-Security-Token'] = sessionToken;
  return result;
}
