// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4479: the call records of a leg sink are counted from the bytes added
// since the last count, not by re-reading the whole sink on every tick.

import { describe, it, expect, afterEach } from 'vitest';
import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sinkLineCount } from './orchestrator.js';

const NL = String.fromCharCode(10);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function sink(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-sink-count-'));
  dirs.push(d);
  return join(d, 'leg-1.ndjson');
}

describe('sinkLineCount (#4479)', () => {
  it('counts non-empty lines as before, a partial last line included', () => {
    const p = sink();
    expect(sinkLineCount(p)).toBe(0);
    writeFileSync(p, `{"a":1}${NL}${NL}{"a":2}${NL}`);
    expect(sinkLineCount(p)).toBe(2);
    appendFileSync(p, '{"a":');
    expect(sinkLineCount(p)).toBe(3);
    appendFileSync(p, `3}${NL}{"a":4}${NL}`);
    expect(sinkLineCount(p)).toBe(4);
  });

  it('reads only the new bytes: bytes already counted are not read again', () => {
    const p = sink();
    writeFileSync(p, `{"a":1}${NL}`);
    expect(sinkLineCount(p)).toBe(1);
    // Overwrite the counted bytes with two lines of the same total length: a re-read would count 2.
    const fd = openSync(p, 'r+');
    writeSync(fd, `{}${NL}{"}${NL}`, 0);
    closeSync(fd);
    expect(sinkLineCount(p)).toBe(1);
    appendFileSync(p, `{"a":2}${NL}`);
    expect(sinkLineCount(p)).toBe(2);
  });

  it('a sink that shrank is counted again from the start', () => {
    const p = sink();
    writeFileSync(p, `{"a":1}${NL}{"a":2}${NL}{"a":3}${NL}`);
    expect(sinkLineCount(p)).toBe(3);
    writeFileSync(p, `{"b":1}${NL}`);
    expect(sinkLineCount(p)).toBe(1);
    rmSync(p);
    expect(sinkLineCount(p)).toBe(0);
  });
});
