// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Community frameworks -- DORA catalogue 2.0.0 tests (#3962)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// D1 pillars, size and Level 2 coverage; D2 citation and evidence marking;
// D3 cross-maps resolve in the shipped public catalogues; D4 old ids of
// catalogue 1.0.0 resolve through control-level replaces; D5 no invented
// thresholds; D6 landing zone scope.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { loadRegimeCatalogue, controlIdAliases, resolveControlIdKey, type RegimeControl } from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, '..', 'frameworks');
const DORA_DIR = join(FRAMEWORKS_DIR, 'dora');

// Frameworks not shipped in the public download (community-frameworks-sync.gate.mjs PREMIUM set).
const NOT_PUBLIC = new Set(['iso-27001', 'soc-2']);

const catalogue = loadRegimeCatalogue(join(DORA_DIR, 'controls.yaml'));
const controls: RegimeControl[] = catalogue.controls;
const ids = new Set(controls.map((c) => c.id));
const tag = (c: RegimeControl, axis: string): string[] => c.tags.filter((t) => t.startsWith(`${axis}.`));

const LEVEL2 = ['rts_2024_1774', 'rts_2024_1772', 'rts_2024_1773', 'rts_2025_301', 'rts_2025_532', 'rts_2025_1190', 'its_2024_2956', 'its_2025_302'];

// The 31 control ids of catalogue 1.0.0 (sprint-139, #2801).
const V1_IDS = [
  'DORA_Art_5_1', 'DORA_Art_5_2', 'DORA_Art_6', 'DORA_Art_7_1', 'DORA_Art_7_2', 'DORA_Art_8_1', 'DORA_Art_8_2',
  'DORA_Art_9_1', 'DORA_Art_9_2', 'DORA_Art_9_3', 'DORA_Art_10_1', 'DORA_Art_10_2', 'DORA_Art_11_1', 'DORA_Art_11_2',
  'DORA_Art_12_1', 'DORA_Art_12_2', 'DORA_Art_13', 'DORA_Art_14', 'DORA_Art_15', 'DORA_Art_16', 'DORA_Art_17',
  'DORA_Art_19', 'DORA_Art_24', 'DORA_Art_25', 'DORA_Art_26', 'DORA_Art_28_1', 'DORA_Art_28_2', 'DORA_Art_29',
  'DORA_Art_30', 'DORA_Art_31', 'DORA_Art_45',
];
const CORRECTED: Record<string, string> = {
  DORA_Art_7_2: 'DORA_Art_9_4', DORA_Art_11_2: 'DORA_Art_12_3', DORA_Art_15: 'DORA_Art_17_1', DORA_Art_16: 'DORA_Art_18_1',
  DORA_Art_17: 'DORA_Art_19_1', DORA_Art_19: 'DORA_Art_20_1', DORA_Art_31: 'DORA_Art_30_2',
};

describe('D1 -- DORA pillars, size and Level 2 coverage (#3962)', () => {
  it('has 50 to 55 controls (#2801 target)', () => {
    expect(controls.length).toBeGreaterThanOrEqual(50);
    expect(controls.length).toBeLessThanOrEqual(55);
  });

  it('covers all five pillars, each control in exactly one', () => {
    const pillars = new Set<string>();
    for (const c of controls) {
      const p = tag(c, 'pillar');
      expect(p, c.id).toHaveLength(1);
      pillars.add(p[0]!);
    }
    expect([...pillars].sort()).toEqual(['pillar.ict_risk_management', 'pillar.incident_management', 'pillar.information_sharing', 'pillar.resilience_testing', 'pillar.third_party_risk']);
  });

  it('cites every one of the eight Level 2 acts, in the tag and in regulatory_basis', () => {
    for (const act of LEVEL2) {
      const tagged = controls.filter((c) => c.tags.includes(`level2.${act}`));
      expect(tagged.length, act).toBeGreaterThan(0);
      const num = act.replace(/^(rts|its)_(\d{4})_(\d+)$/, '$2/$3');
      for (const c of tagged) expect(c.regulatory_basis, `${c.id} ${act}`).toContain(`(EU) ${num}`);
    }
  });

  it('lists the eight Level 2 acts as companion standards with an EUR-Lex URL', () => {
    const meta = load(readFileSync(join(DORA_DIR, 'framework-meta.yaml'), 'utf-8')) as { framework: { companion_standards: string[] } };
    for (const act of LEVEL2) {
      const num = act.replace(/^(rts|its)_(\d{4})_(\d+)$/, '$2/$3');
      const eurLex = (s: string): boolean => (s.match(/https:\/\/\S+/g) ?? []).some((u) => {
        const url = new URL(u.replace(/[).,;]+$/, ''));
        return url.host === 'eur-lex.europa.eu' && url.pathname.startsWith('/eli/');
      });
      expect(meta.framework.companion_standards.some((s) => s.includes(`(EU) ${num}`) && eurLex(s)), num).toBe(true);
    }
  });
});

