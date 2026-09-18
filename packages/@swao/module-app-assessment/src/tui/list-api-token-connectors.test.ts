// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Tests for #2351: listApiTokenConnectors -- built-in + workspace + llm-gateways/ connectors.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listApiTokenConnectors, BUILTIN_API_CONNECTORS } from './AssessScreen.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'swao-api-connectors-test-'));
}
function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

describe('listApiTokenConnectors (#2351)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  it('returns built-in connectors when workspace is undefined', () => {
    const result = listApiTokenConnectors(undefined);
    expect(result.length).toBe(BUILTIN_API_CONNECTORS.length);
    expect(result.map(c => c.id).sort()).toEqual(
      BUILTIN_API_CONNECTORS.map(c => c.id).sort()
    );
  });

  it('returns built-in connectors when workspace has no llm-gateway dir', () => {
    const result = listApiTokenConnectors(dir);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.find(c => c.id === 'anthropic')).toBeDefined();
    expect(result.find(c => c.id === 'bedrock')).toBeDefined();
    expect(result.find(c => c.id === 'openrouter')).toBeDefined();
    cleanup(dir);
  });

  it('built-in anthropic connector has credential key', () => {
    const result = listApiTokenConnectors(undefined);
    const anthropic = result.find(c => c.id === 'anthropic');
    expect(anthropic?.credentialKey).toBe('anthropic-api-key');
    expect(anthropic?.envVar).toBe('SWAO_ANTHROPIC_API_KEY');
  });

  it('built-in bedrock connector has env_var but no credential_key', () => {
    const result = listApiTokenConnectors(undefined);
    const bedrock = result.find(c => c.id === 'bedrock');
    expect(bedrock?.credentialKey).toBeUndefined();
    expect(bedrock?.envVar).toBe('AWS_ACCESS_KEY_ID');
  });

  it('appends workspace connector from wsp/inputs/llm-gateway/ not in built-in list', () => {
    const wsDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, 'custom.yaml'), [
      'schema_version: "1.0"',
      'connector:',
      '  id: custom-corp',
      '  name: Corporate LLM',
      '  protocol: openai-chat',
      '  base_url: https://llm.internal',
      '  auth:',
      '    credential_key: corporate-llm-api-key',
      '    env_var: CORP_LLM_KEY',
    ].join('\n'));

    const result = listApiTokenConnectors(dir);
    const custom = result.find(c => c.id === 'custom-corp');
    expect(custom).toBeDefined();
    expect(custom?.name).toBe('Corporate LLM');
    expect(custom?.credentialKey).toBe('corporate-llm-api-key');
    cleanup(dir);
  });

  it('deduplicates: workspace connector with same id as built-in is skipped', () => {
    const wsDir = join(dir, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, 'anthropic.yaml'), [
      'schema_version: "1.0"',
      'connector:',
      '  id: anthropic',
      '  name: Anthropic Claude (workspace)',
      '  protocol: anthropic-messages',
      '  base_url: https://api.anthropic.com',
      '  auth:',
      '    credential_key: anthropic-api-key',
      '    env_var: SWAO_ANTHROPIC_API_KEY',
    ].join('\n'));

    const result = listApiTokenConnectors(dir);
    const anthropicEntries = result.filter(c => c.id === 'anthropic');
    expect(anthropicEntries.length).toBe(1);
    cleanup(dir);
  });

  it('reads simple connector from llm-gateways/ with api_key_vault_key', () => {
    const gwDir = join(dir, 'llm-gateways');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'azure-openai.yaml'), [
      'name: Azure OpenAI',
      'api_key_vault_key: azure-openai-api-key',
    ].join('\n'));

    const result = listApiTokenConnectors(dir);
    const azure = result.find(c => c.id === 'azure-openai');
    expect(azure).toBeDefined();
    expect(azure?.credentialKey).toBe('azure-openai-api-key');
    expect(azure?.name).toContain('Azure OpenAI');
    expect(azure?.name).toContain('(from llm-gateways/azure-openai.yaml)');
    cleanup(dir);
  });

  it('reads full connector format from llm-gateways/', () => {
    const gwDir = join(dir, 'llm-gateways');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'mistral.yaml'), [
      'connector:',
      '  id: mistral',
      '  name: Mistral AI',
      '  protocol: openai-chat',
      '  base_url: https://api.mistral.ai',
      '  auth:',
      '    credential_key: mistral-api-key',
      '    env_var: SWAO_MISTRAL_API_KEY',
    ].join('\n'));

    const result = listApiTokenConnectors(dir);
    const mistral = result.find(c => c.id === 'mistral');
    expect(mistral).toBeDefined();
    expect(mistral?.credentialKey).toBe('mistral-api-key');
    expect(mistral?.name).toContain('Mistral AI');
    expect(mistral?.name).toContain('(from llm-gateways/mistral.yaml)');
    cleanup(dir);
  });

  it('omits llm-gateways/ connector with no credential key or env_var', () => {
    const gwDir = join(dir, 'llm-gateways');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'no-auth.yaml'), [
      'name: No Auth Service',
    ].join('\n'));

    const result = listApiTokenConnectors(dir);
    expect(result.find(c => c.id === 'no-auth')).toBeUndefined();
    cleanup(dir);
  });

  it('skips llm-gateways/ connector whose id matches built-in', () => {
    const gwDir = join(dir, 'llm-gateways');
    mkdirSync(gwDir, { recursive: true });
    writeFileSync(join(gwDir, 'anthropic.yaml'), [
      'connector:',
      '  id: anthropic',
      '  name: Anthropic via llm-gateways',
      '  auth:',
      '    credential_key: anthropic-api-key',
    ].join('\n'));

    const result = listApiTokenConnectors(dir);
    const anthropicEntries = result.filter(c => c.id === 'anthropic');
    expect(anthropicEntries.length).toBe(1);
    // Built-in entry wins (no annotation)
    expect(anthropicEntries[0]?.name).not.toContain('llm-gateways');
    cleanup(dir);
  });

  it('absent llm-gateways/ directory leaves built-in list unchanged', () => {
    const resultWithout = listApiTokenConnectors(dir);
    const ids = resultWithout.map(c => c.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('bedrock');
    expect(ids).toContain('openrouter');
    cleanup(dir);
  });
});
