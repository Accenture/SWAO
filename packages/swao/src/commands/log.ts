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

// `swao log` CLI subcommands -- reads the WSP-scoped NDJSON event log
// written by util/log.ts. Phase B of sprint-034 / #0327. Phase D
// (sprint-036) adds the export-for-feedback path.
//
// Subcommands:
//   swao log tail    -- print recent entries (default: last 50 warn+)
//   swao log show    -- print entries for a specific run_id
//   swao log search  -- regex match across entries
//   swao log clear   -- remove sink files (with confirmation)
//   swao log export --for-feedback --out <path>  -- bundle + redact + tarball
//                                                   (sprint-036 Phase C #0327 Part D)

import type { Command } from 'commander';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { LogEntry, LogLevel } from '@swao/core';
import { resolveWorkspaceRoot } from '@swao/core';
import { emptyCounts, redactPiiString, redactPiiValue } from '../util/redact-pii.js';
import type { RedactionCounts } from '../util/redact-pii.js';
import { buildTar } from '../util/tar-write.js';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  enhancement: 2,         // visible by default alongside warn
};

interface TailOpts {
  level?: LogLevel;
  since?: string;
  scope?: 'portfolio' | 'app';
  app?: string;
  limit?: string;
}

function listLogFiles(workspaceRoot: string, scope?: 'portfolio' | 'app', appFilter?: string): string[] {
  const out: string[] = [];
  if (!scope || scope === 'portfolio') {
    const dir = join(workspaceRoot, 'wsp', 'logs');
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).sort()) {
        if (f.startsWith('portfolio-events-') && f.endsWith('.ndjson')) {
          out.push(join(dir, f));
        }
      }
    }
  }
  if (!scope || scope === 'app') {
    const appsDir = join(workspaceRoot, 'apps');
    if (existsSync(appsDir)) {
      for (const entry of readdirSync(appsDir)) {
        if (appFilter && entry !== appFilter) continue;
        const candidate = join(appsDir, entry);
        let isDir = false;
        try { isDir = statSync(candidate).isDirectory(); } catch { continue; }
        if (!isDir) continue;
        const logsDir = join(candidate, 'wsp', 'logs');
        if (!existsSync(logsDir)) continue;
        for (const f of readdirSync(logsDir).sort()) {
          if (f.startsWith('app-events-') && f.endsWith('.ndjson')) {
            out.push(join(logsDir, f));
          }
        }
      }
    }
  }
  return out;
}

