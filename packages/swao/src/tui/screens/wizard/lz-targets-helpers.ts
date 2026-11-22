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

// Setup Wizard LZ target step helpers (#3306).
//
// Options per provider come from the shared geography model of
// @swao/module-landing-zone (geographies.ts): a geography is offered only when
// it resolves to a default region in that provider's catalogue, followed by
// the catalogue's region ids. The choice is written to the workspace
// .swao.yml under assessment.landing_zone.targets, the key the CLI resolver
// reads (resolveLzTargets in @swao/core, after --lz-cat-targets, the CLI pair
// and the app .swao.yml).

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';
import { load } from 'js-yaml';
import { patchSwaoYmlText, resolveLzTargets, lzTargetLabel, setLzTargetsInSwaoYml, stripCommentedLzTargetsTemplate } from '@swao/core';
import {
  LZ_GEOGRAPHIES,
  lzGeographyDefaultRegion,
  lzGeographyKey,
  lzRegionResidency,
  type LzGeographyRegion,
} from '@swao/module-landing-zone';

/** One selectable value for a provider: a geography or a region id. */
export interface LzTargetOption {
  kind: 'geography' | 'region';
  /** The value written after `<provider>:` (geography id or region id). */
  value: string;
  /** Display label. */
  label: string;
}

/** Geographies that resolve for the provider (with their default region), then its regions. */
export function buildLzTargetOptions(regions: readonly LzGeographyRegion[]): LzTargetOption[] {
  const geographies: LzTargetOption[] = [];
  for (const g of LZ_GEOGRAPHIES) {
    const def = lzGeographyDefaultRegion(g.id, regions);
    if (def) geographies.push({ kind: 'geography', value: g.id, label: `${g.id} (geography, default region ${def})` });
  }
  const regionOpts: LzTargetOption[] = [...regions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => {
      const country = lzRegionResidency(r);
      return { kind: 'region' as const, value: r.id, label: country ? `${r.id} (${country})` : r.id };
    });
  return [...geographies, ...regionOpts];
}

/** True when a configured region value names this option (geography aliases match too). */
export function optionMatches(option: LzTargetOption, configuredRegion: string): boolean {
  if (option.kind === 'region') return option.value === configuredRegion;
  return lzGeographyKey(configuredRegion) === option.value;
}

/** Targets of the workspace .swao.yml as provider:region labels (pre-selection). */
export function readWorkspaceLzTargets(workDir: string): string[] {
  const p = join(workDir, '.swao.yml');
  if (!existsSync(p)) return [];
  try {
    const yml = load(readFileSync(p, 'utf-8')) as Record<string, unknown> | null;
    const a = yml?.['assessment'];
    const assessment = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
    return resolveLzTargets({ workspaceAssessment: assessment }).targets.map(lzTargetLabel);
  } catch {
    return [];
  }
}

/** #4495: the explanation line of the `swao init` LZ targets template (the hint the owner keeps). */
const LZ_HINT_PREFIX = '# LZ catalogue targets for every app';

/**
 * #4495: puts the hint `comment` (the explanation line of the LZ targets
 * template) directly above the live `  landing_zone:` key of the top-level
 * `assessment:` block, unless a line above it already holds it. Comment
 * lines only: the parsed document is unchanged.
 */
function keepLzHintAboveLiveKey(text: string, comment: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === 'assessment:' || l.startsWith('assessment: ') || l.startsWith('assessment:#') || l.startsWith('assessment:\r'));
  if (start < 0) return text;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l !== '' && l[0] !== ' ' && l[0] !== '#' && l[0] !== '\r') break; // next top-level key
    if (!l.startsWith('  landing_zone:')) continue;
    const prev = i > 0 ? lines[i - 1]!.trim() : '';
    if (prev.startsWith(LZ_HINT_PREFIX)) return text;
    lines.splice(i, 0, `  ${comment}`);
    return lines.join('\n');
  }
  return text;
}

/**
 * Write `targets` to assessment.landing_zone.targets of the workspace
 * .swao.yml. The expected document comes from setLzTargetsInSwaoYml (core,
 * the same helper the LZ assessment screen uses) and is written by the
 * minimal-patch writer of @swao/core (comments kept). Line endings are kept.
 * Returns false when the file is missing or unreadable.
 *
 * #4320 (rule of #4280): the file keeps one place for `landing_zone`. The
 * commented LZ targets template of `swao init` is removed when the live key
 * is written (stripCommentedLzTargetsTemplate), and a file without a live
 * `assessment:` block adopts its commented `# assessment:` template in place
 * (patchSwaoYmlText with adoptCommentedTemplates) instead of appending a
 * second `assessment:` block.
 *
 * #4495 (regression of #4280 criterion 2): the write goes through the
 * central minimal-patch writer only; the explanation line of the removed
 * template (`# LZ catalogue targets for every app ...`) stays as the hint,
 * directly above the live `landing_zone:` key. The commented example keys
 * still go, so uncommenting never gives a second `landing_zone`.
 */
export function writeLzTargetsToYaml(workDir: string, targets: readonly string[]): boolean {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return false;
  try {
    const raw = readFileSync(yamlPath, 'utf-8');
    const crlf = raw.includes('\r\n');
    const lf = crlf ? raw.replace(/\r\n/g, '\n') : raw;
    const hint = lf.split('\n').map((l) => l.trim()).find((l) => l.startsWith(LZ_HINT_PREFIX));
    const text = stripCommentedLzTargetsTemplate(lf);
    const parsed = (load(text) ?? {}) as Record<string, unknown>;
    const expected = setLzTargetsInSwaoYml(structuredClone(parsed), targets);
    const wanted = ((expected['assessment'] as Record<string, unknown>)['landing_zone'] as Record<string, unknown>)['targets'] as string[];
    // #4283 / #4495: the central minimal-patch writer, never a whole-file dump or a text edit of its own.
    const r = patchSwaoYmlText(text, [
      { path: ['assessment', 'landing_zone', 'targets'], value: wanted },
      { path: ['assessment', 'lz_cat_targets'], value: undefined },
    ], { adoptCommentedTemplates: true });
    if (!r.ok) return false;
    let next = r.text;
    if (hint) {
      const withHint = keepLzHintAboveLiveKey(next, hint);
      try { if (isDeepStrictEqual(load(withHint), load(next))) next = withHint; } catch { /* keep the patch without the hint */ }
    }
    writeFileSync(yamlPath, crlf ? next.replace(/\n/g, '\r\n') : next, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
