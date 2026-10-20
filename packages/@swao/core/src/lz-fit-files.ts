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

// LZ fit artefact file names (#3342).
//
// A landing zone catalogue fit writes one file per target. The name depends
// on how many targets the run assessed (assess.ts, Design 056 addendum):
//
//   single target   passes/lz-fit.yaml             <runDir>/lz-catalogue-fit.yaml
//   multi target    passes/lz-fit-<p>-<r>.yaml     <runDir>/lz-catalogue-fit-<p>-<r>.yaml
//
// Every reader must accept both shapes. Matching only the `-<p>-<r>` form
// silently drops single-target runs (#3342: the LZ challenge reported
// "Targets assessed: 0" for an aws/eu-central-1 run).

import { existsSync, readdirSync } from 'fs';

/** Matches passes/lz-fit.yaml and passes/lz-fit-<provider>-<region>.yaml. */
export const LZ_FIT_PASS_FILE_RE = /^lz-fit(?:-.+)?\.ya?ml$/;

/** Matches lz-catalogue-fit.yaml and lz-catalogue-fit-<provider>-<region>.yaml (run root). */
export const LZ_CATALOGUE_FIT_FILE_RE = /^lz-catalogue-fit(?:-.+)?\.ya?ml$/;

/** True for a single-target or multi-target LZ fit pass file name. */
export function isLzFitPassFile(name: string): boolean {
  return LZ_FIT_PASS_FILE_RE.test(name);
}

/** True for a single-target or multi-target LZ catalogue fit file name. */
export function isLzCatalogueFitFile(name: string): boolean {
  return LZ_CATALOGUE_FIT_FILE_RE.test(name);
}

function listMatching(dir: string, re: RegExp): string[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => re.test(f)).sort();
  } catch {
    return [];
  }
}

/** Sorted LZ fit pass file names in a passes/ directory (both shapes); [] when absent. */
export function listLzFitPassFiles(passesDir: string): string[] {
  return listMatching(passesDir, LZ_FIT_PASS_FILE_RE);
}

/** Sorted LZ catalogue fit file names at a run root (both shapes); [] when absent. */
export function listLzCatalogueFitFiles(runDir: string): string[] {
  return listMatching(runDir, LZ_CATALOGUE_FIT_FILE_RE);
}
