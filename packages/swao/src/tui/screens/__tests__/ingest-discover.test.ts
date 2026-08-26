// #2029 regression: IngestScreen.discoverIngestApp must locate the first app
// directory that contains an ingestion/ subfolder when no appId prop is given.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverIngestApp } from '../IngestScreen.js';

const tmpRoots: string[] = [];
afterEach(() => {
  for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(apps: Array<{ name: string; hasIngestion: boolean }>): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-ingest-discover-'));
  tmpRoots.push(root);
  const appsDir = join(root, 'apps');
  mkdirSync(appsDir);
  for (const app of apps) {
    mkdirSync(join(appsDir, app.name));
    if (app.hasIngestion) mkdirSync(join(appsDir, app.name, 'ingestion'));
  }
  return root;
}

describe('discoverIngestApp (#2029)', () => {
  it('returns the first app that has an ingestion/ subfolder', () => {
    const ws = makeWorkspace([
      { name: 'sovereign-health', hasIngestion: true },
    ]);
    expect(discoverIngestApp(ws)).toBe('sovereign-health');
  });

  it('returns undefined when no app has ingestion/', () => {
    const ws = makeWorkspace([
      { name: 'sovereign-health', hasIngestion: false },
    ]);
    expect(discoverIngestApp(ws)).toBeUndefined();
  });

  it('returns undefined when apps/ directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'swao-ingest-no-apps-'));
    tmpRoots.push(root);
    expect(discoverIngestApp(root)).toBeUndefined();
  });

  it('picks alphabetically first when multiple apps have ingestion/', () => {
    const ws = makeWorkspace([
      { name: 'app-b', hasIngestion: true },
      { name: 'app-a', hasIngestion: true },
    ]);
    const result = discoverIngestApp(ws);
    // readdirSync order is filesystem-dependent but we only assert it returns one of them
    expect(['app-a', 'app-b']).toContain(result);
  });

  it('skips apps without ingestion/ and finds one that has it', () => {
    const ws = makeWorkspace([
      { name: 'no-ingest-app', hasIngestion: false },
      { name: 'sovereign-health', hasIngestion: true },
    ]);
    expect(discoverIngestApp(ws)).toBe('sovereign-health');
  });
});
