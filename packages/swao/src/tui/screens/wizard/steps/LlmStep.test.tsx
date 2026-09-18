// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: LlmStep wizard option visibility
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-LS-01: "Open LLM Provider" is visible when no connectors present (LLM_OPTIONS path)
// TU-LS-02: "Open LLM Provider" is visible when gateway connectors are present (#2742)
// TU-LS-03: Skip option is always present regardless of connector count

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// ---------------------------------------------------------------------------
// Mocks -- before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockConnectors: { connectors: unknown[] } = { connectors: [] };

vi.mock('@swao/module-llm-providers', () => ({
  listConnectors: vi.fn(() => mockConnectors),
  discoverModels: vi.fn(() => Promise.resolve({ ok: false })),
  mergeDiscoveredModels: vi.fn((f: unknown) => f),
  writeWorkspaceConnector: vi.fn(),
}));

vi.mock('../shared.js', () => ({
  setWizardGuidanceOpen: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Component import -- after mock declarations
// ---------------------------------------------------------------------------
import { LlmStep } from './LlmStep.js';

// ---------------------------------------------------------------------------
// TU-LS-01: No connectors present -- falls through to LLM_OPTIONS
// ---------------------------------------------------------------------------
describe('LlmStep -- TU-LS-01: no connectors (LLM_OPTIONS path)', () => {
  it('shows Open LLM Provider when connector list is empty', () => {
    mockConnectors.connectors = [];
    const { lastFrame } = render(
      <LlmStep onNext={vi.fn()} workspaceRoot={undefined} />,
    );
    expect(lastFrame() ?? '').toContain('Open LLM Provider');
  });
});

// ---------------------------------------------------------------------------
// TU-LS-02: Gateway connectors present -- Open LLM Provider must still appear
// ---------------------------------------------------------------------------
describe('LlmStep -- TU-LS-02: gateway connectors present (#2742)', () => {
  it('shows Open LLM Provider alongside gateway connector options', () => {
    mockConnectors.connectors = [
      {
        origin: 'bundled',
        file: {
          connector: {
            id: 'vllm-generic',
            name: 'vLLM Generic',
            protocol: 'openai-chat',
            models: { default: 'mistral', catalogue: [] },
          },
        },
      },
    ];
    const { lastFrame } = render(
      <LlmStep onNext={vi.fn()} workspaceRoot={undefined} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('vLLM Generic');
    expect(frame).toContain('Open LLM Provider');
  });
});

// ---------------------------------------------------------------------------
// TU-LS-03: Skip option always present
// ---------------------------------------------------------------------------
describe('LlmStep -- TU-LS-03: skip option always present', () => {
  it('shows skip option when connectors are present', () => {
    mockConnectors.connectors = [
      {
        origin: 'bundled',
        file: {
          connector: {
            id: 'vllm-generic',
            name: 'vLLM Generic',
            protocol: 'openai-chat',
            models: { default: 'mistral', catalogue: [] },
          },
        },
      },
    ];
    const { lastFrame } = render(
      <LlmStep onNext={vi.fn()} workspaceRoot={undefined} />,
    );
    expect(lastFrame() ?? '').toContain('Skip');
  });

  it('shows skip option when connectors list is empty', () => {
    mockConnectors.connectors = [];
    const { lastFrame } = render(
      <LlmStep onNext={vi.fn()} workspaceRoot={undefined} />,
    );
    expect(lastFrame() ?? '').toContain('Skip');
  });
});
