// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// `swao doctor pii` -- workspace-input PII scanner (#0354 Part C).
//
// Scans the workspace's wsp/inputs/ + customer source under
// apps/<id>/source/ for PII shapes BEFORE assess runs, so the
// operator can surface findings to the client + get sign-off
// against the engagement-pre-flight checklist (design 032 §9).
//
// Reuses the same redactor classes as the egress wrap so reports
// are consistent. `--strict` exits 1 on any finding; default mode
// exits 0 + prints the report.
//
// Registered as a subcommand of the existing `doctor` command so
// the surface remains `swao doctor pii` per design 032 §6.

import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import {
  redactForReport,
  setAllowlist,
  setScrubPersonName,
  emptyPreLlmCounts,
  type PreLlmRedactionCounts,
} from '@swao/core';

interface PiiFinding {
  file: string;
  line: number;
  col: number;
  klass: keyof PreLlmRedactionCounts;
  sample: string; // first 40 chars of the matched substring (for context)
}

// Directories under workspaceRoot that the scanner walks. Each is
// optional; missing dirs are skipped silently.
const SCAN_TARGETS = [
  'wsp/inputs',
  // Customer source is at apps/<id>/source/; the scan walks each app's
  // source tree if `apps/` exists.
  'apps',
];

const SCANNABLE_EXT = new Set([
  '.json', '.yaml', '.yml', '.csv', '.tsv', '.md', '.txt', '.html', '.xml', '.log',
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs',
  '.env', '.example',
  '.tf', '.tfvars', '.hcl',
  '.sql',
  '.sh', '.ps1', '.bat',
  '.toml', '.ini', '.conf',
]);

const SKIP_DIR_BASENAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'target',
  '__pycache__', '.venv', 'venv', '.next', '.nuxt', '.cache',
  'coverage', '.coverage',
]);

function shouldScanFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (SCANNABLE_EXT.has(ext)) return true;
  // Files with no extension but common config-file basenames
  const base = filePath.split(/[/\\]/).pop() ?? '';
  if (base === 'Dockerfile' || base === 'Makefile' || base === '.env') return true;
  return false;
}

function walkScannable(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_BASENAMES.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkScannable(full, out);
    } else if (st.isFile() && shouldScanFile(full)) {
      out.push(full);
    }
  }
}

function scanFile(filePath: string, workspaceRoot: string, allowlist: ReadonlySet<string>): {
  findings: PiiFinding[];
  counts: PreLlmRedactionCounts;
} {
  const findings: PiiFinding[] = [];
  let body: string;
  try {
    body = readFileSync(filePath, 'utf-8');
  } catch {
    return { findings, counts: emptyPreLlmCounts() };
  }

  // Skip files that look binary (high non-printable byte ratio after
  // a small head-read). Cheap heuristic; the extension whitelist is
  // the primary filter.
  if (body.includes('\x00')) {
    return { findings, counts: emptyPreLlmCounts() };
  }

  const { text: scrubbed, counts } = redactForReport(body);
  if (scrubbed === body) {
    return { findings, counts };
  }

  // To produce useful file:line:col references, re-run a lightweight
  // line-by-line scan against the SAME class regexes. The redactor
  // gives us counts; this loop gives us locations. Cheaper than
  // weaving location-capture into the redactor for sprint-038.
  const lines = body.split(/\r?\n/);
  // Re-detect the high-value classes by the simplest indicative
  // substring. The redactor's regexes are already known to have
  // matched (counts > 0); we just need ANY plausible position per
  // class so the report has actionable line numbers.
  const classProbes: { klass: keyof PreLlmRedactionCounts; probe: RegExp }[] = [
    { klass: 'email', probe: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
    { klass: 'business_id', probe: /\b\d{3}-\d{2}-\d{4}\b/g },
    { klass: 'secret_shape', probe: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/g },
    { klass: 'ipv4', probe: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
    { klass: 'api_key_shape', probe: /"type"\s*:\s*"service_account"|DefaultEndpointsProtocol=/g },
  ];

  const relPath = relative(workspaceRoot, filePath).replace(/\\/g, '/');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { klass, probe } of classProbes) {
      probe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = probe.exec(line)) !== null) {
        if (allowlist.has(m[0])) continue;
        findings.push({
          file: relPath,
          line: i + 1,
          col: m.index + 1,
          klass,
          sample: m[0].slice(0, 40),
        });
        if (findings.length >= 500) break;
      }
      if (findings.length >= 500) break;
    }
    if (findings.length >= 500) break;
  }

  return { findings, counts };
}

