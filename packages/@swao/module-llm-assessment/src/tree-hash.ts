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

// #4243: asynchronous twin of hashDirectory (llm-run-manifest.ts) for the
// run preparation. Same digest for the same tree (sorted names per level,
// dot-entries skipped, `<rel> NUL <bytes> NUL` per file), plus:
//   - `pruneDir(rel)` stops the walk at a directory (hashDirectory only
//     filtered after walking everything, so wsp/inputs/ read a whole
//     monorepo clone to hash the inputs);
//   - file and byte counts for the preparation events;
//   - it yields to the event loop per file, so the screen, the heartbeat
//     and Esc keep working while a large tree is hashed.

// #4404: the run preparation hashed 988 files (27 MB) in 183 s with no line in
// between. hashTree now reads up to `concurrency` files at a time (the digest
// is still built in sorted order), lists directories with their entry types
// instead of one stat per entry, and reports progress (`onProgress`, at most
// every `progressEveryMs`) for the run.prepare.progress events.

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_TREE_HASH } from './llm-run-manifest.js';

export interface TreeHashResult {
  hash: string;
  files: number;
  bytes: number;
}

/** #4404: progress of one hash: files listed, then files and bytes read. */
export interface TreeHashProgress {
  phase: 'list' | 'read';
  /** Files listed so far (list) or read so far (read). */
  files: number;
  /** Bytes read so far (0 while listing). */
  bytes: number;
  /** Files to read (known once the listing is done; null while listing). */
  total_files: number | null;
  elapsed_ms: number;
}

export interface TreeHashOptions {
  /** True stops the walk at this directory (rel with forward slashes). */
  pruneDir?: (rel: string) => boolean;
  signal?: AbortSignal;
  /** #4404: called at most every `progressEveryMs` (default 15 s) while the tree is listed and read. */
  onProgress?: (p: TreeHashProgress) => void;
  progressEveryMs?: number;
  /** #4404: files read at a time (default 8). The digest does not depend on it. */
  concurrency?: number;
  /** Clock (tests). */
  now?: () => number;
}

/** #4404: progress cadence of the run preparation, the same as leg.prepare.progress. */
export const TREE_HASH_PROGRESS_EVERY_MS = 15_000;
/** #4404: parallel reads; per-file open latency (endpoint protection) dominates, not bandwidth. */
export const TREE_HASH_CONCURRENCY = 8;

interface Walk {
  opts: TreeHashOptions;
  out: Array<{ abs: string; rel: string }>;
  tick: (phase: 'list' | 'read', files: number, bytes: number, total: number | null) => void;
}

async function collect(dir: string, rel: string, w: Walk): Promise<void> {
  if (w.opts.signal?.aborted) throw new Error('hash cancelled');
  const entries: Dirent[] = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = join(dir, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    // The entry type comes with the listing; only a link (or an unknown type)
    // needs a stat, which follows it as before (hashDirectory digest unchanged).
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (!isDir && !isFile) {
      const st = await stat(abs);
      isDir = st.isDirectory();
      isFile = st.isFile();
    }
    if (isDir) {
      if (w.opts.pruneDir?.(childRel)) continue;
      await collect(abs, childRel, w);
    } else if (isFile) {
      w.out.push({ abs, rel: childRel });
      w.tick('list', w.out.length, 0, null);
    }
  }
}

/** Content hash of `root` (EMPTY_TREE_HASH for a missing or empty tree). */
export async function hashTree(root: string, opts: TreeHashOptions = {}): Promise<TreeHashResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const every = opts.progressEveryMs ?? TREE_HASH_PROGRESS_EVERY_MS;
  let lastTick = started;
  const tick = (phase: 'list' | 'read', files: number, bytes: number, total: number | null): void => {
    if (!opts.onProgress) return;
    const t = now();
    if (t - lastTick < every) return;
    lastTick = t;
    opts.onProgress({ phase, files, bytes, total_files: total, elapsed_ms: t - started });
  };
  const entries: Array<{ abs: string; rel: string }> = [];
  try {
    await collect(root, '', { opts, out: entries, tick });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return { hash: EMPTY_TREE_HASH, files: 0, bytes: 0 };
  }
  if (entries.length === 0) return { hash: EMPTY_TREE_HASH, files: 0, bytes: 0 };
  const h = createHash('sha256');
  let bytes = 0;
  // A window of reads in flight; results are consumed in sorted order, so the
  // digest is the same as one read after the other.
  const limit = Math.max(1, opts.concurrency ?? TREE_HASH_CONCURRENCY);
  const inFlight: Array<Promise<Buffer>> = [];
  let next = 0;
  const startRead = (): void => {
    const e = entries[next++]!;
    const p = readFile(e.abs);
    p.catch(() => undefined); // a read left behind by a cancel or an error must not be an unhandled rejection
    inFlight.push(p);
  };
  while (next < entries.length && inFlight.length < limit) startRead();
  for (let i = 0; i < entries.length; i++) {
    if (opts.signal?.aborted) throw new Error('hash cancelled');
    const buf = await inFlight.shift()!;
    if (next < entries.length) startRead();
    bytes += buf.length;
    h.update(entries[i]!.rel, 'utf-8');
    h.update('\u0000');
    h.update(buf);
    h.update('\u0000');
    tick('read', i + 1, bytes, entries.length);
  }
  return { hash: h.digest('hex'), files: entries.length, bytes };
}
