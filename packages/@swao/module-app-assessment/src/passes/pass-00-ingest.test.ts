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
import { runIngestPrePass } from './pass-00-ingest.js';

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
      join(dir, 'wsp', 'inputs', 'llm-gateway', 'preme-preprod.yaml'),
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
