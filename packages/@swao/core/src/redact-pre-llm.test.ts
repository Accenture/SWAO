// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3417: the business_id VAT class must not match uppercase German words.
// The broad redactor suite lives in swao/src/util/redact-pre-llm.test.ts; this
// file pins the VAT shapes next to the regex.

import { describe, it, expect, beforeEach } from 'vitest';
import { redactPreLlm, redactForReport, _resetForTests } from './redact-pre-llm.js';

// German business identifiers as they appear in app names, Java packages and EVD slugs.
// Each starts with an EU country code. BESTELLSTATUS, FREIGABELISTE,
// SENDUNGSART and DEUTSCHLAND matched the pre-#3417 `<cc>[0-9A-Z]{8,12}` pattern.
const GERMAN_WORDS = [
  'BESTELLSTATUS',
  'FREIGABELISTE',
  'SENDUNGSART',
  'DEUTSCHLAND',
  'DEBEITRAGSKONTO',
  'ATTRIBUTWERT',
  'BEARBEITUNGEN',
  'FREIGABESTATUS',
  'ESKALATIONEN',
  'PLAUSIBILITAET',
  'ITSICHERHEIT',
  'SEKUNDAERDATEN',
];

const VALID_VAT_IDS = [
  'DE123456789',
  'ATU12345678',
  'FR12345678901',
  'FRXX123456789',
  'BE0123456789',
  'NL123456789B01',
  'IT12345678901',
  'ES12345678Z',
  'ESX1234567X',
  'PL1234567890',
  'SE123456789001',
  'GB123456789',
  'IE1234567T',
  'CY12345678X',
  'DK12345678',
];

describe('VAT_RE (#3417)', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it.each(GERMAN_WORDS)('does not match the German word %s', (word) => {
    const { text, counts } = redactPreLlm(`package de.example.acme.${word} uses ${word}_SERVICE`);
    expect(text).toContain(word);
    expect(text).not.toContain('[REDACTED-VAT]');
    expect(counts.business_id).toBe(0);
  });

  it.each(VALID_VAT_IDS)('still redacts the VAT ID %s', (vat) => {
    const { text, counts } = redactPreLlm(`VAT registration ${vat} on file`);
    expect(text).toContain('[REDACTED-VAT]');
    expect(text).not.toContain(vat);
    expect(counts.business_id).toBe(1);
  });

  it('does not match a country-code prefix without enough digits', () => {
    for (const s of ['DE12345678', 'ATU1234567', 'FR1234567890', 'BE2123456789', 'SE1234567890']) {
      const { text } = redactPreLlm(`id ${s} end`);
      expect(text, s).not.toContain('[REDACTED-VAT]');
    }
  });

  it('reports zero business_id hits on an client-like corpus', () => {
    const corpus = [
      'App acme-orders-api, module ACME-ORDERS-BESTELLSTATUS.',
      'Evidence EVD-SRC-TEST-JAVA-DE-EXAMPLE-ACME-ORDERS-BESTELLSTATUS-BDD-STEPS-JAVA',
      'Evidence EVD-SRC-MAIN-JAVA-DE-EXAMPLE-ACME-ORDERS-FREIGABELISTE-SERVICE-JAVA',
      'Evidence EVD-K8S-SENDUNGSART-DEPLOYMENT-YAML',
      'public static final String FREIGABELISTE_STATUS = "FREIGABELISTE";',
      'enum Kontoart { BESTELLSTATUS, SENDUNGSART, DEUTSCHLAND }',
      'class SendungsartController implements BestellstatusApi {}',
    ].join('\n');
    const { text, counts } = redactPreLlm(corpus);
    expect(counts.business_id).toBe(0);
    expect(text).toBe(corpus);
  });

  it('applies the same VAT shapes on the report-write path', () => {
    expect(redactForReport('BESTELLSTATUS').text).toBe('BESTELLSTATUS');
    expect(redactForReport('DE123456789').text).toBe('[REDACTED-VAT]');
  });
});

// #3415: credential values are masked before an LLM call and in report output.
describe('credential class (#3415)', () => {
  it('masks a hard-coded password value and counts it as credential', () => {
    const r = redactPreLlm('spring.datasource.password=Zx9-fake-Pw42 # gitleaks:allow');
    expect(r.text).not.toContain('Zx9-fake-Pw42');
    expect(r.text).toContain('spring.datasource.password=');
    expect(r.counts.credential).toBe(1);
  });

  it('leaves references and placeholders alone', () => {
    const r = redactPreLlm('password: ${DB_PASSWORD}\ntoken = process.env.API_TOKEN');
    expect(r.text).toBe('password: ${DB_PASSWORD}\ntoken = process.env.API_TOKEN');
    expect(r.counts.credential).toBe(0);
  });

  it('report output uses the same class', () => {
    const r = redactForReport('db_password: "Zx9-fake-Pw42"');
    expect(r.text).not.toContain('Zx9-fake-Pw42');
    expect(r.counts.credential).toBe(1);
  });

  // #3456: quotes escaped inside a serialised JSON string.
  it('masks a credential whose quotes are JSON-escaped', () => {
    const prompt = JSON.stringify({ file: 'application.json', content: '{"password": "Zx9-fake-Pw42"}' }); // gitleaks:allow
    const r = redactPreLlm(prompt);
    expect(r.text).not.toContain('Zx9-fake-Pw42');
    expect(r.text).toContain('\\"password\\": \\"Zx***(13)\\"');
    expect(r.counts.credential).toBe(1);
    expect(() => JSON.parse(r.text) as unknown).not.toThrow();
  });

  it('leaves an escaped placeholder alone', () => {
    const input = 'config: "password = \\"${DB_PASSWORD}\\""';
    const r = redactPreLlm(input);
    expect(r.text).toBe(input);
    expect(r.counts.credential).toBe(0);
  });
});
