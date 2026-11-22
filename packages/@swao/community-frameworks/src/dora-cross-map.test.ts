// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Community frameworks -- DORA cross-mapping in both directions (#4058)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// A DORA mapping into NIS2, BSI C5, EUCS, ISO/IEC 27001 or GDPR is mirrored
// unless it is a one-way pair of the README table; the mappings to BSI
// IT-Grundschutz 2023, KRITIS-DE and SOC 2 are two-way and listed with their
// path in the second README table. Both copies of DORA stay identical.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegimeCatalogue } from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, '..', 'frameworks');
const STANDALONE_DIR = join(__dirname, '..', '..', '..', '..', 'community-frameworks');
const README = readFileSync(join(FRAMEWORKS_DIR, 'dora', 'README.md'), 'utf-8');

const mapsBack = new Map<string, Set<string>>();
const ownerOf = new Map<string, string>();
for (const dir of readdirSync(FRAMEWORKS_DIR)) {
  if (dir.endsWith('-demo') || !existsSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'))) continue;
  for (const c of loadRegimeCatalogue(join(FRAMEWORKS_DIR, dir, 'controls.yaml')).controls) {
    ownerOf.set(c.id, dir);
    mapsBack.set(c.id, new Set(c.maps_to));
  }
}
const dora = loadRegimeCatalogue(join(FRAMEWORKS_DIR, 'dora', 'controls.yaml')).controls;
const pairs = dora.flatMap((c) => c.maps_to.map((t) => ({ from: c.id, to: t, dir: ownerOf.get(t) })));
const key = (a: string, b: string): string => `${a} -> ${b}`;

/** Rows `| `A` | `B` | ...` of the README table whose header row starts with `header`. */
function tableRows(header: string): string[][] {
  const lines = README.split('\n');
  const start = lines.findIndex((l) => l.startsWith(header));
  expect(start, header).toBeGreaterThan(-1);
  const rows: string[][] = [];
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i++) rows.push(lines[i]!.split('|').slice(1, -1).map((x) => x.trim().replace(/`/g, '')));
  return rows;
}

describe('DORA cross-mapping in both directions (#4058)', () => {
  const MIRRORED = new Set(['nis2', 'bsi-c5', 'eucs', 'iso-27001', 'gdpr']);

  it('every one-way DORA pair into NIS2, BSI C5, EUCS, ISO 27001 and GDPR is exactly a README row with a reason', () => {
    const oneWay = pairs.filter((p) => p.dir !== undefined && MIRRORED.has(p.dir) && !mapsBack.get(p.to)?.has(p.from)).map((p) => key(p.from, p.to)).sort();
    const rows = tableRows('| DORA control | Target | Why one-way |');
    for (const r of rows) expect(r[2]?.length ?? 0, key(r[0]!, r[1]!)).toBeGreaterThan(20);
    expect(rows.map((r) => key(r[0]!, r[1]!)).sort()).toEqual(oneWay);
    // most DORA mappings are equivalences and are mirrored
    expect(pairs.filter((p) => p.dir !== undefined && MIRRORED.has(p.dir)).length - oneWay.length).toBeGreaterThanOrEqual(180);
  });

  it('the BSI IT-Grundschutz 2023, KRITIS-DE and SOC 2 mappings are two-way and listed with their path', () => {
    const added = pairs.filter((p) => p.dir === 'bsi-grundschutz-2023' || p.dir === 'kritis-de' || p.dir === 'soc-2');
    for (const d of ['bsi-grundschutz-2023', 'kritis-de', 'soc-2']) expect(added.some((p) => p.dir === d), d).toBe(true);
    for (const p of added) expect(mapsBack.get(p.to)?.has(p.from), key(p.from, p.to)).toBe(true);
    const rows = tableRows('| DORA control | Target | Framework | Path in the repository |');
    expect(rows.map((r) => key(r[0]!, r[1]!)).sort()).toEqual(added.map((p) => key(p.from, p.to)).sort());
    // the path names controls both sides map to
    for (const r of rows) for (const via of (r[3] ?? '').split(',').map((x) => x.trim())) {
      expect(mapsBack.get(via)?.has(r[0]!) || dora.find((c) => c.id === r[0])?.maps_to.includes(via), `${r[0]} via ${via}`).toBe(true);
    }
  });

  it('the KRITIS finance-sector dual obligation maps to the DORA ICT risk management framework', () => {
    expect(mapsBack.get('KRITIS_DE_SEC_FIN')?.has('DORA_Art_6')).toBe(true);
  });

  it('the Client LZ Policy Baseline sources name DORA controls by their exact line', () => {
    const doraLines = readFileSync(join(FRAMEWORKS_DIR, 'dora', 'controls.yaml'), 'utf-8').split('\n');
    const baseline = readFileSync(join(FRAMEWORKS_DIR, 'client-lz-policy-baseline', 'policy-baseline.yaml'), 'utf-8');
    const cites = [...baseline.matchAll(/(DORA_Art_[0-9_]+) [^(]*\(frameworks\/dora\/controls\.yaml:(\d+)/g)];
    expect(cites.length).toBeGreaterThanOrEqual(12);
    for (const m of cites) expect(doraLines[Number(m[2]) - 1], m[1]).toBe(`  - id: ${m[1]}`);
    const withDora = baseline.split('\n  - id: ').filter((b) => /default_source: ".*DORA_Art_/.test(b)).map((b) => b.split('\n')[0]);
    expect(withDora).toEqual(['CPB-RES-01', 'CPB-ENC-01', 'CPB-ENC-02', 'CPB-NET-01', 'CPB-NET-02', 'CPB-IAM-01', 'CPB-LOG-01', 'CPB-TAG-01', 'CPB-AVL-01', 'CPB-BCK-01', 'CPB-PRT-01']);
  });

  it('the public copies of the edited frameworks are identical to the package copies', () => {
    for (const d of ['dora', 'nis2', 'bsi-c5', 'eucs', 'gdpr', 'bsi-grundschutz-2023', 'kritis-de', 'client-lz-policy-baseline']) {
      for (const f of ['controls.yaml', 'framework-meta.yaml', 'README.md', 'policy-baseline.yaml']) {
        const a = join(FRAMEWORKS_DIR, d, f);
        const b = join(STANDALONE_DIR, d, f);
        if (!existsSync(a)) continue;
        expect(existsSync(b), `${d}/${f}`).toBe(true);
        expect(readFileSync(b, 'utf-8') === readFileSync(a, 'utf-8'), `${d}/${f}`).toBe(true);
      }
    }
  });
});
