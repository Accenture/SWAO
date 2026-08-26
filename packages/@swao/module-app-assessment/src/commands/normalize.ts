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

// `swao normalize` command (#0442).
//
// Classifies, deduplicates, and transforms files from wsp/intake/ into
// wsp/inputs/<targetSubdir>/. Updates .swao.yml::context_inputs and writes
// a normalize-report.yaml summary.
//
// Exported runNormalize() is the pure, testable implementation.
// registerNormalize() wires it into the Commander program.

import type { Command } from 'commander';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { join, basename, relative } from 'node:path';
import { load, dump } from 'js-yaml';
import { findWorkspace, redactForReport } from '@swao/core';
import { classifyFile } from '../normalize/classifier.js';
import type { FileCategory } from '../normalize/classifier.js';
import { findExactDuplicates } from '../normalize/dedup.js';
import { xlsxToCsv, docxToMarkdown, pdfToText } from '../normalize/transformer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  dryRun?: boolean;
  noLlm?: boolean;
  piiStrict?: boolean;
  app?: string;
  allApps?: boolean;
  out?: string;
  /** Override process.cwd() for findWorkspace; used in tests. */
  cwd?: string;
}

export interface NormalizeReportEntry {
  source: string;
  target: string;
  category: string;
  action: string;
}

export interface NormalizeResult {
  reportPath: string | null;
  filesProcessed: NormalizeReportEntry[];
  duplicatesRemoved: string[];
  piiWarnings: string[];
  llmSkipped: string[];
  unknownFiles: string[];
}

// ---------------------------------------------------------------------------
// Category -> context_inputs type mapping
// ---------------------------------------------------------------------------

const CATEGORY_TYPE: Record<FileCategory, string> = {
  cmdb: 'cmdb_export',
  incidents: 'servicenow_tickets',
  architecture: 'solution_arch',
  workshops: 'meeting_transcript',
  iac: 'iac_terraform',
  network_flows: 'network_flow_export',
  source_code: 'source_code',
  policy_pdf: 'solution_arch',
  legal_pdf: 'solution_arch',
  compliance: 'solution_arch',
  unknown: 'unknown',
};

// ---------------------------------------------------------------------------
// Context inputs priority by category
// ---------------------------------------------------------------------------

const CATEGORY_PRIORITY: Record<FileCategory, number> = {
  cmdb: 1,
  incidents: 2,
  network_flows: 3,
  iac: 4,
  architecture: 5,
  workshops: 6,
  policy_pdf: 7,
  legal_pdf: 8,
  compliance: 9,
  source_code: 10,
  unknown: 11,
};

