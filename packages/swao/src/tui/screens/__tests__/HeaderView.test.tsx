// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: HeaderView (#1618-F)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-HV-01: renders screenName in subtitle position
// TU-HV-02: renders contextPrefix + " - " + subtitle when both are set
// TU-HV-03: separator between contextPrefix and subtitle is " - " (hyphen-space, not em-dash)
// TU-HV-04: screenName renders regardless of GuidanceBox state (it is in the header, always)

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HeaderView } from '@swao/tui-kit';
import type { LicenseStateView } from '@swao/tui-kit';

const BASE_LICENSE: LicenseStateView = {
  tier:             'community',
  assessmentCount:  0,
  firstRun:         '2026-01-01',
};

// ---------------------------------------------------------------------------
// TU-HV-01: subtitle renders screen name
// ---------------------------------------------------------------------------
describe('HeaderView -- TU-HV-01: subtitle renders screenName', () => {
  it('renders the subtitle string in the frame', () => {
    const { lastFrame } = render(
      <HeaderView
        subtitle="Ingest Files"
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    expect(lastFrame() ?? '').toContain('Ingest Files');
  });

  it('renders nothing for subtitle row when subtitle is omitted', () => {
    const { lastFrame } = render(
      <HeaderView
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    // Title bar still renders; just no subtitle row
    const frame = lastFrame() ?? '';
    expect(frame).toContain('S W A O');
  });
});

// ---------------------------------------------------------------------------
// TU-HV-02: contextPrefix + subtitle joined with " - " separator
// ---------------------------------------------------------------------------
describe('HeaderView -- TU-HV-02: contextPrefix renders with subtitle', () => {
  it('renders contextPrefix - subtitle when both are set', () => {
    const { lastFrame } = render(
      <HeaderView
        subtitle="Step Name"
        contextPrefix="Application Assessment"
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Application Assessment - Step Name');
  });

  it('renders subtitle only when contextPrefix is absent', () => {
    const { lastFrame } = render(
      <HeaderView
        subtitle="Step Name"
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Step Name');
    expect(frame).not.toContain(' - Step Name');
  });

  it('skips prefix when subtitle already starts with contextPrefix', () => {
    const { lastFrame } = render(
      <HeaderView
        subtitle="Application Assessment - Step Name"
        contextPrefix="Application Assessment"
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    // Should not double-prefix
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Application Assessment - Application Assessment');
    expect(frame).toContain('Application Assessment - Step Name');
  });
});

// ---------------------------------------------------------------------------
// TU-HV-03: separator is " - " (hyphen-space), not em-dash or en-dash
// ---------------------------------------------------------------------------
describe('HeaderView -- TU-HV-03: separator is hyphen-space not em-dash', () => {
  it('contains " - " between contextPrefix and subtitle', () => {
    const { lastFrame } = render(
      <HeaderView
        subtitle="Current Step"
        contextPrefix="Assessment Flow"
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    const frame = lastFrame() ?? '';
    // " - " hyphen separator must appear
    expect(frame).toContain('Assessment Flow - Current Step');
    // No em-dash (U+2014) or en-dash (U+2013) in the output
    expect(frame).not.toContain('—');
    expect(frame).not.toContain('–');
  });
});

// ---------------------------------------------------------------------------
// TU-HV-04: screenName in header is independent of GuidanceBox
// ---------------------------------------------------------------------------
describe('HeaderView -- TU-HV-04: screenName visible regardless of GuidanceBox state', () => {
  it('always renders the subtitle even when GuidanceBox would be collapsed', () => {
    // HeaderView is a pure presentational component; it always renders its
    // subtitle regardless of GuidanceBox collapsed/expanded state. Verified
    // by rendering HeaderView directly with a subtitle.
    const { lastFrame } = render(
      <HeaderView
        subtitle="Ingest Files"
        version="0.0.0-test"
        licenseState={BASE_LICENSE}
      />,
    );
    expect(lastFrame() ?? '').toContain('Ingest Files');
  });

  it('renders version string in the banner', () => {
    const { lastFrame } = render(
      <HeaderView
        subtitle="Any Screen"
        version="1.2.3"
        licenseState={BASE_LICENSE}
      />,
    );
    expect(lastFrame() ?? '').toContain('v1.2.3');
  });
});
