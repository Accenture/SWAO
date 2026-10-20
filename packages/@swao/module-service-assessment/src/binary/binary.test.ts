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

// Phase 5 suite (#3104-#3107): Pass 25 BINARY.
import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BinarySignalsFileSchema } from '@swao/core';
import { CERT_EXPIRED_DER, CERT_VALID_DER, P7_VALID, SERIAL_EXPIRED } from '../__tests__/fixtures/binary/certs.js';
import { buildPe, pkcs7 } from '../__tests__/fixtures/binary/pe-builder.js';
import { planServicePasses } from '../profile/service-pass-profile.js';
import { runServiceCryptoPass } from '../profile/service-passes.js';
import { readBinaryHash } from '../research/vt-client.js';
import { runBinaryAnalysis } from './analyse.js';
import { parseMsi } from './msi.js';
import { parsePe } from './pe.js';
import { BoundedReader } from './reader.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '__tests__', 'fixtures', 'binary');
const NOW = new Date('2026-10-10T00:00:00Z');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function app(files: Record<string, Buffer | string>): { ws: string; appDir: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-binary-'));
  dirs.push(ws);
  const appDir = join(ws, 'apps', 'hosapp001');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, '.swao.yml'), 'assessment:\n  type: service\n');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(appDir, rel)), { recursive: true });
    writeFileSync(join(appDir, rel), content);
  }
  return { ws, appDir };
}

const codes = (signals: Array<{ code: string; severity?: string }>) => signals.map((s) => `${s.code}:${s.severity}`);
const parseBuffer = (buf: Buffer) => {
  const { appDir } = app({ 'x.bin': buf });
  const r = new BoundedReader(join(appDir, 'x.bin'));
  try { return parsePe(r); } finally { r.close(); }
};

describe('PE header parsing (#3104)', () => {
  it('reads architecture, compile time, imports, and the signer of a signed x64 image', () => {
    const pe = parseBuffer(buildPe({ machine: 'x64', imports: ['KERNEL32.dll', 'VCRUNTIME140.dll'], signature: pkcs7(CERT_VALID_DER, '60FBB5CCC94C38D71F5D0987A38552D06F7BE856', false) }))!;
    expect(pe).toMatchObject({ arch: 'x64', pe32_plus: true, compiled_at: '2020-06-01T00:00:00.000Z', vc_runtime: { year: 2015 } });
    expect(pe.imports).toEqual(['kernel32.dll', 'vcruntime140.dll']);
    expect(pe.signature).toMatchObject({ present: true, timestamped: false });
    expect(pe.signature.signer?.subject).toMatch(/Example Vendor Code Signing 2/);
    expect(pe.signature.signer?.not_after.slice(0, 10)).toBe('2035-01-01');
  });

  it('reads a degenerate PKCS#7 (certificates, no SignerInfo) and picks the leaf', () => {
    const pe = parseBuffer(buildPe({ signature: P7_VALID }))!;
    expect(pe.signature.signer?.not_after.slice(0, 10)).toBe('2035-01-01');
  });

  it('detects .NET metadata, AnyCPU, and the TargetFramework string', () => {
    const net6 = parseBuffer(buildPe({ machine: 'x86', dotnet: { metadataVersion: 'v4.0.30319', anyCpu: true, targetFramework: '.NETCoreApp,Version=v6.0' } }))!;
    expect(net6.dotnet).toEqual({ metadata_version: 'v4.0.30319', target_framework: '.NETCoreApp,Version=v6.0', any_cpu: true });
  });

  it('never throws on truncated or random input', () => {
    const good = buildPe({ signature: P7_VALID });
    for (const buf of [good.subarray(0, 100), good.subarray(0, 0x200), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0xff)]), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) & 0xff))]) {
      expect(() => parseBuffer(buf)).not.toThrow();
    }
    const corrupt = Buffer.from(good);
    corrupt.writeUInt32LE(0x7fffffff, corrupt.length - P7_VALID.length - 8);
    expect(parseBuffer(corrupt)?.signature.parse_error).toBeDefined();
  });
});

