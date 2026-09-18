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

// #0751: YAML field-path round-trip tests for providers.llm and crawl blocks.
//
// Background (docs/design/064-automated-testing-strategy.md Section 10.7):
// Sprint-076 bug #0748 was caused by compliance-evaluator reading from a
// stale field path. The rule: every YAML reader must have a round-trip test
// that calls the real writer and the real reader so they can never drift apart
// in isolation.
//
// This file covers the two remaining entries from the #0751 audit table:
//   1. providers.llm.primary  -- written by SetupWizard.tsx writeLlmToYaml(),
//                                read   by readLlmPrimaryConfig() in assess.ts.
//   2. crawl.target_url et al. -- written by writeCrawlSection() from @swao/core
//                                 (called by AssessScreen input-playwright-password),
//                                read   by buildCrawlConfig() in assess.ts.
//
// LLM writer note: writeLlmToYaml() is a private React-entangled function in
// SetupWizard.tsx. The local rewriteLlmBlock() helper below reproduces its
// regex logic. If SetupWizard's regex changes, update this helper too.
// (The existing regime-picker and lenses tests use exported functions -- that
// is the preferred pattern; use it for any future round-trip tests.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { SwaoYmlSchema, writeCrawlSection } from '@swao/core';
import { buildCrawlConfig, readLlmPrimaryConfig, readLlmSecondaryConfig } from './assess.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TMP_DIR = join(tmpdir(), `swao-assess-roundtrip-${process.pid}`);

beforeAll(() => { mkdirSync(TMP_DIR, { recursive: true }); });
afterAll(()  => { rmSync(TMP_DIR, { recursive: true, force: true }); });

/** Minimal workspace .swao.yml produced by SetupWizard.tsx writeAndFinish(). */
const VIRGIN_WORKSPACE_YAML = `# .swao.yml -- SWAO workspace configuration
wsp_version: "0.9"

engagement:
  name: "Test Engagement"
  client_code: "TEST01"
  start_date: "2026-01-01"
  partnership_lead: "test@example.com"

providers:
  llm:
    primary:
      type: ~
      model: ~
  redactor:
    type: gitleaks
imports_dir: wsp/inputs/
`;

/**
 * Reproduce the regex logic of writeLlmToYaml() in SetupWizard.tsx.
 * KEEP IN SYNC with that function's primaryBlock regex and llmBlock strings.
 * If SetupWizard's regex changes, update this helper too.
 */
function rewriteLlmBlock(yaml: string, llmBlock: string): string {
  const primaryBlock = /( {4}primary:\n)(?: {6}[^\n]*\n?)+/;
  if (primaryBlock.test(yaml)) return yaml.replace(primaryBlock, `$1${llmBlock}\n`);
  return yaml.replace(/ {6}type: ~\n {6}model: ~/, llmBlock);
}

