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
import { runCtxPass, isStructuralEvidenceValue, isExternalEvidenceUrl, externalEvidenceUrlOf, isEvidenceNote } from '../passes/pass-04-ctx.js';

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
// Category-weight ordering tests (#2958 -- replaces extension tier tests #1351)
// ---------------------------------------------------------------------------

describe('CTX pass category-weight ordering (#2958)', () => {
  it('places architecture category before terraform category in prompt', async () => {
    // architecture=1.0 > terraform=0.7 for pass-04. Both files small enough to fit.
    const dir = makeWorkspace({
      'architecture/overview.md': 'Important architecture context: sovereign deployment.',
      'terraform/state.json': '{"resource":"azurerm_resource_group","instances":[]}',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      const archPos = prompt.indexOf('architecture/overview.md');
      const tfPos   = prompt.indexOf('terraform/state.json');
      expect(archPos).toBeGreaterThanOrEqual(0);
      expect(tfPos).toBeGreaterThanOrEqual(0);
      expect(archPos).toBeLessThan(tfPos);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('places architecture and intake before structured category in prompt', async () => {
    // architecture=1.0, intake=1.0 > structured=0.6 for pass-04.
    const dir = makeWorkspace({
      'structured/cmdb-export.csv': 'col1,col2\n1,2',
      'intake/kickoff-notes.md': 'Kickoff notes.',
      'architecture/design.md': 'System overview.',
    });
    try {
      const { llm, captured } = makeLlmCapture();
      await runCtxPass(makeCtx(dir, llm));
      const prompt = captured.prompts[0] ?? '';
      const archPos = prompt.indexOf('architecture/design.md');
      const intakePos = prompt.indexOf('intake/kickoff-notes.md');
      const csvPos  = prompt.indexOf('structured/cmdb-export.csv');
      expect(archPos).toBeGreaterThanOrEqual(0);
      expect(intakePos).toBeGreaterThanOrEqual(0);
      expect(csvPos).toBeGreaterThanOrEqual(0);
      expect(archPos).toBeLessThan(csvPos);
      expect(intakePos).toBeLessThan(csvPos);
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

// ---------------------------------------------------------------------------
// #4401: empty or structural evidence values and external URLs
// ---------------------------------------------------------------------------

describe('CTX evidence references (#4401)', () => {
  it('an empty or structural value is no reference', () => {
    for (const v of ['files: []', '[]', '', '  ', '{}', 'documents: {}', 'null', 'files:[]']) expect(isStructuralEvidenceValue(v)).toBe(true);
    for (const v of ['context.md', 'cmdb/export.csv:row 3', 'https://example.org/x', 'No application code provided']) expect(isStructuralEvidenceValue(v)).toBe(false);
  });

  it('only http and https URLs are external', () => {
    expect(isExternalEvidenceUrl('https://endoflife.example/windows-server')).toBe(true);
    expect(isExternalEvidenceUrl('http://vendor.example/advisory?id=1')).toBe(true);
    expect(isExternalEvidenceUrl('ftp://vendor.example/x')).toBe(false);
    expect(isExternalEvidenceUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalEvidenceUrl('context.md')).toBe(false);
  });

  it('drops a structural value and keeps a URL without a warning or false-positive flag', async () => {
    const ws = makeWorkspace({ 'context.md': '# Context\nService on a server.' });
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
    try {
      const llm = stubLlm({
        signals: [
          { id: 'CTX-01', severity: 'medium', title: 'No files cited', evidence: ['files: []'] },
          { id: 'CTX-02', severity: 'low', title: 'End of life', evidence: ['https://endoflife.example/windows-server', 'context.md'] },
          { id: 'CTX-03', severity: 'low', title: 'Missing file', evidence: ['gone.md'] },
        ],
        assessment: { context_inputs_found: 1, contradictions_detected: 0 },
      });
      const result = await runCtxPass(makeCtx(ws, llm));
      const byId = new Map(result.signals.map((s) => [s.id, s]));
      expect(byId.get('CTX-01')!.evidence).toEqual([]);
      expect(byId.get('CTX-01')!.false_positive_flag).toBeFalsy();
      expect(byId.get('CTX-02')!.evidence).toEqual(['https://endoflife.example/windows-server', 'context.md']);
      expect(byId.get('CTX-02')!.false_positive_flag).toBeFalsy();
      expect(byId.get('CTX-03')!.false_positive_flag).toBe(true);
      const unresolved = warnings.filter((w) => w.includes('could not be resolved'));
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]).toContain('gone.md');
    } finally {
      console.warn = origWarn;
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// #4455, #4445: prose, key=value and key-prefixed URL evidence entries
// ---------------------------------------------------------------------------

const EM_DASH = String.fromCharCode(0x2014);

describe('CTX evidence notes and key-prefixed URLs (#4455, #4445)', () => {
  it('a key-prefixed https URL is an external link', () => {
    expect(externalEvidenceUrlOf('evidence_url: https://endoflife.example/windows-server')).toBe('https://endoflife.example/windows-server');
    expect(externalEvidenceUrlOf('https://endoflife.example/x')).toBe('https://endoflife.example/x');
    expect(externalEvidenceUrlOf('context.md')).toBeNull();
    expect(externalEvidenceUrlOf('cmdb/export.csv:row 3')).toBeNull();
    expect(externalEvidenceUrlOf('source: javascript:alert(1)')).toBeNull();
  });

  it('prose and key=value strings are notes; path shapes are not', () => {
    for (const v of [
      `Chunks available: 4 ${EM_DASH} all terraform/ snapshots and README`,
      'msi_skipped_reason=no_msi_inputs',
      'topics: eol-status=high, others=null',
      'see https://vendor.example/advisory for details',
      'Several words without any path',
    ]) expect(isEvidenceNote(v)).toBe(true);
    for (const v of [
      'context.md',
      'cmdb/export.csv:row 3',
      'other/doc.md section 1 & 11',
      'architecture/overview.md: section 2',
      'terraform/main.tf',
      'README',
      'config/app.env=x',
      'Architecture Overview v2.docx',
      'see the runbook in Operations Manual.pdf',
    ]) expect(isEvidenceNote(v)).toBe(false);
  });

  it('does not flag the three monitor strings nor the prose sentence, and normalises the dash of a warning', async () => {
    const ws = makeWorkspace({ 'context.md': '# Context\nService on a server.' });
    const warnings: string[] = [];
    const infos: string[] = [];
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
    console.log = (...a: unknown[]) => { infos.push(a.map(String).join(' ')); };
    try {
      const prose = `Chunks available: 4 ${EM_DASH} all terraform/ snapshots and README`;
      const llm = stubLlm({
        signals: [
          { id: 'CTX-01', severity: 'low', title: 'EOL', evidence: ['evidence_url: https://endoflife.example/windows-server'] },
          { id: 'CTX-02', severity: 'low', title: 'MSI', evidence: ['msi_skipped_reason=no_msi_inputs', 'topics: eol-status=high, others=null'] },
          { id: 'CTX-03', severity: 'low', title: 'Prose', evidence: [prose, 'context.md'] },
          { id: 'CTX-04', severity: 'low', title: 'Missing', evidence: [`gone${EM_DASH}file.md`] },
        ],
        assessment: { context_inputs_found: 1, contradictions_detected: 0 },
      });
      const result = await runCtxPass(makeCtx(ws, llm));
      const byId = new Map(result.signals.map((s) => [s.id, s]));
      expect(byId.get('CTX-01')!.evidence).toEqual(['https://endoflife.example/windows-server']);
      for (const id of ['CTX-01', 'CTX-02', 'CTX-03']) expect(byId.get(id)!.false_positive_flag).toBeFalsy();
      expect(byId.get('CTX-02')!.evidence).toHaveLength(2);
      expect(byId.get('CTX-03')!.evidence).toEqual([prose, 'context.md']);
      expect(byId.get('CTX-04')!.false_positive_flag).toBe(true);
      const unresolved = warnings.filter((w) => w.includes('could not be resolved'));
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]).toContain('CTX-04');
      expect(unresolved[0]).not.toContain(EM_DASH);
      const notes = infos.filter((l) => l.includes('evidence note'));
      expect(notes).toHaveLength(3);
      for (const l of notes) expect(l).not.toContain(EM_DASH);
    } finally {
      console.warn = origWarn;
      console.log = origLog;
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
