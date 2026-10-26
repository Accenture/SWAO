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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runIamPass } from './pass-21-iam.js';
import type { PassContext } from '@swao/core';

let tmp: string;
let src: string;

function makeCtx(): PassContext {
  return {
    workspacePath: tmp,
    sourcePath: src,
    appId: 'test-app',
    iter: 1,
    assessedAt: '2026-01-01',
  } as PassContext;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-pass21-'));
  src = join(tmp, 'src');
  mkdirSync(src, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('pass-21-iam -- catalogue availability', () => {
  it('returns complete pass result with informational signal when no catalogue', async () => {
    const result = await runIamPass(makeCtx());
    expect(result.pass.id).toBe(21);
    expect(result.pass.status).toBe('complete');
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('exposes catalogue_available in assessment output', async () => {
    const result = await runIamPass(makeCtx());
    const assessment = result.assessment as Record<string, unknown>;
    expect('catalogue_available' in assessment).toBe(true);
  });
});

describe('pass-21-iam -- BundID detection (#3062)', () => {
  it('emits positive IAM signal when BundID import token detected', async () => {
    // BundID catalogue entry: detection.imports includes "bund.id", "id.bund.de"
    writeFileSync(
      join(src, 'identity.ts'),
      `import { BundIdClient } from 'bund.id';\nconst client = new BundIdClient({ clientId: process.env.BUNDID_CLIENT_ID });`,
      'utf-8',
    );
    const result = await runIamPass(makeCtx());
    const assessment = result.assessment as Record<string, unknown>;
    if (assessment['catalogue_available'] === false) {
      // No catalogue in this environment -- skip finding-level check
      expect(result.pass.status).toBe('complete');
      return;
    }
    const bundIdSignal = result.signals.find(
      (s) => s.derivation.includes('BundID') || s.derivation.includes('bundid'),
    );
    expect(bundIdSignal).toBeDefined();
    expect(bundIdSignal!.severity).toBe('positive');
  });

  it('emits IAM signal when BundID env var detected in .env.example', async () => {
    writeFileSync(
      join(src, '.env.example'),
      'BUNDID_CLIENT_ID=your-client-id\nBUNDID_SECRET=your-secret\n',
      'utf-8',
    );
    const result = await runIamPass(makeCtx());
    const assessment = result.assessment as Record<string, unknown>;
    if (assessment['catalogue_available'] === false) return;
    const hasIamSignal = result.signals.some((s) => s.id.startsWith('IAM-'));
    expect(hasIamSignal).toBe(true);
  });
});

describe('pass-21-iam -- ELSTER-NEZO detection (#3062)', () => {
  it('emits IAM signal when ELSTER ERiC import detected', async () => {
    writeFileSync(
      join(src, 'tax.ts'),
      `import { ERiC } from 'elster-nezo';\n// ELSTER ERiC integration\nconst ericLib = new ERiC();`,
      'utf-8',
    );
    const result = await runIamPass(makeCtx());
    const assessment = result.assessment as Record<string, unknown>;
    if (assessment['catalogue_available'] === false) return;
    const elsterSignal = result.signals.find(
      (s) => s.derivation.includes('ELSTER') || s.derivation.includes('elster'),
    );
    expect(elsterSignal).toBeDefined();
  });
});

describe('pass-21-iam -- informational path', () => {
  it('emits informational signal when no providers detected in source', async () => {
    // Empty source dir -- no IAM tokens found
    const result = await runIamPass(makeCtx());
    const assessment = result.assessment as Record<string, unknown>;
    if (assessment['catalogue_available'] === false) {
      expect(result.signals[0].id).toBe('IAM-01');
      return;
    }
    const detected = assessment['providers_detected'] as string[];
    if (detected.length === 0) {
      expect(result.signals[0].severity).toBe('informational');
    }
  });

  it('signal evidence references matched source files', async () => {
    writeFileSync(
      join(src, 'auth.ts'),
      `const keycloakConfig = { url: process.env.KEYCLOAK_URL };`,
      'utf-8',
    );
    const result = await runIamPass(makeCtx());
    const assessment = result.assessment as Record<string, unknown>;
    if (assessment['catalogue_available'] === false) return;
    const detected = assessment['providers_detected'] as string[];
    if (detected.length > 0) {
      const signalWithEvidence = result.signals.find((s) => s.evidence.length > 0);
      expect(signalWithEvidence).toBeDefined();
    }
  });
});

describe('pass-21-iam -- #3410 shared catalogue matcher', () => {
  it('generic / numeric code does not detect ELSTER (eric inside a word)', async () => {
    writeFileSync(
      join(src, 'util.ts'),
      `export function generic<T>(numeric: number): T[] { return []; }\nconst americanFormat = true;\n`,
      'utf-8',
    );
    const result = await runIamPass(makeCtx());
    expect(result.assessment['catalogue_available']).toBe(true);
    expect(result.assessment['providers_detected'] as string[]).not.toContain('elster-nezo');
  });

  it('segment matching still detects a provider inside a camelCase identifier', async () => {
    writeFileSync(join(src, 'auth.service.ts'), `export class KeycloakAuthService {}\n`, 'utf-8');
    const result = await runIamPass(makeCtx());
    expect(result.assessment['providers_detected'] as string[]).toContain('keycloak');
  });

  it('an env-var hit names the catalogue pattern, never the value from the env file', async () => {
    writeFileSync(join(src, '.env.example'), 'BUNDID_CLIENT_SECRET=s3cr3t-value-123\n', 'utf-8');
    const result = await runIamPass(makeCtx());
    const sig = result.signals.find((s) => s.derivation.includes('BundID'));
    expect(sig).toBeDefined();
    expect(sig!.derivation).toContain('BUNDID_.*');
    expect(sig!.derivation).not.toContain('s3cr3t');
  });
});

describe('pass-21-iam -- #3411 all hits with production/test split', () => {
  it('cites the production file first with line numbers and counts every occurrence', async () => {
    mkdirSync(join(src, 'test'), { recursive: true });
    mkdirSync(join(src, 'zz'), { recursive: true });
    writeFileSync(join(src, 'test', 'auth.mock.ts'), `const keycloak = mockKeycloak();\nkeycloak.init();\n`, 'utf-8');
    writeFileSync(join(src, 'test', 'login.ts'), `import Keycloak from 'keycloak-js';\n`, 'utf-8');
    writeFileSync(join(src, 'zz', 'auth.ts'), `\nimport Keycloak from 'keycloak-js';\n`, 'utf-8');
    const result = await runIamPass(makeCtx());
    const sig = result.signals.find((s) => s.derivation.includes('Keycloak'))!;
    expect(sig.evidence[0]).toBe('zz/auth.ts:2');
    expect(sig.evidence).toEqual(expect.arrayContaining(['test/auth.mock.ts:1', 'test/auth.mock.ts:2', 'test/login.ts:1']));
    expect(sig.derivation).toContain('4 occurrences (1 production, 3 test)');
    const hits = (result.assessment['hits'] as Record<string, { total: number; production: number; test: number }>)['keycloak'];
    expect(hits).toMatchObject({ total: 4, production: 1, test: 3 });
  });

  it('a provider referenced only from test code keeps its severity with low confidence (down-weighting is #3403 tag mode)', async () => {
    mkdirSync(join(src, '__mocks__'), { recursive: true });
    writeFileSync(join(src, '__mocks__', 'keycloak-js.ts'), `export default class Keycloak {}\n`, 'utf-8');
    const result = await runIamPass(makeCtx());
    const sig = result.signals.find((s) => s.derivation.includes('Keycloak'))!;
    expect(sig.severity).toBe('low'); // Keycloak: eu_sovereign, no eIDAS level
    expect(sig.confidence).toBe('low');
    expect(sig.derivation).toContain('Referenced from test code only');
  });
});
