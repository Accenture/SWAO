// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3487: `assessment.code_health` schema, resolver and the endpoint allowlist helpers.

import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { SwaoYmlSchema, SwaoYmlCodeHealthSchema } from './swao-yml.js';
import { DEFAULT_CODE_HEALTH_SETTING, resolveCodeHealthSetting } from './code-health-config.js';
import { isValidEndpointAllowEntry, normaliseEndpointAllowlist, scanEndpoints } from './endpoint-scanner.js';

describe('SwaoYmlCodeHealthSchema (#3487)', () => {
  it('accepts the documented block and keeps it on the parsed .swao.yml', () => {
    const raw = load(`
assessment:
  code_health:
    top_n: 50
    endpoint_allowlist: [api.partner.example, .corp.example, 10.20.30.40, "fd00::1"]
    tools: [lizard, jscpd]
    tool_timeout_seconds: 600
`);
    const parsed = SwaoYmlSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    const ch = (parsed.success ? parsed.data.assessment?.code_health : undefined) as Record<string, unknown> | undefined;
    expect(ch?.['top_n']).toBe(50);
    expect(ch?.['tools']).toEqual(['lizard', 'jscpd']);
    expect(ch?.['endpoint_allowlist']).toHaveLength(4);
  });

  it('a workspace without the block still parses (all keys optional)', () => {
    expect(SwaoYmlSchema.safeParse(load('assessment:\n  type: application\n')).success).toBe(true);
    expect(SwaoYmlCodeHealthSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    [{ top_n: 0 }, 'top_n below 1'],
    [{ top_n: 501 }, 'top_n above 500'],
    [{ top_n: 2.5 }, 'top_n not an integer'],
    [{ tools: ['pmd'] }, 'unknown tool'],
    [{ tool_timeout_seconds: 5 }, 'timeout below 10 s'],
    [{ tool_timeout_seconds: 4000 }, 'timeout above 3600 s'],
    [{ endpoint_allowlist: ['https://api.example.org'] }, 'URL instead of a host'],
    [{ endpoint_allowlist: ['api.example.org:8443'] }, 'host with port'],
    [{ endpoint_allowlist: ['api.example.org/path'] }, 'host with path'],
    [{ endpoint_allowlist: ['*.example.org'] }, 'wildcard'],
    [{ endpoint_allowlist: ['.'] }, 'bare dot'],
    [{ endpoint_allowlist: [''] }, 'empty entry'],
  ])('refuses %j (%s)', (block) => {
    expect(SwaoYmlCodeHealthSchema.safeParse(block).success).toBe(false);
    expect(SwaoYmlSchema.safeParse({ assessment: { code_health: block } }).success).toBe(false);
  });

  it('names the key in the allowlist error message', () => {
    const r = SwaoYmlCodeHealthSchema.safeParse({ endpoint_allowlist: ['http://x.example'] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('assessment.code_health.endpoint_allowlist');
  });
});

describe('resolveCodeHealthSetting (#3487)', () => {
  it('defaults: top 25, no allowlist, no tool, 300 s', () => {
    expect(resolveCodeHealthSetting(undefined, undefined)).toEqual(DEFAULT_CODE_HEALTH_SETTING);
    expect(DEFAULT_CODE_HEALTH_SETTING.topN).toBe(25);
    expect(DEFAULT_CODE_HEALTH_SETTING.tools).toEqual([]);
  });

  it('resolves per key: app first, then workspace', () => {
    const r = resolveCodeHealthSetting(
      { code_health: { top_n: 10 } },
      { code_health: { top_n: 40, tools: ['lizard'], endpoint_allowlist: ['B.Example.ORG.', 'a.example.org', 'a.example.org'] } },
    );
    expect(r.topN).toBe(10);
    expect(r.source.top_n).toBe('app');
    expect(r.tools).toEqual(['lizard']);
    expect(r.source.tools).toBe('workspace');
    expect(r.endpointAllowlist).toEqual(['a.example.org', 'b.example.org']);
    expect(r.toolTimeoutSeconds).toBe(300);
    expect(r.source.tool_timeout_seconds).toBe('default');
  });

  it('an app list replaces the workspace list (no merge); an empty app list switches tools off', () => {
    const r = resolveCodeHealthSetting(
      { code_health: { tools: [], endpoint_allowlist: ['x.example.org'] } },
      { code_health: { tools: ['lizard', 'jscpd'], endpoint_allowlist: ['y.example.org'] } },
    );
    expect(r.tools).toEqual([]);
    expect(r.source.tools).toBe('app');
    expect(r.endpointAllowlist).toEqual(['x.example.org']);
  });

  it('tool order is canonical (jscpd, lizard) whatever the file order', () => {
    expect(resolveCodeHealthSetting({ code_health: { tools: ['lizard', 'jscpd', 'lizard'] } }).tools).toEqual(['jscpd', 'lizard']);
  });

  it('ignores values the schema would refuse (tolerant for unvalidated callers)', () => {
    const r = resolveCodeHealthSetting({ code_health: { top_n: 0, tool_timeout_seconds: 'x', tools: 'lizard' } }, { code_health: { top_n: 30 } });
    expect(r.topN).toBe(30);
    expect(r.toolTimeoutSeconds).toBe(300);
    expect(r.tools).toEqual([]);
  });
});

describe('endpoint allowlist helpers (#3487)', () => {
  it('validates entries', () => {
    for (const ok of ['api.example.org', '.corp.example', 'db', '10.0.0.1', 'fd00::1', '2001:db8::5', 'Upper.Example.Org.']) {
      expect(isValidEndpointAllowEntry(ok), ok).toBe(true);
    }
    for (const bad of ['', ' ', '.', '..x', 'a..b', 'http://x', 'x:80', 'x/y', '*.x', 'a b', 'x'.repeat(254)]) {
      expect(isValidEndpointAllowEntry(bad), bad).toBe(false);
    }
  });

  it('normalises: lower-case, trailing dot, de-duplicated, sorted, invalid dropped', () => {
    expect(normaliseEndpointAllowlist(['b.example.org', 'A.Example.org.', 'a.example.org', 'http://x', 42])).toEqual(['a.example.org', 'b.example.org']);
  });

  it('allowlisted hosts are not reportable in the scanner', () => {
    const text = 'url = "https://api.partner-system.com/v1"\nip = "10.1.2.3"\nother = "https://billing.vendor-x.com"';
    const hits = scanEndpoints(text, { allowHosts: normaliseEndpointAllowlist(['.partner-system.com', '10.1.2.3']) });
    expect(hits.map((h) => [h.host, h.classification, h.reportable])).toEqual([
      ['api.partner-system.com', 'allowlisted', false],
      ['10.1.2.3', 'allowlisted', false],
      ['billing.vendor-x.com', 'public', true],
    ]);
  });
});
