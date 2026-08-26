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

import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

// In-place migration to the everything-under-wsp layout (#0227).
//
// Old shape (per app):
//   apps/<id>/
//     .swao.yml
//     imports/        <-- siblings of wsp/
//     source/
//     wsp/runs|exports|reports/
//
// New shape:
//   apps/<id>/
//     .swao.yml
//     wsp/
//       inputs/
//         (cmdb|finops|.../ samples + READMEs ... formerly imports/*)
//         source/    (formerly source/)
//       runs|exports|reports/
//
// For each app this does:
//   1. mv imports/ -> wsp/inputs/   (preserves all customer files; merges if wsp/inputs/ already exists)
//   2. mv source/  -> wsp/inputs/source/
//   3. rewrite .swao.yml: imports_dir, source.path, context_inputs[].path
//
// Idempotent: re-running against an already-migrated app is a no-op.

interface MigrateOptions {
  workspace?: string;
  dryRun?: boolean;
}

interface AppMigrationResult {
  appId: string;
  appDir: string;
  movedImports: boolean;
  movedSource: boolean;
  rewroteYaml: boolean;
  skipped: string[];
  errors: string[];
}

function moveDir(from: string, to: string, dryRun: boolean): { ok: boolean; reason?: string } {
  if (!existsSync(from)) return { ok: false, reason: 'source absent' };
  if (existsSync(to)) {
    // Merge: walk children of `from` and move each child individually so we
    // don't trample an existing wsp/inputs/ that already holds files.
    if (dryRun) return { ok: true };
    try {
      for (const child of readdirSync(from)) {
        const fromChild = join(from, child);
        const toChild = join(to, child);
        if (existsSync(toChild)) {
          // Recurse into directories; never overwrite existing files.
          try {
            if (statSync(fromChild).isDirectory() && statSync(toChild).isDirectory()) {
              const r = moveDir(fromChild, toChild, dryRun);
              if (!r.ok && r.reason !== 'source absent') return r;
              continue;
            }
          } catch { /* fall through */ }
          // File collision: leave the new (target) one, skip the old.
          continue;
        }
        renameSync(fromChild, toChild);
      }
      // Try to remove the now-empty source dir; ignore if not empty.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      try { (require('fs') as typeof import('fs')).rmdirSync(from); } catch { /* keep */ }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }
  if (dryRun) return { ok: true };
  try {
    mkdirSync(join(to, '..'), { recursive: true });
    renameSync(from, to);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

function rewriteSwaoYml(yamlPath: string, dryRun: boolean): boolean {
  if (!existsSync(yamlPath)) return false;
  const before = readFileSync(yamlPath, 'utf-8');
  let after = before;

  // imports_dir: imports/         ->   imports_dir: wsp/inputs/
  after = after.replace(/^(\s*imports_dir:\s*)imports\/?\s*$/m, '$1wsp/inputs/');

  // source.path: source/[...]     ->   source.path: wsp/inputs/source/[...]
  // Only touch values that start with the literal "source/" or are exactly "source".
  after = after.replace(/^(\s*path:\s*)source(\/[^\s]*)?\s*$/m, (_m, prefix: string, rest: string | undefined) => {
    return `${prefix}wsp/inputs/source${rest ?? '/'}`;
  });

  // context_inputs[].path: imports/...  ->  wsp/inputs/...
  // Match both bare-style (path: imports/...) and inline-flow (- { ..., path: imports/... })
  after = after.replace(/(path:\s*)imports\//g, '$1wsp/inputs/');

  if (after === before) return false;
  if (!dryRun) writeFileSync(yamlPath, after, 'utf-8');
  return true;
}

function migrateApp(appDir: string, appId: string, dryRun: boolean): AppMigrationResult {
  const result: AppMigrationResult = {
    appId,
    appDir,
    movedImports: false,
    movedSource: false,
    rewroteYaml: false,
    skipped: [],
    errors: [],
  };

  const oldImports = join(appDir, 'imports');
  const oldSource  = join(appDir, 'source');
  const newImports = join(appDir, 'wsp', 'inputs');
  const newSource  = join(appDir, 'wsp', 'inputs', 'source');

  // 1) imports/ -> wsp/inputs/
  if (existsSync(oldImports)) {
    const r = moveDir(oldImports, newImports, dryRun);
    if (r.ok) result.movedImports = true;
    else result.errors.push(`imports/: ${r.reason}`);
  } else {
    result.skipped.push('imports/ (already migrated or never existed)');
  }

  // 2) source/ -> wsp/inputs/source/
  if (existsSync(oldSource)) {
    const r = moveDir(oldSource, newSource, dryRun);
    if (r.ok) result.movedSource = true;
    else result.errors.push(`source/: ${r.reason}`);
  } else {
    result.skipped.push('source/ (already migrated or never existed)');
  }

  // 3) Rewrite .swao.yml paths
  const yamlPath = join(appDir, '.swao.yml');
  if (existsSync(yamlPath)) {
    try {
      if (rewriteSwaoYml(yamlPath, dryRun)) result.rewroteYaml = true;
      else result.skipped.push('.swao.yml (already references wsp/inputs/)');
    } catch (e) {
      result.errors.push(`.swao.yml: ${(e as Error).message}`);
    }
  }

  return result;
}

export function registerMigrateWorkspace(program: Command): void {
  program
    .command('migrate-workspace [directory]')
    .description('Migrate an existing workspace to the wsp/inputs/ layout (#0227). Moves each app\'s imports/ and source/ folders under wsp/inputs/ and rewrites .swao.yml paths. Idempotent.')
    .option('--dry-run', 'Show what would change without touching the filesystem', false)
    .action((directory: string = '.', options: MigrateOptions) => {
      const workspaceDir = resolve(options.workspace ?? directory);
      const appsDir = join(workspaceDir, 'apps');

      if (!existsSync(appsDir)) {
        console.error(`[error] No apps/ directory found at ${appsDir}`);
        console.error(`        Run \`swao init <workspace> --name <appId>\` to start a fresh workspace.`);
        process.exit(1);
      }

      const dryRun = options.dryRun === true;
      const banner = dryRun ? '[dry-run]' : '[migrate]';
      console.log(`${banner} Workspace: ${workspaceDir}`);

      const appIds = readdirSync(appsDir).filter((name) => {
        try { return statSync(join(appsDir, name)).isDirectory(); } catch { return false; }
      });

      if (appIds.length === 0) {
        console.log(`${banner} No apps to migrate.`);
        return;
      }

      let totalMoves = 0;
      let totalRewrites = 0;
      let totalErrors = 0;

      // Workspace-level: <workspace>/catalogs/  ->  <workspace>/wsp/inputs/catalogs/
      const oldCatalogs = join(workspaceDir, 'catalogs');
      const newCatalogs = join(workspaceDir, 'wsp', 'inputs', 'catalogs');
      if (existsSync(oldCatalogs) && !existsSync(newCatalogs)) {
        if (dryRun) {
          console.log(`${banner} would mv  catalogs/  ->  wsp/inputs/catalogs/`);
          totalMoves++;
        } else {
          try {
            mkdirSync(join(workspaceDir, 'wsp', 'inputs'), { recursive: true });
            renameSync(oldCatalogs, newCatalogs);
            console.log(`${banner} mv  catalogs/  ->  wsp/inputs/catalogs/`);
            totalMoves++;
          } catch (e) {
            console.error(`  [error] catalogs/: ${(e as Error).message}`);
            totalErrors++;
          }
        }
      }

      for (const appId of appIds) {
        const r = migrateApp(join(appsDir, appId), appId, dryRun);
        const moves = (r.movedImports ? 1 : 0) + (r.movedSource ? 1 : 0);
        totalMoves    += moves;
        totalRewrites += r.rewroteYaml ? 1 : 0;
        totalErrors   += r.errors.length;

        if (moves > 0 || r.rewroteYaml) {
          console.log(`${banner} apps/${appId}/`);
          if (r.movedImports) console.log(`  ${dryRun ? 'would mv' : 'mv'}  imports/  ->  wsp/inputs/`);
          if (r.movedSource)  console.log(`  ${dryRun ? 'would mv' : 'mv'}  source/   ->  wsp/inputs/source/`);
          if (r.rewroteYaml)  console.log(`  ${dryRun ? 'would rewrite' : 'rewrote'}  .swao.yml paths (imports_dir, source.path, context_inputs[].path)`);
        } else if (r.errors.length === 0) {
          console.log(`${banner} apps/${appId}/  already migrated (no changes)`);
        }
        for (const err of r.errors) console.error(`  [error] ${err}`);
      }

      console.log('');
      console.log(`${banner} Summary: ${totalMoves} folder move(s), ${totalRewrites} .swao.yml rewrite(s), ${totalErrors} error(s).`);
      if (dryRun) console.log(`${banner} Re-run without --dry-run to apply.`);
      process.exit(totalErrors > 0 ? 1 : 0);
    });
}
