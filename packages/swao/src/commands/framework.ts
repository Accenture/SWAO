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

// `swao framework` CLI -- Community Frameworks (#0324, sprint-036).
//
//   swao framework list   -- list the frameworks in the workspace community
//                            framework folder (wsp/inputs/catalogs/community/)
//
// #4126 (owner decision 2026-11-08, Design 123 D-07 changed): `install`,
// `uninstall`, `info` and `baseline show / diff / upgrade / copy` are removed
// together with the TUI Tools > Frameworks entry. SWAO never installs or
// updates a community framework after `swao init` (the demo seeding is the only
// automatic install); a user copies the framework folder it needs from the
// GitHub repository into the workspace, or builds its own.

import type { Command } from 'commander';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { discoverFrameworks, frameworkContributorName } from '@swao/core';

/** #4126: where to get more community frameworks (a folder per framework). */
export const COMMUNITY_FRAMEWORKS_URL = 'https://github.com/Accenture/SWAO/tree/main/community-frameworks';

/**
 * Workspace community catalogue folder: the one discovery, the TUI framework
 * selection, and Pass 11 read (#3149; previously `<ws>/catalogs/community`).
 */
export function communityDir(ws: string): string {
  return join(ws, 'wsp', 'inputs', 'catalogs', 'community');
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

/** #4126: the "where to get more" lines printed by `swao framework list`. */
function printWhereToGetMore(): void {
  console.log('More frameworks: copy a framework folder from the GitHub repository');
  console.log(`  ${COMMUNITY_FRAMEWORKS_URL}`);
  console.log('into wsp/inputs/catalogs/community/<folder>/ of the workspace, or build your own.');
}

/**
 * `swao framework list` (#4126): the frameworks in the workspace community
 * framework folder, discovered from each folder's framework-meta.yaml (#3297).
 * `workspaceOverride` is for tests (vitest workers cannot chdir); undefined
 * walks up from cwd, null means "not in a workspace".
 */
export function cmdList(workspaceOverride?: string | null): void {
  const ws = workspaceOverride === undefined ? resolveWorkspace() : workspaceOverride;
  if (!ws) {
    console.log('[swao framework list] not in a workspace (no .swao.yml walking up from the current folder).');
    printWhereToGetMore();
    return;
  }
  const dir = communityDir(ws);
  const frameworks = discoverFrameworks(dir, { warn: (m) => console.error(m) });
  const listed = new Set(frameworks.map((f) => f.folder));
  const otherFolders = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !listed.has(e.name))
      .map((e) => e.name)
      .sort()
    : [];

  if (frameworks.length === 0) {
    console.log(`No community frameworks in this workspace (${dir}).`);
  } else {
    console.log(`Community frameworks in this workspace (${dir}):`);
    console.log('');
    for (const f of frameworks) {
      console.log(`  ${f.id}`);
      console.log(`    name:           ${f.meta.name ?? '(no name field)'}`);
      console.log(`    folder:         ${f.folder}`);
      console.log(`    contributor:    ${frameworkContributorName(f.meta) ?? '(no contributor)'}`);
      console.log(`    version:        ${f.meta.version ?? '(unspecified)'}`);
      console.log(`    applicability:  ${f.meta.applicability_hints.join(', ') || '(unspecified)'}`);
      console.log('');
    }
  }
  if (otherFolders.length > 0) {
    console.log('Folders without a valid framework-meta.yaml (not offered for selection):');
    for (const folder of otherFolders) console.log(`  ${folder}`);
    console.log('');
  }
  printWhereToGetMore();
}

export function registerFramework(program: Command): void {
  const cmd = program.command('framework').description('Community Frameworks: list the frameworks in the workspace (#0324, #4126).');

  cmd
    .command('list')
    .description('list the community frameworks in the workspace (wsp/inputs/catalogs/community/) and where to get more')
    .action(() => cmdList());
}
