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

// `swao lenses` CLI -- Assessment Lens management (#0455, sprint-044).
//
// Subcommands:
//   swao lenses list              -- enumerate all available lenses; mark active ones
//   swao lenses show <id>         -- print one lens in detail
//   swao lenses add <ids...>      -- merge lenses into assessment.lenses
//   swao lenses set <ids...>      -- replace assessment.lenses entirely
//   swao lenses remove <id>       -- remove one lens from assessment.lenses
//
// Exported pure functions allow direct unit testing without child_process.

import type { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, dump } from 'js-yaml';
import { findWorkspace } from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default controls/lenses dir -- ../../../../controls/lenses from dist/commands/
// (mirrors the depth used by extractor.ts for ../../../../controls).
const DEFAULT_LENSES_DIR = join(__dirname, '../../../../controls/lenses');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LensDef {
  id: string;
  passes: string[];
  auto_frameworks: string[];
  /** One-paragraph guidance text shown in the TUI when this lens is focused (#0991). */
  description?: string;
}

// ---------------------------------------------------------------------------
// Exported pure functions (testable without the CLI layer)
// ---------------------------------------------------------------------------

// Built-in lens definitions embedded as constants so they are always available
// in the packaged binary regardless of filesystem path resolution (#0459).
const BUILT_IN_LENSES: LensDef[] = [
  {
    id: 'cloud-migration',
    passes: ['INV', 'STATE', 'DATA', 'CTX', 'SBOM', 'TF', 'EGR', 'CRYPTO', 'SYNTH', 'LZR', 'COMP', 'SCOPE'],
    auto_frameworks: [],
    description:
      'Full cloud migration assessment: all 12 core passes covering inventory, ' +
      'state analysis, data flows, context ingestion, SBOM/CVE, Terraform/IaC, ' +
      'egress, cryptography, synthesis, landing-zone fit, compliance evaluation, ' +
      'and scope coverage. Use for lift-and-shift or re-platform initiatives where ' +
      'a complete sovereignty and migration readiness picture is required.',
  },
  {
    id: 'security-focus',
    passes: ['SBOM', 'CRYPTO', 'EGR', 'MAL'],
    auto_frameworks: ['KRITIS', 'NIS2'],
    description:
      'Security-focused subset: SBOM/CVE scanning, cryptography audit, egress ' +
      'analysis, and malware detection (4 passes). Auto-activates KRITIS and NIS2 ' +
      'compliance frameworks. Use for regulated workloads where the primary concern ' +
      'is security posture, vulnerability exposure, and critical-infrastructure ' +
      'compliance rather than a full migration readiness assessment.',
  },
  {
    id: 'data-governance',
    passes: ['DATA', 'CTX'],
    auto_frameworks: ['GDPR'],
    description:
      'Data governance assessment: data flow analysis and context ingestion (2 ' +
      'passes). Auto-activates GDPR compliance framework. Use when the primary ' +
      'concern is data residency, processing lawfulness, cross-border transfers, ' +
      'and data subject rights under EU/EEA data protection law. Fastest lens -- ' +
      'runs in minutes without a full source scan.',
  },
];

/**
 * Return all available lenses. Built-in lenses are always present; any
 * .yaml files in lensesDir are merged in (custom lenses). The built-in
 * set ensures the TUI works even when the controls/ directory is not
 * resolvable from the packaged binary (#0459).
 */
export function listLenses(lensesDir: string = DEFAULT_LENSES_DIR): LensDef[] {
  const byId = new Map<string, LensDef>(BUILT_IN_LENSES.map((l) => [l.id, l]));

  // Merge YAML-defined lenses from disk (custom or overridden built-ins)
  try {
    if (existsSync(lensesDir)) {
      const files = readdirSync(lensesDir).filter((f) => f.endsWith('.yaml'));
      for (const f of files) {
        const raw = load(readFileSync(join(lensesDir, f), 'utf-8')) as {
          id?: unknown; passes?: unknown; auto_frameworks?: unknown;
        };
        const id = typeof raw.id === 'string' ? raw.id : f.replace(/\.yaml$/, '');
        byId.set(id, {
          id,
          passes: Array.isArray(raw.passes) ? (raw.passes as string[]) : [],
          auto_frameworks: Array.isArray(raw.auto_frameworks) ? (raw.auto_frameworks as string[]) : [],
        });
      }
    }
  } catch { /* disk unavailable -- use built-ins only */ }

  return [...byId.values()];
}

/**
 * Load a single lens definition by id from the given lenses directory.
 * Throws if the lens does not exist.
 */
export function showLens(lensId: string, lensesDir: string = DEFAULT_LENSES_DIR): LensDef {
  const lensPath = join(lensesDir, `${lensId}.yaml`);
  if (!existsSync(lensPath)) {
    throw new Error(`Unknown lens: ${lensId}. Run \`swao lenses list\` to see available lenses.`);
  }
  const raw = load(readFileSync(lensPath, 'utf-8')) as {
    id?: unknown;
    passes?: unknown;
    auto_frameworks?: unknown;
  };
  return {
    id: typeof raw.id === 'string' ? raw.id : lensId,
    passes: Array.isArray(raw.passes) ? (raw.passes as string[]) : [],
    auto_frameworks: Array.isArray(raw.auto_frameworks) ? (raw.auto_frameworks as string[]) : [],
  };
}

