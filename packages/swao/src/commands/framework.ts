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
//   swao framework list           -- enumerate bundled + installed frameworks
//   swao framework install <id>   -- copy bundled framework into workspace
//   swao framework info <id>      -- print framework metadata
//   swao framework uninstall <id> -- remove installed framework from workspace
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
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { communityFrameworksDir } from '@swao/community-frameworks';

// The bundled community frameworks live in the @swao/community-frameworks leaf
// content package (#0572); their on-disk path is resolved there (configurable
// via SWAO_COMMUNITY_FRAMEWORKS_DIR), shipped to the binary via the
// `../@swao/community-frameworks/frameworks/**` pkg.assets glob.
const __dirname = dirname(fileURLToPath(import.meta.url));

interface RegistryEntry {
  id: string;
  folder: string;
  contributor: string;
  version: string;
  applicability_hints: string[];
  description: string;
}

interface Registry {
  version: number;
  frameworks: RegistryEntry[];
}

interface FrameworkMeta {
  framework: {
    id: string;
    name?: string;
    version?: string;
    contributor?: string | { name?: string; email?: string };
    description?: string;
    applicability_hints?: string[];
  };
}

/**
 * Resolve the bundled community frameworks root (contains _registry.yaml + one
 * folder per framework). The path is owned + resolved by
 * @swao/community-frameworks (#0572), which handles the dev / pkg-binary layout
 * difference and the SWAO_COMMUNITY_FRAMEWORKS_DIR override. Returns null only
 * if the asset really isn't shipped (e.g. a tampered binary).
 */
function resolveBundledRoot(): string | null {
  try {
    if (existsSync(communityFrameworksDir) && statSync(communityFrameworksDir).isDirectory()) {
      return communityFrameworksDir;
    }
  } catch { /* not shipped */ }
  return null;
}

