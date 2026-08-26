// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- credential list grouping tests (#1411)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { renderCredentialList } from './credential.js';

describe('renderCredentialList grouping (#1411 Phase 1)', () => {
  // The operator's real QA store shape (2026-08-06).
  const names = [
    'Sovereign-Health WebApp',
    'anthropic-api-key',
    'openai-api-key',
    'openrouter-api-key',
    'playwright-pass-sovereign-health',
    'playwright-url-sovereign-health',
    'playwright-user-sovereign-health',
    'vcs-token',
    'vcs-url-sovereign-health',
  ];

  it('groups LLM keys, playwright triplets per app, VCS, and other', () => {
    const out = renderCredentialList(names).join('\n');
    expect(out).toContain('LLM API keys (3)');
    expect(out).toContain('openrouter-api-key');
    expect(out).toContain('Web crawl / Playwright (3)');
    expect(out).toContain('playwright-*-sovereign-health: url, user, pass');
    expect(out).toContain('VCS tokens (2)');
    expect(out).toContain('vcs-token');
    expect(out).toContain('Other (1)');
    expect(out).toContain('Sovereign-Health WebApp');
  });

  it('flags an incomplete playwright triplet', () => {
    const out = renderCredentialList(['playwright-url-app-x', 'playwright-user-app-x']).join('\n');
    expect(out).toContain('playwright-*-app-x: url, user   (missing: pass)');
  });

  it('classifies provider:*:token as VCS and omits empty sections', () => {
    const out = renderCredentialList(['provider:github:token']).join('\n');
    expect(out).toContain('VCS tokens (1)');
    expect(out).toContain('provider:github:token');
    expect(out).not.toContain('LLM API keys');
    expect(out).not.toContain('Other');
  });

  it('handles app ids containing hyphens in the playwright pattern', () => {
    const out = renderCredentialList(['playwright-pass-my-multi-part-app']).join('\n');
    expect(out).toContain('playwright-*-my-multi-part-app: pass   (missing: url, user)');
  });
});
