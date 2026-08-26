// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-10 visual parity hash tests (#1274)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dhash, hammingDistance, compareBaselines } from './parity-hash.js';

// Helper: create a synthetic 9x8 grayscale pixel array with a constant value.
function solidPixels(value: number): Uint8Array {
  return new Uint8Array(9 * 8).fill(value);
}

// Helper: create a gradient pixel array where pixel[row, col] = col * 10.
function gradientPixels(): Uint8Array {
  const px = new Uint8Array(9 * 8);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 9; col++) {
      px[row * 9 + col] = col * 10;
    }
  }
  return px;
}

describe('dhash (#1274)', () => {
  it('returns the same hash for identical pixel data', () => {
    const px = gradientPixels();
    expect(dhash(px, 9, 8)).toBe(dhash(px, 9, 8));
  });

  it('returns 0 for a uniform pixel array (all pixels equal -- no gradient)', () => {
    // All pixels identical: no pair satisfies left < right, so all bits = 0.
    const px = solidPixels(128);
    expect(dhash(px, 9, 8)).toBe(0n);
  });

  it('returns a non-zero hash for a gradient (left < right everywhere)', () => {
    // Gradient: each pixel is larger than the previous in a row -> all bits = 1.
    const px = gradientPixels();
    expect(dhash(px, 9, 8)).not.toBe(0n);
  });

  it('throws when pixel array is smaller than 9x8', () => {
    expect(() => dhash(new Uint8Array(8 * 8), 8, 8)).toThrow('9x8');
  });

  it('pure-black vs pure-white yields maximum distance (64 bits differ)', () => {
    // All-black (0): all pairs 0 vs 0, all bits 0.
    // All-white (255): same.
    // Both yield the same hash 0n -- distance 0.
    // To get max distance we need: left < right for all in one image, left >= right for all in other.
    const increasing = gradientPixels();           // all bits 1
    const decreasing = new Uint8Array(9 * 8);     // reverse gradient: all bits 0
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 9; col++) {
        decreasing[row * 9 + col] = (8 - col) * 10;
      }
    }
    const d = hammingDistance(dhash(increasing, 9, 8), dhash(decreasing, 9, 8));
    expect(d).toBe(64);
  });
});

describe('hammingDistance (#1274)', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance(0b1010n, 0b1010n)).toBe(0);
  });

  it('returns 1 for hashes differing in exactly 1 bit', () => {
    expect(hammingDistance(0b1010n, 0b1011n)).toBe(1);
  });

  it('returns 64 for completely inverted 64-bit hashes', () => {
    const allOnes = (1n << 64n) - 1n;
    expect(hammingDistance(0n, allOnes)).toBe(64);
  });

  it('is symmetric', () => {
    expect(hammingDistance(0b1100n, 0b0011n)).toBe(hammingDistance(0b0011n, 0b1100n));
  });
});

describe('compareBaselines (#1274)', () => {
  it('returns skipped_reason=no_current_crawl when currentDir does not exist', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-parity-'));
    try {
      const result = await compareBaselines(tmp, join(tmp, 'nonexistent-current'));
      expect(result.diffs).toHaveLength(0);
      expect(result.skipped_reason).toBe('no_current_crawl');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns skipped_reason=no_screenshots when baselineDir has no NNN- screens', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-parity-'));
    const currentDir = join(tmp, 'current');
    try {
      // Create current dir but leave baseline empty.
      const { mkdirSync } = await import('node:fs');
      mkdirSync(currentDir, { recursive: true });
      const result = await compareBaselines(tmp, currentDir);
      expect(result.diffs).toHaveLength(0);
      expect(result.skipped_reason).toBe('no_screenshots');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns empty diffs when screenshots are missing from either side', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-parity-'));
    try {
      const { mkdirSync } = await import('node:fs');
      const currentDir = join(tmp, 'current');
      // Create baseline screen dir but no screenshot.jpg; create current dir.
      mkdirSync(join(tmp, '001-screen'), { recursive: true });
      mkdirSync(currentDir, { recursive: true });
      const result = await compareBaselines(tmp, currentDir);
      expect(result.diffs).toHaveLength(0);
      expect(result.skipped_reason).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
