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

// Pass order, aliases, lens expansion and --skip-llm filtering (#3152, #3158).

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  CANONICAL_PASS_ORDER,
  DEFAULT_PASS_KEYS,
  resolvePassAlias,
  sortPassesCanonical,
  normaliseRequestedPasses,
  applySkipLlm,
  expandPassProfile,
  filterByPassProfile,
  UNREAD_REFERENCE_CATALOGUES,
  WIRED_REFERENCE_CATALOGUES,
} from './orchestrator.js';

const LENSES = [
  { id: 'cloud-migration', passes: ['INV', 'STATE', 'DATA', 'CTX', 'SBOM', 'TF', 'EGR', 'CRYPTO', 'SYNTH', 'LZR', 'COMP', 'SCOPE'] },
  { id: 'security-focus', passes: ['SBOM', 'CRYPTO', 'EGR', 'MAL'] },
];

const idx = (k: string): number => CANONICAL_PASS_ORDER.indexOf(k);

describe('CANONICAL_PASS_ORDER (#3152)', () => {
  it('runs DYN, SCOPE, MALWARE and LZR before COMP so COMP sees their signals', () => {
    for (const k of ['dynamic', 'scope', 'malware', 'lzr']) expect(idx(k)).toBeLessThan(idx('comp'));
  });

  it('runs LZR before SYNTH so SYNTH reads the verdict of the current run', () => {
    expect(idx('lzr')).toBeLessThan(idx('synth'));
  });

  it('keeps COMP before SYNTH (#1350) and runs BLOCKS after SYNTH so it gets the synthesis context', () => {
    expect(idx('comp')).toBeLessThan(idx('synth'));
    expect(idx('synth')).toBeLessThan(idx('blocks'));
    expect(CANONICAL_PASS_ORDER[CANONICAL_PASS_ORDER.length - 1]).toBe('blocks');
  });

  it('lists every default pass', () => {
    for (const k of DEFAULT_PASS_KEYS) expect(idx(k)).toBeGreaterThanOrEqual(0);
  });
});

describe('sortPassesCanonical', () => {
  it('treats the input as a set and sorts it canonically', () => {
    expect(sortPassesCanonical(['blocks', 'synth', 'comp', 'SCOPE', 'inv', 'inv'])).toEqual(['inv', 'scope', 'comp', 'synth', 'blocks']);
  });

  it('keeps unknown keys at the end so the caller can warn', () => {
    expect(sortPassesCanonical(['bogus', 'inv'])).toEqual(['inv', 'bogus']);
  });
});

describe('resolvePassAlias (#3152)', () => {
  it('maps mal and dyn to their passes', () => {
    expect(resolvePassAlias('MAL')).toBe('malware');
    expect(resolvePassAlias('dyn')).toBe('dynamic');
  });

  it('no longer maps lzr to scope', () => {
    expect(resolvePassAlias('lzr')).toBeNull();
    expect(resolvePassAlias('LZR')).not.toBe('scope');
  });

  it('returns undefined for unknown keys', () => {
    expect(resolvePassAlias('nope')).toBeUndefined();
  });
});

describe('normaliseRequestedPasses (#3158)', () => {
  it('resolves aliases the TUI writes from lenses and drops lzr', () => {
    expect(normaliseRequestedPasses(['sbom', 'MAL', 'lzr', 'crypto'])).toEqual({ passes: ['sbom', 'crypto', 'malware'], lzrRequested: true });
  });
});

describe('applySkipLlm (#3158)', () => {
  it('removes ctx, comp and blocks but keeps data and synth', () => {
    expect(applySkipLlm(DEFAULT_PASS_KEYS.join(',')).split(',')).toEqual(
      DEFAULT_PASS_KEYS.filter((k) => !['ctx', 'comp', 'blocks'].includes(k)),
    );
    expect(applySkipLlm('data, CTX ,synth')).toBe('data,synth');
  });
});

describe('expandPassProfile / filterByPassProfile (#3158)', () => {
  it('resolves the MAL code of the security-focus lens to malware', () => {
    const exp = expandPassProfile(['security-focus'], LENSES);
    expect([...exp.enabledKeys].sort()).toEqual(['crypto', 'egr', 'malware', 'sbom']);
    expect(exp.unknownEntries).toEqual([]);
  });

  it('adds the opt-in malware pass when --passes was not explicit', () => {
    const exp = expandPassProfile(['security-focus'], LENSES);
    expect(filterByPassProfile([...DEFAULT_PASS_KEYS], exp, false)).toEqual(['sbom', 'egr', 'crypto', 'malware']);
  });

  it('does not add malware when the operator passed --passes explicitly', () => {
    const exp = expandPassProfile(['security-focus'], LENSES);
    expect(filterByPassProfile(['sbom', 'crypto'], exp, true)).toEqual(['sbom', 'crypto']);
  });

  it('records LZR from the cloud-migration lens without running scope under its name', () => {
    const exp = expandPassProfile(['cloud-migration'], LENSES);
    expect(exp.lzrRequested).toBe(true);
    expect(exp.enabledKeys.has('scope')).toBe(true); // listed by the lens itself
    const onlyLzr = expandPassProfile(['lzr'], LENSES);
    expect(onlyLzr.enabledKeys.has('scope')).toBe(false);
    // An empty enabled set leaves the request unfiltered.
    expect(filterByPassProfile(['inv', 'sbom'], onlyLzr, false)).toEqual(['inv', 'sbom']);
  });

  it('reports duplicates and unknown entries', () => {
    const exp = expandPassProfile(['inv', 'INV', 'bogus'], LENSES);
    expect(exp.duplicateEntries).toEqual(['INV']);
    expect(exp.unknownEntries).toEqual(['bogus']);
  });
});

describe('UNREAD_REFERENCE_CATALOGUES (#3158)', () => {
  const controlsDir = join(__dirname, '..', '..', '..', '..', 'controls');
  const passesDir = join(__dirname, 'passes');
  const passSources = readdirSync(passesDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(passesDir, f), 'utf-8'))
    .join('\n');

  it('lists catalogues that exist and that no pass reads', () => {
    for (const { file } of UNREAD_REFERENCE_CATALOGUES) {
      expect(existsSync(join(controlsDir, file)), file).toBe(true);
      expect(passSources.includes(file), `${file} is now read by a pass; remove it from the list`).toBe(false);
    }
  });

  it('is empty since #3160 wired the five catalogues', () => {
    expect(UNREAD_REFERENCE_CATALOGUES).toEqual([]);
  });

  it('every wired catalogue exists, is named by a pass source and has a loader (#3160)', () => {
    const loaderSource = readFileSync(join(__dirname, 'catalogue', 'reference-catalogues.ts'), 'utf-8');
    expect(WIRED_REFERENCE_CATALOGUES).toHaveLength(5);
    for (const { file } of WIRED_REFERENCE_CATALOGUES) {
      expect(existsSync(join(controlsDir, file)), file).toBe(true);
      expect(passSources.includes(file), `${file} is not named by any pass source`).toBe(true);
      expect(loaderSource.includes(`'${file}'`), `${file} has no loader in catalogue/reference-catalogues.ts`).toBe(true);
    }
  });
});
