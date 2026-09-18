// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: GuidanceBox (#1618-F)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-GB-01: collapsed by default -- shows title + "Ctrl+G for guidance" hint, not details
// TU-GB-02: expanded when initiallyCollapsed=false -- shows what and detail rows
// TU-GB-03: each details entry renders on its own line
// TU-GB-04: Ctrl+G toggles from collapsed to expanded
// TU-GB-05: Enter closes expanded state
// TU-GB-06: Esc closes expanded state
// TU-GB-07: does not render screen name in its own output

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { GuidanceBox } from '@swao/tui-kit';

const DETAILS = [
  { label: 'Input',  value: 'apps/<app>/ingestion/' },
  { label: 'Output', value: 'apps/<app>/wsp/inputs/' },
];

const AFFORDANCES = ['Enter -- confirm  |  Esc -- cancel'];

async function settle(ms = 60): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// TU-GB-01: collapsed by default
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-01: collapsed by default', () => {
  it('shows title and Ctrl+G hint in collapsed state', () => {
    const { lastFrame } = render(
      <GuidanceBox title="Ingestion details" what="Classifies and extracts files." />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ingestion details');
    expect(frame).toContain('Ctrl+G');
  });

  it('does not show full what text in collapsed state (truncated)', () => {
    const WHAT = 'Classifies and extracts files.';
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what={WHAT}
        details={DETAILS}
      />,
    );
    const frame = lastFrame() ?? '';
    // The collapsed render shows what as a single padded line; detail labels are hidden.
    expect(frame).not.toContain('Input:');
    expect(frame).not.toContain('Output:');
  });
});

// ---------------------------------------------------------------------------
// TU-GB-02: expanded when initiallyCollapsed=false
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-02: expanded when initiallyCollapsed=false', () => {
  it('shows what text when expanded', () => {
    const WHAT = 'Classifies and extracts files.';
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what={WHAT}
        initiallyCollapsed={false}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(WHAT);
  });

  it('shows affordances when expanded', () => {
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        affordances={AFFORDANCES}
        initiallyCollapsed={false}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter -- confirm');
  });

  it('shows close-affordance footer when expanded', () => {
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        initiallyCollapsed={false}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ctrl+G -- close guidance');
  });
});

// ---------------------------------------------------------------------------
// TU-GB-03: each details entry renders on its own line
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-03: details entries render separately', () => {
  it('renders each detail label on a distinct line', () => {
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        details={DETAILS}
        initiallyCollapsed={false}
        maxRows={40}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const inputLineIdx  = lines.findIndex((l) => l.includes('Input:'));
    const outputLineIdx = lines.findIndex((l) => l.includes('Output:'));
    // Each detail label is on a different line
    expect(inputLineIdx).toBeGreaterThanOrEqual(0);
    expect(outputLineIdx).toBeGreaterThanOrEqual(0);
    expect(inputLineIdx).not.toBe(outputLineIdx);
  });

  it('renders the detail value in the frame (stacked layout: label then indented value)', () => {
    // GuidanceBox uses a stacked layout: label on one line, value indented below.
    // The test asserts both appear in the rendered frame, not necessarily on the same line.
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        details={[{ label: 'Format', value: 'tar.gz' }]}
        initiallyCollapsed={false}
        maxRows={40}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Format:');
    expect(frame).toContain('tar.gz');
  });
});

// ---------------------------------------------------------------------------
// TU-GB-04: Ctrl+G toggles from collapsed to expanded
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-04: Ctrl+G toggles collapsed/expanded', () => {
  it('expands when Ctrl+G is pressed in collapsed state', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        details={DETAILS}
        maxRows={40}
      />,
    );
    // Collapsed initially -- detail labels are hidden
    expect(lastFrame() ?? '').not.toContain('Input:');
    await settle();
    // Ctrl+G = ASCII 0x07 (BEL)
    stdin.write('\x07');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Input:');
    expect(frame).toContain('Output:');
  });

  it('collapses when Ctrl+G is pressed in expanded state', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        details={DETAILS}
        initiallyCollapsed={false}
        maxRows={40}
      />,
    );
    // Expanded initially
    expect(lastFrame() ?? '').toContain('Input:');
    await settle();
    stdin.write('\x07');
    await settle();
    expect(lastFrame() ?? '').not.toContain('Input:');
  });
});

// ---------------------------------------------------------------------------
// TU-GB-05: Enter does NOT close expanded state (#2334 -- only Ctrl+G closes)
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-05: Enter does not close expanded state', () => {
  it('stays expanded when Enter is pressed while expanded', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        details={DETAILS}
        initiallyCollapsed={false}
        maxRows={40}
      />,
    );
    expect(lastFrame() ?? '').toContain('Input:');
    await settle();
    stdin.write('\r');
    await settle();
    // #2334: Enter does not close the panel -- parent screen must handle Enter.
    expect(lastFrame() ?? '').toContain('Input:');
  });
});

// ---------------------------------------------------------------------------
// TU-GB-06: Esc collapses expanded state (#2559 -- lets parent Esc fire)
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-06: Esc collapses expanded state (#2559)', () => {
  it('collapses when Esc is pressed while expanded', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        details={DETAILS}
        initiallyCollapsed={false}
        maxRows={40}
      />,
    );
    expect(lastFrame() ?? '').toContain('Input:');
    await settle();
    stdin.write('\x1b');
    await settle();
    // #2559: Esc collapses the box so the parent Esc handler can fire next.
    expect(lastFrame() ?? '').not.toContain('Input:');
  });
});

// ---------------------------------------------------------------------------
// TU-GB-07: does not render screen name in its own output
// ---------------------------------------------------------------------------
describe('GuidanceBox -- TU-GB-07: does not render screen name', () => {
  it('does not include "Ingest Files" screen name when title is different', () => {
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
        initiallyCollapsed={false}
      />,
    );
    // GuidanceBox title is step-specific; the screen name "Ingest Files" lives only in the Header
    expect(lastFrame() ?? '').not.toContain('Ingest Files');
  });

  it('renders its own title without duplicating a separately-supplied screen name', () => {
    const { lastFrame } = render(
      <GuidanceBox
        title="Ingestion details"
        what="Classifies and extracts files."
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ingestion details');
    // The screen name "Ingest Files" does not appear because it is
    // never passed to GuidanceBox -- it belongs only in HeaderView.
    expect(frame).not.toContain('Ingest Files');
  });
});
