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

// #3063 / #3064 / #3065 -- schema validation for the three sprint-149 pass catalogues.
// Loads each YAML from the source tree and asserts structure + acceptance-criteria entries.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';

// From swao/packages/swao/src/__tests__/, up 4 levels reaches swao/ (top-level).
const PASS_CATALOGS_DIR = resolve(__dirname, '../../../../pass-catalogs');

interface EntryBase {
  id: string;
  cross_reference_frameworks?: string[];
}

interface CryptoEntry extends EntryBase {
  category: string;
  detection: { imports?: string[]; config_keys?: string[] };
  posture: {
    severity: string;
    bsi_tr02102_status?: string;
    nist_status?: string;
  };
}

interface PiiEntry extends EntryBase {
  pattern: string;
  data_category: string;
  sgbx_category: string | null;
  severity: string;
}

interface EolEntry extends EntryBase {
  category: string;
  eol_date: string | null;
  severity: string;
  upgrade_path: string;
}

interface PassCatalog<E> {
  pass_number: number;
  pass_name: string;
  entries: E[];
}

function loadCatalog<E>(filename: string): PassCatalog<E> {
  const filepath = resolve(PASS_CATALOGS_DIR, filename);
  expect(existsSync(filepath), `${filename} must exist at ${filepath}`).toBe(true);
  const raw = readFileSync(filepath, 'utf-8');
  const parsed = load(raw) as PassCatalog<E>;
  expect(parsed).toBeTruthy();
  expect(typeof parsed).toBe('object');
  return parsed;
}

// -- pass-08-crypto-algorithms.yaml (#3063) --------------------------------

describe('pass-08-crypto-algorithms.yaml (#3063)', () => {
  it('is valid YAML with required top-level fields', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    expect(cat.pass_number).toBe(8);
    expect(cat.pass_name).toMatch(/crypto/i);
    expect(Array.isArray(cat.entries)).toBe(true);
  });

  it('contains at least 10 entries (acceptance criterion)', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    expect(cat.entries.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry has required fields: id, category, detection, posture, cross_reference_frameworks', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    for (const entry of cat.entries) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      expect(entry.detection).toBeTruthy();
      expect(typeof entry.detection).toBe('object');
      expect(entry.posture).toBeTruthy();
      expect(typeof entry.posture.severity).toBe('string');
      expect(Array.isArray(entry.cross_reference_frameworks)).toBe(true);
    }
  });

  it('severity values are from the allowed set', () => {
    const ALLOWED = new Set(['weak', 'deprecated', 'approved', 'approved_preferred']);
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    for (const entry of cat.entries) {
      expect(ALLOWED.has(entry.posture.severity), `id=${entry.id} severity="${entry.posture.severity}" not in allowed set`).toBe(true);
    }
  });

  it('AES-256-GCM entry has approved_preferred severity and BSI TR-02102 approved status', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    const entry = cat.entries.find((e) => e.id === 'aes-256-gcm');
    expect(entry).toBeTruthy();
    expect(entry!.posture.severity).toBe('approved_preferred');
    expect(entry!.posture.bsi_tr02102_status).toBe('approved');
    expect(entry!.cross_reference_frameworks).toContain('BSI_TR_02102');
  });

  it('DES entry has weak severity and prohibited BSI TR-02102 status', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    const entry = cat.entries.find((e) => e.id === 'des');
    expect(entry).toBeTruthy();
    expect(entry!.posture.severity).toBe('weak');
    expect(entry!.posture.bsi_tr02102_status).toBe('prohibited');
  });

  it('RSA-PKCS1v1.5 entry cross-references BSI_TR_02102', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    const entry = cat.entries.find((e) => e.id === 'rsa-pkcs1v1-5');
    expect(entry).toBeTruthy();
    expect(entry!.cross_reference_frameworks).toContain('BSI_TR_02102');
    expect(entry!.posture.severity).toBe('deprecated');
  });

  it('all entries have at least one detection signal (imports or config_keys)', () => {
    const cat = loadCatalog<CryptoEntry>('pass-08-crypto-algorithms.yaml');
    for (const entry of cat.entries) {
      const hasImports = Array.isArray(entry.detection.imports) && entry.detection.imports.length > 0;
      const hasConfigKeys = Array.isArray(entry.detection.config_keys) && entry.detection.config_keys.length > 0;
      expect(hasImports || hasConfigKeys, `entry "${entry.id}" has no detection signals`).toBe(true);
    }
  });
});

// -- pass-03-pii-patterns.yaml (#3064) ------------------------------------

