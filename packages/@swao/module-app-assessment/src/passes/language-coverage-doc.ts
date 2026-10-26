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

// #3486: renders the language x pass coverage matrix (language-coverage.ts,
// Design 070 section 2.6) and the package ecosystems into the generated
// blocks of the "Supported languages" manual page (EN and DE). The rows come
// from SOURCE_LANGUAGES and the cells from coverageLevel(), so the page follows
// the scan lists the passes export. Regenerate the committed blocks with
// `pnpm --filter @swao/module-app-assessment run docs:languages`; the
// colocated test fails when they are stale.

import {
  SOURCE_LANGUAGES,
  PACKAGE_ECOSYSTEMS,
  BUILD_MANIFEST_KINDS,
  ecosystemLanguages,
  manifestKindInfo,
  type CoverageLevel,
  type PackageEcosystem,
} from '@swao/core';
import { passLanguageRules, coverageLevel, type PassLanguageRule } from './language-coverage.js';
import { SBOM_OSV_ECOSYSTEMS } from './pass-05-sbom.js';

export type DocLocale = 'en' | 'de';
export const DOC_LOCALES: readonly DocLocale[] = ['en', 'de'];

/** Generated block ids, in page order. */
export const GENERATED_BLOCK_IDS = ['language-coverage', 'package-ecosystems'] as const;
export type GeneratedBlockId = typeof GENERATED_BLOCK_IDS[number];

/** Page path relative to swao/docs/, per locale. */
export const SUPPORTED_LANGUAGES_PAGES: Readonly<Record<DocLocale, string>> = {
  en: 'assessment/supported-languages.md',
  de: 'de/assessment/supported-languages.md',
};

export const REGENERATE_COMMAND = 'pnpm --filter @swao/module-app-assessment run docs:languages';

export function blockStartMarker(id: GeneratedBlockId): string {
  return `<!-- generated:${id}:start -->`;
}

export function blockEndMarker(id: GeneratedBlockId): string {
  return `<!-- generated:${id}:end -->`;
}

/**
 * Column header per pass key. A new pass column without a label in both
 * locales makes the renderer throw, so the page never ships a half-translated
 * table.
 */
const PASS_LABELS: Readonly<Record<string, Record<DocLocale, string>>> = {
  inv: { en: 'Inventory (INV)', de: 'Inventar (INV)' },
  state: { en: 'State (STATE)', de: 'Zustand (STATE)' },
  data: { en: 'Data (DATA)', de: 'Daten (DATA)' },
  sbom: { en: 'Dependencies (SBOM)', de: 'Abhängigkeiten (SBOM)' },
  tf: { en: 'Twelve-factor (TF)', de: 'Twelve-Factor (TF)' },
  egr: { en: 'Egress (EGR)', de: 'Egress (EGR)' },
  crypto: { en: 'Cryptography (CRYPTO)', de: 'Kryptografie (CRYPTO)' },
  quality: { en: 'Code health (QUALITY)', de: 'Codezustand (QUALITY)' },
  secrets: { en: 'Secrets (SECRETS)', de: 'Secrets (SECRETS)' },
};

const LEVEL_LABELS: Readonly<Record<CoverageLevel, Record<DocLocale, string>>> = {
  deterministic: { en: 'deterministic', de: 'deterministisch' },
  llm: { en: 'LLM', de: 'LLM' },
  none: { en: 'none', de: 'keine' },
};

const TEXT: Readonly<Record<string, Record<DocLocale, string>>> = {
  language: { en: 'Language', de: 'Sprache' },
  ecosystem: { en: 'Package ecosystem', de: 'Paket-Ökosystem' },
  languages: { en: 'Languages', de: 'Sprachen' },
  inventory: { en: 'Build manifests read (INV)', de: 'Build-Manifeste gelesen (INV)' },
  osv: { en: 'Vulnerability lookup in OSV (SBOM)', de: 'Schwachstellenabfrage in OSV (SBOM)' },
  yes: { en: 'yes', de: 'ja' },
  no: { en: 'no', de: 'nein' },
};

