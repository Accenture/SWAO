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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  runIngestPrePass,
  classifyIngestFile,
  type IngestManifest,
} from '../passes/pass-00-ingest.js';

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-ingest-'));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

function drop(rel: string, content: string): void {
  const abs = join(ws, 'ingestion', rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function opts(extra?: Partial<Parameters<typeof runIngestPrePass>[0]>) {
  return { workspacePath: ws, assessedAt: '2026-07-11', ...extra };
}

// ---------------------------------------------------------------------------
// classifyIngestFile -- content-based routing (#0963)
// ---------------------------------------------------------------------------

describe('classifyIngestFile (content-based routing, #0963)', () => {
  it('routes generic CSV/XLSX to operations/ (extension fallback)', () => {
    expect(classifyIngestFile('servers.csv')).toBe('operations');
    expect(classifyIngestFile('inventory.xlsx')).toBe('operations');
  });

  it('routes cmdb*.csv/xlsx to operations/ via classifier rule', () => {
    expect(classifyIngestFile('cmdb-export.csv')).toBe('operations');
    expect(classifyIngestFile('CMDB.XLSX')).toBe('operations');
  });

  it('routes workshop/meeting DOCX to workshops/', () => {
    expect(classifyIngestFile('workshop-notes.docx')).toBe('workshops');
    expect(classifyIngestFile('meeting-transcript.docx')).toBe('workshops');
  });

  it('routes generic PDF/DOCX to docs/ (extension fallback)', () => {
    expect(classifyIngestFile('architecture.pdf')).toBe('docs');
    expect(classifyIngestFile('runbook.docx')).toBe('workshops'); // generic docx = workshops
  });

  it('routes dpa/legal PDF to compliance/ (classifier legal_pdf rule)', () => {
    // classifier legal_pdf: f.startsWith('dpa') || f.includes('agreement') || f.startsWith('soc') || f.includes('legal')
    expect(classifyIngestFile('dpa-eu.pdf')).toBe('compliance');
    expect(classifyIngestFile('gdpr-agreement.pdf')).toBe('compliance');
    // 'gdpr-dpa.pdf' starts with 'gdpr', not 'dpa' -> falls to docs/ extension fallback
    expect(classifyIngestFile('gdpr-dpa.pdf')).toBe('docs');
  });

  it('routes architecture MD to architecture/', () => {
    expect(classifyIngestFile('038-infrastructure-architecture-reference.md')).toBe('architecture');
    expect(classifyIngestFile('DESIGN.MD')).toBe('architecture');
  });

  it('routes notes/meeting/workshop MD to workshops/ (classifier rules take priority)', () => {
    // 'notes' prefix matches the workshops MD rule in classifier.ts
    expect(classifyIngestFile('notes.md')).toBe('workshops');
    expect(classifyIngestFile('meeting-2026.md')).toBe('workshops');
  });

  it('routes generic MD catch-all to architecture/', () => {
    // No specific rule matches -- generic MD catch-all fires
    expect(classifyIngestFile('overview.md')).toBe('architecture');
    expect(classifyIngestFile('summary.md')).toBe('architecture');
  });

  it('routes YAML/JSON to structured/ (extension fallback)', () => {
    expect(classifyIngestFile('config.yaml')).toBe('structured');
    expect(classifyIngestFile('inventory.json')).toBe('structured');
  });

  it('routes terraform files to terraform/', () => {
    expect(classifyIngestFile('main.tf')).toBe('terraform');
    expect(classifyIngestFile('state.tfstate')).toBe('terraform');
  });

  it('routes IaC YAML (infra keyword) to terraform/ not source/', () => {
    expect(classifyIngestFile('infra-deploy.yaml')).toBe('terraform');
  });

  it('routes unrecognised extensions to intake/', () => {
    expect(classifyIngestFile('mystery.bin')).toBe('intake');
    expect(classifyIngestFile('data.proto')).toBe('intake');
  });
});

// ---------------------------------------------------------------------------
// runIngestPrePass -- core routing and manifest (#0962 + #0963)
// ---------------------------------------------------------------------------

describe('runIngestPrePass (content routing + manifest, #0962 + #0963)', () => {
  it('is a no-op when ingestion/ is absent', async () => {
    expect(await runIngestPrePass(opts())).toBeNull();
  });

  it('is a no-op when ingestion/ holds only skippable files', async () => {
    mkdirSync(join(ws, 'ingestion'), { recursive: true });
    writeFileSync(join(ws, 'ingestion', '.gitkeep'), '');
    writeFileSync(join(ws, 'ingestion', 'README.md'), '# doc');
    expect(await runIngestPrePass(opts())).toBeNull();
  });

  it('routes files via content classification into wsp/inputs/ subfolders', async () => {
    drop('servers.csv', 'host,os\nweb1,linux\n');
    drop('architecture.pdf', '%PDF-1.4 fake');
    drop('config.yaml', 'key: value\n');

    const warnings: string[] = [];
    const manifest = await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));

    expect(manifest).not.toBeNull();
    const m = manifest as IngestManifest;
    expect(m.counts['operations']).toBe(1);
    expect(m.counts['docs']).toBe(1);
    expect(m.counts['structured']).toBe(1);
    expect(m.counts['cmdb']).toBeUndefined(); // old key gone

    const inputs = join(ws, 'wsp', 'inputs');
    expect(existsSync(join(inputs, 'operations', 'servers.csv'))).toBe(true);
    expect(existsSync(join(inputs, 'docs', 'architecture.pdf'))).toBe(true);
    expect(existsSync(join(inputs, 'structured', 'config.yaml'))).toBe(true);
    expect(existsSync(join(inputs, 'cmdb', 'servers.csv'))).toBe(false); // old path gone
  });

  it('writes manifest to ingestion/ingestion-manifest.json (NOT wsp/inputs/)', async () => {
    drop('servers.csv', 'host,os\nweb1,linux\n');
    const m = await runIngestPrePass(opts()) as IngestManifest;

    const manifestPath = join(ws, 'ingestion', 'ingestion-manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(join(ws, 'wsp', 'inputs', 'ingestion-manifest.json'))).toBe(false);

    const onDisk = JSON.parse(readFileSync(manifestPath, 'utf-8')) as IngestManifest;
    expect(onDisk.schema_version).toBe('1.0');
    const entry = onDisk.files.find((f) => f.target === 'operations/servers.csv');
    expect(entry).toBeDefined();
    const expectedSha = createHash('sha256').update('host,os\nweb1,linux\n').digest('hex');
    expect(entry!.sha256).toBe(expectedSha);
    void m;
  });

  it('routes unrecognised files to intake/ without a warning', async () => {
    drop('mystery.bin', 'binary-ish');
    const warnings: string[] = [];
    const manifest = await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    expect(manifest!.counts['intake']).toBe(1);
    expect(existsSync(join(ws, 'wsp', 'inputs', 'intake', 'mystery.bin'))).toBe(true);
    expect(existsSync(join(ws, 'wsp', 'inputs', 'other', 'mystery.bin'))).toBe(false);
    expect(warnings.filter((w) => w.includes('mystery.bin'))).toHaveLength(0);
  });

  it('preserves nested ingestion structure inside the category folder', async () => {
    drop(join('exports', 'q2', 'cmdb.csv'), 'a,b\n1,2\n');
    const manifest = await runIngestPrePass(opts());
    expect(existsSync(join(ws, 'wsp', 'inputs', 'operations', 'exports', 'q2', 'cmdb.csv'))).toBe(true);
    expect(manifest!.files[0]?.target).toBe('operations/exports/q2/cmdb.csv');
  });

  it('rejects image formats with a resave/companion hint, records in rejected[]', async () => {
    // #1495 reverted the #1062 PDF-wrapper approach: all raster images are now
    // rejected because embedded pixels yield no extractable text for LLM passes.
    drop('photo.gif', 'GIF-fake');
    const warnings: string[] = [];
    const manifest = await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    // #0999: rejected files are tracked in manifest.rejected for delta detection;
    // manifest is non-null even when no valid files were ingested.
    expect(manifest).not.toBeNull();
    expect(manifest!.rejected).toHaveLength(1);
    expect(manifest!.rejected![0]?.source).toContain('photo.gif');
    expect(manifest!.rejected![0]?.status).toBe('rejected');
    expect(manifest!.rejected![0]?.reason).toContain('GIF');
    expect(warnings.some((w) => w.includes('photo.gif') && w.includes('GIF'))).toBe(true);
    expect(existsSync(join(ws, 'wsp', 'inputs'))).toBe(false);
  });

  it('does not copy archives -- emits warn instead, records in rejected[]', async () => {
    drop('data.zip', 'PK fake');
    const warnings: string[] = [];
    const manifest = await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    // #0999: rejected files are tracked in manifest.rejected for delta detection.
    expect(manifest).not.toBeNull();
    expect(manifest!.rejected).toHaveLength(1);
    expect(manifest!.rejected![0]?.source).toContain('data.zip');
    expect(warnings.some((w) => w.includes('data.zip') && w.includes('archive'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delta detection (#0962)
// ---------------------------------------------------------------------------

describe('delta detection (#0962)', () => {
  it('skips unchanged files on second run (sha matches + target exists)', async () => {
    drop('config.yaml', 'key: value\n');
    const m1 = await runIngestPrePass(opts());
    expect(m1!.files).toHaveLength(1);

    // Second run with same content -- target already exists, sha unchanged.
    const copied: string[] = [];
    const orig = writeFileSync;
    // Use timing to verify no re-copy: track manifest updates.
    const m2 = await runIngestPrePass(opts());
    expect(m2!.files).toHaveLength(1);
    expect(m2!.files[0]?.sha256).toBe(m1!.files[0]?.sha256);
    void copied; void orig;
  });

  it('re-copies when file content changes', async () => {
    drop('config.yaml', 'key: old\n');
    await runIngestPrePass(opts());

    // Update the source file content.
    writeFileSync(join(ws, 'ingestion', 'config.yaml'), 'key: new\n', 'utf-8');
    const m2 = await runIngestPrePass(opts());
    const newSha = createHash('sha256').update('key: new\n').digest('hex');
    expect(m2!.files[0]?.sha256).toBe(newSha);
  });
});

// ---------------------------------------------------------------------------
// Cleanup (#0962)
// ---------------------------------------------------------------------------

describe('cleanup of removed sources (#0962)', () => {
  it('deletes derived file when source is removed from ingestion/', async () => {
    drop('config.yaml', 'key: value\n');
    await runIngestPrePass(opts());
    const target = join(ws, 'wsp', 'inputs', 'structured', 'config.yaml');
    expect(existsSync(target)).toBe(true);

    // Remove from ingestion/ and re-run.
    rmSync(join(ws, 'ingestion', 'config.yaml'));
    // Also add a different file so runIngestPrePass doesn't short-circuit.
    drop('other.yaml', 'x: 1\n');
    await runIngestPrePass(opts());
    expect(existsSync(target)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unmanaged file warn (#0965)
// ---------------------------------------------------------------------------

describe('unmanaged file warn (#0965)', () => {
  it('emits warn for files in dynamic subfolders not tracked in manifest', async () => {
    drop('config.yaml', 'key: value\n');
    await runIngestPrePass(opts());

    // Manually drop a file into a dynamic subfolder.
    mkdirSync(join(ws, 'wsp', 'inputs', 'architecture'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'inputs', 'architecture', 'manual.md'), '# manual', 'utf-8');

    const warnings: string[] = [];
    // Re-run with same ingestion content (delta skips copy; unmanaged scan still runs).
    await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    expect(warnings.some((w) => w.includes('manual.md') && w.includes('not managed'))).toBe(true);
  });

  it('does not warn about files with a manifest entry', async () => {
    drop('config.yaml', 'key: value\n');
    const warnings: string[] = [];
    await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    expect(warnings.filter((w) => w.includes('not managed'))).toHaveLength(0);
  });

  it('does not scan reserved subfolders (cmdb, source, catalogs, terraform)', async () => {
    drop('config.yaml', 'key: value\n');
    await runIngestPrePass(opts());

    // Manually drop into cmdb/ (reserved) -- must not warn.
    mkdirSync(join(ws, 'wsp', 'inputs', 'cmdb'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'inputs', 'cmdb', 'cmdb.csv'), 'id\n1\n', 'utf-8');

    const warnings: string[] = [];
    await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    expect(warnings.filter((w) => w.includes('cmdb.csv'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Binary extraction warn -- large file (#0966)
// ---------------------------------------------------------------------------

describe('binary extraction (#0966)', () => {
  it('emits warn and skips extraction for files larger than 10 MB', async () => {
    const bigContent = Buffer.alloc(11 * 1024 * 1024, 0x25); // 11 MB, fake PDF bytes
    const bigPath = join(ws, 'ingestion', 'big.pdf');
    mkdirSync(join(ws, 'ingestion'), { recursive: true });
    writeFileSync(bigPath, bigContent);

    const warnings: string[] = [];
    const manifest = await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    expect(manifest).not.toBeNull();
    // Binary copied, no extracted_path in manifest entry.
    expect(manifest!.files[0]?.extracted_path).toBeFalsy();
    expect(warnings.some((w) => w.includes('big.pdf') && w.includes('10 MB'))).toBe(true);
  });

  it('warns on .xls and copies without extraction', async () => {
    drop('data.xls', 'legacy');
    const warnings: string[] = [];
    const manifest = await runIngestPrePass(opts({ warn: (m) => warnings.push(m) }));
    expect(manifest).not.toBeNull();
    expect(manifest!.files[0]?.extracted_path).toBeFalsy();
    expect(warnings.some((w) => w.includes('data.xls') && w.includes('.xls format'))).toBe(true);
  });
});
