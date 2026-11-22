// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- SigV4 signer tests (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { amzDate, signAwsRequest } from './aws-sigv4.js';

describe('signAwsRequest (#4475)', () => {
  // The worked example of the AWS Signature Version 4 documentation (IAM ListUsers,
  // 2015-08-30T12:36:00Z, the documentation's example key pair).
  it('reproduces the AWS documentation example signature', () => {
    const headers = signAwsRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      region: 'us-east-1',
      service: 'iam',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    expect(headers['Authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
      'SignedHeaders=content-type;host;x-amz-date, ' +
      'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it('signs the session token header when one is set', () => {
    const headers = signAwsRequest({
      method: 'GET', url: 'https://bedrock.eu-central-1.amazonaws.com/foundation-models', region: 'eu-central-1', service: 'bedrock',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'x', sessionToken: 'session' },
      now: new Date('2026-11-16T00:00:00Z'),
    });
    expect(headers['x-amz-security-token']).toBe('session');
    expect(headers['Authorization']).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token');
    expect(amzDate(new Date('2026-11-16T01:02:03.456Z'))).toBe('20261116T010203Z');
  });
});
