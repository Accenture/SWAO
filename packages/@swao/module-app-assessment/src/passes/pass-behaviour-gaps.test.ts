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

// Regression tests for the pass behaviour gaps of #3152 (Pass 10, Pass 12)
// and #3158 (Passes 00-09) and the ingestion duplication of #3145.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump } from 'js-yaml';
import type { PassContext, CrawlResult, LlmProvider } from '@swao/core';
import { runDynamicPass } from './pass-10-dynamic.js';
import { runBlocksPass } from './pass-12-blocks.js';
import { runSynthPass, readLzrVerdict, resolveCloudProviderCataloguePath } from './pass-09-synth.js';
import { runDataPass } from './pass-03-data.js';
import { runCtxPass } from './pass-04-ctx.js';
import { runCryptoPass } from './pass-08-crypto.js';
import { findTerraformRoots } from './pass-06-tf.js';
import { runSbomPass, classifyOsvSeverity, cvss3BaseScore } from './pass-05-sbom.js';
import { runIngestPrePass, isReferencedBinaryInput } from './pass-00-ingest.js';
import { llmSkipResult, markSkippedByFlag, INVALID_LLM_RESPONSE_REASON, NO_LLM_REASON } from './llm-skip.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-gaps-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { appId: 'gap-app', sourcePath: dir, workspacePath: dir, iter: 1, assessedAt: '2026-10-10', ...overrides };
}

function llmReturning(raw: string): LlmProvider {
  return { complete: async () => raw };
}

// ---------------------------------------------------------------------------
// Pass 10 DYNAMIC (#3152)
// ---------------------------------------------------------------------------

describe('Pass 10 DYNAMIC signal IDs (#3152)', () => {
  it('emits unique IDs for the summary, accessibility and console-error signals', async () => {
    const crawl: CrawlResult = {
      targetUrl: 'https://example.com',
      screenCount: 1,
      durationMs: 10,
      engineVersion: 'test',
      screens: [{
        index: 0, url: 'https://example.com/', title: 'Home', timestamp: '2026-10-10', slug: 'home',
        screenshotJpeg: null, domSnapshot: '', a11yJson: null, networkEntries: [],
        consoleEntries: [{ type: 'error', text: 'boom' }], a11yViolations: 3,
      }] as unknown as CrawlResult['screens'],
    };
    const result = await runDynamicPass(ctx(), crawl);
    const ids = result.signals.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['DYN-01', 'DYN-09', 'DYN-11']));
    expect(ids).not.toContain('DYN-10');
  });
});

// ---------------------------------------------------------------------------
// Pass 12 BLOCKS (#3152)
// ---------------------------------------------------------------------------

describe('Pass 12 BLOCKS threshold and prefix (#3152)', () => {
  it('stores the specification threshold, not the one the LLM returned, under the BLOCKS prefix', async () => {
    const answer = {
      blocks: {
        observability: { overall_outcome: 'PARTIAL', overall_rationale: 'r', score: 0.5, threshold: 0.1, status: 'medium', key_signals: [] },
        iam_assessment: { overall_outcome: 'GAP', overall_rationale: 'r', score: 0.2, status: 'high' },
      },
    };
    const result = await runBlocksPass(ctx({ llm: llmReturning(JSON.stringify(answer)), passesDir: dir }));
    const blocks = result.assessment['blocks'] as Record<string, { threshold: number; overall_outcome: string }>;
    expect(blocks['observability']?.threshold).toBe(0.7);
    // threshold omitted by the LLM no longer invalidates the whole answer
    expect(blocks['iam_assessment']?.overall_outcome).toBe('GAP');
    expect(blocks['iam_assessment']?.threshold).toBe(0.8);
    expect(result.pass.signal_prefix).toBe('BLOCKS');
  });

  it('reads the synthesis context of the current run from ctx.passesDir', async () => {
    const passesDir = join(dir, 'wsp', 'runs', 'now', 'passes');
    mkdirSync(passesDir, { recursive: true });
    writeFileSync(join(passesDir, '09-synth.yaml'), dump({ assessment: { seven_r_label: 'Replatform', coverage_score: 0.8 } }));
    let prompt = '';
    const llm: LlmProvider = { complete: async (p: string) => { prompt = p; return '{"blocks":{}}'; } };
    await runBlocksPass(ctx({ llm, passesDir }));
    expect(prompt).toContain('seven_r_label: Replatform');
  });
});

