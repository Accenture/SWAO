// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4430: the header version names the build. The full text needs 86 columns
// next to the title; an 80-column terminal (rule 78) keeps the commit, the
// narrowest rule (63) keeps the plain version.

import { afterEach, describe, expect, it } from 'vitest';
import { renderAt } from '../testing/render-at.js';
import { HeaderView, headerVersionText, setHeaderBuildTag } from './HeaderView.js';
import { HEADER_MAX_WIDTH, HEADER_MIN_WIDTH } from './header-width.js';

const TITLE_LEN = 'S W A O  -  Sovereign Workload Assessment and Onboarding'.length;
const TAG = '4c8dd01e, 2026-11-14';
const room = (width: number): number => width - TITLE_LEN - 1;

describe('#4430 headerVersionText', () => {
  it('a wide header shows version, commit and date', () => {
    expect(headerVersionText('1.6.1', TAG, room(HEADER_MAX_WIDTH))).toBe('v1.6.1 (4c8dd01e, 2026-11-14)');
  });

  it('an 80-column terminal keeps the commit', () => {
    expect(headerVersionText('1.6.1', TAG, room(78))).toBe('v1.6.1 (4c8dd01e)');
  });

  it('the narrowest header keeps the plain version', () => {
    expect(headerVersionText('1.6.1', TAG, room(HEADER_MIN_WIDTH))).toBe('v1.6.1');
  });

  it('no build tag: the plain version', () => {
    expect(headerVersionText('1.6.1', null, room(HEADER_MAX_WIDTH))).toBe('v1.6.1');
  });
});

describe('#4430 HeaderView renders the build set by the host', () => {
  afterEach(() => setHeaderBuildTag(null));

  it('shows the commit next to the title', () => {
    setHeaderBuildTag(TAG);
    const wide = renderAt(<HeaderView version="1.6.1" licenseState={null} hideLicenseStatus />, 120);
    expect(wide.lastFrame()).toContain('v1.6.1 (4c8dd01e, 2026-11-14)');
    wide.unmount();
    const narrow = renderAt(<HeaderView version="1.6.1" licenseState={null} hideLicenseStatus />, 80);
    expect(narrow.lastFrame()).toContain('v1.6.1 (4c8dd01e)');
    narrow.unmount();
  });

  it('without a tag the header is unchanged', () => {
    const r = renderAt(<HeaderView version="1.6.1" licenseState={null} hideLicenseStatus />, 120);
    expect(r.lastFrame()).toContain('v1.6.1');
    expect(r.lastFrame()).not.toContain('(');
    r.unmount();
  });
});
