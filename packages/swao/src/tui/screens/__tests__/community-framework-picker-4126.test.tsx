// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4126: the framework picker lists the workspace frameworks and points to the
// GitHub repository for more; it never names the removed install command.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CommunityFrameworkPicker } from '@swao/tui-kit';

const GITHUB = 'github.com/Accenture/SWAO/tree/main/community-frameworks';
const flat = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ');

describe('CommunityFrameworkPicker (#4126)', () => {
  it('empty workspace: points to the GitHub repository, not to swao framework install', () => {
    const { lastFrame } = render(<CommunityFrameworkPicker app="demo" options={[]} initialSelected={[]} onConfirm={vi.fn()} />);
    const frame = flat(lastFrame());
    expect(frame).toContain('No community frameworks are in this workspace');
    expect(frame).toContain(GITHUB);
    expect(frame).not.toMatch(/framework install/);
    expect(frame).not.toContain(' -- ');
  });

  it('with workspace frameworks: lists them and says where to get more', () => {
    const { lastFrame } = render(<CommunityFrameworkPicker app="demo" options={[{ id: 'GDPR', controlsCount: 12 }] as never} initialSelected={[]} onConfirm={vi.fn()} />);
    const frame = flat(lastFrame());
    expect(frame).toContain('GDPR');
    expect(frame).toContain(GITHUB);
  });
});
