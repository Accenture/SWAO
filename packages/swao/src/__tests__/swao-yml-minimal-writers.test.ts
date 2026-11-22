// #4283 (Design 125 section 7): every writer of a workspace or app .swao.yml
// that went through the central minimal-patch writer keeps the comments, the
// key order and the flow-style workspace lines of the `swao init` template;
// only the edited keys change. One test per migrated writer.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { INIT_WORKSPACE_YML, keepsAllLinesInOrder } from './fixtures/init-workspace-yml.js';
import { writeWorkspaceLenses } from '../commands/lenses.js';
import { writeAppRegimesActive } from '../commands/regime-select.js';
import { writeRegimesActive } from '../compliance/regime-picker.js';
import { writeLlmLegsToSwaoYml } from '../tui/screens/llm-assess/legPersist.js';
import { writeAssessmentLlm } from '../setup/llm-values.js';
import { writeServiceIntake } from '../setup/branches/service-checks.js';
import { writeLzTargetsToYaml } from '../tui/screens/wizard/lz-targets-helpers.js';
import { stripCommentedLzTargetsTemplate } from '@swao/core';
import { upsertServicePortfolioBlock, type ServicePortfolioMeta } from '@swao/module-service-assessment';
import { writeLandingZones, readLandingZones } from '@swao/module-landing-zone';
import { renameAppYmlText } from '@swao/module-app-assessment';
import { appSwaoYmlTemplate } from '../commands/init.js';

let dir = '';
let yml = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-yml-writers-'));
  yml = join(dir, '.swao.yml');
  writeFileSync(yml, INIT_WORKSPACE_YML, 'utf-8');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const read = (): string => readFileSync(yml, 'utf-8');
const doc = (): Record<string, Record<string, unknown>> => load(read()) as Record<string, Record<string, unknown>>;

describe('migrated .swao.yml writers keep the init template (#4283)', () => {
  it('writeWorkspaceLenses', () => {
    writeWorkspaceLenses(yml, ['security-focus']);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect(doc()['assessment']!['lenses']).toEqual(['security-focus']);
  });

  it('writeLlmLegsToSwaoYml (LLM Assessment save as default)', () => {
    writeLlmLegsToSwaoYml(dir, [{ connector: 'c1', model: 'm1', primary: true }, { connector: 'c2', model: 'm2' }]);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect(doc()['llm_assessment']!['legs']).toHaveLength(2);
  });

  it('writeRegimesActive', () => {
    writeRegimesActive(yml, ['GDPR_DEMO']);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect(doc()['assessment']!['regimes_active']).toEqual(['GDPR_DEMO']);
    expect(doc()['providers']!['regime_catalogs']).toHaveLength(2);
  });

  it('writeAppRegimesActive', () => {
    writeAppRegimesActive(yml, ['GDPR_DEMO', 'NIS2']);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect(read()).toContain('  regimes_active: [GDPR_DEMO, NIS2]');
  });

  it('writeAssessmentLlm', () => {
    writeAssessmentLlm(dir, { subjectApp: 'shop' });
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect((doc()['assessment']!['llm'] as Record<string, unknown>)['subject_app']).toBe('shop');
  });

  it('writeServiceIntake', () => {
    expect(writeServiceIntake(dir, { intake: 'wsp/inputs/service-intake/intake.xlsx' })).toBe(true);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
  });

  it('writeLzTargetsToYaml', () => {
    expect(writeLzTargetsToYaml(dir, ['stackit:eu01'])).toBe(true);
    // #4320: the commented LZ targets template goes and the `# assessment:` template is adopted in place.
    const expected = stripCommentedLzTargetsTemplate(INIT_WORKSPACE_YML).replace('\n# assessment:\n', '\nassessment:\n');
    expect(keepsAllLinesInOrder(expected, read())).toBe(true);
  });

  // #4283 (d): the three writers moved to the central writer in run 4, each
  // started from the `swao init` template (workspace) or app template (rename).
  it('upsertServicePortfolioBlock (service intake scaffold metadata) after the wizard intake', () => {
    expect(writeServiceIntake(dir, { intake: 'wsp/inputs/service-intake/intake.xlsx' })).toBe(true);
    const before = read();
    const meta: ServicePortfolioMeta = {
      source: 'intake.xlsx', mapping: null, imported_at: '2026-11-12T08:00:00.000Z',
      app_count: 2, row_count: 3, sheets: ['Apps'], headers: { Apps: { A: 'Name' } },
      pii_columns: [], cluster_threshold: 3,
    };
    const out = upsertServicePortfolioBlock(before, meta);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, out)).toBe(true);
    expect(keepsAllLinesInOrder(before, out)).toBe(true);
    const sp = (load(out) as Record<string, Record<string, unknown>>)['service_portfolio']!;
    expect(sp['intake']).toBe('wsp/inputs/service-intake/intake.xlsx');
    expect(sp['app_count']).toBe(2);
    expect(upsertServicePortfolioBlock(out, meta)).toBe(out);
  });

  it('writeLandingZones (LZ Live registration)', () => {
    const lzs = [{ id: 'fake-prod', provider: 'fakecsp', scopes: [{ id: 'platform', kind: 'platform', auth: 'aksk', regions: ['eu-de'] }] }];
    writeLandingZones(dir, lzs as Parameters<typeof writeLandingZones>[1]);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect(readLandingZones(dir).map((l) => l.id)).toEqual(['fake-prod']);
    // #3589: removing the last landing zone drops the key and restores the template.
    writeLandingZones(dir, []);
    expect(keepsAllLinesInOrder(INIT_WORKSPACE_YML, read())).toBe(true);
    expect(doc()['landing_zones']).toBeUndefined();
  });

  it('renameAppYmlText (Assess screen app rename) from the app template', () => {
    const app = appSwaoYmlTemplate({ appId: 'shop', appName: 'shop', regimes: ['GDPR_DEMO'] });
    const r = renameAppYmlText(app, 'shop', 'webshop');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    const a = app.split('\n');
    const b = r.text.split('\n');
    expect(b).toHaveLength(a.length);
    // Only the app_id and app_name lines change; every other line, comments included, is byte for byte the same.
    const diff = a.flatMap((l, i) => (l === b[i] ? [] : [l]));
    expect(diff.map((l) => l.split(':')[0])).toEqual(['app_id', 'app_name']);
    const d = load(r.text) as Record<string, unknown>;
    expect(d['app_id']).toBe('webshop');
    expect(d['app_name']).toBe('webshop');
  });

  it('CRLF files keep CRLF', () => {
    writeFileSync(yml, INIT_WORKSPACE_YML.replace(/\n/g, '\r\n'), 'utf-8');
    writeWorkspaceLenses(yml, ['security-focus']);
    writeLlmLegsToSwaoYml(dir, [{ connector: 'c1', model: 'm1', primary: true }]);
    expect(read().replace(/\r\n/g, '')).not.toContain('\n');
  });
});
