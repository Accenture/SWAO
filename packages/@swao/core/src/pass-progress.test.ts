// #4266: progress of synchronous pass work and the time throttle of swao assess.

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgressThrottle, createRunHeartbeat, reportPassProgress, setPassProgressSink, yieldPassProgress, type PassProgress } from './pass-progress.js';
import { SourceScope, listInputFiles } from './source-scope.js';
import { computeLanguageCensus } from './language-census.js';

const tmp = mkdtempSync(join(tmpdir(), 'swao-pass-progress-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => setPassProgressSink(null));

function tree(root: string, dirs: number, filesPerDir: number): void {
  for (let d = 0; d < dirs; d++) {
    const dir = join(root, `pkg${d}`, 'src');
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < filesPerDir; f++) writeFileSync(join(dir, `m${f}.ts`), 'export const a = 1;\n\nexport const b = 2;\n');
  }
}

describe('createProgressThrottle (#4266)', () => {
  it('writes when the gap since the last beat has passed, and a heartbeat beat resets it', () => {
    let t = 0;
    const written: PassProgress[] = [];
    const th = createProgressThrottle(20_000, (p) => written.push(p), () => t);
    t = 19_999; th.sink({ phase: 'a' });
    expect(written).toHaveLength(0);
    t = 20_000; th.sink({ phase: 'b' });
    t = 30_000; th.sink({ phase: 'c' });
    expect(written.map((p) => p.phase)).toEqual(['b']);
    t = 35_000; th.beat();
    t = 50_000; th.sink({ phase: 'd' });
    expect(written).toHaveLength(1);
    t = 55_000; th.sink({ phase: 'e' });
    expect(written.map((p) => p.phase)).toEqual(['b', 'e']);
  });

  it('is a no-op without a sink and swallows a failing sink', async () => {
    expect(() => reportPassProgress({ phase: 'x' })).not.toThrow();
    setPassProgressSink(() => { throw new Error('boom'); });
    expect(() => reportPassProgress({ phase: 'x' })).not.toThrow();
    await expect(yieldPassProgress({ phase: 'y' })).resolves.toBeUndefined();
  });

  it('yieldPassProgress lets a due timer fire between synchronous steps', async () => {
    let fired = false;
    const timer = setTimeout(() => { fired = true; }, 0);
    const until = Date.now() + 5; while (Date.now() < until) { /* synchronous work */ }
    await yieldPassProgress({ phase: 'step' });
    clearTimeout(timer);
    expect(fired).toBe(true);
  });
});

describe('createRunHeartbeat (#4300)', () => {
  it('the sink writes the overdue heartbeat inside synchronous work and a progress line every 20 s', () => {
    let t = 0;
    const lines: string[] = [];
    const hb = createRunHeartbeat({
      intervalMs: 30_000, progressGapMs: 20_000, now: () => t,
      heartbeat: () => lines.push(`hb@${t}`),
      progress: (p) => lines.push(`${p.phase}@${t}`),
    });
    hb.sink({ phase: 'before-start' });
    hb.start();
    t = 19_000; hb.sink({ phase: 'a' });
    t = 20_000; hb.sink({ phase: 'b' });
    t = 30_000; hb.sink({ phase: 'c' });
    t = 40_000; hb.sink({ phase: 'd' });
    t = 61_000; hb.sink({ phase: 'e' });
    hb.stop();
    t = 200_000; hb.sink({ phase: 'after-stop' });
    expect(lines).toEqual(['b@20000', 'hb@30000', 'hb@61000', 'e@61000']);
  });

  it('the timer writes a heartbeat every interval while the event loop is free, re-armed after a sink heartbeat', async () => {
    vi.useFakeTimers();
    try {
      const beats: number[] = [];
      const hb = createRunHeartbeat({ intervalMs: 30_000, progressGapMs: 20_000, heartbeat: () => beats.push(Date.now()), progress: () => {} });
      const t0 = Date.now();
      hb.start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(beats.map((b) => b - t0)).toEqual([30_000]);
      // Synchronous work that blocks the timer: the clock passes 31 s, then the sink runs.
      vi.setSystemTime(t0 + 61_000);
      hb.sink({ phase: 'census' });
      expect(beats.map((b) => b - t0)).toEqual([30_000, 61_000]);
      // The timer is re-armed from the sink heartbeat: next one 30 s later, not earlier.
      await vi.advanceTimersByTimeAsync(29_000);
      expect(beats).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(beats.map((b) => b - t0)).toEqual([30_000, 61_000, 91_000]);
      hb.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(beats).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a synthetic 1000-file census finishes within budget and leaves no gap over 20 s of simulated time', () => {
    const root = join(tmp, 'census-1000');
    tree(root, 10, 100);
    let t = 0;
    const lines: Array<{ kind: string; at: number }> = [];
    const hb = createRunHeartbeat({
      intervalMs: 30_000, progressGapMs: 20_000, now: () => t,
      heartbeat: () => lines.push({ kind: 'heartbeat', at: t }),
      progress: (p) => lines.push({ kind: p.phase, at: t }),
    });
    hb.start();
    // Simulated slow file system: every reported file costs one second.
    setPassProgressSink((p) => { if (p.phase === 'language_census') t += 1_000; hb.sink(p); });
    const started = Date.now();
    const census = computeLanguageCensus(root);
    const wallMs = Date.now() - started;
    hb.stop();
    expect(census.total_files).toBe(1000);
    expect(wallMs).toBeLessThan(15_000);
    const census_lines = lines.filter((l) => l.kind === 'language_census');
    // 1000 simulated seconds: a progress line 20 s after each heartbeat, a heartbeat every 30 s.
    expect(census_lines.length).toBeGreaterThanOrEqual(30);
    const at = [0, ...lines.map((l) => l.at)];
    const gaps = at.slice(1).map((v, i) => v - (at[i] as number));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(20_000);
    expect(lines.filter((l) => l.kind === 'heartbeat').length).toBeGreaterThanOrEqual(30);
  }, 60_000);
});

describe('progress from the source walk, the census and the input walk (#4266)', () => {
  const root = join(tmp, 'src-tree');
  tree(root, 3, 200);

  it('the source walk and the census report counts, never paths', () => {
    const seen: PassProgress[] = [];
    setPassProgressSink((p) => seen.push(p));
    const scope = new SourceScope(root);
    computeLanguageCensus(root);
    const walk = seen.filter((p) => p.phase === 'source_walk');
    expect(walk.length).toBeGreaterThan(3);
    expect(Math.max(...walk.map((p) => p.dirs ?? 0))).toBe(7); // root + 3 x (pkgN, src)
    expect(seen.some((p) => p.phase === 'language_census' && (p.files ?? 0) >= 128)).toBe(true);
    for (const p of seen) expect(Object.keys(p).sort()).toEqual(expect.arrayContaining(['phase']));
    for (const p of seen) expect(JSON.stringify(p)).not.toMatch(/pkg0|src-tree/);
    expect(scope.walkStats()).toEqual({ files_scanned: 600, dirs_scanned: 7, bytes_scanned: 600 * 'export const a = 1;\n\nexport const b = 2;\n'.length });
  });

  it('listInputFiles reports progress and skips a directory by its relative path', () => {
    const inputs = join(tmp, 'inputs');
    mkdirSync(join(inputs, 'repo', 'clone', 'docs'), { recursive: true });
    mkdirSync(join(inputs, 'repo', 'other'), { recursive: true });
    writeFileSync(join(inputs, 'repo', 'clone', 'docs', 'a.md'), '# a\n');
    writeFileSync(join(inputs, 'repo', 'other', 'b.md'), '# b\n');
    const seen: PassProgress[] = [];
    setPassProgressSink((p) => seen.push(p));
    const rels = listInputFiles(inputs, { skipRelDirs: ['repo/clone/'] }).map((f) => f.rel);
    expect(rels).toEqual(['repo/other/b.md']);
    expect(seen.some((p) => p.phase === 'input_walk')).toBe(true);
  });
});
