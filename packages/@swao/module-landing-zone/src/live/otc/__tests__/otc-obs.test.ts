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

// #3951 (Design 123 section 5.4, OTC table): the OBS header signature, the
// bucket URL and the mappings of the OBS bucket documents. Shapes as the OBS
// API reference documents them; values synthetic. The signature scheme was
// accepted by the live OBS endpoint on 2026-11-06 (read-only run, 58 signed
// bucket reads answered 200 or 404 "not configured").

import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { apigInTransit, apigTlsFloor } from '../otc-posture.js';
import { obsAclPublic, obsDocument, obsEncryptionOf, obsPolicyPublic, obsUrl, signObsRequest, traceRetention } from '../otc-obs.js';
import { OtcHttpError } from '../otc-client.js';

const AK = 'MOCKTEMPAK';
const SK = ['mock', 'temp', 'sk'].join('-');

describe('OBS signature and URL (#3951)', () => {
  it('signs verb, empty MD5/type/date, the sorted x-obs headers and /bucket/?sub with HMAC-SHA1 (Base64)', () => {
    const s = signObsRequest({ method: 'get', bucket: 'b-1', subresource: 'acl', obsHeaders: { 'X-Obs-Security-Token': ' t  1 ', 'x-obs-date': 'Fri, 06 Nov 2026 10:00:00 GMT' }, accessKey: AK, secretKey: SK });
    const expected = 'GET\n\n\n\nx-obs-date:Fri, 06 Nov 2026 10:00:00 GMT\nx-obs-security-token:t 1\n/b-1/?acl';
    expect(s.stringToSign).toBe(expected);
    expect(s.authorization).toBe(`OBS ${AK}:${createHmac('sha1', SK).update(expected).digest('base64')}`);
  });
  it('virtual-hosted on a real endpoint, path style on a loopback mock', () => {
    expect(obsUrl('https://obs.eu-de.example.invalid', 'b-1', 'policy')).toBe('https://b-1.obs.eu-de.example.invalid/?policy');
    expect(obsUrl('https://127.0.0.1:8443', 'b-1', 'lifecycle')).toBe('https://127.0.0.1:8443/b-1?lifecycle');
  });
});

describe('OBS bucket documents (#3951)', () => {
  it('a documented "not configured" 404 is an answered read; any other refusal is an error', () => {
    expect(obsDocument('encryption', { ok: false, status: 404, code: 'NoSuchEncryptionConfiguration' })).toBeNull();
    expect(obsDocument('policy', { ok: false, status: 404, code: 'NoSuchBucketPolicy' })).toBeNull();
    expect(obsDocument('lifecycle', { ok: false, status: 404, code: 'NoSuchLifecycleConfiguration' })).toBeNull();
    expect(obsDocument('acl', { ok: false, status: 404, code: 'NoSuchBucket' })).toBeInstanceOf(OtcHttpError);
    expect(obsDocument('policy', { ok: false, status: 403, code: 'AccessDenied' })).toBeInstanceOf(OtcHttpError);
    expect(obsDocument('acl', { ok: true, body: '<x/>' })).toBe('<x/>');
  });
  it('encryption: SSE-KMS with its key, or none', () => {
    const xml = '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>kms</SSEAlgorithm><KMSMasterKeyID>kms-1</KMSMasterKeyID><ProjectID>p</ProjectID></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>';
    expect(obsEncryptionOf(xml)).toEqual({ encrypted: true, algorithm: 'kms', keyId: 'kms-1' });
    expect(obsEncryptionOf(null)).toEqual({ encrypted: false });
  });
  it('ACL: a Canned Everyone (or AllUsers URI) grantee is public; account grantees are not', () => {
    const grant = (g: string, p = 'READ'): string => `<Grant><Grantee>${g}</Grantee><Permission>${p}</Permission><Delivered>false</Delivered></Grant>`;
    const acl = (...grants: string[]): string => `<AccessControlPolicy><Owner><ID>owner-1</ID></Owner><AccessControlList>${grants.join('')}</AccessControlList></AccessControlPolicy>`;
    expect(obsAclPublic(acl(grant('<ID>owner-1</ID>', 'FULL_CONTROL')))).toBe(false);
    expect(obsAclPublic(acl(grant('<ID>owner-1</ID>', 'FULL_CONTROL'), grant('<Canned>Everyone</Canned>')))).toBe(true);
    expect(obsAclPublic(acl(grant('<URI>http://acs.amazonaws.com/groups/global/AllUsers</URI>')))).toBe(true);
  });
  it('policy: an unconditional Allow to every principal is public; a condition, a Deny or named principals are not', () => {
    const pol = (st: Record<string, unknown>): string => JSON.stringify({ Statement: [st] });
    expect(obsPolicyPublic(pol({ Effect: 'Allow', Principal: { ID: ['*'] }, Action: ['GetObject'], Resource: ['b/*'] }))).toBe(true);
    expect(obsPolicyPublic(pol({ Effect: 'Allow', Principal: '*', Action: ['GetObject'] }))).toBe(true);
    expect(obsPolicyPublic(pol({ Effect: 'Allow', Principal: { AWS: '*' }, Action: ['GetObject'] }))).toBe(true);
    expect(obsPolicyPublic(pol({ Effect: 'Allow', Principal: { ID: ['*'] }, Action: ['GetObject'], Condition: { StringLike: { Referer: ['https://x.invalid/*'] } } }))).toBe(false);
    expect(obsPolicyPublic(pol({ Effect: 'Deny', Principal: { ID: ['*'] }, Action: ['GetObject'] }))).toBe(false);
    expect(obsPolicyPublic(pol({ Effect: 'Allow', Principal: { ID: ['domain/d1:user/*'] }, Action: ['*'] }))).toBe(false);
    expect(obsPolicyPublic(null)).toBe(false);
    expect(obsPolicyPublic('not json')).toBeUndefined();
  });
  it('trace retention: the shortest enabled expiring rule whose prefix covers <file_prefix_name>/CloudTraces/; none keeps the logs', () => {
    const rule = (prefix: string, days: number | undefined, status = 'Enabled'): string => `<Rule><ID>r</ID><Prefix>${prefix}</Prefix><Status>${status}</Status>${days === undefined ? '' : `<Expiration><Days>${days}</Days></Expiration>`}<NoncurrentVersionExpiration><NoncurrentDays>1</NoncurrentDays></NoncurrentVersionExpiration></Rule>`;
    const lc = (...rules: string[]): string => `<LifecycleConfiguration>${rules.join('')}</LifecycleConfiguration>`;
    expect(traceRetention(null, 'cts')).toEqual({ neverExpires: true });
    expect(traceRetention(lc(rule('', 365), rule('cts/', 200)), 'cts')).toEqual({ days: 200, neverExpires: false });
    expect(traceRetention(lc(rule('other/', 7), rule('cts/CloudTraces/', 30, 'Disabled')), 'cts')).toEqual({ neverExpires: true });
    expect(traceRetention(lc(rule('CloudTraces/', 90)), undefined)).toEqual({ days: 90, neverExpires: false });
    expect(traceRetention(lc(rule('cts/CloudTraces/eu-de/', 1)), 'cts')).toEqual({ neverExpires: true });
  });
});

