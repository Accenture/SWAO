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

// Unit tests for pass-04-ctx.ts: chunked ingestion, exclusion patterns,
// priority tiers, and prompt budget capping (#1351 / #1349 / Design 088).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PassContext, LlmProvider } from '@swao/core';
import { runCtxPass } from '../passes/pass-04-ctx.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'swao-ctx-test-'));
}

function makeWorkspace(inputFiles: Record<string, string>): string {
  const dir = tmpDir();
  const inputsDir = join(dir, 'wsp', 'inputs');
  mkdirSync(inputsDir, { recursive: true });
  for (const [rel, content] of Object.entries(inputFiles)) {
    const full = join(inputsDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return dir;
}

/** A minimal LLM stub that returns the given JSON string. */
function stubLlm(response: object): LlmProvider {
  return {
    complete: async (_prompt: string) => JSON.stringify(response),
  };
}

const EMPTY_LLM_RESPONSE = {
  signals: [],
  assessment: { context_inputs_found: 0, contradictions_detected: 0 },
  context_overrides: [],
};

function makeLlmCapture(): { llm: LlmProvider; captured: { prompts: string[] } } {
  const captured = { prompts: [] as string[] };
  const llm: LlmProvider = {
    complete: async (prompt: string) => {
      captured.prompts.push(prompt);
      return JSON.stringify(EMPTY_LLM_RESPONSE);
    },
  };
  return { llm, captured };
}

function makeCtx(workspacePath: string, llm?: LlmProvider): PassContext {
  return {
    appId: 'test-app',
    sourcePath: workspacePath,
    workspacePath,
    iter: 1,
    assessedAt: '2026-08-04',
    llm,
  };
}

// ---------------------------------------------------------------------------
// Exclusion pattern tests (#1349)
// ---------------------------------------------------------------------------

describe('CTX pass exclusion patterns (#1349)', () => {
  it('excludes SBOM CSV exports matching *.xlsx.*.csv pattern', async () => {
    const dir = makeWorkspace({
      'arch/overview.md': '# Architecture\nThis describes the system.',
      'bom.xlsx.ffae1b.csv': 'packageName,version\nreact,18.0.0\nnode,20.0.0',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      const ctx = makeCtx(dir, llm);
      const result = await runCtxPass(ctx);
      const prompt = captured.prompts[0] ?? '';
      expect(prompt).toContain('arch/overview.md');
      expect(prompt).not.toContain('bom.xlsx.ffae1b.csv');
      expect(result.assessment['files_excluded_by_pattern']).toEqual(['bom.xlsx.ffae1b.csv']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT exclude operational xlsx-extracted CSVs (only SBOM-named xlsx files are excluded)', async () => {
    const dir = makeWorkspace({
      'context.md': '# Architecture\nThis describes the system.',
      'operations/07-monitoring-and-observability.xlsx.07-monitoring-and-observability.csv': 'metric,threshold\ncpu,80',
      'SBOM-app.xlsx.Rust Dependencies.csv': 'crate,version\ntokio,1.0',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      const result = await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      expect(prompt).toContain('07-monitoring-and-observability.csv');
      expect(prompt).not.toContain('SBOM-app.xlsx.Rust Dependencies.csv');
      const excluded = result.assessment['files_excluded_by_pattern'] as string[];
      expect(excluded).toContain('SBOM-app.xlsx.Rust Dependencies.csv');
      expect(excluded).not.toContain('operations/07-monitoring-and-observability.xlsx.07-monitoring-and-observability.csv');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes CycloneDX SBOM exports matching *.cdx.json', async () => {
    const dir = makeWorkspace({
      'context.md': '# Context\nSovereign workload.',
      'sbom.cdx.json': '{"bomFormat":"CycloneDX","specVersion":"1.4","components":[]}',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      const result = await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      expect(prompt).toContain('context.md');
      expect(prompt).not.toContain('sbom.cdx.json');
      expect(result.assessment['files_excluded_by_pattern']).toEqual(['sbom.cdx.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes lock files with recognised extensions (.json, .yaml) via pattern', async () => {
    // yarn.lock / Cargo.lock etc. have no allowed extension and are silently
    // dropped by the extension filter before pattern matching -- not tested here.
    // package-lock.json (.json) and pnpm-lock.yaml (.yaml) DO reach the pattern
    // matcher and must be excluded (#1349).
    const dir = makeWorkspace({
      'context.md': '# Context',
      'package-lock.json': '{"lockfileVersion":3}',
      'pnpm-lock.yaml': 'lockfileVersion: 9',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      const result = await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      expect(prompt).not.toContain('package-lock.json');
      expect(prompt).not.toContain('pnpm-lock.yaml');
      const excluded = result.assessment['files_excluded_by_pattern'] as string[];
      expect(excluded).toContain('package-lock.json');
      expect(excluded).toContain('pnpm-lock.yaml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT exclude normal CSV files', async () => {
    const dir = makeWorkspace({
      'cmdb/services.csv': 'service,region\ncompute,eu-central-1',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      expect(prompt).toContain('cmdb/services.csv');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Priority tier tests (#1351 / Design 088)
// ---------------------------------------------------------------------------

describe('CTX pass priority tiers -- T1 prose before T4 JSON (#1351)', () => {
  it('includes T1 (.md) content in prompt alongside T4 (.json)', async () => {
    // CTX_PROMPT_MAX_CHARS is a module-level constant evaluated at import time,
    // so it cannot be overridden per-test via env var. Instead we verify that
    // the prompt ordering logic is correct: md content before json content.
    const dir = makeWorkspace({
      'README.md': 'Important architecture context: sovereign deployment.',
      'metadata.json': '{"app":"sovereign-health","tier":"enterprise"}',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      // Both files small enough to fit; MD must appear before JSON (T1 < T4).
      const mdPos = prompt.indexOf('README.md');
      const jsonPos = prompt.indexOf('metadata.json');
      expect(mdPos).toBeGreaterThanOrEqual(0);
      expect(jsonPos).toBeGreaterThanOrEqual(0);
      expect(mdPos).toBeLessThan(jsonPos);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes T1 (.md) and T2 (.yaml) before T3 (.csv)', async () => {
    const dir = makeWorkspace({
      'data.csv': 'col1,col2\n1,2',
      'config.yaml': 'env: production',
      'overview.md': 'System overview.',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      const mdPos = prompt.indexOf('overview.md');
      const yamlPos = prompt.indexOf('config.yaml');
      const csvPos = prompt.indexOf('data.csv');
      expect(mdPos).toBeGreaterThanOrEqual(0);
      expect(yamlPos).toBeGreaterThanOrEqual(0);
      expect(csvPos).toBeGreaterThanOrEqual(0);
      expect(mdPos).toBeLessThan(csvPos);
      expect(yamlPos).toBeLessThan(csvPos);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Assessment output fields (#1351)
// ---------------------------------------------------------------------------

describe('CTX pass assessment output fields (#1351)', () => {
  it('records chunks_included and chunks_excluded in assessment', async () => {
    const dir = makeWorkspace({
      'context.md': 'Architecture decision: EU-only region.',
    });
    try {
      const { llm } = makeLlmCapture();
      const result = await runCtxPass(makeCtx(dir, llm));
      expect(typeof result.assessment['chunks_included']).toBe('number');
      expect(typeof result.assessment['chunks_excluded']).toBe('number');
      expect(typeof result.assessment['context_inputs_found']).toBe('number');
      expect(Array.isArray(result.assessment['files_excluded_by_pattern'])).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records context_inputs_found as unique file count (not chunk count)', async () => {
    const longContent = 'Architecture line\n'.repeat(200); // > 3000 chars -- spans 2 chunks
    const dir = makeWorkspace({
      'big-doc.md': longContent,
    });
    try {
      const { llm } = makeLlmCapture();
      const result = await runCtxPass(makeCtx(dir, llm));
      // unique files = 1 even though there are 2 chunks
      expect(result.assessment['context_inputs_found']).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits part label for multi-chunk files', async () => {
    const longContent = 'Architecture context\n'.repeat(200); // > 3000 chars
    const dir = makeWorkspace({
      'design.md': longContent,
    });
    try {
      const { llm, captured } = makeLlmCapture();
      await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      expect(prompt).toContain('[part 1/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// No LLM -- graceful skip (already covered in llm-optional-skip.test.ts,
// but include a quick sanity check to confirm assessment field contract)
// ---------------------------------------------------------------------------

describe('CTX pass -- graceful skip when no LLM configured', () => {
  it('returns not_applicable status without llm', async () => {
    const dir = makeWorkspace({ 'context.md': 'hello' });
    try {
      const result = await runCtxPass(makeCtx(dir, undefined));
      expect(result.pass.status).toBe('not_applicable');
      expect(result.assessment['skipped']).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
