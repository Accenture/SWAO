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
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT  = resolve(__dirname, '../../../../');
const CHART_DIR  = join(REPO_ROOT, 'ops/helm/swao');
const SCRIPTS    = join(REPO_ROOT, 'scripts');

const hasHelm = spawnSync('helm', ['version', '--short'], { encoding: 'utf-8' }).status === 0;

// -- Chart file presence --------------------------------------------------

describe('Helm chart file presence', () => {
  it('Chart.yaml exists', () => {
    expect(existsSync(join(CHART_DIR, 'Chart.yaml'))).toBe(true);
  });

  it('values.yaml exists', () => {
    expect(existsSync(join(CHART_DIR, 'values.yaml'))).toBe(true);
  });

  it('templates/job.yaml exists', () => {
    expect(existsSync(join(CHART_DIR, 'templates/job.yaml'))).toBe(true);
  });

  it('templates/_helpers.tpl exists', () => {
    expect(existsSync(join(CHART_DIR, 'templates/_helpers.tpl'))).toBe(true);
  });

  it('templates/NOTES.txt exists', () => {
    expect(existsSync(join(CHART_DIR, 'templates/NOTES.txt'))).toBe(true);
  });

  it('scripts/helm-lint.sh exists', () => {
    expect(existsSync(join(SCRIPTS, 'helm-lint.sh'))).toBe(true);
  });
});

// -- Chart.yaml content ---------------------------------------------------

describe('Chart.yaml content', () => {
  const chart = readFileSync(join(CHART_DIR, 'Chart.yaml'), 'utf-8');

  it('apiVersion is v2', () => {
    expect(chart).toMatch(/^apiVersion:\s*v2/m);
  });

  it('name is swao', () => {
    expect(chart).toMatch(/^name:\s*swao/m);
  });

  it('has a version field', () => {
    expect(chart).toMatch(/^version:\s*\d+\.\d+\.\d+/m);
  });

  it('has an appVersion field', () => {
    expect(chart).toMatch(/^appVersion:/m);
  });

  it('type is application', () => {
    expect(chart).toMatch(/^type:\s*application/m);
  });
});

// -- values.yaml content --------------------------------------------------

describe('values.yaml content', () => {
  const values = readFileSync(join(CHART_DIR, 'values.yaml'), 'utf-8');

  it('has image.repository defaulting to accenture/swao', () => {
    expect(values).toContain('repository: accenture/swao');
  });

  it('has image.tag field', () => {
    expect(values).toMatch(/tag:\s*\S+/);
  });

  it('has app.id field (empty default -- required at deploy time)', () => {
    expect(values).toMatch(/id:\s*"?"/);
  });

  it('has app.workspacePvcName field', () => {
    expect(values).toContain('workspacePvcName');
  });

  it('has credentials map for SWAO_CREDENTIAL_* env vars', () => {
    expect(values).toContain('credentials:');
  });
});

// -- job.yaml template content --------------------------------------------

describe('templates/job.yaml content', () => {
  const job = readFileSync(join(CHART_DIR, 'templates/job.yaml'), 'utf-8');

  it('is a Kubernetes Job', () => {
    expect(job).toMatch(/kind:\s*Job/);
  });

  it('restartPolicy is Never', () => {
    expect(job).toContain('restartPolicy: Never');
  });

  it('references the swao image from values', () => {
    expect(job).toContain('.Values.image.repository');
    expect(job).toContain('.Values.image.tag');
  });

  it('runs swao assess --app with the app.id value', () => {
    expect(job).toContain('swao');
    expect(job).toContain('assess');
    expect(job).toContain('.Values.app.id');
  });

  it('mounts workspace PVC at /workspace', () => {
    expect(job).toContain('/workspace');
    expect(job).toContain('.Values.app.workspacePvcName');
  });

  it('requires app.id (uses required helper)', () => {
    expect(job).toContain('required');
  });
});

// -- helm lint (skipped when helm not installed) --------------------------

describe('helm lint', () => {
  it.skipIf(!hasHelm)('helm lint exits 0', () => {
    const result = spawnSync('helm', ['lint', CHART_DIR], { encoding: 'utf-8' });
    if (result.status !== 0) {
      console.error('[helm lint stdout]', result.stdout);
      console.error('[helm lint stderr]', result.stderr);
    }
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasHelm)('helm template renders a valid Job with app.id=medplum', () => {
    const result = spawnSync(
      'helm', ['template', 'swao', CHART_DIR, '--set', 'app.id=medplum'],
      { encoding: 'utf-8' }
    );
    if (result.status !== 0) {
      console.error('[helm template stdout]', result.stdout);
      console.error('[helm template stderr]', result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kind: Job');
    expect(result.stdout).toContain('medplum');
    expect(result.stdout).toContain('restartPolicy: Never');
  });
});
