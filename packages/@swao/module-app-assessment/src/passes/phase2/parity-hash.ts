// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- DYN-10 visual parity hash infrastructure
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 4.2 -- DYN-10 perceptual hash (dHash) infrastructure.
// Computes 64-bit dHash from a 9x8 grayscale pixel array and measures
// Hamming distance between hashes. compareBaselines() is a no-op when
// the current-crawl directory does not exist (skipped_reason: no_current_crawl).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface VisualDiff {
  slug: string;
  distance: number;
  severity: 'medium' | 'high';
}

export interface CompareBaselinesResult {
  diffs: VisualDiff[];
  skipped_reason?: 'no_current_crawl' | 'no_screenshots' | 'image_read_error';
}

// dHash algorithm: compute a 64-bit perceptual hash from a 9x8 grayscale pixel array.
// pixels must contain at least 9*8 = 72 values in row-major order.
// Returns a BigInt where bit (row*8 + col) is 1 when pixels[row, col] < pixels[row, col+1].
export function dhash(pixels: Uint8Array, width: number, height: number): bigint {
  if (width < 9 || height < 8) {
    throw new Error(`dhash requires at least 9x8 pixel data; got ${width}x${height}`);
  }
  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = pixels[row * width + col] ?? 0;
      const right = pixels[row * width + col + 1] ?? 0;
      if (left < right) {
        hash |= (1n << BigInt(row * 8 + col));
      }
    }
  }
  return hash;
}

// Count the number of differing bits between two 64-bit hashes.
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

// Attempt to read a screenshot.jpg as a grayscale 9x8 pixel array using the
// `sharp` package (optional native dependency). Returns null when sharp is
// unavailable or the image cannot be decoded -- compareBaselines() handles this
// by skipping the screen rather than failing the whole pass.
async function tryReadScreenshot(jpegPath: string): Promise<Uint8Array | null> {
  try {
    // Dynamic import: sharp is not listed as a dependency; this succeeds only
    // when the operator has installed it in the workspace.
    // @ts-expect-error -- optional native dep absent from package.json; caught below
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const sharp: any = (await import('sharp')).default;
    const raw = await sharp(jpegPath)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    return new Uint8Array(raw);
  } catch {
    return null;
  }
}

// Compare parity-baseline/ screenshots against current-crawl/ screenshots.
// Returns an empty diff list with skipped_reason when current-crawl does not exist.
// Visual regression threshold: distance > 10 = MEDIUM; distance > 30 = HIGH.
export async function compareBaselines(
  baselineDir: string,
  currentDir: string,
): Promise<CompareBaselinesResult> {
  if (!existsSync(currentDir)) {
    return { diffs: [], skipped_reason: 'no_current_crawl' };
  }

  const baseScreens = existsSync(baselineDir)
    ? readdirSync(baselineDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d{3}-/.test(d.name))
        .map((d) => d.name)
    : [];

  if (baseScreens.length === 0) {
    return { diffs: [], skipped_reason: 'no_screenshots' };
  }

  const diffs: VisualDiff[] = [];

  for (const slug of baseScreens) {
    const basePath = join(baselineDir, slug, 'screenshot.jpg');
    const currPath = join(currentDir, slug, 'screenshot.jpg');

    if (!existsSync(basePath) || !existsSync(currPath)) continue;

    const [basePixels, currPixels] = await Promise.all([
      tryReadScreenshot(basePath),
      tryReadScreenshot(currPath),
    ]);

    if (!basePixels || !currPixels) continue;

    const baseHash = dhash(basePixels, 9, 8);
    const currHash = dhash(currPixels, 9, 8);
    const distance = hammingDistance(baseHash, currHash);

    if (distance > 10) {
      diffs.push({
        slug,
        distance,
        severity: distance > 30 ? 'high' : 'medium',
      });
    }
  }

  return { diffs };
}
