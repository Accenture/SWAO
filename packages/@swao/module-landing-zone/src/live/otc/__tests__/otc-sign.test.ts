// #3685: OTC AK/SK signer (otc-sign.ts). Vectors:
// - canonical requests: the API gateway echoes its canonical request when a
//   signature fails; on 2026-11-04 (temporary AK/SK of the test tenant, a
//   deliberately wrong SK, read-only GETs) it equalled ours for these four
//   requests. Project and account ids are replaced by a fake id here.
// - signature: computed for fixed inputs and cross-checked with an
//   independent implementation of the OTC Go SDK scheme (Python hmac/hashlib,
//   2026-11-04); OTC publishes no test vector.

import { describe, it, expect } from 'vitest';
import { OTC_SIGN_ALGORITHM, otcEncode, otcSdkDate, signOtcRequest } from '../otc-sign.js';

const ID = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-11-04T18:15:00Z');
const AK = 'MOCKOTCACCESSKEY0001';
const SK = ['mock', 'only', 'not', 'a', 'secret'].join('-');
const H = { accept: 'application/json', 'content-type': 'application/json' };
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const live = (path: string, query: string, host: string): string =>
  ['GET', path, query, `accept:application/json\ncontent-type:application/json\nhost:${host}\nx-sdk-date:20261104T181500Z\n`, 'accept;content-type;host;x-sdk-date', EMPTY].join('\n');

describe('signOtcRequest canonical request (equal to the gateway echo, live 2026-11-04)', () => {
  it.each([
    ['https://iam.eu-de.otc.t-systems.com/v3/auth/projects', live('/v3/auth/projects/', '', 'iam.eu-de.otc.t-systems.com')],
    ['https://iam.eu-de.otc.t-systems.com/v3/projects?name=eu-de&enabled=true', live('/v3/projects/', 'enabled=true&name=eu-de', 'iam.eu-de.otc.t-systems.com')],
    [`https://ecs.eu-de.otc.t-systems.com/v2.1/${ID}/os-availability-zone`, live(`/v2.1/${ID}/os-availability-zone/`, '', 'ecs.eu-de.otc.t-systems.com')],
    [`https://cts.eu-de.otc.t-systems.com/v3/${ID}/traces?limit=10&trace_type=system`, live(`/v3/${ID}/traces/`, 'limit=10&trace_type=system', 'cts.eu-de.otc.t-systems.com')],
  ])('%s', (url, want) => {
    expect(signOtcRequest({ method: 'GET', url, headers: H, accessKey: AK, secretKey: SK, now: NOW }).canonicalRequest).toBe(want);
  });
});

describe('signOtcRequest signature and headers', () => {
  it('matches the independent implementation for a fixed request', () => {
    const s = signOtcRequest({ method: 'GET', url: 'https://iam.eu-de.otc.t-systems.com/v3/projects?name=eu-de&enabled=true', headers: H, accessKey: AK, secretKey: SK, now: NOW });
    expect(s.headers['authorization']).toBe(`${OTC_SIGN_ALGORITHM} Credential=${AK}/20261104///sdk_request, SignedHeaders=accept;content-type;host;x-sdk-date, Signature=3c0ac6a919c0f86de56ba0685d45ac00c5f7c3c199578e01c5ced83b7522ccf4`);
    expect(s.stringToSign.split('\n').slice(0, 3)).toEqual([OTC_SIGN_ALGORITHM, '20261104T181500Z', '20261104///sdk_request']);
    expect(s.headers['x-sdk-date']).toBe('20261104T181500Z');
    // Host is signed but left to the transport (set from the URL).
    expect(s.headers['host']).toBeUndefined();
    expect(Object.keys(s.headers).sort()).toEqual(['accept', 'authorization', 'content-type', 'x-sdk-date']);
  });

  it('changes with the SK, the time, the path, the query and the body', () => {
    const base = { method: 'GET', url: 'https://ecs.example/v1/a', headers: H, accessKey: AK, secretKey: SK, now: NOW };
    const sig = (o: Partial<typeof base> & { body?: string }): string => String(signOtcRequest({ ...base, ...o }).headers['authorization']);
    const ref = sig({});
    for (const other of [sig({ secretKey: `${SK}x` }), sig({ now: new Date(NOW.getTime() + 1000) }), sig({ url: 'https://ecs.example/v1/b' }), sig({ url: 'https://ecs.example/v1/a?x=1' }), sig({ method: 'PUT', body: '{}' })]) expect(other).not.toBe(ref);
  });

  it('encodes path and query bytes once, upper-case hex; "/" kept in paths only; repeated keys take the first value', () => {
    expect(otcEncode('a b/c~d', true)).toBe('a%20b/c~d');
    expect(otcEncode('a/b', false)).toBe('a%2Fb');
    expect(otcEncode('ä', false)).toBe('%C3%A4');
    const s = signOtcRequest({ method: 'GET', url: 'https://x.example/v1/a%20b?b=2&A=1&b=3&c=x%2Fy', headers: {}, accessKey: AK, secretKey: SK, now: NOW });
    const [, path, query] = s.canonicalRequest.split('\n');
    expect(path).toBe('/v1/a%20b/');
    expect(query).toBe('A=1&b=2&c=x%2Fy');
  });

  it('a POST without a body signs an empty query, as the Go SDK does', () => {
    const s = signOtcRequest({ method: 'POST', url: 'https://x.example/v1/a?b=2', headers: {}, accessKey: AK, secretKey: SK, now: NOW });
    expect(s.canonicalRequest.split('\n')[2]).toBe('');
  });

  it('formats X-Sdk-Date as yyyyMMddTHHmmssZ in UTC', () => {
    expect(otcSdkDate(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});
