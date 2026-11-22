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
const seedState: { status: unknown; updated: number } = { status: { status: 'current', file: 'agg.yaml' }, updated: 0 };

vi.mock('@swao/module-llm-providers', () => ({
  listConnectors: vi.fn(() => mockConnectors),
  discoverModels: vi.fn(() => Promise.resolve({ ok: false })),
  mergeDiscoveredModels: vi.fn((f: unknown) => f),
  writeWorkspaceConnector: vi.fn(),
  // #4475: the picker refresh; offline in these tests.
  discoveryEnabled: vi.fn(() => true),
  discoveryFallbackText: vi.fn(() => 'Catalogue, not checked live.'),
  isModelServed: vi.fn(() => undefined),
  servedAlternatives: vi.fn(() => []),
  isChatServableId: vi.fn((_p: string, id: string) => !id.endsWith(':batch')),
  checkConnectorModel: vi.fn(() => Promise.resolve({ status: 'skipped', reason: 'off' })),
  // #4491: the connector file update offer and the bundled price.
  bundledModelPrice: vi.fn(() => undefined),
  connectorSeedStatus: vi.fn(() => seedState.status),
  seedStatusText: vi.fn(() => 'connector file agg.yaml is older than the packaged one'),
  updateBundledConnectors: vi.fn(() => { seedState.updated++; return { added: [], updated: ['agg.yaml'], keptModified: [], upToDate: [], dir: null }; }),
  refreshConnectorModels: vi.fn((loaded: unknown) => Promise.resolve({ status: 'catalogue', reason: 'unreachable', servedIds: [], loaded })),
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

// ---------------------------------------------------------------------------
// #4220: short connector labels; origin and protocol in plain words in the
// dim second column; no row cut at width 100.
// ---------------------------------------------------------------------------
describe('LlmStep -- #4220: connector labels', () => {
  it('lists the connector names with the protocol in words, no "protocol:" and no ellipsis', () => {
    mockConnectors.connectors = [
      { origin: 'bundled', file: { connector: { id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic-messages', models: { default: 'm', catalogue: [] } } } },
      { origin: 'bundled', file: { connector: { id: 'bedrock', name: 'Amazon Bedrock', protocol: 'bedrock', models: { default: 'm', catalogue: [] } } } },
      { origin: 'workspace', file: { connector: { id: 'vllm', name: 'GenAI Hub / vLLM', protocol: 'openai-chat', models: { default: 'm', catalogue: [] } } } },
    ];
    const { lastFrame } = render(<LlmStep onNext={vi.fn()} workspaceRoot={undefined} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('protocol:');
    expect(frame).not.toContain('\u2026');
    expect(frame).toMatch(/Anthropic Claude\s+Anthropic Messages API/);
    expect(frame).toMatch(/GenAI Hub \/ vLLM\s+workspace, OpenAI-compatible API/);
    expect(frame).toMatch(/Open LLM Provider\s+custom OpenAI-compatible endpoint/);
    for (const line of frame.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// #4500: the chosen gateway model is tested before the step writes it; a
// rejection offers to choose again, a passed or skipped test goes on.
// ---------------------------------------------------------------------------
describe('LlmStep -- #4500: model test before the write', () => {
  const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function waitFor(cond: () => boolean, ms = 15000): Promise<void> {
    const until = Date.now() + ms;
    while (!cond() && Date.now() < until) await tick();
  }
  const GW = {
    origin: 'workspace',
    file: { connector: { id: 'agg', name: 'Aggregator', protocol: 'openai-chat', auth: {}, models: { default: 'vendor/model-a', catalogue: [{ id: 'vendor/model-a' }, { id: 'vendor/model-b' }] } } },
  };

  it('a rejected model shows the reason and Choose another model returns to the list; the next pick that passes is written', async () => {
    mockConnectors.connectors = [GW];
    const onNext = vi.fn();
    const checkModel = vi.fn(async (_l: unknown, model: string) => (model === 'vendor/model-a'
      ? { status: 'fail' as const, model, message: "model 'vendor/model-a' rejected by the platform; check the model id", rejected: true }
      : { status: 'ok' as const, model, ms: 5 }));
    const r = render(<LlmStep onNext={onNext} workspaceRoot={undefined} checkModel={checkModel as never} />);
    // The picker of a new screen attaches its key listener in an effect after
    // the frame is drawn, so a key written right after the frame can be lost:
    // press again until the expected screen shows (release v1.7.0 full suite).
    const pressUntil = async (key: string, cond: () => boolean): Promise<void> => {
      for (let i = 0; i < 20 && !cond(); i++) {
        r.stdin.write(key);
        await waitFor(cond, 750);
      }
    };
    await tick(50);
    await pressUntil('\r', () => (r.lastFrame() ?? '').includes('Catalogue, not checked live')); // the connector
    await tick(50);
    await pressUntil('\r', () => (r.lastFrame() ?? '').includes('Choose another model')); // the default vendor/model-a
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('test call failed for vendor/model-a');
    expect(frame.split(/\s+/).join(' ')).toContain('rejected by the platform');
    expect(onNext).not.toHaveBeenCalled();
    await pressUntil('\r', () => { const f = r.lastFrame() ?? ''; return !f.includes('Choose another model') && f.includes('Catalogue, not checked live'); }); // Choose another model
    // Down to vendor/model-b; repeated while a loaded machine drops the key before the picker listens.
    const cursorOnB = (): boolean => (r.lastFrame() ?? '').split('\n').some((l) => l.includes('❯') && l.includes('model-b'));
    for (let i = 0; i < 20 && !cursorOnB(); i++) {
      r.stdin.write('\u001B[B');
      await waitFor(cursorOnB, 500);
    }
    expect(cursorOnB()).toBe(true);
    r.stdin.write('\r');
    await waitFor(() => onNext.mock.calls.length > 0, 15000);
    expect(checkModel.mock.calls.map((c) => c[1])).toEqual(['vendor/model-a', 'vendor/model-b']);
    expect(onNext).toHaveBeenCalledWith('gw:agg', 'vendor/model-b', '', '');
  });

  it('no stored key yet: the test is skipped and the step goes on (the Credentials step tests it)', async () => {
    mockConnectors.connectors = [GW];
    const onNext = vi.fn();
    const checkModel = vi.fn(async () => ({ status: 'skipped' as const, reason: 'no-key' as const }));
    const r = render(<LlmStep onNext={onNext} workspaceRoot={undefined} checkModel={checkModel as never} />);
    await tick(50);
    r.stdin.write('\r');
    await waitFor(() => (r.lastFrame() ?? '').includes('Catalogue, not checked live'));
    await tick(50);
    r.stdin.write('\r');
    await waitFor(() => onNext.mock.calls.length > 0);
    expect(onNext).toHaveBeenCalledWith('gw:agg', 'vendor/model-a', '', '');
  });
});

// ---------------------------------------------------------------------------
// #4491: an unedited workspace connector file older than the packaged one is
// offered for update before the model list.
// ---------------------------------------------------------------------------
describe('LlmStep -- #4491: connector file update offer', () => {
  const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function waitFor(cond: () => boolean, ms = 15000): Promise<void> {
    const until = Date.now() + ms;
    while (!cond() && Date.now() < until) await tick();
  }

  it('offers Update the connector file; Enter updates it and goes on to the model list', async () => {
    mockConnectors.connectors = [{
      origin: 'workspace',
      file: { connector: { id: 'agg', name: 'Aggregator', protocol: 'openai-chat', auth: {}, models: { default: 'vendor/model-a', catalogue: [{ id: 'vendor/model-a' }] } } },
    }];
    seedState.status = { status: 'outdated', file: 'agg.yaml', workspaceReviewed: '2026-08-05', bundledReviewed: '2026-11-16' };
    seedState.updated = 0;
    const r = render(<LlmStep onNext={vi.fn()} workspaceRoot="C:/no-such-workspace-4491" />);
    await tick(50);
    r.stdin.write('\r');
    await waitFor(() => (r.lastFrame() ?? '').includes('Update the connector file'));
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Keep the workspace file');
    expect(frame).toContain('older than the packaged one');
    r.stdin.write('\r');
    await waitFor(() => (r.lastFrame() ?? '').includes('Catalogue, not checked live'));
    expect(seedState.updated).toBe(1);
    expect(r.lastFrame() ?? '').toContain('Connector file agg.yaml updated to the packaged version (reviewed 2026-11-16).');
    seedState.status = { status: 'current', file: 'agg.yaml' };
  });
});
