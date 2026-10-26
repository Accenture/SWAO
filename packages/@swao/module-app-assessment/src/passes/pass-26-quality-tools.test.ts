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

// #3487: Pass 26 configuration (top_n, endpoint allowlist) and the opt-in
// tool enrichment (lizard, jscpd). Every tool outcome runs against the
// injectable runner with fakes; the real-tool tests skip when the tool is not
// installed (it.skipIf).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dump } from 'js-yaml';
import {
  PassFileSchema,
  resolveCodeHealthSetting,
  detectCodeHealthTool,
  fileBackedToolRunner,
  type CodeHealthToolName,
  type DetectedCodeHealthTool,
  type PassContext,
  type PassResult,
  type ResolvedCodeHealthSetting,
  type ToolRunRequest,
  type ToolRunResult,
  type ToolRunner,
} from '@swao/core';
import { runQualityPass, type QualityPassDeps } from './pass-26-quality.js';
import { parseCsvLine, parseLizardCsv, summariseJscpd, pathKey, scrubPaths } from './code-health-tools.js';

function write(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function ctx(sourcePath: string, codeHealth?: ResolvedCodeHealthSetting): PassContext {
  return { appId: 'demo', sourcePath, workspacePath: sourcePath, iter: 1, assessedAt: '2026-10-25T00:00:00Z', ...(codeHealth ? { codeHealth } : {}) };
}

const setting = (block: Record<string, unknown>): ResolvedCodeHealthSetting => resolveCodeHealthSetting({ code_health: block });
type Rec = Record<string, unknown>;
const ch = (r: PassResult): Rec => r.assessment['code_health'] as Rec;
const sig = (r: PassResult, id: string) => r.signals.find((s) => s.id === id);

const SHARED = [
  'export function normaliseOrder(order) {',
  '  const lines = order.lines.filter((l) => l.quantity > 0);',
  '  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);',
  '  const discount = total > 1000 ? total * 0.05 : 0;',
  '  const shipping = order.express ? 25 : 5;',
  '  return { ...order, lines, total: total - discount + shipping };',
  '}',
].join('\n');

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-qual-tools-'));
  write(root, 'src/orders.ts', `${SHARED}\n`);
  write(root, 'src/legacy/orders-copy.ts', `// copied\n${SHARED}\n`);
  write(root, 'src/config.js', "module.exports = { api: 'https://api.payments-vendor.io/v1', partner: 'https://gw.partner-system.com/x', db: '10.1.2.3' };\n");
  write(root, 'src/app.spec.ts', "it('x', () => fetch('https://api.payments-vendor.io/test'));\n");
  return root;
}

// ---- fake tools ------------------------------------------------------------

const ok = (stdout: string): ToolRunResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false, spawnError: null });

function detected(name: CodeHealthToolName, status: DetectedCodeHealthTool['status'] = 'present', version: string | null = name === 'lizard' ? '1.17.13' : '4.0.5'): DetectedCodeHealthTool {
  return {
    name,
    status,
    version,
    supported_range: name === 'lizard' ? '>=1.17.0 <1.18.0' : '>=4.0.0 <5.0.0',
    invocation: status === 'absent' ? null : { command: name, prefixArgs: [] },
  };
}

/** lizard CSV for every listed file (one function per file), read from the --input_file list the pass wrote. */
function lizardCsv(req: ToolRunRequest): string {
  const list = req.args[req.args.indexOf('--input_file') + 1] as string;
  const files = readFileSync(list, 'utf-8').split('\n').filter(Boolean);
  return files.map((f, i) => `${5 + i},${i === 0 ? 22 : 3},40,1,${5 + i},"fn${i}@1-${5 + i}@${f}","${f}","fn${i}","fn${i}( order )",1,${5 + i}`).join('\n') + '\n';
}

