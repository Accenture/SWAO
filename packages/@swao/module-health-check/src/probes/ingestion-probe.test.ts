// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildIngestionProbe } from './ingestion-probe.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-ingestion-probe-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('buildIngestionProbe -- workspace drop zone (existing behavior)', () => {
  it('returns absent when no ingestion/ directory and no apps/ data', () => {
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('absent');
    expect(result.file_count).toBe(0);
    expect(result.has_manifest).toBe(false);
    expect(result.message).toMatch(/No ingestion/);
    expect(result.apps_with_ingestion).toEqual([]);
  });

  it('returns info when ingestion/ exists but is empty', () => {
    mkdirSync(join(tmpRoot, 'ingestion'));
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('info');
    expect(result.file_count).toBe(0);
    expect(result.has_manifest).toBe(false);
    expect(result.message).toMatch(/empty/i);
  });

  it('returns warn when files exist but no manifest', () => {
    const dir = join(tmpRoot, 'ingestion');
    mkdirSync(dir);
    writeFileSync(join(dir, 'architecture.pdf'), 'fake pdf content');
    writeFileSync(join(dir, 'readme.docx'), 'fake docx content');
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('warn');
    expect(result.file_count).toBe(2);
    expect(result.has_manifest).toBe(false);
    expect(result.message).toMatch(/ingestion-manifest/);
  });

  it('returns ok when manifest and files are present', () => {
    const dir = join(tmpRoot, 'ingestion');
    mkdirSync(dir);
    writeFileSync(join(dir, 'architecture.pdf'), 'fake pdf content');
    writeFileSync(join(dir, 'ingestion-manifest.json'), JSON.stringify({ files: ['architecture.pdf'] }));
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.file_count).toBe(1);
    expect(result.has_manifest).toBe(true);
    expect(result.message).toMatch(/indexed/);
  });

  it('returns ok with file_count 0 when only the manifest exists', () => {
    const dir = join(tmpRoot, 'ingestion');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ingestion-manifest.json'), JSON.stringify({ files: [] }));
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.file_count).toBe(0);
    expect(result.has_manifest).toBe(true);
  });
});

// #1212: per-app processed ingestion data -- the common state after swao ingest has run.
describe('buildIngestionProbe -- per-app processed ingestion data (#1212)', () => {
  it('returns processed when apps/<app>/ingestion/ has files and no workspace drop zone', () => {
    const appDir = join(tmpRoot, 'apps', 'sovereign-health', 'ingestion');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'doc-001.ndjson'), '{"type":"context"}');
    writeFileSync(join(appDir, 'doc-002.ndjson'), '{"type":"context"}');
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('processed');
    expect(result.apps_with_ingestion).toContain('sovereign-health');
    expect(result.per_app_file_counts['sovereign-health']).toBe(2);
    expect(result.message).toMatch(/sovereign-health/);
    expect(result.message).toMatch(/ingested|processed/i);
  });

  it('returns processed for multiple apps', () => {
    for (const app of ['app-a', 'app-b']) {
      const dir = join(tmpRoot, 'apps', app, 'ingestion');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'data.ndjson'), '{}');
    }
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('processed');
    expect(result.apps_with_ingestion).toHaveLength(2);
    expect(result.apps_with_ingestion).toContain('app-a');
    expect(result.apps_with_ingestion).toContain('app-b');
  });

  it('returns absent when apps/ exists but no app has ingestion/ data', () => {
    const appDir = join(tmpRoot, 'apps', 'empty-app');
    mkdirSync(appDir, { recursive: true });
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('absent');
    expect(result.apps_with_ingestion).toEqual([]);
  });

  it('returns absent when apps/<app>/ingestion/ exists but is empty', () => {
    const appDir = join(tmpRoot, 'apps', 'app-x', 'ingestion');
    mkdirSync(appDir, { recursive: true });
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('absent');
    expect(result.apps_with_ingestion).toEqual([]);
  });

  it('includes per-app counts when drop zone also has files', () => {
    // Drop zone with files (warn state), plus an app with processed data
    const dropZone = join(tmpRoot, 'ingestion');
    mkdirSync(dropZone);
    writeFileSync(join(dropZone, 'raw-input.pdf'), 'pdf');
    const appDir = join(tmpRoot, 'apps', 'my-app', 'ingestion');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'processed.ndjson'), '{}');
    const result = buildIngestionProbe(tmpRoot);
    // Drop zone files present, no manifest -> warn
    expect(result.status).toBe('warn');
    // But per-app data is also surfaced
    expect(result.apps_with_ingestion).toContain('my-app');
  });

  it('info message mentions per-app data when drop zone is empty', () => {
    mkdirSync(join(tmpRoot, 'ingestion'));
    const appDir = join(tmpRoot, 'apps', 'app-z', 'ingestion');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'data.ndjson'), '{}');
    const result = buildIngestionProbe(tmpRoot);
    expect(result.status).toBe('info');
    expect(result.message).toMatch(/app/i);
    expect(result.apps_with_ingestion).toContain('app-z');
  });
});
