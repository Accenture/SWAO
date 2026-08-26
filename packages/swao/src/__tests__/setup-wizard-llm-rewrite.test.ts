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

import { describe, it, expect } from 'vitest';

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
