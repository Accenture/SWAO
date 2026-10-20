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
 * Static PE (Portable Executable) header analysis for Pass 25 BINARY
 * (Design 103 §6.3.1, #3104). Nothing is executed. Every offset and RVA is
 * bounds-checked; malformed structures produce `parse_error`, never a throw.
 */

import { parseAuthenticode, type SignatureInfo } from './authenticode.js';
import { BoundedReader, scanFor } from './reader.js';

export type PeArch = 'x86' | 'x64' | 'arm64' | 'arm' | 'other';

export interface PeInfo {
  format: 'pe';
  arch: PeArch;
  machine: number;
  pe32_plus: boolean;
  compiled_at: string | null;
  dotnet: null | {
    metadata_version: string | null;
    target_framework: string | null;
    any_cpu: boolean;
  };
  imports: string[];
  /** Approximate MSVC runtime vintage from the CRT import, e.g. 'msvcr100.dll' -> 2010. */
  vc_runtime: { dll: string; year: number } | null;
  signature: SignatureInfo;
  parse_error?: string;
}

const MACHINES: Record<number, PeArch> = { 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'arm64', 0x1c4: 'arm' };
const MSVCR_YEAR: Record<string, number> = { '70': 2002, '71': 2003, '80': 2005, '90': 2008, '100': 2010, '110': 2012, '120': 2013 };
const MAX_SECTIONS = 96;
const MAX_IMPORTS = 512;
const MAX_CERT_TABLE = 1024 * 1024;
const FRAMEWORK_SCAN_LIMIT = 64 * 1024 * 1024;

interface Section { va: number; vsize: number; raw: number; rawSize: number }

function rvaToOffset(sections: Section[], rva: number): number | null {
  for (const s of sections) {
    const size = Math.max(s.vsize, s.rawSize);
    if (rva >= s.va && rva < s.va + size) {
      const off = s.raw + (rva - s.va);
      return off < s.raw + s.rawSize ? off : null;
    }
  }
  return null;
}

function cString(reader: BoundedReader, offset: number, max = 256): string | null {
  const buf = reader.read(offset, Math.min(max, reader.size - offset));
  if (!buf) return null;
  const end = buf.indexOf(0);
  return buf.subarray(0, end < 0 ? buf.length : end).toString('latin1');
}

const NO_SIGNATURE: SignatureInfo = { present: false, signer: null, certificates: [], timestamped: false };

/** Returns null when the file is not a PE image (no MZ / PE signature). */
export function parsePe(reader: BoundedReader): PeInfo | null {
  if (reader.read(0, 2)?.toString('latin1') !== 'MZ') return null;
  const lfanew = reader.u32(0x3c);
  if (lfanew === null || reader.read(lfanew, 4)?.toString('latin1') !== 'PE\0\0') return null;

  const base: PeInfo = { format: 'pe', arch: 'other', machine: 0, pe32_plus: false, compiled_at: null, dotnet: null, imports: [], vc_runtime: null, signature: NO_SIGNATURE };
  const coff = lfanew + 4;
  const machine = reader.u16(coff);
  const nSections = reader.u16(coff + 2);
  const timestamp = reader.u32(coff + 4);
  const optSize = reader.u16(coff + 16);
  if (machine === null || nSections === null || timestamp === null || optSize === null) return { ...base, parse_error: 'truncated COFF header' };
  base.machine = machine;
  base.arch = MACHINES[machine] ?? 'other';
  base.compiled_at = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null;

  const opt = coff + 20;
  const magic = reader.u16(opt);
  if (magic !== 0x10b && magic !== 0x20b) return { ...base, parse_error: 'unknown optional header magic' };
  base.pe32_plus = magic === 0x20b;
  const nDirs = reader.u32(opt + (base.pe32_plus ? 108 : 92)) ?? 0;
  const dirBase = opt + (base.pe32_plus ? 112 : 96);
  const dir = (i: number) => (i < Math.min(nDirs, 16) ? { rva: reader.u32(dirBase + i * 8) ?? 0, size: reader.u32(dirBase + i * 8 + 4) ?? 0 } : { rva: 0, size: 0 });

  const sections: Section[] = [];
  const secTable = opt + optSize;
  for (let i = 0; i < Math.min(nSections, MAX_SECTIONS); i++) {
    const s = reader.read(secTable + i * 40, 40);
    if (!s) return { ...base, parse_error: 'truncated section table' };
    sections.push({ vsize: s.readUInt32LE(8), va: s.readUInt32LE(12), rawSize: s.readUInt32LE(16), raw: s.readUInt32LE(20) });
  }

  // Import directory (1): DLL names.
  const imp = dir(1);
  if (imp.rva) {
    let off = rvaToOffset(sections, imp.rva);
    for (let i = 0; off !== null && i < MAX_IMPORTS; i++, off += 20) {
      const desc = reader.read(off, 20);
      if (!desc || desc.every((b) => b === 0)) break;
      const nameOff = rvaToOffset(sections, desc.readUInt32LE(12));
      const name = nameOff === null ? null : cString(reader, nameOff);
      if (name) base.imports.push(name.toLowerCase());
    }
  }
  const crt = base.imports.map((d) => /^msvc[rp](\d+)d?\.dll$/.exec(d)).find((m) => m && MSVCR_YEAR[m[1] as string]);
  if (crt) base.vc_runtime = { dll: crt[0], year: MSVCR_YEAR[crt[1] as string] as number };
  else if (base.imports.some((d) => /^(vcruntime14\d*|msvcp14\d*|ucrtbase|api-ms-win-crt-)/.test(d))) base.vc_runtime = { dll: 'vcruntime140.dll', year: 2015 };

  // CLR runtime header (14): .NET metadata version and AnyCPU.
  const clr = dir(14);
  if (clr.rva) {
    const off = rvaToOffset(sections, clr.rva);
    const hdr = off === null ? null : reader.read(off, 24);
    if (hdr) {
      const flags = hdr.readUInt32LE(16);
      const mdOff = rvaToOffset(sections, hdr.readUInt32LE(8));
      let version: string | null = null;
      if (mdOff !== null && reader.u32(mdOff) === 0x424a5342) {
        const len = reader.u32(mdOff + 12) ?? 0;
        version = len > 0 && len <= 255 ? (cString(reader, mdOff + 16, len) ?? null) : null;
      }
      // TargetFrameworkAttribute string: the CLR metadata version is v4.0.30319 for every
      // .NET 4.x and .NET Core/5+, so it cannot tell 4.5 from 4.8 or identify .NET 6.
      const framework = (marker: string): string | null => {
        const tail = scanFor(reader, Buffer.from(marker, 'latin1'), FRAMEWORK_SCAN_LIMIT, 12);
        const ver = tail ? /^v[0-9.]+/.exec(tail.toString('latin1'))?.[0] : undefined;
        return ver ? `${marker}${ver}` : null;
      };
      const tf = framework('.NETFramework,Version=') ?? framework('.NETCoreApp,Version=');
      base.dotnet = { metadata_version: version, target_framework: tf, any_cpu: (flags & 0x1) !== 0 && (flags & 0x2) === 0 };
    }
  }

  // Certificate table (4): file offset, not an RVA.
  const sec = dir(4);
  if (sec.rva && sec.size) {
    if (sec.size > MAX_CERT_TABLE) return { ...base, signature: { ...NO_SIGNATURE, present: true, parse_error: 'certificate table too large' } };
    const win = reader.read(sec.rva, sec.size);
    if (!win || win.length < 8) return { ...base, signature: { ...NO_SIGNATURE, present: true, parse_error: 'certificate table out of range' } };
    const len = win.readUInt32LE(0);
    const type = win.readUInt16LE(6);
    base.signature = type === 0x0002 && len > 8 && len <= win.length
      ? parseAuthenticode(win.subarray(8, len))
      : { ...NO_SIGNATURE, present: true, parse_error: `unsupported certificate type ${type}` };
  }
  return base;
}

/** Parse a .NET version string such as 'v4.7.2' / 'v6.0' / 'v2.0.50727' to [major, minor, patch]. */
export function dotnetVersion(v: string | null | undefined): [number, number, number] | null {
  // Same result as `/v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(v)`: the first maximal
  // digit run followed by '.' and a digit is the major version. A scan, because
  // that regex backtracks polynomially on long digit runs (CodeQL js/polynomial-redos).
  const s = v ?? '';
  const digitsEnd = (from: number): number => {
    let i = from;
    while (i < s.length && isAsciiDigit(s.charCodeAt(i))) i++;
    return i;
  };
  let i = 0;
  while (i < s.length) {
    if (!isAsciiDigit(s.charCodeAt(i))) { i++; continue; }
    const majorEnd = digitsEnd(i);
    if (s[majorEnd] === '.' && isAsciiDigit(s.charCodeAt(majorEnd + 1))) {
      const minorEnd = digitsEnd(majorEnd + 1);
      let patch = '0';
      if (s[minorEnd] === '.' && isAsciiDigit(s.charCodeAt(minorEnd + 1))) patch = s.slice(minorEnd + 1, digitsEnd(minorEnd + 1));
      return [Number(s.slice(i, majorEnd)), Number(s.slice(majorEnd + 1, minorEnd)), Number(patch)];
    }
    i = majorEnd;
  }
  return null;
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}
