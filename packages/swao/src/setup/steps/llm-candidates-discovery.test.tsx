// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- Setup LLM candidates model picker reads the served models (#4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The model picker of a new candidate (Setup, LLM branch) uses the same live
// refresh and list rule as the LLM Assessment picker. The refresh is mocked.

import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import type { LoadedConnector, ModelRefresh } from '@swao/module-llm-providers';

const refreshMock = vi.fn<(l: LoadedConnector) => Promise<ModelRefresh>>();
vi.mock('@swao/module-llm-providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/module-llm-providers')>();
  return { ...original, refreshConnectorModels: (l: LoadedConnector) => refreshMock(l) };
});

import { LlmCandidatesStep, type ConnectorLister } from './LlmCandidatesStep.js';
import type { CandidateConnector } from '../llm-values.js';
import type { SetupStepProps } from '../types.js';
import { clearModelRefreshCache } from '../../tui/use-model-refresh.js';

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DOWN = String.fromCharCode(27) + '[B';
const ENTER = String.fromCharCode(13);

const LOADED: LoadedConnector = {
  path: '/ws/wsp/inputs/llm-gateway/openrouter.yaml',
  origin: 'workspace',
  file: {
    schema_version: '1.0',
    connector: {
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai-chat', base_url: 'https://openrouter.ai/api', path_prefix: '',
      auth: { header: 'Authorization', scheme: 'bearer' },
      models: { default: 'mistralai/mistral-large', catalogue: [{ id: 'mistralai/mistral-large' }, { id: 'anthropic/claude-sonnet-4' }] },
    },
  },
};
const CONNECTORS: CandidateConnector[] = [
  { id: 'openrouter', name: 'OpenRouter', defaultModel: 'mistralai/mistral-large', models: ['mistralai/mistral-large', 'anthropic/claude-sonnet-4'], hasCredential: true, loaded: LOADED },
];
const lister: ConnectorLister = () => CONNECTORS;

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; clearModelRefreshCache(); refreshMock.mockReset(); });

function props(root: string): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'community', scope: 'llm', scopeLabel: 'LLM Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1, stepCount: 4, onNext: () => undefined, updateSession: () => undefined,
    setEscapeCaptured: () => undefined, setGuidanceOpen: () => undefined,
  };
}

describe('Setup LLM candidates model picker (#4475)', () => {
  it('lists the served models read live; a not served model is not offered (#4475 owner decision)', async () => {
    refreshMock.mockResolvedValue({
      status: 'live',
      servedIds: ['mistralai/mistral-large', 'anthropic/claude-sonnet-5.5'],
      loaded: {
        ...LOADED,
        file: { ...LOADED.file, connector: { ...LOADED.file.connector, models: {
          default: 'mistralai/mistral-large',
          discovered_at: '2026-11-16T07:00:00.000Z',
          catalogue: [{ id: 'mistralai/mistral-large', served: true }, { id: 'anthropic/claude-sonnet-4', served: false }, { id: 'anthropic/claude-sonnet-5.5', discovered: true }],
        } } },
      },
    });
    dir = mkdtempSync(join(tmpdir(), 'swao-4475-'));
    writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
    const { lastFrame, stdin, unmount } = render(<LlmCandidatesStep {...props(dir)} listConnectors={lister} />);
    await settle();
    // No stored candidates: the list is "Add a candidate", then skip. Add, pick the connector.
    stdin.write(ENTER); await settle();
    stdin.write('1'); await settle();
    for (let i = 0; i < 30 && !(lastFrame() ?? '').includes('Served models read live'); i++) await settle(50);
    const frame = lastFrame() ?? '';
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(frame).toContain('Served models read live from the platform: 2 models.');
    expect(frame).toContain('anthropic/claude-sonnet-5.5');
    // A new candidate has no stored current model: the not served model is not listed at all.
    expect(frame).not.toContain('anthropic/claude-sonnet-4');
    stdin.write(DOWN);
    unmount();
  });

  it('offline: the catalogue, marked not checked live', async () => {
    refreshMock.mockResolvedValue({ status: 'catalogue', reason: 'timeout', servedIds: [], loaded: LOADED });
    dir = mkdtempSync(join(tmpdir(), 'swao-4475-'));
    writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
    const { lastFrame, stdin, unmount } = render(<LlmCandidatesStep {...props(dir)} listConnectors={lister} />);
    await settle();
    stdin.write(ENTER); await settle();
    stdin.write('1'); await settle();
    for (let i = 0; i < 30 && !(lastFrame() ?? '').includes('not checked live'); i++) await settle(50);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Catalogue, not checked live: the platform did not answer within 5 seconds.');
    expect(frame).toContain('anthropic/claude-sonnet-4');
    expect(frame).not.toContain('not served');
    unmount();
  });
});
