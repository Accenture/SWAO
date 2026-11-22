// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-09 (static part): one Esc owner per wizard step
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4341 (Design 126 sections 7.4, 7.5 and 7.7, audit gaps U-4 and B-6): Esc in
// a Setup Wizard step belongs to the wizard (an open guidance box first, then
// the AbortDialog). A step file that reads `key.escape` itself either handles
// one key press twice (the step keeps, skips or continues while the wizard
// aborts) or uses Esc for keep, skip or back. Allowlist:
// allowlists/tui-esc-owner.json (may only shrink); since the #4341 remainder
// (2026-11-11) its entries are only the two Setup menu screens that run
// without flow navigation (Setup start menu, type selection). The render checks per step are in
// src/tui/screens/__tests__/setup-wizard-frame.test.tsx.

import { describe, it, expect } from 'vitest';
import { relative, sep } from 'node:path';
import { compareWithAllowlist, lineOffenders, loadAllowlist, REPO_ROOT, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';

/** The files of the Setup Wizard steps. */
function wizardStepFiles(): string[] {
  return tuiFiles({ includeTuiKit: false }).filter((f) => {
    const rel = relative(REPO_ROOT, f).split(sep).join('/');
    return rel.startsWith('swao/packages/swao/src/setup/') || rel.startsWith('swao/packages/swao/src/tui/screens/wizard/steps/');
  });
}

/** Lines whose code reads the Esc key. */
export function escapeReads(text: string): number[] {
  return lineOffenders(text, (code) => code.includes('key.escape'));
}

describe('G-09 Esc owner of the wizard steps (#4341, Design 126 section 7.5)', () => {
  it('flags a step that reads Esc', () => {
    expect(escapeReads('    if (key.escape) { keep(); return; }')).toEqual([1]);
    expect(escapeReads('    // key.escape is the wizard\'s')).toEqual([]);
    expect(escapeReads('    if (key.return) onNext();')).toEqual([]);
  });

  it('the scope holds the wizard steps', () => {
    const files = wizardStepFiles().map((f) => relative(REPO_ROOT, f).split(sep).join('/'));
    expect(files).toContain('swao/packages/swao/src/setup/branches/service.tsx');
    expect(files).toContain('swao/packages/swao/src/tui/screens/wizard/steps/InitStep.tsx');
  });

  it('no wizard step reads Esc beyond the allowlist', () => {
    const verdict = compareWithAllowlist(scan(wizardStepFiles(), escapeReads), loadAllowlist('tui-esc-owner.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
