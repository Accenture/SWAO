import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listWorkspaceApps, appDisplayName } from './workspace-app-kinds.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(apps: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-apps-'));
  dirs.push(root);
  for (const [id, yml] of Object.entries(apps)) {
    mkdirSync(join(root, 'apps', id), { recursive: true });
    if (yml !== null) writeFileSync(join(root, 'apps', id, '.swao.yml'), yml);
  }
  return root;
}

describe('listWorkspaceApps names (#4458)', () => {
  it('carries app_name, else app.name, and omits the name when unset', () => {
    const root = ws({
      app0002: 'app_name: Demo Service\nassessment:\n  type: service\n',
      app0001: 'app:\n  name: Demo  Portal\n',
      app0003: null,
    });
    expect(listWorkspaceApps(root)).toEqual([
      { id: 'app0001', kind: 'application', name: 'Demo Portal' },
      { id: 'app0003', kind: 'application' },
      { id: 'app0002', kind: 'service', name: 'Demo Service' },
    ]);
  });
  it('#4503: an unquoted YAML null app_name of a service app is no name; a quoted "null" is a name', () => {
    const svc = (name: string): string => `app_name: ${name}\r\nassessment:\r\n  type: service\r\n`;
    const root = ws({ app0001: svc('null'), app0002: svc('~'), app0003: svc('NULL  # no name in the intake'), app0004: svc("'null'") });
    expect(listWorkspaceApps(root)).toEqual([
      { id: 'app0001', kind: 'service' },
      { id: 'app0002', kind: 'service' },
      { id: 'app0003', kind: 'service' },
      { id: 'app0004', kind: 'service', name: 'null' },
    ]);
  });
  it('never throws on a malformed .swao.yml', () => {
    const root = ws({ app0001: 'app_name: [unclosed\n' });
    expect(appDisplayName(join(root, 'apps', 'app0001'))).toBeUndefined();
  });
});