/** Parse a raw YAML string the same way assess.ts does at runtime. */
function parseSwaoYml(content: string): Record<string, unknown> {
  const raw = (load(content) ?? {}) as Record<string, unknown>;
  const result = SwaoYmlSchema.safeParse(raw);
  // Mirrors the assess.ts fallback: use parsed.data when valid, raw otherwise.
  return (result.success ? result.data : raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. providers.llm.primary round-trip
//    Writer:  writeLlmToYaml() in tui/screens/SetupWizard.tsx (reproduced below)
//    Reader:  readLlmPrimaryConfig() in commands/assess.ts
// ---------------------------------------------------------------------------

describe('providers.llm.primary YAML round-trip (#0751 Task A)', () => {
  it('Anthropic block: write via SetupWizard regex, read via readLlmPrimaryConfig', () => {
    const path = join(TMP_DIR, 'llm-anthropic.swao.yml');
    const anthropicBlock = `      type: anthropic\n      model: claude-haiku-4-5\n      temperature: 0\n      max_tokens: 32768`;
    const updated = rewriteLlmBlock(VIRGIN_WORKSPACE_YAML, anthropicBlock);
    writeFileSync(path, updated, 'utf-8');

    const swaoYml = parseSwaoYml(readFileSync(path, 'utf-8'));
    const cfg = readLlmPrimaryConfig(swaoYml);

    expect(cfg).toBeDefined();
    expect(cfg?.type).toBe('anthropic');
    expect(cfg?.model).toBe('claude-haiku-4-5');
    expect(cfg?.temperature).toBe(0);
    expect(cfg?.max_tokens).toBe(32768);
  });

  it('OpenAI block: write via SetupWizard regex, read via readLlmPrimaryConfig', () => {
    const path = join(TMP_DIR, 'llm-openai.swao.yml');
    const openaiBlock = `      type: openai\n      model: gpt-4o-mini\n      temperature: 0`;
    const updated = rewriteLlmBlock(VIRGIN_WORKSPACE_YAML, openaiBlock);
    writeFileSync(path, updated, 'utf-8');

    const swaoYml = parseSwaoYml(readFileSync(path, 'utf-8'));
    const cfg = readLlmPrimaryConfig(swaoYml);

    expect(cfg).toBeDefined();
    expect(cfg?.type).toBe('openai');
    expect(cfg?.model).toBe('gpt-4o-mini');
  });

  it('Ollama block: write via SetupWizard regex, read via readLlmPrimaryConfig', () => {
    const path = join(TMP_DIR, 'llm-ollama.swao.yml');
    const ollamaBlock = `      type: ollama\n      endpoint: "http://localhost:11434"\n      model: llama3`;
    const updated = rewriteLlmBlock(VIRGIN_WORKSPACE_YAML, ollamaBlock);
    writeFileSync(path, updated, 'utf-8');

    const swaoYml = parseSwaoYml(readFileSync(path, 'utf-8'));
    const cfg = readLlmPrimaryConfig(swaoYml);

    expect(cfg).toBeDefined();
    expect(cfg?.type).toBe('ollama');
    expect(cfg?.model).toBe('llama3');
  });

  it('virgin template (type: ~) returns undefined -- no provider configured', () => {
    const path = join(TMP_DIR, 'llm-virgin.swao.yml');
    writeFileSync(path, VIRGIN_WORKSPACE_YAML, 'utf-8');

    const swaoYml = parseSwaoYml(readFileSync(path, 'utf-8'));
    // providers.llm.primary.type is null/undefined in the virgin template
    const cfg = readLlmPrimaryConfig(swaoYml);

    // type and model are null (YAML ~) which assess.ts correctly treats as unconfigured
    expect(cfg?.type == null || cfg?.type === undefined).toBe(true);
  });

  it('re-run Setup rewrites existing provider block (regression #0405)', () => {
    const path = join(TMP_DIR, 'llm-rewrite.swao.yml');
    // First run: configure Anthropic
    const anthropicBlock = `      type: anthropic\n      model: claude-haiku-4-5\n      temperature: 0\n      max_tokens: 32768`;
    writeFileSync(path, rewriteLlmBlock(VIRGIN_WORKSPACE_YAML, anthropicBlock), 'utf-8');

    // Second run: reconfigure to OpenAI
    const openaiBlock = `      type: openai\n      model: gpt-4o-mini\n      temperature: 0`;
    const reconfigured = rewriteLlmBlock(readFileSync(path, 'utf-8'), openaiBlock);
    writeFileSync(path, reconfigured, 'utf-8');

    const swaoYml = parseSwaoYml(readFileSync(path, 'utf-8'));
    const cfg = readLlmPrimaryConfig(swaoYml);

    expect(cfg?.type).toBe('openai');
    expect(cfg?.model).toBe('gpt-4o-mini');
    // Anthropic leftovers must be gone
    const raw = readFileSync(path, 'utf-8');
    expect(raw).not.toContain('type: anthropic');
    expect(raw).not.toContain('max_tokens: 32768');
  });
});

// ---------------------------------------------------------------------------
// 2. crawl block round-trip
//    Writer:  writeCrawlSection() from @swao/core
//             (called by AssessScreen.tsx input-playwright-password phase)
//    Reader:  buildCrawlConfig() in commands/assess.ts
// ---------------------------------------------------------------------------

/** Minimal per-app .swao.yml produced by AssessScreen scaffoldApp(). */
const APP_YAML_TEMPLATE = `wsp_version: "0.9"
app_id: test-app
`;

describe('crawl block YAML round-trip (#0751 Task B)', () => {
  it('writeCrawlSection is a no-op -- credentials go to vault, not YAML', () => {
    const path = join(TMP_DIR, 'crawl-no-op.swao.yml');
    writeFileSync(path, APP_YAML_TEMPLATE, 'utf-8');

    writeCrawlSection(path, {});

    const raw = readFileSync(path, 'utf-8');
    expect(raw).not.toContain('crawl:');
    expect(raw).not.toContain('target_url:');
    expect(raw).not.toContain('username:');
    expect(raw).not.toContain('password:');

    // buildCrawlConfig returns null -- URL must come from the credential vault
    const cfg = buildCrawlConfig(parseSwaoYml(raw));
    expect(cfg).toBeNull();
  });

  it('backward compat: buildCrawlConfig reads legacy target_url from YAML', () => {
    // Workspaces written before vault-first migration may still have target_url in YAML.
    // buildCrawlConfig must read it so existing workspaces keep working.
    const legacyYaml = APP_YAML_TEMPLATE.trimEnd() +
      '\ncrawl:\n  target_url: https://app.example.com\n';
    const cfg = buildCrawlConfig(parseSwaoYml(legacyYaml));
    expect(cfg).not.toBeNull();
    expect(cfg?.targetUrl).toBe('https://app.example.com');
    expect(cfg?.authType).toBe('none');
  });

  it('backward compat: buildCrawlConfig reads username+password from legacy YAML', () => {
    // Old configs written before vault-first may still have credentials in YAML.
    const path = join(TMP_DIR, 'crawl-legacy-password.swao.yml');
    const legacyYaml = APP_YAML_TEMPLATE.trimEnd() +
      '\ncrawl:\n  target_url: https://app.example.com\n  username: legacy-user\n  password: legacy-secret-123\n';
    writeFileSync(path, legacyYaml, 'utf-8');

    const cfg = buildCrawlConfig(parseSwaoYml(readFileSync(path, 'utf-8')));
    expect(cfg).not.toBeNull();
    expect(cfg?.username).toBe('legacy-user');
    expect(cfg?.password).toBe('legacy-secret-123');
    expect(cfg?.authType).toBe('form');
  });

  it('no crawl block: buildCrawlConfig returns null (vault injection bootstraps at runtime)', () => {
    const cfg = buildCrawlConfig(parseSwaoYml(APP_YAML_TEMPLATE));
    expect(cfg).toBeNull();
  });

  // #1085: bare hostname (no https://) was silently breaking fetchSitemapUrls +
  // extractSameOriginLinks (new URL() throws), leaving only 1 screen captured.
  it('bare hostname is normalised to https:// by buildCrawlConfig (#1085)', () => {
    const rawYaml = APP_YAML_TEMPLATE.trimEnd() +
      '\ncrawl:\n  target_url: sovereignhealth.io/login\n';
    const swaoYml = parseSwaoYml(rawYaml);
    const cfg = buildCrawlConfig(swaoYml);
    expect(cfg).not.toBeNull();
    expect(cfg?.targetUrl).toBe('https://sovereignhealth.io/login');
  });
});

// ---------------------------------------------------------------------------
// 3. providers.llm.secondary YAML round-trip (#1703)
//    Reader: readLlmSecondaryConfig() in commands/assess.ts
// ---------------------------------------------------------------------------

describe('providers.llm.secondary YAML round-trip (#1703)', () => {
  it('returns undefined when no providers.llm.secondary block is present', () => {
    const swaoYml = parseSwaoYml(VIRGIN_WORKSPACE_YAML);
    expect(readLlmSecondaryConfig(swaoYml)).toBeUndefined();
  });

  it('reads connector + model from providers.llm.secondary block', () => {
    // Build YAML from scratch to avoid duplicate-key rejection in js-yaml 5.x.
    const raw = `wsp_version: "0.9"
providers:
  llm:
    primary:
      connector: anthropic
      model: claude-haiku-4-5-20251001
    secondary:
      connector: openrouter
      model: deepseek/deepseek-v4-flash-latest
`;
    const cfg = readLlmSecondaryConfig(parseSwaoYml(raw));
    expect(cfg?.connector).toBe('openrouter');
    expect(cfg?.model).toBe('deepseek/deepseek-v4-flash-latest');
  });

  it('reads type-based secondary provider (non-gateway path)', () => {
    const raw = `wsp_version: "0.9"
providers:
  llm:
    primary:
      type: anthropic
      model: claude-haiku-4-5-20251001
    secondary:
      type: openai
      model: gpt-4o-mini
      temperature: 0
`;
    const cfg = readLlmSecondaryConfig(parseSwaoYml(raw));
    expect(cfg?.type).toBe('openai');
    expect(cfg?.model).toBe('gpt-4o-mini');
    expect(cfg?.temperature).toBe(0);
  });

  it('returns undefined when only primary is configured (no secondary key)', () => {
    const raw = `wsp_version: "0.9"
providers:
  llm:
    primary:
      connector: anthropic
      model: claude-haiku-4-5-20251001
`;
    expect(readLlmSecondaryConfig(parseSwaoYml(raw))).toBeUndefined();
  });
});
