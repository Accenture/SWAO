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

// #4191 SET-02 (Design 125 sections 7 and 10): workspace.assessment_types,
// workspace.setup_state and the migration inference.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { SwaoYmlSchema } from '@swao/core';
import {
  readAssessmentTypes,
  writeAssessmentTypes,
  readSetupState,
  recordBranchHealth,
  branchState,
  branchStates,
  inferAssessmentTypes,
  migrateAssessmentTypes,
  setWorkspaceKey,
} from './workspace-state.js';
import { writeTestCodeModeToYaml, writeVisionMaxScreensToYaml } from '../tui/screens/wizard/yaml-helpers.js';
import { INIT_TEMPLATE } from '../__tests__/fixtures/init-workspace-yml.js';

const dirs: string[] = [];
function ws(yml: string): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-setup-state-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  return d;
}
const text = (d: string): string => readFileSync(join(d, '.swao.yml'), 'utf-8');
const valid = (d: string): boolean => SwaoYmlSchema.safeParse(load(text(d))).success;
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('workspace.assessment_types (#4191)', () => {
  it('writes the types in branch order into an existing workspace block, keeping comments and siblings', () => {
    const d = ws('# engagement file\nworkspace:\n  run_retention:\n    keep_latest: 5  # keep five\nengagement:\n  name: Demo\n');
    expect(writeAssessmentTypes(d, ['llm', 'application', 'llm'])).toBe(true);
    expect(text(d)).toContain('# engagement file');
    expect(text(d)).toContain('    keep_latest: 5  # keep five');
    expect(text(d)).toContain('  assessment_types: [application, llm]');
    expect(readAssessmentTypes(d)).toEqual(['application', 'llm']);
    expect(valid(d)).toBe(true);
    writeAssessmentTypes(d, ['service']);
    expect(text(d).match(/assessment_types/g)).toHaveLength(1);
    expect(readAssessmentTypes(d)).toEqual(['service']);
  });

  it('appends a workspace block when there is none; replaces a block-style list', () => {
    const d = ws('engagement:\n  name: Demo\n');
    writeAssessmentTypes(d, ['lz-live']);
    expect(text(d)).toMatch(/engagement:\n {2}name: Demo\n\nworkspace:\n {2}assessment_types: \[lz-live\]\n/);
    const b = ws('workspace:\n  assessment_types:\n    - application\n    - service\n  run_retention: { keep_latest: 3 }\n');
    writeAssessmentTypes(b, ['llm']);
    expect(text(b)).toBe('workspace:\n  assessment_types: [llm]\n  run_retention: { keep_latest: 3 }\n');
  });

  it('keeps CRLF line endings and rewrites a flow-style workspace value', () => {
    const d = ws('engagement:\r\n  name: Demo\r\nworkspace:\r\n  run_retention: {}\r\n');
    writeAssessmentTypes(d, ['application']);
    expect(text(d)).toContain('workspace:\r\n  run_retention: {}\r\n  assessment_types: [application]\r\n');
    // #4280: the minimal-patch writer re-emits a flow-style workspace value and keeps its keys.
    const f = ws('workspace: { run_retention: {} }\n');
    expect(setWorkspaceKey(f, 'assessment_types', ['llm'])).toBe(true);
    expect(load(text(f))).toEqual({ workspace: { run_retention: {}, assessment_types: ['llm'] } });
  });

  it('reads undefined when absent, ignores unknown values', () => {
    expect(readAssessmentTypes(ws('engagement: {}\n'))).toBeUndefined();
    expect(readAssessmentTypes(ws('workspace:\n  assessment_types: [llm, audit]\n'))).toEqual(['llm']);
  });
});

describe('workspace.setup_state (#4190, section 7)', () => {
  it('records each branch from its health result and keeps the other branches', () => {
    const d = ws('workspace:\n  assessment_types: [application, lz-live]\n');
    const now = new Date('2026-11-08T21:00:00.000Z');
    expect(recordBranchHealth(d, 'lz-live', { probeCount: 7, failCount: 1, warnCount: 0 }, now).state).toBe('needs-attention');
    recordBranchHealth(d, 'application', { probeCount: 15, failCount: 0, warnCount: 2 }, now);
    expect(readSetupState(d)).toEqual({
      application: { state: 'ready', checked_at: '2026-11-08T21:00:00.000Z', fail_count: 0, warn_count: 2 },
      'lz-live': { state: 'needs-attention', checked_at: '2026-11-08T21:00:00.000Z', fail_count: 1, warn_count: 0 },
    });
    expect(branchState(d, 'service')).toBe('not-set-up');
    expect(branchStates(d)).toEqual({ application: 'ready', 'lz-live': 'needs-attention' });
    expect(valid(d)).toBe(true);
    expect(text(d).match(/setup_state/g)).toHaveLength(1);
  });

  it('no health result records not-set-up', () => {
    const d = ws('workspace: \n');
    expect(recordBranchHealth(d, 'llm', undefined).state).toBe('not-set-up');
  });
});

