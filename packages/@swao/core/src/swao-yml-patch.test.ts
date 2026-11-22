// #4283: the minimal-patch writer for .swao.yml keeps comments, key order,
// quoting, blank lines, flow-style lines, BOM and line endings; only the
// edited key changes and the result is verified by a reparse.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { patchSwaoYmlFile, patchSwaoYmlFileOrThrow, patchSwaoYmlText, splitInlineComment, type SwaoYmlEdit } from './swao-yml-patch.js';

// Modelled on the commented `swao init` template (buildWorkspaceSwaoYml) plus
// the Setup Wizard `workspace:` record (one flow-style line each). No owner data.
const WORKSPACE = [
  '# .swao.yml -- SWAO workspace configuration',
  'wsp_version: "0.9"',
  '',
  'engagement:',
  '  name: "Example Engagement"',
  '  client_code: "EX"',
  '  start_date: "2026-11-01"',
  '  partnership_lead: "Example Lead"',
  '',
  'providers:',
  '  llm:',
  '    primary:',
  '      type: ~',
  '      model: ~',
  '  redactor:',
  '    type: pattern',
  'imports_dir: wsp/inputs/  # workspace-level shared inputs (frameworks, templates)',
  '',
  '# workspace:',
  '#   run_retention:',
  '#     keep_latest: 10  # keep only the 10 most recent assessment runs per app',
  '',
  '# publication:',
  '#   cover_subtitle: "Cloud Sovereignty Assessment"',
  '#   classification_band: "Client Confidential"',
  '',
  '# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):',
  '#   landing_zone:',
  '#     targets: [stackit:eu01, azure:germanywestcentral]',
  '',
  'workspace:',
  '  assessment_types: [application, lz-live]',
  "  setup_state: { application: { state: ready, checked_at: '2026-11-09T13:30:00.000Z', fail_count: 0, warn_count: 1 } }",
  '',
].join('\n');

function patch(text: string, edits: SwaoYmlEdit[]): string {
  const r = patchSwaoYmlText(text, edits);
  if (!r.ok) throw new Error(r.error);
  return r.text;
}

/** Every line of `before` is still present in `after`, in the same order. */
function keepsAllLinesInOrder(before: string, after: string): boolean {
  const a = after.split(/\r?\n/);
  let at = 0;
  for (const l of before.split(/\r?\n/)) {
    const idx = a.indexOf(l, at);
    if (idx < 0) return false;
    at = idx + 1;
  }
  return true;
}

function addedLines(before: string, after: string): string[] {
  const b = before.split('\n');
  const out: string[] = [];
  let i = 0;
  for (const l of after.split('\n')) {
    if (i < b.length && b[i] === l) i++;
    else out.push(l);
  }
  return out;
}

