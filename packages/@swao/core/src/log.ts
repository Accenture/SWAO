// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Structured event log for SWAO -- WSP-scoped, NDJSON sink, per #0327.
//
// Two sinks, both inside the WSP scaffolding so the operator sees the log
// as part of their project artefacts (not hidden under a dotfile):
//
//   <workspace>/wsp/logs/portfolio-events-<YYYY-MM>.ndjson
//   <workspace>/apps/<appId>/wsp/logs/app-events-<YYYY-MM>.ndjson
//
// File rotation is monthly (YYYY-MM in the filename). Files are append-only
// NDJSON; each line is a JSON-encoded LogEntry.
//
// Severity 'enhancement' is the product-feedback channel: shortcomings in
// SWAO that the operator hit during an assessment. The operator can run
// `swao log export --for-feedback` to bundle + redact the log into an
// emailable tarball (separate command; sprint-034 follow-up).

import { existsSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'enhancement';
export type LogScope = 'portfolio' | 'app';

export interface LogEntry {
  ts: string;                      // ISO 8601 UTC
  level: LogLevel;
  scope: LogScope;
  code: string;                    // dotted slug, e.g. "provider.llm.fallthrough"
  message: string;
  context?: Record<string, unknown>;
  app_id?: string;                 // required when scope === 'app'
  run_id?: string;
  pass?: string;
}

// In-process state. Workspace root is resolved lazily on first log call and
// cached; pass-through tests can override via setWorkspaceRoot().
let cachedWorkspaceRoot: string | null = null;

export function setWorkspaceRoot(root: string | null): void {
  cachedWorkspaceRoot = root;
}

// Walk up from cwd looking for the workspace marker: `.swao.yml` at the
// directory root (the engagement spine). Returns null when run outside a
// workspace; logs are silently dropped in that case (with console mirror
// still firing). `.swao.yml` is the highest-precision marker -- `apps/`
// alone is too generic (e.g. Windows AppData\Local\apps).
//
// Walk-up cap raised from 8 to 32 per #0334 PR-#339 follow-up. The terminator
// is `parent === dir` (filesystem root); the numeric cap is a circuit-breaker
// against pathological symlink loops, not a depth budget.
export function resolveWorkspaceRoot(startDir: string = process.cwd()): string | null {
  if (cachedWorkspaceRoot) return cachedWorkspaceRoot;
  let dir = resolve(startDir);
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, '.swao.yml'))) {
      cachedWorkspaceRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// File-size threshold beyond which `emit` raises an enhancement signal.
// Monthly rotation alone can produce a single very large NDJSON file on a
// busy month; this lets the operator know to roll manually. ~50MB per #0334.
const LOG_FILE_SIZE_WARN_BYTES = 50 * 1024 * 1024;

// Process-local guard so we don't fire the size-warning enhancement entry
// more than once per logical sink per process. Without this, every emit()
// past the threshold would warn -> recursive emit -> warn ad infinitum.
const sizeWarnedSinks = new Set<string>();

function monthSlug(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sinkPath(entry: LogEntry, workspaceRoot: string): string {
  if (entry.scope === 'portfolio') {
    return join(workspaceRoot, 'wsp', 'logs', `portfolio-events-${monthSlug()}.ndjson`);
  }
  // app scope
  if (!entry.app_id) {
    throw new Error('LogEntry with scope=app must carry app_id');
  }
  return join(workspaceRoot, 'apps', entry.app_id, 'wsp', 'logs', `app-events-${monthSlug()}.ndjson`);
}

// Strip the userinfo (`user:password@`) component from any URL-shaped string
// in the entry's context. Minimal write-time redaction; the full PII pass
// happens at export time per #0327 Part D. We do it at write time too so a
// PAT never lands in the on-disk log even by accident.
function redactUrlUserinfo(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/(\bhttps?:\/\/)[^/@\s]*@/gi, '$1');
}

function redactContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ctx) return ctx;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = redactUrlUserinfo(v);
  }
  return out;
}

function consoleMirror(entry: LogEntry): void {
  if (entry.level === 'debug' || entry.level === 'info') return;
  // Redact URL userinfo in the terminal output too -- the operator already
  // has the token, but shoulder-surfing + screen-shared support sessions
  // are real failure modes. Use the same helper as the on-disk write.
  const message = redactUrlUserinfo(entry.message) as string;
  const prefix = `[${entry.level}] ${entry.code}`;
  const line = `${prefix} ${message}`;
  if (entry.level === 'error') {
    console.error(line);
  } else {
    console.warn(line);
  }
}

