// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3429: infrastructure input roles in Pass 04 (CTX). Target landing-zone
// snapshots must not be read as the client's current infrastructure.
// Synthetic fixtures only.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PassContext, LlmProvider } from '@swao/core';
import { runCtxPass, ctxChunkLabel } from '../passes/pass-04-ctx.js';
import { TARGET_CAPABILITY_GAP_TAG } from '../passes/infra-input-role.js';

function makeWorkspace(inputFiles: Record<string, string>, swaoYml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'swao-ctx-roles-'));
  const inputsDir = join(dir, 'wsp', 'inputs');
  mkdirSync(inputsDir, { recursive: true });
  for (const [rel, content] of Object.entries(inputFiles)) {
    const full = join(inputsDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  if (swaoYml) writeFileSync(join(dir, '.swao.yml'), swaoYml, 'utf-8');
  return dir;
}

function makeCtx(workspacePath: string, llm: LlmProvider): PassContext {
  return { appId: 'demo-app', sourcePath: workspacePath, workspacePath, iter: 1, assessedAt: '2026-10-23', llm };
}

/** LLM stub that records the prompt and answers with one contradiction signal. */
function contradictionLlm(evidence: string[]): { llm: LlmProvider; prompts: string[] } {
  const prompts: string[] = [];
  const llm: LlmProvider = {
    complete: async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({
        signals: [{
          id: 'CTX-01',
          source: 'llm_inference',
          category: 'infrastructure_platform',
          severity: 'high',
          derivation: 'Documentation requires MariaDB but the infrastructure shows a managed PostgreSQL database.',
          evidence,
          confidence: 'high',
        }],
        assessment: { context_inputs_found: 2, contradictions_detected: 1 },
        context_overrides: [],
      });
    },
  };
  return { llm, prompts };
}

const ARCH_DOC = '# Architecture\nThe application persists its data in MariaDB Galera.';
const POSTGRES_INFRA = JSON.stringify({ resources: [{ type: 'aws_db_instance', engine: 'postgres' }] });