// ---------------------------------------------------------------------------
// Pass 09 SYNTH (#3158)
// ---------------------------------------------------------------------------

describe('Pass 09 SYNTH (#3158)', () => {
  it('degrades on invalid LLM JSON instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runSynthPass(ctx({ llm: llmReturning('not json at all'), passesDir: dir }));
    warn.mockRestore();
    expect(result.pass.status).toBe('not_applicable');
    expect(result.signals.map((s) => s.id)).toEqual(['SYNTH-00']);
    expect(result.assessment['skipped_reason']).toBe(INVALID_LLM_RESPONSE_REASON);
  });

  it('degrades on an invalid seven_r_label instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = JSON.stringify({ signals: [], assessment: { seven_r_label: 'Teleport', modernization_position: 'x', portability_score: 0.5 } });
    const result = await runSynthPass(ctx({ llm: llmReturning(raw), passesDir: dir }));
    warn.mockRestore();
    expect(result.pass.status).toBe('not_applicable');
    expect(String(result.assessment['invalid_response_detail'])).toContain('Teleport');
  });

  it('accepts a fenced JSON answer', async () => {
    const raw = '```json\n' + JSON.stringify({
      signals: [],
      assessment: { seven_r_label: 'rehost', modernization_position: 'migrate_stabilize', portability_score: 0.6 },
    }) + '\n```';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runSynthPass(ctx({ llm: llmReturning(raw), passesDir: dir }));
    log.mockRestore();
    expect(result.pass.status).toBe('complete');
    expect(result.assessment['seven_r_label']).toBe('Rehost');
  });

  it('reads the LZR verdict of the current run, not the previous run', () => {
    const prevPasses = join(dir, 'wsp', 'runs', 'prev', 'passes');
    mkdirSync(prevPasses, { recursive: true });
    writeFileSync(join(dir, 'wsp', 'latest.txt'), 'runs/prev');
    writeFileSync(join(prevPasses, '23-lzr.yaml'), dump({ lzrResult: { overall_verdict: 'blocked', landing_zone_id: 'old', blockers: [] } }));
    const currentPasses = join(dir, 'wsp', 'runs', 'now', 'passes');
    mkdirSync(currentPasses, { recursive: true });
    expect(readLzrVerdict(dir).verdict).toBe('blocked'); // legacy resolver: previous run
    expect(readLzrVerdict(dir, currentPasses).verdict).toBeNull(); // current run: not assessed
  });

  it('resolves the cloud-provider catalogue', () => {
    expect(resolveCloudProviderCataloguePath()).toMatch(/cloud-provider-catalogue\.yaml$/);
  });
});

// ---------------------------------------------------------------------------
// Pass 03 DATA and Pass 04 CTX unusable answers (#3158)
// ---------------------------------------------------------------------------