interface PiiScanResult {
  files_scanned: number;
  total_findings: number;
  counts: PreLlmRedactionCounts;
  findings: PiiFinding[];
  truncated: boolean;
}

export function runHealthCheckPii(workspaceRoot: string): PiiScanResult {
  // Honour the same allowlist + person_name opt-in as the egress wrap.
  const allowlistPath = join(workspaceRoot, '.swao-pii-allowlist.txt');
  let allowlistEntries: string[] = [];
  if (existsSync(allowlistPath)) {
    allowlistEntries = readFileSync(allowlistPath, 'utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  }
  setAllowlist(allowlistEntries);
  setScrubPersonName(process.env['SWAO_SCRUB_PERSON_NAME'] === '1');
  const allowlist = new Set(allowlistEntries);

  const files: string[] = [];
  for (const target of SCAN_TARGETS) {
    const full = join(workspaceRoot, target);
    if (existsSync(full)) walkScannable(full, files);
  }

  const totalCounts = emptyPreLlmCounts();
  const findings: PiiFinding[] = [];
  let truncated = false;

  for (const f of files) {
    const r = scanFile(f, workspaceRoot, allowlist);
    for (const k of Object.keys(totalCounts) as (keyof PreLlmRedactionCounts)[]) {
      totalCounts[k] += r.counts[k];
    }
    for (const finding of r.findings) {
      if (findings.length >= 500) {
        truncated = true;
        break;
      }
      findings.push(finding);
    }
    if (truncated) break;
  }

  const total_findings = Object.values(totalCounts).reduce((a, b) => a + b, 0);

  return {
    files_scanned: files.length,
    total_findings,
    counts: totalCounts,
    findings,
    truncated,
  };
}

function formatReport(workspaceRoot: string, result: PiiScanResult): string {
  const lines: string[] = [];
  lines.push(`PII pre-flight scan: ${workspaceRoot}`);
  lines.push('');

  if (result.total_findings === 0) {
    lines.push(`Files scanned: ${result.files_scanned}`);
    lines.push('No PII findings.');
    return lines.join('\n');
  }

  // Group findings by file
  const byFile = new Map<string, PiiFinding[]>();
  for (const f of result.findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  for (const [file, fs] of byFile) {
    lines.push(file);
    for (const f of fs) {
      lines.push(`  line ${f.line} col ${f.col}  ${f.klass}  ${f.sample}`);
    }
    lines.push('');
  }

  const summary = Object.entries(result.counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  lines.push(`Files scanned: ${result.files_scanned}`);
  lines.push(`Total findings: ${result.total_findings} (${summary})`);
  if (result.truncated) {
    lines.push('NOTE: scan truncated at 500 findings; fix top offenders and re-run.');
  }
  return lines.join('\n');
}

export function registerHealthCheckPii(program: Command): void {
  const healthCheck = program.commands.find((c) => c.name() === 'health-check');
  if (!healthCheck) {
    throw new Error('health-check-pii: parent `health-check` command must be registered first');
  }
  healthCheck
    .command('pii')
    .description('Scan workspace inputs (wsp/inputs + apps/*/source) for PII shapes before assess runs (#0354).')
    // The parent `health-check` command declares `--workspace` and `--format`;
    // commander hoists shadowed options to the parent (verified empirically),
    // so we read both from `this.parent.opts()` rather than redeclaring.
    // `--strict` is subcommand-only and parses normally.
    .option('--strict', 'Exit non-zero if any findings (gate use)')
    .action(function (this: Command, opts: { strict?: boolean }) {
      const parentOpts = (this.parent?.opts() ?? {}) as { workspace?: string; format?: string };
      const workspaceRoot = parentOpts.workspace ? resolve(parentOpts.workspace) : process.cwd();
      const result = runHealthCheckPii(workspaceRoot);

      if (parentOpts.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatReport(workspaceRoot, result));
      }

      if (opts.strict && result.total_findings > 0) {
        process.exit(1);
      }
    });
}