describe('pass-03-pii-patterns.yaml (#3064)', () => {
  it('is valid YAML with required top-level fields', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    expect(cat.pass_number).toBe(3);
    expect(cat.pass_name).toMatch(/data/i);
    expect(Array.isArray(cat.entries)).toBe(true);
  });

  it('contains at least 12 entries (acceptance criterion)', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    expect(cat.entries.length).toBeGreaterThanOrEqual(12);
  });

  it('every entry has required fields: id, pattern, data_category, severity, cross_reference_frameworks', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    for (const entry of cat.entries) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.pattern).toBe('string');
      expect(entry.pattern.length).toBeGreaterThan(0);
      expect(typeof entry.data_category).toBe('string');
      expect(['high', 'critical']).toContain(entry.severity);
      expect(Array.isArray(entry.cross_reference_frameworks)).toBe(true);
    }
  });

  it('patterns are valid regular expressions (loader applies i flag)', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    for (const entry of cat.entries) {
      expect(() => new RegExp(entry.pattern, 'i'), `entry "${entry.id}" pattern is not a valid regex`).not.toThrow();
    }
  });

  it('rentenversicherungsnummer entry is critical and sozialdaten', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    const entry = cat.entries.find((e) => e.id === 'rentenversicherungsnummer');
    expect(entry).toBeTruthy();
    expect(entry!.severity).toBe('critical');
    expect(entry!.sgbx_category).toBe('sozialdaten');
    expect(entry!.cross_reference_frameworks).toContain('SGBX_DE');
    expect(entry!.cross_reference_frameworks).toContain('GDPR');
  });

  it('kvnr entry is gdpr_art9_health and cross-references GDPR', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    const entry = cat.entries.find((e) => e.id === 'kvnr');
    expect(entry).toBeTruthy();
    expect(entry!.data_category).toBe('gdpr_art9_health');
    expect(entry!.cross_reference_frameworks).toContain('GDPR');
  });

  it('rentenversicherungsnummer pattern matches the field name (case-insensitive, loader applies i flag)', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    const entry = cat.entries.find((e) => e.id === 'rentenversicherungsnummer');
    expect(entry).toBeTruthy();
    const regex = new RegExp(entry!.pattern, 'i');
    expect(regex.test('rentenversicherungsnummer')).toBe(true);
    expect(regex.test('RVNR')).toBe(true);
  });

  it('all critical entries cross-reference GDPR or SGBX_DE', () => {
    const cat = loadCatalog<PiiEntry>('pass-03-pii-patterns.yaml');
    const criticalEntries = cat.entries.filter((e) => e.severity === 'critical');
    for (const entry of criticalEntries) {
      const hasGdpr = entry.cross_reference_frameworks?.includes('GDPR');
      const hasSgbx = entry.cross_reference_frameworks?.includes('SGBX_DE');
      expect(hasGdpr || hasSgbx, `critical entry "${entry.id}" must reference GDPR or SGBX_DE`).toBe(true);
    }
  });
});

// -- pass-05-runtime-eol.yaml (#3065) -------------------------------------

describe('pass-05-runtime-eol.yaml (#3065)', () => {
  it('is valid YAML with required top-level fields', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    expect(cat.pass_number).toBe(5);
    expect(cat.pass_name).toMatch(/sbom|cve/i);
    expect(Array.isArray(cat.entries)).toBe(true);
  });

  it('contains at least 15 entries (acceptance criterion)', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    expect(cat.entries.length).toBeGreaterThanOrEqual(15);
  });

  it('every entry has required fields: id, category, eol_date, severity, upgrade_path', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    for (const entry of cat.entries) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      // eol_date may be null (rolling), but must be present
      expect('eol_date' in entry).toBe(true);
      expect(['critical', 'high', 'positive']).toContain(entry.severity);
      expect(typeof entry.upgrade_path).toBe('string');
      expect(entry.upgrade_path.length).toBeGreaterThan(0);
    }
  });

  it('nodejs-16 entry has critical or high severity (EOL 2023-09-11 is past)', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    const entry = cat.entries.find((e) => e.id === 'nodejs-16');
    expect(entry).toBeTruthy();
    expect(['critical', 'high']).toContain(entry!.severity);
    expect(entry!.eol_date).toBe('2023-09-11');
  });

  it('java-17 entry has positive severity (LTS through 2029)', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    const entry = cat.entries.find((e) => e.id === 'java-17');
    expect(entry).toBeTruthy();
    expect(entry!.severity).toBe('positive');
  });

  it('eol_date strings are ISO 8601 date format (YYYY-MM-DD)', () => {
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    for (const entry of cat.entries) {
      if (entry.eol_date !== null) {
        expect(ISO_DATE.test(entry.eol_date), `entry "${entry.id}" eol_date "${entry.eol_date}" is not YYYY-MM-DD`).toBe(true);
      }
    }
  });

  it('all entries cross-reference at least one framework', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    for (const entry of cat.entries) {
      expect(
        Array.isArray(entry.cross_reference_frameworks) && entry.cross_reference_frameworks.length > 0,
        `entry "${entry.id}" has no cross_reference_frameworks`
      ).toBe(true);
    }
  });

  it('spring-boot-2x entry has critical severity (EOL 2023-11-24 is past)', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    const entry = cat.entries.find((e) => e.id === 'spring-boot-2x');
    expect(entry).toBeTruthy();
    expect(entry!.severity).toBe('critical');
  });

  it('OS entries are present for Windows Server EOL risk scenarios', () => {
    const cat = loadCatalog<EolEntry>('pass-05-runtime-eol.yaml');
    const ids = cat.entries.map((e) => e.id);
    expect(ids).toContain('windows-server-2008');
    expect(ids).toContain('windows-server-2012');
    expect(ids).toContain('rhel-centos-7');
  });
});
