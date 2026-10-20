// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// checkSourceAccessibility skips service apps (ADR-0064): they have no source code by design.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSourceAccessibility } from './health-check.js';

const ws = mkdtempSync(join(tmpdir(), 'swao-srcacc-'));
afterAll(() => rmSync(ws, { recursive: true, force: true }));

describe('checkSourceAccessibility in a mixed workspace', () => {
  it('warns for an application app without a source but not for a service app', () => {
    mkdirSync(join(ws, 'apps', 'app-without-source'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'app-without-source', '.swao.yml'), 'app_id: app-without-source\n');
    mkdirSync(join(ws, 'apps', 'hosapp001'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'hosapp001', '.swao.yml'), 'app_id: hosapp001\nassessment:\n  type: service\n');
    const warnings = checkSourceAccessibility(ws);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/apps\/app-without-source/);
  });
});
