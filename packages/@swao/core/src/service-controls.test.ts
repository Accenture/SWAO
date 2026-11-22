// #3577: service-controls.yaml schema, loader, coverage and grey rule (Design 120 §8.2).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ServiceControlsSchema,
  loadServiceControls,
  computeServiceMappingCoverage,
  serviceMappingStatus,
  SERVICE_CONTROLS_FILE,
} from './service-controls.js';

// The Design 120 §8.2 example, with the framework id as framework-meta.yaml
// declares it (BSI_C5, not the folder slug bsi-c5).
const EXAMPLE = `schema_version: "0.1"
framework: BSI_C5
mappings:
  - capability: key_vault
    controls: [CRY-03, CRY-04]
    relevance: configure
    confidence: curated
    source: "framework author review 2026-11"
  - capability: object_storage
    controls: [CRY-02, OPS-05]
    relevance: configure
    confidence: curated
`;

describe('ServiceControlsSchema (#3577)', () => {
  const base = { schema_version: '0.1', framework: 'BSI_C5' };
  const row = { capability: 'key_vault', controls: ['CRY-03'], relevance: 'configure', confidence: 'curated' };

  it('accepts a minimal valid document and a document without mappings', () => {
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [row] }).success).toBe(true);
    const empty = ServiceControlsSchema.parse(base);
    expect(empty.mappings).toEqual([]);
  });

  it('rejects an unknown relevance and an unknown confidence', () => {
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [{ ...row, relevance: 'required' }] }).success).toBe(false);
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [{ ...row, confidence: 'guessed' }] }).success).toBe(false);
  });

  it('rejects a capability tag that is not snake_case (for example a CSP service code)', () => {
    for (const capability of ['Microsoft.KeyVault', 'key-vault', 'KeyVault', '']) {
      expect(ServiceControlsSchema.safeParse({ ...base, mappings: [{ ...row, capability }] }).success, capability).toBe(false);
    }
  });

  it('rejects a duplicate capability, unknown fields and a wrong schema version', () => {
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [row, row] }).success).toBe(false);
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [{ ...row, weight: 3 }] }).success).toBe(false);
    expect(ServiceControlsSchema.safeParse({ ...base, schema_version: '1.0' }).success).toBe(false);
  });

  it('requires controls unless relevance is n/a', () => {
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [{ ...row, controls: [] }] }).success).toBe(false);
    expect(ServiceControlsSchema.safeParse({ ...base, mappings: [{ ...row, relevance: 'n/a', controls: [] }] }).success).toBe(true);
  });

  it('rejects a lowercase folder slug as framework id', () => {
    expect(ServiceControlsSchema.safeParse({ ...base, framework: 'bsi-c5' }).success).toBe(false);
  });
});

describe('loadServiceControls (#3577)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-svc-controls-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const write = (body: string): void => writeFileSync(join(dir, SERVICE_CONTROLS_FILE), body, 'utf-8');

  it('returns absent with no mapping for a framework without the file', () => {
    const r = loadServiceControls(dir, 'BSI_C5');
    expect(r.status).toBe('absent');
    expect(r.mapping).toBeNull();
  });

  it('loads the Design 120 §8.2 example', () => {
    write(EXAMPLE);
    const r = loadServiceControls(dir, 'BSI_C5');
    expect(r.status).toBe('ok');
    expect(r.mapping?.mappings.map((m) => m.capability)).toEqual(['key_vault', 'object_storage']);
  });

  it('reports invalid YAML, a schema violation and a framework id mismatch without throwing', () => {
    write('mappings: [unclosed');
    expect(loadServiceControls(dir).status).toBe('invalid');

    write(EXAMPLE.replace('relevance: configure', 'relevance: maybe'));
    const schema = loadServiceControls(dir, 'BSI_C5');
    expect(schema.status).toBe('invalid');
    expect(schema.errors.join(' ')).toContain('mappings.0.relevance');

    write(EXAMPLE);
    const mismatch = loadServiceControls(dir, 'GDPR');
    expect(mismatch.status).toBe('invalid');
    expect(mismatch.errors[0]).toContain('does not match framework-meta.yaml id "GDPR"');
  });

  it('reports an empty file as invalid, not as an absent mapping', () => {
    write('');
    const r = loadServiceControls(dir, 'BSI_C5');
    expect(r.status).toBe('invalid');
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it.each([
    ['a list', '- capability: key_vault\n'],
    ['a scalar', 'just a string\n'],
  ])('reports a non-object root (%s) as invalid', (_label, body) => {
    write(body);
    const r = loadServiceControls(dir, 'BSI_C5');
    expect(r.status).toBe('invalid');
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('reports an unknown top-level key as invalid', () => {
    write(`${EXAMPLE}owner: someone\n`);
    const r = loadServiceControls(dir, 'BSI_C5');
    expect(r.status).toBe('invalid');
    expect(r.errors.join(' ')).toMatch(/owner|Unrecognized/i);
  });
});

describe('computeServiceMappingCoverage (#3577)', () => {
  const mapping = ServiceControlsSchema.parse({
    schema_version: '0.1',
    framework: 'BSI_C5',
    mappings: [
      { capability: 'key_vault', controls: ['CRY-03'], relevance: 'configure', confidence: 'curated' },
      { capability: 'mainframe', controls: ['OPS-01'], relevance: 'supports', confidence: 'derived' },
    ],
  });

  it('counts mapped versus in-use tags and lists the gaps on both sides', () => {
    const c = computeServiceMappingCoverage(mapping, ['object_storage', 'key_vault', 'kubernetes', 'key_vault']);
    expect(c).toEqual({ in_use: 3, mapped: 1, unmapped: ['kubernetes', 'object_storage'], unused_mappings: ['mainframe'] });
  });

  it('treats a missing mapping as zero coverage', () => {
    expect(computeServiceMappingCoverage(null, ['kubernetes'])).toEqual({ in_use: 1, mapped: 0, unmapped: ['kubernetes'], unused_mappings: [] });
  });
});

describe('serviceMappingStatus: missing mapping is grey, never green (ADR-0041)', () => {
  const mapping = ServiceControlsSchema.parse({
    schema_version: '0.1',
    framework: 'GDPR',
    mappings: [
      { capability: 'key_vault', controls: ['ART-32'], relevance: 'supports', confidence: 'curated' },
      { capability: 'dns', relevance: 'n/a', confidence: 'curated' },
    ],
  });

  it('is grey without a mapping file, for unmapped tags and for a service without tags', () => {
    expect(serviceMappingStatus(null, ['key_vault'])).toBe('grey');
    expect(serviceMappingStatus(mapping, ['kubernetes'])).toBe('grey');
    expect(serviceMappingStatus(mapping, [])).toBe('grey');
  });

  it('is n/a when every hit is n/a and mapped when any hit applies', () => {
    expect(serviceMappingStatus(mapping, ['dns'])).toBe('n/a');
    expect(serviceMappingStatus(mapping, ['dns', 'key_vault', 'kubernetes'])).toBe('mapped');
  });
});