describe('D2 -- citations and evidence marking (#3962)', () => {
  it.each(controls.map((c) => [c.id, c] as const))('%s cites DORA article and paragraph', (_id, c) => {
    expect(c.regulatory_basis).toMatch(/^Regulation \(EU\) 2022\/2554 Art\. \d+/);
    expect(c.official_control_id).toMatch(/^Art\. \d+/);
    expect(c.references.length).toBeGreaterThan(0);
    expect(c.remediation ?? '').not.toBe('');
  });

  it.each(controls.map((c) => [c.id, c] as const))('%s carries one evidence kind that matches its evidence basis', (_id, c) => {
    const e = tag(c, 'evidence');
    expect(e).toHaveLength(1);
    const technical = c.evidence_basis.some((b) => 'signal_prefix' in b);
    const documents = c.evidence_basis.some((b) => 'context_input' in b);
    switch (e[0]) {
      case 'evidence.organisational':
        expect(c.layer).toBe('governance');
        expect(documents && !technical).toBe(true);
        break;
      case 'evidence.both':
        expect(c.layer).toBeUndefined();
        expect(documents && technical).toBe(true);
        break;
      case 'evidence.workload':
        expect(c.layer).toBeUndefined();
        expect(technical).toBe(true);
        break;
      default:
        throw new Error(`${c.id}: unknown evidence tag ${e[0]}`);
    }
  });
});