describe('MSI property table (#3105)', () => {
  it('extracts ProductVersion, Manufacturer, ProductName, and install dir from a real MSI', () => {
    const r = new BoundedReader(join(FIXTURES, 'fixture.msi'));
    try {
      expect(parseMsi(r)).toMatchObject({
        product_version: '5.3.2.1', manufacturer: 'Example Medical Systems GmbH', product_name: 'Example Imaging Suite',
        install_dir: 'ProgramFilesFolder\\ExampleImaging', product_code: '{11111111-2222-3333-4444-555555555555}',
      });
    } finally { r.close(); }
  });

  it('reports a parse error, not an exception, for a corrupt compound file', () => {
    const msi = readFileSync(join(FIXTURES, 'fixture.msi'));
    const broken = Buffer.from(msi.subarray(0, 1024));
    const { appDir } = app({ 'broken.msi': broken });
    const r = new BoundedReader(join(appDir, 'broken.msi'));
    try { expect(parseMsi(r)?.parse_error).toBeDefined(); } finally { r.close(); }
  });
});

describe('BINARY signals and binary-analysis.json (#3106, #3107)', () => {
  const run = (files: Record<string, Buffer | string>) => {
    const { ws, appDir } = app(files);
    return { ...runBinaryAnalysis(ws, 'hosapp001', { now: NOW }), ws, appDir };
  };

  it('finds installers anywhere under ingestion/, not only in ingestion/binary/ (#3212)', () => {
    const r = run({ 'ingestion/plain.exe': buildPe(), 'ingestion/vendor/manual.pdf': '%PDF-1.4' });
    expect(codes(r.signals)).toEqual(['BINARY.UNSIGNED:medium']);
    expect(r.analysis.files.map((f) => f.path)).toEqual(['ingestion/plain.exe']);
  });

  it('lists recognised but unparsed packages (.msp, .cab, .dylib) as unsupported, never ignores them (#3212)', () => {
    const r = run({ 'ingestion/patch.msp': 'x', 'ingestion/drivers.cab': 'x', 'ingestion/lib/libapp.dylib': 'x' });
    expect(r.analysis.unsupported_files.map((u) => `${u.path}:${u.format}`).sort()).toEqual([
      'ingestion/drivers.cab:cab', 'ingestion/lib/libapp.dylib:mach-o', 'ingestion/patch.msp:msp',
    ]);
  });

  it('signed image: no BINARY.UNSIGNED; unsigned image: BINARY.UNSIGNED', () => {
    expect(codes(run({ 'ingestion/binary/signed.exe': buildPe({ signature: P7_VALID }) }).signals)).toEqual([]);
    expect(codes(run({ 'ingestion/binary/plain.exe': buildPe() }).signals)).toEqual(['BINARY.UNSIGNED:medium']);
  });

  it('expired signer without timestamp: high; with timestamp: informational', () => {
    const untimed = run({ 'ingestion/binary/a.exe': buildPe({ signature: pkcs7(CERT_EXPIRED_DER, SERIAL_EXPIRED, false) }) });
    expect(codes(untimed.signals)).toEqual(['BINARY.EXPIRED_CERT:high']);
    expect(untimed.signals[0]!.evidence[0]).toBe('ingestion/binary/a.exe: signer expired 2023-01-01');
    const timed = run({ 'ingestion/binary/a.exe': buildPe({ signature: pkcs7(CERT_EXPIRED_DER, SERIAL_EXPIRED, true) }) });
    expect(codes(timed.signals)).toEqual(['BINARY.EXPIRED_CERT:informational']);
  });

  it('one timed and one untimed expired signer: exactly one BIN-02, high, with evidence for both (#3154)', () => {
    const mixed = run({
      'ingestion/binary/a.exe': buildPe({ signature: pkcs7(CERT_EXPIRED_DER, SERIAL_EXPIRED, false) }),
      'ingestion/binary/b.exe': buildPe({ signature: pkcs7(CERT_EXPIRED_DER, SERIAL_EXPIRED, true) }),
    });
    const bin02 = mixed.signals.filter((s) => s.id === 'BIN-02');
    expect(bin02).toHaveLength(1);
    expect(bin02[0]!.severity).toBe('high');
    expect(bin02[0]!.evidence).toEqual(['ingestion/binary/a.exe: signer expired 2023-01-01', 'ingestion/binary/b.exe: signer expired 2023-01-01 (timestamped)']);
    expect(bin02[0]!.derivation).toMatch(/1 executable\(s\) are signed .* no timestamp.*; 1 executable\(s\) have an expired signer certificate but a timestamped/);
    expect(new Set(mixed.signals.map((s) => s.id)).size).toBe(mixed.signals.length);
  });

  it('.NET 2.0 and MSVC 2008 are legacy runtimes; .NET 6 is not', () => {
    const net2 = run({ 'ingestion/binary/a.exe': buildPe({ signature: P7_VALID, dotnet: { metadataVersion: 'v2.0.50727', anyCpu: true } }) });
    expect(codes(net2.signals)).toEqual(['BINARY.LEGACY_RUNTIME:high']);
    const vc9 = run({ 'ingestion/binary/a.exe': buildPe({ signature: P7_VALID, imports: ['MSVCR90.dll'] }) });
    expect(vc9.signals[0]!.evidence[0]).toMatch(/msvcr90\.dll \(MSVC 2008\)/);
    const net6 = run({ 'ingestion/binary/a.exe': buildPe({ signature: P7_VALID, dotnet: { metadataVersion: 'v4.0.30319', anyCpu: true, targetFramework: '.NETCoreApp,Version=v6.0' } }) });
    expect(codes(net6.signals)).toEqual([]);
    const net45 = run({ 'ingestion/binary/a.exe': buildPe({ signature: P7_VALID, dotnet: { metadataVersion: 'v4.0.30319', anyCpu: true, targetFramework: '.NETFramework,Version=v4.5' } }) });
    expect(codes(net45.signals)).toEqual(['BINARY.LEGACY_RUNTIME:high']);
  });

  it('x86-only image: BINARY.LEGACY_ARCH; x86 AnyCPU .NET image: none', () => {
    expect(codes(run({ 'ingestion/binary/a.exe': buildPe({ machine: 'x86', signature: P7_VALID }) }).signals)).toEqual(['BINARY.LEGACY_ARCH:low']);
    expect(codes(run({ 'ingestion/binary/a.exe': buildPe({ machine: 'x86', signature: P7_VALID, dotnet: { metadataVersion: 'v4.0.30319', anyCpu: true, targetFramework: '.NETFramework,Version=v4.8' } }) }).signals)).toEqual([]);
  });

  it('future compile timestamp: BINARY.COMPILATION_DATE_ANOMALY', () => {
    expect(codes(run({ 'ingestion/binary/a.exe': buildPe({ signature: P7_VALID, timestamp: new Date('2031-01-01T00:00:00Z') }) }).signals)).toEqual(['BINARY.COMPILATION_DATE_ANOMALY:low']);
  });

  it('no binary inputs: skipped_reason no_binary_inputs, and empty signals file', () => {
    const r = run({ 'ingestion/binary/config/app.ini': 'x=1\n' });
    expect(r.analysis).toMatchObject({ skipped_reason: 'no_binary_inputs', msi_skipped_reason: 'no_msi_inputs', files: [] });
    const file = BinarySignalsFileSchema.parse(JSON.parse(readFileSync(join(r.appDir, 'wsp', 'signals', 'binary-signals.json'), 'utf-8')));
    expect(file.signals).toEqual([]);
  });

  it('lists MSIX, APPX, and JAR files as unsupported instead of counting them as parsed inputs (#3154)', () => {
    const r = run({
      'ingestion/binary/app.msix': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x6d, 0x73, 0x69, 0x78]),
      'ingestion/binary/client.jar': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x6a, 0x61, 0x72]),
      'ingestion/binary/config/app.ini': 'x=1',
    });
    expect(r.analysis.files).toEqual([]);
    expect(r.analysis.skipped_reason).toBe('no_binary_inputs');
    expect(r.analysis.unsupported_files).toEqual([
      { path: 'ingestion/binary/app.msix', format: 'msix' },
      { path: 'ingestion/binary/client.jar', format: 'jar' },
    ]);
    const onDisk = JSON.parse(readFileSync(join(r.appDir, 'wsp', 'inputs', 'binary', 'binary-analysis.json'), 'utf-8'));
    expect(onDisk.unsupported_files).toHaveLength(2);
    // They still gate Pass 14 MALWARE, whose scanner reads archives.
    expect(planServicePasses(r.appDir, ['malware']).run).toEqual(['malware']);
  });

  it('merges MSI results into binary-analysis.json', () => {
    const { ws, appDir } = app({});
    mkdirSync(join(appDir, 'ingestion', 'binary'), { recursive: true });
    copyFileSync(join(FIXTURES, 'fixture.msi'), join(appDir, 'ingestion', 'binary', 'setup.msi'));
    const r = runBinaryAnalysis(ws, 'hosapp001', { now: NOW });
    expect(r.analysis.files[0]).toMatchObject({ kind: 'msi', msi: { product_version: '5.3.2.1', manufacturer: 'Example Medical Systems GmbH' } });
    expect(r.analysis.msi_skipped_reason).toBeUndefined();
    expect(r.analysis.files[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Pass 25 consumers', () => {
  it('feeds the installer hash to VirusTotal and untimed expired certificates to CRYPTO', async () => {
    const { ws, appDir } = app({ 'ingestion/binary/a.exe': buildPe({ signature: pkcs7(CERT_EXPIRED_DER, SERIAL_EXPIRED, false) }), 'ingestion/binary/config/app.ini': 'hash=md5\n' });
    runBinaryAnalysis(ws, 'hosapp001', { now: NOW });
    expect(readBinaryHash(join(appDir, 'wsp', 'inputs', 'binary', 'binary-analysis.json'))).toMatch(/^[a-f0-9]{64}$/);
    // Regression: the generated binary-analysis.json must not hide ingestion/binary/ from CRYPTO.
    const plan = planServicePasses(appDir, ['crypto']);
    expect(plan.sourceOverrides['crypto']).toBe(join(appDir, 'ingestion', 'binary'));
    const crypto = await runServiceCryptoPass({ appId: 'hosapp001', sourcePath: plan.sourceOverrides['crypto']!, workspacePath: appDir, iter: 1, assessedAt: '2026-10-10' });
    expect(crypto.signals.map((s) => s.derivation.match(/CRYPTO\.(\w+)/)?.[1])).toEqual(['WEAK_ALGORITHM', 'EXPIRED_CERT']);
  });

  it('reuses the hash when size and mtime are unchanged', () => {
    const { ws, appDir } = app({ 'ingestion/binary/a.exe': buildPe({ signature: P7_VALID }) });
    const first = runBinaryAnalysis(ws, 'hosapp001', { now: NOW }).analysis.files[0]!;
    const path = join(appDir, 'wsp', 'inputs', 'binary', 'binary-analysis.json');
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    doc.files[0].sha256 = 'b'.repeat(64);
    writeFileSync(path, JSON.stringify(doc));
    expect(runBinaryAnalysis(ws, 'hosapp001', { now: NOW }).analysis.files[0]!.sha256).toBe('b'.repeat(64));
    expect(first.sha256).not.toBe('b'.repeat(64));
  });
});
