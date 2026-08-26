// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Recording provider + run store tests (#1422).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRecordingProvider,
  looksParseable,
  detectRefusal,
  detectAlteredMarkers,
  countForeignPaths,
  type UsageSnapshot,
} from './recording-provider.js';
import { CallRecordSchema } from './call-record.js';
import { RunLog, FindingsStore, CORE_FINDING_TYPES } from './run-store.js';

function makeHarness(opts?: { costSource?: 'billed' | 'local'; fail?: string }) {
  let usage: UsageSnapshot = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
  let clockMs = 1000;
  let ctx = { passId: '03-data', callSite: 'signal-extraction' };
  const recorded: unknown[] = [];
  const inner = {
    async complete(_prompt: string): Promise<string> {
      clockMs += 1500;
      usage = {
        input_tokens: usage.input_tokens + 700,
        output_tokens: usage.output_tokens + 300,
        cost_usd: usage.cost_usd + 0.002,
        call_count: usage.call_count + 1,
      };
      if (opts?.fail) throw new Error(opts.fail);
      return '```json\n{"signals": []}\n```';
    },
  };
  const provider = createRecordingProvider(inner, {
    leg: { id: 'or--test-model', connector: 'openrouter', model: 'test/model' },
    usageSnapshot: () => usage,
    costSource: opts?.costSource ?? 'billed',
    currentContext: () => ctx,
    isKnownPath: (p) => p.includes('src/known'),
    onRecord: (r) => recorded.push(r),
    now: () => clockMs,
    timestamp: () => '2026-08-06T12:00:00Z',
  });
  return { provider, recorded, setCtx: (c: typeof ctx) => { ctx = c; } };
}

describe('createRecordingProvider (#1422)', () => {
  it('writes a schema-valid record per call with usage deltas and timing', async () => {
    const h = makeHarness();
    const response = await h.provider.complete('classify {"a":1} please');
    expect(response).toContain('signals');
    const r = h.provider.records()[0]!;
    expect(() => CallRecordSchema.parse(r)).not.toThrow();
    expect(r.tokens.prompt).toBe(700);
    expect(r.tokens.completion).toBe(300);
    expect(r.cost_usd.computed).toBe(0.002);
    expect(r.timing.total_ms).toBe(1500);
    expect(r.pass_id).toBe('03-data');
    expect(r.reliability.dnf).toBe(false);
    expect(h.recorded).toHaveLength(1);
  });

  it('increments call_index within a pass and resets per pass', async () => {
    const h = makeHarness();
    await h.provider.complete('one');
    await h.provider.complete('two');
    h.setCtx({ passId: '12-blocks', callSite: 'block-batch' });
    await h.provider.complete('three');
    const [a, b, c] = h.provider.records();
    expect([a!.call_index, b!.call_index]).toEqual([0, 1]);
    expect(c!.pass_id).toBe('12-blocks');
    expect(c!.call_index).toBe(0);
  });

  it('local legs record cost null, never zero (092 s4)', async () => {
    const h = makeHarness({ costSource: 'local' });
    await h.provider.complete('x');
    expect(h.provider.records()[0]!.cost_usd.computed).toBeNull();
    expect(h.provider.records()[0]!.cost_usd.source).toBe('local');
  });

  it('a throwing call records DNF with the error and rethrows', async () => {
    const h = makeHarness({ fail: 'HTTP 429 rate limit from platform' });
    await expect(h.provider.complete('x')).rejects.toThrow(/429/);
    const r = h.provider.records()[0]!;
    expect(r.reliability.dnf).toBe(true);
    expect(r.reliability.rate_limited).toBe(true);
    expect(r.response_sha256).toBeUndefined();
    expect(() => CallRecordSchema.parse(r)).not.toThrow();
  });

  it('amendSchemaConform patches the identified call', async () => {
    const h = makeHarness();
    await h.provider.complete('x');
    expect(h.provider.records()[0]!.quality.schema_conform).toBe(true);
    h.provider.amendSchemaConform('03-data', 0, false);
    expect(h.provider.records()[0]!.quality.schema_conform).toBe(false);
  });

  it('8397 completion tokens under maxTokens=32768 is NOT a ceiling hit -- false DNF fixed (#2015)', async () => {
    // Before fix: SWAO_TOKEN_CEILING defaulted to 8192 so 8397 >= 8192 triggered DNF.
    // After fix: deps.maxTokens=32768 is used as the ceiling so 8397 < 32768 is clean.
    let usage: UsageSnapshot = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
    let clockMs = 0;
    const inner = {
      async complete(_p: string): Promise<string> {
        clockMs += 2000;
        usage = { input_tokens: usage.input_tokens + 1200, output_tokens: usage.output_tokens + 8397, cost_usd: usage.cost_usd + 0.05, call_count: usage.call_count + 1 };
        return '{"signals": []}';
      },
    };
    const provider = createRecordingProvider(inner, {
      leg: { id: 'leg-a', connector: 'anthropic', model: 'claude-sonnet-4-6' },
      usageSnapshot: () => usage,
      costSource: 'billed',
      currentContext: () => ({ passId: '04-ctx', callSite: 'ctx-extract' }),
      isKnownPath: () => false,
      onRecord: () => undefined,
      now: () => clockMs,
      timestamp: () => '2026-08-24T00:00:00Z',
      maxTokens: 32768,
    });
    await provider.complete('analyse this context');
    const r = provider.records()[0]!;
    expect(r.tokens.completion).toBe(8397);
    expect(r.reliability.dnf).toBe(false);
    expect(r.reliability.error).toBeUndefined();
  });

  it('32768 completion tokens at maxTokens=32768 IS a ceiling hit (real truncation)', async () => {
    let usage: UsageSnapshot = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
    let clockMs = 0;
    const inner = {
      async complete(_p: string): Promise<string> {
        clockMs += 5000;
        usage = { input_tokens: 1200, output_tokens: 32768, cost_usd: 0.2, call_count: 1 };
        return '{"partial": true';
      },
    };
    const provider = createRecordingProvider(inner, {
      leg: { id: 'leg-b', connector: 'anthropic', model: 'claude-sonnet-4-6' },
      usageSnapshot: () => usage,
      costSource: 'billed',
      currentContext: () => ({ passId: '04-ctx', callSite: 'ctx-extract' }),
      isKnownPath: () => false,
      onRecord: () => undefined,
      now: () => clockMs,
      timestamp: () => '2026-08-24T00:00:00Z',
      maxTokens: 32768,
    });
    await provider.complete('analyse this context');
    const r = provider.records()[0]!;
    expect(r.tokens.completion).toBe(32768);
    expect(r.reliability.dnf).toBe(true);
    expect(r.reliability.error).toContain('32768');
  });
});