/** jscpd report naming the two order files as one clone pair, written where --output points. */
function writeJscpdReport(req: ToolRunRequest): void {
  const out = req.args[req.args.indexOf('--output') + 1] as string;
  const root = req.args[req.args.length - 1] as string;
  const a = `${root}/src/orders.ts`;
  const b = `${root}/src/legacy/orders-copy.ts`;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'jscpd-report.json'), JSON.stringify({
    statistics: {
      detectionDate: '2026-10-25T03:00:30.156Z',
      formats: { javascript: { sources: { [a]: { lines: 7 }, [b]: { lines: 8 }, [`${root}/src/app.spec.ts`]: { lines: 1 } } } },
    },
    duplicates: [
      { format: 'javascript', lines: 7, fragment: 'SECRET-LOOKING FRAGMENT', tokens: 0, firstFile: { name: b, start: 2, end: 8 }, secondFile: { name: a, start: 1, end: 7 } },
      // A clone with a test file is out of scope (production files only).
      { format: 'javascript', lines: 6, fragment: 'x', tokens: 0, firstFile: { name: a, start: 1, end: 6 }, secondFile: { name: `${root}/src/app.spec.ts`, start: 1, end: 6 } },
    ],
  }), 'utf-8');
}

function fakeTools(behaviour: (name: CodeHealthToolName, req: ToolRunRequest) => ToolRunResult, det: DetectedCodeHealthTool[]): QualityPassDeps & { calls: ToolRunRequest[] } {
  const calls: ToolRunRequest[] = [];
  const runner: ToolRunner = async (req) => {
    calls.push(req);
    return behaviour(req.command as CodeHealthToolName, req);
  };
  return { calls, runner, detect: async (names) => det.filter((d) => names.includes(d.name)) };
}

const happy = (name: CodeHealthToolName, req: ToolRunRequest): ToolRunResult => {
  if (name === 'lizard') return ok(lizardCsv(req));
  writeJscpdReport(req);
  return ok('');
};

// ---- tests -----------------------------------------------------------------

describe('Pass 26 configuration (#3487)', () => {
  let root: string;
  beforeAll(() => { root = fixture(); });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('default: no tools key, no allowlist key, no QUAL-08 and no process started', async () => {
    const deps = fakeTools(happy, [detected('lizard'), detected('jscpd')]);
    const r = await runQualityPass(ctx(root), deps);
    expect(ch(r)['tools']).toBeUndefined();
    expect(ch(r)['endpoint_allowlist']).toBeUndefined();
    expect(ch(r)['top_n']).toBe(25);
    expect(sig(r, 'QUAL-08')).toBeUndefined();
    expect(deps.calls).toHaveLength(0);
    // An explicit default setting gives the same bytes as no setting.
    const r2 = await runQualityPass(ctx(root, resolveCodeHealthSetting(undefined)), deps);
    expect(dump(r2)).toBe(dump(r));
  });

  it('top_n limits the worklist and is recorded', async () => {
    const r = await runQualityPass(ctx(root, setting({ top_n: 1 })));
    expect(ch(r)['top_n']).toBe(1);
    expect((ch(r)['worklist'] as unknown[]).length).toBe(1);
  });

  it('endpoint allowlist: allowlisted hosts are not counted; the block is recorded', async () => {
    const base = await runQualityPass(ctx(root));
    const r = await runQualityPass(ctx(root, setting({ endpoint_allowlist: ['.partner-system.com', '10.1.2.3'] })));
    const hosts = (ch(r)['hardcoded_endpoints'] as Array<{ host: string }>).map((e) => e.host);
    expect(hosts).toEqual(['api.payments-vendor.io']);
    expect((ch(base)['hardcoded_endpoints'] as unknown[]).length).toBe(3);
    expect(ch(r)['endpoint_allowlist']).toEqual({ hosts: ['.partner-system.com', '10.1.2.3'], allowlisted_hits: 2 });
    expect((ch(r)['totals'] as Rec)['hardcoded_ips']).toBe(0);
    expect(sig(r, 'QUAL-05')).toBeUndefined();
  });
});

