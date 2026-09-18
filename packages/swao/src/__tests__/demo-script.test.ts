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
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '../../../../');
const DEMO_SH    = join(REPO_ROOT, 'scripts', 'demo.sh');
const DOCKER_SH  = join(REPO_ROOT, 'scripts', 'demo-docker.sh');

// ---------------------------------------------------------------------------
// demo.sh -- artefact checks
// ---------------------------------------------------------------------------

describe('scripts/demo.sh (#0125)', () => {
  it('exists', () => {
    expect(existsSync(DEMO_SH)).toBe(true);
  });

  it('is a bash script', () => {
    expect(readFileSync(DEMO_SH, 'utf-8')).toMatch(/^#!.*bash/);
  });

  it('sets SWAO_LLM_PROVIDER (#0473: stub deleted; demo uses real provider)', () => {
    expect(readFileSync(DEMO_SH, 'utf-8')).toContain('SWAO_LLM_PROVIDER');
  });

  it('runs swao assess against sovereign-health', () => {
    const c = readFileSync(DEMO_SH, 'utf-8');
    expect(c).toContain('assess');
    expect(c).toContain('sovereign-health');
  });

  it('runs swao report', () => {
    expect(readFileSync(DEMO_SH, 'utf-8')).toContain('report');
  });

  it('captures elapsed time and compares to threshold', () => {
    const c = readFileSync(DEMO_SH, 'utf-8');
    expect(c).toContain('ELAPSED');
    expect(c).toContain('TIMEOUT');
  });

  it('respects SWAO_DEMO_TIMEOUT_SECS env var', () => {
    const c = readFileSync(DEMO_SH, 'utf-8');
    expect(c).toContain('SWAO_DEMO_TIMEOUT_SECS');
  });

  it('exits 1 when threshold is exceeded', () => {
    const c = readFileSync(DEMO_SH, 'utf-8');
    expect(c).toContain('exit 1');
  });
});

// ---------------------------------------------------------------------------
// demo-docker.sh -- artefact checks
// ---------------------------------------------------------------------------

describe('scripts/demo-docker.sh (#0125)', () => {
  it('exists', () => {
    expect(existsSync(DOCKER_SH)).toBe(true);
  });

  it('is a bash script', () => {
    expect(readFileSync(DOCKER_SH, 'utf-8')).toMatch(/^#!.*bash/);
  });

  it('references the accenture/swao:dev image', () => {
    expect(readFileSync(DOCKER_SH, 'utf-8')).toContain('accenture/swao:dev');
  });

  it('documents the #0123 Docker dependency', () => {
    expect(readFileSync(DOCKER_SH, 'utf-8')).toContain('#0123');
  });

  it('exits with error when Docker image is not found', () => {
    expect(readFileSync(DOCKER_SH, 'utf-8')).toContain('exit 1');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: demo.sh actually runs under threshold
// ---------------------------------------------------------------------------

const hasAnthropicKey = Boolean(process.env['SWAO_CREDENTIAL_ANTHROPIC_API_KEY']);

describe('demo.sh end-to-end (#0125)', () => {
  it.skipIf(!hasAnthropicKey)('completes sovereign-health run in < 60 seconds', () => {
    // M18 #0271 followup: sandbox HOME so the demo doesn't load the
    // developer's rotated-secret licence under the test signing secret
    // (would crash with LicenseInvalidError). Same pattern as
    // binary-e2e.test.ts.
    // Skipped when SWAO_CREDENTIAL_ANTHROPIC_API_KEY is not set (#0617).
    const sandboxHome = mkdtempSync(join(tmpdir(), 'swao-demo-home-'));
    try {
      const start = Date.now();
      execSync(`bash "${DEMO_SH}"`, {
        env: {
          ...process.env,
          SWAO_DEMO_TIMEOUT_SECS: '60',
          SWAO_LLM_PROVIDER: 'anthropic',
          HOME:        sandboxHome,
          USERPROFILE: sandboxHome,
          HOMEDRIVE:   '',
          HOMEPATH:    '',
        },
        stdio: 'pipe',
      });
      const elapsed = (Date.now() - start) / 1000;
      expect(elapsed).toBeLessThan(60);
    } finally {
      rmSync(sandboxHome, { recursive: true, force: true });
    }
  }, 90_000);
});
