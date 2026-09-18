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
 * SWAO Publication Editor server tests (#0436)
 *
 * Tests only what can be validated via HTTP requests (server-side scope).
 * Browser-visible ACs (colour-picker clicks, drag-drop, "opens within 3s",
 * visual preview updating) are deferred to UAT-12.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EditorServer } from './server.js';

let server: EditorServer | null = null;

afterEach(async () => {
  if (server) { await server.stop(); server = null; }
});

describe('SWAO Publication Editor server (#0436)', { timeout: 30000 }, () => {

  // AC: server starts, liveness probe returns 200 + {status:'ok'}
  it('starts and responds on GET /health', async () => {
    const { createEditorServer } = await import('./server.js');
    server = createEditorServer({ port: 14001 });
    const url = `http://127.0.0.1:${await server.start()}`;
    const r = await fetch(`${url}/health`);
    expect(r.status).toBe(200);
    const data = await r.json() as Record<string, string>;
    expect(data.status).toBe('ok');
    expect(data.service).toBe('swao-pub-editor');
  });

  // AC: GET / returns the editor shell HTML containing the product name
  it('GET / returns HTML containing "SWAO Publication Editor"', async () => {
    const { createEditorServer } = await import('./server.js');
    server = createEditorServer({ port: 14002 });
    const url = `http://127.0.0.1:${await server.start()}`;
    const r = await fetch(url);
    expect(r.status).toBe(200);
    const ct = r.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    const html = await r.text();
    expect(html).toContain('SWAO Publication Editor');
  });

  // AC: POST /preview without appId returns 400 with error message
  it('POST /preview without appId returns 400', async () => {
    const { createEditorServer } = await import('./server.js');
    server = createEditorServer({ port: 14003 });
    const url = `http://127.0.0.1:${await server.start()}`;
    const r = await fetch(`${url}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const data = await r.json() as { error: string };
    expect(data.error).toContain('appId');
  });

  // AC: POST /export/level1 writes publication.html.tmpl with slot markers.
  // CSS vars are now written to ci.yaml (D1 -- #0930) rather than inlined in the template.
  // Tier 1 token writes are covered by T4 below; this test focuses on template structure.
  it('POST /export/level1 writes publication.html.tmpl with slot markers', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-editor-test-'));
    server = createEditorServer({ port: 14004, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/export/level1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cssVars: { '--brand-accent': '#ff0000' } }),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { path: string; ok: boolean };
    expect(data.ok).toBe(true);
    expect(existsSync(data.path)).toBe(true);

    const content = readFileSync(data.path, 'utf-8');
    // Must contain slot markers (Level 1 template structure)
    expect(content).toContain('SWAO:slot');
    expect(content).toContain('swao:css');
    // CSS vars go to ci.yaml (D1), not inline in the template (no swao-theme-override)
    expect(content).not.toContain('swao-theme-override');
  });

  // AC: GET /context returns block_profile and allowed_blocks (#0792)
  it('GET /context returns block_profile and allowed_blocks for application profile', async () => {
    const { createEditorServer } = await import('./server.js');
    server = createEditorServer({ port: 14006 });
    const url = `http://127.0.0.1:${await server.start()}`;
    const r = await fetch(`${url}/context`);
    expect(r.status).toBe(200);
    const data = await r.json() as { block_profile: string; allowed_blocks: string[] };
    expect(data.block_profile).toBe('application');
    expect(Array.isArray(data.allowed_blocks)).toBe(true);
    expect(data.allowed_blocks).toContain('cover');
    expect(data.allowed_blocks).toContain('risk-register');
    // lz-catalog blocks must not appear in application profile
    expect(data.allowed_blocks).not.toContain('lzr-catalog-header');
    expect(data.allowed_blocks).not.toContain('lz-catalog-services');
  });

  it('BLOCK_PROFILE_CONTEXTS has non-empty lz-catalog profile (#0792)', async () => {
    const { BLOCK_PROFILE_CONTEXTS } = await import('./server.js');
    expect(Array.isArray(BLOCK_PROFILE_CONTEXTS['lz-catalog'])).toBe(true);
    expect(BLOCK_PROFILE_CONTEXTS['lz-catalog'].length).toBeGreaterThan(0);
    expect(BLOCK_PROFILE_CONTEXTS['lz-catalog']).toContain('lz-catalog-services');
    expect(BLOCK_PROFILE_CONTEXTS['lz-catalog']).toContain('lzr-catalog-header');
    // application blocks must not bleed into lz-catalog
    expect(BLOCK_PROFILE_CONTEXTS['lz-catalog']).not.toContain('risk-register');
    expect(BLOCK_PROFILE_CONTEXTS['lz-catalog']).not.toContain('compliance-regime');
  });

  // T4 (#0937): CSS vars written to ci.yaml (D1 -- #0930 unblocked)
  it('T4 -- POST /export/level1 writes recognised CSS vars to wsp/templates/styles/ci.yaml', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-t4-'));
    server = createEditorServer({ port: 14008, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/export/level1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cssVars: {
          '--brand-accent': '#ff0000',      // Tier 1 -- must be written
          '--unknown-var': '#123456',        // not a Tier 1 token -- must be discarded
        },
      }),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { path: string; ok: boolean };
    expect(data.ok).toBe(true);

    // ci.yaml must be written with the Tier 1 token
    const ciPath = join(tmpWorkspace, 'wsp', 'templates', 'styles', 'ci.yaml');
    expect(existsSync(ciPath)).toBe(true);
    const ciContent = readFileSync(ciPath, 'utf-8');
    expect(ciContent).toContain('--brand-accent');
    expect(ciContent).toContain('#ff0000');
    // The unknown var must not appear in ci.yaml
    expect(ciContent).not.toContain('--unknown-var');
    // The template must NOT contain an inline swao-theme-override block
    const tmplContent = readFileSync(data.path, 'utf-8');
    expect(tmplContent).not.toContain('swao-theme-override');
  });

  // T5 (#0937): POST /settings/content persists publication_config to .swao.yml (D3 -- #0932)
  it('T5 -- POST /settings/content persists publication_config to .swao.yml', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-t5-'));
    server = createEditorServer({ port: 14007, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/settings/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logo_name: 'Accenture',
        logo_sub: 'SOVEREIGN ASSESSMENT',
        classification_band: 'ACCENTURE INTERNAL',
        unknown_future_field: 'ignored', // must not cause a 400
      }),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { ok: boolean; path: string };
    expect(data.ok).toBe(true);

    // Verify the fields were written to .swao.yml under publication_config
    const swaoYmlPath = join(tmpWorkspace, '.swao.yml');
    expect(existsSync(swaoYmlPath)).toBe(true);
    const content = readFileSync(swaoYmlPath, 'utf-8');
    expect(content).not.toMatch(/^﻿/); // no BOM
    expect(content).toContain('logo_name');
    expect(content).toContain('Accenture');
    expect(content).toContain('SOVEREIGN ASSESSMENT');
    expect(content).toContain('ACCENTURE INTERNAL');
    // unknown_future_field must not appear (whitelist enforced)
    expect(content).not.toContain('unknown_future_field');
  });

  // D4 Phase 2: POST /settings/branding writes Tier 1 tokens to ci.yaml (merge, not overwrite)
  it('D4 -- POST /settings/branding writes recognised tokens to ci.yaml', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-branding-'));
    server = createEditorServer({ port: 14010, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/settings/branding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cssVars: {
          '--brand-primary': '#112233',
          '--rag-fail': '#cc0000',
          '--unknown-var': '#aabbcc',   // must be discarded
        },
      }),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { ok: boolean; path: string };
    expect(data.ok).toBe(true);

    const ciPath = join(tmpWorkspace, 'wsp', 'templates', 'styles', 'ci.yaml');
    expect(existsSync(ciPath)).toBe(true);
    const content = readFileSync(ciPath, 'utf-8');
    expect(content).toContain('--brand-primary');
    expect(content).toContain('#112233');
    expect(content).toContain('--rag-fail');
    expect(content).toContain('#cc0000');
    expect(content).not.toContain('--unknown-var');
  });

  // D4 Phase 2: POST /settings/profile writes block order/options to profile YAML
  it('D4 -- POST /settings/profile writes profile YAML with block order and options', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-profile-'));
    server = createEditorServer({ port: 14011, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/settings/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'application',
        blocks: [
          { id: 'cover', enabled: true, order: 1 },
          { id: 'signal-list', enabled: false, order: 2 },
          { id: 'exec-summary', enabled: true, order: 3 },
        ],
        options: {
          'signal-list': { filter: 'critical,high' },
        },
      }),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { ok: boolean; path: string };
    expect(data.ok).toBe(true);

    const profilePath = join(tmpWorkspace, 'wsp', 'templates', 'profiles', 'application.yaml');
    expect(existsSync(profilePath)).toBe(true);
    const content = readFileSync(profilePath, 'utf-8');
    expect(content).toContain('cover');
    expect(content).toContain('signal-list');
    expect(content).toContain('critical,high');
  });

  // D4 Phase 2: GET /context returns branding + blocks from saved workspace files
  it('D4 -- GET /context returns branding and blocks after branding+profile are saved', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-ctx-d4-'));
    server = createEditorServer({ port: 14012, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    // Save branding first
    await fetch(`${url}/settings/branding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cssVars: { '--brand-accent': '#abcdef' } }),
    });

    // Save a profile
    await fetch(`${url}/settings/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'application',
        blocks: [{ id: 'cover', enabled: true, order: 1 }],
        options: {},
      }),
    });

    // /context should now reflect both
    const r = await fetch(`${url}/context`);
    expect(r.status).toBe(200);
    const ctx = await r.json() as {
      block_profile: string;
      allowed_blocks: string[];
      branding: Record<string, string>;
      blocks: Array<{ id: string; enabled: boolean; order: number }>;
    };
    expect(ctx.branding['--brand-accent']).toBe('#abcdef');
    expect(Array.isArray(ctx.blocks)).toBe(true);
    expect(ctx.blocks[0].id).toBe('cover');
  });

  // Profile variant: GET /context returns available_variants + active_variant
  it('variant -- GET /context returns available_variants and active_variant', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-variant-ctx-'));
    server = createEditorServer({ port: 14013, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/context`);
    expect(r.status).toBe(200);
    const ctx = await r.json() as {
      available_variants: Array<{ name: string; path: string }>;
      active_variant: string;
    };
    // No profile files exist yet -- available_variants empty, active_variant = 'default'
    expect(Array.isArray(ctx.available_variants)).toBe(true);
    expect(ctx.active_variant).toBe('default');
  });

  // Profile variant: POST /settings/variant switches the active variant
  it('variant -- POST /settings/variant switches active variant and is reflected in /context', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-variant-switch-'));
    server = createEditorServer({ port: 14014, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    // Switch to 'client'
    const r = await fetch(`${url}/settings/variant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: 'client' }),
    });
    expect(r.status).toBe(200);
    const data = await r.json() as { ok: boolean; active_variant: string };
    expect(data.ok).toBe(true);
    expect(data.active_variant).toBe('client');

    // /context should reflect the new active variant
    const ctx = await fetch(`${url}/context`).then(rr => rr.json() as Promise<{ active_variant: string }>);
    expect(ctx.active_variant).toBe('client');

    // Reset to default
    const r2 = await fetch(`${url}/settings/variant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: 'default' }),
    });
    const data2 = await r2.json() as { active_variant: string };
    expect(data2.active_variant).toBe('default');
  });

  // Profile variant: POST /settings/variant rejects invalid names
  it('variant -- POST /settings/variant rejects invalid variant names', async () => {
    const { createEditorServer } = await import('./server.js');
    server = createEditorServer({ port: 14015 });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/settings/variant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: '../etc/passwd' }),
    });
    expect(r.status).toBe(400);
    const data = await r.json() as { error: string };
    expect(data.error).toContain('Invalid variant');
  });

  // Profile variant: POST /settings/profile writes to variant file when active variant is set
  it('variant -- POST /settings/profile writes to variant-specific YAML', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-variant-write-'));
    server = createEditorServer({ port: 14016, workspace: tmpWorkspace, profileVariant: 'client' });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/settings/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'application',
        blocks: [{ id: 'cover', enabled: true, order: 1 }],
        options: {},
      }),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { ok: boolean; path: string };
    expect(data.ok).toBe(true);

    // Must write to the variant file, NOT the base profile file
    const variantPath = join(tmpWorkspace, 'wsp', 'templates', 'profiles', 'application-client.yaml');
    const basePath = join(tmpWorkspace, 'wsp', 'templates', 'profiles', 'application.yaml');
    expect(existsSync(variantPath)).toBe(true);
    expect(existsSync(basePath)).toBe(false);

    const content = readFileSync(variantPath, 'utf-8');
    expect(content).toContain('cover');
  });

  // AC: POST /export/level2 writes publication-data.html stub
  it('POST /export/level2 writes publication-data.html stub', async () => {
    const { createEditorServer } = await import('./server.js');
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-editor-test-l2-'));
    server = createEditorServer({ port: 14005, workspace: tmpWorkspace });
    const url = `http://127.0.0.1:${await server.start()}`;

    const r = await fetch(`${url}/export/level2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(r.status).toBe(200);
    const data = await r.json() as { path: string; ok: boolean };
    expect(data.ok).toBe(true);
    expect(existsSync(data.path)).toBe(true);

    const content = readFileSync(data.path, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('swao-pub-data');
    expect(content).toContain('Level 2 template');
  });

});
