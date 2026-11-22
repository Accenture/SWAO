// #4008: a `.swao.yml` that is no YAML (app or workspace) ends `swao assess
// --app` with one [error] line naming the file and line, exit 1, no stack
// trace. Before the fix the unguarded load of the app file (assess.ts) threw
// out of the action (an unhandledRejection with exit 0 in the CLI).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';
import { swaoYmlParseErrorLine } from './assess.js';

const tmp: string[] = [];
let sandbox: LicenceSandbox | undefined;
afterEach(() => {
  sandbox?.restore();
  sandbox = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function workspace(o: { appYml?: string; wsYml?: string }): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-assess-yamlerr-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), o.wsYml ?? 'name: demo\n');
  mkdirSync(join(ws, 'apps', 'payments', 'src'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'payments', '.swao.yml'), o.appYml ?? 'source:\n  path: ./src\n');
  writeFileSync(join(ws, 'apps', 'payments', 'src', 'main.py'), 'print(1)\n');
  return ws;
}

// The UAT shape: a key appended to the previous line ("bad indentation of a mapping entry").
const BROKEN = 'source:\n  path: ./src\nassessment:\n  regimes_active: [GDPR]  type: application\n    pass_profile: x\n';

describe('swao assess --app with a .swao.yml that is no YAML (#4008)', () => {
  it('app .swao.yml: one [error] line with the file and line, exit 1, no pass and no stack trace', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ appYml: BROKEN });
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
    expect(r.threw).toBeUndefined();
    expect(r.code, r.out.slice(-2000)).toBe(1);
    const errors = r.out.split('\n').filter((l) => l.startsWith('[error]'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(join(ws, 'apps', 'payments', '.swao.yml'));
    expect(errors[0]).toMatch(/not valid YAML at line 4, column 27: bad indentation of a mapping entry; fix the file and run again$/);
    expect(r.out).not.toContain('YAMLException');
    expect(r.out).not.toContain('[info] Running Pass');
  }, 200_000);

  it('workspace .swao.yml: the same, naming the workspace file', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ wsYml: 'name: demo\nlanding_zones:\n  - id: a\n   provider: otc\n' });
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
    expect(r.threw).toBeUndefined();
    expect(r.code, r.out.slice(-2000)).toBe(1);
    expect(r.out).toContain(`[error] ${join(ws, '.swao.yml')}: not valid YAML at line `);
    expect(r.out).not.toContain('[info] Running Pass');
  }, 200_000);

  it('a non-YAML error names the file and the message only', () => {
    expect(swaoYmlParseErrorLine('/x/.swao.yml', new Error('EACCES'))).toBe('[error] /x/.swao.yml: cannot be read: EACCES');
  });
});
