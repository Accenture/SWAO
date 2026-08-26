// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  rmdirSync,
} from 'fs';
import { join, relative, extname, basename, dirname } from 'path';
import { createHash } from 'crypto';
import { classifyFile } from '../normalize/classifier.js';
import { ingestPulumiStacks } from '@swao/module-iac';

/**
 * Pass 00 (INGEST) -- ingestion-folder normalisation pre-pass (#0551).
 *
 * Operators drop unstructured files into `<app>/ingestion/`. Before the
 * signal-emitting passes run, this pre-pass:
 * 1. Routes each file into wsp/inputs/ using content-based classification.
 * 2. Skips unchanged files (SHA-256 delta against prior manifest).
 * 3. Cleans up derived files when sources are removed from ingestion/.
 * 4. Extracts text from binary files (PDF -> .txt, DOCX -> .md, XLSX -> .csv,
 *    PPTX -> .txt) so the CTX LLM can read them.
 * 5. Warns on files dropped directly into wsp/inputs/ dynamic subfolders.
 *
 * The manifest is written to `ingestion/ingestion-manifest.json` so the next
 * run can read it for delta detection. A full run short-circuits when all
 * SHA-256 match and all companion files are present.
 */

/** Subfolder categories routed by Pass 00. */
export type IngestCategory =
  | 'architecture'
  | 'compliance'
  | 'operations'
  | 'workshops'
  | 'structured'
  | 'terraform'
  | 'docs'
  | 'intake'
  | 'other'; // retained for manifest backward compat

export interface IngestedFile {
  /** Relative to ingestion dir, forward slashes. */
  source: string;
  /** Relative to wsp/inputs/, forward slashes. */
  target: string;
  /** Destination subfolder name (equals first path component of target). */
  category: string;
  sha256: string;
  bytes: number;
  /** Companion extracted file(s) relative to wsp/inputs/, null when not extracted. */
  extracted_path?: string | string[] | null;
}

// #0999: Rejected files are tracked in the manifest so delta detection can
// skip re-warning when the same file is re-ingested unchanged.
export interface RejectedIngestEntry {
  source: string;
  status: 'rejected';
  reason: string;
  sha256: string;
  bytes: number;
}

// #1062: Images auto-converted to PDF wrapper -- tracked separately from rejected.
export interface ConvertedIngestEntry {
  source: string;
  status: 'converted';
  target: string;   // relative to wsp/inputs/, e.g. "docs/diagram.pdf"
  sha256: string;   // sha256 of the original image source
  bytes: number;
}

export interface IngestManifest {
  schema_version: string;
  generated_at: string;
  /** Relative path of ingestion/ from workspace root. */
  ingestion_dir: string;
  /** Relative path of wsp/inputs/ from workspace root. */
  imports_dir: string;
  files: IngestedFile[];
  /** Dynamic counts keyed by subfolder name. Only non-zero counts are present. */
  counts: Record<string, number>;
  /** Files that were rejected (images, archives) -- tracked for delta detection (#0999). */
  rejected?: RejectedIngestEntry[];
  /** Images auto-converted to PDF wrapper -- tracked for delta detection (#1062). */
  converted?: ConvertedIngestEntry[];
}

/**
 * Subfolders Pass 00 must never scan or auto-delete from.
 * cmdb is reserved because scaffoldImports() pre-creates it with a probe stub.
 */
