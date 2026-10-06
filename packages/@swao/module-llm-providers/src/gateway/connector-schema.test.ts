// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- connector schema tests (#1394)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { parseConnectorYaml, looksLikeSecret } from './connector-schema.js';

const VALID = `
schema_version: "1.0"
connector:
  id: openrouter
  name: OpenRouter
  description: Hosted multi-vendor aggregator.
  protocol: openai-chat
  base_url: https://openrouter.ai/api
  auth:
    credential_key: openrouter-api-key
    env_var: SWAO_OPENROUTER_API_KEY
  headers:
    HTTP-Referer: https://github.com/Accenture/SWAO
    X-Title: SWAO
  models:
    default: mistralai/mistral-large
    catalogue:
      - id: mistralai/mistral-large
        cost: { input_per_million: 2.0, output_per_million: 6.0 }
      - id: anthropic/claude-sonnet-4
    discovery_endpoint: /v1/models
  defaults:
    temperature: 0
    max_tokens: 8192
  request_overrides:
    reasoning: { enabled: true }
  sovereignty:
    data_residency: global
    zero_retention: unknown
  meta:
    source: bundled
    last_reviewed: "2026-08-05"
`;

describe('parseConnectorYaml (#1394)', () => {
  it('accepts a fully populated valid connector', () => {
    const r = parseConnectorYaml(VALID, 'openrouter.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.connector.id).toBe('openrouter');
      expect(r.file.connector.auth.header).toBe('Authorization');
      expect(r.file.connector.auth.scheme).toBe('bearer');
      expect(r.file.connector.models.catalogue).toHaveLength(2);
      expect(r.file.connector.request_overrides).toEqual({ reasoning: { enabled: true } });
    }
  });

  it('accepts a minimal connector (copy/paste ergonomics)', () => {
    const r = parseConnectorYaml([
      'schema_version: "1.0"',
      'connector:',
      '  id: my-hub',
      '  name: My Internal Hub',
      '  protocol: openai-chat',
      '  base_url: https://llm.example.internal',
      '  models:',
      '    default: my-model',
    ].join('\n'), 'my-hub.yaml');
    expect(r.ok).toBe(true);
  });

  it('rejects missing required fields with named paths', () => {
    const r = parseConnectorYaml('schema_version: "1.0"\nconnector:\n  id: x\n  name: X\n', 'x.yaml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('protocol');
  });

  it('rejects unknown protocol', () => {
    const r = parseConnectorYaml(VALID.replace('openai-chat', 'bedrock-sigv4'), 'x.yaml');
    expect(r.ok).toBe(false);
  });

  it('rejects unsupported schema_version major with a clear message', () => {
    const r = parseConnectorYaml(VALID.replace('"1.0"', '"2.0"'), 'x.yaml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unsupported schema_version major 2');
  });

  it('rejects reserved request_overrides keys', () => {
    const r = parseConnectorYaml(VALID.replace('    reasoning: { enabled: true }', '    model: sneaky-model'), 'x.yaml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('reserved key');
  });

  it('refuses secret-shaped values anywhere in the file', () => {
    const r = parseConnectorYaml(
      VALID.replace('credential_key: openrouter-api-key', 'credential_key: sk-or-v1-abcdef0123456789abcdef0123456789'),
      'x.yaml',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('refusing to parse');
      expect(r.error).toContain('secret-shaped');
      // The error names the path, never echoes the value.
      expect(r.error).not.toContain('abcdef0123456789');
    }
  });

  it('rejects invalid YAML and non-mapping documents', () => {
    expect(parseConnectorYaml('{{{{', 'x.yaml').ok).toBe(false);
    expect(parseConnectorYaml('- just\n- a list\n', 'x.yaml').ok).toBe(false);
  });

  it('accepts connector YAML prefixed with a UTF-8 BOM (#2937)', () => {
    const r = parseConnectorYaml('﻿' + VALID.trimStart(), 'preme-preprod.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.connector.id).toBe('openrouter');
  });

  it('rejects non-kebab-case ids and bad env var names', () => {
    expect(parseConnectorYaml(VALID.replace('id: openrouter', 'id: Open_Router'), 'x.yaml').ok).toBe(false);
    expect(parseConnectorYaml(VALID.replace('SWAO_OPENROUTER_API_KEY', 'lower_case'), 'x.yaml').ok).toBe(false);
  });

  it('accepts tls block with ca_bundle and reject_unauthorized (#2748)', () => {
    const yaml = [
      'schema_version: "1.0"',
      'connector:',
      '  id: internal-gw',
      '  name: Internal Gateway',
      '  protocol: openai-chat',
      '  base_url: https://llm.internal.example',
      '  models:',
      '    default: my-model',
      '  tls:',
      '    ca_bundle: /etc/ssl/certs/enterprise-ca.pem',
      '    reject_unauthorized: true',
    ].join('\n');
    const r = parseConnectorYaml(yaml, 'internal-gw.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.connector.tls?.ca_bundle).toBe('/etc/ssl/certs/enterprise-ca.pem');
      expect(r.file.connector.tls?.reject_unauthorized).toBe(true);
    }
  });

  it('tls.reject_unauthorized defaults to true when omitted (#2748)', () => {
    const yaml = [
      'schema_version: "1.0"',
      'connector:',
      '  id: internal-gw',
      '  name: Internal Gateway',
      '  protocol: openai-chat',
      '  base_url: https://llm.internal.example',
      '  models:',
      '    default: my-model',
      '  tls:',
      '    ca_bundle: /tmp/ca.pem',
    ].join('\n');
    const r = parseConnectorYaml(yaml, 'internal-gw.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.connector.tls?.reject_unauthorized).toBe(true);
  });

  it('accepts connector without tls block (backward compat, #2748)', () => {
    const r = parseConnectorYaml(VALID, 'openrouter.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.connector.tls).toBeUndefined();
  });

  it('accepts token_command with optional token_ttl_s (#2743)', () => {
    const yaml = [
      'schema_version: "1.0"',
      'connector:',
      '  id: adfs-hub',
      '  name: ADFS-gated Hub',
      '  protocol: openai-chat',
      '  base_url: https://llm.enterprise.example',
      '  auth:',
      '    token_command: "az account get-access-token --query accessToken -o tsv"',
      '    token_ttl_s: 3300',
      '    header: Authorization',
      '    scheme: bearer',
      '  models:',
      '    default: gpt-4o',
    ].join('\n');
    const r = parseConnectorYaml(yaml, 'adfs-hub.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.connector.auth.token_command).toBe('az account get-access-token --query accessToken -o tsv');
      expect(r.file.connector.auth.token_ttl_s).toBe(3300);
    }
  });

  it('accepts token_command without token_ttl_s (TTL defaults to caller logic, #2743)', () => {
    const yaml = [
      'schema_version: "1.0"',
      'connector:',
      '  id: adfs-hub',
      '  name: ADFS-gated Hub',
      '  protocol: openai-chat',
      '  base_url: https://llm.enterprise.example',
      '  auth:',
      '    token_command: "get-token.sh"',
      '    header: Authorization',
      '    scheme: bearer',
      '  models:',
      '    default: gpt-4o',
    ].join('\n');
    const r = parseConnectorYaml(yaml, 'adfs-hub.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.connector.auth.token_ttl_s).toBeUndefined();
  });

  it('rejects token_ttl_s <= 0 (#2743)', () => {
    const yaml = [
      'schema_version: "1.0"',
      'connector:',
      '  id: adfs-hub',
      '  name: ADFS-gated Hub',
      '  protocol: openai-chat',
      '  base_url: https://llm.enterprise.example',
      '  auth:',
      '    token_command: "get-token.sh"',
      '    token_ttl_s: 0',
      '  models:',
      '    default: gpt-4o',
    ].join('\n');
    const r = parseConnectorYaml(yaml, 'adfs-hub.yaml');
    expect(r.ok).toBe(false);
  });
});

describe('looksLikeSecret (#1394)', () => {
  it('flags known key prefixes', () => {
    expect(looksLikeSecret('sk-ant-api03-xxxx')).toBe(true);
    expect(looksLikeSecret('ghp_0123456789abcdefghijklmnop')).toBe(true);
    expect(looksLikeSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true); // secret-scan-exempt: AWS example key for looksLikeSecret() unit test
  });

  it('flags long unbroken high-entropy tokens', () => {
    expect(looksLikeSecret('dGhpcyBpcyBhIHNlY3JldCBrZXkgbWF0ZXJpYWwx0aA9')).toBe(true);
  });

  it('does not flag URLs, model ids, env var names, or prose', () => {
    expect(looksLikeSecret('https://openrouter.ai/api/v1/chat/completions')).toBe(false);
    expect(looksLikeSecret('mistralai/mistral-large')).toBe(false);
    expect(looksLikeSecret('SWAO_OPENROUTER_API_KEY')).toBe(false);
    expect(looksLikeSecret('Hosted multi-vendor aggregator with one key.')).toBe(false);
    expect(looksLikeSecret('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('never flags separator-containing ids, however long or entropic (#1414 property)', () => {
    // Property, not a model list (platform catalogues change weekly):
    // vendor-prefixed ids contain '/' and are exempt from the entropy net.
    // Synthetic worst cases -- long, digit-mixed, maximum plausible entropy:
    expect(looksLikeSecret('vendor9/model-24b-x1y2z3-venice-edition-preview')).toBe(false);
    expect(looksLikeSecret('a1b2c3d4e5f6g7h8/i9j0k1l2m3n4o5p6q7r8s9t0u1v2')).toBe(false);
    expect(looksLikeSecret('org/model-3.1-flash-lite-preview')).toBe(false);
  });

  it('still flags slashless high-entropy tokens and prefixed keys with slashes', () => {
    expect(looksLikeSecret('dGhpcyBpcyBhIHNlY3JldCBrZXkgbWF0ZXJpYWwx0aA9')).toBe(true);
    expect(looksLikeSecret('sk-or-v1-abc/def0123456789abcdef0123456789')).toBe(true);
  });
});
