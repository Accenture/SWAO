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
 * MSI Property table reader for Pass 25 BINARY (Design 103 §6.3.1, #3105).
 *
 * MSI databases are OLE Compound Files ([MS-CFB]). This reads the FAT, the
 * directory, and the `!_StringPool` / `!_StringData` / `!Property` streams
 * without executing anything (no msiexec). Sector chains are length-capped and
 * loop-checked; any malformed structure returns `parse_error`.
 */

import { BoundedReader } from './reader.js';

const CFB_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAX_CHAIN = 1 << 20;
const MAX_STREAM = 64 * 1024 * 1024;

export interface MsiInfo {
  format: 'msi';
  properties: Record<string, string>;
  product_name: string | null;
  product_version: string | null;
  manufacturer: string | null;
  product_code: string | null;
  install_dir: string | null;
  parse_error?: string;
}

interface DirEntry { name: string; type: number; start: number; size: number }

class CfbError extends Error {}

class Cfb {
  readonly sectorSize: number;
  private readonly miniSize: number;
  private readonly cutoff: number;
  private readonly fat: number[];
  private readonly miniFat: number[];
  readonly entries: DirEntry[];
  private miniStream: Buffer | null = null;

  constructor(private readonly r: BoundedReader) {
    const h = r.read(0, 512);
    if (!h || !h.subarray(0, 8).equals(CFB_MAGIC)) throw new CfbError('not an OLE compound file');
    this.sectorSize = 1 << h.readUInt16LE(0x1e);
    this.miniSize = 1 << h.readUInt16LE(0x20);
    if (this.sectorSize !== 512 && this.sectorSize !== 4096) throw new CfbError('bad sector size');
    this.cutoff = h.readUInt32LE(0x38);

    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i++) {
      const s = h.readUInt32LE(0x4c + i * 4);
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
    }
    let difat = h.readUInt32LE(0x44);
    const perDifat = this.sectorSize / 4 - 1;
    for (let guard = 0; difat !== ENDOFCHAIN && difat !== FREESECT && guard < 4096; guard++) {
      const sec = this.sector(difat);
      for (let i = 0; i < perDifat; i++) {
        const s = sec.readUInt32LE(i * 4);
        if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
      }
      difat = sec.readUInt32LE(perDifat * 4);
    }
    this.fat = [];
    for (const fs of fatSectors.slice(0, 1 << 16)) {
      const sec = this.sector(fs);
      for (let i = 0; i < this.sectorSize / 4; i++) this.fat.push(sec.readUInt32LE(i * 4));
    }
    const miniFatBuf = this.readChain(h.readUInt32LE(0x3c), MAX_STREAM);
    this.miniFat = [];
    for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) this.miniFat.push(miniFatBuf.readUInt32LE(i));

    const dirBuf = this.readChain(h.readUInt32LE(0x30), MAX_STREAM);
    this.entries = [];
    for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
      const nameLen = Math.min(dirBuf.readUInt16LE(off + 64), 64);
      const name = dirBuf.subarray(off, off + Math.max(0, nameLen - 2)).toString('utf16le');
      this.entries.push({ name, type: dirBuf[off + 66] as number, start: dirBuf.readUInt32LE(off + 116), size: dirBuf.readUInt32LE(off + 120) });
    }
  }

  private sector(n: number): Buffer {
    const b = this.r.read((n + 1) * this.sectorSize, this.sectorSize);
    if (!b) throw new CfbError(`sector ${n} out of range`);
    return b;
  }

  private chain(start: number, table: number[]): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT; s = table[s] ?? ENDOFCHAIN) {
      if (seen.has(s) || out.length >= MAX_CHAIN) throw new CfbError('sector chain loop or too long');
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  private readChain(start: number, cap: number): Buffer {
    if (start === ENDOFCHAIN || start === FREESECT) return Buffer.alloc(0);
    const ids = this.chain(start, this.fat);
    if (ids.length * this.sectorSize > cap) throw new CfbError('stream too large');
    return Buffer.concat(ids.map((s) => this.sector(s)));
  }

  stream(entry: DirEntry): Buffer {
    if (entry.size > MAX_STREAM) throw new CfbError('stream too large');
    if (entry.size >= this.cutoff) return this.readChain(entry.start, MAX_STREAM).subarray(0, entry.size);
    if (!this.miniStream) {
      const root = this.entries.find((e) => e.type === 5);
      this.miniStream = root ? this.readChain(root.start, MAX_STREAM) : Buffer.alloc(0);
    }
    const parts = this.chain(entry.start, this.miniFat).map((m) => this.miniStream!.subarray(m * this.miniSize, (m + 1) * this.miniSize));
    return Buffer.concat(parts).subarray(0, entry.size);
  }
}

