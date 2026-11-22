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

// #4320 (Design 125 section 7, rule of #4280): the LZ Catalog targets write
// keeps one place for `landing_zone`. Regression from the exact `swao init`
// workspace template, the Setup Wizard `workspace:` and `assessment:`
// adoptions, then the targets write; uncommenting every remaining template
// line must still load with the duplicate-key-strict loader (js-yaml).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { buildWorkspaceSwaoYml } from '../../../commands/init.js';
import { setWorkspaceKey } from '../../../setup/workspace-state.js';
import { writeTestCodeModeToYaml } from './yaml-helpers.js';
import { writeLzTargetsToYaml } from './lz-targets-helpers.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function initWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-template-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), buildWorkspaceSwaoYml({ name: 'Example', code: 'EX', ownerLead: 'Lead', engLead: '', endDate: '' }), 'utf-8');
  return ws;
}

const read = (ws: string): string => readFileSync(join(ws, '.swao.yml'), 'utf-8');

/** Every commented YAML key line uncommented, as the template hints tell the operator to do. */
function uncommentAll(text: string): string {
  return text.split('\n').map((l) => {
    const m = /^( *)# (.*)$/.exec(l);
    if (!m) return l;
    const rest = m[2]!;
    const key = rest.trimStart();
    return /^[A-Za-z_][\w-]*:/.test(key) ? `${m[1]}${rest}` : l;
  }).join('\n');
}

/** Lines that hold `landing_zone:`, live or commented. */
const lzLines = (text: string): string[] => text.split('\n').filter((l) => l.replace('#', ' ').trimStart().startsWith('landing_zone:'));

describe('LZ targets write adopts or removes the commented template (#4320)', () => {
  it('after the workspace and assessment adoptions: landing_zone once, uncommenting every template line still loads strictly', () => {
    const ws = initWorkspace();
    expect(setWorkspaceKey(ws, 'assessment_types', ['lz-catalog'])).toBe(true);
    writeTestCodeModeToYaml(ws, 'include');
    expect(writeLzTargetsToYaml(ws, ['otc:germany'])).toBe(true);
    const text = read(ws);
    expect(lzLines(text)).toEqual(['  landing_zone:']);
    // #4495: the explanation line of the template stays, as the hint directly above the live key.
    const lines = text.split('\n');
    const at = lines.indexOf('  landing_zone:');
    expect(lines[at - 1]).toBe('  # LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):');
    expect(lines.filter((l) => l.includes('LZ catalogue targets for every app'))).toHaveLength(1);
    expect(text.split('\n').filter((l) => l.startsWith('assessment:'))).toHaveLength(1);
    const doc = load(uncommentAll(text)) as { assessment: { landing_zone: { targets: string[] } } };
    expect(doc.assessment.landing_zone.targets).toEqual(['otc:germany']);
  });

  it('a fresh init without a live assessment block: the commented assessment template is adopted, never a second block', () => {
    const ws = initWorkspace();
    expect(writeLzTargetsToYaml(ws, ['stackit:eu01'])).toBe(true);
    const text = read(ws);
    expect(text.split('\n').filter((l) => /^#? ?assessment:/.test(l))).toEqual(['assessment:']);
    expect(lzLines(text)).toHaveLength(1);
    const doc = load(uncommentAll(text)) as { assessment: { landing_zone: { targets: string[] }; test_code: { mode: string } } };
    expect(doc.assessment.landing_zone.targets).toEqual(['stackit:eu01']);
    expect(doc.assessment.test_code.mode).toBe('include');
  });

  it('#4495: the owner layout (live assessment block with llm candidates, hint block after it, CRLF): only the targets change and the hint stays', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-template-'));
    dirs.push(ws);
    const before = [
      'engagement:',
      '  name: "Example"',
      '',
      'assessment:',
      '  vision_max_screens: 2  # screenshots sent to LLM vision pass per assessment run',
      '  test_code:             # #3403: include (default) | tag | exclude; an app .swao.yml overrides',
      '    mode: include',
      '  landing_zone:',
      '    targets:',
      '      - otc:germany',
      '  llm:',
      '    candidates:',
      '      - connector: c1',
      '        model: m1',
      '',
      '# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):',
      '#   landing_zone:',
      '#     targets: [stackit:eu01, azure:germanywestcentral]  # <provider>:<region> or <provider>:<geography> (e.g. azure:Europe)',
      '',
      'workspace:',
      "  setup_state: { lz-catalog: { state: ready, checked_at: '2026-11-16T18:00:00.000Z', fail_count: 0, warn_count: 0 } }",
      '',
    ].join('\r\n');
    writeFileSync(join(ws, '.swao.yml'), before, 'utf-8');
    expect(writeLzTargetsToYaml(ws, ['otc:eu-de'])).toBe(true);
    const after = read(ws);
    expect(after).toContain('\r\n');
    const lines = after.split('\r\n');
    // The hint comment is kept (above the live key); the commented example keys go (no second landing_zone).
    const at = lines.indexOf('  landing_zone:');
    expect(lines[at - 1]).toBe('  # LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):');
    expect(lzLines(after.split('\r\n').join('\n'))).toEqual(['  landing_zone:']);
    // Every other line is unchanged, in order; only the target value differs.
    const changed = before.split('\r\n').filter((l) => !lines.includes(l));
    expect(changed).toEqual(['      - otc:germany', '# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):', '#   landing_zone:', '#     targets: [stackit:eu01, azure:germanywestcentral]  # <provider>:<region> or <provider>:<geography> (e.g. azure:Europe)']);
    expect(lines).toContain('      - otc:eu-de');
    expect(lines).toContain('  vision_max_screens: 2  # screenshots sent to LLM vision pass per assessment run');
    const doc = load(uncommentAll(after.split('\r\n').join('\n'))) as { assessment: { landing_zone: { targets: string[] }; llm: { candidates: unknown[] } } };
    expect(doc.assessment.landing_zone.targets).toEqual(['otc:eu-de']);
    expect(doc.assessment.llm.candidates).toHaveLength(1);
    // A second write keeps a single hint line.
    expect(writeLzTargetsToYaml(ws, ['otc:eu-nl'])).toBe(true);
    expect(read(ws).split('\r\n').filter((l) => l.includes('LZ catalogue targets for every app'))).toHaveLength(1);
  });

  it('the strict loader rejects the old result (the template left beside the live key)', () => {
    const dup = 'assessment:\n  landing_zone:\n    targets:\n      - otc:germany\n\n#   landing_zone:\n#     targets: [stackit:eu01]\n';
    expect(() => load(uncommentAll(dup))).toThrow(/duplicated mapping key/);
  });
});
