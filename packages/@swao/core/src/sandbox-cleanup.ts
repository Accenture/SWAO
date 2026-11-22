// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4375: removal of the temporary test profile of #4278. Every vitest process
// creates `<tmp>/swao-test-home-*` with `AppData/Local/ms-playwright` as a
// junction to the real browser cache. A recursive delete that followed the
// junction would wipe the real cache, so links are unlinked first (the link
// itself, never its target), and the folder is deleted only when no link is
// left in it. Only a direct child of the temp folder with the given prefix is
// ever touched.

import { lstatSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export interface RemoveSandboxOptions {
  /** Folder the sandbox must be a direct child of (default: os.tmpdir()). */
  tmpRoot?: string;
  /** Required name prefix of the sandbox folder (default `swao-test-home-`). */
  prefix?: string;
}

export interface RemoveSandboxResult {
  removed: boolean;
  /** Links unlinked before the delete (the link only, never the target). */
  linksRemoved: number;
  /** Why nothing was removed. */
  reason?: 'outside_tmp_root' | 'wrong_prefix' | 'missing' | 'link_left' | 'delete_failed';
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Unlinks one symbolic link or junction; true when it is gone afterwards. */
function unlinkLink(p: string): boolean {
  try { unlinkSync(p); } catch {
    // A directory junction that unlink refuses: rmdir removes the link, not the target.
    try { rmdirSync(p); } catch { /* checked below */ }
  }
  try { lstatSync(p); return false; } catch { return true; }
}

/** Unlinks every link below `dir` without descending into a link; false when one could not be removed. */
function unlinkAllLinks(dir: string, count: { n: number }): boolean {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return true; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) {
      if (!unlinkLink(p)) return false;
      count.n++;
      continue;
    }
    if (st.isDirectory() && !unlinkAllLinks(p, count)) return false;
  }
  return true;
}

/**
 * Removes a test sandbox profile: first every link inside it (the
 * ms-playwright junction), then the folder. Never throws.
 */
export function removeSandboxProfile(home: string, opts: RemoveSandboxOptions = {}): RemoveSandboxResult {
  const root = resolve(opts.tmpRoot ?? tmpdir());
  const abs = resolve(home);
  const prefix = opts.prefix ?? 'swao-test-home-';
  if (!samePath(dirname(abs), root)) return { removed: false, linksRemoved: 0, reason: 'outside_tmp_root' };
  if (!basename(abs).startsWith(prefix) || basename(abs).length === prefix.length) return { removed: false, linksRemoved: 0, reason: 'wrong_prefix' };
  let top;
  try { top = lstatSync(abs); } catch { return { removed: false, linksRemoved: 0, reason: 'missing' }; }
  if (top.isSymbolicLink() || !top.isDirectory()) return { removed: false, linksRemoved: 0, reason: 'wrong_prefix' };
  const count = { n: 0 };
  if (!unlinkAllLinks(abs, count)) return { removed: false, linksRemoved: count.n, reason: 'link_left' };
  try { rmSync(abs, { recursive: true, force: true, maxRetries: 2 }); } catch { return { removed: false, linksRemoved: count.n, reason: 'delete_failed' }; }
  return { removed: true, linksRemoved: count.n };
}