describe('Pass 26 tool enrichment with fakes (#3487)', () => {
  let root: string;
  let base: PassResult;
  beforeAll(async () => {
    root = fixture();
    base = await runQualityPass(ctx(root));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const withoutTools = (r: PassResult): string => {
    const { tools: _t, ...rest } = ch(r);
    void _t;
    return dump({ code_health: rest, signals: r.signals.filter((s) => s.id !== 'QUAL-08') });
  };

  it('success: results under code_health.tools, built-in block and QUAL-01..07 byte-identical', async () => {
    const deps = fakeTools(happy, [detected('lizard'), detected('jscpd')]);
    const r = await runQualityPass(ctx(root, setting({ tools: ['lizard', 'jscpd'] })), deps);
    expect(withoutTools(r)).toBe(withoutTools(base));
    expect(PassFileSchema.safeParse(r).success).toBe(true);

    const tools = ch(r)['tools'] as Rec;
    expect(tools['requested']).toEqual(['jscpd', 'lizard']);
    const lizard = tools['lizard'] as Rec;
    expect(lizard).toMatchObject({ status: 'complete', version: '1.17.13', ccn_threshold: 15, functions_analysed: 3, files_analysed: 3, functions_over_threshold: 1, max_ccn: 22 });
    const top = (lizard['top_functions'] as Array<Rec>)[0] as Rec;
    expect(top['ccn']).toBe(22);
    expect(String(top['evidence'])).toMatch(/^src\/[^:]+:1$/);
    const jscpd = tools['jscpd'] as Rec;
    expect(jscpd).toMatchObject({ status: 'complete', version: '4.0.5', clone_pairs: 1, files_analysed: 2, lines_analysed: 15, duplicated_lines: 14 });
    expect(jscpd['top_clones']).toEqual([{ format: 'javascript', lines: 7, first: 'src/legacy/orders-copy.ts:2-8', second: 'src/orders.ts:1-7' }]);
    // jscpd code fragments and absolute paths never reach the WSP.
    const yaml = dump(r);
    expect(yaml).not.toContain('SECRET-LOOKING FRAGMENT');
    expect(yaml).not.toContain(root.replace(/\\/g, '/'));
    expect(yaml).not.toContain(root);

    const q8 = sig(r, 'QUAL-08');
    expect(q8?.severity).toBe('informational');
    expect(q8?.derivation).toContain('lizard 1.17.13');
    expect(q8?.derivation).toContain('jscpd 4.0.5: 1 clone pair(s)');
    expect(q8?.evidence.length).toBeGreaterThan(0);
  });

  it('argv is fixed: no shell, temp working directory, explicit jscpd config, -- before the source root', async () => {
    const deps = fakeTools(happy, [detected('lizard'), detected('jscpd')]);
    await runQualityPass(ctx(root, setting({ tools: ['lizard', 'jscpd'] })), deps);
    const [j, l] = deps.calls;
    expect(j?.command).toBe('jscpd');
    expect(j?.args.slice(0, 2)).toEqual(['--config', expect.stringMatching(/jscpd\.json$/)]);
    expect(j?.args[j.args.length - 2]).toBe('--');
    expect(l?.args.slice(0, 5)).toEqual(['--csv', '--CCN', '15', '--ignore_warnings=-1', '--input_file']);
    for (const c of deps.calls) {
      expect(c.cwd.startsWith(root)).toBe(false);
      expect(c.timeoutMs).toBe(300_000);
    }
  });

  it('is deterministic: two runs with the same tool output give the same bytes', async () => {
    const a = await runQualityPass(ctx(root, setting({ tools: ['lizard', 'jscpd'] })), fakeTools(happy, [detected('lizard'), detected('jscpd')]));
    const b = await runQualityPass(ctx(root, setting({ tools: ['lizard', 'jscpd'] })), fakeTools(happy, [detected('lizard'), detected('jscpd')]));
    expect(dump(a)).toBe(dump(b));
  });

  it('absent: QUAL-08 names what is missing with an install hint; nothing is run', async () => {
    const deps = fakeTools(happy, [detected('lizard', 'absent', null), detected('jscpd', 'absent', null)]);
    const r = await runQualityPass(ctx(root, setting({ tools: ['lizard', 'jscpd'] })), deps);
    expect(deps.calls).toHaveLength(0);
    const tools = ch(r)['tools'] as Record<string, Rec>;
    expect(tools['lizard']?.['status']).toBe('absent');
    expect(tools['jscpd']?.['status']).toBe('absent');
    const q8 = sig(r, 'QUAL-08');
    expect(q8?.severity).toBe('informational');
    expect(q8?.derivation).toContain('Missing: jscpd (npm install -g jscpd@4), lizard (pip install "lizard>=1.17,<1.18")');
    expect(withoutTools(r)).toBe(withoutTools(base));
  });

  it('unsupported version: informational, tool not run', async () => {
    const deps = fakeTools(happy, [detected('jscpd', 'unsupported_version', '3.5.10')]);
    const r = await runQualityPass(ctx(root, setting({ tools: ['jscpd'] })), deps);
    expect(deps.calls).toHaveLength(0);
    const j = (ch(r)['tools'] as Record<string, Rec>)['jscpd'];
    expect(j).toMatchObject({ status: 'unsupported_version', version: '3.5.10' });
    expect(sig(r, 'QUAL-08')?.derivation).toContain('jscpd 3.5.10 is outside the supported range >=4.0.0 <5.0.0; not run');
  });

  it('timeout: status timed_out, honours tool_timeout_seconds', async () => {
    const deps = fakeTools(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null }), [detected('lizard')]);
    const r = await runQualityPass(ctx(root, setting({ tools: ['lizard'], tool_timeout_seconds: 20 })), deps);
    expect(deps.calls[0]?.timeoutMs).toBe(20_000);
    const l = (ch(r)['tools'] as Record<string, Rec>)['lizard'];
    expect(l?.['status']).toBe('timed_out');
    expect(String(l?.['reason'])).toContain('20 s');
  });

  it('non-zero exit: status failed with the stderr, temp and source paths scrubbed', async () => {
    const deps = fakeTools((_n, req) => ({ exitCode: 2, stdout: '', stderr: `cannot read ${req.cwd}/x and ${root}/src`, timedOut: false, spawnError: null }), [detected('lizard')]);
    const r = await runQualityPass(ctx(root, setting({ tools: ['lizard'] })), deps);
    const l = (ch(r)['tools'] as Record<string, Rec>)['lizard'];
    expect(l?.['status']).toBe('failed');
    expect(String(l?.['reason'])).toContain('exit code 2');
    expect(String(l?.['reason'])).toContain('<tmp>/x');
    expect(String(l?.['reason'])).toContain('<source>/src');
  });

  it('malformed output: lizard garbage, jscpd invalid JSON, jscpd wrong shape, jscpd no report', async () => {
    const lz = await runQualityPass(ctx(root, setting({ tools: ['lizard'] })), fakeTools(() => ok('this is not csv\nat all\n'), [detected('lizard')]));
    expect((ch(lz)['tools'] as Record<string, Rec>)['lizard']?.['status']).toBe('failed');

    const writeReport = (content: string) => (_n: CodeHealthToolName, req: ToolRunRequest): ToolRunResult => {
      const out = req.args[req.args.indexOf('--output') + 1] as string;
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'jscpd-report.json'), content, 'utf-8');
      return ok('');
    };
    for (const [content, text] of [['{not json', 'not valid JSON'], ['{"statistics":{}}', 'unexpected shape']] as const) {
      const r = await runQualityPass(ctx(root, setting({ tools: ['jscpd'] })), fakeTools(writeReport(content), [detected('jscpd')]));
      const j = (ch(r)['tools'] as Record<string, Rec>)['jscpd'];
      expect(j?.['status']).toBe('failed');
      expect(String(j?.['reason'])).toContain(text);
    }
    const none = await runQualityPass(ctx(root, setting({ tools: ['jscpd'] })), fakeTools(() => ok(''), [detected('jscpd')]));
    expect(String((ch(none)['tools'] as Record<string, Rec>)['jscpd']?.['reason'])).toContain('no report');
  });

  it('a runner that rejects is recorded as failed, never thrown', async () => {
    const deps: QualityPassDeps = { runner: async () => { throw new Error('boom'); }, detect: async () => [detected('lizard')] };
    const r = await runQualityPass(ctx(root, setting({ tools: ['lizard'] })), deps);
    expect((ch(r)['tools'] as Record<string, Rec>)['lizard']).toMatchObject({ status: 'failed', reason: 'lizard failed (boom).' });
  });
});