/** Decode an MSI-encoded stream name ([MS-CFB] names packed into U+3800..U+4840). */
export function decodeMsiStreamName(name: string): string {
  const mime = (x: number) => (x < 10 ? String.fromCharCode(48 + x) : x < 36 ? String.fromCharCode(55 + x) : x < 62 ? String.fromCharCode(61 + x) : x === 62 ? '.' : '_');
  let out = '';
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3800 && c < 0x4800) out += mime((c - 0x3800) & 0x3f) + mime(((c - 0x3800) >> 6) & 0x3f);
    else if (c >= 0x4800 && c < 0x4840) out += mime(c - 0x4800);
    else if (c === 0x4840) out += '!';
    else out += ch;
  }
  return out;
}

function decodeStrings(pool: Buffer, data: Buffer): { strings: string[]; refBytes: number } {
  const refBytes = pool.length >= 4 && (pool.readUInt16LE(2) & 0x8000) !== 0 ? 3 : 2;
  const strings: string[] = [''];
  let pos = 0;
  for (let off = 4; off + 4 <= pool.length && strings.length < 1 << 20; off += 4) {
    let len = pool.readUInt16LE(off);
    const refs = pool.readUInt16LE(off + 2);
    if (len === 0 && refs !== 0 && off + 8 <= pool.length) {
      // Long string: (0, high) followed by (low, refcount).
      off += 4;
      len = refs * 0x10000 + pool.readUInt16LE(off);
    }
    if (pos + len > data.length) break;
    strings.push(data.subarray(pos, pos + len).toString('utf8'));
    pos += len;
  }
  return { strings, refBytes };
}

const EMPTY: Omit<MsiInfo, 'parse_error'> = { format: 'msi', properties: {}, product_name: null, product_version: null, manufacturer: null, product_code: null, install_dir: null };

/** Returns null when the file is not an OLE compound file. */
export function parseMsi(reader: BoundedReader): MsiInfo | null {
  const head = reader.read(0, 8);
  if (!head || !head.equals(CFB_MAGIC)) return null;
  try {
    const cfb = new Cfb(reader);
    const byName = new Map(cfb.entries.filter((e) => e.type === 2).map((e) => [decodeMsiStreamName(e.name), e]));
    const pool = byName.get('!_StringPool');
    const data = byName.get('!_StringData');
    const prop = byName.get('!Property');
    if (!pool || !data || !prop) return { ...EMPTY, parse_error: 'no Property table (not an MSI database)' };
    const { strings, refBytes } = decodeStrings(cfb.stream(pool), cfb.stream(data));
    const table = cfb.stream(prop);
    const rows = Math.floor(table.length / (2 * refBytes));
    const ref = (off: number) => (refBytes === 3 ? table.readUIntLE(off, 3) : table.readUInt16LE(off));
    const properties: Record<string, string> = {};
    for (let i = 0; i < rows && i < 100_000; i++) {
      const key = strings[ref(i * refBytes)];
      const value = strings[ref(rows * refBytes + i * refBytes)];
      if (key) properties[key] = value ?? '';
    }
    const get = (k: string) => properties[k] ?? null;
    return {
      format: 'msi',
      properties,
      product_name: get('ProductName'),
      product_version: get('ProductVersion'),
      manufacturer: get('Manufacturer'),
      product_code: get('ProductCode'),
      install_dir: get('INSTALLDIR') ?? get('INSTALLFOLDER') ?? get('TARGETDIR'),
    };
  } catch (e) {
    return { ...EMPTY, parse_error: e instanceof CfbError ? e.message : 'malformed compound file' };
  }
}
