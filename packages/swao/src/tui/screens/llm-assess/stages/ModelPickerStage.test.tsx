// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment model picker reads the served models (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The refresh is mocked (no platform call): the live case lists the served
// models and marks the unserved current model; Enter does not pick it. The
// offline case falls back to the catalogue and says so.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import type { LoadedConnector, ModelRefresh } from '@swao/module-llm-providers';

const refreshMock = vi.fn<(l: LoadedConnector) => Promise<ModelRefresh>>();
vi.mock('@swao/module-llm-providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/module-llm-providers')>();
  return { ...original, refreshConnectorModels: (l: LoadedConnector) => refreshMock(l) };
});

import { ModelPickerStage } from './ModelPickerStage.js';
import { clearModelRefreshCache } from '../../../use-model-refresh.js';

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Enter until the picker reports a choice (the list remounts after the discovery; slow under load). */
async function pressEnter(stdin: { write: (s: string) => void }, called: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !called(); i++) { stdin.write(String.fromCharCode(13)); await settle(100); }
}

const STALE: LoadedConnector = {
  path: '/ws/wsp/inputs/llm-gateway/openrouter.yaml',
  origin: 'workspace',
  file: {
    schema_version: '1.0',
    connector: {
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai-chat', base_url: 'https://openrouter.ai/api', path_prefix: '',
      auth: { header: 'Authorization', scheme: 'bearer' },
      models: {
        default: 'mistralai/mistral-large',
        catalogue: [{ id: 'mistralai/mistral-large' }, { id: 'anthropic/claude-sonnet-4' }, { id: 'meta-llama/llama-3.3-70b-instruct' }],
      },
    },
  },
};

function liveRefresh(): ModelRefresh {
  const served = ['mistralai/mistral-large', 'meta-llama/llama-3.3-70b-instruct', 'anthropic/claude-sonnet-5.5'];
  return {
    status: 'live',
    servedIds: served,
    loaded: {
      ...STALE,
      file: {
        ...STALE.file,
        connector: {
          ...STALE.file.connector,
          models: {
            ...STALE.file.connector.models,
            discovered_at: '2026-11-16T07:00:00.000Z',
            catalogue: [
              { id: 'mistralai/mistral-large', served: true },
              { id: 'anthropic/claude-sonnet-4', served: false },
              { id: 'meta-llama/llama-3.3-70b-instruct', served: true },
              { id: 'anthropic/claude-sonnet-5.5', discovered: true, cost: { input_per_million: 2, output_per_million: 10 } },
            ],
          },
        },
      },
    },
  };
}

function renderPicker(onModelSelect = vi.fn(), onConnectorRefreshed = vi.fn()) {
  const r = render(
    <ModelPickerStage
      isCustom={false}
      pendingLegCount={1}
      nextLeg={{ connectorId: 'openrouter', connector: STALE, model: 'anthropic/claude-sonnet-4' }}
      guidanceOpen={false}
      onGuidanceOpenChange={() => undefined}
      onModelSelect={onModelSelect}
      onCustom={() => undefined}
      workspacePath="/ws"
      onConnectorRefreshed={onConnectorRefreshed}
    />,
  );
  return { ...r, onModelSelect, onConnectorRefreshed };
}

beforeEach(() => {
  clearModelRefreshCache();
  refreshMock.mockReset();
});

describe('ModelPickerStage reads the served models live (#4475)', () => {
  it('lists the served models, shows the unserved current model as a line outside the list, starts the cursor on the default', async () => {
    refreshMock.mockResolvedValue(liveRefresh());
    const { lastFrame, stdin, onModelSelect, onConnectorRefreshed } = renderPicker();
    expect(lastFrame()).toContain('Reading the served models from the platform');
    await settle();
    const frame = lastFrame() ?? '';
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(frame).toContain('Served models read live from the platform: 3 models.');
    expect(frame).toContain('anthropic/claude-sonnet-5.5');
    // #4475 owner decision: the unserved current model is a line, never an option row.
    expect(frame).toContain('anthropic/claude-sonnet-4: not served, your current model.');
    expect(frame).not.toMatch(/anthropic\/claude-sonnet-4\s+not served, current/);
    expect(onConnectorRefreshed).toHaveBeenCalledTimes(1);
    await pressEnter(stdin, () => onModelSelect.mock.calls.length > 0);
    expect(onModelSelect).toHaveBeenCalledWith('mistralai/mistral-large');
  });

  it('offline: the catalogue, said so, no error; the current model is offered as before', async () => {
    refreshMock.mockResolvedValue({ status: 'catalogue', reason: 'unreachable', servedIds: [], loaded: STALE });
    const { lastFrame, stdin, onModelSelect } = renderPicker();
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Catalogue, not checked live: the platform is not reachable (offline or air-gapped).');
    expect(frame).not.toContain('not served');
    await pressEnter(stdin, () => onModelSelect.mock.calls.length > 0);
    expect(onModelSelect).toHaveBeenCalledWith('anthropic/claude-sonnet-4');
  });
});

describe('ModelPickerStage shows its filter (#4492, Design 126 section 7.14)', () => {
  it('a long model list shows the Type filter hint and the filter field; typing narrows the count', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => (i < 3 ? `eu.model-${i + 1}` : `mistralai/model-${i + 1}`));
    const many: LoadedConnector = { ...STALE, file: { ...STALE.file, connector: { ...STALE.file.connector, models: { default: ids[3]!, catalogue: ids.map((id) => ({ id })) } } } };
    refreshMock.mockResolvedValue({ status: 'catalogue', reason: 'unreachable', servedIds: [], loaded: many });
    const r = render(
      <ModelPickerStage
        isCustom={false} pendingLegCount={0} nextLeg={{ connectorId: 'openrouter', connector: many, model: ids[3]! }}
        guidanceOpen={false} onGuidanceOpenChange={() => undefined} onModelSelect={() => undefined} onCustom={() => undefined} workspacePath="/ws"
      />,
    );
    for (let i = 0; i < 60 && !(r.lastFrame() ?? '').includes('Type filter'); i++) await settle(50);
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Type filter');
    expect(frame).toMatch(/Filter: ▏ type to narrow 21 models/);
    for (const ch of 'eu.') { r.stdin.write(ch); await settle(40); }
    for (let i = 0; i < 60 && !(r.lastFrame() ?? '').includes('3 of 21 models'); i++) await settle(50);
    expect(r.lastFrame()).toContain('Filter: eu.▏');
    expect(r.lastFrame()).toContain('3 of 21 models');
    r.unmount();
  });
});
