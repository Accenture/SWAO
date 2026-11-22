import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// #4484: spy on the .swao.yml reads of listWorkspaceApps.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const { listWorkspaceApps, APP_INDEX_FILE } = await import('./workspace-app-kinds.js');

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function workspace(services: number): string {
  const root = fs.mkdtempSync(join(tmpdir(), 'swao-app-index-'));
  dirs.push(root);
  fs.mkdirSync(join(root, 'apps', 'sovereign-health'), { recursive: true });
  fs.writeFileSync(join(root, 'apps', 'sovereign-health', '.swao.yml'), 'app:\n  name: Sovereign Health\n');
  for (let i = 1; i <= services; i++) {
    const id = `app${String(i).padStart(4, '0')}`;
    fs.mkdirSync(join(root, 'apps', id), { recursive: true });
    fs.writeFileSync(join(root, 'apps', id, '.swao.yml'), `app_name: 'Service ${i}'\r\nassessment:\r\n  type: service\r\n`);
  }
  return root;
}

function swaoYmlReads(): number {
  const spy = vi.mocked(fs.readFileSync);
  return spy.mock.calls.filter((c) => String(c[0]).endsWith('.swao.yml')).length;
}

describe('app index (#4484)', () => {
  it('lists the one application of 1 application and 234 service apps, one read per app on the first listing', () => {
    const root = workspace(234);
    vi.mocked(fs.readFileSync).mockClear();
    const apps = listWorkspaceApps(root);
    expect(apps.filter((a) => a.kind === 'application')).toEqual([{ id: 'sovereign-health', kind: 'application', name: 'Sovereign Health' }]);
    expect(apps.filter((a) => a.kind === 'service')).toHaveLength(234);
    expect(apps[1]).toEqual({ id: 'app0001', kind: 'service', name: 'Service 1' });
    expect(swaoYmlReads()).toBe(235);
    expect(fs.existsSync(join(root, APP_INDEX_FILE))).toBe(true);
  });

  it('opens no .swao.yml on a second listing of an unchanged workspace', () => {
    const root = workspace(234);
    const first = listWorkspaceApps(root);
    vi.mocked(fs.readFileSync).mockClear();
    expect(listWorkspaceApps(root)).toEqual(first);
    expect(swaoYmlReads()).toBe(0);
  });

  it('re-reads a changed .swao.yml only, and picks up new and deleted apps', () => {
    const root = workspace(3);
    listWorkspaceApps(root);
    fs.writeFileSync(join(root, 'apps', 'app0002', '.swao.yml'), 'app:\n  name: Now An Application\n');
    fs.mkdirSync(join(root, 'apps', 'new-app'));
    fs.rmSync(join(root, 'apps', 'app0003'), { recursive: true });
    vi.mocked(fs.readFileSync).mockClear();
    const apps = listWorkspaceApps(root);
    expect(swaoYmlReads()).toBe(1);
    expect(apps.map((a) => `${a.id}:${a.kind}`)).toEqual([
      'app0002:application', 'new-app:application', 'sovereign-health:application', 'app0001:service',
    ]);
    expect(apps[0]!.name).toBe('Now An Application');
  });

  it('ignores an index of another version or an unreadable index', () => {
    const root = workspace(1);
    fs.mkdirSync(join(root, 'wsp', 'cache'), { recursive: true });
    fs.writeFileSync(join(root, APP_INDEX_FILE), '{not json');
    expect(listWorkspaceApps(root).map((a) => a.id)).toEqual(['sovereign-health', 'app0001']);
    fs.writeFileSync(join(root, APP_INDEX_FILE), JSON.stringify({ version: 0, apps: { 'sovereign-health': { kind: 'service', size: 0, mtimeMs: 0 } } }));
    expect(listWorkspaceApps(root)[0]).toEqual({ id: 'sovereign-health', kind: 'application', name: 'Sovereign Health' });
  });
});
