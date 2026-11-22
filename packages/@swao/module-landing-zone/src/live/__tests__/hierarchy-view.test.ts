// #3885: `swao lz hierarchy <lz-id>` (Design 123 sections 5.6, 9.4). Synthetic
// run folders; the tree carries native-looking ids that must never be printed.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { LicenseTierError, deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan } from '@swao/core';
import { formatLzHierarchy, runLzHierarchy } from '../hierarchy-view.js';
import { lzHierarchyAction } from '../cli.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const DOMAIN = ['dom', 'bait', '77aa'].join('-');
const PROJECT = ['prj', 'bait', '88bb'].join('-');
const NATIVE_NAME = ['eu-de', 'finance'].join('_');

function scan(scopeId: string, kind: 'platform' | 'application', withTree: boolean, checks: LzLiveScan['estate']['checks'] = []): LzLiveScan {
  const meta = {
    lz_id: 'otc-prod', provider: 'otc', scope_id: scopeId, scope_kind: kind, observed_at: '2026-11-05T08:00:00Z',
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
  };
  const offering = { regions: [], services: [] };
  const estate = {
    resources: [], workloads: [], guardrails: [], quotas: [], checks,
    ...(withTree ? { hierarchy: {
      nodes: [
        { id: DOMAIN, kind: 'root' as const, native_kind: 'otc:domain', label: 'Node-0a0a0a0a0a' },
        { id: PROJECT, kind: 'project' as const, native_kind: 'otc:project', parent: DOMAIN, label: 'Node-0b0b0b0b0b' },
        { id: 'prj-hidden', kind: 'project' as const, status: 'unknown' as const },
      ],
      source: { calls: ['iam:GET /v3/projects'], partial: true },
      scope_node: DOMAIN,
    } } : {}),
  };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

function workspace(o: { tree?: boolean; merged?: boolean } = {}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-hierarchy-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  const put = (run: string, s: LzLiveScan): void => {
    const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', run);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `otc-prod.${s.meta.scope_id}.lz-live-scan.json`), JSON.stringify(s));
  };
  put('2026-11-04T08-00-00', scan('platform', 'platform', false));
  const checks = [
    { id: 'CPB-TAG-01', title: 'Tags', status: 'fail' as const, controls: ['CPB-TAG-01'], node_id: PROJECT },
    { id: 'CPB-EXIT-01', title: 'Exit', status: 'unverified' as const, controls: ['CPB-EXIT-01'], observability: 'not_observable' as const },
  ];
  put('2026-11-05T08-00-00', scan('platform', 'platform', o.tree !== false, o.tree !== false ? checks : []));
  if (o.merged) {
    writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-05T08-00-00', 'lz-live-merged.yaml'), dump({
      lz_id: 'otc-prod', provider: 'otc', merged_at: '2026-11-05T09:00:00Z', window_days: 7,
      scopes: [{ scope_id: 'platform', scope_kind: 'platform', status: 'merged', observed_at: '2026-11-05T08:00:00Z' }],
      offering: { regions: [], services: [] },
      estate: { resources: [], guardrails: [], hierarchy: {
        nodes: [{ id: DOMAIN, kind: 'root', native_kind: 'otc:domain', label: 'Node-0a0a0a0a0a' }, { id: PROJECT, kind: 'project', native_kind: 'otc:project', parent: DOMAIN, label: 'Node-0b0b0b0b0b' }],
        source: { calls: ['iam:GET /v3/projects'] }, scope_nodes: { platform: DOMAIN },
      } },
    }));
  }
  return ws;
}

describe('runLzHierarchy (#3885)', () => {
  it('latest run, from the platform scan: tree, unknown node, partial, fail and unverified rolled up; no native id or name', () => {
    const r = runLzHierarchy({ workspaceRoot: workspace(), lzId: 'otc-prod' });
    expect(r.run_id).toBe('2026-11-05T08-00-00');
    expect(r.source).toBe('scan');
    const lines = formatLzHierarchy(r);
    expect(lines[0]).toBe('landing zone otc-prod, run 2026-11-05T08-00-00 (scan)');
    expect(lines).toContain('Node-0a0a0a0a0a (root, otc:domain)  fail 1, unverified 1');
    expect(lines).toContain('  - Node-0b0b0b0b0b (project, otc:project)  fail 1, unverified 0');
    expect(lines.some((l) => l.includes('unknown project (project) [unknown]'))).toBe(true);
    expect(lines.some((l) => l.includes('partial collection'))).toBe(true);
    expect(lines.at(-1)).toBe('legend: project = otc:project; root = otc:domain');
    const text = lines.join('\n');
    for (const bait of [DOMAIN, PROJECT, 'prj-hidden', NATIVE_NAME]) expect(text).not.toContain(bait);
  });

  it('prefers the merged view when the run has one', () => {
    const r = runLzHierarchy({ workspaceRoot: workspace({ merged: true }), lzId: 'otc-prod' });
    expect(r.source).toBe('merged');
    expect(r.view?.nodes).toHaveLength(2);
  });

  it('--run picks an older run; a run without a tree says so; unknown run and bad id throw', () => {
    const ws = workspace();
    const old = runLzHierarchy({ workspaceRoot: ws, lzId: 'otc-prod', run: '2026-11-04T08:00:00Z' });
    expect(old.view).toBeUndefined();
    expect(formatLzHierarchy(old)[1]).toMatch(/no tenant hierarchy in this run/);
    expect(() => runLzHierarchy({ workspaceRoot: ws, lzId: 'otc-prod', run: '2026-01-01T00-00-00' })).toThrow(/no run with live scans/);
    expect(() => runLzHierarchy({ workspaceRoot: ws, lzId: 'Bad_Id' })).toThrow(/kebab-case/);
    expect(() => runLzHierarchy({ workspaceRoot: ws, lzId: 'other-lz' })).toThrow(/no live run/);
  });
});

describe('lzHierarchyAction (#3885)', () => {
  it('prints the tree (exit 0), errors exit 1, below the assess tier exit 2 with the [LICENSE] block', () => {
    const ws = workspace();
    const out: string[] = [];
    const err: string[] = [];
    const deps = { cwd: ws, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(lzHierarchyAction('otc-prod', {}, deps)).toBe(0);
    expect(out.some((l) => l.includes('Node-0b0b0b0b0b'))).toBe(true);
    expect(lzHierarchyAction('otc-prod', { run: 'nope' }, deps)).toBe(1);
    const gated: string[] = [];
    const tierDeps = { ...deps, guard: { requireFeature: (k: string) => { gated.push(k); throw new LicenseTierError('consultant', 'community', k); } } };
    expect(lzHierarchyAction('otc-prod', {}, tierDeps)).toBe(2);
    expect(gated).toEqual(['lz-live-assess']);
    expect(err.at(-1)?.startsWith('[LICENSE] ')).toBe(true);
  });
});
