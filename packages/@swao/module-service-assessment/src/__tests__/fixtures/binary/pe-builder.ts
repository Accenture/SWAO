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
 * Synthetic PE images and PKCS#7 blobs for Pass 25 tests. Minimal but
 * structurally valid: DOS header, PE/COFF header, optional header with data
 * directories, one section holding the import table and CLR metadata, and an
 * optional WIN_CERTIFICATE table. Nothing here is executable.
 */

// ---------------------------------------------------------------- DER

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
export const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);
const int = (hex: string) => {
  const b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  return der(0x02, (b[0] as number) & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
};
const oid = (hex: string) => Buffer.from(hex, 'hex');
const OID_SIGNED_DATA = oid('06092a864886f70d010702');
const OID_DATA = oid('06092a864886f70d010701');
const OID_COUNTERSIGNATURE = oid('06092a864886f70d010906');

/** ContentInfo(SignedData) with one certificate and a SignerInfo pointing at it by serial. */
export function pkcs7(cert: Buffer, serialHex: string, timestamped: boolean): Buffer {
  const unsigned = timestamped ? [der(0xa1, seq(OID_COUNTERSIGNATURE, set(seq())))] : [];
  const signerInfo = seq(int('01'), seq(seq(), int(serialHex)), seq(), seq(), der(0x04, Buffer.from('sig')), ...unsigned);
  const signedData = seq(int('01'), set(), seq(OID_DATA), der(0xa0, cert), set(signerInfo));
  return seq(OID_SIGNED_DATA, der(0xa0, signedData));
}

// ---------------------------------------------------------------- PE

export interface PeOptions {
  machine?: 'x86' | 'x64';
  timestamp?: Date;
  imports?: string[];
  /** CLR metadata version string, e.g. 'v2.0.50727'; omit for a native image. */
  dotnet?: { metadataVersion: string; anyCpu: boolean; targetFramework?: string };
  /** PKCS#7 blob for the certificate table; omit for an unsigned image. */
  signature?: Buffer;
}

const SECTION_VA = 0x1000;
const SECTION_RAW = 0x400;
const SECTION_SIZE = 0x1000;

export function buildPe(opts: PeOptions = {}): Buffer {
  const x64 = (opts.machine ?? 'x64') === 'x64';
  const optSize = x64 ? 0xf0 : 0xe0;
  const headers = Buffer.alloc(SECTION_RAW);
  headers.write('MZ', 0, 'latin1');
  headers.writeUInt32LE(0x80, 0x3c);
  headers.write('PE\0\0', 0x80, 'latin1');
  const coff = 0x84;
  headers.writeUInt16LE(x64 ? 0x8664 : 0x14c, coff);
  headers.writeUInt16LE(1, coff + 2);
  headers.writeUInt32LE(Math.floor((opts.timestamp ?? new Date('2020-06-01T00:00:00Z')).getTime() / 1000), coff + 4);
  headers.writeUInt16LE(optSize, coff + 16);
  const opt = coff + 20;
  headers.writeUInt16LE(x64 ? 0x20b : 0x10b, opt);
  headers.writeUInt32LE(16, opt + (x64 ? 108 : 92));
  const dirs = opt + (x64 ? 112 : 96);
  const setDir = (i: number, rva: number, size: number) => { headers.writeUInt32LE(rva, dirs + i * 8); headers.writeUInt32LE(size, dirs + i * 8 + 4); };

  const section = Buffer.alloc(SECTION_SIZE);
  let cursor = 0;
  const place = (b: Buffer) => { const at = cursor; b.copy(section, at); cursor += b.length + ((8 - (b.length % 8)) % 8); return at; };

  const imports = opts.imports ?? [];
  if (imports.length > 0) {
    const descAt = place(Buffer.alloc((imports.length + 1) * 20));
    imports.forEach((name, i) => {
      const nameAt = place(Buffer.from(`${name}\0`, 'latin1'));
      section.writeUInt32LE(SECTION_VA + nameAt, descAt + i * 20 + 12);
    });
    setDir(1, SECTION_VA + descAt, (imports.length + 1) * 20);
  }
  if (opts.dotnet) {
    const ver = Buffer.from(`${opts.dotnet.metadataVersion}\0\0\0\0`.slice(0, Math.ceil((opts.dotnet.metadataVersion.length + 1) / 4) * 4), 'latin1');
    const md = Buffer.alloc(16 + ver.length);
    md.writeUInt32LE(0x424a5342, 0);
    md.writeUInt32LE(ver.length, 12);
    ver.copy(md, 16);
    const mdAt = place(md);
    const cor = Buffer.alloc(72);
    cor.writeUInt32LE(72, 0);
    cor.writeUInt32LE(SECTION_VA + mdAt, 8);
    cor.writeUInt32LE(md.length, 12);
    cor.writeUInt32LE(opts.dotnet.anyCpu ? 0x1 : 0x3, 16);
    const corAt = place(cor);
    setDir(14, SECTION_VA + corAt, 72);
    if (opts.dotnet.targetFramework) place(Buffer.from(`\x01\x00${opts.dotnet.targetFramework}\0`, 'latin1'));
  }

  const sec = opt + optSize;
  headers.write('.text', sec, 'latin1');
  headers.writeUInt32LE(SECTION_SIZE, sec + 8);
  headers.writeUInt32LE(SECTION_VA, sec + 12);
  headers.writeUInt32LE(SECTION_SIZE, sec + 16);
  headers.writeUInt32LE(SECTION_RAW, sec + 20);

  let image = Buffer.concat([headers, section]);
  if (opts.signature) {
    const win = Buffer.alloc(8);
    win.writeUInt32LE(8 + opts.signature.length, 0);
    win.writeUInt16LE(0x0200, 4);
    win.writeUInt16LE(0x0002, 6);
    const table = Buffer.concat([win, opts.signature]);
    setDir(4, image.length, table.length);
    image = Buffer.concat([headers, section, table]);
  }
  return image;
}
