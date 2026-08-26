// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Minimal pure-Node POSIX tar writer for #0327 Part D log export.
//
// Why bespoke: pkg-bundled binary should not need a runtime tar dependency.
// The TAR format is simple enough to implement inline; only the subset needed
// for the log-export use case (regular files, no symlinks, no extended
// headers, no sparse files, no permissions beyond 0o644).
//
// Format reference: https://www.gnu.org/software/tar/manual/html_node/Standard.html
//   - 512-byte header per entry
//   - content padded to 512-byte boundary
//   - two 512-byte zero blocks at the end of the archive
//
// Output is uncompressed TAR; gzip wrapping happens at the caller via
// node:zlib.createGzip() piped to the .tar.gz file.

import { Buffer } from 'node:buffer';

interface TarEntry {
  name: string;
  content: Buffer;
}

/**
 * Build an uncompressed TAR archive Buffer from the given entries. Returns
 * the full archive (header + content + trailing zero blocks).
 */
export function buildTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(buildHeader(entry.name, entry.content.length));
    parts.push(entry.content);
    // Pad content to 512-byte boundary
    const padLen = (512 - (entry.content.length % 512)) % 512;
    if (padLen > 0) parts.push(Buffer.alloc(padLen));
  }
  // Two empty 512-byte blocks terminate the archive
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function buildHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  if (name.length > 100) {
    throw new Error(`tar: filename longer than 100 bytes is not supported (got: ${name})`);
  }
  // File name (100 bytes)
  header.write(name, 0, 100, 'ascii');
  // Mode (8 bytes, octal, NUL-terminated): 0644
  header.write('0000644\0', 100, 8, 'ascii');
  // UID + GID (8 bytes each, octal): zero
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  // Size (12 bytes, octal, NUL-terminated)
  header.write(toOctal(size, 11) + '\0', 124, 12, 'ascii');
  // Mtime (12 bytes, octal, NUL-terminated): current time
  const mtime = Math.floor(Date.now() / 1000);
  header.write(toOctal(mtime, 11) + '\0', 136, 12, 'ascii');
  // Checksum placeholder (8 bytes of spaces; computed below)
  header.write('        ', 148, 8, 'ascii');
  // Type flag (1 byte): '0' for regular file
  header.write('0', 156, 1, 'ascii');
  // Link name (100 bytes): empty
  // -- already zero
  // Magic + version: ustar\0 + 00 (POSIX P1003.1 ustar)
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  // Compute checksum: sum of all bytes treating the checksum field as spaces
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(toOctal(sum, 6) + '\0 ', 148, 8, 'ascii');
  return header;
}

function toOctal(n: number, width: number): string {
  const s = n.toString(8);
  return s.padStart(width, '0');
}
