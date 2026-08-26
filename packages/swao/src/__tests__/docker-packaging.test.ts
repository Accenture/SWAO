// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../../');

// ---------------------------------------------------------------------------
// Dockerfile
// ---------------------------------------------------------------------------

describe('Dockerfile (#0123)', () => {
  const dockerfilePath = join(REPO_ROOT, 'Dockerfile');

  it('exists at repo root', () => {
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  it('uses node:22-alpine as base image', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('node:22-alpine');
  });

  it('is a multi-stage build with exactly two FROM lines', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    const fromLines = content.split('\n').filter(l => l.trimStart().startsWith('FROM '));
    expect(fromLines.length).toBe(2);
  });

  it('names stages builder and runtime', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('AS builder');
    expect(content).toContain('AS runtime');
  });

  it('sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 to suppress browser install', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1');
  });

  // #0610 rewrite: controls are staged into dist/_controls/ by the build:bundle script,
  // not via an explicit COPY instruction. The whole workspace is copied with `COPY . .`.
  it('copies entire workspace into builder (COPY . .)', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('COPY . .');
  });

  it('stages controls into dist via build:bundle script (#0610)', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('build:bundle');
  });

  it('sets ENTRYPOINT to node dist/bundle.cjs (#0610 bundle rewrite)', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('ENTRYPOINT');
    expect(content).toContain('dist/bundle.cjs');
  });

  it('sets runtime WORKDIR to /workspace', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('/workspace');
  });

  // #0610: runtime stage carries the full built workspace via COPY --from=builder;
  // no separate `npm install --omit=dev` because externals resolve from node_modules.
  it('runtime stage copies built workspace from builder (#0610)', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('COPY --from=builder /repo /repo');
  });

  it('builder stage compiles TypeScript via pnpm build (#0610)', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('pnpm');
    expect(content).toMatch(/run build/);
  });

  it('builder stage runs pnpm install --frozen-lockfile', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('pnpm install --frozen-lockfile');
  });
});

// ---------------------------------------------------------------------------
// .dockerignore
// ---------------------------------------------------------------------------

describe('.dockerignore (#0123)', () => {
  const ignorePath = join(REPO_ROOT, '.dockerignore');

  it('exists at repo root', () => {
    expect(existsSync(ignorePath)).toBe(true);
  });

  it('excludes node_modules', () => {
    const content = readFileSync(ignorePath, 'utf-8');
    expect(content).toMatch(/node_modules/);
  });

  it('excludes examples/ (large fixtures not needed at runtime)', () => {
    const content = readFileSync(ignorePath, 'utf-8');
    expect(content).toContain('examples/');
  });

  it('excludes .git/', () => {
    const content = readFileSync(ignorePath, 'utf-8');
    expect(content).toContain('.git');
  });

  it('does NOT exclude controls/ (runtime asset required by catalogue loaders)', () => {
    const content = readFileSync(ignorePath, 'utf-8');
    const excludeLines = content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    const blocksControls = excludeLines.some(
      l => l === 'controls/' || l === 'controls' || l === '/controls/'
    );
    expect(blocksControls).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scripts/build-image.sh
// ---------------------------------------------------------------------------

describe('scripts/build-image.sh (#0123)', () => {
  const scriptPath = join(REPO_ROOT, 'scripts', 'build-image.sh');

  it('exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('is a bash script', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toMatch(/^#!.*bash/);
  });

  it('calls docker build', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('docker build');
  });

  it('targets accenture/swao:dev by default', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('accenture/swao:dev');
  });
});

// ---------------------------------------------------------------------------
// README.md Docker section
// ---------------------------------------------------------------------------

describe('README.md (#0123)', () => {
  it('contains a Docker quick-start section', () => {
    const readmePath = join(REPO_ROOT, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');
    expect(content).toMatch(/docker/i);
  });
});
