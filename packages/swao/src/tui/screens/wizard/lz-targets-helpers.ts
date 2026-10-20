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
import { load, dump } from 'js-yaml';
import { resolveLzTargets, lzTargetLabel, setLzTargetsInSwaoYml } from '@swao/core';
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

const ROOT_KEY = /^[^\s#]/;

/**
 * Text edit that keeps every comment of the file: sets
 * assessment.landing_zone.targets and drops a single-line
 * assessment.lz_cat_targets. Returns null when the layout is not one it
 * understands (the caller falls back to a parsed rewrite).
 */
function editTargetsText(text: string, targets: readonly string[]): string | null {
  const lines = text.split('\n');
  const targetLines = ['    targets:', ...targets.map((t) => `      - ${t}`)];
  const start = lines.findIndex((l) => /^assessment:\s*(#.*)?$/.test(l));
  if (start < 0) {
    if (lines.some((l) => /^assessment\s*:/.test(l))) return null; // flow or inline value
    const body = text.replace(/\s*$/, '');
    return `${body}\n\nassessment:\n  landing_zone:\n${targetLines.join('\n')}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (ROOT_KEY.test(lines[i]!)) { end = i; break; }
  }
  const block = lines.slice(start + 1, end).filter((l) => !/^ {2}lz_cat_targets:/.test(l));
  const lzIdx = block.findIndex((l) => /^ {2}landing_zone:\s*(#.*)?$/.test(l));
  if (lzIdx < 0) {
    if (block.some((l) => /^ {2}landing_zone\s*:/.test(l))) return null;
    block.unshift('  landing_zone:', ...targetLines);
  } else {
    let lzEnd = block.length;
    for (let i = lzIdx + 1; i < block.length; i++) {
      const l = block[i]!;
      if (l.trim() !== '' && !l.trimStart().startsWith('#') && !/^ {3,}/.test(l)) { lzEnd = i; break; }
    }
    const lzBody = block.slice(lzIdx + 1, lzEnd);
    const kept: string[] = [];
    for (let i = 0; i < lzBody.length; i++) {
      const l = lzBody[i]!;
      if (/^ {4}targets\s*:/.test(l)) {
        // Skip the key and its block-list items (deeper indent or `- ` at the same level).
        while (i + 1 < lzBody.length && (/^ {5,}\S/.test(lzBody[i + 1]!) || /^ {4}- /.test(lzBody[i + 1]!))) i++;
        continue;
      }
      kept.push(l);
    }
    block.splice(lzIdx, lzEnd - lzIdx, '  landing_zone:', ...targetLines, ...kept);
  }
  return [...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join('\n');
}

/**
 * Write `targets` to assessment.landing_zone.targets of the workspace
 * .swao.yml. The expected document comes from setLzTargetsInSwaoYml (core,
 * the same helper the LZ assessment screen uses); a comment-preserving text
 * edit is used when it parses to exactly that document, otherwise the
 * document is rewritten from the parsed object. Line endings are kept.
 * Returns false when the file is missing or unreadable.
 */
export function writeLzTargetsToYaml(workDir: string, targets: readonly string[]): boolean {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return false;
  try {
    const raw = readFileSync(yamlPath, 'utf-8');
    const crlf = raw.includes('\r\n');
    const text = crlf ? raw.replace(/\r\n/g, '\n') : raw;
    const parsed = (load(text) ?? {}) as Record<string, unknown>;
    const expected = setLzTargetsInSwaoYml(structuredClone(parsed), targets);
    const wanted = ((expected['assessment'] as Record<string, unknown>)['landing_zone'] as Record<string, unknown>)['targets'] as string[];
    let next = editTargetsText(text, wanted);
    if (next !== null) {
      try {
        if (!isDeepStrictEqual(load(next), expected)) next = null;
      } catch {
        next = null;
      }
    }
    if (next === null) next = dump(expected, { lineWidth: 120 });
    writeFileSync(yamlPath, crlf ? next.replace(/\n/g, '\r\n') : next, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
