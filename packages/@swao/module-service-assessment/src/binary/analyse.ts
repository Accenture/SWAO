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
 * Pass 25 BINARY (Design 103 §6.3, #3104-#3106): offline, static analysis of
 * installers and executables the analyst supplied. Runs before its consumers
 * (VirusTotal in `swao service research`, CRYPTO in `swao assess`), is
 * idempotent, and reuses hashes for files whose size and mtime are unchanged.
 *
 * Inputs: `apps/<id>/ingestion/binary/**` and `apps/<id>/wsp/inputs/binary/**`
 * (SWAO-generated files excluded). With `SWAO_LOCAL_BINARY_SCAN=true` and an
 * explicit `binary.local_install_path` in the app `.swao.yml`, a live installed
 * folder is scanned read-only as well.
 *
 * Outputs: `apps/<id>/wsp/inputs/binary/binary-analysis.json` and
 * `apps/<id>/wsp/signals/binary-signals.json`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load } from 'js-yaml';
import { BinarySignalsFileSchema, binarySignal, type BinarySignal } from '@swao/core';
import { dotnetVersion, parsePe, type PeInfo } from './pe.js';
import { parseMsi, type MsiInfo } from './msi.js';
import { BoundedReader, sha256File } from './reader.js';

export const BINARY_ANALYSIS_FILE = 'binary-analysis.json';
/** Files SWAO writes into wsp/inputs/binary/ itself; never treated as analyst input. */
export const GENERATED_BINARY_FILES = new Set([BINARY_ANALYSIS_FILE, 'manifest.json']);
const MAX_FILES = 500;

export interface BinaryFileResult {
  path: string;
  sha256: string;
  size: number;
  mtime_ms: number;
  kind: 'pe' | 'msi';
  pe?: PeInfo;
  msi?: MsiInfo;
  /** Signer certificate summary for Pass 08 CRYPTO (`files[].certificates[].not_after`). */
  certificates: Array<{ subject: string; issuer: string; not_after: string; timestamped: boolean }>;
}

/**
 * Installer and executable formats Pass 25 recognises by extension but does not
 * parse (#3154): only PE (exe, dll, sys, ...) and MSI are read. They are listed
 * in `binary-analysis.json` as `unsupported_files` so the gap is visible; they
 * still count as binary inputs for Pass 14 MALWARE, whose scanner reads them.
 */
export const UNPARSED_BINARY_FORMATS: Readonly<Record<string, string>> = {
  msix: 'msix', msixbundle: 'msix', appx: 'appx', appxbundle: 'appx',
  jar: 'jar', war: 'jar', ear: 'jar',
  so: 'elf', bin: 'unknown', deb: 'deb', rpm: 'rpm', dmg: 'dmg', pkg: 'pkg',
  // #3212: recognised anywhere under ingestion/ but not parsed; listed, never silently ignored
  msp: 'msp', cab: 'cab', dylib: 'mach-o',
};

export interface BinaryAnalysis {
  generated_at: string;
  app_id: string;
  files: BinaryFileResult[];
  /** Files with a binary extension that Pass 25 does not parse (MSIX, APPX, JAR, ELF, ...). */
  unsupported_files: Array<{ path: string; format: string }>;
  skipped_reason?: 'no_binary_inputs';
  msi_skipped_reason?: 'no_msi_inputs';
  local_scan: { enabled: boolean; path: string | null };
}

function walk(dir: string, out: string[], only?: RegExp): void {
  if (!existsSync(dir) || out.length >= MAX_FILES) return;
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out, only);
    else if (!GENERATED_BINARY_FILES.has(n) && (!only || only.test(n)) && out.length < MAX_FILES && !out.includes(p)) out.push(p);
  }
}

/** Installer and package formats recognised anywhere under `ingestion/` (#3212). */
export const BINARY_CANDIDATE_FILE = /\.(exe|dll|sys|msi|msp|msix|appx|jar|war|ear|so|dylib|cab|pkg|dmg|deb|rpm)$/i;

