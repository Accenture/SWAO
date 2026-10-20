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

// `swao framework` CLI -- Community Frameworks management (#0324, sprint-036).
//
// Subcommands shipped in this commit (MVP per scope-cut at Phase F boundary):
//   swao framework list           -- enumerate shipped frameworks (+ workspace copies)
//   swao framework install <id>   -- copy a shipped framework into the workspace
//   swao framework info <id>      -- print framework metadata
//   swao framework uninstall <id> -- remove a framework copy from the workspace
//
// Out of scope for this MVP (carry-overs to sprint-037+):
//   - Migration of the seven flagship regimes (GDPR / HIPAA / PCI_DSS /
//     ISO_27001 / SOC_2 / BSI_C5 / DORA) from catalogs/standard/ into
//     swao/community-frameworks/.
//   - swao framework update (re-pull from registry; needs network surface)
//   - swao framework install --offline (air-gapped tarball install)
//   - LicenseGuard cap enforcement (5/10/50 per tier)
//   - swao framework list --contributor / --tag filters + search
//   - Standard-catalogs deprecation path (rewrite catalogs/standard/ at
//     `swao update` time)
//   - Community-signing roadmap stub
//
// Each carry-over lands in sprint-037+ as its own work item.

import type { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { discoverFrameworks, findFramework, frameworkContributorName, type DiscoveredFramework } from '@swao/core';
import { communityFrameworksDir } from '@swao/community-frameworks';

// The bundled community frameworks live in the @swao/community-frameworks leaf
// content package (#0572); their on-disk path is resolved there (configurable
// via SWAO_COMMUNITY_FRAMEWORKS_DIR), shipped to the binary via the
// `../@swao/community-frameworks/frameworks/**` pkg.assets glob.
//
// #3297 (Design 110 E-24 option A): the list is built from each shipped
// folder's own framework-meta.yaml (discoverFrameworks in @swao/core); there is
// no _registry.yaml. A folder with a missing or invalid meta is skipped with a
// warning. `install` is a copy of a shipped folder into the workspace; the
// compliance selector reads whatever sits in wsp/inputs/catalogs/community/.

/**
 * Workspace community catalogue folder: the one discovery, the TUI framework
 * selection, and Pass 11 read (#3149; previously `<ws>/catalogs/community`).
 */
export function communityDir(ws: string): string {
  return join(ws, 'wsp', 'inputs', 'catalogs', 'community');
}

/**
 * Resolve the bundled community frameworks root (one folder per framework).
 * The path is owned + resolved by @swao/community-frameworks (#0572), which
 * handles the dev / pkg-binary layout difference and the
 * SWAO_COMMUNITY_FRAMEWORKS_DIR override. Returns null only if the asset really
 * isn't shipped (e.g. a tampered binary).
 */
function resolveBundledRoot(): string | null {
  try {
    if (existsSync(communityFrameworksDir) && statSync(communityFrameworksDir).isDirectory()) {
      return communityFrameworksDir;
    }
  } catch { /* not shipped */ }
  return null;
}

/** Shipped frameworks, discovered from their framework-meta.yaml (#3297). */
export function listBundledFrameworks(bundledRoot: string): DiscoveredFramework[] {
  return discoverFrameworks(bundledRoot, { warn: (m) => console.error(m) });
}

/** Walk up from cwd looking for the workspace marker (.swao.yml). */
function resolveWorkspace(): string | null {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, '.swao.yml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      copyFileSync(s, d);
    }
  }
}

export type CopyFrameworkResult =
  | { ok: true; framework: DiscoveredFramework; target: string }
  | { ok: false; reason: 'unknown' }
  | { ok: false; reason: 'exists'; framework: DiscoveredFramework; target: string };

/**
 * Copy a shipped framework folder into
 * `<workspace>/wsp/inputs/catalogs/community/<folder>/` (the
 * `swao framework install` helper). Never overwrites an existing copy.
 */
export function copyFrameworkIntoWorkspace(idOrFolder: string, workspace: string, bundledRoot: string): CopyFrameworkResult {
  const framework = findFramework(listBundledFrameworks(bundledRoot), idOrFolder);
  if (!framework) return { ok: false, reason: 'unknown' };
  const target = join(communityDir(workspace), framework.folder);
  if (existsSync(target)) return { ok: false, reason: 'exists', framework, target };
  copyDir(framework.dir, target);
  return { ok: true, framework, target };
}

