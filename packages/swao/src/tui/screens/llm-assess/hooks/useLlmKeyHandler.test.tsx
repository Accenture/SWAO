// #4256 (Design 126 section 7.6): during the run the RunPanel owns Esc; the
// screen's key handler reads no key (the cancel itself is tested in
// llm-run-status.test.tsx with the running stage).

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { llmBackStage, useLlmKeyHandler } from './useLlmKeyHandler.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

function Harness({ onBack, setStage }: { onBack: () => void; setStage: (s: string) => void }): React.JSX.Element {
  useLlmKeyHandler({
    stage: 'running', pendingLegs: [], resolvedLegs: [], loadedConnectors: [], crawlAvailable: false,
    healthStatus: null, guidanceOpenRef: { current: false }, requestAbort: onBack, dialogOpen: false,
    setStage, setNextLeg: vi.fn(), setBuildError: vi.fn(), setIncludeCrawl: vi.fn(),
    setPendingLegs: vi.fn(), setResolvedLegs: vi.fn(), handleHealthCheckConfirm: vi.fn(),
  });
  return <Text>running</Text>;
}

describe('useLlmKeyHandler during the run (#4256)', () => {
  it('Esc and Enter on the running stage neither navigate nor leave (RunPanel owns Esc)', async () => {
    const onBack = vi.fn();
    const setStage = vi.fn();
    const { stdin } = render(<Harness onBack={onBack} setStage={setStage} />);
    await tick();
    stdin.write('\u001b');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onBack).not.toHaveBeenCalled();
    expect(setStage).not.toHaveBeenCalled();
  });
});

// #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and PgDn only.
function GuidanceHarness({ setStage, onBack, confirm }: { setStage: (s: string) => void; onBack: () => void; confirm: () => void }): React.JSX.Element {
  useLlmKeyHandler({
    stage: 'health-check', pendingLegs: [], resolvedLegs: [], loadedConnectors: [], crawlAvailable: false,
    healthStatus: 'ok', guidanceOpenRef: { current: true }, requestAbort: onBack, dialogOpen: false,
    setStage, setNextLeg: vi.fn(), setBuildError: vi.fn(), setIncludeCrawl: vi.fn(),
    setPendingLegs: vi.fn(), setResolvedLegs: vi.fn(), handleHealthCheckConfirm: confirm,
  });
  return <Text>review</Text>;
}

