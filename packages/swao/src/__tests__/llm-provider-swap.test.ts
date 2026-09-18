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

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmProvider } from '@swao/module-llm-providers';
import { OllamaLlmProvider } from '@swao/module-llm-providers';
import { AnthropicLlmProvider } from '@swao/module-llm-providers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '../../../../');

afterEach(() => {
  delete process.env['SWAO_LLM_PROVIDER'];
  delete process.env['SWAO_ANTHROPIC_API_KEY'];
});

// ---------------------------------------------------------------------------
// createLlmProvider() factory routing (#0126)
// ---------------------------------------------------------------------------

describe('createLlmProvider() factory routing (#0126)', () => {
  it('throws when SWAO_LLM_PROVIDER is unset (no silent default)', () => {
    delete process.env['SWAO_LLM_PROVIDER'];
    expect(() => createLlmProvider()).toThrow(/No LLM provider configured/);
  });

  it('throws when SWAO_LLM_PROVIDER=stub (#0473: stub deleted from production)', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'stub';
    expect(() => createLlmProvider()).toThrow(/Unknown LLM provider/);
  });

  it('returns OllamaLlmProvider when SWAO_LLM_PROVIDER=ollama', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'ollama';
    expect(createLlmProvider()).toBeInstanceOf(OllamaLlmProvider);
  });

  it('returns AnthropicLlmProvider when SWAO_LLM_PROVIDER=anthropic', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'anthropic';
    process.env['SWAO_ANTHROPIC_API_KEY'] = 'sk-ant-test';
    expect(createLlmProvider()).toBeInstanceOf(AnthropicLlmProvider);
  });

  it('throws (no silent stub substitution) for unknown provider values (#0325)', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'bedrock';
    expect(() => createLlmProvider()).toThrow(/Unknown LLM provider/);
  });
});

// ---------------------------------------------------------------------------
// Runbook + validation script artefacts (#0126)
// ---------------------------------------------------------------------------

describe('LLM provider-swap runbook artefacts (#0126)', () => {
  it('docs/runbooks/llm-provider-swap.md exists', () => {
    expect(existsSync(join(REPO_ROOT, 'docs', 'runbooks', 'llm-provider-swap.md'))).toBe(true);
  });

  it('runbook documents anthropic and ollama providers', () => {
    const content = readFileSync(
      join(REPO_ROOT, 'docs', 'runbooks', 'llm-provider-swap.md'), 'utf-8');
    expect(content).toContain('anthropic');
    expect(content).toContain('ollama');
  });

  it('runbook documents SWAO_LLM_PROVIDER env var', () => {
    const content = readFileSync(
      join(REPO_ROOT, 'docs', 'runbooks', 'llm-provider-swap.md'), 'utf-8');
    expect(content).toContain('SWAO_LLM_PROVIDER');
  });

  it('runbook documents both swap directions (Anthropic->Ollama and Ollama->Anthropic)', () => {
    const content = readFileSync(
      join(REPO_ROOT, 'docs', 'runbooks', 'llm-provider-swap.md'), 'utf-8');
    expect(content).toMatch(/Anthropic.*Ollama/s);
    expect(content).toMatch(/Ollama.*Anthropic/s);
  });

  it('runbook documents the providers_used WSP field', () => {
    const content = readFileSync(
      join(REPO_ROOT, 'docs', 'runbooks', 'llm-provider-swap.md'), 'utf-8');
    expect(content).toContain('providers-used');
  });

  it('scripts/validate-llm-swap.sh exists', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts', 'validate-llm-swap.sh'))).toBe(true);
  });

  it('validate-llm-swap.sh is a bash script', () => {
    const content = readFileSync(
      join(REPO_ROOT, 'scripts', 'validate-llm-swap.sh'), 'utf-8');
    expect(content).toMatch(/^#!.*bash/);
  });

  it('validate-llm-swap.sh is CI-safe (skips Ollama when not reachable)', () => {
    const content = readFileSync(
      join(REPO_ROOT, 'scripts', 'validate-llm-swap.sh'), 'utf-8');
    expect(content).toContain('11434');
    expect(content).toMatch(/skip/i);
  });
});