const RESERVED_SUBFOLDERS = new Set([
  'source', 'catalogs', 'terraform', 'yara-rules',
  'checklists', 'evidence', 'interviews', 'cmdb',
]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp', '.webp', '.ico']);
const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar']);
const BINARY_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx']);
const MAX_EXTRACTION_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Resolve the wsp/inputs/ subfolder for an ingestion file. Calls classifier.ts
 * first (specific patterns win), then falls back to extension-based routing for
 * types the classifier has no specific rule for.
 */
function resolveIngestSubdir(sourceAbs: string, fileName: string): string {
  const lower = basename(fileName).toLowerCase();
  const classified = classifyFile(sourceAbs, lower);

  if (classified.category !== 'unknown') {
    // IaC: classifier routes to source/ (CTX-skipped) -- override to terraform/
    if (classified.category === 'iac') return 'terraform';
    // Source code: not useful as LLM context input -- route to intake/
    if (classified.category === 'source_code') return 'intake';
    return classified.targetSubdir.replace(/\/$/, '');
  }

  const ext = extname(fileName).toLowerCase();
  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') return 'operations';
  if (ext === '.pdf' || ext === '.docx' || ext === '.doc' || ext === '.pptx') return 'docs';
  if (ext === '.yaml' || ext === '.yml' || ext === '.json') return 'structured';
  if (ext === '.md' || ext === '.txt') return 'architecture';
  if (ext === '.tf' || ext === '.tfstate' || ext === '.tfplan' || ext === '.hcl') return 'terraform';
  return 'intake';
}

/**
 * Classify a file by filename. Kept for backward compat; prefer resolveIngestSubdir.
 * @deprecated Use resolveIngestSubdir(absPath, fileName) in new code.
 */
export function classifyIngestFile(fileName: string): string {
  return resolveIngestSubdir(fileName, fileName);
}

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function listFiles(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix))) {
    const rel = prefix ? join(prefix, entry) : entry;
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) out.push(...listFiles(root, rel));
    else out.push(rel);
  }
  return out;
}

function companionsExist(importsDir: string, ep: string | string[] | null | undefined): boolean {
  if (!ep) return true;
  const paths = Array.isArray(ep) ? ep : [ep];
  return paths.every((p) => existsSync(join(importsDir, p)));
}

/** Remove a file within wsp/inputs/ and clean up empty ancestor directories. */
function safeDeleteTarget(importsDir: string, targetRel: string): void {
  const abs = join(importsDir, targetRel);
  const rel = relative(importsDir, abs);
  if (rel.startsWith('..')) return; // path-traversal guard
  if (!existsSync(abs)) return;
  unlinkSync(abs);
  let dir = dirname(abs);
  while (dir.length > importsDir.length) {
    try { rmdirSync(dir); dir = dirname(dir); } catch { break; }
  }
}

// ---------------------------------------------------------------------------
// Binary extraction (#0966)
// ---------------------------------------------------------------------------