describe('heuristics (#1422)', () => {
  it('looksParseable accepts fenced and bare JSON, rejects prose', () => {
    expect(looksParseable('```json\n{"a": 1}\n```')).toBe(true);
    expect(looksParseable('prefix {"a": {"b": 2}} suffix')).toBe(true);
    expect(looksParseable('I am sorry, no JSON here')).toBe(false);
    expect(looksParseable('{broken: json')).toBe(false);
  });

  it('looksParseable accepts YAML-structured challenge responses (#1959)', () => {
    const yamlChallenge = 'opening_summary: The application has critical gaps.\nfindings:\n  - id: CR-PM-01\n    concern: Missing SLA.';
    expect(looksParseable(yamlChallenge)).toBe(true);
    const yamlFenced = '```yaml\nopening_summary: Summary text here.\n```';
    expect(looksParseable(yamlFenced)).toBe(true);
    expect(looksParseable('Plain prose with no structure')).toBe(false);
  });

  it('detectRefusal catches refusal phrasing in short responses only', () => {
    expect(detectRefusal("I can't help with that request.")).toBe(true);
    expect(detectRefusal('I must decline to analyse this.')).toBe(true);
    expect(detectRefusal('{"signals": ["ok"]}')).toBe(false);
  });

  it('altered redaction markers flag; verbatim echo does not (092 s5.2)', () => {
    const prompt = 'Contact [REDACTED:email-1] at host [REDACTED:host-2].';
    expect(detectAlteredMarkers(prompt, 'The contact [REDACTED:email-1] uses that host.')).toBe(false);
    expect(detectAlteredMarkers(prompt, 'The contact [REDACTED:email-1-guessed@acme.example] ...')).toBe(true);
    expect(detectAlteredMarkers('no markers here', '[REDACTED:invented]')).toBe(false);
  });

  it('countForeignPaths counts unknown paths once each', () => {
    const resp = 'See src/known/a.ts and src/ghost/b.ts plus src/ghost/b.ts again.';
    expect(countForeignPaths(resp, (p) => p.includes('src/known'))).toBe(1);
    expect(countForeignPaths(resp)).toBe(0); // no checker injected -> 0
  });
});

describe('RunLog + FindingsStore (#1422, 092 s5.7)', () => {
  it('log is append-only NDJSON; findings get F-n ids and YAML output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-runstore-'));
    try {
      const log = new RunLog(join(dir, 'log.ndjson'), () => '2026-08-06T12:00:00Z');
      const findings = new FindingsStore(log);
      log.write('info', 'leg.start', 'leg or--test starting', { leg: 'or--test' });
      const f = findings.add({
        severity: 'warn', leg: 'or--test', pass_id: '07-ctx', call_ref: '07-ctx#0',
        type: 'timeout', message: 'no response within 120s cap', metric_impact: 'perf.latency_p50_ms',
      });
      expect(f.id).toBe('F-1');
      findings.add({ severity: 'info', type: 'custom-novel-type', message: 'open taxonomy works' });

      const lines = readFileSync(join(dir, 'log.ndjson'), 'utf-8').trim().split('\n');
      expect(lines.length).toBe(3); // leg.start + 2 finding.recorded
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

      const yamlPath = findings.writeYaml(dir);
      expect(existsSync(yamlPath)).toBe(true);
      const yaml = readFileSync(yamlPath, 'utf-8');
      expect(yaml).toContain('id: F-1');
      expect(yaml).toContain('"custom-novel-type"');
      expect(findings.forCell('or--test', '07-ctx')).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('core finding vocabulary is described (tooltips) and includes the validated types', () => {
    for (const t of ['timeout', 'cost-unavailable', 'workload-incomplete', 'shared-platform', 'verdict-conflict']) {
      expect(CORE_FINDING_TYPES[t], `${t} missing`).toBeTruthy();
      expect(CORE_FINDING_TYPES[t]!.length).toBeGreaterThan(30);
    }
  });
});