const CATEGORY_RELIABILITY: Record<FileCategory, number> = {
  cmdb: 0.9,
  incidents: 0.85,
  network_flows: 0.85,
  iac: 0.9,
  architecture: 0.75,
  workshops: 0.7,
  policy_pdf: 0.8,
  legal_pdf: 0.8,
  compliance: 0.85,
  source_code: 0.9,
  unknown: 0.5,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Collect all regular files under a directory (non-recursive). */
function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((f) => join(dir, f))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** Determine the effective output filename, renaming .xlsx -> .csv where appropriate. */
function _resolveTargetName(filename: string, action: string): string {
  if (action === 'converted_xlsx_to_csv') {
    return filename.replace(/\.xlsx$/i, '.csv');
  }
  return filename;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

export async function runNormalize(opts: NormalizeOptions): Promise<NormalizeResult> {
  const effectiveCwd = opts.cwd ?? process.cwd();
  const workspace = findWorkspace(effectiveCwd);

  if (!workspace) {
    console.error('[swao normalize] No workspace found (.swao.yml not detected). Run `swao init` first.');
    return {
      reportPath: null,
      filesProcessed: [],
      duplicatesRemoved: [],
      piiWarnings: [],
      llmSkipped: [],
      unknownFiles: [],
    };
  }

  // Determine input directories to process.
  const intakeDirs: Array<{ intakeDir: string; inputsDir: string; label: string }> = [];

  if (opts.allApps) {
    const appsDir = join(workspace, 'apps');
    if (!existsSync(appsDir)) {
      console.warn('[swao normalize] No apps/ directory found in workspace.');
    } else {
      const apps = readdirSync(appsDir).filter((a) => statSync(join(appsDir, a)).isDirectory());
      for (const app of apps) {
        intakeDirs.push({
          intakeDir: join(appsDir, app, 'wsp', 'intake'),
          inputsDir: opts.out ?? join(appsDir, app, 'wsp', 'inputs'),
          label: `apps/${app}`,
        });
      }
    }
  } else if (opts.app) {
    const appBase = join(workspace, 'apps', opts.app, 'wsp');
    intakeDirs.push({
      intakeDir: join(appBase, 'intake'),
      inputsDir: opts.out ?? join(appBase, 'inputs'),
      label: `apps/${opts.app}`,
    });
  } else {
    intakeDirs.push({
      intakeDir: join(workspace, 'wsp', 'intake'),
      inputsDir: opts.out ?? join(workspace, 'wsp', 'inputs'),
      label: 'portfolio',
    });
  }

  const result: NormalizeResult = {
    reportPath: null,
    filesProcessed: [],
    duplicatesRemoved: [],
    piiWarnings: [],
    llmSkipped: [],
    unknownFiles: [],
  };

  for (const { intakeDir, inputsDir, label } of intakeDirs) {
    if (!existsSync(intakeDir)) {
      console.log(`[swao normalize] Intake directory not found: ${intakeDir} (${label}) -- skipping.`);
      continue;
    }

    const files = listFiles(intakeDir);
    if (files.length === 0) {
      console.log(`[swao normalize] No files in ${intakeDir} -- nothing to process.`);
      continue;
    }

    // Dedup check.
    const duplicates = findExactDuplicates(files);
    const skippedHashes = new Set<string>();
    for (const [hash, paths] of duplicates) {
      // Keep the first file; skip the rest.
      const [keep, ...dups] = paths;
      console.warn(`[swao normalize] Exact duplicates detected (hash ${hash.slice(0, 8)}...): keeping ${basename(keep)}, skipping ${dups.map((d) => basename(d)).join(', ')}`);
      for (const dup of dups) {
        result.duplicatesRemoved.push(relative(workspace, dup));
        skippedHashes.add(dup);
      }
    }

    if (opts.dryRun) {
      // Print dry-run table header.
      const header = `${padRight('SOURCE', 30)} ${padRight('CATEGORY', 16)} ${padRight('TARGET', 40)} LLM`;
      console.log(`\n[dry-run] ${label}: ${intakeDir}`);
      console.log(header);
      console.log('-'.repeat(header.length));
    }

    for (const filePath of files) {
      if (skippedHashes.has(filePath)) continue;

      const fname = basename(filePath);
      const classified = classifyFile(filePath, fname);

      // XLSX cost-column refinement for unknown XLSX files.
      if (classified.category === 'unknown' && fname.toLowerCase().endsWith('.xlsx')) {
        try {
          const hasCost = await hasCostColumns(filePath);
          if (hasCost) {
            classified.category = 'cmdb';
            classified.targetSubdir = 'operations/';
            classified.notes = 'Refined from unknown: cost columns detected';
          }
        } catch {
          // Non-fatal -- leave as unknown.
        }
      }

      if (classified.category === 'unknown') {
        result.unknownFiles.push(relative(workspace, filePath));
      }

      // Determine action and target name.
      let action = 'copied';
      let targetFilename = fname;

      if (fname.toLowerCase().endsWith('.xlsx') && classified.category !== 'unknown') {
        action = 'converted_xlsx_to_csv';
        targetFilename = fname.replace(/\.xlsx$/i, '.csv');
      } else if (fname.toLowerCase().endsWith('.docx') && classified.requiresLlm) {
        action = 'extracted_docx_to_md';
        targetFilename = fname.replace(/\.docx$/i, '.md');
      } else if (fname.toLowerCase().endsWith('.pdf') && classified.requiresLlm) {
        action = 'extracted_pdf_to_txt';
        targetFilename = fname.replace(/\.pdf$/i, '.txt');
      }

      if (classified.requiresLlm && opts.noLlm) {
        console.log(`[swao normalize] Skipping ${fname} (requires LLM, --no-llm set)`);
        result.llmSkipped.push(relative(workspace, filePath));
        // If not LLM-requiring but xlsx or other transformable, still process
        if (action === 'copied') {
          // Fall through -- non-LLM files are still processed below.
        } else {
          continue;
        }
      }

      const targetPath = join(inputsDir, classified.targetSubdir, targetFilename);
      const relSource = relative(workspace, filePath);
      const relTarget = relative(workspace, targetPath);

      if (opts.dryRun) {
        console.log(
          `${padRight(fname, 30)} ${padRight(classified.category, 16)} ${padRight(relTarget, 40)} ${classified.requiresLlm ? 'yes' : 'no'}`,
        );
        result.filesProcessed.push({
          source: relSource,
          target: relTarget,
          category: classified.category,
          action,
        });
        continue;
      }

      // Not dry-run: perform the transformation / copy.
      try {
        let textContent: string | null = null;

        if (action === 'converted_xlsx_to_csv') {
          textContent = await xlsxToCsv(filePath);
        } else if (action === 'extracted_docx_to_md') {
          textContent = await docxToMarkdown(filePath);
        } else if (action === 'extracted_pdf_to_txt') {
          textContent = await pdfToText(filePath);
        }

        // PII detection on text content.
        if (textContent !== null) {
          const { counts } = redactForReport(textContent);
          const totalPii = Object.values(counts).reduce((a, b) => a + b, 0);
          if (totalPii > 0 && opts.piiStrict) {
            console.warn(`[swao normalize] PII detected in ${fname} (${totalPii} items) -- skipping (--pii-strict).`);
            result.piiWarnings.push(relSource);
            continue;
          }
          if (totalPii > 0) {
            result.piiWarnings.push(relSource);
          }
        } else {
          // Binary files (not in text categories): run redactForReport on empty to avoid crashing.
          // We do not read arbitrary binary files for PII detection.
        }

        // Write to target.
        const targetDir = join(inputsDir, classified.targetSubdir);
        mkdirSync(targetDir, { recursive: true });

        if (textContent !== null) {
          writeFileSync(targetPath, textContent, 'utf-8');
        } else {
          copyFileSync(filePath, targetPath);
        }

        result.filesProcessed.push({
          source: relSource,
          target: relTarget,
          category: classified.category,
          action,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[swao normalize] Error processing ${fname}: ${msg}`);
      }
    }
  }

  if (!opts.dryRun) {
    // Update .swao.yml context_inputs.
    const swaoYmlPath = join(workspace, '.swao.yml');
    try {
      updateSwaoYml(swaoYmlPath, result.filesProcessed, workspace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[swao normalize] Failed to update .swao.yml: ${msg}`);
    }

    // Write report.
    const wspDir = join(workspace, 'wsp');
    mkdirSync(wspDir, { recursive: true });
    const reportPath = join(wspDir, 'normalize-report.yaml');
    const report = {
      run_at: new Date().toISOString(),
      intake_dir: 'wsp/intake/',
      inputs_dir: 'wsp/inputs/',
      files_processed: result.filesProcessed,
      duplicates_removed: result.duplicatesRemoved,
      pii_warnings: result.piiWarnings,
      llm_skipped: result.llmSkipped,
      unknown_files: result.unknownFiles,
    };
    writeFileSync(reportPath, dump(report, { lineWidth: 120 }), 'utf-8');
    result.reportPath = reportPath;
    process.stdout.write(reportPath + '\n');
  }

  // Summary to stderr.
  process.stderr.write(
    `[swao normalize] Done: ${result.filesProcessed.length} processed, ` +
      `${result.duplicatesRemoved.length} duplicates removed, ` +
      `${result.piiWarnings.length} PII warnings, ` +
      `${result.llmSkipped.length} LLM-skipped, ` +
      `${result.unknownFiles.length} unknown.\n`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// XLSX cost-column heuristic (async; called from runNormalize only)
// ---------------------------------------------------------------------------

async function hasCostColumns(filePath: string): Promise<boolean> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  if (!ws) return false;

  const firstRow = ws.getRow(1);
  const headers: string[] = [];
  firstRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? '').toLowerCase());
  });

  const costKeywords = ['cost', 'price', 'billing', 'spend', 'charge', 'amount', 'fee'];
  return headers.some((h) => costKeywords.some((kw) => h.includes(kw)));
}

// ---------------------------------------------------------------------------
// .swao.yml update
// ---------------------------------------------------------------------------

function updateSwaoYml(
  swaoYmlPath: string,
  filesProcessed: NormalizeReportEntry[],
  _workspace: string,
): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(swaoYmlPath)) {
    const parsed = load(readFileSync(swaoYmlPath, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }

  const existingInputs = Array.isArray(existing['context_inputs'])
    ? (existing['context_inputs'] as Array<Record<string, unknown>>)
    : [];

  // Deduplicate by path.
  const existingPaths = new Set(existingInputs.map((e) => String(e['path'] ?? '')));

  for (const entry of filesProcessed) {
    if (entry.category === 'unknown') continue;
    const category = entry.category as FileCategory;
    const entryPath = entry.target;
    if (existingPaths.has(entryPath)) continue;

    existingPaths.add(entryPath);
    const id = basename(entry.target, '.csv')
      .replace(/\.[a-z]+$/i, '')
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();

    existingInputs.push({
      id,
      type: CATEGORY_TYPE[category],
      path: entryPath,
      priority: CATEGORY_PRIORITY[category],
      reliability_weight: CATEGORY_RELIABILITY[category],
    });
  }

  existing['context_inputs'] = existingInputs;

  const dir = join(swaoYmlPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(swaoYmlPath, dump(existing, { lineWidth: 120 }), 'utf-8');
}

// ---------------------------------------------------------------------------
// registerNormalize
// ---------------------------------------------------------------------------

export function registerNormalize(program: Command): void {
  program
    .command('normalize')
    .description('Classify and transform files from wsp/intake/ into wsp/inputs/')
    .option('--dry-run', 'Preview classification; no files written')
    .option('--no-llm', 'Rule-based only; skip files requiring LLM transformation')
    .option('--pii-strict', 'Skip files with detected PII; print warning')
    .option('--app <id>', 'Process apps/<id>/wsp/intake/ only')
    .option('--all-apps', 'Process all app intake folders sequentially')
    .option('--out <dir>', 'Override output directory (default: wsp/inputs/)')
    .action(async (cmdOpts: {
      dryRun?: boolean;
      llm?: boolean;
      piiStrict?: boolean;
      app?: string;
      allApps?: boolean;
      out?: string;
    }) => {
      // Commander stores --no-llm as opts.llm = false.
      const noLlm = cmdOpts.llm === false;
      await runNormalize({
        dryRun: cmdOpts.dryRun,
        noLlm,
        piiStrict: cmdOpts.piiStrict,
        app: cmdOpts.app,
        allApps: cmdOpts.allApps,
        out: cmdOpts.out,
      });
    });
}