async function extractBinary(
  sourceAbs: string,
  targetAbs: string,
  targetRel: string,
  fileName: string,
  warn: (m: string) => void,
): Promise<string | string[] | null> {
  const ext = extname(fileName).toLowerCase();
  if (statSync(sourceAbs).size > MAX_EXTRACTION_BYTES) {
    warn(`[warn] INGEST: ${fileName} is larger than 10 MB -- extraction skipped, binary copied for reference only`);
    return null;
  }

  try {
    if (ext === '.pdf') {
      const mod = (await import('pdf-parse')) as { default: (b: Buffer) => Promise<{ text: string }> };
      const { text } = await mod.default(readFileSync(sourceAbs));
      const ts = new Date().toISOString();
      const outPath = targetAbs + '.extracted.txt';
      writeFileSync(outPath, `<!-- extracted from: ${fileName} at ${ts} -->\n\n${text}`, 'utf-8');
      console.log(`[info] INGEST: ${fileName} -> ${targetRel} + extracted.txt`);
      return (targetRel + '.extracted.txt').split('\\').join('/');
    }

    if (ext === '.docx' || ext === '.doc') {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.convertToMarkdown({ path: sourceAbs });
      const ts = new Date().toISOString();
      const outPath = targetAbs + '.extracted.md';
      writeFileSync(outPath, `<!-- extracted from: ${fileName} at ${ts} -->\n\n${value}`, 'utf-8');
      console.log(`[info] INGEST: ${fileName} -> ${targetRel} + extracted.md`);
      return (targetRel + '.extracted.md').split('\\').join('/');
    }

    if (ext === '.xlsx') {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(sourceAbs);
      const paths: string[] = [];
      wb.eachSheet((sheet) => {
        const rows: string[] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const vals: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = String(cell.value ?? '');
            vals.push(v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
          });
          rows.push(vals.join(','));
        });
        const ts = new Date().toISOString();
        const outPath = targetAbs + `.${sheet.name}.csv`;
        // #1111: cite the extracted CSV filename (not the source xlsx) so CTX pass evidence refs resolve.
        const csvBasename = (targetRel + `.${sheet.name}.csv`).split('\\').join('/');
        const csv = `<!-- extracted from: ${csvBasename} sheet:${sheet.name} at ${ts} -->\n${rows.join('\n')}\n`;
        writeFileSync(outPath, csv, 'utf-8');
        paths.push((targetRel + `.${sheet.name}.csv`).split('\\').join('/'));
      });
      console.log(`[info] INGEST: ${fileName} -> ${paths.length} sheet(s) extracted`);
      return paths.length === 1 ? (paths[0] ?? null) : paths.length > 1 ? paths : null;
    }

    if (ext === '.xls') {
      warn(`[warn] INGEST: ${fileName} is an older .xls format -- convert to .xlsx for text extraction`);
      return null;
    }

    if (ext === '.pptx') {
      const mod = (await import('adm-zip')) as { default: new (path: string) => { getEntries(): Array<{ entryName: string; getData(): Buffer }> } };
      const zip = new mod.default(sourceAbs);
      const slides = zip.getEntries()
        .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));
      const paragraphs: string[] = [];
      for (const slide of slides) {
        const xml = slide.getData().toString('utf-8');
        const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
        if (text) paragraphs.push(text);
      }
      const ts = new Date().toISOString();
      const outPath = targetAbs + '.extracted.txt';
      writeFileSync(outPath, `<!-- extracted from: ${fileName} at ${ts} -->\n\n${paragraphs.join('\n\n')}`, 'utf-8');
      console.log(`[info] INGEST: ${fileName} -> ${targetRel} + extracted.txt`);
      return (targetRel + '.extracted.txt').split('\\').join('/');
    }
  } catch (err) {
    warn(`[warn] INGEST: ${fileName} extraction failed -- ${(err as Error).message}; binary copied for reference only`);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Unmanaged file scan (#0965)
// ---------------------------------------------------------------------------

function warnUnmanagedFiles(
  importsDir: string,
  managedTargets: Set<string>,
  warn: (m: string) => void,
): void {
  if (!existsSync(importsDir)) return;
  for (const entry of readdirSync(importsDir)) {
    if (RESERVED_SUBFOLDERS.has(entry)) continue;
    const subAbs = join(importsDir, entry);
    if (!statSync(subAbs).isDirectory()) continue;
    for (const rel of listFiles(subAbs)) {
      const target = `${entry}/${rel.split('\\').join('/')}`;
      if (!managedTargets.has(target)) {
        warn(`[warn] INGEST: wsp/inputs/${target} is not managed by ingestion/ -- move it to ingestion/ to enable lifecycle management`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface IngestPrePassOptions {
  /** The app workspace dir (PassContext.workspacePath). */
  workspacePath: string;
  /** ISO date string for the manifest timestamp. */
  assessedAt: string;
  /** Warning sink (defaults to console.warn); injectable for tests. */
  warn?: (msg: string) => void;
  /** #1322: optional Pulumi Cloud API ingestion. When provided and stacks.length > 0,
   *  ingestPulumiStacks is called before file-based ingestion normalisation. */
  pulumi?: {
    stacks: Array<{ org: string; project: string; stack: string }>;
    vaultReader: (key: string) => string | undefined;
    baseUrl?: string;
  };
}

/**
 * Run the ingestion normalisation. Returns the written manifest, or null when
 * there is nothing to ingest (no `ingestion/` dir, or it holds no processable files).
 */
export async function runIngestPrePass(opts: IngestPrePassOptions): Promise<IngestManifest | null> {
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  // #1322: Pulumi Cloud API ingestion -- fetch stack exports before file-based normalisation.
  if (opts.pulumi && opts.pulumi.stacks.length > 0) {
    const result = await ingestPulumiStacks(
      opts.workspacePath, opts.pulumi.stacks, opts.pulumi.vaultReader, opts.pulumi.baseUrl,
    );
    for (const w of result.warnings) warn(`[warn] ${w}`);
    for (const f of result.fetched) console.log(`[ok]  Pulumi state fetched -> ${relative(opts.workspacePath, f)}`);
  }

  const ingestionDir = join(opts.workspacePath, 'ingestion');
  const importsDir = join(opts.workspacePath, 'wsp', 'inputs');

  if (!existsSync(ingestionDir) || !statSync(ingestionDir).isDirectory()) return null;

  const SKIP = new Set(['.gitkeep', 'readme.md', 'ingestion-manifest.json']);
  const relFiles = listFiles(ingestionDir).filter((f) => !SKIP.has(basename(f).toLowerCase()));
  if (relFiles.length === 0) return null;

  // Load prior manifest for delta detection.
  const manifestPath = join(ingestionDir, 'ingestion-manifest.json');
  let prevFiles: IngestedFile[] = [];
  let prevRejected: RejectedIngestEntry[] = [];
  let prevConverted: ConvertedIngestEntry[] = [];
  if (existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(readFileSync(manifestPath, 'utf-8')) as IngestManifest;
      prevFiles = prev.files ?? [];
      prevRejected = prev.rejected ?? [];
      prevConverted = prev.converted ?? [];
    } catch { /* ignore corrupt manifest -- full reprocess */ }
  }
  const prevBySource = new Map<string, IngestedFile>(prevFiles.map((f) => [f.source, f]));
  const prevRejectedBySource = new Map<string, RejectedIngestEntry>(prevRejected.map((r) => [r.source, r]));
  const prevConvertedBySource = new Map<string, ConvertedIngestEntry>(prevConverted.map((c) => [c.source, c]));

  const files: IngestedFile[] = [];
  const counts: Record<string, number> = {};
  const currentSources = new Set<string>();
  const rejectedEntries: RejectedIngestEntry[] = [];
  const convertedEntries: ConvertedIngestEntry[] = [];

  for (const rel of relFiles) {
    const normalized = rel.split('\\').join('/');
    currentSources.add(normalized);

    const sourceAbs = join(ingestionDir, rel);
    const fileName = basename(rel);
    const ext = extname(rel).toLowerCase();

    // Archives: reject and track for delta detection (#0999).
    if (ARCHIVE_EXTS.has(ext)) {
      const currentSha = sha256(sourceAbs);
      const prevR = prevRejectedBySource.get(normalized);
      if (prevR && prevR.sha256 === currentSha) {
        rejectedEntries.push(prevR);
      } else {
        warn(`[warn] INGEST: ${fileName} -- archive -- extract and place files individually`);
        rejectedEntries.push({
          source: normalized,
          status: 'rejected',
          reason: 'archive -- extract and place files individually',
          sha256: currentSha,
          bytes: statSync(sourceAbs).size,
        });
      }
      continue;
    }

    // Images: all raster formats rejected (#1495, Option A -- honest rejection).
    // Raster images contain no extractable text so LLM passes see empty content.
    // Users should supply a PDF with selectable text or a .txt companion file.
    if (IMAGE_EXTS.has(ext)) {
      const currentSha = sha256(sourceAbs);
      const reason = ext === '.gif'
        ? 'GIF not supported -- resave as PNG or JPEG to auto-include, or provide a .txt companion with diagram description'
        : 'raster image -- no text can be extracted; provide a PDF with selectable text or a .txt companion describing the diagram';
      const prevR = prevRejectedBySource.get(normalized);
      if (prevR && prevR.sha256 === currentSha) {
        rejectedEntries.push(prevR);
      } else {
        warn(`[warn] INGEST: ${fileName} -- ${reason}`);
        rejectedEntries.push({ source: normalized, status: 'rejected', reason, sha256: currentSha, bytes: statSync(sourceAbs).size });
      }
      continue;
    }

    // XPS and other unreadable document formats: route to intake/ but warn.
    if (ext === '.xps') {
      warn(`[warn] INGEST: ${fileName} -- XPS format has no text extraction; convert to PDF for LLM pass coverage`);
    }

    const prev = prevBySource.get(normalized);
    const currentSha = sha256(sourceAbs);

    // Stable routing: re-use previous target subdir to avoid drift on re-run.
    const subdir = prev
      ? (prev.target.split('/')[0] ?? resolveIngestSubdir(sourceAbs, fileName))
      : resolveIngestSubdir(sourceAbs, fileName);
    const targetRel = prev?.target ?? `${subdir}/${normalized}`;
    const targetAbs = join(importsDir, targetRel);

    // Delta check: skip when sha matches, target exists, and all companions are present.
    if (prev && prev.sha256 === currentSha && existsSync(targetAbs) && companionsExist(importsDir, prev.extracted_path)) {
      files.push(prev);
      counts[subdir] = (counts[subdir] ?? 0) + 1;
      continue;
    }

    // New or changed: copy then extract.
    mkdirSync(dirname(targetAbs), { recursive: true });
    copyFileSync(sourceAbs, targetAbs);

    let extractedPath: string | string[] | null = null;
    if (BINARY_EXTS.has(ext)) {
      extractedPath = await extractBinary(sourceAbs, targetAbs, targetRel, fileName, warn);
    }

    counts[subdir] = (counts[subdir] ?? 0) + 1;
    const entry: IngestedFile = {
      source: normalized,
      target: targetRel,
      category: subdir,
      sha256: currentSha,
      bytes: statSync(sourceAbs).size,
    };
    if (extractedPath !== null) entry.extracted_path = extractedPath;
    files.push(entry);
  }

  // Cleanup: delete derived files for sources removed from ingestion/.
  let cleanupCount = 0;
  for (const prev of prevFiles) {
    if (currentSources.has(prev.source)) continue;
    safeDeleteTarget(importsDir, prev.target);
    const companions = prev.extracted_path
      ? (Array.isArray(prev.extracted_path) ? prev.extracted_path : [prev.extracted_path])
      : [];
    for (const c of companions) safeDeleteTarget(importsDir, c);
    cleanupCount += 1;
  }

  // If nothing was ingested/rejected and nothing was cleaned up, treat as no-op.
  if (files.length === 0 && rejectedEntries.length === 0 && cleanupCount === 0) return null;

  // Unmanaged file scan: warn on files in dynamic subfolders not in manifest.
  const managedTargets = new Set<string>(
    files.flatMap((f) => [
      f.target,
      ...(f.extracted_path ? (Array.isArray(f.extracted_path) ? f.extracted_path : [f.extracted_path]) : []),
    ]),
  );
  warnUnmanagedFiles(importsDir, managedTargets, warn);

  const manifest: IngestManifest = {
    schema_version: '1.0',
    generated_at: opts.assessedAt,
    ingestion_dir: relative(opts.workspacePath, ingestionDir).split('\\').join('/'),
    imports_dir: relative(opts.workspacePath, importsDir).split('\\').join('/'),
    files: files.sort((a, b) => a.target.localeCompare(b.target)),
    counts,
    ...(rejectedEntries.length > 0 ? { rejected: rejectedEntries.sort((a, b) => a.source.localeCompare(b.source)) } : {}),
    ...(convertedEntries.length > 0 ? { converted: convertedEntries.sort((a, b) => a.source.localeCompare(b.source)) } : {}),
  };

  mkdirSync(ingestionDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}
