// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI tests: LiveOutput wrapMode prop (#2654)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-LO-01: wrapMode='truncate-end' (default) truncates long lines
// TU-LO-02: wrapMode='wrap' preserves full content of long lines

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { LiveOutput } from '@swao/tui-kit';

const LONG_LINE = 'A'.repeat(200);

describe('LiveOutput -- TU-LO-01: truncate-end default', () => {
  it('truncates long lines when wrapMode is not set (default truncate-end)', () => {
    const { lastFrame } = render(<LiveOutput lines={[LONG_LINE]} maxWidth={80} />);
    const frame = lastFrame() ?? '';
    // The rendered line must be shorter than the full 200-char input.
    // (Ink renders the text then we compare against the known long string.)
    expect(frame).not.toContain(LONG_LINE);
  });
});

describe('LiveOutput -- TU-LO-02: wrapMode=wrap preserves full content', () => {
  it('does not pre-slice lines when wrapMode is wrap', () => {
    const { lastFrame } = render(<LiveOutput lines={[LONG_LINE]} maxWidth={80} wrapMode="wrap" />);
    const frame = lastFrame() ?? '';
    // When wrapMode='wrap', the full content is passed to the Text node;
    // Ink wraps it across lines but all characters are present.
    // Count 'A' characters in the frame to confirm no truncation.
    const aCount = (frame.match(/A/g) ?? []).length;
    expect(aCount).toBe(200);
  });
});
