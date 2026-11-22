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

// service-controls.yaml for every community framework (#3578, Design 120 §8.2).
//
// S1: every framework folder (package copy) has a service-controls.yaml that
//     loads with status ok and names the framework-meta.yaml id
// S2: every control id it references exists in that framework's controls.yaml
// S3: every capability tag is in the vocabulary of the bundled LZ catalogues
// S4: rows are unreviewed drafts or human-curated, never anything else (Q-23)
// S5: the standalone copy carries the same file for every public framework

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { loadServiceControls, SERVICE_CONTROLS_FILE } from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, '..', 'frameworks');
const SWAO_ROOT = join(__dirname, '..', '..', '..', '..');
const STANDALONE_DIR = join(SWAO_ROOT, 'community-frameworks');
const LZ_CATALOGUES_DIR = join(SWAO_ROOT, 'lz-catalogues');

const frameworkDirs = readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name)
  .sort();

function frameworkId(dir: string): string {
  const meta = load(readFileSync(join(FRAMEWORKS_DIR, dir, 'framework-meta.yaml'), 'utf-8')) as { framework: { id: string } };
  return meta.framework.id;
}

function controlIds(dir: string): Set<string> {
  const raw = load(readFileSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'), 'utf-8')) as { controls: Array<{ id: string }> };
  return new Set(raw.controls.map((c) => c.id));
}

/** Every `fulfills` tag used by the bundled LZ catalogues (the capability vocabulary). */
function catalogueVocabulary(): Set<string> {
  const tags = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === 'fulfills' && Array.isArray(v)) v.forEach((t) => { if (typeof t === 'string') tags.add(t); });
        else walk(v);
      }
    }
  };
  for (const f of readdirSync(LZ_CATALOGUES_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    walk(JSON.parse(readFileSync(join(LZ_CATALOGUES_DIR, f), 'utf-8')));
  }
  return tags;
}

const vocabulary = catalogueVocabulary();

describe('S1-S4 -- service-controls.yaml per community framework (#3578)', () => {
  it('the capability vocabulary is not empty (guards S3 against a vacuous pass)', () => {
    expect(vocabulary.size).toBeGreaterThan(50);
  });

  for (const dir of frameworkDirs) {
    describe(dir, () => {
      const id = frameworkId(dir);
      const result = loadServiceControls(join(FRAMEWORKS_DIR, dir), id);

      it('S1: has a service-controls.yaml that loads and names its framework', () => {
        expect(existsSync(join(FRAMEWORKS_DIR, dir, SERVICE_CONTROLS_FILE)), `${dir}/${SERVICE_CONTROLS_FILE} missing`).toBe(true);
        expect(result.status, `${dir}: ${result.errors.join('; ')}`).toBe('ok');
      });

      it('S2: references only control ids of its own controls.yaml', () => {
        const known = controlIds(dir);
        const unknown = (result.mapping?.mappings ?? []).flatMap((m) => m.controls.filter((c) => !known.has(c)).map((c) => `${m.capability}:${c}`));
        expect(unknown, `${dir}: unknown control ids`).toEqual([]);
      });

      it('S3: uses only capability tags of the bundled LZ catalogues', () => {
        const outside = (result.mapping?.mappings ?? []).map((m) => m.capability).filter((t) => !vocabulary.has(t));
        expect(outside, `${dir}: tags outside the vocabulary`).toEqual([]);
      });

      it('S4: every row is an unreviewed draft with a source, or human-curated', () => {
        for (const m of result.mapping?.mappings ?? []) {
          if (m.confidence === 'derived') expect(m.source, `${dir}/${m.capability}: derived row without source`).toBeTruthy();
          else expect(m.confidence).toBe('curated');
        }
      });
    });
  }
});

/**
 * Control subjects that never belong to a cloud service capability (physical, personnel,
 * awareness, supplier, product certification). Keyword drafting produced such rows before
 * the review of PR #1785; this guard keeps them out.
 */
const EXCLUDED_SUBJECT = /physical|\bcctv\b|environmental controls|personnel|\bhr security|human resource|background (check|verification)|awareness|disciplinary|supplier|subprocessor|outsourc|equipment|declaration of conformity|ce marking|gebäude|sensibilisierung|lieferant|zutritt|physisch/i;
const AI_TAGS = ['managed_llm', 'ml_inference', 'ml_training', 'ml_nlp', 'ml_speech', 'ml_translation', 'ml_vision'];

function controlTitles(dir: string): Map<string, string> {
  const raw = load(readFileSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'), 'utf-8')) as { controls: Array<{ id: string; title?: string }> };
  return new Map(raw.controls.map((c) => [c.id, c.title ?? '']));
}

describe('S6-S8 -- content guards on the drafted mappings (#3578 review)', () => {
  it('S6 guard is not vacuous: it matches a known physical control title', () => {
    expect(EXCLUDED_SUBJECT.test('Physical access control to data centre and server rooms')).toBe(true);
    expect(EXCLUDED_SUBJECT.test('Cryptographic key management')).toBe(false);
  });

  for (const dir of frameworkDirs) {
    const id = frameworkId(dir);
    const result = loadServiceControls(join(FRAMEWORKS_DIR, dir), id);
    const rows = result.mapping?.mappings ?? [];

    it(`${dir} S6: no mapped control is about a physical, personnel, supplier or certification subject`, () => {
      const titles = controlTitles(dir);
      const hits = rows.flatMap((m) => m.controls
        .filter((c) => EXCLUDED_SUBJECT.test(titles.get(c) ?? ''))
        .map((c) => `${m.capability}:${c} (${titles.get(c)})`));
      expect(hits, `${dir}: excluded subjects mapped`).toEqual([]);
    });

    it(`${dir} S7: AI capability tags do not all share one identical control list`, () => {
      const ai = rows.filter((m) => AI_TAGS.includes(m.capability));
      if (ai.length < 2) return;
      const lists = new Set(ai.map((m) => [...m.controls].sort().join(',')));
      expect(lists.size, `${dir}: every AI tag maps to the same controls`).toBeGreaterThan(1);
    });

    it(`${dir} S8: derived rows state the drafting method (script and review), not a generic label`, () => {
      for (const m of rows.filter((r) => r.confidence === 'derived')) {
        expect(m.source, `${dir}/${m.capability}`).toMatch(/scripts\/draft-service-controls\.py/);
        expect(m.source, `${dir}/${m.capability}`).toMatch(/not human-reviewed/);
      }
    });
  }
});

describe('S5 -- standalone copy carries the mapping of every public framework', () => {
  const standalone = existsSync(STANDALONE_DIR)
    ? readdirSync(STANDALONE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  it.skipIf(standalone.length === 0)('standalone dir present', () => { expect(standalone.length).toBeGreaterThan(0); });
  for (const dir of standalone) {
    it(`${dir}: same service-controls.yaml as the package`, () => {
      const pkg = join(FRAMEWORKS_DIR, dir, SERVICE_CONTROLS_FILE);
      const sa = join(STANDALONE_DIR, dir, SERVICE_CONTROLS_FILE);
      expect(existsSync(sa), `${dir}: standalone ${SERVICE_CONTROLS_FILE} missing`).toBe(true);
      expect(readFileSync(sa).equals(readFileSync(pkg)), `${dir}: standalone copy differs`).toBe(true);
    });
  }
});