function emit(entry: LogEntry): void {
  consoleMirror(entry);
  const root = resolveWorkspaceRoot();
  if (!root) return;       // running outside a workspace -- console mirror only
  const path = sinkPath(entry, root);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[swao.log] failed to create log directory ${dir}: ${(err as Error).message}`);
      return;
    }
  }
  const safeEntry: LogEntry = {
    ...entry,
    message: redactUrlUserinfo(entry.message) as string,
    context: redactContext(entry.context),
  };
  // #0334 PR-#339: do not crash the assessment if the log write fails
  // (ENOSPC, EROFS, EACCES). Console mirror has already fired; warn and
  // continue so the active assessment finishes.
  try {
    appendFileSync(path, JSON.stringify(safeEntry) + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[swao.log] failed to write event to ${path}: ${(err as Error).message}`);
    return;
  }
  // #0334 PR-#339: emit a one-shot enhancement signal when the sink crosses
  // the size threshold. Guard against feedback loops with the warned-set;
  // never emit the size warning for the size-warning sink itself.
  if (entry.code !== 'swao.log.file-large' && !sizeWarnedSinks.has(path)) {
    try {
      const size = statSync(path).size;
      if (size >= LOG_FILE_SIZE_WARN_BYTES) {
        sizeWarnedSinks.add(path);
        const mb = Math.round(size / (1024 * 1024));
        emit({
          ts: new Date().toISOString(),
          level: 'warn',
          scope: entry.scope,
          app_id: entry.app_id,
          code: 'swao.log.file-large',
          message: `Event log file has reached ${mb} MB (threshold ${Math.round(LOG_FILE_SIZE_WARN_BYTES / (1024 * 1024))} MB); consider rotating manually or pruning.`,
          context: { path, size_bytes: size },
        });
      }
    } catch {
      // statSync failure is non-fatal -- the size-check is a courtesy.
    }
  }
}

export interface PortfolioLogOpts {
  context?: Record<string, unknown>;
  run_id?: string;
  pass?: string;
}

export interface AppLogOpts extends PortfolioLogOpts {
  app_id: string;
}

export function logPortfolio(
  level: LogLevel,
  code: string,
  message: string,
  opts: PortfolioLogOpts = {},
): void {
  emit({
    ts: new Date().toISOString(),
    level,
    scope: 'portfolio',
    code,
    message,
    context: opts.context,
    run_id: opts.run_id,
    pass: opts.pass,
  });
}

export function logApp(
  appId: string,
  level: LogLevel,
  code: string,
  message: string,
  opts: PortfolioLogOpts = {},
): void {
  emit({
    ts: new Date().toISOString(),
    level,
    scope: 'app',
    app_id: appId,
    code,
    message,
    context: opts.context,
    run_id: opts.run_id,
    pass: opts.pass,
  });
}

// Convenience aliases (portfolio scope) for the common case where a command
// runs against the whole workspace.
export const debug = (code: string, message: string, ctx?: Record<string, unknown>): void =>
  logPortfolio('debug', code, message, { context: ctx });
export const info = (code: string, message: string, ctx?: Record<string, unknown>): void =>
  logPortfolio('info', code, message, { context: ctx });
export const warn = (code: string, message: string, ctx?: Record<string, unknown>): void =>
  logPortfolio('warn', code, message, { context: ctx });
export const error = (code: string, message: string, ctx?: Record<string, unknown>): void =>
  logPortfolio('error', code, message, { context: ctx });
export const enhancement = (code: string, message: string, ctx?: Record<string, unknown>): void =>
  logPortfolio('enhancement', code, message, { context: ctx });

// For testing + the `swao log` CLI: enumerate the active sink paths.
export function listSinkPaths(workspaceRoot: string = resolveWorkspaceRoot() ?? process.cwd()): {
  portfolio: string;
  apps: Array<{ appId: string; path: string }>;
} {
  const portfolioMonth = join(workspaceRoot, 'wsp', 'logs', `portfolio-events-${monthSlug()}.ndjson`);
  const appsDir = join(workspaceRoot, 'apps');
  const apps: Array<{ appId: string; path: string }> = [];
  if (existsSync(appsDir)) {
    for (const entry of readdirSync(appsDir)) {
      const candidate = join(appsDir, entry);
      if (statSync(candidate).isDirectory()) {
        apps.push({
          appId: entry,
          path: join(candidate, 'wsp', 'logs', `app-events-${monthSlug()}.ndjson`),
        });
      }
    }
  }
  return { portfolio: portfolioMonth, apps };
}
