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

// Leg workspace preparation (#4243, Design 092 s3.1 and s7.2).
//
// A leg is a full App Assessment in a temporary copy of the workspace. Before
// #4243 the copy took the whole app directory, so a monorepo clone under
// wsp/inputs/source was copied in full (with .git) although the passes read
// only `source.vcs.subdir`, synchronously and without a log line: 24 minutes
// of a frozen screen. The copy now takes only what a leg needs:
//
//   - the portfolio .swao.yml and the workspace wsp/inputs/;
//   - the app directory without generated artefacts (wsp/runs, reports,
//     exports, cache, logs), without the app's challenge folders (a leg
//     writes its own, #4277) and without the source folder;
//   - the source scoped to `<source.path>/<vcs.subdir>` through the core
//     helper appSourceRoot (the same root the passes read), without `.git`.
//
// The walk is asynchronous so the host keeps rendering (progress line, Esc)
// and the leg heartbeat keeps firing while a large tree is copied.

import { copyFile, mkdir, mkdtemp, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppSourceRoot, type AppSourceRoot } from '@swao/core';

/** Generated app artefacts and the app's own challenge results: never copied into a leg. */
const APP_EXCLUDED_WSP_DIRS = ['runs', 'reports', 'exports', 'cache', 'logs', 'challenge-app', 'challenge-lz'];

export interface CopyStats {
  files: number;
  bytes: number;
  /** Symbolic links and junctions, not followed (the copy stays inside its roots). */
  links_skipped: number;
}

export interface PrepareProgress extends CopyStats {
  elapsed_ms: number;
}

export interface PreparedLegWorkspace {
  path: string;
  stats: CopyStats;
  duration_ms: number;
  source: AppSourceRoot;
  /** True when the scoped source root was found and copied (false: absent or outside the app dir). */
  source_copied: boolean;
}

export interface PrepareLegWorkspaceOptions {
  workspaceRoot: string;
  appId: string;
  legId: string;
  signal?: AbortSignal;
  /** Called at most every `progressEveryMs` while files are copied. */
  onProgress?: (p: PrepareProgress) => void;
  progressEveryMs?: number;
}

export class PreparationCancelledError extends Error {
  constructor() {
    super('leg workspace preparation cancelled');
    this.name = 'PreparationCancelledError';
  }
}

interface CopyCtx {
  stats: CopyStats;
  signal?: AbortSignal;
  tick: () => void;
}

/** Recursive async copy; `prune(rel, isDir)` true skips the entry (rel uses forward slashes). */
async function copyTree(src: string, dst: string, prune: (rel: string, isDir: boolean) => boolean, ctx: CopyCtx, rel = ''): Promise<void> {
  if (ctx.signal?.aborted) throw new PreparationCancelledError();
  let entries: Dirent[];
  try { entries = await readdir(src, { withFileTypes: true }); } catch { return; }
  await mkdir(dst, { recursive: true });
  const files: Dirent[] = [];
  for (const e of entries) {
    if (ctx.signal?.aborted) throw new PreparationCancelledError();
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) { ctx.stats.links_skipped++; continue; }
    if (e.isDirectory()) {
      if (e.name === '.git' || prune(childRel, true)) continue;
      await copyTree(join(src, e.name), join(dst, e.name), prune, ctx, childRel);
      continue;
    }
    if (!e.isFile() || prune(childRel, false)) continue;
    files.push(e);
  }
  // #4404: the files of a folder are copied LEG_COPY_CONCURRENCY at a time; per-file
  // open latency (endpoint protection) dominated the one-after-the-other copy.
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      if (ctx.signal?.aborted) throw new PreparationCancelledError();
      const e = files[next++]!;
      const from = join(src, e.name);
      try {
        await copyFile(from, join(dst, e.name));
        ctx.stats.files++;
        try { ctx.stats.bytes += (await stat(from)).size; } catch { /* size best-effort */ }
      } catch { /* unreadable file: skipped, the leg sees what the operator could read */ }
      ctx.tick();
    }
  };
  await Promise.all(Array.from({ length: Math.min(LEG_COPY_CONCURRENCY, files.length) }, () => worker()));
}

/** #4404: files copied at a time within one folder of a leg workspace. */
export const LEG_COPY_CONCURRENCY = 8;

/**
 * Create the temporary workspace of one leg (see the header for what is
 * copied). Rejects with PreparationCancelledError when `signal` aborts.
 */
export async function prepareLegWorkspace(opts: PrepareLegWorkspaceOptions): Promise<PreparedLegWorkspace> {
  const started = Date.now();
  const every = opts.progressEveryMs ?? 2_000;
  let lastTick = started;
  const stats: CopyStats = { files: 0, bytes: 0, links_skipped: 0 };
  const ctx: CopyCtx = {
    stats,
    ...(opts.signal ? { signal: opts.signal } : {}),
    tick: () => {
      const now = Date.now();
      if (opts.onProgress && now - lastTick >= every) {
        lastTick = now;
        opts.onProgress({ ...stats, elapsed_ms: now - started });
      }
    },
  };

  const tmp = await mkdtemp(join(tmpdir(), `swao-leg-${opts.legId.replace(/[^a-z0-9-]/gi, '_')}-`));
  const rootYml = join(opts.workspaceRoot, '.swao.yml');
  if (existsSync(rootYml)) await copyFile(rootYml, join(tmp, '.swao.yml'));
  // Workspace-level inputs (connectors, catalogs): read-only context.
  await copyTree(join(opts.workspaceRoot, 'wsp', 'inputs'), join(tmp, 'wsp', 'inputs'), () => false, ctx);

  const appSrc = join(opts.workspaceRoot, 'apps', opts.appId);
  const appDst = join(tmp, 'apps', opts.appId);
  const source = readAppSourceRoot(appSrc);
  const sourceRel = source.baseRelToApp;
  await copyTree(appSrc, appDst, (rel, isDir) => {
    if (isDir && APP_EXCLUDED_WSP_DIRS.some((d) => rel === `wsp/${d}`)) return true;
    // The source folder is copied below, scoped to the subdir.
    return sourceRel !== null && sourceRel !== '' && rel === sourceRel;
  }, ctx);

  let sourceCopied = false;
  if (sourceRel !== null && sourceRel !== '' && existsSync(source.root)) {
    const dst = join(appDst, ...sourceRel.split('/'), ...(source.subdir ? source.subdir.split('/') : []));
    await copyTree(source.root, dst, () => false, ctx);
    sourceCopied = true;
  } else if (sourceRel === '') {
    sourceCopied = true; // the app directory is the source; copied above
  }
  opts.onProgress?.({ ...stats, elapsed_ms: Date.now() - started });
  return { path: tmp, stats, duration_ms: Date.now() - started, source, source_copied: sourceCopied };
}