function readEntries(filePath: string): LogEntry[] {
  const entries: LogEntry[] = [];
  let raw: string;
  try { raw = readFileSync(filePath, 'utf-8'); } catch { return entries; }
  // #0334 PR-#339: warn once on first malformed line so file corruption is
  // visible to the operator. Per-file scope so a partial file still yields
  // its readable entries; subsequent malformed lines are skipped silently.
  let warnedMalformed = false;
  for (const [idx, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch (err) {
      if (!warnedMalformed) {
        console.warn(`[swao.log] skipping malformed NDJSON line ${idx + 1} in ${filePath}: ${(err as Error).message}`);
        warnedMalformed = true;
      }
    }
  }
  return entries;
}

function formatEntry(e: LogEntry): string {
  const tag = e.scope === 'app' ? `[${e.app_id ?? '?'}]` : '[portfolio]';
  const ctx = e.context && Object.keys(e.context).length > 0
    ? '  ' + Object.entries(e.context).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    : '';
  return `${e.ts}  ${e.level.padEnd(11)}  ${tag.padEnd(20)}  ${e.code.padEnd(40)}  ${e.message}${ctx}`;
}

export function cmdTail(opts: TailOpts): void {
  const root = resolveWorkspaceRoot();
  if (!root) {
    console.error('[swao log] not in a workspace (no `apps/` or `.swao.yml` found walking up from cwd)');
    process.exitCode = 1;
    return;
  }
  const files = listLogFiles(root, opts.scope, opts.app);
  if (files.length === 0) {
    console.log('[swao log] no log files found yet');
    return;
  }

  const minRank = opts.level ? LEVEL_RANK[opts.level] : LEVEL_RANK.warn;
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  // Read all matching entries across files, sorted by ts.
  const all: LogEntry[] = [];
  for (const f of files) {
    for (const e of readEntries(f)) {
      if (LEVEL_RANK[e.level] < minRank) continue;
      if (sinceMs && Date.parse(e.ts) < sinceMs) continue;
      all.push(e);
    }
  }
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  const slice = all.slice(-limit);
  for (const e of slice) {
    console.log(formatEntry(e));
  }
  if (slice.length === 0) {
    console.log('[swao log] no entries match the filter');
  }
}

export function cmdShow(runId: string): void {
  const root = resolveWorkspaceRoot();
  if (!root) {
    console.error('[swao log] not in a workspace');
    process.exitCode = 1;
    return;
  }
  let found = 0;
  for (const f of listLogFiles(root)) {
    for (const e of readEntries(f)) {
      if (e.run_id === runId) {
        console.log(formatEntry(e));
        found++;
      }
    }
  }
  if (found === 0) {
    console.log(`[swao log] no entries with run_id="${runId}"`);
  }
}

export function cmdSearch(pattern: string): void {
  const root = resolveWorkspaceRoot();
  if (!root) {
    console.error('[swao log] not in a workspace');
    process.exitCode = 1;
    return;
  }
  const re = new RegExp(pattern);
  let found = 0;
  for (const f of listLogFiles(root)) {
    for (const e of readEntries(f)) {
      const haystack = `${e.code} ${e.message} ${JSON.stringify(e.context ?? {})}`;
      if (re.test(haystack)) {
        console.log(formatEntry(e));
        found++;
      }
    }
  }
  if (found === 0) {
    console.log('[swao log] no entries match the pattern');
  }
}

// #0327 Part D (sprint-036): bundle + redact + tarball the event log.
// Output shape:
//   <out>.tar.gz containing two files:
//     events.ndjson         -- redacted log entries (one JSON per line)
//     redaction-report.json -- counts per redaction class + metadata
export interface ExportOpts {
  forFeedback: boolean;
  out?: string;
  level?: LogLevel;
  scope?: 'portfolio' | 'app';
  app?: string;
}

export interface RedactionReport {
  generated_at: string;
  workspace_root: string;
  entry_count: number;
  files_included: string[];
  counts: RedactionCounts;
  filter: {
    level: LogLevel | null;
    scope: 'portfolio' | 'app' | null;
    app: string | null;
  };
}

function redactEntry(entry: LogEntry, counts: RedactionCounts): LogEntry {
  return {
    ...entry,
    message: redactPiiString(entry.message, counts),
    context: entry.context ? (redactPiiValue(entry.context, counts) as Record<string, unknown>) : entry.context,
  };
}

export function cmdExport(opts: ExportOpts): void {
  if (!opts.forFeedback) {
    console.error('[swao log export] requires --for-feedback (no other export modes are wired yet)');
    process.exitCode = 1;
    return;
  }
  const root = resolveWorkspaceRoot();
  if (!root) {
    console.error('[swao log export] not in a workspace (no `apps/` or `.swao.yml` found walking up from cwd)');
    process.exitCode = 1;
    return;
  }
  const files = listLogFiles(root, opts.scope, opts.app);
  if (files.length === 0) {
    console.log('[swao log export] no log files found in this workspace; nothing to export');
    return;
  }

  // Collect + filter entries
  const minRank = opts.level ? LEVEL_RANK[opts.level] : 0;  // export ALL by default
  const counts = emptyCounts();
  const entries: LogEntry[] = [];
  for (const f of files) {
    for (const e of readEntries(f)) {
      if (LEVEL_RANK[e.level] < minRank) continue;
      entries.push(redactEntry(e, counts));
    }
  }
  entries.sort((a, b) => a.ts.localeCompare(b.ts));

  // Render NDJSON + redaction report
  const eventsNdjson = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
  const report: RedactionReport = {
    generated_at: new Date().toISOString(),
    workspace_root: redactPiiString(root, emptyCounts()),  // redact the workspace path itself
    entry_count: entries.length,
    files_included: files.map((f) => redactPiiString(f, emptyCounts())),
    counts,
    filter: {
      level: opts.level ?? null,
      scope: opts.scope ?? null,
      app: opts.app ?? null,
    },
  };
  const reportJson = JSON.stringify(report, null, 2) + '\n';

  // Determine output path
  const outPath = opts.out ? resolvePath(opts.out) : join(process.cwd(), `swao-log-feedback-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`);
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) {
    try { mkdirSync(outDir, { recursive: true }); }
    catch (err) {
      console.error(`[swao log export] failed to create output directory ${outDir}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }

  // Build tar.gz
  const tar = buildTar([
    { name: 'events.ndjson', content: Buffer.from(eventsNdjson, 'utf-8') },
    { name: 'redaction-report.json', content: Buffer.from(reportJson, 'utf-8') },
  ]);
  const gz = gzipSync(tar);
  try {
    writeFileSync(outPath, gz);
  } catch (err) {
    console.error(`[swao log export] failed to write ${outPath}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const totalRedactions = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[swao log export] wrote ${outPath} (${entries.length} entries, ${totalRedactions} PII redactions)`);
  console.log(`[swao log export] open with: tar -xzf ${outPath}`);
  if (totalRedactions > 0) {
    const byKind = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`[swao log export] redactions: ${byKind}`);
  }
}

export function cmdClear(opts: { scope?: 'portfolio' | 'app'; app?: string; olderThan?: string }): void {
  const root = resolveWorkspaceRoot();
  if (!root) {
    console.error('[swao log] not in a workspace');
    process.exitCode = 1;
    return;
  }
  const cutoff = opts.olderThan ? Date.parse(opts.olderThan) : null;
  let removed = 0;
  for (const f of listLogFiles(root, opts.scope, opts.app)) {
    if (cutoff !== null) {
      let mtime: number;
      try { mtime = statSync(f).mtimeMs; } catch { continue; }
      if (mtime >= cutoff) continue;
    }
    try {
      unlinkSync(f);
      console.log(`[swao log] removed ${f}`);
      removed++;
    } catch (err) {
      console.error(`[swao log] failed to remove ${f}: ${(err as Error).message}`);
    }
  }
  if (removed === 0) {
    console.log('[swao log] nothing to remove');
  }
}

export function registerLog(program: Command): void {
  const cmd = program.command('log').description('Read and manage the WSP-scoped SWAO event log (#0327).');

  cmd
    .command('tail')
    .description('print recent entries (default: last 50 warn+)')
    .option('--level <level>', 'minimum severity: debug | info | warn | error | enhancement')
    .option('--since <iso>', 'ISO-8601 timestamp; only show entries at or after this time')
    .option('--scope <scope>', 'filter by scope: portfolio | app')
    .option('--app <id>', 'filter by app id (implies --scope app)')
    .option('--limit <n>', 'maximum entries to print', '50')
    .action((opts: TailOpts) => cmdTail(opts));

  cmd
    .command('show <run_id>')
    .description('print all entries tagged with the given run_id')
    .action((runId: string) => cmdShow(runId));

  cmd
    .command('search <pattern>')
    .description('regex match against code + message + context')
    .action((pattern: string) => cmdSearch(pattern));

  cmd
    .command('clear')
    .description('remove sink files (use --older-than to keep recent entries)')
    .option('--scope <scope>', 'portfolio | app')
    .option('--app <id>', 'limit to a single app')
    .option('--older-than <iso>', 'only remove files with mtime < this timestamp')
    .action((opts: { scope?: 'portfolio' | 'app'; app?: string; olderThan?: string }) => cmdClear(opts));

  // #0327 Part D (sprint-036): export-for-feedback path.
  cmd
    .command('export')
    .description('bundle the WSP-scoped event log into a PII-redacted .tar.gz ready to email back to the SWAO team (#0327 Part D)')
    .option('--for-feedback', 'enable the feedback-bundle path (currently the only mode)', false)
    .option('--out <path>', 'output .tar.gz path (default: ./swao-log-feedback-<ISO-ts>.tar.gz)')
    .option('--level <level>', 'minimum severity to include: debug | info | warn | error | enhancement (default: all)')
    .option('--scope <scope>', 'limit to portfolio | app sinks')
    .option('--app <id>', 'limit to a single app (implies --scope app)')
    .action((opts: ExportOpts) => cmdExport(opts));
}