describe('patchSwaoYmlText (#4283)', () => {
  it('adds a missing top-level block at the end and keeps every other line', () => {
    const out = patch(WORKSPACE, [{ path: ['assessment', 'lenses'], value: ['security-focus'] }]);
    expect(keepsAllLinesInOrder(WORKSPACE, out)).toBe(true);
    expect(addedLines(WORKSPACE, out).filter((l) => l !== '')).toEqual(['assessment:', '  lenses: [security-focus]']);
    expect((load(out) as { assessment: { lenses: string[] } }).assessment.lenses).toEqual(['security-focus']);
  });

  it('replaces an existing value in place and keeps the inline comment', () => {
    const out = patch(WORKSPACE, [{ path: ['imports_dir'], value: 'shared/' }]);
    expect(out).toBe(WORKSPACE.replace('imports_dir: wsp/inputs/  #', 'imports_dir: shared/  #'));
  });

  it('inserts into an existing block after its last child', () => {
    const out = patch(WORKSPACE, [{ path: ['engagement', 'end_date'], value: '2026-12-31' }]);
    expect(out).toBe(WORKSPACE.replace('  partnership_lead: "Example Lead"\n', "  partnership_lead: \"Example Lead\"\n  end_date: '2026-12-31'\n"));
  });

  it('keeps the flow-style workspace lines when another workspace key changes', () => {
    const out = patch(WORKSPACE, [{ path: ['workspace', 'assessment_types'], value: ['application'] }]);
    expect(out).toBe(WORKSPACE.replace('[application, lz-live]', '[application]'));
    expect(out).toContain("  setup_state: { application: { state: ready, checked_at: '2026-11-09T13:30:00.000Z', fail_count: 0, warn_count: 1 } }");
  });

  it('keeps a flow-style value flow style (auto) and honours an explicit block style', () => {
    const value = { application: { state: 'ready' } };
    const flow = patch(WORKSPACE, [{ path: ['workspace', 'setup_state'], value }]);
    expect(flow).toContain('  setup_state: {application: {state: ready}}');
    const block = patch(WORKSPACE, [{ path: ['workspace', 'setup_state'], value, style: 'block' }]);
    expect(block).toContain('  setup_state:\n    application:\n      state: ready\n');
    expect(keepsAllLinesInOrder(WORKSPACE.replace(/ {2}setup_state:.*\n/, ''), block)).toBe(true);
  });

  it('replaces a nested block value and leaves siblings and comments alone', () => {
    const out = patch(WORKSPACE, [{ path: ['providers', 'llm', 'primary'], value: { connector: 'example', model: 'm-1' } }]);
    expect(out).toBe(WORKSPACE.replace('      type: ~\n      model: ~\n', '      connector: example\n      model: m-1\n'));
  });

  it('removes a key and prunes the parent it leaves empty; comments stay', () => {
    const withLenses = patch(WORKSPACE, [{ path: ['assessment', 'lenses'], value: ['a'] }]);
    const back = patch(withLenses, [{ path: ['assessment', 'lenses'], value: undefined }]);
    expect(back).toBe(WORKSPACE);
    expect(load(back)).not.toHaveProperty('assessment');
  });

  it('removing a missing key is a no-op', () => {
    const r = patchSwaoYmlText(WORKSPACE, [{ path: ['assessment', 'lenses'], value: undefined }]);
    expect(r).toEqual({ ok: true, text: WORKSPACE, changed: false });
  });

  it('setting the same value leaves the text byte-identical', () => {
    const r = patchSwaoYmlText(WORKSPACE, [{ path: ['workspace', 'assessment_types'], value: ['application', 'lz-live'] }]);
    expect(r.ok && r.text).toBe(WORKSPACE);
    expect(r.ok && r.changed).toBe(false);
  });

  it('keeps CRLF line endings and the BOM', () => {
    const crlf = '﻿' + WORKSPACE.replace(/\n/g, '\r\n');
    const out = patch(crlf, [{ path: ['assessment', 'lenses'], value: ['x'] }]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(keepsAllLinesInOrder(crlf.slice(1), out.slice(1))).toBe(true);
  });

  it('follows a 4-space indentation', () => {
    const text = 'providers:\n    llm:\n        primary:\n            type: ~\n';
    const out = patch(text, [{ path: ['providers', 'llm', 'secondary'], value: { type: 'openai' } }]);
    expect(out).toBe('providers:\n    llm:\n        primary:\n            type: ~\n        secondary:\n            type: openai\n');
  });

  it('re-emits only a flow-style parent line', () => {
    const text = '# head\nassessment: { lenses: [a], vision_max_screens: 2 }  # keep\nother: 1\n';
    const out = patch(text, [{ path: ['assessment', 'lenses'], value: ['b'] }]);
    expect(out).toBe('# head\nassessment: {lenses: [b], vision_max_screens: 2}  # keep\nother: 1\n');
  });

  it('writes lists of mappings as a block', () => {
    const out = patch('a: 1\n', [{ path: ['context_inputs'], value: [{ id: 'x', path: 'p.csv' }] }]);
    expect(out).toBe('a: 1\n\ncontext_inputs:\n  - id: x\n    path: p.csv\n');
  });

  it('values cannot add YAML structure', () => {
    const out = patch('a: 1\n', [{ path: ['note'], value: 'x\nb: 2  # y' }]);
    expect(load(out)).toEqual({ a: 1, note: 'x\nb: 2  # y' });
  });

  it('refuses a file that does not parse (duplicate key) and a list parent', () => {
    expect(patchSwaoYmlText('a: 1\na: 2\n', [{ path: ['b'], value: 1 }]).ok).toBe(false);
    const r = patchSwaoYmlText('landing_zones:\n  - id: x\n', [{ path: ['landing_zones', 'id'], value: 'y' }]);
    expect(r.ok).toBe(false);
  });

  it('applies several edits and verifies the result', () => {
    const out = patch(WORKSPACE, [
      { path: ['engagement', 'name'], value: 'Renamed' },
      { path: ['engagement', 'client_code'], value: 'RN' },
      { path: ['llm_assessment', 'legs'], value: [{ connector: 'c', model: 'm', primary: true }] },
    ]);
    const doc = load(out) as Record<string, Record<string, unknown>>;
    expect(doc['engagement']!['name']).toBe('Renamed');
    expect(out).toContain('# .swao.yml -- SWAO workspace configuration');
    expect(out).toContain('#     keep_latest: 10');
    expect(out).toContain('wsp_version: "0.9"');
  });

  it('splitInlineComment ignores # inside quotes', () => {
    expect(splitInlineComment(' "a # b"  # c')).toEqual({ value: '"a # b"', comment: '  # c' });
    expect(splitInlineComment(' x#y')).toEqual({ value: 'x#y', comment: '' });
  });
});

describe('patchSwaoYmlFile (#4283)', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  it('writes only when the text changes; missing file needs createIfMissing', () => {
    dir = mkdtempSync(join(tmpdir(), 'swao-yml-patch-'));
    const p = join(dir, '.swao.yml');
    expect(patchSwaoYmlFile(p, [{ path: ['a'], value: 1 }]).ok).toBe(false);
    expect(existsSync(p)).toBe(false);
    expect(patchSwaoYmlFileOrThrow(p, [{ path: ['a'], value: 1 }], { createIfMissing: true })).toBe(true);
    expect(readFileSync(p, 'utf-8')).toBe('a: 1\n');
    writeFileSync(p, WORKSPACE, 'utf-8');
    expect(patchSwaoYmlFileOrThrow(p, [{ path: ['imports_dir'], value: 'wsp/inputs/' }])).toBe(false);
    expect(readFileSync(p, 'utf-8')).toBe(WORKSPACE);
  });

  it('throws and leaves the file unchanged on a refused patch', () => {
    dir = mkdtempSync(join(tmpdir(), 'swao-yml-patch-'));
    const p = join(dir, '.swao.yml');
    writeFileSync(p, 'a: 1\na: 2\n', 'utf-8');
    expect(() => patchSwaoYmlFileOrThrow(p, [{ path: ['b'], value: 1 }])).toThrow(/could not be updated safely/);
    expect(readFileSync(p, 'utf-8')).toBe('a: 1\na: 2\n');
  });
});