function localInstallPath(appDir: string): string | null {
  if (process.env['SWAO_LOCAL_BINARY_SCAN'] !== 'true') return null;
  try {
    const doc = load(readFileSync(join(appDir, '.swao.yml'), 'utf-8')) as { binary?: { local_install_path?: unknown } } | null;
    const p = doc?.binary?.local_install_path;
    return typeof p === 'string' && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function previous(appDir: string): Map<string, BinaryFileResult> {
  const p = join(appDir, 'wsp', 'inputs', 'binary', BINARY_ANALYSIS_FILE);
  try {
    const doc = JSON.parse(readFileSync(p, 'utf-8')) as { files?: BinaryFileResult[] };
    return new Map((doc.files ?? []).map((f) => [f.path, f]));
  } catch {
    return new Map();
  }
}

function analyseFile(abs: string, rel: string, prev: BinaryFileResult | undefined): BinaryFileResult | null {
  const st = statSync(abs);
  const reader = new BoundedReader(abs);
  try {
    const pe = parsePe(reader);
    const msi = pe ? null : parseMsi(reader);
    if (!pe && !msi) return null;
    const sha256 = prev && prev.size === st.size && prev.mtime_ms === st.mtimeMs ? prev.sha256 : sha256File(abs);
    const signer = pe?.signature.signer;
    return {
      path: rel,
      sha256,
      size: st.size,
      mtime_ms: st.mtimeMs,
      kind: pe ? 'pe' : 'msi',
      ...(pe ? { pe } : {}),
      ...(msi ? { msi } : {}),
      certificates: signer ? [{ subject: signer.subject, issuer: signer.issuer, not_after: signer.not_after, timestamped: pe?.signature.timestamped ?? false }] : [],
    };
  } finally {
    reader.close();
  }
}

/** Derive BINARY.* signals from the analysis (evidence cites file paths, never contents). */
export function binarySignals(files: readonly BinaryFileResult[], now: Date): BinarySignal[] {
  const pes = files.filter((f) => f.kind === 'pe' && f.pe && !f.pe.parse_error);
  const out: BinarySignal[] = [];
  const unsigned = pes.filter((f) => !f.pe!.signature.present);
  if (unsigned.length > 0) {
    out.push(binarySignal('BINARY.UNSIGNED', {
      severity: 'medium',
      derivation: `${unsigned.length} executable(s) carry no embedded Authenticode signature (catalog-signed system files also appear unsigned to static analysis).`,
      evidence: unsigned.slice(0, 20).map((f) => f.path),
    }));
  }
  const expired = pes.filter((f) => f.certificates.some((c) => Date.parse(c.not_after) < now.getTime()));
  const untimed = expired.filter((f) => f.certificates.some((c) => !c.timestamped));
  const timed = expired.filter((f) => !untimed.includes(f));
  // #3154: one BIN-02 per run. Severity follows the worst state (an untimestamped
  // expired signature is invalid; a timestamped one stays valid); evidence lists both.
  if (untimed.length > 0 || timed.length > 0) {
    const parts = [
      ...(untimed.length > 0 ? [`${untimed.length} executable(s) are signed with an expired certificate and no timestamp, so the signature is no longer valid`] : []),
      ...(timed.length > 0 ? [`${timed.length} executable(s) have an expired signer certificate but a timestamped signature, which remains valid`] : []),
    ];
    out.push(binarySignal('BINARY.EXPIRED_CERT', {
      severity: untimed.length > 0 ? 'high' : 'informational',
      derivation: `${parts.join('; ')}.`,
      evidence: [
        ...untimed.map((f) => `${f.path}: signer expired ${f.certificates[0]!.not_after.slice(0, 10)}`),
        ...timed.map((f) => `${f.path}: signer expired ${f.certificates[0]!.not_after.slice(0, 10)} (timestamped)`),
      ].slice(0, 20),
    }));
  }
  const legacy = pes.flatMap((f) => {
    const reasons: string[] = [];
    const tf = f.pe!.dotnet?.target_framework ?? null;
    const tfv = dotnetVersion(tf);
    const md = dotnetVersion(f.pe!.dotnet?.metadata_version);
    if (tf?.startsWith('.NETFramework') && tfv && (tfv[0] < 4 || (tfv[0] === 4 && (tfv[1] < 6 || (tfv[1] === 6 && tfv[2] < 2))))) reasons.push(`${tf} (< 4.6.2)`);
    else if (!tf && md && md[0] < 4) reasons.push(`.NET ${f.pe!.dotnet!.metadata_version} (2.0-3.5)`);
    if (f.pe!.vc_runtime && f.pe!.vc_runtime.year < 2015) reasons.push(`${f.pe!.vc_runtime.dll} (MSVC ${f.pe!.vc_runtime.year})`);
    return reasons.length > 0 ? [`${f.path}: ${reasons.join(', ')}`] : [];
  });
  if (legacy.length > 0) {
    out.push(binarySignal('BINARY.LEGACY_RUNTIME', {
      severity: 'high',
      derivation: `${legacy.length} executable(s) depend on an out-of-support runtime (.NET Framework below 4.6.2 or a Visual C++ runtime before 2015).`,
      evidence: legacy.slice(0, 20),
    }));
  }
  const x86 = pes.filter((f) => f.pe!.arch === 'x86' && !(f.pe!.dotnet?.any_cpu));
  if (x86.length > 0) {
    out.push(binarySignal('BINARY.LEGACY_ARCH', {
      severity: 'low',
      derivation: `${x86.length} executable(s) are 32-bit x86 only (not AnyCPU), which limits 64-bit hosting and some cloud images.`,
      evidence: x86.slice(0, 20).map((f) => f.path),
    }));
  }
  const future = pes.filter((f) => f.pe!.compiled_at && Date.parse(f.pe!.compiled_at) > now.getTime() + 86_400_000);
  if (future.length > 0) {
    out.push(binarySignal('BINARY.COMPILATION_DATE_ANOMALY', {
      severity: 'low',
      confidence: 'low',
      derivation: `${future.length} executable(s) have a PE timestamp in the future; often a reproducible-build hash, occasionally tampering.`,
      evidence: future.slice(0, 20).map((f) => `${f.path}: ${f.pe!.compiled_at}`),
    }));
  }
  return out;
}

export function runBinaryAnalysis(workspacePath: string, appId: string, opts: { now?: Date } = {}): { analysis: BinaryAnalysis; signals: BinarySignal[] } {
  const now = opts.now ?? new Date();
  const appDir = join(workspacePath, 'apps', appId);
  const files: string[] = [];
  walk(join(appDir, 'ingestion', 'binary'), files);
  // #3212: installers dropped anywhere else in ingestion/ count too (no hint folder needed)
  walk(join(appDir, 'ingestion'), files, BINARY_CANDIDATE_FILE);
  walk(join(appDir, 'wsp', 'inputs', 'binary'), files);
  const live = localInstallPath(appDir);
  if (live) walk(live, files);
  const prev = previous(appDir);
  const results: BinaryFileResult[] = [];
  const unsupported: Array<{ path: string; format: string }> = [];
  for (const abs of files) {
    const rel = live && abs.startsWith(live) ? `local:${relative(live, abs).replace(/\\/g, '/')}` : relative(appDir, abs).replace(/\\/g, '/');
    let r: BinaryFileResult | null = null;
    try {
      r = analyseFile(abs, rel, prev.get(rel));
    } catch { /* unreadable file: skip */ }
    if (r) { results.push(r); continue; }
    const format = UNPARSED_BINARY_FORMATS[(/\.([a-z0-9]+)$/i.exec(abs)?.[1] ?? '').toLowerCase()];
    if (format) unsupported.push({ path: rel, format });
  }
  const analysis: BinaryAnalysis = {
    generated_at: now.toISOString(),
    app_id: appId,
    files: results,
    unsupported_files: unsupported,
    ...(results.length === 0 ? { skipped_reason: 'no_binary_inputs' as const } : {}),
    ...(results.some((r) => r.kind === 'msi') ? {} : { msi_skipped_reason: 'no_msi_inputs' as const }),
    local_scan: { enabled: process.env['SWAO_LOCAL_BINARY_SCAN'] === 'true', path: live },
  };
  const signals = binarySignals(results, now);
  const outDir = join(appDir, 'wsp', 'inputs', 'binary');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, BINARY_ANALYSIS_FILE), `${JSON.stringify(analysis, null, 2)}\n`, 'utf-8');
  const sigDir = join(appDir, 'wsp', 'signals');
  mkdirSync(sigDir, { recursive: true });
  writeFileSync(join(sigDir, 'binary-signals.json'), `${JSON.stringify(BinarySignalsFileSchema.parse({ generated_at: now.toISOString(), app_id: appId, signals }), null, 2)}\n`, 'utf-8');
  return { analysis, signals };
}
