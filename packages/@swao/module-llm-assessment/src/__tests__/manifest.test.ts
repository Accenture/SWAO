// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Manifest contract (#0562 skeleton, re-cut #1419/#1420 sprint-114):
// type:llm is a runnable contribution (Design 092) available on all tiers
// (Community+, DOCX golden standard) behind one gate: completed-App-Assessment
// precondition.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifest, assessmentTypes } from '../index.js';
import { runLlmAssessment, LlmAssessmentGateError, EnginePendingError } from '../llm-type.js';
import type { AssessmentRunContext } from '@swao/core';

let tmpRoot: string;

function ctx(appId: string): AssessmentRunContext {
  return { appId, workspacePath: tmpRoot, iter: 1, assessedAt: '2026-08-06' } as AssessmentRunContext;
}


beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-llm-type-'));
  const runDir = join(tmpRoot, 'apps', 'assessed-app', 'wsp', 'runs', '2026-08-05T10-00-00');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({
    finished_at: '2026-08-05T11:00:00Z',
    passes_executed: ['inventory'],
    pass_stats: [{ num: '01', pass: 'inventory' }],
  }), 'utf-8');
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('module-llm-assessment manifest (#1419/#1420)', () => {
  it('has the correct id and COMMUNITY tier (ungated per DOCX golden standard)', () => {
    expect(manifest.id).toBe('@swao/module-llm-assessment');
    expect(manifest.tier).toBe('community');
  });

  it('registers type: llm as runnable (no coming-soon flag)', () => {
    expect(assessmentTypes).toHaveLength(1);
    const llm = assessmentTypes[0]!;
    expect(llm.type).toBe('llm');
    expect(llm.comingSoon).toBeUndefined();
    expect(llm.description).toContain('Design 092');
  });
});

describe('runLlmAssessment gate order (#1420)', () => {
  it('an unassessed app fails the precondition gate (no tier barrier)', async () => {
    await expect(runLlmAssessment(ctx('ghost-app'))).rejects.toBeInstanceOf(LlmAssessmentGateError);
  });

  it('with precondition green, the pending engine is reported honestly', async () => {
    await expect(runLlmAssessment(ctx('assessed-app'))).rejects.toBeInstanceOf(EnginePendingError);
  });
});
