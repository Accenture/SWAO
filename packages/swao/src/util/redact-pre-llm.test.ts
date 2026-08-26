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

import { describe, it, expect, beforeEach } from 'vitest';
import {
  redactPreLlm,
  redactForReport,
  setAllowlist,
  setScrubPersonName,
  _resetForTests,
} from './redact-pre-llm.js';

describe('redactPreLlm', () => {
  beforeEach(() => {
    _resetForTests();
  });

  describe('inherited classes (delegated to redactPiiString)', () => {
    it('redacts emails', () => {
      const { text, counts } = redactPreLlm('contact alice@client.example for details');
      expect(text).toContain('[REDACTED-EMAIL]');
      expect(text).not.toContain('alice@client.example');
      expect(counts.email).toBe(1);
    });

    it('does NOT redact ISO 8601 timestamps as IPv6 (#0354 timestamp exemption)', () => {
      const { text, counts } = redactPreLlm('assessed_at: "2026-05-09T13:00:00Z" started: 14:30:45');
      expect(text).toContain('2026-05-09T13:00:00Z');
      expect(text).toContain('14:30:45');
      expect(counts.ipv6).toBe(0);
    });

    it('still redacts real IPv6 addresses', () => {
      const { text, counts } = redactPreLlm('host 2001:db8::1 in zone');
      expect(text).toContain('[REDACTED-IPV6]');
      expect(text).not.toContain('2001:db8::1');
      expect(counts.ipv6).toBe(1);
    });

    it('redacts IPv4 addresses (not loopback)', () => {
      const { text, counts } = redactPreLlm('server at 10.20.30.40 and 127.0.0.1');
      expect(text).toContain('[REDACTED-IPV4]');
      expect(text).toContain('127.0.0.1');
      expect(counts.ipv4).toBe(1);
    });

    it('redacts secret-shaped tokens', () => {
      const { text, counts } = redactPreLlm('export ANTHROPIC_KEY=sk-abcdef0123456789ABCDEF01');
      expect(text).toContain('[REDACTED-SECRET]');
      expect(counts.secret_shape).toBe(1);
    });

    it('redacts Windows user paths', () => {
      const { text, counts } = redactPreLlm('config at C:\\Users\\helmut.schindlwick\\.swao.yml');
      expect(text).toContain('[REDACTED-USER]');
      expect(counts.user_path).toBe(1);
    });
  });

  describe('business_id class', () => {
    it('redacts US SSN', () => {
      const { text, counts } = redactPreLlm('SSN 123-45-6789 on file');
      expect(text).toContain('[REDACTED-SSN]');
      expect(counts.business_id).toBe(1);
    });

    it('does not redact invalid SSN (000 area)', () => {
      const { text, counts } = redactPreLlm('legacy code 000-12-3456 placeholder');
      expect(text).toContain('000-12-3456');
      expect(counts.business_id).toBe(0);
    });

    it('redacts EU VAT IDs', () => {
      const { text, counts } = redactPreLlm('VAT registration DE123456789');
      expect(text).toContain('[REDACTED-VAT]');
      expect(counts.business_id).toBe(1);
    });

    it('redacts UK National Insurance number', () => {
      const { text, counts } = redactPreLlm('NI AB123456C');
      expect(text).toContain('[REDACTED-UK-NI]');
      expect(counts.business_id).toBe(1);
    });
  });

  describe('api_key_shape class', () => {
    it('redacts GCP service-account JSON envelope', () => {
      const { text, counts } = redactPreLlm('config = { "type": "service_account", "project_id": "x" }');
      expect(text).toContain('[REDACTED-GCP-SA-KEY]');
      expect(counts.api_key_shape).toBe(1);
    });

    it('redacts Azure connection strings', () => {
      const conn = 'DefaultEndpointsProtocol=https;AccountName=mystore;AccountKey=abc123==;EndpointSuffix=core';
      const { text, counts } = redactPreLlm(`conn=${conn}`);
      expect(text).toContain('[REDACTED-AZURE-CONN]');
      expect(counts.api_key_shape).toBe(1);
    });
  });

  describe('person_name class', () => {
    it('is off by default in sprint-038', () => {
      const { text, counts } = redactPreLlm('Helmut Schindlwick reviewed the change');
      expect(text).toContain('Helmut Schindlwick');
      expect(counts.person_name).toBe(0);
    });

    it('activates when setScrubPersonName(true)', () => {
      setScrubPersonName(true);
      const { text, counts } = redactPreLlm('Helmut Schindlwick reviewed the change');
      expect(text).toContain('[REDACTED-NAME]');
      expect(counts.person_name).toBe(1);
    });

    it('catches the documented false-positive when enabled', () => {
      setScrubPersonName(true);
      const { counts } = redactPreLlm('We use Active Directory and Compliance Pipeline');
      expect(counts.person_name).toBeGreaterThanOrEqual(2);
    });
  });

  describe('allowlist', () => {
    it('passes through allowlisted SSN-shape strings', () => {
      setAllowlist(['111-22-3333']);
      const { text, counts } = redactPreLlm('test fixture 111-22-3333 and real 555-44-3210');
      expect(text).toContain('111-22-3333');
      expect(text).toContain('[REDACTED-SSN]');
      expect(counts.business_id).toBe(1);
    });

    it('passes through allowlisted person names when person_name is on', () => {
      setScrubPersonName(true);
      setAllowlist(['Helmut Schindlwick']);
      const { text, counts } = redactPreLlm('Helmut Schindlwick and Some Other');
      expect(text).toContain('Helmut Schindlwick');
      expect(text).toContain('[REDACTED-NAME]');
      expect(counts.person_name).toBe(1);
    });
  });

  describe('boundary cases', () => {
    it('returns empty string unchanged', () => {
      const { text, counts } = redactPreLlm('');
      expect(text).toBe('');
      expect(counts.email).toBe(0);
    });

    it('handles a clean prompt with no PII', () => {
      const clean = 'Evaluate the Pass 11 compliance signals for app sovereign-health.';
      const { text, counts } = redactPreLlm(clean);
      expect(text).toBe(clean);
      expect(counts.email).toBe(0);
      expect(counts.business_id).toBe(0);
    });

    it('counts multiple instances of the same class', () => {
      const { counts } = redactPreLlm('a@x.com, b@x.com, c@x.com');
      expect(counts.email).toBe(3);
    });
  });
});

describe('redactForReport', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('produces identical output to redactPreLlm for the same input', () => {
    const input = 'contact alice@client.example, IP 10.20.30.40, SSN 123-45-6789';
    const pre = redactPreLlm(input);
    const rep = redactForReport(input);
    expect(rep.text).toBe(pre.text);
    expect(rep.counts).toEqual(pre.counts);
  });
});