describe('API Gateway in transit (#3954)', () => {
  it('maps min_ssl_version to the TLS floor (default TLSv1.1)', () => {
    expect([apigTlsFloor('TLSv1.2'), apigTlsFloor('TLSv1.1'), apigTlsFloor(undefined), apigTlsFloor('SSLv3')]).toEqual(['1.2', '1.1', '1.1', undefined]);
  });
  it('one item per API: HTTP and BOTH are not encrypted; HTTPS takes the lowest custom-domain floor of its group; no custom domain gives no floor', () => {
    const groups = [
      { id: 'g1', sl_domain: 'x.example.invalid', url_domains: [{ id: 'd1', min_ssl_version: 'TLSv1.2' }, { id: 'd2', min_ssl_version: 'TLSv1.2' }] },
      { id: 'g2', url_domains: [{ id: 'd3', min_ssl_version: 'TLSv1.2' }, { id: 'd4' }] },
      { id: 'g3', url_domains: [] },
    ];
    const apis = [
      { id: 'a1', group_id: 'g1', req_protocol: 'HTTPS' },
      { id: 'a2', group_id: 'g2', req_protocol: 'GRPCS' },
      { id: 'a3', group_id: 'g3', req_protocol: 'HTTPS' },
      { id: 'a4', group_id: 'g1', req_protocol: 'BOTH' },
      { id: 'a5', group_id: 'g1', req_protocol: 'HTTP' },
    ];
    expect(apigInTransit(apis, groups, 'eu-de').map((i) => [i.resource_id, i.type, i.encrypted, i.min_tls_version])).toEqual([
      ['a1', 'apig.apis', true, '1.2'], ['a2', 'apig.apis', true, '1.1'], ['a3', 'apig.apis', true, undefined], ['a4', 'apig.apis', false, undefined], ['a5', 'apig.apis', false, undefined],
    ]);
  });
  it('a gateway without an API is covered by one instance item without a verdict (as live 2026-11-06)', () => {
    expect(apigInTransit([], [{ id: 'g1', url_domains: [] }], 'eu-de', { id: 'gw-1' })).toEqual([
      { resource_id: 'gw-1', type: 'apig.instances', service_code: 'apig', region: 'eu-de', layer: 'in_transit', attributes: { published_apis: 0, api_groups: 1 } },
    ]);
  });
});
