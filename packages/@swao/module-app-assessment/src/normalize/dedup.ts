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

// Duplicate detection utilities for `swao normalize` (#0442).
//
// sha256: compute a hex SHA-256 hash of a file's contents.
// findExactDuplicates: group files that share the same hash.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Compute the SHA-256 hex digest of a file's raw bytes.
 */
export function sha256(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Given an array of file paths, return a Map<hash, paths[]> where
 * each entry contains two or more files that share the same content.
 * Files with a unique hash are not included in the map.
 */
export function findExactDuplicates(files: string[]): Map<string, string[]> {
  const byHash = new Map<string, string[]>();

  for (const filePath of files) {
    try {
      const hash = sha256(filePath);
      const existing = byHash.get(hash);
      if (existing) {
        existing.push(filePath);
      } else {
        byHash.set(hash, [filePath]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[swao normalize] Could not hash ${filePath}: ${msg}`);
    }
  }

  // Keep only entries that have more than one file (true duplicates).
  for (const [hash, paths] of byHash) {
    if (paths.length < 2) {
      byHash.delete(hash);
    }
  }

  return byHash;
}
