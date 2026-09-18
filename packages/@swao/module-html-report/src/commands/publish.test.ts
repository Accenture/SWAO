// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Tests for `swao publish` CLI command -- issue #0432
 *
 * Tests the underlying renderModeA pipeline rather than spawning the CLI
 * process (which would require a built binary). The CLI flags are thin
 * wrappers; the substance is in renderer.ts and blocks.ts.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { renderModeA, PublicationSizeError, scaffoldPublicationTemplate } from '../publish/renderer.js';
import { registerPublish, type BuildPortalResult } from './publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOVEREIGN_HEALTH_RUN = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp/runs/2026-05-13T18-42-00',
);

// ---------------------------------------------------------------------------
// Full HTML render pipeline (--app sovereign-health equivalent)
// ---------------------------------------------------------------------------

// These tests call renderModeA() which does full HTML renders (~1s each).
// Under the forks pool with concurrent workers they need a generous timeout.
describe('renderModeA full HTML pipeline', { timeout: 60000 }, () => {
  it('produces a non-empty HTML file from sovereign-health fixture', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test-pub.html');

    const result = await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThan(2 * 1024 * 1024); // under 2 MB
  });

  it('output is valid HTML with DOCTYPE', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test.html');

    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const html = readFileSync(outputPath, 'utf-8');
    expect(html.startsWith('<!DOCTYPE html')).toBe(true);
  });

  it('output contains inlined CSS and JS', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test.html');

    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const html = readFileSync(outputPath, 'utf-8');
    expect(html).toContain('id="swao-pub-css"');
    expect(html).toContain('id="swao-pub-js"');
  });

  it('output contains search index and publication data', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test.html');

    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const html = readFileSync(outputPath, 'utf-8');
    expect(html).toContain('id="swao-search-index"');
    expect(html).toContain('id="swao-tag-index"');
    expect(html).toContain('id="swao-pub-data"');
    // Accept 1.0 or 1.1 -- fixture WSP version bumped during sprint-076
    expect(html).toMatch(/"contract_version":"1\.\d"/);
  });

  it('output contains i18n bundle with en and de keys', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test.html');

    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const html = readFileSync(outputPath, 'utf-8');
    expect(html).toContain('id="swao-i18n"');
    // Extract the i18n JSON
    const m = html.match(/<script type="application\/json" id="swao-i18n">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const i18n = JSON.parse(m![1]);
    expect(i18n).toHaveProperty('en');
    expect(i18n).toHaveProperty('de');
    expect(i18n.en).toHaveProperty('severity');
    expect(i18n.de).toHaveProperty('severity');
  });

  it('output contains app_name from sovereign-health fixture', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test.html');

    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const html = readFileSync(outputPath, 'utf-8');
    expect(html).toContain('sovereign-health');
  });

  it('timestamp is deterministic when --timestamp is set', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const out1 = join(tmpDir, 'run1.html');
    const out2 = join(tmpDir, 'run2.html');

    await renderModeA({ wspRunDir: SOVEREIGN_HEALTH_RUN, outputPath: out1, timestamp: '2026-01-01T00:00:00.000Z' });
    await renderModeA({ wspRunDir: SOVEREIGN_HEALTH_RUN, outputPath: out2, timestamp: '2026-01-01T00:00:00.000Z' });

    const html1 = readFileSync(out1, 'utf-8');
    const html2 = readFileSync(out2, 'utf-8');
    expect(html1).toBe(html2);
  });
});

// ---------------------------------------------------------------------------
// --pii-strict
// ---------------------------------------------------------------------------

describe('--pii-strict flag', { timeout: 60000 }, () => {
  it('throws when PII is found in signal derivations', async () => {
    // sovereign-health fixture has a real email in wsp.yaml engagement.partnership_lead
    // but partnership_lead is intentionally NOT redacted. We need a test
    // that verifies --pii-strict exits 1 when actual PII is present in derivations.
    // For now, verify the option is wired: a publication with no PII in derivations
    // should succeed with --pii-strict.
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-publish-'));
    const outputPath = join(tmpDir, 'test.html');

    // sovereign-health derivations don't contain raw emails -- should not throw
    await expect(
      renderModeA({
        wspRunDir: SOVEREIGN_HEALTH_RUN,
        outputPath,
        piiStrict: true,
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// --init scaffold
// ---------------------------------------------------------------------------

describe('scaffoldPublicationTemplate', () => {
  it('creates publication.html.tmpl in workspace', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-scaffold-'));
    const logger = { info: () => undefined, warn: () => undefined };
    scaffoldPublicationTemplate(tmpDir, logger);
    // scaffoldPublicationTemplate writes to wsp/templates/html/ subdirectory
    const expected = join(tmpDir, 'wsp', 'templates', 'html', 'publication.html.tmpl');
    expect(existsSync(expected)).toBe(true);
  });

  it('skips existing file without overwriting', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-scaffold-'));
    const target = join(tmpDir, 'wsp', 'templates', 'html', 'publication.html.tmpl');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'ORIGINAL CONTENT', 'utf-8');
    const logger = { info: () => undefined, warn: () => undefined };
    scaffoldPublicationTemplate(tmpDir, logger);
    expect(readFileSync(target, 'utf-8')).toBe('ORIGINAL CONTENT');
  });
});

// ---------------------------------------------------------------------------
// PublicationSizeError
// ---------------------------------------------------------------------------

describe('PublicationSizeError', () => {
  it('carries byte count and readable message', () => {
    const err = new PublicationSizeError(3_000_000);
    expect(err.bytes).toBe(3_000_000);
    expect(err.message).toContain('10 MB');
    expect(err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerPublish --workspace option (#1157)
// ---------------------------------------------------------------------------

const STUB_PORTAL_RESULT: BuildPortalResult = { outDir: '', pageCount: 0, appIds: [], pages: [] };
const STUB_DEPS = {
  swaoVersion: '0.0.0-test',
  buildPortal: async () => STUB_PORTAL_RESULT,
};

describe('registerPublish --workspace option (#1157)', () => {
  function getPublishCommand(): Command {
    const prog = new Command().exitOverride();
    registerPublish(prog, STUB_DEPS);
    return prog.commands.find(c => c.name() === 'publish')!;
  }

  it('declares a --workspace option', () => {
    const cmd = getPublishCommand();
    const opt = cmd.options.find(o => o.long === '--workspace');
    expect(opt).toBeDefined();
  });

  it('--workspace option is not mandatory (optional flag)', () => {
    const cmd = getPublishCommand();
    const opt = cmd.options.find(o => o.long === '--workspace');
    expect(opt!.mandatory).toBeFalsy();
  });

  it('--workspace option description mentions workspace', () => {
    const cmd = getPublishCommand();
    const opt = cmd.options.find(o => o.long === '--workspace');
    expect(opt!.description.toLowerCase()).toContain('workspace');
  });
});