describe('useLlmKeyHandler with the guidance box open (#4230)', () => {
  it('Esc belongs to the box; Enter still reaches the stage', async () => {
    const setStage = vi.fn();
    const onBack = vi.fn();
    const confirm = vi.fn();
    const { stdin } = render(<GuidanceHarness setStage={setStage} onBack={onBack} confirm={confirm} />);
    await tick();
    stdin.write('\u001b');
    await tick();
    expect(setStage).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    stdin.write('\r');
    await tick();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

// #4256 (Design 126 section 4.7): on the finish screen the What next menu owns
// Enter; Esc returns to the main menu unless the score table is open.
function FinishHarness({ onBack, tableOpen }: { onBack: () => void; tableOpen: boolean }): React.JSX.Element {
  useLlmKeyHandler({
    stage: 'done', pendingLegs: [], resolvedLegs: [], loadedConnectors: [], crawlAvailable: false,
    healthStatus: null, guidanceOpenRef: { current: false }, requestAbort: onBack, dialogOpen: false,
    setStage: vi.fn(), setNextLeg: vi.fn(), setBuildError: vi.fn(), setIncludeCrawl: vi.fn(),
    setPendingLegs: vi.fn(), setResolvedLegs: vi.fn(), handleHealthCheckConfirm: vi.fn(),
    finishDetailsOpenRef: { current: tableOpen },
  });
  return <Text>finish</Text>;
}

describe('useLlmKeyHandler on the finish screen (#4256)', () => {
  it('Enter does not leave the screen (the menu owns it); Esc returns to the main menu', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<FinishHarness onBack={onBack} tableOpen={false} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(onBack).not.toHaveBeenCalled();
    stdin.write('\u001b');
    await tick();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Esc with the score table open does not leave the screen', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<FinishHarness onBack={onBack} tableOpen />);
    await tick();
    stdin.write('\u001b');
    await tick();
    expect(onBack).not.toHaveBeenCalled();
  });
});

// #4255 (Design 126 sections 7.2 and 7.4): Esc aborts the flow; the left arrow
// (Shift+Tab in a text input) goes back one stage with the values kept.
describe('llmBackStage (#4255)', () => {
  it('maps each stage before the run to the stage before it; none on the first step, the run and the finish', () => {
    expect(llmBackStage('build-legs')).toBe('picking-app');
    expect(llmBackStage('no-legs')).toBe('picking-app');
    expect(llmBackStage('pick-model')).toBe('build-legs');
    expect(llmBackStage('pick-model-custom')).toBe('pick-model');
    expect(llmBackStage('health-check', 'ok')).toBe('pick-model');
    expect(llmBackStage('health-check', 'running')).toBeNull();
    expect(llmBackStage('save-default')).toBe('build-legs');
    expect(llmBackStage('review-config')).toBe('build-legs');
    for (const s of ['picking-app', 'no-apps', 'running', 'saving', 'done', 'error']) expect(llmBackStage(s)).toBeNull();
  });
});

function NavHarness({ stage, textInput, requestAbort, setStage, dialogOpen = false }: { stage: string; textInput?: boolean; requestAbort: () => void; setStage: (s: string) => void; dialogOpen?: boolean }): React.JSX.Element {
  useLlmKeyHandler({
    stage, pendingLegs: [], resolvedLegs: [], loadedConnectors: [], crawlAvailable: false,
    healthStatus: null, guidanceOpenRef: { current: false }, requestAbort, dialogOpen, textInput,
    setStage, setNextLeg: vi.fn(), setBuildError: vi.fn(), setIncludeCrawl: vi.fn(),
    setPendingLegs: vi.fn(), setResolvedLegs: vi.fn(), handleHealthCheckConfirm: vi.fn(),
  });
  return <Text>{stage}</Text>;
}

describe('useLlmKeyHandler navigation (#4255)', () => {
  it('Esc asks the flow to abort; it never steps back', async () => {
    const requestAbort = vi.fn();
    const setStage = vi.fn();
    const { stdin } = render(<NavHarness stage="pick-model" requestAbort={requestAbort} setStage={setStage} />);
    await tick();
    stdin.write('\u001b');
    await tick();
    expect(requestAbort).toHaveBeenCalledTimes(1);
    expect(setStage).not.toHaveBeenCalled();
  });

  it('the left arrow goes back one stage', async () => {
    const setStage = vi.fn();
    const { stdin } = render(<NavHarness stage="pick-model" requestAbort={vi.fn()} setStage={setStage} />);
    await tick();
    stdin.write('\u001b[D');
    await tick();
    expect(setStage).toHaveBeenCalledWith('build-legs');
  });

  it('in a text input the left arrow stays with the field and Shift+Tab goes back', async () => {
    const setStage = vi.fn();
    const { stdin } = render(<NavHarness stage="pick-model-custom" textInput requestAbort={vi.fn()} setStage={setStage} />);
    await tick();
    stdin.write('\u001b[D');
    await tick();
    expect(setStage).not.toHaveBeenCalled();
    stdin.write('\u001b[Z');
    await tick();
    expect(setStage).toHaveBeenCalledWith('pick-model');
  });

  it('while the AbortDialog is open the handler reads no key', async () => {
    const requestAbort = vi.fn();
    const setStage = vi.fn();
    const { stdin } = render(<NavHarness stage="pick-model" dialogOpen requestAbort={requestAbort} setStage={setStage} />);
    await tick();
    stdin.write('\u001b');
    await tick();
    stdin.write('\u001b[D');
    await tick();
    expect(requestAbort).not.toHaveBeenCalled();
    expect(setStage).not.toHaveBeenCalled();
  });
});
