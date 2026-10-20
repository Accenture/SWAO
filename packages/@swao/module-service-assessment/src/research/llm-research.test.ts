// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3308: structured facts of prompt version 1.1, parsed leniently.

import { describe, it, expect } from 'vitest';
import { LLM_RESEARCH_PROMPT_VERSION, buildLlmResearchPrompt } from './llm-prompts.js';
import { parseLlmFacts, researchTopicWithLlm } from './llm-research.js';
import { LlmBlockSchema } from './schema.js';

const input = { vendor: 'ACME', product: 'Imaging Suite', version: '7.2', infraCategory: 'INFRA_MEDIZIN_PACS' };

describe('prompt version 1.1 (#3308)', () => {
  it('records version 1.1 and asks only the fact fields of each topic', () => {
    expect(LLM_RESEARCH_PROMPT_VERSION).toBe('1.1-2026-10-18');
    const vp = buildLlmResearchPrompt('vendor-profile', input);
    expect(vp).toContain('"facts": {');
    expect(vp).toContain('"eu_entity"');
    expect(vp).not.toContain('"mdr_class"');
    expect(buildLlmResearchPrompt('certifications', input)).toContain('"bfarm_listed"');
    expect(buildLlmResearchPrompt('data-residency', input)).toContain('"gdpr_dpa_available"');
    expect(buildLlmResearchPrompt('breach-history', input)).not.toContain('"facts"');
  });

  it('carries only vendor, product, version, and category as data', () => {
    const p = buildLlmResearchPrompt('certifications', input);
    expect(p).toContain('Vendor: ACME\nProduct: Imaging Suite\nVersion: 7.2\nCategory (SWAO infrastructure catalogue): INFRA_MEDIZIN_PACS');
    expect(p).not.toContain('DRAFT');
  });
});

describe('parseLlmFacts (#3308)', () => {
  it('returns undefined for a version 1.0 answer, a non-object block, or a topic without facts', () => {
    expect(parseLlmFacts('vendor-profile', undefined)).toBeUndefined();
    expect(parseLlmFacts('vendor-profile', 'n/a')).toBeUndefined();
    expect(parseLlmFacts('vendor-profile', [])).toBeUndefined();
    expect(parseLlmFacts('breach-history', { eu_entity: 'no' })).toBeUndefined();
  });

  it('normalises booleans, case, numeric strings, and class prefixes', () => {
    expect(parseLlmFacts('vendor-profile', { eu_entity: false, patch_cadence_days_estimate: ' 120 ' })).toEqual({ eu_entity: 'no', patch_cadence_days_estimate: 120 });
    expect(parseLlmFacts('vendor-profile', { eu_entity: 'YES', patch_cadence_days_estimate: 30 })).toEqual({ eu_entity: 'yes', patch_cadence_days_estimate: 30 });
    expect(parseLlmFacts('certifications', { mdr_class: 'Class IIa', bfarm_listed: 'No' })).toEqual({ mdr_class: 'IIa', bfarm_listed: 'no' });
    expect(parseLlmFacts('certifications', { mdr_class: 'CLASS_NOT_PUBLISHED' })).toEqual({ mdr_class: 'class_not_published', bfarm_listed: 'unknown' });
  });

  it('turns invalid or missing values into unknown or null, never into an answer', () => {
    expect(parseLlmFacts('vendor-profile', {})).toEqual({ eu_entity: 'unknown', patch_cadence_days_estimate: null });
    expect(parseLlmFacts('vendor-profile', { eu_entity: 'probably', patch_cadence_days_estimate: -5 })).toEqual({ eu_entity: 'unknown', patch_cadence_days_estimate: null });
    expect(parseLlmFacts('vendor-profile', { patch_cadence_days_estimate: 'about 3 months' })?.patch_cadence_days_estimate).toBeNull();
    expect(parseLlmFacts('certifications', { mdr_class: 'Class V' })?.mdr_class).toBe('unknown');
  });

  it('keeps only the fields of the topic and only HTTP(S) sources, marked model-cited and unverified', () => {
    const f = parseLlmFacts('data-residency', {
      gdpr_dpa_available: 'no', eu_entity: 'no', mdr_class: 'III',
      sources: ['https://vendor.example/dpa', 'ftp://x', 'not a url', { url: 'https://vendor.example/legal' }, 7],
    });
    expect(f).toEqual({
      gdpr_dpa_available: 'no',
      sources: [
        { url: 'https://vendor.example/dpa', title: null, cited_by: 'model', verified: false },
        { url: 'https://vendor.example/legal', title: null, cited_by: 'model', verified: false },
      ],
    });
  });
});

describe('researchTopicWithLlm stores facts (#3308)', () => {
  const llm = (answer: string) => ({ name: 'mock', model: 'm', complete: async () => answer });
  const now = new Date('2026-10-18T08:00:00Z');

  it('stores parsed facts in the llm block, and none for an answer without facts', async () => {
    const withFacts = await researchTopicWithLlm(llm(JSON.stringify({ summary: 's', facts: { gdpr_dpa_available: 'no' }, findings: [] })), 'data-residency', input, now);
    expect(withFacts.skippedReason).toBeNull();
    expect(withFacts.block.facts).toEqual({ gdpr_dpa_available: 'no' });
    expect(LlmBlockSchema.safeParse(withFacts.block).success).toBe(true);
    const v10 = await researchTopicWithLlm(llm(JSON.stringify({ summary: 's', findings: [] })), 'data-residency', input, now);
    expect(v10.skippedReason).toBeNull();
    expect(v10.block.facts).toBeUndefined();
  });

  it('never fails a topic on a malformed facts block', async () => {
    const out = await researchTopicWithLlm(llm(JSON.stringify({ summary: 's', facts: 'unknown', findings: [] })), 'certifications', input, now);
    expect(out.skippedReason).toBeNull();
    expect(out.block.facts).toBeUndefined();
  });
});
