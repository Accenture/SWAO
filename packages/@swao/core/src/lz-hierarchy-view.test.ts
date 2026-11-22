// #3885 (Design 123 sections 5.6 and 9.3): the pseudonymised tenant tree view.
import { describe, it, expect } from 'vitest';
import { LzHierarchyViewSchema, buildLzHierarchyView, formatLzHierarchyTree } from './lz-hierarchy-view.js';

// Native-looking ids (assembled so no literal id sits in the source).
const ORG = ['o', 'bait', '9x8y'].join('-');
const OU = ['ou', 'bait', '0001'].join('-');
const ACC = ['1234', '5678', '9012'].join('');
const ACC2 = ['2109', '8765', '4321'].join('');

const NODES = [
  { id: ORG, kind: 'organisation' as const, native_kind: 'aws:organization', label: 'Node-00000000aa', status: 'observed' as const },
  { id: 'r-1', kind: 'root' as const, native_kind: 'aws:root', parent: ORG, label: 'Node-00000000bb', status: 'observed' as const },
  { id: OU, kind: 'organisational_unit' as const, native_kind: 'aws:ou', parent: 'r-1', label: 'Node-00000000cc', status: 'observed' as const },
  { id: ACC, kind: 'account' as const, native_kind: 'aws:account', parent: OU, label: 'Node-00000000dd', status: 'observed' as const },
  { id: ACC2, kind: 'account' as const, parent: 'r-1', status: 'unknown' as const },
];

describe('buildLzHierarchyView (#3885)', () => {
  it('empty tree gives no view', () => {
    expect(buildLzHierarchyView({ nodes: [] })).toBeUndefined();
  });

  it('deep tree: depth-first order, positional refs, depth, counts per kind, legend; no native id anywhere', () => {
    const v = buildLzHierarchyView({ nodes: NODES, partial: false })!;
    expect(LzHierarchyViewSchema.parse(v)).toEqual(v);
    expect(v.nodes.map((n) => [n.ref, n.parent_ref, n.depth, n.kind])).toEqual([
      ['n1', undefined, 0, 'organisation'],
      ['n2', 'n1', 1, 'root'],
      ['n3', 'n2', 2, 'account'],
      ['n4', 'n2', 2, 'organisational_unit'],
      ['n5', 'n4', 3, 'account'],
    ]);
    expect(v.depth).toBe(4);
    expect(v.nodes_by_kind).toEqual({ organisation: 1, root: 1, account: 2, organisational_unit: 1 });
    expect(v.legend.map((l) => l.native_kind)).toEqual(['aws:account', 'aws:organization', 'aws:ou', 'aws:root']);
    const text = JSON.stringify(v);
    for (const id of [ORG, OU, ACC, ACC2, 'r-1']) expect(text).not.toContain(id);
  });

  it('partial tree with an unknown node: marked, counted, the view is partial', () => {
    const v = buildLzHierarchyView({ nodes: NODES })!;
    expect(v.unknown_nodes).toBe(1);
    expect(v.partial).toBe(true);
    const lines = formatLzHierarchyTree(v);
    expect(lines.some((l) => l.includes('unknown account (account) [unknown]'))).toBe(true);
    expect(lines.at(-1)).toContain('1 unknown; partial collection');
  });

  it('checks attach by node_id, else by the scope node, and roll up to every ancestor; pass and warn are not counted', () => {
    const v = buildLzHierarchyView({
      nodes: NODES, scopeNodes: { platform: ORG, app: ACC },
      checks: [
        { status: 'fail', node_id: ACC },
        { status: 'unverified', scope_id: 'app' },
        { status: 'fail', scope_id: 'platform' },
        { status: 'pass', node_id: ACC },
        { status: 'warn', node_id: OU },
        { status: 'fail', node_id: 'not-a-node', scope_id: 'nope' },
      ],
    })!;
    const byKindDepth = (ref: string) => v.nodes.find((n) => n.ref === ref)!;
    expect(byKindDepth('n5')).toMatchObject({ own: { fail: 1, unverified: 1 }, rolled: { fail: 1, unverified: 1 } });
    expect(byKindDepth('n4').rolled).toEqual({ fail: 1, unverified: 1 });
    expect(byKindDepth('n1')).toMatchObject({ own: { fail: 1, unverified: 0 }, rolled: { fail: 2, unverified: 1 } });
    expect(v.has_check_counts).toBe(true);
    expect(formatLzHierarchyTree(v)[0]).toContain('fail 2, unverified 1');
  });

  it('a label that is not a pseudonym is never shown', () => {
    const v = buildLzHierarchyView({ nodes: [{ id: 'x', kind: 'project', label: 'Finance Prod', status: 'observed' }] })!;
    expect(v.nodes[0]!.label).toBeUndefined();
    expect(formatLzHierarchyTree(v)[0]).toBe('unnamed project (project)');
  });
});
