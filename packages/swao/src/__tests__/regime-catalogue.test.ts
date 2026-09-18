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

import { describe, it, expect } from 'vitest';
import {
  RegimeIdSchema,
  RegimeMetaSchema,
  RegimeControlSchema,
  RegimeCatalogueSchema,
  RegimeIndexSchema,
  REGIME_ID_REGEX,
} from '../schema/regime-catalogue.js';

describe('RegimeIdSchema', () => {
  it('accepts the seven flagship regime IDs', () => {
    const ids = ['GDPR', 'HIPAA', 'PCI_DSS', 'ISO_27001', 'SOC_2', 'BSI_C5', 'DORA'];
    for (const id of ids) {
      expect(RegimeIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('accepts a custom overlay ID with hyphen', () => {
    expect(RegimeIdSchema.safeParse('ACME-INTERNAL-SEC').success).toBe(true);
  });

  it('rejects lowercase first character', () => {
    expect(RegimeIdSchema.safeParse('gdpr').success).toBe(false);
  });

  it('rejects mixed-case (DiGA fails the open-string regex; alias handled at registry level)', () => {
    expect(RegimeIdSchema.safeParse('DiGA').success).toBe(false);
  });

  it('rejects starting with a digit', () => {
    expect(RegimeIdSchema.safeParse('1GDPR').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(RegimeIdSchema.safeParse('').success).toBe(false);
  });

  it('rejects a string longer than 32 characters', () => {
    expect(RegimeIdSchema.safeParse('A' + 'A'.repeat(32)).success).toBe(false);
  });

  it('rejects whitespace and special characters', () => {
    expect(RegimeIdSchema.safeParse('GDPR ART 32').success).toBe(false);
    expect(RegimeIdSchema.safeParse('GDPR.32').success).toBe(false);
    expect(RegimeIdSchema.safeParse('GDPR/32').success).toBe(false);
  });

  it('REGIME_ID_REGEX matches a known good ID and rejects a bad one', () => {
    expect(REGIME_ID_REGEX.test('DORA')).toBe(true);
    expect(REGIME_ID_REGEX.test('dora')).toBe(false);
  });
});

describe('RegimeMetaSchema', () => {
  const valid = {
    id: 'DORA',
    name: 'Digital Operational Resilience Act',
    version: '2024-01',
    scope: 'community',
    authority: 'European Union',
    applicability_hints: ['financial_services'],
    description:
      'EU regulation effective 2025-01-17 covering ICT risk management and operational resilience for financial entities.',
    references: ['https://eur-lex.europa.eu/'],
    catalogue_version: '1.0.0',
  };

  it('accepts a valid meta block', () => {
    expect(RegimeMetaSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects description shorter than 20 chars', () => {
    expect(
      RegimeMetaSchema.safeParse({ ...valid, description: 'too short' }).success,
    ).toBe(false);
  });

  it('rejects an invalid scope', () => {
    expect(RegimeMetaSchema.safeParse({ ...valid, scope: 'private' }).success).toBe(false);
  });

  it('rejects a non-semver catalogue_version', () => {
    expect(
      RegimeMetaSchema.safeParse({ ...valid, catalogue_version: '1.0' }).success,
    ).toBe(false);
  });

  it('defaults applicability_hints and references to empty arrays', () => {
    const minimal = { ...valid };
    delete (minimal as Record<string, unknown>).applicability_hints;
    delete (minimal as Record<string, unknown>).references;
    const parsed = RegimeMetaSchema.parse(minimal);
    expect(parsed.applicability_hints).toEqual([]);
    expect(parsed.references).toEqual([]);
  });
});

describe('RegimeControlSchema', () => {
  it('accepts a control with signal_prefix evidence_basis', () => {
    const control = {
      id: 'DORA_Art_9',
      title: 'ICT risk management framework',
      description: 'Article 9 covers the ICT risk management framework.',
      severity_default: 'high',
      evidence_basis: [{ signal_prefix: 'CRYPTO' }, { signal_prefix: 'TF' }],
    };
    expect(RegimeControlSchema.safeParse(control).success).toBe(true);
  });

  it('accepts a control with mixed evidence_basis (signal_prefix, context_input, pass)', () => {
    const control = {
      id: 'BSI_C5_DAT-01',
      title: 'Data security baseline',
      description: 'Mixed evidence sources for the data security baseline.',
      evidence_basis: [
        { signal_prefix: 'DATA' },
        { context_input: 'cmdb_export' },
        { pass: 3 },
      ],
    };
    expect(RegimeControlSchema.safeParse(control).success).toBe(true);
  });

  it('rejects a control with title shorter than 3 chars', () => {
    expect(
      RegimeControlSchema.safeParse({
        id: 'X',
        title: 'XY',
        description: 'this description is fine and long enough',
      }).success,
    ).toBe(false);
  });

  it('defaults overrides to empty array', () => {
    const parsed = RegimeControlSchema.parse({
      id: 'GDPR_Art_32',
      title: 'Security of processing',
      description: 'Implementation of appropriate technical and organisational measures.',
    });
    expect(parsed.overrides).toEqual([]);
  });

  it('defaults tags to empty array when omitted (sprint-038 #0348)', () => {
    const parsed = RegimeControlSchema.parse({
      id: 'GDPR_Art_5',
      title: 'Principles relating to processing',
      description: 'Personal data shall be processed lawfully, fairly, and transparently.',
    });
    expect(parsed.tags).toEqual([]);
  });

  it('accepts a non-empty tags array (sprint-038 #0348)', () => {
    const parsed = RegimeControlSchema.parse({
      id: 'GDPR_Art_15',
      title: 'Right of access by the data subject',
      description: 'The data subject shall have the right to obtain confirmation.',
      tags: ['data-subject-right.access', 'controller-only', 'domestic-only'],
    });
    expect(parsed.tags).toEqual(['data-subject-right.access', 'controller-only', 'domestic-only']);
  });

  it('rejects a tags entry that is not a string', () => {
    expect(
      RegimeControlSchema.safeParse({
        id: 'X',
        title: 'Test',
        description: 'a long enough description for the schema parser',
        tags: ['ok', 42],
      }).success,
    ).toBe(false);
  });
});

describe('RegimeCatalogueSchema', () => {
  const meta = {
    id: 'GDPR',
    name: 'General Data Protection Regulation',
    version: '2018-05',
    scope: 'community' as const,
    authority: 'European Union',
    description: 'EU data protection regulation in force since 2018-05-25.',
    catalogue_version: '1.0.0',
  };

  const control = {
    id: 'GDPR_Art_32',
    title: 'Security of processing',
    description: 'Implementation of appropriate technical and organisational measures.',
  };

  it('accepts a catalogue with at least one control', () => {
    expect(
      RegimeCatalogueSchema.safeParse({ regime_meta: meta, controls: [control] }).success,
    ).toBe(true);
  });

  it('rejects an empty controls array', () => {
    expect(
      RegimeCatalogueSchema.safeParse({ regime_meta: meta, controls: [] }).success,
    ).toBe(false);
  });

  it('rejects when regime_meta is missing', () => {
    expect(RegimeCatalogueSchema.safeParse({ controls: [control] }).success).toBe(false);
  });
});

describe('RegimeIndexSchema', () => {
  const entry = {
    id: 'GDPR',
    name: 'General Data Protection Regulation',
    version: '2018-05',
    file: 'gdpr-controls.yaml',
    controls_count: 20,
    applicability_hints: ['eu_data', 'personal_data'],
  };

  it('accepts a valid index with one entry', () => {
    expect(
      RegimeIndexSchema.safeParse({
        schema_version: '1',
        scope: 'community',
        regimes: [entry],
      }).success,
    ).toBe(true);
  });

  it('accepts an empty community index (zero regimes)', () => {
    expect(
      RegimeIndexSchema.safeParse({
        schema_version: '1',
        scope: 'community',
        regimes: [],
      }).success,
    ).toBe(true);
  });

  it('rejects a non-yaml file path', () => {
    expect(
      RegimeIndexSchema.safeParse({
        schema_version: '1',
        scope: 'community',
        regimes: [{ ...entry, file: 'gdpr-controls.json' }],
      }).success,
    ).toBe(false);
  });

  it('rejects controls_count less than 1', () => {
    expect(
      RegimeIndexSchema.safeParse({
        schema_version: '1',
        scope: 'community',
        regimes: [{ ...entry, controls_count: 0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a wrong schema_version literal', () => {
    expect(
      RegimeIndexSchema.safeParse({
        schema_version: '2',
        scope: 'community',
        regimes: [entry],
      }).success,
    ).toBe(false);
  });
});