describe('adoptCommentedTemplates (#4280, #4281)', () => {
  // The commented templates `swao init` writes (init.ts buildWorkspaceSwaoYml).
  const TEMPLATE = [
    'wsp_version: "0.9"',
    'imports_dir: wsp/inputs/  # workspace-level shared inputs (frameworks, templates)',
    '',
    '# workspace:',
    '#   run_retention:',
    '#     keep_latest: 10  # keep only the 10 most recent assessment runs per app',
    '',
    '# assessment:',
    '#   vision_max_screens: 2  # screenshots sent to LLM vision pass per assessment run',
    '#   test_code:             # #3403: include (default) | tag | exclude; an app .swao.yml overrides',
    '#     mode: include',
    '',
    '# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):',
    '#   landing_zone:',
    '#     targets: [stackit:eu01, azure:germanywestcentral]',
    '',
  ].join('\n');
  const adopt = { adoptCommentedTemplates: true };
  const uncommentAll = (text: string, header: string): string => {
    const lines = text.split('\n');
    let i = lines.indexOf(header) + 1;
    while (i < lines.length && lines[i]!.startsWith('# ')) { lines[i] = lines[i]!.slice(2); i++; }
    return lines.join('\n');
  };

  it('without the option a missing key is still appended (backward compatible)', () => {
    const r = patchSwaoYmlText(TEMPLATE, [{ path: ['workspace', 'assessment_types'], value: ['application'] }]);
    expect(r.ok && r.text.includes('# workspace:')).toBe(true);
    expect(r.ok && r.text.trimEnd().endsWith('workspace:\n  assessment_types: [application]')).toBe(true);
  });

  it('workspace: the template header becomes the live key; one workspace key; uncommenting run_retention parses', () => {
    const r = patchSwaoYmlText(TEMPLATE, [
      { path: ['workspace', 'assessment_types'], value: ['application'] },
      { path: ['workspace', 'setup_state'], value: { application: { state: 'ready', fail_count: 0 } }, style: 'flow' },
    ], adopt);
    if (!r.ok) throw new Error(r.error);
    const lines = r.text.split('\n');
    expect(lines.filter((l) => /^#? ?workspace:/.test(l))).toEqual(['workspace:']);
    expect(lines.slice(lines.indexOf('workspace:'), lines.indexOf('workspace:') + 5)).toEqual([
      'workspace:',
      '  assessment_types: [application]',
      '  setup_state: {application: {state: ready, fail_count: 0}}',
      '#   run_retention:',
      '#     keep_latest: 10  # keep only the 10 most recent assessment runs per app',
    ]);
    // The other comments and keys are unchanged.
    for (const l of TEMPLATE.split('\n')) if (l !== '# workspace:') expect(lines).toContain(l);
    // The owner uncomments the shipped run_retention lines (strip "# "): still one key, all three kept.
    const edited = uncommentAll(r.text, '  setup_state: {application: {state: ready, fail_count: 0}}');
    const doc = load(edited) as { workspace: Record<string, unknown> };
    expect(doc.workspace).toEqual({ assessment_types: ['application'], setup_state: { application: { state: 'ready', fail_count: 0 } }, run_retention: { keep_latest: 10 } });
  });

  it('assessment: the template lines on the edit path are adopted with their inline comments; the LZ hint stays next to the block', () => {
    const r = patchSwaoYmlText(TEMPLATE, [
      { path: ['assessment', 'vision_max_screens'], value: 3 },
      { path: ['assessment', 'test_code', 'mode'], value: 'tag' },
    ], adopt);
    if (!r.ok) throw new Error(r.error);
    const lines = r.text.split('\n');
    const at = lines.indexOf('assessment:');
    expect(lines.slice(at, at + 4)).toEqual([
      'assessment:',
      '  vision_max_screens: 3  # screenshots sent to LLM vision pass per assessment run',
      '  test_code:             # #3403: include (default) | tag | exclude; an app .swao.yml overrides',
      '    mode: tag',
    ]);
    expect(lines[at + 5]).toBe('# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):');
    expect(lines.filter((l) => /assessment:$/.test(l))).toEqual(['assessment:']);
    expect(load(r.text)).toMatchObject({ assessment: { vision_max_screens: 3, test_code: { mode: 'tag' } } });
    expect(r.text.split('\n').length).toBe(TEMPLATE.split('\n').length);
  });

  it('only the edited template lines are adopted; a key without a template line is inserted under the adopted header', () => {
    const r = patchSwaoYmlText(TEMPLATE, [{ path: ['assessment', 'test_code', 'mode'], value: 'exclude' }], adopt);
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toContain('#   vision_max_screens: 2  # screenshots');
    expect(load(r.text)).toMatchObject({ assessment: { test_code: { mode: 'exclude' } } });
    expect((load(r.text) as { assessment: Record<string, unknown> }).assessment['vision_max_screens']).toBeUndefined();
    const w = patchSwaoYmlText(TEMPLATE, [{ path: ['assessment', 'pass_profile'], value: ['quick'] }], adopt);
    if (!w.ok) throw new Error(w.error);
    expect(w.text).toContain('assessment:\n  pass_profile: [quick]\n#   vision_max_screens');
  });

  it('a live key wins over a template; a later write finds the adopted key', () => {
    const live = `${TEMPLATE}workspace:\n  assessment_types: [llm]\n`;
    const r = patchSwaoYmlText(live, [{ path: ['workspace', 'assessment_types'], value: ['llm', 'service'] }], adopt);
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toContain('# workspace:');
    const first = patchSwaoYmlText(TEMPLATE, [{ path: ['workspace', 'assessment_types'], value: ['application'] }], adopt);
    if (!first.ok) throw new Error(first.error);
    const second = patchSwaoYmlText(first.text, [{ path: ['workspace', 'assessment_types'], value: ['application', 'llm'] }], adopt);
    if (!second.ok) throw new Error(second.error);
    expect(second.text.match(/^workspace:/gm)).toHaveLength(1);
    expect(second.text).toContain('  assessment_types: [application, llm]');
  });
});
