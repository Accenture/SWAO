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

// #3342: LZ fit file names, single-target and multi-target shapes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isLzFitPassFile,
  isLzCatalogueFitFile,
  listLzFitPassFiles,
  listLzCatalogueFitFiles,
} from './lz-fit-files.js';

describe('LZ fit file names (#3342)', () => {
  it('accepts the single-target and multi-target pass file shapes', () => {
    expect(isLzFitPassFile('lz-fit.yaml')).toBe(true);
    expect(isLzFitPassFile('lz-fit.yml')).toBe(true);
    expect(isLzFitPassFile('lz-fit-aws-eu-central-1.yaml')).toBe(true);
    expect(isLzFitPassFile('lz-catalogue-fit.yaml')).toBe(false);
    expect(isLzFitPassFile('01-static.yaml')).toBe(false);
    expect(isLzFitPassFile('lz-fit.json')).toBe(false);
  });

  it('accepts the single-target and multi-target catalogue fit shapes', () => {
    expect(isLzCatalogueFitFile('lz-catalogue-fit.yaml')).toBe(true);
    expect(isLzCatalogueFitFile('lz-catalogue-fit-stackit-eu01.yaml')).toBe(true);
    expect(isLzCatalogueFitFile('lz-fit.yaml')).toBe(false);
  });

  describe('listing', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-lz-fit-files-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('lists both shapes sorted and ignores other files', () => {
      mkdirSync(join(dir, 'passes'));
      for (const f of ['lz-fit.yaml', 'lz-fit-aws-eu-central-1.yaml', 'findings.yaml']) {
        writeFileSync(join(dir, 'passes', f), 'x: 1\n');
      }
      for (const f of ['lz-catalogue-fit.yaml', 'run-manifest.json']) writeFileSync(join(dir, f), 'x: 1\n');
      expect(listLzFitPassFiles(join(dir, 'passes'))).toEqual(['lz-fit-aws-eu-central-1.yaml', 'lz-fit.yaml']);
      expect(listLzCatalogueFitFiles(dir)).toEqual(['lz-catalogue-fit.yaml']);
    });

    it('returns [] for a missing directory', () => {
      expect(listLzFitPassFiles(join(dir, 'nope'))).toEqual([]);
      expect(listLzCatalogueFitFiles(join(dir, 'nope'))).toEqual([]);
    });
  });
});