describe('migration inference (#4191, section 10)', () => {
  it('infers each type from the workspace content', () => {
    const d = ws('service_portfolio:\n  source: intake.xlsx\nassessment:\n  landing_zone:\n    targets: [otc:eu-de]\nlanding_zones:\n  - id: otc-prod\n    provider: otc\n    scopes: [{ id: p, kind: platform, auth: iam-password-token }]\n');
    mkdirSync(join(d, 'apps', 'web', 'wsp', 'runs', '2026-11-01T08-00-00'), { recursive: true });
    mkdirSync(join(d, 'llm-assessments', 'swao', '2026-11-02T08-00-00'), { recursive: true });
    expect(inferAssessmentTypes(d)).toEqual(['application', 'service', 'lz-catalog', 'lz-live', 'llm']);
  });

  it('an app without runs and an empty workspace infer nothing', () => {
    const d = ws('engagement:\n  name: Demo\n');
    mkdirSync(join(d, 'apps', 'web', 'wsp', 'runs'), { recursive: true });
    expect(inferAssessmentTypes(d)).toEqual([]);
  });

  it('records the inferred types once; an existing choice is never overwritten', () => {
    const d = ws('service_portfolio:\n  source: intake.xlsx\n');
    expect(migrateAssessmentTypes(d)).toEqual(['service']);
    expect(readAssessmentTypes(d)).toEqual(['service']);
    writeAssessmentTypes(d, ['llm']);
    expect(migrateAssessmentTypes(d)).toBeUndefined();
    expect(readAssessmentTypes(d)).toEqual(['llm']);
    expect(migrateAssessmentTypes(join(d, 'missing'))).toBeUndefined();
  });
});

describe('Setup writers on the exact swao init template (#4280, #4281)', () => {
  function afterBranch(): { d: string; out: string } {
    const d = ws(INIT_TEMPLATE);
    writeAssessmentTypes(d, ['application']);
    recordBranchHealth(d, 'application', { probeCount: 15, failCount: 0, warnCount: 3 }, new Date('2026-11-09T13:36:56.904Z'));
    writeVisionMaxScreensToYaml(d, 2);
    writeTestCodeModeToYaml(d, 'include');
    return { d, out: text(d) };
  }

  it('one workspace key and one assessment key; the templates are adopted in place', () => {
    const { out } = afterBranch();
    expect(out.match(/^workspace:/gm)).toHaveLength(1);
    expect(out.match(/^#? ?workspace:/gm)).toHaveLength(1);
    expect(out.match(/^#? ?assessment:/gm)).toHaveLength(1);
    expect(out).toContain([
      'workspace:',
      '  assessment_types: [application]',
      "  setup_state: {application: {state: ready, checked_at: '2026-11-09T13:36:56.904Z', fail_count: 0, warn_count: 3}}",
      '#   run_retention:',
      '#     keep_latest: 10  # keep only the 10 most recent assessment runs per app',
    ].join('\n'));
    // #4281 criteria 1 and 2: the inline comments stay on the live keys; the LZ hint stays next to the block.
    expect(out).toContain([
      'assessment:',
      '  vision_max_screens: 2  # screenshots sent to LLM vision pass per assessment run',
      '  test_code:             # #3403: include (default) | tag | exclude; an app .swao.yml overrides',
      '    mode: include',
      '',
      '# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):',
    ].join('\n'));
    expect(valid(ws(out))).toBe(true);
  });

  it('every other line of the template is unchanged and nothing is appended at the end', () => {
    const { out } = afterBranch();
    const adopted = new Set(['# workspace:', '# assessment:', '#   vision_max_screens: 2  # screenshots sent to LLM vision pass per assessment run',
      '#   test_code:             # #3403: include (default) | tag | exclude; an app .swao.yml overrides', '#     mode: include']);
    const lines = out.split('\n');
    let at = 0;
    for (const l of INIT_TEMPLATE.split('\n')) {
      if (adopted.has(l)) continue;
      const idx = lines.indexOf(l, at);
      expect(idx, l).toBeGreaterThanOrEqual(0);
      at = idx + 1;
    }
    expect(out.trimEnd().endsWith('#     targets: [stackit:eu01, azure:germanywestcentral]  # <provider>:<region> or <provider>:<geography> (e.g. azure:Europe)')).toBe(true);
  });

  it('uncommenting the shipped run_retention lines (strip "# ") keeps the file valid with all three keys', () => {
    const { out } = afterBranch();
    const edited = out.replace('#   run_retention:\n#     keep_latest: 10', '  run_retention:\n    keep_latest: 10');
    const doc = load(edited) as { workspace: Record<string, unknown> };
    expect(Object.keys(doc.workspace).sort()).toEqual(['assessment_types', 'run_retention', 'setup_state']);
    expect(doc.workspace['run_retention']).toEqual({ keep_latest: 10 });
  });
});