function text(key: string, locale: DocLocale): string {
  const t = TEXT[key];
  if (!t) throw new Error(`language-coverage-doc: no text for '${key}'`);
  return t[locale];
}

function passLabel(rule: PassLanguageRule, locale: DocLocale): string {
  const label = PASS_LABELS[rule.key];
  if (!label) {
    throw new Error(`language-coverage-doc: pass column '${rule.key}' has no EN/DE label; add it to PASS_LABELS`);
  }
  return label[locale];
}

/**
 * Case-insensitive code-unit order with a case-sensitive tie-break: identical
 * on every platform and locale (no localeCompare), C before C#, C++ and COBOL,
 * crates.io next to the other ecosystems rather than after all capitals.
 */
export function docSortOrder(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function row(cells: string[]): string {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

function table(header: string[], rows: string[][]): string {
  return [row(header), row(header.map(() => '---')), ...rows.map(row)].join('\n');
}

/** Language x pass table: every language the census recognises, one column per pass that reads source files or manifests. */
export function renderLanguageCoverageTable(locale: DocLocale, rules: PassLanguageRule[] = passLanguageRules()): string {
  const header = [text('language', locale), ...rules.map((r) => passLabel(r, locale))];
  const languages = [...SOURCE_LANGUAGES].sort(docSortOrder);
  const rows = languages.map((lang) => [lang, ...rules.map((r) => LEVEL_LABELS[coverageLevel(r, lang)][locale])]);
  return table(header, rows);
}

/** Package ecosystems: which languages each covers, and whether SBOM queries OSV for it. */
export function renderPackageEcosystemTable(locale: DocLocale): string {
  const osv = new Set<PackageEcosystem>(SBOM_OSV_ECOSYSTEMS);
  const manifests = new Set<PackageEcosystem>(BUILD_MANIFEST_KINDS.map((k) => manifestKindInfo(k).ecosystem));
  const header = [text('ecosystem', locale), text('languages', locale), text('inventory', locale), text('osv', locale)];
  const ecosystems = [...PACKAGE_ECOSYSTEMS].sort(docSortOrder);
  const rows = ecosystems.map((eco) => [
    eco,
    [...ecosystemLanguages(eco)].sort(docSortOrder).join(', '),
    text(manifests.has(eco) ? 'yes' : 'no', locale),
    text(osv.has(eco) ? 'yes' : 'no', locale),
  ]);
  return table(header, rows);
}

export function renderGeneratedBlock(id: GeneratedBlockId, locale: DocLocale): string {
  switch (id) {
    case 'language-coverage': return renderLanguageCoverageTable(locale);
    case 'package-ecosystems': return renderPackageEcosystemTable(locale);
    default: {
      const never: never = id;
      return never;
    }
  }
}

/** Committed content between the markers (without the blank separator lines), or null when the markers are missing. */
export function extractGeneratedBlock(page: string, id: GeneratedBlockId): string | null {
  const text = page.replace(/\r\n/g, '\n');
  const start = text.indexOf(blockStartMarker(id));
  const end = text.indexOf(blockEndMarker(id));
  if (start < 0 || end < 0 || end < start) return null;
  return text.slice(start + blockStartMarker(id).length, end).trim();
}

/** Page with every generated block replaced by the current rendering. Throws when a marker pair is missing. */
export function updateGeneratedBlocks(page: string, locale: DocLocale): string {
  let text = page.replace(/\r\n/g, '\n');
  for (const id of GENERATED_BLOCK_IDS) {
    const startMarker = blockStartMarker(id);
    const endMarker = blockEndMarker(id);
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start < 0 || end < 0 || end < start) {
      throw new Error(`language-coverage-doc: marker pair for '${id}' missing or out of order`);
    }
    // Blank lines around the table so markdown-it parses it as a table.
    text = `${text.slice(0, start + startMarker.length)}\n\n${renderGeneratedBlock(id, locale)}\n\n${text.slice(end)}`;
  }
  return text;
}