describe('D3 -- cross-maps resolve against the shipped catalogues (#3962)', () => {
  const owner = new Map<string, string>();
  for (const dir of readdirSync(FRAMEWORKS_DIR)) {
    if (dir.endsWith('-demo') || dir === 'dora' || !existsSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'))) continue;
    for (const c of loadRegimeCatalogue(join(FRAMEWORKS_DIR, dir, 'controls.yaml')).controls) owner.set(c.id, dir);
  }
  const targets = controls.flatMap((c) => c.maps_to.map((t) => ({ from: c.id, to: t })));

  // #4058: SOC 2 joins ISO 27001 as a bundled catalogue outside the public download.
  it('every non-ISO, non-SOC 2 target is a control of a public framework', () => {
    const bad = targets.filter((t) => !t.to.startsWith('ISO_27001_') && !t.to.startsWith('SOC_2_'))
      .filter((t) => !owner.has(t.to) || NOT_PUBLIC.has(owner.get(t.to)!))
      .map((t) => `${t.from} -> ${t.to}`);
    expect(bad).toEqual([]);
  });

  it('every ISO 27001 target is an Annex A control of the bundled iso-27001 catalogue', () => {
    const bad = targets.filter((t) => t.to.startsWith('ISO_27001_') && owner.get(t.to) !== 'iso-27001').map((t) => `${t.from} -> ${t.to}`);
    expect(bad).toEqual([]);
  });

  it('#4058: every SOC 2 target is a control of the bundled soc-2 catalogue', () => {
    const soc = targets.filter((t) => t.to.startsWith('SOC_2_'));
    expect(soc.length).toBeGreaterThan(0);
    expect(soc.filter((t) => owner.get(t.to) !== 'soc-2').map((t) => `${t.from} -> ${t.to}`)).toEqual([]);
  });

  it('maps into NIS2, BSI C5, EUCS and GDPR', () => {
    for (const p of ['NIS2_', 'BSI_C5_', 'EUCS_', 'GDPR_']) expect(targets.some((t) => t.to.startsWith(p)), p).toBe(true);
  });

  it('keeps the wrong ISO maps of catalogue 1.0.0 out (risk framework is not screening, testing is not policy compliance)', () => {
    const byId = new Map(controls.map((c) => [c.id, c.maps_to]));
    expect(byId.get('DORA_Art_6')).not.toContain('ISO_27001_A.6.1');
    expect(byId.get('DORA_Art_8_2')).not.toContain('ISO_27001_A.5.35');
    expect(byId.get('DORA_Art_24')).not.toContain('ISO_27001_A.5.36');
    expect(byId.get('DORA_Art_25')).not.toContain('ISO_27001_A.5.36');
  });

  it('inbound maps of other frameworks name current DORA ids', () => {
    const bad: string[] = [];
    for (const dir of readdirSync(FRAMEWORKS_DIR)) {
      if (dir === 'dora' || !existsSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'))) continue;
      for (const c of loadRegimeCatalogue(join(FRAMEWORKS_DIR, dir, 'controls.yaml')).controls) {
        for (const t of c.maps_to) if (t.startsWith('DORA_') && !ids.has(t)) bad.push(`${dir}/${c.id} -> ${t}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('D4 -- corrected ids keep the catalogue 1.0.0 ids resolvable (#3962)', () => {
  const aliases = controlIdAliases(controls);

  it('every 1.0.0 id resolves to exactly one current control', () => {
    for (const old of V1_IDS) {
      const key = resolveControlIdKey(old, aliases);
      expect(controls.filter((c) => c.id.toLowerCase() === key), old).toHaveLength(1);
    }
  });

  it('the seven corrected ids resolve to their new control and are no longer current ids', () => {
    for (const [old, now] of Object.entries(CORRECTED)) {
      expect(ids.has(old), `${old} must not be reused`).toBe(false);
      expect(resolveControlIdKey(old, aliases)).toBe(now.toLowerCase());
    }
    expect(aliases.size).toBe(Object.keys(CORRECTED).length);
  });

  it('no replaced id is the id of a current control', () => {
    for (const c of controls) for (const old of c.replaces ?? []) expect(ids.has(old), `${c.id} replaces ${old}`).toBe(false);
  });
});

describe('D5 -- no invented thresholds (#3962)', () => {
  // Every duration in a control text must be one the legal text states (see the controls.yaml header).
  const ALLOWED = new Set(['4 hours', '24 hours', '72 hours', 'one month', 'six months', 'three years', 'eight weeks']);
  const DURATION = /\b(\d+|one|two|three|four|six|eight|twelve)\s+(hours?|days?|weeks?|months?|years?)\b/gi;

  it.each(controls.map((c) => [c.id, c] as const))('%s states only durations of the legal text', (_id, c) => {
    const text = `${c.title} ${c.description} ${c.remediation ?? ''}`;
    const found = [...text.matchAll(DURATION)].map((m) => {
      const n = m[1]!.toLowerCase();
      const unit = m[2]!.toLowerCase().replace(/s$/, '');
      return `${n} ${n === 'one' || n === '1' ? unit : `${unit}s`}`;
    });
    expect(found.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });

  it('carries none of the unsourced requirements of catalogue 1.0.0', () => {
    const text = readFileSync(join(DORA_DIR, 'controls.yaml'), 'utf-8') + readFileSync(join(DORA_DIR, 'framework-meta.yaml'), 'utf-8');
    for (const banned of [/quarterly/i, /air-gapped/i, /immutable/i, /ENISA DORA Implementation Guide/i, /TIBER-EU methodology/i, /EBA\/ITS\/2023/, /accenture\.example/]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
  });
});

describe('D7 -- DORA demo subset follows catalogue 2.0.0 (#3965)', () => {
  const demo = loadRegimeCatalogue(join(FRAMEWORKS_DIR, 'dora-demo', 'controls.yaml')).controls;
  const demoAliases = controlIdAliases(demo);

  it('every demo control is a control of the full catalogue with the same citation', () => {
    const full = new Map(controls.map((c) => [c.id, c]));
    for (const d of demo) {
      expect(full.has(d.id), d.id).toBe(true);
      expect(d.regulatory_basis, d.id).toBe(full.get(d.id)!.regulatory_basis);
    }
  });

  it('the two demo 0.1.0 ids that named the wrong article resolve to their 2.0.0 control', () => {
    expect(resolveControlIdKey('DORA_Art_15', demoAliases)).toBe('dora_art_17_1');
    expect(resolveControlIdKey('DORA_Art_17', demoAliases)).toBe('dora_art_19_1');
  });

  it('the demo service-controls rows name only demo controls', () => {
    const demoIds = new Set(demo.map((c) => c.id));
    const sc = load(readFileSync(join(FRAMEWORKS_DIR, 'dora-demo', 'service-controls.yaml'), 'utf-8')) as { mappings: { controls: string[] }[] };
    const bad = sc.mappings.flatMap((m) => m.controls).filter((id) => !demoIds.has(id));
    expect(bad).toEqual([]);
  });
});

describe('D6 -- landing zone scope (#3962)', () => {
  it('the framework is offered for app, audit and landing zone assessments', () => {
    const meta = load(readFileSync(join(DORA_DIR, 'framework-meta.yaml'), 'utf-8')) as { framework: { assessment_type_scope: string[] } };
    expect(meta.framework.assessment_type_scope).toEqual(['app', 'aud', 'lz']);
  });

  it('every workload-evidence control is in landing zone or app scope', () => {
    for (const c of controls.filter((x) => tag(x, 'evidence')[0] !== 'evidence.organisational')) {
      expect(c.assessment_type_scope.some((s) => s === 'app' || s === 'lz'), c.id).toBe(true);
    }
  });

  it('organisational controls are evaluated in app runs, where the ingestion folder is read', () => {
    for (const c of controls.filter((x) => x.layer === 'governance' && x.applies_when === undefined)) {
      expect(c.assessment_type_scope, c.id).toContain('app');
    }
  });
});
