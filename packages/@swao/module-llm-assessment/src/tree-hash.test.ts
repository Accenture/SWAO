// #4243: hashTree (async, prunable) yields the same digest as hashDirectory.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashTree, TREE_HASH_PROGRESS_EVERY_MS, type TreeHashProgress } from './tree-hash.js';
import { hashDirectory, EMPTY_TREE_HASH } from './llm-run-manifest.js';

const tmp = mkdtempSync(join(tmpdir(), 'swao-tree-hash-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('hashTree (#4243)', () => {
  it('matches hashDirectory for the same tree', async () => {
    const d = join(tmp, 'a');
    mkdirSync(join(d, 'sub', 'deep'), { recursive: true });
    mkdirSync(join(d, '.git'), { recursive: true });
    writeFileSync(join(d, 'b.txt'), 'bee', 'utf-8');
    writeFileSync(join(d, 'A.txt'), 'ay', 'utf-8');
    writeFileSync(join(d, 'sub', 'deep', 'c.ts'), 'see', 'utf-8');
    writeFileSync(join(d, '.git', 'HEAD'), 'ref', 'utf-8');
    const r = await hashTree(d);
    expect(r.hash).toBe(hashDirectory(d));
    expect(r.files).toBe(3);
    expect(r.bytes).toBe(8);
  });

  it('prunes a directory without reading it', async () => {
    const d = join(tmp, 'b');
    mkdirSync(join(d, 'source', 'big'), { recursive: true });
    writeFileSync(join(d, 'ctx.md'), 'ctx', 'utf-8');
    writeFileSync(join(d, 'source', 'big', 'x.ts'), 'x', 'utf-8');
    const pruned = await hashTree(d, { pruneDir: (rel) => rel === 'source' });
    expect(pruned.files).toBe(1);
    expect(pruned.hash).toBe(hashDirectory(d, (rel) => rel.startsWith('source/')));
  });

  it('returns EMPTY_TREE_HASH for a missing tree', async () => {
    expect((await hashTree(join(tmp, 'nope'))).hash).toBe(EMPTY_TREE_HASH);
  });
});

// #4404: the run preparation hashed 988 files in 183 s with no line in between.
describe('hashTree progress and parallel reads (#4404)', () => {
  const many = (name: string, n: number): string => {
    const d = join(tmp, name);
    mkdirSync(join(d, 'src', 'nested'), { recursive: true });
    for (let i = 0; i < n; i++) writeFileSync(join(d, i % 3 === 0 ? 'src' : join('src', 'nested'), `f${String(i).padStart(3, '0')}.ts`), `export const v${i} = ${i};\n`, 'utf-8');
    return d;
  };

  it('reports listing and reading progress at most once per interval (injected clock)', async () => {
    const d = many('progress', 30);
    let clock = 0;
    const seen: TreeHashProgress[] = [];
    // Every clock read advances 4 s; the interval is 15 s.
    const r = await hashTree(d, { now: () => (clock += 4_000), onProgress: (p) => seen.push(p) });
    expect(r.files).toBe(30);
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.some((p) => p.phase === 'list' && p.total_files === null)).toBe(true);
    const reads = seen.filter((p) => p.phase === 'read');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((p) => p.total_files === 30 && p.bytes > 0)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.elapsed_ms - seen[i - 1]!.elapsed_ms).toBeGreaterThanOrEqual(TREE_HASH_PROGRESS_EVERY_MS);
    // Files and bytes only grow while reading.
    for (let i = 1; i < reads.length; i++) expect(reads[i]!.files).toBeGreaterThan(reads[i - 1]!.files);
  });

  it('parallel reads give the same digest as one read at a time and as hashDirectory', async () => {
    const d = many('parallel', 50);
    const one = await hashTree(d, { concurrency: 1 });
    const eight = await hashTree(d, { concurrency: 8 });
    expect(eight).toEqual(one);
    expect(eight.hash).toBe(hashDirectory(d));
  });

  it('no progress callback below the interval (a fast hash stays silent)', async () => {
    const d = many('fast', 5);
    const seen: TreeHashProgress[] = [];
    await hashTree(d, { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([]);
  });
});
