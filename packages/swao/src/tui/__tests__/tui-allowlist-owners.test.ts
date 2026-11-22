// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, owners of the Design 126 gate allowlists (#4343)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4343 (Design 126 audit U-3): every allowlist entry names the open issue
// that removes it, so the debt is visible and no entry hides behind a closed
// issue. A count lower than the found offenders fails in each gate (stale);
// this test fails on an entry whose issue is not open, on an entry for a
// file that does not exist and on a malformed entry. Without the private
// tracker (the public checkout) the issue check is skipped.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGES_DIR, PREMIUM_DIR, REPO_ROOT, owningIssue, type Allowlist } from '../../__tests__/helpers/tui-gate.js';

const DIR = join(PACKAGES_DIR, 'swao', 'src', 'tui', '__tests__', 'allowlists');
const OPEN = join(REPO_ROOT, 'docs', 'tracker', 'issues', 'open');

function allowlists(): Array<[string, Allowlist]> {
  return readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()
    .map((n) => [n, JSON.parse(readFileSync(join(DIR, n), 'utf-8')) as Allowlist]);
}

function openIssues(): Set<string> {
  return new Set(readdirSync(OPEN).filter((n) => /^\d{4}-/.test(n)).map((n) => `#${n.slice(0, 4)}`));
}

describe('Design 126 gate allowlists: owners and shape (#4343, audit U-3)', () => {
  it('every entry has a positive count, an issue id and a file that exists', () => {
    const bad: string[] = [];
    for (const [name, allow] of allowlists()) {
      expect(typeof allow.gate, name).toBe('string');
      for (const [file, e] of Object.entries(allow.entries)) {
        if (!Number.isInteger(e.count) || e.count < 1) bad.push(`${name}: ${file} count ${e.count}`);
        if (!/^#\d{4}$/.test(e.issue)) bad.push(`${name}: ${file} issue ${e.issue}`);
        const premium = file.startsWith('swao-premium/');
        if ((!premium || existsSync(PREMIUM_DIR)) && !existsSync(join(REPO_ROOT, file))) bad.push(`${name}: ${file} does not exist`);
      }
    }
    expect(bad).toEqual([]);
  });

  it.skipIf(!existsSync(OPEN))('every entry names an open issue (no closed owner)', () => {
    const open = openIssues();
    const closed: string[] = [];
    for (const [name, allow] of allowlists()) {
      for (const [file, e] of Object.entries(allow.entries)) {
        if (!open.has(e.issue)) closed.push(`${name}: ${file} (${e.issue}; owner by area: ${owningIssue(file)})`);
      }
    }
    expect(closed).toEqual([]);
  });

  it('the owner by area names an open migration row for setup, screens and the rest', () => {
    expect(owningIssue('swao/packages/swao/src/setup/branches/service.tsx')).toBe('#4254');
    expect(owningIssue('swao/packages/swao/src/tui/screens/wizard/steps/IntegrationsStep.tsx')).toBe('#4254');
    expect(owningIssue('swao/packages/swao/src/tui/screens/ToolsMenu.tsx')).toBe('#4213');
    expect(owningIssue('swao-premium/packages/@swao/module-portfolio/src/tui/PortfolioScreen.tsx')).toBe('#4213');
    expect(owningIssue('swao/packages/@swao/module-app-assessment/src/tui/assess/AppAssessmentScreen.tsx')).toBe('#4213');
    expect(owningIssue('swao/packages/@swao/tui-kit/src/components/LicenseGate.tsx')).toBe('#4213');
  });
});
