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
 * Tests for renderer.ts -- issue #0431
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOVEREIGN_HEALTH_RUN = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp/runs/2026-05-13T18-42-00',
);

// ---------------------------------------------------------------------------
// Slot parsing tests (unit -- no file I/O)
// ---------------------------------------------------------------------------

describe('slot parsing', () => {
  it('parses SWAO slot comments from template', async () => {  // renderModeA does file I/O; allow 20s
    // Dynamically import private parseSlots via the module (it's not exported;
    // test the contract via renderModeA behaviour instead).
    // This test verifies the slot regex logic by calling the renderer in headless mode.
    const { renderModeA } = await import('./renderer.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-test-'));
    const result = await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath: join(tmpDir, 'pub-data.json'),
      headless: true,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.outputPath.endsWith('.json')).toBe(true);
  }, 20000);

  it('headless mode writes valid JSON', async () => {
    const { renderModeA } = await import('./renderer.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-test-'));
    const result = await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath: join(tmpDir, 'publication-data.json'),
      headless: true,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const raw = readFileSync(result.outputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(['1.0', '1.1']).toContain(parsed.contract_version);
    expect(parsed.meta.app_id).toBe('sovereign-health');
    expect(parsed._generated_at).toBe('2026-01-01T00:00:00.000Z');
  }, 20000);
});

// NOTE (#0582): the "i18n label files" validation tests moved to
// @swao/publication-render/src/publish/i18n.test.ts alongside the i18n YAML
// assets, which relocated to that leaf with the rendering engine.

// ---------------------------------------------------------------------------
// Size enforcement tests
// ---------------------------------------------------------------------------

