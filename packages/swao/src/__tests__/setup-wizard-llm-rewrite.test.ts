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

// #0405 (sprint-040 round-5): SetupWizard writeLlmToYaml must replace
// the providers.llm.primary block on EVERY save, not just on the virgin
// template. Operator round-5 binary-test feedback: re-running Setup and
// picking a different provider silently failed because the previous
// regex only matched `type: ~\n      model: ~`.
//
// The function is private to SetupWizard.tsx; this test reproduces the
// regex behaviour via a portable helper so future regex changes stay
// covered. If SetupWizard's regex drifts from this helper, update both.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

function rewriteLlmBlock(yaml: string, llmBlock: string): string {
  const primaryBlock = /( {4}primary:\n)(?: {6}[^\n]*\n?)+/;
  if (primaryBlock.test(yaml)) return yaml.replace(primaryBlock, `$1${llmBlock}\n`);
  return yaml.replace(/ {6}type: ~\n {6}model: ~/, llmBlock);
}

const ANTHROPIC_BLOCK = `      type: anthropic\n      model: claude-haiku-4-5\n      temperature: 0\n      max_tokens: 32768`;
const OPENAI_BLOCK = `      type: openai\n      model: gpt-4o-mini\n      temperature: 0`;

const VIRGIN_YAML = `# .swao.yml
wsp_version: "0.9"
providers:
  llm:
    primary:
      type: ~
      model: ~
  redactor:
    type: gitleaks
`;

const ALREADY_OPENAI_YAML = `# .swao.yml
wsp_version: "0.9"
providers:
  llm:
    primary:
      type: openai
      model: gpt-4o-mini
      temperature: 0
  redactor:
    type: gitleaks
`;

const ALREADY_ANTHROPIC_YAML = `# .swao.yml
wsp_version: "0.9"
providers:
  llm:
    primary:
      type: anthropic
      model: claude-haiku-4-5
      temperature: 0
      max_tokens: 32768
  redactor:
    type: gitleaks
`;

describe('SetupWizard writeLlmToYaml regex (#0405)', () => {
  it('virgin template -> writes OpenAI block', () => {
    const result = rewriteLlmBlock(VIRGIN_YAML, OPENAI_BLOCK);
    expect(result).toContain('type: openai');
    expect(result).toContain('model: gpt-4o-mini');
    expect(result).not.toContain('type: ~');
    expect(result).not.toContain('model: ~');
    // redactor: must be preserved
    expect(result).toContain('redactor:');
    expect(result).toContain('type: gitleaks');
  });

  it('already-OpenAI -> rewrites to Anthropic (the core regression)', () => {
    const result = rewriteLlmBlock(ALREADY_OPENAI_YAML, ANTHROPIC_BLOCK);
    expect(result).toContain('type: anthropic');
    expect(result).toContain('model: claude-haiku-4-5');
    expect(result).toContain('max_tokens: 32768');
    expect(result).not.toContain('type: openai');
    expect(result).not.toContain('model: gpt-4o-mini');
    // redactor: preserved
    expect(result).toContain('redactor:');
    expect(result).toContain('type: gitleaks');
  });

  it('already-Anthropic -> rewrites to OpenAI', () => {
    const result = rewriteLlmBlock(ALREADY_ANTHROPIC_YAML, OPENAI_BLOCK);
    expect(result).toContain('type: openai');
    expect(result).toContain('model: gpt-4o-mini');
    expect(result).not.toContain('type: anthropic');
    expect(result).not.toContain('max_tokens: 32768');
    expect(result).toContain('redactor:');
  });

  it('does NOT eat the redactor: sibling block', () => {
    const result = rewriteLlmBlock(ALREADY_OPENAI_YAML, ANTHROPIC_BLOCK);
    expect(result.split('redactor:').length).toBe(2);
    expect(result.split('type: gitleaks').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #2815: writeVisionMaxScreensToYaml -- scaffold template comment + update logic
// ---------------------------------------------------------------------------

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { writeVisionMaxScreensToYaml } from '../tui/screens/wizard/yaml-helpers.js';

describe('writeVisionMaxScreensToYaml (#2815)', () => {
  const dir = join(tmpdir(), `swao-test-vision-${Date.now()}`);
  const yaml = join(dir, '.swao.yml');

  beforeAll(() => { mkdirSync(dir, { recursive: true }); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ } });

  it('appends assessment block to a YAML without one', () => {
    writeFileSync(yaml, VIRGIN_YAML, 'utf-8');
    writeVisionMaxScreensToYaml(dir, 3);
    const out = readFileSync(yaml, 'utf-8');
    expect(out).toContain('assessment:');
    expect(out).toContain('vision_max_screens: 3');
  });

  it('updates vision_max_screens when assessment block already exists', () => {
    writeFileSync(yaml, VIRGIN_YAML + '\nassessment:\n  vision_max_screens: 3\n', 'utf-8');
    writeVisionMaxScreensToYaml(dir, 5);
    const out = readFileSync(yaml, 'utf-8');
    expect(out).toContain('vision_max_screens: 5');
    expect(out).not.toContain('vision_max_screens: 3');
  });

  it('removes commented-out assessment block before appending live one', () => {
    const withComment = VIRGIN_YAML + '\n# assessment:\n#   vision_max_screens: 2  # screenshots per run\n';
    writeFileSync(yaml, withComment, 'utf-8');
    writeVisionMaxScreensToYaml(dir, 2);
    const out = readFileSync(yaml, 'utf-8');
    expect(out.match(/assessment:/g)?.length).toBe(1); // exactly one live block
    expect(out).toContain('vision_max_screens: 2');
  });

  it('preserves the rest of the YAML when appending', () => {
    writeFileSync(yaml, VIRGIN_YAML, 'utf-8');
    writeVisionMaxScreensToYaml(dir, 2);
    const out = readFileSync(yaml, 'utf-8');
    expect(out).toContain('wsp_version: "0.9"');
    expect(out).toContain('providers:');
    expect(out).toContain('redactor:');
  });
});
