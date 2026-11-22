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

// #4266: Pass 01 reports progress per phase and from inside the source walk,
// so `swao assess` can write assessment.pass.progress while the pass runs;
// the document scan does not walk a source clone configured under wsp/inputs/.

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setPassProgressSink, type PassContext, type PassProgress } from '@swao/core';
import { runInvPass } from './pass-01-inv.js';

const tmp = mkdtempSync(join(tmpdir(), 'swao-inv-progress-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => setPassProgressSink(null));

const ctxFor = (ws: string, sourcePath: string): PassContext => ({
  appId: 'demo', iter: 1, assessedAt: '2026-11-10', llm: undefined as unknown as PassContext['llm'],
  sourcePath, workspacePath: ws, passesDir: join(ws, 'wsp', 'runs', 'r', 'passes'),
});

describe('Pass 01 progress (#4266)', () => {
  it('reports the source walk, the census and every inventory phase in order', async () => {
    const ws = join(tmp, 'app1');
    const src = join(ws, 'wsp', 'inputs', 'source');
    mkdirSync(join(src, 'src'), { recursive: true });
    writeFileSync(join(src, 'package.json'), '{"name":"demo","dependencies":{"express":"^4.0.0"}}\n');
    for (let i = 0; i < 300; i++) writeFileSync(join(src, 'src', `m${i}.js`), `module.exports = ${i};\n`);
    const seen: PassProgress[] = [];
    setPassProgressSink((p) => seen.push(p));
    await runInvPass(ctxFor(ws, src));
    const phases = [...new Set(seen.map((p) => p.phase))];
    expect(phases).toEqual(expect.arrayContaining(['source_walk', 'language_census']));
    // The phase boundaries, in order; the file loops inside a phase report too (dependency inventory, 64+ files).
    const boundaries = ['inventory:language_census', 'inventory:iac_state', 'inventory:reference_scans', 'inventory:service_footprint'];
    expect(phases.filter((p) => boundaries.includes(p))).toEqual(boundaries);
    expect(phases).toContain('inventory:dependency_inventory');
  });

  it('the document scan of wsp/inputs/ skips a source clone configured there', async () => {
    const ws = join(tmp, 'app2');
    const clone = join(ws, 'wsp', 'inputs', 'repo');
    mkdirSync(join(clone, 'docs'), { recursive: true });
    mkdirSync(join(ws, 'wsp', 'inputs', 'docs'), { recursive: true });
    writeFileSync(join(ws, '.swao.yml'), 'app_id: demo\nsource:\n  path: wsp/inputs/repo/\n  vcs:\n    subdir: docs\n');
    writeFileSync(join(clone, 'docs', 'readme.md'), '# Service\n');
    mkdirSync(join(clone, 'other'), { recursive: true });
    writeFileSync(join(clone, 'other', 'notes.md'), '# Other part of the monorepo\n');
    writeFileSync(join(ws, 'wsp', 'inputs', 'docs', 'architecture.md'), '# Architecture\n');
    const seen: PassProgress[] = [];
    setPassProgressSink((p) => seen.push(p));
    const r = await runInvPass(ctxFor(ws, join(clone, 'docs')));
    const footprint = r.assessment['service_footprint'] as { files_scanned: { docs: number } };
    // docs/readme.md through the source scope plus wsp/inputs/docs/architecture.md; not repo/other/notes.md.
    expect(footprint.files_scanned.docs).toBe(2);
  });
});