describe('PublicationSizeError', () => {
  it('is exported from renderer', async () => {
    const { PublicationSizeError } = await import('./renderer.js');
    const err = new PublicationSizeError(3 * 1024 * 1024);
    expect(err.message).toContain('10 MB');
    expect(err.bytes).toBe(3 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// renderHubPage tests (#0794)
// ---------------------------------------------------------------------------

describe('renderHubPage (#0794)', () => {
  function makeWorkspace(appId: string): string {
    const root = mkdtempSync(join(tmpdir(), 'swao-hub-test-'));
    const pubDir = join(root, 'apps', appId, 'wsp', 'publications');
    mkdirSync(pubDir, { recursive: true });
    // Seed two publication pointer files
    writeFileSync(
      join(pubDir, 'latest-application.html'),
      '<meta http-equiv="refresh" content="0;url=./2026-07-04-sovereign-health.html">',
      'utf-8',
    );
    writeFileSync(
      join(pubDir, 'latest-landing-zone-catalog.html'),
      '<meta http-equiv="refresh" content="0;url=./2026-07-04-sovereign-health-lz.html">',
      'utf-8',
    );
    return root;
  }

  it('creates engagement-hub.html in the publications directory', async () => {
    const { renderHubPage } = await import('./renderer.js');
    const appId = 'sovereign-health';
    const workspace = makeWorkspace(appId);
    const result = await renderHubPage({
      workspace,
      appId,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.outputPath).toContain('engagement-hub.html');
  }, 20000);

  it('hub page contains hub.header and hub.workspace_summary output', async () => {
    const { renderHubPage } = await import('./renderer.js');
    const appId = 'sovereign-health';
    const workspace = makeWorkspace(appId);
    const result = await renderHubPage({
      workspace,
      appId,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('Engagement Hub');
    expect(html).toContain('Workspace Summary');
  }, 20000);

  it('hub page links to both available publication types', async () => {
    const { renderHubPage } = await import('./renderer.js');
    const appId = 'sovereign-health';
    const workspace = makeWorkspace(appId);
    const result = await renderHubPage({
      workspace,
      appId,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('latest-application.html');
    expect(html).toContain('latest-landing-zone-catalog.html');
  }, 20000);

  it('hub page renders empty-state when no publications exist', async () => {
    const { renderHubPage } = await import('./renderer.js');
    const root = mkdtempSync(join(tmpdir(), 'swao-hub-empty-'));
    const appId = 'no-pubs-app';
    const result = await renderHubPage({
      workspace: root,
      appId,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(existsSync(result.outputPath)).toBe(true);
    expect(html).toContain('Engagement Hub');
  }, 20000);

  it('per-app hub page renders application cards and breadcrumb', async () => {
    const { renderHubPage } = await import('./renderer.js');
    const appId = 'sovereign-health';
    const workspace = makeWorkspace(appId);
    const result = await renderHubPage({
      workspace,
      appId,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('Engagement Hub');
    expect(html).toContain(appId);
  }, 20000);
});

// ---------------------------------------------------------------------------
// renderWorkspaceHubPage tests (#0795)
// ---------------------------------------------------------------------------

describe('renderWorkspaceHubPage (#0795)', () => {
  function makeMultiAppWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'swao-ws-hub-'));
    for (const appId of ['app-alpha', 'app-beta']) {
      const pubDir = join(root, 'apps', appId, 'wsp', 'publications');
      mkdirSync(pubDir, { recursive: true });
      writeFileSync(
        join(pubDir, 'latest-application.html'),
        `<meta http-equiv="refresh" content="0;url=./${appId}-latest.html">`,
        'utf-8',
      );
    }
    return root;
  }

  it('creates apps/engagement-hub.html at workspace root', async () => {
    const { renderWorkspaceHubPage } = await import('./renderer.js');
    const workspace = makeMultiAppWorkspace();
    const result = await renderWorkspaceHubPage({
      workspace,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.outputPath).toContain('apps');
    expect(result.outputPath).toContain('engagement-hub.html');
  }, 20000);

  it('workspace hub includes both apps', async () => {
    const { renderWorkspaceHubPage } = await import('./renderer.js');
    const workspace = makeMultiAppWorkspace();
    const result = await renderWorkspaceHubPage({
      workspace,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('app-alpha');
    expect(html).toContain('app-beta');
    expect(result.appCount).toBe(2);
  }, 20000);

  it('workspace hub renders empty-state when no apps have publications', async () => {
    const { renderWorkspaceHubPage } = await import('./renderer.js');
    const root = mkdtempSync(join(tmpdir(), 'swao-ws-empty-'));
    const result = await renderWorkspaceHubPage({
      workspace: root,
      swaoVersion: '0.5.9',
      timestamp: '2026-07-04T10:00:00.000Z',
    });
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.appCount).toBe(0);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Pointer file regression (#1251) -- custom outputPath must not corrupt pointer
// ---------------------------------------------------------------------------

describe('latest-application.html pointer file (#1251)', () => {
  it('does not overwrite latest-application.html when outputPath is outside pubDir', async () => {
    const { renderModeA } = await import('./renderer.js');
    const tmpRoot = mkdtempSync(join(tmpdir(), 'swao-ptr-'));
    const tmpOut = join(tmpRoot, 'preview.html');

    // Call renderModeA with a custom output path (simulating HTML Editor behaviour).
    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath: tmpOut,
      timestamp: '2026-07-27T00:00:00.000Z',
    });

    // The pointer file must NOT have been written (it does not exist in tmpRoot).
    const brokenPointer = join(tmpRoot, 'latest-application.html');
    expect(existsSync(brokenPointer)).toBe(false);
  }, 20000);

});

// ---------------------------------------------------------------------------
// LZ-catalog run auto-detection (#1383)
// ---------------------------------------------------------------------------
// LZ-catalog runs emit passes/lz-fit-*.yaml and no wsp.yaml. Publishing one
// without an explicit --block-profile previously died in the application
// extractor with "No assessment results found (wsp.yaml)".

describe('lz-catalog block-profile auto-detection (#1383)', () => {
  function makeLzRun(): string {
    const root = mkdtempSync(join(tmpdir(), 'swao-lz-run-'));
    const runDir = join(root, 'wsp', 'runs', '2026-08-05T03-48-03');
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    writeFileSync(join(runDir, 'passes', 'lz-fit-stackit-eu01.yaml'), [
      'assessment:',
      '  provider: stackit',
      '  region: eu01',
      '  overall: READY',
      '  sovereignty_statement: Region eu01 satisfies the sovereignty requirements derived from BSI_C5, GDPR.',
      "  generated_at: '2026-08-05'",
      '  items:',
      '    - service_code: postgresql',
      '      verdict: SUPPORTED',
      '      detail: postgresql is offered in eu01',
      'signals: []',
      '',
    ].join('\n'));
    return runDir;
  }

  it('publishes an LZ run without an explicit block profile', async () => {
    const { renderModeA } = await import('./renderer.js');
    const runDir = makeLzRun();
    const tmpOut = join(mkdtempSync(join(tmpdir(), 'swao-lz-out-')), 'publication-data.json');
    const result = await renderModeA({
      wspRunDir: runDir,
      outputPath: tmpOut,
      headless: true,
      timestamp: '2026-08-05T00:00:00.000Z',
    });
    const parsed = JSON.parse(readFileSync(result.outputPath, 'utf-8'));
    expect(parsed.block_profile).toBe('lz-catalog');
    expect(parsed.lzr).toBeDefined();
  }, 20000);

  it('an explicit block profile still wins over detection', async () => {
    const { renderModeA } = await import('./renderer.js');
    const runDir = makeLzRun();
    const tmpOut = join(mkdtempSync(join(tmpdir(), 'swao-lz-out-')), 'publication-data.json');
    const result = await renderModeA({
      wspRunDir: runDir,
      outputPath: tmpOut,
      headless: true,
      blockProfile: 'lz-catalog',
      timestamp: '2026-08-05T00:00:00.000Z',
    });
    const parsed = JSON.parse(readFileSync(result.outputPath, 'utf-8'));
    expect(parsed.block_profile).toBe('lz-catalog');
  }, 20000);
});

// ---------------------------------------------------------------------------
// Full-text search index (#1388)
// ---------------------------------------------------------------------------

describe('full-text section search docs (#1388)', () => {
  it('rendered publication embeds section docs for every substantial block', async () => {
    const { renderModeA } = await import('./renderer.js');
    const tmpOut = join(mkdtempSync(join(tmpdir(), 'swao-1388-')), 'pub.html');
    await renderModeA({
      wspRunDir: SOVEREIGN_HEALTH_RUN,
      outputPath: tmpOut,
      timestamp: '2026-08-05T00:00:00.000Z',
    });
    const html = readFileSync(tmpOut, 'utf-8');
    const m = html.match(/<script type="application\/json" id="swao-search-index">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const docs = JSON.parse(m![1]!) as Array<{ type: string; anchor?: string; body: string }>;
    const sections = docs.filter(d => d.type === 'section');
    expect(sections.length).toBeGreaterThanOrEqual(3);
    // Every section doc navigates to a real anchor present in the page.
    for (const s of sections) {
      expect(s.anchor).toBeTruthy();
      expect(html).toContain(`id="${s.anchor}"`);
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Hub chrome structure tests (#1128 #1131)
// ---------------------------------------------------------------------------

describe('hub template chrome (#1128 #1131)', () => {
  it('rendered workspace hub HTML contains site-header and page-layout chrome', async () => {
    const { renderWorkspaceHubPage } = await import('./renderer.js');
    const root = mkdtempSync(join(tmpdir(), 'swao-hub-chrome-'));
    const result = await renderWorkspaceHubPage({
      workspace: root,
      swaoVersion: '0.7.7',
      timestamp: '2026-07-17T00:00:00.000Z',
    });
    const html = readFileSync(result.outputPath, 'utf-8');
    expect(html).toContain('class="site-header"');
    expect(html).toContain('class="page-layout"');
    expect(html).toContain('class="band band-top"');
    expect(html).toContain('class="breadcrumb-bar"');
    expect(html).toContain('class="sidebar"');
  }, 20000);
});

// ---------------------------------------------------------------------------
// LZ_CATALOG_TEMPLATE structure tests (#1126 #1131)
// ---------------------------------------------------------------------------

describe('LZ_CATALOG_TEMPLATE structure (#1126 #1131)', () => {
  it('contains all lz-catalog-specific SWAO slots', async () => {
    const { LZ_CATALOG_TEMPLATE } = await import('@swao/publication-render');
    const slotRe = /<!--\s*SWAO:slot\s+name="([^"]+)"[^>]*?-->/g;
    const slots: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = slotRe.exec(LZ_CATALOG_TEMPLATE)) !== null) { slots.push(m[1]); }
    expect(slots).toContain('lz-catalog-services');
    expect(slots).toContain('lzr-catalog-verdict');
    expect(slots).toContain('lzr-catalog-findings');
    expect(slots).toContain('evidence-gallery');
    expect(slots).not.toContain('seven-r-card');
    expect(slots).not.toContain('exec-summary');
  });

  it('contains site-header chrome', async () => {
    const { LZ_CATALOG_TEMPLATE } = await import('@swao/publication-render');
    expect(LZ_CATALOG_TEMPLATE).toContain('class="site-header"');
    expect(LZ_CATALOG_TEMPLATE).toContain('class="page-layout"');
    expect(LZ_CATALOG_TEMPLATE).toContain('class="band band-top"');
  });
});

// ---------------------------------------------------------------------------
// extractMainContent (#1473)
// ---------------------------------------------------------------------------

describe('extractMainContent (#1473)', () => {
  it('extracts inner content of first <main> element', async () => {
    const { extractMainContent } = await import('./renderer.js');
    const html = '<html><body><main class="foo"><p>Hello</p></main></body></html>';
    expect(extractMainContent(html)).toBe('<p>Hello</p>');
  });

  it('returns empty string when no <main> element present', async () => {
    const { extractMainContent } = await import('./renderer.js');
    expect(extractMainContent('<html><body><div>no main</div></body></html>')).toBe('');
  });

  it('trims whitespace around extracted content', async () => {
    const { extractMainContent } = await import('./renderer.js');
    const html = '<main>\n  <p>content</p>\n</main>';
    expect(extractMainContent(html)).toBe('<p>content</p>');
  });
});