/**
 * Read the current assessment.lenses array from a .swao.yml file.
 * Returns [] if the file does not exist or assessment.lenses is absent.
 * Written by writeWorkspaceLenses() in this file (lenses.ts).
 * Field path: assessment.lenses. Round-trip test: lenses.test.ts (#0751).
 */
export function readWorkspaceLenses(swaoYmlPath: string): string[] {
  if (!existsSync(swaoYmlPath)) return [];
  const raw = load(readFileSync(swaoYmlPath, 'utf-8')) as {
    assessment?: { lenses?: unknown };
  } | null;
  if (!raw) return [];
  const lenses = raw?.assessment?.lenses;
  if (!Array.isArray(lenses)) return [];
  return lenses.filter((l): l is string => typeof l === 'string');
}

/**
 * Write an updated assessment.lenses array back to a .swao.yml file.
 * Other fields are preserved. Creates a minimal .swao.yml if the file
 * does not exist.
 */
export function writeWorkspaceLenses(swaoYmlPath: string, lenses: string[]): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(swaoYmlPath)) {
    const parsed = load(readFileSync(swaoYmlPath, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }

  // Merge: preserve existing assessment fields, update lenses.
  const assessment = (existing['assessment'] && typeof existing['assessment'] === 'object' && !Array.isArray(existing['assessment']))
    ? { ...(existing['assessment'] as Record<string, unknown>) }
    : {};
  assessment['lenses'] = lenses;
  existing['assessment'] = assessment;

  const dir = dirname(swaoYmlPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(swaoYmlPath, dump(existing, { lineWidth: 120 }), 'utf-8');
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function resolveSwaoYml(): string | null {
  const workspace = findWorkspace(process.cwd());
  if (!workspace) return null;
  return join(workspace, '.swao.yml');
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ---------------------------------------------------------------------------
// registerLenses
// ---------------------------------------------------------------------------

export function registerLenses(program: Command): void {
  const lenses = program
    .command('lenses')
    .description('Manage assessment lenses (pass selection profiles)');

  // ------------------------------------------------------------------
  // swao lenses list
  // ------------------------------------------------------------------
  lenses
    .command('list')
    .description('List all available lenses and mark which are active in this workspace')
    .action(() => {
      const defs = listLenses();
      const swaoYmlPath = resolveSwaoYml();
      const active = swaoYmlPath ? readWorkspaceLenses(swaoYmlPath) : [];

      const header = `${ padRight('ID', 20) }${ padRight('Passes', 40) }Auto-frameworks`;
      console.log(header);
      console.log('-'.repeat(header.length));

      for (const def of defs) {
        const passStr = def.passes.join(', ');
        const fwStr = def.auto_frameworks.length > 0 ? def.auto_frameworks.join(', ') : '(none)';
        const activeMark = active.includes(def.id) ? ' [active]' : '';
        console.log(`${ padRight(def.id + activeMark, 20) }${ padRight(passStr, 40) }${ fwStr }`);
      }

      if (active.length === 0) {
        console.log('\n(No lenses configured in workspace .swao.yml -- default: cloud-migration)');
      }
    });

  // ------------------------------------------------------------------
  // swao lenses show <id>
  // ------------------------------------------------------------------
  lenses
    .command('show <id>')
    .description('Show details for one lens')
    .action((id: string) => {
      let def: LensDef;
      try {
        def = showLens(id);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
        return;
      }
      console.log(`id:               ${ def.id }`);
      console.log(`passes:`);
      for (const p of def.passes) {
        console.log(`  - ${ p }`);
      }
      console.log(`auto_frameworks:  ${ def.auto_frameworks.length > 0 ? def.auto_frameworks.join(', ') : '(none)' }`);
    });

  // ------------------------------------------------------------------
  // swao lenses add <ids...>
  // ------------------------------------------------------------------
  lenses
    .command('add <ids...>')
    .description('Add one or more lenses to assessment.lenses (non-destructive merge)')
    .action((ids: string[]) => {
      const swaoYmlPath = resolveSwaoYml() ?? join(process.cwd(), '.swao.yml');
      const current = readWorkspaceLenses(swaoYmlPath);
      const merged = Array.from(new Set([...current, ...ids]));
      writeWorkspaceLenses(swaoYmlPath, merged);
      console.log(`assessment.lenses set to: ${ merged.join(', ') }`);
    });

  // ------------------------------------------------------------------
  // swao lenses set <ids...>
  // ------------------------------------------------------------------
  lenses
    .command('set <ids...>')
    .description('Replace assessment.lenses entirely')
    .action((ids: string[]) => {
      const swaoYmlPath = resolveSwaoYml() ?? join(process.cwd(), '.swao.yml');
      writeWorkspaceLenses(swaoYmlPath, ids);
      console.log(`assessment.lenses set to: ${ ids.join(', ') }`);
    });

  // ------------------------------------------------------------------
  // swao lenses remove <id>
  // ------------------------------------------------------------------
  lenses
    .command('remove <id>')
    .description('Remove one lens from assessment.lenses')
    .action((id: string) => {
      const swaoYmlPath = resolveSwaoYml() ?? join(process.cwd(), '.swao.yml');
      const current = readWorkspaceLenses(swaoYmlPath);
      const updated = current.filter((l) => l !== id);
      if (updated.length === current.length) {
        console.warn(`Lens '${ id }' is not in assessment.lenses -- nothing to remove.`);
        return;
      }
      writeWorkspaceLenses(swaoYmlPath, updated);
      console.log(`assessment.lenses set to: ${ updated.length > 0 ? updated.join(', ') : '(empty)' }`);
    });
}
