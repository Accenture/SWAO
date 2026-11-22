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

// #4479: the LLM Assessment running stage reads only the bytes a leg log
// gained since the last poll, never the whole growing file.

import { describe, it, expect, afterEach } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLegLogPoller } from './legLogPoller.js';

const NL = String.fromCharCode(10);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function leg(): { ws: string; log: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-leg-poll-'));
  dirs.push(ws);
  const logs = join(ws, 'apps', 'app-a', 'wsp', 'logs');
  mkdirSync(logs, { recursive: true });
  return { ws, log: join(logs, 'app-events-2026-11.ndjson') };
}
const ev = (code: string, context: Record<string, unknown>): string => JSON.stringify({ ts: '2026-11-17T00:00:00.000Z', code, context }) + NL;

describe('createLegLogPoller (#4479)', () => {
  it('returns each event once, in order, and keeps a partial last line for the next poll', () => {
    const { ws, log } = leg();
    const p = createLegLogPoller('app-a');
    expect(p.poll(null)).toEqual({ lines: [], passesDone: null });
    expect(p.poll(ws).lines).toEqual([]); // no file yet
    writeFileSync(log, ev('assessment.pass.start', { num: '01', name: 'inventory' }));
    expect(p.poll(ws).lines).toEqual(['  pass 01: inventory starting']);
    expect(p.poll(ws).lines).toEqual([]);
    const done = ev('assessment.pass.complete', { num: '01', name: 'inventory', wall_clock_ms: 2000 });
    appendFileSync(log, done.slice(0, 20));
    expect(p.poll(ws).lines).toEqual([]); // half a line: nothing yet
    appendFileSync(log, done.slice(20));
    const r = p.poll(ws);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain('pass 01: inventory complete');
    expect(r.passesDone).toBe(1);
  });

  it('reads from the byte offset: bytes already read are not read again', () => {
    const { ws, log } = leg();
    const p = createLegLogPoller('app-a');
    const first = ev('assessment.pass.start', { num: '01', name: 'inventory' });
    writeFileSync(log, first);
    expect(p.poll(ws).lines).toHaveLength(1);
    // Overwrite the bytes already read with another event of the same length: a whole-file re-read would see it.
    const other = ev('assessment.pass.start', { num: '02', name: 'inventory' });
    expect(other.length).toBe(first.length);
    const fd = openSync(log, 'r+');
    writeSync(fd, other, 0);
    closeSync(fd);
    appendFileSync(log, ev('assessment.pass.start', { num: '03', name: 'data' }));
    expect(p.poll(ws).lines).toEqual(['  pass 03: data starting']);
  });

  it('a new leg workspace starts a new tailer and a new pass count', () => {
    const a = leg();
    const b = leg();
    const p = createLegLogPoller('app-a');
    writeFileSync(a.log, ev('assessment.pass.complete', { num: '01', name: 'inventory', wall_clock_ms: 1000 }));
    expect(p.poll(a.ws).passesDone).toBe(1);
    writeFileSync(b.log, ev('assessment.pass.start', { num: '01', name: 'inventory' }));
    const r = p.poll(b.ws);
    expect(r.lines).toEqual(['  pass 01: inventory starting']);
    expect(r.passesDone).toBe(0);
  });
});
