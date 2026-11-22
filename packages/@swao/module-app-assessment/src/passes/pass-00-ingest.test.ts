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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listIngestedDocuments, runIngestPrePass } from './pass-00-ingest.js';

describe('runIngestPrePass -- unmanaged-file warnings (#2949)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-ingest-'));
    // Create ingestion/ with a minimal processable file so the pass runs past
    // the early-return guard (it returns null when ingestion/ is empty).
    mkdirSync(join(dir, 'ingestion'), { recursive: true });
    writeFileSync(join(dir, 'ingestion', 'readme.txt'), 'placeholder', 'utf-8');
    mkdirSync(join(dir, 'wsp', 'inputs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not warn about wsp/inputs/llm-gateway/ -- it is a reserved config dir (#2949)', async () => {
    mkdirSync(join(dir, 'wsp', 'inputs', 'llm-gateway'), { recursive: true });
    writeFileSync(
      join(dir, 'wsp', 'inputs', 'llm-gateway', 'corp-genai-preprod.yaml'),
      'schema_version: "1.0"\n',
      'utf-8',
    );
    const warnings: string[] = [];
    await runIngestPrePass({
      workspacePath: dir,
      assessedAt: new Date().toISOString(),
      warn: (m) => warnings.push(m),
    });
    const gwWarning = warnings.find((w) => w.includes('llm-gateway'));
    expect(gwWarning).toBeUndefined();
  });

  it('still warns about genuinely unmanaged non-reserved subfolders', async () => {
    mkdirSync(join(dir, 'wsp', 'inputs', 'custom-folder'), { recursive: true });
    writeFileSync(
      join(dir, 'wsp', 'inputs', 'custom-folder', 'file.txt'),
      'hello',
      'utf-8',
    );
    const warnings: string[] = [];
    await runIngestPrePass({
      workspacePath: dir,
      assessedAt: new Date().toISOString(),
      warn: (m) => warnings.push(m),
    });
    expect(warnings.some((w) => w.includes('custom-folder') && w.includes('not managed by ingestion'))).toBe(true);
  });
});

// #4050 (Design 120 section 8.4): the landing zone ingestion folder reuses Pass 00 routing.
describe('listIngestedDocuments (#4050)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-ingest-lz-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('routes landing-zones/<lz-id>/ingestion/ into its own wsp/inputs and flags which documents hold text', async () => {
    const lzDir = join(dir, 'landing-zones', 'otc-test');
    mkdirSync(join(lzDir, 'ingestion', 'policies'), { recursive: true });
    writeFileSync(join(lzDir, 'ingestion', 'policies', 'ict_risk_management_framework.md'), '# ICT risk management framework\n\nScope and roles.\n');
    writeFileSync(join(lzDir, 'ingestion', 'register_of_information.md'), '   \n');
    writeFileSync(join(lzDir, 'ingestion', 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(lzDir, 'ingestion', 'README.md'), 'operator notes, skipped by Pass 00');
    const manifest = await runIngestPrePass({ workspacePath: lzDir, assessedAt: '2026-11-07T20:00:00Z', warn: () => {} });
    expect(manifest?.imports_dir).toBe('wsp/inputs');
    const docs = listIngestedDocuments(manifest, lzDir);
    expect(docs.map((d) => [d.source, d.readable])).toEqual([
      ['diagram.png', false],
      ['policies/ict_risk_management_framework.md', true],
      ['register_of_information.md', false],
    ]);
    expect(docs.every((d) => d.category.length > 0)).toBe(true);
    expect(listIngestedDocuments(null, lzDir)).toEqual([]);
  });

  it('an extracted companion counts only for its text, not for the extraction header', () => {
    mkdirSync(join(dir, 'wsp', 'inputs', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'wsp', 'inputs', 'docs', 'a.pdf.extracted.txt'), '<!-- extracted from: a.pdf at 2026-11-07 -->\n\n');
    writeFileSync(join(dir, 'wsp', 'inputs', 'docs', 'b.pdf.extracted.txt'), '<!-- extracted from: b.pdf at 2026-11-07 -->\n\nPolicy text.');
    const manifest = {
      schema_version: '1.0', generated_at: '', ingestion_dir: 'ingestion', imports_dir: 'wsp/inputs', counts: {},
      files: [
        { source: 'a.pdf', target: 'docs/a.pdf', category: 'docs', sha256: 'x', bytes: 1, extracted_path: 'docs/a.pdf.extracted.txt' },
        { source: 'b.pdf', target: 'docs/b.pdf', category: 'docs', sha256: 'y', bytes: 1, extracted_path: 'docs/b.pdf.extracted.txt' },
      ],
    };
    expect(listIngestedDocuments(manifest, dir).map((d) => d.readable)).toEqual([false, true]);
  });

  it('an unterminated extraction header holds no text; text without a header is read as it is', () => {
    mkdirSync(join(dir, 'wsp', 'inputs', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'wsp', 'inputs', 'docs', 'c.pdf.extracted.txt'), '<!-- extracted from: c.pdf at 2026-11-07\n\nno end marker');
    writeFileSync(join(dir, 'wsp', 'inputs', 'docs', 'd.pdf.extracted.txt'), 'Plain policy text without a header.');
    const manifest = {
      schema_version: '1.0', generated_at: '', ingestion_dir: 'ingestion', imports_dir: 'wsp/inputs', counts: {},
      files: [
        { source: 'c.pdf', target: 'docs/c.pdf', category: 'docs', sha256: 'x', bytes: 1, extracted_path: 'docs/c.pdf.extracted.txt' },
        { source: 'd.pdf', target: 'docs/d.pdf', category: 'docs', sha256: 'y', bytes: 1, extracted_path: 'docs/d.pdf.extracted.txt' },
      ],
    };
    expect(listIngestedDocuments(manifest, dir).map((d) => d.readable)).toEqual([false, true]);
  });
});