describe('Pass 03 DATA / Pass 04 CTX unusable LLM answers (#3158)', () => {
  it('DATA: a truncated answer follows the llmSkipResult convention (not a 0-signal stub)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runDataPass(ctx({ llm: llmReturning('{"signals": [ {"id": "DATA-01", "deri') }));
    warn.mockRestore();
    expect(result.pass.status).toBe('not_applicable');
    expect(result.signals.map((s) => s.id)).toEqual(['DATA-00']);
    expect(result.assessment['skipped_reason']).toBe(INVALID_LLM_RESPONSE_REASON);
  });

  it('CTX: a parse failure is reported as an invalid response, not as no_llm_provider', async () => {
    mkdirSync(join(dir, 'wsp', 'inputs', 'architecture'), { recursive: true });
    writeFileSync(join(dir, 'wsp', 'inputs', 'architecture', 'notes.md'), '# Architecture\nA service.');
    const result = await runCtxPass(ctx({ llm: llmReturning('no json here') }));
    expect(result.signals.map((s) => s.id)).toEqual(['CTX-00']);
    expect(result.assessment['skipped_reason']).toBe(INVALID_LLM_RESPONSE_REASON);
  });
});

// ---------------------------------------------------------------------------
// --skip-llm marker (#3158)
// ---------------------------------------------------------------------------

describe('markSkippedByFlag (#3158)', () => {
  it('rewrites the PREFIX-00 text and keeps the uniform skip reason', () => {
    const skipped = llmSkipResult({ id: 9, name: 'synthesis', signalPrefix: 'SYNTH', iter: 1, assessedAt: 'x' });
    const marked = markSkippedByFlag(skipped);
    expect(marked.signals[0]?.derivation).toContain('--skip-llm');
    expect(marked.assessment['skipped_reason']).toBe(NO_LLM_REASON);
    expect(marked.assessment['skip_llm_flag']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pass 08 CRYPTO (#3158)
// ---------------------------------------------------------------------------

describe('Pass 08 CRYPTO (#3158)', () => {
  it('emits a positive signal for AES-GCM', async () => {
    writeFileSync(join(dir, 'enc.ts'), "const c = crypto.createCipheriv('aes-256-gcm', key, iv);\n");
    const result = await runCryptoPass(ctx());
    const gcm = result.signals.find((s) => s.derivation.includes('AES-GCM'));
    expect(gcm?.severity).toBe('positive');
    expect(gcm?.evidence[0]).toBe('enc.ts:1');
  });

  it('does not treat a bare aes-128-gcm string as a cipher call', async () => {
    writeFileSync(join(dir, 'doc.ts'), "// supported: aes-128-gcm\n");
    const result = await runCryptoPass(ctx());
    expect(result.signals.some((s) => s.derivation.includes('AES-GCM'))).toBe(false);
  });

  it('emits the no-primitive fallback with a unique ID when nothing is detected', async () => {
    const result = await runCryptoPass(ctx());
    const ids = result.signals.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.signals.some((s) => s.derivation.startsWith('No cryptographic primitives detected'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pass 06 TF IaC scan roots (#3158)
// ---------------------------------------------------------------------------

describe('Pass 06 findTerraformRoots (#3158)', () => {
  it('finds Terraform below the source root and skips hidden and dependency folders', () => {
    mkdirSync(join(dir, 'infra', 'modules', 'net'), { recursive: true });
    writeFileSync(join(dir, 'infra', 'main.tf'), '');
    writeFileSync(join(dir, 'infra', 'modules', 'net', 'net.tf'), '');
    mkdirSync(join(dir, 'deploy', 'aws'), { recursive: true });
    writeFileSync(join(dir, 'deploy', 'aws', 'x.tf'), '');
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'y.tf'), '');
    mkdirSync(join(dir, '.terraform', 'modules'), { recursive: true });
    writeFileSync(join(dir, '.terraform', 'modules', 'z.tf'), '');
    const roots = findTerraformRoots(dir).map((r) => r.slice(dir.length + 1).replace(/\\/g, '/')).sort();
    expect(roots).toEqual(['deploy/aws', 'infra']);
  });

  it('returns the root itself when it holds .tf files', () => {
    writeFileSync(join(dir, 'main.tf'), '');
    expect(findTerraformRoots(dir)).toEqual([dir]);
  });
});

// ---------------------------------------------------------------------------
// Pass 05 SBOM (#3158)
// ---------------------------------------------------------------------------

describe('Pass 05 SBOM (#3158)', () => {
  it('classifies OSV severities instead of counting every entry as high/critical', () => {
    expect(classifyOsvSeverity({ id: 'GHSA-1', database_specific: { severity: 'MODERATE' } })).toBe('medium');
    expect(classifyOsvSeverity({ id: 'GHSA-2', database_specific: { severity: 'HIGH' } })).toBe('high');
    expect(classifyOsvSeverity({ id: 'X-3', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })).toBe('critical');
    expect(classifyOsvSeverity({ id: 'X-4', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N' }] })).toBe('low');
    expect(classifyOsvSeverity({ id: 'X-5' })).toBe('unknown');
  });

  it('computes CVSS v3 base scores', () => {
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1);
    expect(cvss3BaseScore('CVSS:3.1/AV:N')).toBeNull();
  });

  it('reads an SBOM from the source path, so a source with an SBOM but no package.json is not a high-severity SBOM-01', async () => {
    const src = join(dir, 'binary');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'vendor-app.cdx.json'), JSON.stringify({
      bomFormat: 'CycloneDX', specVersion: '1.5',
      components: [{ type: 'library', name: 'openssl', version: '3.0.13' }],
    }));
    writeFileSync(join(src, 'other.spdx.json'), JSON.stringify({ packages: [{ name: 'zlib', versionInfo: '1.3.1' }] }));
    const result = await runSbomPass(ctx({ sourcePath: src }));
    expect(result.assessment['scan_type']).not.toBe('skipped');
    expect(result.assessment['external_sbom_component_count']).toBe(2);
    const sbom01 = result.signals.find((s) => s.id === 'SBOM-01');
    expect(sbom01?.severity).not.toBe('high');
    expect(sbom01?.evidence).toEqual(expect.arrayContaining(['vendor-app.cdx.json', 'other.spdx.json']));
  });
});

// ---------------------------------------------------------------------------
// Pass 00 INGEST (#3145, #3158)
// ---------------------------------------------------------------------------

describe('Pass 00 INGEST binaries and legacy formats (#3145, #3158)', () => {
  it('records installers under ingestion/binary/ by reference without copying them', async () => {
    const binDir = join(dir, 'ingestion', 'binary', 'config');
    mkdirSync(binDir, { recursive: true });
    const installer = Buffer.alloc(2 * 1024 * 1024, 0x4d);
    writeFileSync(join(dir, 'ingestion', 'binary', 'setup.msi'), installer);
    writeFileSync(join(dir, 'ingestion', 'binary', 'bundle.zip'), Buffer.from('PK\u0003\u0004'));
    writeFileSync(join(binDir, 'app.ini'), '[db]\nhost=db.local\n');
    const warnings: string[] = [];
    const manifest = await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-10', warn: (m) => warnings.push(m) });

    expect(manifest?.referenced?.map((r) => r.source).sort()).toEqual(['binary/bundle.zip', 'binary/setup.msi']);
    expect(manifest?.referenced?.find((r) => r.source === 'binary/setup.msi')?.bytes).toBe(installer.length);
    // No copy of the installer anywhere under wsp/inputs/.
    const copied: string[] = [];
    const walk = (d: string): void => {
      if (!existsSync(d)) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name)); else copied.push(e.name);
      }
    };
    walk(join(dir, 'wsp', 'inputs'));
    expect(copied).not.toContain('setup.msi');
    expect(copied).not.toContain('bundle.zip');
    // The archive under binary/ is not rejected with the extract-it warning.
    expect(warnings.some((w) => w.includes('bundle.zip'))).toBe(false);
    // Text configs under binary/ are still ingested for CTX.
    expect(manifest?.files.some((f) => f.source === 'binary/config/app.ini')).toBe(true);
  });

  it('reports new, changed and unchanged documents on a re-run (#3212)', async () => {
    mkdirSync(join(dir, 'ingestion'), { recursive: true });
    writeFileSync(join(dir, 'ingestion', 'handbook.md'), '# Handbook\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-11', warn: () => {} });
      expect(log.mock.calls.flat().join('\n')).toContain('[info] INGEST: 1 new, 0 changed, 0 unchanged document(s) in ingestion/');
      log.mockClear();
      writeFileSync(join(dir, 'ingestion', 'contract.md'), '# Support contract\n');
      writeFileSync(join(dir, 'ingestion', 'handbook.md'), '# Handbook v2\n');
      await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-11', warn: () => {} });
      expect(log.mock.calls.flat().join('\n')).toContain('[info] INGEST: 1 new, 1 changed, 0 unchanged document(s) in ingestion/');
      log.mockClear();
      await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-11', warn: () => {} });
      expect(log.mock.calls.flat().join('\n')).toContain('[info] INGEST: 0 new, 0 changed, 2 unchanged document(s) in ingestion/');
    } finally {
      log.mockRestore();
    }
  });

  it('service apps: references installers dropped anywhere under ingestion/ and still routes documents (#3212)', async () => {
    mkdirSync(join(dir, 'ingestion', 'vendor docs'), { recursive: true });
    writeFileSync(join(dir, 'ingestion', 'setup.exe'), Buffer.from('MZ'));
    writeFileSync(join(dir, 'ingestion', 'vendor docs', 'client.msi'), Buffer.from('MSI'));
    writeFileSync(join(dir, 'ingestion', 'vendor docs', 'operations.md'), '# Operations handbook\n\nBackups run nightly.\n');
    writeFileSync(join(dir, 'ingestion', 'sources.zip'), Buffer.from('PK\u0003\u0004'));
    const manifest = await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-11', warn: () => {}, referenceInstallersAnywhere: true });
    expect(manifest?.referenced?.map((r) => r.source).sort()).toEqual(['setup.exe', 'vendor docs/client.msi']);
    expect(manifest?.files.some((f) => f.source === 'vendor docs/operations.md')).toBe(true);
    // Archives outside binary/ keep the old handling (not referenced).
    expect(manifest?.referenced?.some((r) => r.source === 'sources.zip')).toBe(false);
    expect(isReferencedBinaryInput('Docs/Setup.EXE', { anywhere: true })).toBe(true);
    expect(isReferencedBinaryInput('docs/manual.pdf', { anywhere: true })).toBe(false);
  });

  it('application assessments keep copying installers outside ingestion/binary/ (#3212 scope)', async () => {
    mkdirSync(join(dir, 'ingestion', 'libs'), { recursive: true });
    writeFileSync(join(dir, 'ingestion', 'libs', 'vendor.jar'), Buffer.from('PK'));
    const manifest = await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-11', warn: () => {} });
    expect(manifest?.referenced ?? []).toEqual([]);
    expect(manifest?.files.some((f) => f.source === 'libs/vendor.jar')).toBe(true);
  });

  it('removes a copy left in wsp/inputs/ by an earlier run', async () => {
    mkdirSync(join(dir, 'ingestion', 'binary'), { recursive: true });
    writeFileSync(join(dir, 'ingestion', 'binary', 'setup.exe'), 'MZ');
    const oldCopy = join(dir, 'wsp', 'inputs', 'intake', 'binary', 'setup.exe');
    mkdirSync(join(oldCopy, '..'), { recursive: true });
    writeFileSync(oldCopy, 'MZ');
    writeFileSync(join(dir, 'ingestion', 'ingestion-manifest.json'), JSON.stringify({
      schema_version: '1.0', generated_at: 'x', ingestion_dir: 'ingestion', imports_dir: 'wsp/inputs', counts: { intake: 1 },
      files: [{ source: 'binary/setup.exe', target: 'intake/binary/setup.exe', category: 'intake', sha256: 'old', bytes: 2 }],
    }));
    await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-10', warn: () => {} });
    expect(existsSync(oldCopy)).toBe(false);
  });

  it('installers are referenced under binary/; for service apps also anywhere; archives only under binary/ (#3145, #3212)', () => {
    expect(isReferencedBinaryInput('binary/setup.msi')).toBe(true);
    expect(isReferencedBinaryInput('binary/config/app.ini')).toBe(false);
    // Application assessments: the binary/-only rule stays
    expect(isReferencedBinaryInput('docs/setup.msi')).toBe(false);
    // #3212: service apps need no ingestion/binary/ hint folder for an installer
    expect(isReferencedBinaryInput('docs/setup.msi', { anywhere: true })).toBe(true);
    expect(isReferencedBinaryInput('binary/bundle.zip')).toBe(true);
    expect(isReferencedBinaryInput('docs/bundle.zip', { anywhere: true })).toBe(false);
  });

  it('does not hand a legacy .doc file to the .docx extractor', async () => {
    mkdirSync(join(dir, 'ingestion'), { recursive: true });
    writeFileSync(join(dir, 'ingestion', 'old-spec.doc'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    const warnings: string[] = [];
    const manifest = await runIngestPrePass({ workspacePath: dir, assessedAt: '2026-10-10', warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('old-spec.doc') && w.includes('convert to .docx'))).toBe(true);
    expect(warnings.some((w) => w.includes('extraction failed'))).toBe(false);
    expect(manifest?.files.find((f) => f.source === 'old-spec.doc')?.extracted_path).toBeUndefined();
  });
});
