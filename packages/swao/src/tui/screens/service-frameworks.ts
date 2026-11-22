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

// #4400 (Design 103 sections 3.6 and 7, D-10): the framework step of the
// Service Portfolio Assessment. SWAO_APM is evaluated in every service run:
// the step shows it selected and fixed, resolved through resolveRegimeCatalogue
// (the workspace copy first, else the copy bundled with SWAO). #4456 (owner
// 2026-11-15, frameworks: copy, never install): the other frameworks offered are
// only those installed in the workspace (`wsp/inputs/catalogs/community/`);
// SWAO_APM is the one framework that may come from the bundled set. The chosen
// set reaches `swao assess --type service --regimes SWAO_APM,<added>` through
// buildServiceAssessArgs; `swao service assess --regimes` refuses an id that is
// neither installed nor SWAO_APM (unknownServiceFrameworks, CLI parity).

import { join } from 'node:path';
import { discoverFrameworks, loadRegimeRegistry, resolveRegimeCatalogue } from '@swao/core';
import { CURSOR_MARKER, PICKER_ROW_INDENT, fitDetail, labelColumnWidth, rowLabelWidth } from '@swao/tui-kit';
import { COMMUNITY_FRAMEWORKS_URL } from '../../commands/framework.js';
import { SERVICE_BASELINE_FRAMEWORK, serviceRunFrameworks } from '../../commands/framework-selection.js';

export { SERVICE_BASELINE_FRAMEWORK, serviceRunFrameworks };

export interface ServiceFrameworkOption {
  id: string;
  name: string;
}

export interface ServiceFrameworkChoice {
  /** SWAO_APM as resolved for this workspace; null when it resolves nowhere. */
  baseline: { id: string; source: 'workspace' | 'bundled' } | null;
  /** The other community frameworks installed in the workspace that the operator may add, sorted by id. */
  options: ServiceFrameworkOption[];
}

/** Assessment-type scopes a framework must carry (or carry none) to be offered in a service run. */
const OFFERED_SCOPES = new Set(['service', 'app']);

/**
 * #4456: a framework name as the step shows it: a spaced double dash of the
 * catalogue name (as in the demo frameworks: "GDPR Demo (11 controls), Live-Presentation
 * Subset" in the catalogue with a double dash) reads as a comma (CLAUDE.md section 5.1).
 */
export function frameworkDisplayName(name: string): string {
  return name.replace(/ +-- +/g, ', ').trim();
}

/** Workspace folder the operator copies community frameworks into (#4456). */
export const WORKSPACE_FRAMEWORKS_DIR = 'wsp/inputs/catalogs/community';

/** #4456: where to get more frameworks, shown under the list and in the CLI refusal. */
export const SERVICE_FRAMEWORKS_MORE_HINT = `More frameworks: ${COMMUNITY_FRAMEWORKS_URL}; copy a framework folder into ${WORKSPACE_FRAMEWORKS_DIR}/<folder>/`;

/** Frameworks installed in the workspace (listed or not: a workspace copy is never hidden, #3297). */
function installedFrameworks(workspace: string): ReturnType<typeof discoverFrameworks> {
  return discoverFrameworks(join(workspace, ...WORKSPACE_FRAMEWORKS_DIR.split('/')), { includeUnlisted: true, warn: () => {} });
}

/**
 * The framework step options: SWAO_APM through the shared resolver (workspace
 * copy, else bundled), and the other frameworks installed in the workspace
 * (`wsp/inputs/catalogs/community/`) whose scope fits a service run. #4456: the
 * bundled set is never offered; `bundledDir` only resolves SWAO_APM.
 */
export function serviceFrameworkChoice(workspace: string, bundledDir: string | undefined): ServiceFrameworkChoice {
  const resolved = resolveRegimeCatalogue(workspace, SERVICE_BASELINE_FRAMEWORK, bundledDir);
  const byId = new Map<string, ServiceFrameworkOption>();
  for (const f of installedFrameworks(workspace)) {
    if (f.id === SERVICE_BASELINE_FRAMEWORK || byId.has(f.id)) continue;
    const scope = f.meta.assessment_type_scope;
    if (scope.length > 0 && !scope.some((s) => OFFERED_SCOPES.has(s))) continue;
    byId.set(f.id, { id: f.id, name: frameworkDisplayName(f.meta.name ?? f.id) });
  }
  return {
    baseline: resolved ? { id: SERVICE_BASELINE_FRAMEWORK, source: resolved.source } : null,
    options: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * #4456 (CLI parity with the framework step): the ids of `--regimes` that are
 * neither SWAO_APM nor installed in the workspace. Installed means a framework
 * folder under `wsp/inputs/catalogs/community/` (its id) or an id the workspace
 * registry resolves (for example a `replaces:` alias of an installed framework).
 */
export function unknownServiceFrameworks(workspace: string, ids: readonly string[]): string[] {
  const installed = new Set<string>([SERVICE_BASELINE_FRAMEWORK]);
  for (const f of installedFrameworks(workspace)) installed.add(f.id);
  try {
    for (const id of loadRegimeRegistry(join(workspace, 'wsp', 'inputs', 'catalogs')).byId.keys()) installed.add(id);
  } catch { /* an invalid workspace registry leaves the folder ids */ }
  return [...new Set(ids.filter((id) => !installed.has(id)))];
}

/** #4456: the refusal of `swao service assess --regimes` for ids that are not installed. */
export function unknownServiceFrameworksMessage(unknown: readonly string[]): string {
  return `--regimes: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not installed in this workspace (only ${SERVICE_BASELINE_FRAMEWORK} and the frameworks in ${WORKSPACE_FRAMEWORKS_DIR}/ can be added). ${SERVICE_FRAMEWORKS_MORE_HINT}`;
}

/** Width of the picker's checkbox prefix: the cursor marker plus "[x] " (MultiSelect). */
const PICKER_PREFIX_WIDTH = CURSOR_MARKER.length + 4;

/**
 * #4456: the detail of each option row cut to the row width, so every framework
 * takes one line in a picker of `width` columns (useHeaderWidth, the owner's direction for
 * this step; MultiSelect itself wraps a long detail, Design 126 section 8 rules
 * 5 and 6). Same width rule as MultiSelect: the header rule width, the row
 * indent, the checkbox prefix and the padded label column.
 */
export function serviceFrameworkRowDetails(options: readonly ServiceFrameworkOption[], width: number): string[] {
  const rowWidth = Math.max(1, width - PICKER_ROW_INDENT);
  const labelWidth = labelColumnWidth(options.map((o) => o.id), rowWidth, PICKER_PREFIX_WIDTH, true);
  return options.map((o) => fitDetail(o.name, rowWidth, PICKER_PREFIX_WIDTH + rowLabelWidth(o.id, labelWidth)));
}

/** The frameworks line of the confirmation step: SWAO_APM (fixed) plus the added ones. */
export function serviceFrameworksLine(added: readonly string[]): string {
  const all = serviceRunFrameworks(added);
  return `${all[0]} (always evaluated)${all.length > 1 ? `, ${all.slice(1).join(', ')}` : ' and the default frameworks of each app'}`;
}
