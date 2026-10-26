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

// #3486: the "Supported languages" page carries the coverage matrix as
// generated blocks; this test fails when the committed blocks are stale.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCE_LANGUAGES, PACKAGE_ECOSYSTEMS } from '@swao/core';
import {
  DOC_LOCALES,
  GENERATED_BLOCK_IDS,
  SUPPORTED_LANGUAGES_PAGES,
  REGENERATE_COMMAND,
  renderGeneratedBlock,
  renderLanguageCoverageTable,
  renderPackageEcosystemTable,
  extractGeneratedBlock,
  updateGeneratedBlocks,
  blockStartMarker,
  blockEndMarker,
  docSortOrder,
} from './language-coverage-doc.js';
import { passLanguageRules } from './language-coverage.js';

// src/passes -> swao/docs
const DOCS_ROOT = fileURLToPath(new URL('../../../../../docs/', import.meta.url));
const readPage = (locale: 'en' | 'de'): string => readFileSync(DOCS_ROOT + SUPPORTED_LANGUAGES_PAGES[locale], 'utf-8');

describe('supported-languages page (#3486)', () => {
  for (const locale of DOC_LOCALES) {
    for (const id of GENERATED_BLOCK_IDS) {
      it(`committed ${locale} block '${id}' matches the generated table`, () => {
        const committed = extractGeneratedBlock(readPage(locale), id);
        expect(committed, `${SUPPORTED_LANGUAGES_PAGES[locale]} lacks the ${blockStartMarker(id)} / ${blockEndMarker(id)} markers`).not.toBeNull();
        expect(
          committed,
          `docs/${SUPPORTED_LANGUAGES_PAGES[locale]} block '${id}' is stale; regenerate with: ${REGENERATE_COMMAND}`,
        ).toBe(renderGeneratedBlock(id, locale));
      });
    }

    it(`${locale} rendering is publishable (no dashes, interpolation or emoji)`, () => {
      for (const id of GENERATED_BLOCK_IDS) {
        const out = renderGeneratedBlock(id, locale);
        expect(out).not.toMatch(/[\u2013\u2014]/);
        expect(out).not.toContain('{' + '{');
        expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    });
  }

  it('lists every census language and every pass column', () => {
    const lines = renderLanguageCoverageTable('en').split('\n');
    expect(lines).toHaveLength(2 + SOURCE_LANGUAGES.length);
    expect(lines[0].split('|').length - 2).toBe(1 + passLanguageRules().length);
    expect(lines.slice(2).map((l) => l.split('|')[1].trim())).toEqual([...SOURCE_LANGUAGES].sort(docSortOrder));
    expect(renderPackageEcosystemTable('de').split('\n')).toHaveLength(2 + PACKAGE_ECOSYSTEMS.length);
  });

  it('translates level labels for DE', () => {
    const de = renderLanguageCoverageTable('de');
    expect(de).toContain('deterministisch');
    expect(de).not.toMatch(/\| deterministic \|/);
    expect(renderLanguageCoverageTable('en')).toMatch(/\| LLM \|/);
  });

  it('throws on a pass column without a label', () => {
    const rules = [...passLanguageRules(), { ...passLanguageRules()[0], key: 'unlabelled' }];
    expect(() => renderLanguageCoverageTable('en', rules)).toThrow(/unlabelled/);
  });

  it('updateGeneratedBlocks rewrites only the marked regions and is idempotent', () => {
    const page = [
      'intro',
      blockStartMarker('language-coverage'), 'old', blockEndMarker('language-coverage'),
      'middle',
      blockStartMarker('package-ecosystems'), blockEndMarker('package-ecosystems'),
      'outro',
    ].join('\r\n');
    const once = updateGeneratedBlocks(page, 'en');
    expect(once.startsWith('intro\n')).toBe(true);
    expect(once.endsWith('outro')).toBe(true);
    expect(once).not.toContain('old');
    expect(extractGeneratedBlock(once, 'language-coverage')).toBe(renderLanguageCoverageTable('en'));
    expect(updateGeneratedBlocks(once, 'en')).toBe(once);
    expect(() => updateGeneratedBlocks('no markers', 'en')).toThrow(/marker pair/);
  });
});