export function cmdList(bundledRootOverride?: string): void {
  const bundledRoot = bundledRootOverride ?? resolveBundledRoot();
  if (!bundledRoot) {
    console.log('[swao framework list] bundled community-frameworks/ folder not found in this binary build.');
    console.log('[swao framework list] Reinstall the binary or run from a source checkout.');
    return;
  }
  const frameworks = listBundledFrameworks(bundledRoot);

  // Also mark which shipped frameworks the current workspace already holds.
  const ws = resolveWorkspace();
  const workspaceDir = ws ? communityDir(ws) : null;
  const inWorkspace = new Set<string>();
  if (workspaceDir && existsSync(workspaceDir)) {
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (entry.isDirectory()) inWorkspace.add(entry.name);
    }
  }

  console.log('Bundled community frameworks:');
  console.log('');
  for (const f of frameworks) {
    const copied = inWorkspace.has(f.folder) ? ' [in workspace]' : '';
    console.log(`  ${f.id}${copied}`);
    console.log(`    name:           ${f.meta.name ?? '(no name field)'}`);
    console.log(`    folder:         ${f.folder}`);
    console.log(`    contributor:    ${frameworkContributorName(f.meta) ?? '(no contributor)'}`);
    console.log(`    version:        ${f.meta.version ?? '(unspecified)'}`);
    console.log(`    applicability:  ${f.meta.applicability_hints.join(', ') || '(unspecified)'}`);
    console.log('');
  }

  if (inWorkspace.size > 0 && ws) {
    const workspaceOnly = [...inWorkspace].filter(
      (folder) => !frameworks.some((f) => f.folder === folder),
    );
    if (workspaceOnly.length > 0) {
      console.log('Frameworks in this workspace that SWAO does not ship (engagement-local):');
      console.log('');
      for (const folder of workspaceOnly.sort()) {
        console.log(`  ${folder}   (at: ${join(workspaceDir!, folder)})`);
      }
    }
  }
}

export function cmdInstall(id: string): void {
  const bundledRoot = resolveBundledRoot();
  if (!bundledRoot) {
    console.error('[swao framework install] bundled community-frameworks/ folder not found in this binary build');
    process.exitCode = 1;
    return;
  }
  if (!findFramework(listBundledFrameworks(bundledRoot), id)) {
    console.error(`[swao framework install] no bundled framework with id or folder '${id}'`);
    console.error('Use `swao framework list` to enumerate available frameworks.');
    process.exitCode = 1;
    return;
  }
  const ws = resolveWorkspace();
  if (!ws) {
    console.error('[swao framework install] not in a workspace (no `.swao.yml` walking up from cwd)');
    process.exitCode = 1;
    return;
  }

  const result = copyFrameworkIntoWorkspace(id, ws, bundledRoot);
  if (!result.ok) {
    if (result.reason === 'exists') {
      console.error(`[swao framework install] '${result.framework.id}' is already in the workspace at ${result.target}`);
      console.error('Use `swao framework uninstall ' + result.framework.id + '` first if you want a fresh copy.');
    } else {
      console.error(`[swao framework install] no bundled framework with id or folder '${id}'`);
    }
    process.exitCode = 1;
    return;
  }
  const f = result.framework;
  console.log(`[swao framework install] ${f.id} copied into the workspace at ${result.target}`);
  console.log(`[swao framework install]   contributor:    ${frameworkContributorName(f.meta) ?? '(no contributor)'}`);
  console.log(`[swao framework install]   version:        ${f.meta.version ?? '(unspecified)'}`);
}

export function cmdInfo(id: string): void {
  const bundledRoot = resolveBundledRoot();
  if (!bundledRoot) {
    console.error('[swao framework info] bundled community-frameworks/ folder not found in this binary build');
    process.exitCode = 1;
    return;
  }
  const entry = findFramework(listBundledFrameworks(bundledRoot), id);
  if (!entry) {
    console.error(`[swao framework info] no framework with id or folder '${id}'`);
    process.exitCode = 1;
    return;
  }
  const meta = entry.meta;
  console.log(`${meta.id}  --  ${meta.name ?? '(no name field)'}`);
  console.log('');
  console.log(`  contributor:     ${frameworkContributorName(meta) ?? '(no contributor)'}`);
  console.log(`  version:         ${meta.version ?? '(unspecified)'}`);
  console.log(`  applicability:   ${meta.applicability_hints.join(', ') || '(unspecified)'}`);
  console.log('');
  if (meta.description) {
    console.log('  description:');
    for (const line of meta.description.split('\n')) {
      console.log(`    ${line}`);
    }
  }
}

export function cmdUninstall(id: string): void {
  const ws = resolveWorkspace();
  if (!ws) {
    console.error('[swao framework uninstall] not in a workspace');
    process.exitCode = 1;
    return;
  }
  // Resolve a shipped id to its folder first; otherwise treat the argument as a folder name.
  const bundledRoot = resolveBundledRoot();
  let folder = id;
  if (bundledRoot) {
    const entry = findFramework(listBundledFrameworks(bundledRoot), id);
    if (entry) folder = entry.folder;
  }
  const target = join(communityDir(ws), folder);
  if (!existsSync(target)) {
    console.error(`[swao framework uninstall] '${id}' is not in the workspace (no ${target})`);
    process.exitCode = 1;
    return;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`[swao framework uninstall] removed ${target}`);
}

export function registerFramework(program: Command): void {
  const cmd = program.command('framework').description('Community Frameworks: list the shipped ones and copy them into the workspace (#0324, #3297).');

  cmd
    .command('list')
    .description('list the shipped community frameworks and mark those already in the workspace')
    .action(() => cmdList());

  cmd
    .command('install <id>')
    .description('copy a shipped framework into the workspace (wsp/inputs/catalogs/community/<folder>/)')
    .action((id: string) => cmdInstall(id));

  cmd
    .command('info <id>')
    .description('print framework metadata (id, contributor, version, applicability, description)')
    .action((id: string) => cmdInfo(id));

  cmd
    .command('uninstall <id>')
    .description('remove a framework copy from the workspace')
    .action((id: string) => cmdUninstall(id));
}
