// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI Setup Wizard -- yaml-helpers unit tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// v1.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getConnector } from '@swao/module-llm-providers';
import { inferOpenLlmConnectorId, resolveOpenLlmConnectorId, writeLlmToYaml, writeSecondaryLlmToYaml } from './yaml-helpers.js';

// ---------------------------------------------------------------------------
// inferOpenLlmConnectorId (#2886)
// ---------------------------------------------------------------------------

describe('inferOpenLlmConnectorId (#2886)', () => {
  it('returns vllm-generic for localhost', () => {
    expect(inferOpenLlmConnectorId('http://localhost:8000')).toBe('vllm-generic');
  });

  it('returns vllm-generic for localhost with path', () => {
    expect(inferOpenLlmConnectorId('http://localhost:11434/v1')).toBe('vllm-generic');
  });

  it('returns vllm-generic for 127.0.0.1', () => {
    expect(inferOpenLlmConnectorId('http://127.0.0.1:8000')).toBe('vllm-generic');
  });

  it('returns open-llm for remote HTTPS', () => {
    expect(inferOpenLlmConnectorId('https://genai-hub.example.com')).toBe('open-llm');
  });

  it('returns open-llm for remote HTTP (non-loopback)', () => {
    expect(inferOpenLlmConnectorId('http://genai.internal.corp/api')).toBe('open-llm');
  });

  it('returns open-llm for malformed URL (treat as remote)', () => {
    expect(inferOpenLlmConnectorId('not-a-url')).toBe('open-llm');
  });

  it('returns open-llm for empty string', () => {
    expect(inferOpenLlmConnectorId('')).toBe('open-llm');
  });
});

// ---------------------------------------------------------------------------
// writeLlmToYaml and writeSecondaryLlmToYaml -- open-llm-provider path (#2886)
// ---------------------------------------------------------------------------

const VIRGIN_YAML = `\
workspace:
  name: test-ws

providers:
  llm:
    primary:
      type: ~
      model: ~
  redactor:
    type: pattern
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'swao-yaml-helpers-'));
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(content: string): void {
  writeFileSync(join(tmpDir, '.swao.yml'), content, 'utf-8');
}

function readYaml(): string {
  return readFileSync(join(tmpDir, '.swao.yml'), 'utf-8');
}

describe('writeLlmToYaml -- open-llm-provider connector inference (#2886)', () => {
  it('writes connector: open-llm for remote HTTPS URL', () => {
    writeYaml(VIRGIN_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://genai-hub.example.com');
    const out = readYaml();
    expect(out).toContain('connector: open-llm');
    expect(out).toContain('baseUrl: "https://genai-hub.example.com"');
    expect(out).toContain('model: gemma-4');
    expect(out).not.toContain('type: open-llm-provider');
    expect(out).not.toContain('vllm-generic');
  });

  it('writes connector: vllm-generic for localhost URL', () => {
    writeYaml(VIRGIN_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'mistral', '', 'http://localhost:8000');
    const out = readYaml();
    expect(out).toContain('connector: vllm-generic');
    expect(out).toContain('baseUrl: "http://localhost:8000"');
    expect(out).toContain('model: mistral');
    expect(out).not.toContain('open-llm\n');
  });

  it('writes connector: vllm-generic for 127.0.0.1 URL', () => {
    writeYaml(VIRGIN_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'llama3', '', 'http://127.0.0.1:11434');
    const out = readYaml();
    expect(out).toContain('connector: vllm-generic');
    expect(out).not.toContain('open-llm\n');
  });

  it('is idempotent: re-running with a different URL replaces the connector block', () => {
    writeYaml(VIRGIN_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://genai-hub.example.com');
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'mistral', '', 'http://localhost:8000');
    const out = readYaml();
    expect(out).toContain('connector: vllm-generic');
    expect(out).not.toContain('open-llm\n');
    expect(out).not.toContain('gemma-4');
    expect(out).toContain('mistral');
  });
});

describe('writeSecondaryLlmToYaml -- open-llm-provider connector inference (#2886)', () => {
  const YAML_WITH_PRIMARY = `\
workspace:
  name: test-ws

providers:
  llm:
    primary:
      connector: anthropic
      model: claude-opus-5
      temperature: 0
  redactor:
    type: pattern
`;

  it('writes connector: open-llm for remote HTTPS URL in secondary block', () => {
    writeYaml(YAML_WITH_PRIMARY);
    writeSecondaryLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://genai-hub.example.com');
    const out = readYaml();
    expect(out).toContain('secondary:');
    expect(out).toContain('connector: open-llm');
    expect(out).toContain('baseUrl: "https://genai-hub.example.com"');
    expect(out).not.toContain('type: open-llm-provider');
  });

  it('writes connector: vllm-generic for localhost URL in secondary block', () => {
    writeYaml(YAML_WITH_PRIMARY);
    writeSecondaryLlmToYaml(tmpDir, 'open-llm-provider', 'mistral', '', 'http://localhost:8000');
    const out = readYaml();
    expect(out).toContain('secondary:');
    expect(out).toContain('connector: vllm-generic');
  });
});

// ---------------------------------------------------------------------------
// #3438: an aborted or TLS-untouched wizard re-run must not lose the active
// connector's tls block (support bundle 2026-10-23: tlsSkip true -> false
// after wizard.abort, then SELF_SIGNED_CERT_IN_CHAIN on every LLM call).
// The wizard persists .swao.yml eagerly at the LLM step (SetupWizard.tsx), so
// whatever the LLM step writes is what survives an abort at any later step.
// ---------------------------------------------------------------------------

describe('wizard LLM writes preserve the connector tls block (#3438)', () => {
  const CORP_URL = 'https://genai-hub.corp.example';
  const CORP_CONNECTOR = [
    'schema_version: "1.0"',
    'connector:',
    '  id: corp-hub',
    '  name: Corporate GenAI Hub',
    '  protocol: openai-chat',
    `  base_url: ${CORP_URL}`,
    '  auth:',
    '    env_var: SWAO_CORP_HUB_KEY',
    '  models:',
    '    default: corp-model',
    '  tls:',
    '    reject_unauthorized: false',
    '    ca_bundle: /etc/ssl/corp-ca.pem',
    '',
  ].join('\n');

  const CONFIGURED_YAML = `\
