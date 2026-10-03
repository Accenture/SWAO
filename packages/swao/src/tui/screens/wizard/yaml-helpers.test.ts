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
import { inferOpenLlmConnectorId, writeLlmToYaml, writeSecondaryLlmToYaml } from './yaml-helpers.js';

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
    expect(inferOpenLlmConnectorId('https://preme-genai-hub-preprod.example.com')).toBe('open-llm');
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
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://preme.example.com');
    const out = readYaml();
    expect(out).toContain('connector: open-llm');
    expect(out).toContain('baseUrl: "https://preme.example.com"');
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
    writeLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://preme.example.com');
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
    writeSecondaryLlmToYaml(tmpDir, 'open-llm-provider', 'gemma-4', '', 'https://preme.example.com');
    const out = readYaml();
    expect(out).toContain('secondary:');
    expect(out).toContain('connector: open-llm');
    expect(out).toContain('baseUrl: "https://preme.example.com"');
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