function readRegistry(bundledRoot: string): Registry | null {
  const registryPath = join(bundledRoot, '_registry.yaml');
  if (!existsSync(registryPath)) return null;
  try {
    return load(readFileSync(registryPath, 'utf-8')) as Registry;
  } catch {
    return null;
  }
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

export function cmdList(): void {
  const bundledRoot = resolveBundledRoot();
  if (!bundledRoot) {
    console.log('[swao framework list] bundled community-frameworks/ folder not found in this binary build.');
    console.log('[swao framework list] Reinstall the binary or run from a source checkout.');
    return;
  }
  const registry = readRegistry(bundledRoot);
  if (!registry) {
    console.error('[swao framework list] _registry.yaml is unreadable or missing under ' + bundledRoot);
    process.exitCode = 1;
    return;
  }

  // Optionally also list installed frameworks in the current workspace
  const ws = resolveWorkspace();
  const installedDir = ws ? join(ws, 'catalogs', 'community') : null;
  const installedIds = new Set<string>();
  if (installedDir && existsSync(installedDir)) {
    for (const entry of readdirSync(installedDir, { withFileTypes: true })) {
      if (entry.isDirectory()) installedIds.add(entry.name);
    }
  }

  console.log('Bundled community frameworks:');
  console.log('');
  for (const f of registry.frameworks) {
    const installed = installedIds.has(f.folder) ? ' [installed]' : '';
    console.log(`  ${f.id}${installed}`);
    console.log(`    folder:         ${f.folder}`);
    console.log(`    contributor:    ${f.contributor}`);
    console.log(`    version:        ${f.version}`);
    console.log(`    applicability:  ${(f.applicability_hints ?? []).join(', ') || '(unspecified)'}`);
    console.log(`    description:    ${f.description}`);
    console.log('');
  }

  if (installedIds.size > 0 && ws) {
    const installedNotBundled = [...installedIds].filter(
      (id) => !registry.frameworks.some((f) => f.folder === id),
    );
    if (installedNotBundled.length > 0) {
      console.log('Installed frameworks NOT in the bundled registry (engagement-local):');
      console.log('');
      for (const id of installedNotBundled.sort()) {
        console.log(`  ${id}   (at: ${join(installedDir!, id)})`);
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
  const registry = readRegistry(bundledRoot);
  if (!registry) {
    console.error('[swao framework install] _registry.yaml unreadable');
    process.exitCode = 1;
    return;
  }
  const entry = registry.frameworks.find((f) => f.id === id || f.folder === id);
  if (!entry) {
    console.error(`[swao framework install] no bundled framework with id or folder '${id}'`);
    console.error('Use `swao framework list` to enumerate available frameworks.');
    process.exitCode = 1;
    return;
  }
  const ws = resolveWorkspace();
  if (!ws) {
    console.error('[swao framework install] not in a workspace (no `apps/` or `.swao.yml` walking up from cwd)');
    process.exitCode = 1;
    return;
  }

  const src = join(bundledRoot, entry.folder);
  const dst = join(ws, 'catalogs', 'community', entry.folder);
  if (existsSync(dst)) {
    console.error(`[swao framework install] '${entry.id}' already installed at ${dst}`);
    console.error('Use `swao framework uninstall ' + entry.id + '` first if you want to reinstall.');
    process.exitCode = 1;
    return;
  }

  copyDir(src, dst);
  console.log(`[swao framework install] ${entry.id} installed at ${dst}`);
  console.log(`[swao framework install]   contributor:    ${entry.contributor}`);
  console.log(`[swao framework install]   version:        ${entry.version}`);
}

export function cmdInfo(id: string): void {
  const bundledRoot = resolveBundledRoot();
  if (!bundledRoot) {
    console.error('[swao framework info] bundled community-frameworks/ folder not found in this binary build');
    process.exitCode = 1;
    return;
  }
  const registry = readRegistry(bundledRoot);
  if (!registry) {
    console.error('[swao framework info] _registry.yaml unreadable');
    process.exitCode = 1;
    return;
  }
  const entry = registry.frameworks.find((f) => f.id === id || f.folder === id);
  if (!entry) {
    console.error(`[swao framework info] no framework with id or folder '${id}'`);
    process.exitCode = 1;
    return;
  }
  const metaPath = join(bundledRoot, entry.folder, 'framework-meta.yaml');
  if (!existsSync(metaPath)) {
    console.error(`[swao framework info] framework-meta.yaml missing at ${metaPath}`);
    process.exitCode = 1;
    return;
  }
  const meta = load(readFileSync(metaPath, 'utf-8')) as FrameworkMeta;
  console.log(`${meta.framework.id}  --  ${meta.framework.name ?? '(no name field)'}`);
  console.log('');
  const contrib = meta.framework.contributor;
  const contribDisplay = typeof contrib === 'string' ? contrib : (contrib?.name ?? '(no contributor)');
  console.log(`  contributor:     ${contribDisplay}`);
  console.log(`  version:         ${meta.framework.version ?? '(unspecified)'}`);
  console.log(`  applicability:   ${(meta.framework.applicability_hints ?? []).join(', ') || '(unspecified)'}`);
  console.log('');
  if (meta.framework.description) {
    console.log('  description:');
    for (const line of meta.framework.description.split('\n')) {
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
  // Resolve via bundled registry first; if not bundled, allow direct folder name.
  const bundledRoot = resolveBundledRoot();
  let folder = id;
  if (bundledRoot) {
    const registry = readRegistry(bundledRoot);
    const entry = registry?.frameworks.find((f) => f.id === id || f.folder === id);
    if (entry) folder = entry.folder;
  }
  const target = join(ws, 'catalogs', 'community', folder);
  if (!existsSync(target)) {
    console.error(`[swao framework uninstall] '${id}' not installed (no ${target})`);
    process.exitCode = 1;
    return;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`[swao framework uninstall] removed ${target}`);
}

export function registerFramework(program: Command): void {
  const cmd = program.command('framework').description('Manage Community Frameworks (#0324 sprint-036; bundled + per-workspace install).');

  cmd
    .command('list')
    .description('enumerate bundled + installed community frameworks')
    .action(() => cmdList());

  cmd
    .command('install <id>')
    .description('copy a bundled framework into the current workspace\'s catalogs/community/<id>/')
    .action((id: string) => cmdInstall(id));

  cmd
    .command('info <id>')
    .description('print framework metadata (id, contributor, version, applicability, description)')
    .action((id: string) => cmdInfo(id));

  cmd
    .command('uninstall <id>')
    .description('remove an installed framework from the current workspace')
    .action((id: string) => cmdUninstall(id));
}