workspace:
  name: test-ws

providers:
  llm:
    primary:
      connector: corp-hub
      model: corp-model
      temperature: 0
  redactor:
    type: pattern
`;

  function connectorPath(): string {
    return join(tmpDir, 'wsp', 'inputs', 'llm-gateway', 'corp-hub.yaml');
  }

  function seedCorpConnector(content = CORP_CONNECTOR): void {
    mkdirSync(join(tmpDir, 'wsp', 'inputs', 'llm-gateway'), { recursive: true });
    writeFileSync(connectorPath(), content, 'utf-8');
  }

  /** The connector the next assessment run resolves, as assess.ts does it. */
  function effectivePrimaryTls(): { id: string | undefined; reject: boolean | undefined; ca: string | undefined } {
    const id = /primary:\n\s+connector: (\S+)/.exec(readYaml())?.[1];
    const loaded = id ? getConnector(id, { workspaceRoot: tmpDir }) : undefined;
    return { id, reject: loaded?.file.connector.tls?.reject_unauthorized, ca: loaded?.file.connector.tls?.ca_bundle };
  }

  it('abort after the LLM step: re-entering the same URL keeps the tls connector active', () => {
    seedCorpConnector();
    writeYaml(CONFIGURED_YAML);
    const before = readFileSync(connectorPath(), 'utf-8');
    // LLM step completes with the custom-endpoint choice; the wizard is then
    // aborted (Escape) before ReadyStep, so no further write happens.
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'corp-model', '', `${CORP_URL}/v1/`);
    expect(effectivePrimaryTls()).toEqual({ id: 'corp-hub', reject: false, ca: '/etc/ssl/corp-ca.pem' });
    expect(readFileSync(connectorPath(), 'utf-8')).toBe(before);
  });

  it('completed re-run that does not touch TLS: selecting the gateway connector keeps tls intact', () => {
    seedCorpConnector();
    writeYaml(CONFIGURED_YAML);
    const before = readFileSync(connectorPath(), 'utf-8');
    writeLlmToYaml(tmpDir, 'gw:corp-hub', 'corp-model', '', '');
    // SetupWizard only materialises BUNDLED connectors; a workspace one is left alone.
    const loaded = getConnector('corp-hub', { workspaceRoot: tmpDir });
    expect(loaded?.origin).toBe('workspace');
    expect(effectivePrimaryTls()).toEqual({ id: 'corp-hub', reject: false, ca: '/etc/ssl/corp-ca.pem' });
    expect(readFileSync(connectorPath(), 'utf-8')).toBe(before);
  });

  it('reuses a matching workspace connector that declares tls even when the slot pointed elsewhere', () => {
    seedCorpConnector();
    writeYaml(VIRGIN_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'corp-model', '', CORP_URL);
    const out = readYaml();
    expect(out).toContain('connector: corp-hub');
    expect(out).toContain(`baseUrl: "${CORP_URL}"`);
    expect(effectivePrimaryTls().reject).toBe(false);
  });

  it('secondary slot: same URL keeps the tls connector', () => {
    seedCorpConnector();
    writeYaml(CONFIGURED_YAML);
    writeSecondaryLlmToYaml(tmpDir, 'open-llm-provider', 'corp-model', '', CORP_URL);
    const out = readYaml();
    expect(out).toMatch(/secondary:\n\s+connector: corp-hub/);
    expect(out).not.toContain('connector: open-llm');
  });

  it('falls back to the #2886 inference when no workspace connector serves the URL', () => {
    seedCorpConnector();
    writeYaml(CONFIGURED_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://other-hub.example.com');
    expect(readYaml()).toContain('connector: open-llm');
  });

  it('falls back to the #2886 inference for a matching connector without tls that is not configured', () => {
    seedCorpConnector(CORP_CONNECTOR.replace(/ {2}tls:\n(?: {4}.*\n)+/, ''));
    writeYaml(VIRGIN_YAML);
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'corp-model', '', CORP_URL);
    expect(readYaml()).toContain('connector: open-llm');
  });

  it('resolveOpenLlmConnectorId never throws for a workspace without connectors or .swao.yml', () => {
    expect(resolveOpenLlmConnectorId(tmpDir, CORP_URL, 'primary')).toBe('open-llm');
    expect(resolveOpenLlmConnectorId(join(tmpDir, 'missing'), 'http://localhost:8000', 'primary')).toBe('vllm-generic');
  });
});
