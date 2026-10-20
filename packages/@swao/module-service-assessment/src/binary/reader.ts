// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Bounded, positioned reads for untrusted vendor binaries (Pass 25). Files are
 * never read whole: every read is offset + length checked against the file size,
 * and hashing streams in fixed chunks.
 */

import { closeSync, openSync, readSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';

export class BoundedReader {
  readonly size: number;
  private readonly fd: number;

  constructor(path: string) {
    this.fd = openSync(path, 'r');
    this.size = fstatSync(this.fd).size;
  }

  /** Bytes at [offset, offset + length), or null when the range is outside the file. */
  read(offset: number, length: number): Buffer | null {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.size) return null;
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = readSync(this.fd, buf, done, length - done, offset + done);
      if (n <= 0) return null;
      done += n;
    }
    return buf;
  }

  u16(offset: number): number | null { return this.read(offset, 2)?.readUInt16LE(0) ?? null; }
  u32(offset: number): number | null { return this.read(offset, 4)?.readUInt32LE(0) ?? null; }

  close(): void {
    closeSync(this.fd);
  }
}

const CHUNK = 1024 * 1024;

export function sha256File(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const hash = createHash('sha256');
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      hash.update(n === CHUNK ? buf : buf.subarray(0, n));
      pos += n;
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

/** Find an ASCII marker in the first `limit` bytes, chunked with overlap. Returns the following bytes. */
export function scanFor(reader: BoundedReader, marker: Buffer, limit: number, take: number): Buffer | null {
  const end = Math.min(reader.size, limit);
  for (let pos = 0; pos < end; pos += CHUNK - marker.length - take) {
    const chunk = reader.read(pos, Math.min(CHUNK, end - pos));
    if (!chunk) return null;
    const at = chunk.indexOf(marker);
    if (at >= 0) return reader.read(pos + at + marker.length, Math.min(take, reader.size - (pos + at + marker.length)));
    if (pos + CHUNK >= end) break;
  }
  return null;
}
