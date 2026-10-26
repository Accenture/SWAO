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

// #3429: infrastructure input roles, current vs target.
//
// Infrastructure inputs under wsp/inputs/ describe one of two platforms:
//   - current: the platform the client runs the application on today
//     (Terraform/OpenTofu state, Pulumi exports). Contradictions between the
//     documentation and these files are real findings.
//   - target:  a candidate landing zone the application may move to
//     (lz-<provider>-snapshot.json). A target that lacks a capability the
//     documentation requires is a target-platform gap, never a contradiction.
//
// Resolution order (first hit wins):
//   1. .swao.yml context.infra_roles override ({ path, role } entries, in order)
//   2. folder convention: infra/current/** = current, infra/target/** = target
//   3. filename defaults: lz-*-snapshot.json (and legacy lz-*-stub.json) =
//      target, *.tfstate = current,
//      any other file under terraform/ or pulumi/ = current (unchanged behaviour)
//   4. everything else has no infrastructure role (documentation, CSV, ...)
//
// Pure functions except readWorkspaceInfraRoles(), which reads the single
// .swao.yml file (no directory walk; see #3428 SourceScope).
//
// Design reference: docs/design/088 (CTX chunked ingestion) section 7,
// docs/design/065 section 6.1 (landing-zone snapshots are target state).

import { existsSync, readFileSync } from 'fs';
import { join, relative, isAbsolute, basename } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';

export type InfraRole = 'current' | 'target';

/** `implies` tag set on CTX signals that describe a target-platform gap (#3429). */
export const TARGET_CAPABILITY_GAP_TAG = 'gap_type:target_capability';

// #3429: mirrors InfraRoleEntrySchema in @swao/core swao-yml.ts. Kept local
// because module tests resolve @swao/core through its dist; dedupe once core
// ships the export in a released build.
export const InfraRoleEntrySchema = z.object({
  path: z.string().min(1),
  role: z.enum(['current', 'target']),
});

export type InfraRoleEntry = z.infer<typeof InfraRoleEntrySchema>;

/**
 * Extract and validate context.infra_roles from a parsed .swao.yml object.
 * Invalid entries are dropped individually (with a warning) so one typo does
 * not discard the rest of the operator's declarations.
 */
export function readInfraRoleOverrides(parsedYml: unknown): InfraRoleEntry[] {
  if (!parsedYml || typeof parsedYml !== 'object') return [];
  const ctx = (parsedYml as { context?: unknown }).context;
  if (!ctx || typeof ctx !== 'object') return [];
  const raw = (ctx as { infra_roles?: unknown }).infra_roles;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    console.warn('[warn] .swao.yml context.infra_roles must be a list of { path, role } entries; ignored');
    return [];
  }
  const out: InfraRoleEntry[] = [];
  for (const entry of raw) {
    const parsed = InfraRoleEntrySchema.safeParse(entry);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[warn] .swao.yml context.infra_roles entry ignored (needs path and role: current|target): ${JSON.stringify(entry)}`);
    }
  }
  return out;
}

function normaliseRel(relPath: string): string {
  let p = relPath.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('wsp/inputs/')) p = p.slice('wsp/inputs/'.length);
  return p;
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match an override path against a wsp/inputs/-relative file path.
 * - No wildcard: exact file match, or directory prefix (`terraform/legacy`
 *   matches `terraform/legacy/state.json`).
 * - `*` matches within one path segment, `**` matches across segments.
 */
export function infraRolePathMatches(pattern: string, relPath: string): boolean {
  const pat = normaliseRel(pattern).replace(/\/+$/, '');
  const rel = normaliseRel(relPath);
  if (pat === '') return false;
  if (!pat.includes('*')) {
    return rel === pat || rel.startsWith(`${pat}/`);
  }
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '*') {
      if (pat[i + 1] === '*') {
        re += '.*';
        i++;
        if (pat[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else {
      re += escapeRe(ch);
    }
  }
  return new RegExp(`^${re}(?:/.*)?$`).test(rel);
}

// Ingestion may prefix copies with a sequence number ("12 lz-aws-snapshot.json"),
// the same convention findTfstateFiles tolerates. Older workspaces carry the
// sample under the name lz-<provider>-stub.json; it is a target sample too.
const LZ_SNAPSHOT_RE = /^(?:\d+ )?lz-[^/]+-(?:snapshot|stub)\.json$/i;
const INFRA_TOP_DIRS = new Set(['terraform', 'pulumi']);

/**
 * Resolve the infrastructure role of a wsp/inputs/-relative path.
 * Returns undefined for files that are not infrastructure inputs.
 */
export function resolveInfraRole(relPath: string, overrides: readonly InfraRoleEntry[] = []): InfraRole | undefined {
  const rel = normaliseRel(relPath);
  for (const o of overrides) {
    if (infraRolePathMatches(o.path, rel)) return o.role;
  }
  const segments = rel.split('/');
  const first = (segments[0] ?? '').toLowerCase();
  if (first === 'infra') {
    const second = (segments[1] ?? '').toLowerCase();
    if (second === 'current') return 'current';
    if (second === 'target') return 'target';
  }
  const base = segments[segments.length - 1] ?? '';
  if (LZ_SNAPSHOT_RE.test(base)) return 'target';
  if (base.toLowerCase().endsWith('.tfstate')) return 'current';
  if (INFRA_TOP_DIRS.has(first) && segments.length > 1 && base.toLowerCase() !== 'readme.md') return 'current';
  return undefined;
}

/** Chunk-label tag for a role, e.g. `[TARGET-LZ]`. Empty for non-infra files. */
export function infraRoleLabel(role: InfraRole | undefined): string {
  if (role === undefined) return '';
  switch (role) {
    case 'current': return '[CURRENT-INFRA]';
    case 'target': return '[TARGET-LZ]';
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}

/** Read context.infra_roles from <workspacePath>/.swao.yml (single file read, no walk). */
export function readWorkspaceInfraRoles(workspacePath: string): InfraRoleEntry[] {
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return [];
  try {
    return readInfraRoleOverrides(load(readFileSync(ymlPath, 'utf-8')));
  } catch {
    return [];
  }
}

/**
 * Role of an infrastructure file given by absolute path. Files under
 * <workspacePath>/wsp/inputs/ are resolved by their relative path (overrides,
 * folder convention, defaults); files elsewhere (e.g. a tfstate at the source
 * root) only by the filename defaults.
 */
export function resolveInfraRoleForFile(
  absPath: string,
  workspacePath: string | undefined,
  overrides: readonly InfraRoleEntry[] = [],
): InfraRole | undefined {
  if (workspacePath) {
    const rel = relative(join(workspacePath, 'wsp', 'inputs'), absPath);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return resolveInfraRole(rel, overrides);
  }
  return resolveInfraRole(basename(absPath));
}

/** Strip a leading role tag (`[TARGET-LZ] `, `[CURRENT-INFRA] `) from an LLM evidence reference. */
export function stripInfraRoleTag(ref: string): string {
  return ref.replace(/^\s*\[(?:TARGET-LZ|CURRENT-INFRA)\]\s*/i, '');
}