describe('CTX infra roles (#3429)', () => {
  it('AC1: docs MariaDB + target snapshot Postgres: no contradiction, one target-capability gap', async () => {
    const dir = makeWorkspace({
      'architecture/overview.md': ARCH_DOC,
      'terraform/lz-aws-snapshot.json': POSTGRES_INFRA,
    });
    try {
      const { llm } = contradictionLlm(['architecture/overview.md', 'terraform/lz-aws-snapshot.json']);
      const result = await runCtxPass(makeCtx(dir, llm));
      expect(result.signals).toHaveLength(1);
      const s = result.signals[0];
      expect(s.implies).toContain(TARGET_CAPABILITY_GAP_TAG);
      expect(s.severity).toBe('medium');
      expect(s.derivation).toMatch(/^Target platform gap/);
      expect(result.assessment['target_capability_gaps']).toBe(1);
      // The stub LLM reported 1 contradiction; the reclassified signal is not one.
      expect(result.assessment['contradictions_detected']).toBe(0);
      expect(result.assessment['infra_inputs']).toEqual({ current: [], target: ['terraform/lz-aws-snapshot.json'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC2: docs MariaDB + current state Postgres: contradiction still raised', async () => {
    const dir = makeWorkspace({
      'architecture/overview.md': ARCH_DOC,
      'terraform/prod-state.json': POSTGRES_INFRA,
      'terraform/prod.tfstate': POSTGRES_INFRA,
    });
    try {
      const { llm } = contradictionLlm(['architecture/overview.md', 'terraform/prod.tfstate', 'terraform/prod-state.json']);
      const result = await runCtxPass(makeCtx(dir, llm));
      const s = result.signals[0];
      expect(s.implies ?? []).not.toContain(TARGET_CAPABILITY_GAP_TAG);
      expect(s.severity).toBe('high');
      expect(s.derivation).not.toMatch(/^Target platform gap/);
      expect(result.assessment['target_capability_gaps']).toBe(0);
      expect(result.assessment['contradictions_detected']).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a signal citing both current and target infrastructure stays a contradiction', async () => {
    const dir = makeWorkspace({
      'architecture/overview.md': ARCH_DOC,
      'infra/current/ocp-export.json': POSTGRES_INFRA,
      'infra/target/stackit-eu01.json': POSTGRES_INFRA,
    });
    try {
      const { llm } = contradictionLlm(['infra/current/ocp-export.json', 'infra/target/stackit-eu01.json']);
      const result = await runCtxPass(makeCtx(dir, llm));
      expect(result.signals[0].implies ?? []).not.toContain(TARGET_CAPABILITY_GAP_TAG);
      expect(result.assessment['infra_inputs']).toEqual({
        current: ['infra/current/ocp-export.json'],
        target: ['infra/target/stackit-eu01.json'],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC3: chunk labels in the prompt carry the role, plus the role guidance', async () => {
    const dir = makeWorkspace({
      'architecture/overview.md': ARCH_DOC,
      'terraform/lz-aws-snapshot.json': POSTGRES_INFRA,
      'terraform/prod-state.json': POSTGRES_INFRA,
    });
    try {
      const { llm, prompts } = contradictionLlm([]);
      await runCtxPass(makeCtx(dir, llm));
      const prompt = prompts[0] ?? '';
      expect(prompt).toContain('--- [TARGET-LZ] terraform/lz-aws-snapshot.json ---');
      expect(prompt).toContain('--- [CURRENT-INFRA] terraform/prod-state.json ---');
      expect(prompt).toContain('--- architecture/overview.md ---');
      expect(prompt).toContain('Never report a contradiction against a [TARGET-LZ] input');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC3 unit: ctxChunkLabel tags multi-part chunks too', () => {
    expect(ctxChunkLabel({ relativePath: 'terraform/lz-aws-snapshot.json', partNum: 2, totalParts: 3, infraRole: 'target' }))
      .toBe('--- [TARGET-LZ] terraform/lz-aws-snapshot.json [part 2/3] ---');
    expect(ctxChunkLabel({ relativePath: 'docs/a.md', partNum: 1, totalParts: 1 })).toBe('--- docs/a.md ---');
  });

  it('document-only workspaces get no role guidance (prompt unchanged)', async () => {
    const dir = makeWorkspace({ 'architecture/overview.md': ARCH_DOC });
    try {
      const { llm, prompts } = contradictionLlm([]);
      await runCtxPass(makeCtx(dir, llm));
      expect(prompts[0]).not.toContain('[TARGET-LZ]');
      expect(prompts[0]).not.toContain('[CURRENT-INFRA]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('evidence echoing the role tag still resolves (no false-positive flag)', async () => {
    const dir = makeWorkspace({
      'architecture/overview.md': ARCH_DOC,
      'terraform/lz-aws-snapshot.json': POSTGRES_INFRA,
    });
    try {
      const { llm } = contradictionLlm(['[TARGET-LZ] terraform/lz-aws-snapshot.json']);
      const result = await runCtxPass(makeCtx(dir, llm));
      const s = result.signals[0];
      expect(s.false_positive_flag).toBeUndefined();
      expect(s.implies).toContain(TARGET_CAPABILITY_GAP_TAG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('.swao.yml context.infra_roles overrides the filename default', async () => {
    const dir = makeWorkspace(
      {
        'architecture/overview.md': ARCH_DOC,
        'terraform/lz-aws-snapshot.json': POSTGRES_INFRA,
      },
      'context:\n  infra_roles:\n    - path: terraform/lz-aws-snapshot.json\n      role: current\n',
    );
    try {
      const { llm, prompts } = contradictionLlm(['terraform/lz-aws-snapshot.json']);
      const result = await runCtxPass(makeCtx(dir, llm));
      expect(prompts[0]).toContain('--- [CURRENT-INFRA] terraform/lz-aws-snapshot.json ---');
      expect(result.signals[0].implies ?? []).not.toContain(TARGET_CAPABILITY_GAP_TAG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