describe('tool output parsers (#3487)', () => {
  it('parses the real lizard 1.17.13 CSV shape (quoted fields, spaces in paths)', () => {
    const csv = [
      '11,4,80,1,11,"process@1-11@C:\\work\\src\\sub dir\\dup2.ts","C:\\work\\src\\sub dir\\dup2.ts","process","process ( items : number [ ] )",1,11',
      '5,5,54,1,5,"A::f@2-6@C:\\work\\src\\A.java","C:\\work\\src\\A.java","A::f","A::f( int x)",2,6',
      '',
    ].join('\r\n');
    const { rows, malformed } = parseLizardCsv(csv);
    expect(malformed).toBe(0);
    expect(rows[0]).toEqual({ nloc: 11, ccn: 4, parameters: 1, file: 'C:\\work\\src\\sub dir\\dup2.ts', function: 'process', start: 1, end: 11 });
    expect(rows[1]?.ccn).toBe(5);
  });

  it('CSV: doubled quotes and commas inside quotes', () => {
    expect(parseCsvLine('1,"a,b","say ""hi""",x')).toEqual(['1', 'a,b', 'say "hi"', 'x']);
  });

  it('jscpd summary merges overlapping ranges and ignores files outside the scope', () => {
    const index = new Map([[pathKey('/r/a.ts'), 'a.ts'], [pathKey('/r/b.ts'), 'b.ts']]);
    const s = summariseJscpd({
      statistics: { formats: { typescript: { sources: { '/r/a.ts': { lines: 100 }, '/r/b.ts': { lines: 50 }, '/r/vendor.ts': { lines: 999 } } } } },
      duplicates: [
        { format: 'typescript', lines: 10, firstFile: { name: '/r/a.ts', start: 1, end: 10 }, secondFile: { name: '/r/b.ts', start: 1, end: 10 } },
        { format: 'typescript', lines: 10, firstFile: { name: '/r/a.ts', start: 5, end: 14 }, secondFile: { name: '/r/b.ts', start: 30, end: 39 } },
        { format: 'typescript', lines: 10, firstFile: { name: '/r/a.ts', start: 1, end: 10 }, secondFile: { name: '/r/vendor.ts', start: 1, end: 10 } },
      ],
    }, index, 10);
    expect(s).toMatchObject({ files_analysed: 2, lines_analysed: 150, clone_pairs: 2, duplicated_lines: 14 + 20, duplication_pct: 22.7 });
    expect(s?.top_files?.[0]).toEqual({ file: 'b.ts', duplicated_lines: 20, lines: 50, clone_pairs: 2 });
  });

  it('scrubPaths replaces both separator spellings', () => {
    expect(scrubPaths('x C:\\t\\a and C:/t/a', ['C:\\t', null])).toBe('x <tmp>\\a and <tmp>/a');
  });
});

// ---- real tools (skipped unless installed) ---------------------------------

const realLizard = (await detectCodeHealthTool('lizard', fileBackedToolRunner)).status === 'present';
const realJscpd = (await detectCodeHealthTool('jscpd', fileBackedToolRunner)).status === 'present';

describe('Pass 26 with the real tools (#3487)', () => {
  let root: string;
  beforeAll(() => { root = fixture(); });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.skipIf(!realLizard)('lizard: per-function complexity for the measured files', async () => {
    const r = await runQualityPass(ctx(root, setting({ tools: ['lizard'] })));
    const l = (ch(r)['tools'] as Record<string, Rec>)['lizard'];
    expect(l?.['status']).toBe('complete');
    expect(Number(l?.['functions_analysed'])).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(!realJscpd)('jscpd: finds the copied order function', async () => {
    const r = await runQualityPass(ctx(root, setting({ tools: ['jscpd'] })));
    const j = (ch(r)['tools'] as Record<string, Rec>)['jscpd'];
    expect(j?.['status']).toBe('complete');
    expect(Number(j?.['clone_pairs'])).toBeGreaterThan(0);
  }, 120_000);
});
