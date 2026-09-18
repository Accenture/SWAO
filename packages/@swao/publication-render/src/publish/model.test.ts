// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
  CONTRACT_VERSION,
  PublicationModelSchema,
} from './model.js';
import type { PublicationModel } from './model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_PATH = join(__dirname, 'publication-model.schema.json');

// ---------------------------------------------------------------------------
// Minimal valid fixture derived from sovereign-health simulation (Design 041 §13)
// ---------------------------------------------------------------------------

const FIXTURE: PublicationModel = {
  contract_version: '1.1',
  meta: {
    app_id: 'sovereign-health',
    app_name: 'Sovereign Health Platform',
    assessed_at: '2026-05-13T18:42:00Z',
    run_id: '2026-05-13T18-42-00',
    swao_version: '0.1.9',
    engagement: {
      engagement_name: 'ACME Cloud Transformation',
      client_code: 'ACME',
      partnership_lead: 'Engagement Lead',
    },
    licensee: 'Accenture',
    tier: 'community',
    publication_config: {
      classification_band: 'Accenture Internal, Confidential',
      logo_name: 'SWAO',
      logo_sub: 'Publication',
      footer_note: '',
      engagement_lead_label: 'Engagement Lead',
      primary_contact_label: 'Primary Contact',
      secondary_contact_label: 'Secondary Contact',
    },
  },
  summary: {
    seven_r_label: 'Re-platform',
    coverage_score: 0.62,
    signal_counts: { critical: 2, high: 2, medium: 2, low: 1, positive: 1 },
    blocker_count: 3,
    top_findings: [
      {
        id: 'DATA-01',
        pass: '03-data',
        severity: 'critical',
        outcome: 'negative',
        derivation: 'NHS numbers and patient PII stored without field encryption.',
        evidence_refs: ['EV-001'],
        implies: ['GDPR Art.9 failure'],
        tags: ['gdpr', 'pii'],
        anchor: 'signal-DATA-01',
      },
    ],
  },
  signals: [
    {
      id: 'DATA-01',
      pass: '03-data',
      severity: 'critical',
      outcome: 'negative',
      derivation: 'NHS numbers and patient PII stored without field encryption.',
      evidence_refs: ['EV-001'],
      implies: ['GDPR Art.9 failure'],
      tags: ['gdpr', 'pii'],
      anchor: 'signal-DATA-01',
    },
    {
      id: 'CRYPTO-01',
      pass: '08-crypto',
      severity: 'medium',
      outcome: 'negative',
      derivation: 'No at-rest database encryption configured in application code.',
      evidence_refs: ['EV-001'],
      implies: ['KMS binding required'],
      tags: ['gdpr', 'crypto', 'encryption'],
      anchor: 'signal-CRYPTO-01',
    },
  ],
  compliance: [
    {
      framework_id: 'GDPR',
      framework_name: 'Regulation (EU) 2016/679',
      fail_count: 2,
      partial_count: 3,
      pass_count: 1,
      controls: [
        {
          id: 'Art.9',
          title: 'Processing special categories of personal data',
          rag_status: 'fail',
          worst_severity: 'critical',
          signals: ['DATA-01'],
          rationale: 'NHS PII stored without field encryption.',
          article_text: 'Processing of health data is prohibited unless conditions in Art.9(2) apply.',
          evidence: ['EV-001'],
          anchor: 'ctrl-art9',
        },
      ],
    },
  ],
  risk_register: [
    {
      risk_id: 'RR-001',
      signal_ref: 'DATA-01',
      trigger: 'NHS PII Stored Without Field Encryption',
      category: 'GDPR Compliance',
      likelihood: 'high',
      impact: 'high',
      mitigation: 'Implement field-level encryption for NHS PII columns.',
      owner: 'DPO / Dev Lead',
      migration_phase: 'Immediate',
      effort: 'L',
      target_date: '2026-05-31',
      platform_impact: 'LZR blocker: STACKIT requires Art.9 compliance before onboarding.',
      evidence_refs: ['EV-001'],
      status: 'open',
      severity: 'critical',
      anchor: 'rr-001',
    },
  ],
  runbook: [],
  evidence: [
    {
      id: 'EV-001',
      title: 'prisma/schema.prisma',
      type: 'derived',
      file: 'prisma/schema.prisma',
      date: '2026-05-13',
      pii_scrubbed: false,
      used_by: ['DATA-01', 'CRYPTO-01'],
    },
  ],
  input_files: [
    {
      path: 'imports/arch-2024-q4.md',
      kind: 'architecture',
    },
  ],
  tags: {
    gdpr: [
      { anchor: 'signal-DATA-01', type: 'signal', label: 'DATA-01' },
    ],
    pii: [
      { anchor: 'signal-DATA-01', type: 'signal', label: 'DATA-01' },
    ],
  },
  lzr: {
    overall: 'Conditionally Ready',
    blockers: 3,
    checks: [
      { id: 'data-sensitivity', label: 'Data Sensitivity', result: 'fail', signal_ref: 'DATA-01' },
    ],
  },
  run_history: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PublicationModel contract', () => {
  it('CONTRACT_VERSION is 1.1 (Design 068 §4, ADR-0052)', () => {
    expect(CONTRACT_VERSION).toBe('1.1');
  });

  it('schema accepts both 1.0 and 1.1 contract_version for backward compat', () => {
    const base = { ...FIXTURE, contract_version: '1.0' as const };
    expect(PublicationModelSchema.safeParse(base).success).toBe(true);
    const v11 = { ...FIXTURE, contract_version: '1.1' as const };
    expect(PublicationModelSchema.safeParse(v11).success).toBe(true);
    const bad = { ...FIXTURE, contract_version: '0.9' };
    expect(PublicationModelSchema.safeParse(bad).success).toBe(false);
  });

  it('fixture validates against Zod schema', () => {
    const result = PublicationModelSchema.safeParse(FIXTURE);
    if (!result.success) {
      throw new Error(`Zod validation failed: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
  });

  it('fixture contract_version matches CONTRACT_VERSION', () => {
    expect(FIXTURE.contract_version).toBe(CONTRACT_VERSION);
  });

  describe('JSON Schema file', () => {
    it('exists and is valid JSON', () => {
      const raw = readFileSync(SCHEMA_PATH, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it('has required top-level structure', () => {
      const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
      expect(schema.type).toBe('object');
      expect(schema.required).toContain('contract_version');
      expect(schema.required).toContain('meta');
      expect(schema.required).toContain('signals');
      expect(schema.required).toContain('compliance');
      expect(schema.required).toContain('risk_register');
      expect(schema.required).toContain('evidence');
      expect(schema.required).toContain('lzr');
      expect(schema.definitions).toBeDefined();
    });

    it('fixture validates against JSON Schema', () => {
      const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
      const ajv = new Ajv({ strict: false });
      const validate = ajv.compile(schema);
      const valid = validate(FIXTURE);
      if (!valid) {
        throw new Error(`JSON Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
      }
    });
  });
});
