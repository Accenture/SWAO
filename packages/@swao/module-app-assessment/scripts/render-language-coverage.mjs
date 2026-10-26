#!/usr/bin/env node
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

// #3486: regenerates the language coverage blocks of the "Supported
// languages" manual page (swao/docs/assessment/supported-languages.md and the
// DE twin) from the built coverage matrix.
//
//   pnpm --filter @swao/module-app-assessment run docs:languages
//
// The package script builds dist/ first. Without --write the script only
// reports which pages are stale and exits 1 if any is.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { DOC_LOCALES, SUPPORTED_LANGUAGES_PAGES, updateGeneratedBlocks } =
  await import('../dist/passes/language-coverage-doc.js');

const write = process.argv.includes('--write');
const docsRoot = fileURLToPath(new URL('../../../../docs/', import.meta.url));

let stale = 0;
for (const locale of DOC_LOCALES) {
  const path = docsRoot + SUPPORTED_LANGUAGES_PAGES[locale];
  const before = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
  const after = updateGeneratedBlocks(before, locale);
  if (after === before) {
    console.log(`[ok] docs/${SUPPORTED_LANGUAGES_PAGES[locale]} is current`);
    continue;
  }
  if (write) {
    writeFileSync(path, after, 'utf-8');
    console.log(`[write] docs/${SUPPORTED_LANGUAGES_PAGES[locale]} regenerated`);
  } else {
    stale++;
    console.log(`[stale] docs/${SUPPORTED_LANGUAGES_PAGES[locale]} (run with --write)`);
  }
}
process.exit(stale > 0 ? 1 : 0);
