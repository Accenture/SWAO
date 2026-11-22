// #3887 (Design 123 section 8.4), #4244 (owner decision 2026-11-09): the LZ
// step of the Application Assessment screen offers the static catalogue only;
// a linked app shows the CLI warning on every tier.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as choice from './lz-source-choice.js';
import { linkedAppCatalogueNotice, linkedAppCatalogueShortNotice, linkedAppSeedPrefill, lzCatTargetsArgs } from './lz-source-choice.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const YML = ['name: demo', 'landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: app-pay', '        kind: application', '        auth: iam-password-token', '        app: payments',
  '  - id: stackit-a', '    provider: stackit', '    scopes:', '      - id: platform', '        kind: platform', '        auth: key-flow', ''].join(String.fromCharCode(10));

function ws(runs: string[] = ['2026-11-05T08-00-00']): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-tui-lzsrc-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), YML);
  for (const r of runs) mkdirSync(join(d, 'landing-zones', 'otc-prod', 'wsp', 'runs', r), { recursive: true });
  return d;
}

describe('LZ step: no live source (#4244)', () => {
  it('the helpers of the retired live source step are gone (the step offers the static catalogue only)', () => {
    expect(Object.keys(choice).sort()).toEqual(['linkedAppCatalogueNotice', 'linkedAppCatalogueShortNotice', 'linkedAppSeedPrefill', 'lzCatTargetsArgs']);
  });
});

describe('linked-app catalogue warning on every tier (#3980, #4244)', () => {
  it('a linked app shows the CLI warning, also with a live run of the landing zone; an unlinked app and no workspace show none', () => {
    const d = ws();
    expect(linkedAppCatalogueNotice(d, 'payments')).toBe('live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue (linked to otc-prod; live results: Landing Zone Live Assessment). Skip this step for no LZ fit; nothing is then assessed against the catalogue.');
    expect(linkedAppCatalogueNotice(d, 'billing')).toBeNull();
    expect(linkedAppCatalogueNotice(null, 'payments')).toBeNull();
  });

  it('#4349: the screen shows one short LZ source line naming the linked landing zone', () => {
    const d = ws();
    expect(linkedAppCatalogueShortNotice(d, 'payments')).toBe('Static LZ catalogue; live data only in the LZ Live Assessment (otc-prod)');
    expect(linkedAppCatalogueShortNotice(d, 'billing')).toBeNull();
    expect(linkedAppCatalogueShortNotice(null, 'payments')).toBeNull();
  });
});

describe('target LZ step pre-fill (#3980 seeding, #4244 every tier)', () => {
  function seededWs(regions: boolean): string {
    const d = mkdtempSync(join(tmpdir(), 'swao-tui-lzseed-'));
    tmp.push(d);
    writeFileSync(join(d, '.swao.yml'), YML.replace('        app: payments', regions ? '        app: payments' + String.fromCharCode(10) + '        regions: [eu-de]' : '        app: payments'));
    const run = join(d, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-05T08-00-00');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'lz-live-merged.yaml'), JSON.stringify({
      lz_id: 'otc-prod', provider: 'otc', merged_at: '2026-11-05T08:00:00Z', window_days: 7,
      scopes: [{ scope_id: 'app-pay', status: 'merged', observed_at: '2026-11-05T08:00:00Z' }],
      offering: { regions: [{ id: 'eu-nl', status: 'enabled' }, { id: 'eu-de', status: 'enabled' }], services: [] },
      estate: { resources: [{ id: 'vm-1', type: 'ecs', region: 'eu-nl', seen_by: ['app-pay'] }] },
    }));
    return d;
  }

  it('pre-fills the targets the CLI seeds from the scope regions; #4244: never from a live run', () => {
    expect(linkedAppSeedPrefill(seededWs(true), 'payments')).toEqual({ providers: ['otc'], targets: ['otc:eu-de'], from: 'landing_zones[].scopes[].regions', source: 'swao-yml-scope-regions' });
    const live = seededWs(false);
    expect(linkedAppSeedPrefill(live, 'payments')).toBeNull();
    expect(linkedAppCatalogueNotice(live, 'payments')).toBe('live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue (linked to otc-prod; live results: Landing Zone Live Assessment). Skip this step for no LZ fit; nothing is then assessed against the catalogue.');
    expect(linkedAppSeedPrefill(seededWs(true), 'billing')).toBeNull();
  });
});

describe('confirmed target LZ selection to CLI flags (#3980 seeding)', () => {
  const seed = { providers: ['otc'], targets: ['otc:eu-de', 'otc:eu-nl', 'otc:xx-nowhere'], from: 'landing_zones[].scopes[].regions', source: 'swao-yml-scope-regions' as const };
  const offered = ['otc:eu-de', 'otc:eu-nl', 'otc:eu-ch2'];
  it('the unedited pre-fill (the offered seed targets) adds the seed marker; an edit, no seed or no selection does not', () => {
    expect(lzCatTargetsArgs(['otc:eu-nl', 'otc:eu-de'], seed, offered)).toEqual(['--lz-cat-targets', 'otc:eu-nl,otc:eu-de', '--lz-cat-targets-seeded', 'swao-yml-scope-regions']);
    expect(lzCatTargetsArgs(['otc:eu-de'], seed, offered)).toEqual(['--lz-cat-targets', 'otc:eu-de']);
    expect(lzCatTargetsArgs(['otc:eu-de', 'otc:eu-nl', 'otc:eu-ch2'], seed, offered)).toEqual(['--lz-cat-targets', 'otc:eu-de,otc:eu-nl,otc:eu-ch2']);
    expect(lzCatTargetsArgs(['otc:eu-de'], null, offered)).toEqual(['--lz-cat-targets', 'otc:eu-de']);
    expect(lzCatTargetsArgs([], seed, offered)).toEqual([]);
  });
});
