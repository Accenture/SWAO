// #3589: Landing Zone Connections screen (Design 120 section 14.2) with an
// injected CLI runner, a temporary vault and a fake driver list (no process
// spawned, no network). Pins: the CLI argv of every action, credential values
// on stdin only (never in argv or a frame), the probe only reporting (no
// accept flag), legacy migration shown only when the vault holds legacy keys,
// and the confirmation before remove.
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CredentialStore, lzExpiredSessionLine } from '@swao/core';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return { ...original, LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'community', valid: true, assessmentCount: 0, firstRun: '' } })) } };
});

import { LzConnectionsScreen, type ConnectionsCliRunner, type ConnectionDriverInfo } from '../LzConnectionsScreen.js';
import { LzConnectionsStep, LZ_CONNECTIONS_STEP_CHOICES, LZ_CONNECTIONS_STEP_GUIDANCE } from '../wizard/steps/LzConnectionsStep.js';
import { actionDisabledReason, LZ_CONNECTIONS_ACTION_GUIDANCE, LZ_CONNECTIONS_GUIDANCE } from '../lz-connections-flow.js';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function dir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

const REGISTERED = ['name: demo', 'landing_zones:', '  - id: aws-demo', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', '        regions: [eu-central-1]', ''].join('\n');
const REGISTERED_WITH_TARGET = REGISTERED.replace('        regions: [eu-central-1]\n', '        regions: [eu-central-1]\n        target:\n          account: "123456789012"\n        app: payments\n');

function workspace(yml = 'name: demo\n'): string {
  const d = dir('swao-lzc-screen-');
  writeFileSync(join(d, '.swao.yml'), yml);
  return d;
}

const DRIVERS: ConnectionDriverInfo[] = [
  { provider: 'otc', authMethods: [{ id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [], unattended: true }] },
  { provider: 'aws', authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: ['session-token', 'expires-at'], unattended: true }] },
];

// Fake values, built at runtime so no secret-shaped literal is committed.
const SECRET = ['not', 'a', 'real', 'password'].join('-');

interface Call { args: string[]; stdin?: string }
function runner(probe: 'verified' | 'refused' = 'refused'): { run: ConnectionsCliRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: ConnectionsCliRunner = async (args, onLine, stdinText) => {
    calls.push({ args, ...(stdinText !== undefined ? { stdin: stdinText } : {}) });
    if (args[1] === 'probe') {
      onLine(`scope platform: identity operator-group, read-only ${probe}`);
      onLine('  coverage: 5 readable');
      if (probe === 'refused') onLine('  credential is write-capable (role te_admin)');
      return probe === 'refused' ? 1 : 0;
    }
    onLine('landing zone otc-prod, scope platform: landing zone added in .swao.yml');
    return 0;
  };
  return { run, calls };
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function type(stdin: { write: (s: string) => void }, text: string): Promise<void> {
  for (const ch of text) stdin.write(ch);
  await settle(30);
}

describe('LzConnectionsScreen (#3589)', () => {
  it('Add landing zone: provider, id, display name, scope, kind, auth, regions, locator, masked credentials -> lz connect (stdin) then lz probe', async () => {
    const { run, calls } = runner('refused');
    const store = new CredentialStore(dir('swao-lzc-vault-'));
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={run} store={store} drivers={DRIVERS} />);
    await settle(150);
    expect(lastFrame()).toContain('No landing zone registered');
    expect(lastFrame()).not.toContain('Migrate legacy LZR credentials');
    stdin.write('1'); await settle();
    expect(lastFrame()).toContain('Provider of the landing zone');
    stdin.write('\r'); await settle(); // otc
    // lz id prefilled otc-prod
    stdin.write('\r'); await settle();
    // #4234: the display name is pre-filled with the provider brand; Enter confirms it.
    expect(lastFrame()).toContain('T Cloud Public');
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(); // kind platform
    stdin.write('\r'); await settle(); // auth iam-password-token
    await type(stdin, 'eu-de, eu-nl'); stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(); // no locator
    expect(lastFrame()).toContain('Link the scope to an app (optional)');
    stdin.write('\r'); await settle(); // no app link
    // #4229: the scope id is asked last, proposed from the kind (platform), and only confirmed.
    expect(lastFrame()).toContain('Short name for this scope');
    expect(lastFrame()).toContain('platform');
    expect(lastFrame()).not.toContain('kebab-case');
    stdin.write('\r'); await settle(); // scope id platform
    expect(lastFrame()).toContain('Credential 1 of 3');
    await type(stdin, 'operator'); stdin.write('\r'); await settle();
    await type(stdin, SECRET);
    expect(lastFrame()).not.toContain(SECRET);
    stdin.write('\r'); await settle();
    await type(stdin, 'tenant-domain'); stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Register this scope?');
    // #4299: ConfirmPanel rows; the keys are in the hint line, not in the body.
    expect(lastFrame()).toMatch(/Credentials\s+fields username, password, domain/);
    expect(lastFrame()).toMatch(/Scope\s+platform: Platform landing zone \(PLZ\)/);
    expect(lastFrame()).toContain('Enter confirm   ← back   Esc cancel');
    expect(lastFrame()).not.toContain('[Enter/y]');
    expect(lastFrame()).not.toContain(SECRET);
    stdin.write('\r'); await settle(200);
    // #4299: one Enter on the ConfirmPanel registers once (no second key handler).
    expect(calls.filter((c) => c.args[1] === 'connect')).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['lz', 'connect', 'otc-prod', '--provider', 'otc', '--scope', 'platform', '--kind', 'platform', '--auth', 'iam-password-token', '--region', 'eu-de', '--region', 'eu-nl', '--display', 'T Cloud Public', '--credentials-stdin', '--no-probe']);
    expect(calls[0]?.stdin).toBe(`username=operator\npassword=${SECRET}\ndomain=tenant-domain\n`);
    expect(calls.flatMap((c) => c.args).join(' ')).not.toContain(SECRET);
    // The probe only reports: no accept flag, refused is shown, not a failed connect.
    expect(calls[1]?.args).toEqual(['lz', 'probe', 'otc-prod', '--scope', 'platform']);
    expect(lastFrame()).toContain('scope platform registered with 3 credential field(s)');
    expect(lastFrame()).not.toContain('lz:otc-prod:platform'); // #4299: vault key names only in the guidance
    // #4298: warn with the words of the Setup Probe step; no red refused, no CLI flag, no identity in the body.
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toMatch(/\[warn\] Scope platform write-capable, accepted for this run; SWAO only reads/);
    expect(lastFrame()).toContain('coverage 5 readable');
    expect(lastFrame()).not.toContain('read-only refused');
    expect(lastFrame()).not.toContain('--accept-write-capable-credentials');
    expect(lastFrame()).not.toContain('operator-group');
    expect(lastFrame()).not.toContain(SECRET);
  });

  it('a connect failure is reported and no probe runs', async () => {
    const calls: Call[] = [];
    const run: ConnectionsCliRunner = async (args, onLine) => { calls.push({ args }); onLine('[lz live] no live driver for provider otc'); return 1; };
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(150);
    stdin.write('1'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(); // no app link
    for (let i = 0; i < 3; i++) { await type(stdin, 'x'); stdin.write('\r'); await settle(); }
    stdin.write('\r'); await settle(200);
    expect(lastFrame()).toContain('Connect failed (exit 1)');
    expect(calls).toHaveLength(1);
  });

  it('lists registered scopes with the offline state; Probe runs lz probe <lz-id> without accept flags', async () => {
    const { run, calls } = runner('verified');
    const store = new CredentialStore(dir('swao-lzc-vault-'));
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED)} run={run} store={store} drivers={DRIVERS} />);
    await settle(200);
    expect(lastFrame()).toContain('aws-demo');
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('credentials missing: access-key-id,');
    stdin.write('3'); await settle();
    stdin.write('\r'); await settle(200);
    expect(calls[0]?.args).toEqual(['lz', 'probe', 'aws-demo']);
    expect(lastFrame()).toMatch(/\[ok\]\s+Scope platform\s+read-only verified/);
  });

  it('#4230: with the guidance box open the number keys and Enter still work; Esc closes the box only', async () => {
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={onBack} workspace={workspace(REGISTERED)} run={runner('verified').run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    stdin.write('\x07'); await settle();
    expect(lastFrame()).toContain('Ctrl+G close guidance');
    // Esc belongs to the open box: it closes the box and never leaves the screen.
    stdin.write('\u001B'); await settle();
    expect(onBack).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Ctrl+G for guidance');
    stdin.write('\x07'); await settle();
    // A number key picks the entry while the box is open (before #4230 every key was ignored).
    stdin.write('1'); await settle();
    expect(lastFrame()).toContain('Provider of the landing zone');
  });

  it('Add scope to a registered landing zone offers application only when a platform scope exists', async () => {
    const { run, calls } = runner('verified');
    const ws = workspace(REGISTERED);
    mkdirSync(join(ws, 'apps', 'payments'), { recursive: true });
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={ws} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    stdin.write('2'); await settle();
    stdin.write('\r'); await settle(); // aws-demo
    expect(lastFrame()).toContain('Application landing zone (ALZ)');
    expect(lastFrame()).not.toMatch(/Platform landing zone \(PLZ\)\s{2,}The provider/);
    stdin.write('\r'); await settle(); // application
    stdin.write('\r'); await settle(); // session-keys
    stdin.write('\r'); await settle(); // no regions
    await type(stdin, 'account=123456789012'); stdin.write('\r'); await settle();
    // #4458: the row shows the id and the type (no name in this fixture).
    expect(lastFrame()).toMatch(/payments\s+application/);
    stdin.write('\u001B[B'); await settle(); // payments
    stdin.write('\r'); await settle();
    // #4229: the scope id is proposed from the linked app and only confirmed.
    expect(lastFrame()).toContain('payments');
    expect(lastFrame()).toContain('Short name for this scope');
    stdin.write('\r'); await settle();
    await type(stdin, 'akid'); stdin.write('\r'); await settle();
    await type(stdin, SECRET); stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(); // session-token skipped
    stdin.write('\r'); await settle(); // expires-at skipped
    stdin.write('\r'); await settle(200);
    expect(calls[0]?.args).toEqual(['lz', 'connect', 'aws-demo', '--provider', 'aws', '--scope', 'payments', '--kind', 'application', '--auth', 'session-keys', '--target', 'account=123456789012', '--app', 'payments', '--credentials-stdin', '--no-probe']);
    expect(calls[0]?.stdin).toBe(`access-key-id=akid\nsecret-access-key=${SECRET}\n`);
  });

  it('Migrate legacy LZR credentials appears only with legacy keys and moves them to a registered scope', async () => {
    const { run, calls } = runner('verified');
    const store = new CredentialStore(dir('swao-lzc-vault-'));
    await store.importAll({ 'aws-access-key-id': 'x', 'aws-secret-access-key': 'y' }, 'merge');
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED_WITH_TARGET)} run={run} store={store} drivers={DRIVERS} />);
    await settle(200);
    expect(lastFrame()).toContain('Legacy LZR credentials in the vault: 2 AWS');
    expect(lastFrame()).toMatch(/4\.?\s+Migrate legacy LZR credentials/);
    stdin.write('4'); await settle();
    expect(lastFrame()).toContain('aws-demo / platform');
    stdin.write('\r'); await settle(200);
    expect(calls[0]?.args).toEqual(['lz', 'connect', 'aws-demo', '--provider', 'aws', '--scope', 'platform', '--kind', 'platform', '--auth', 'session-keys', '--region', 'eu-central-1', '--target', 'account=123456789012', '--app', 'payments', '--move-legacy-credentials', '--no-probe']);
    expect(lastFrame()).toContain('Legacy AWS, Amazon Web Services credentials moved to scope platform of aws-demo.');
    expect(lastFrame()).not.toContain('lz:aws-demo');
  });

  it('Remove asks for confirmation on a ConfirmPanel; Esc goes back, Enter runs lz remove', async () => {
    const { run, calls } = runner('verified');
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED)} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    stdin.write('4'); await settle(); // #4299: numbered 1 to 4 (the migrate item is hidden), no gap
    stdin.write('\r'); await settle(); // aws-demo
    stdin.write('\u001B[B'); await settle(); // scope platform
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Remove scope platform of aws-demo?');
    stdin.write('\u001B'); await settle();
    expect(calls).toHaveLength(0);
    expect(lastFrame()).toContain('Remove from landing zone aws-demo');
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(200);
    expect(calls[0]?.args).toEqual(['lz', 'remove', 'aws-demo', '--scope', 'platform']);
  });

  it('with no driver in the build, Add landing zone explains the Q-21 gate', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={[]} />);
    await settle(150);
    stdin.write('1'); await settle();
    expect(lastFrame()).toContain('No live landing zone driver in this build');
  });

  it('Esc on the list calls onBack', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<LzConnectionsScreen onBack={onBack} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(150);
    stdin.write('\u001B'); await settle();
    expect(onBack).toHaveBeenCalled();
  });
});

describe('LzConnectionsStep (Setup Wizard step, #3589, #4297)', () => {
  it('Open is first and preselected, Skip second; no "(optional)"; the subtitle names the SWAO credential vault', async () => {
    const onNext = vi.fn();
    const { lastFrame } = render(<LzConnectionsStep workspace={workspace()} onNext={onNext} />);
    await settle(100);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Landing Zone Connections');
    expect(frame).not.toContain('(optional)');
    expect(frame.indexOf('Open Landing Zone Connections')).toBeLessThan(frame.indexOf('Skip (add a live landing zone later in this setup)'));
    expect(frame.replace(/\s+/g, ' ')).toContain('Credentials are stored in the SWAO credential vault, never in .swao.yml.');
    expect(frame).toContain('T Cloud Public');
    // The CLI line moved into the guidance box; the key hints come from KEY_HINTS, not a hand-written footer.
    expect(frame).not.toContain('CLI: swao lz connect');
    expect(frame).not.toContain('1-2 or Up/Down');
    expect(LZ_CONNECTIONS_STEP_CHOICES.map((c) => c.id)).toEqual(['open', 'skip']);
  });

  it('Skip (second option) continues without opening the screen', async () => {
    const onNext = vi.fn();
    const { stdin } = render(<LzConnectionsStep workspace={workspace()} onNext={onNext} />);
    await settle(100);
    stdin.write('\u001B[B'); await settle();
    stdin.write('\r'); await settle();
    expect(onNext).toHaveBeenCalledWith(false);
  });

  it('the guidance box follows the highlighted option (one entry per option)', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsStep workspace={workspace()} onNext={vi.fn()} />);
    await settle(100);
    stdin.write('\x07'); await settle();
    const open = (lastFrame() ?? '').replace(/[│\s]+/g, ' ');
    expect(open).toContain('Open Landing Zone Connections');
    expect(open).toContain('SWAO credential vault');
    expect(open).toContain('CLI: swao lz connect / probe / list / remove');
    stdin.write('\u001B[B'); await settle();
    const skip = (lastFrame() ?? '').replace(/[│\s]+/g, ' ');
    expect(skip).toContain(LZ_CONNECTIONS_STEP_GUIDANCE.skip.what.slice(0, 40));
    expect(LZ_CONNECTIONS_STEP_GUIDANCE.open.what).not.toBe(LZ_CONNECTIONS_STEP_GUIDANCE.skip.what);
  });

  for (const columns of [100, 80]) {
    it(`fits ${columns} columns`, async () => {
      const r = renderAt(<LzConnectionsStep workspace={workspace()} onNext={vi.fn()} />, columns, 40);
      await settle(100);
      expect(r.lastFrame()).toContain('Open Landing Zone Connections');
      expect(widest(r.lines())).toBeLessThanOrEqual(columns);
      r.unmount();
    });
  }

  it('Open shows the embedded screen; its list leaves Esc to the wizard, a form captures it, Continue the setup continues', async () => {
    const onNext = vi.fn();
    const onOpenChange = vi.fn();
    const { lastFrame, stdin } = render(<LzConnectionsStep workspace={workspace()} onNext={onNext} onOpenChange={onOpenChange} screen={{ run: runner().run, store: new CredentialStore(dir('swao-lzc-vault-')), drivers: DRIVERS }} />);
    await settle(100);
    stdin.write('\r'); await settle(150); // Open (preselected)
    expect(lastFrame()).toContain('Continue the setup');
    expect(lastFrame()).not.toContain('optional step');
    expect(onOpenChange).toHaveBeenLastCalledWith(false); // the list: Esc is the wizard's
    stdin.write('\u001B'); await settle();
    expect(onNext).not.toHaveBeenCalled();
    stdin.write('1'); await settle();
    expect(onOpenChange).toHaveBeenLastCalledWith(true); // a form: Esc cancels to the list
    stdin.write('\u001B'); await settle();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    stdin.write('5'); await settle();
    expect(onNext).toHaveBeenCalledWith(true);
  });
});


// #4111 / #4299: embedded in the Setup wizard the screen draws no header of its
// own, keeps every menu item on every frame (with the reason when it needs a
// landing zone), numbers the menu 1 to n without gaps and ends with "Continue
// the setup"; the guidance box follows the highlighted item and navigation
// works while it is open.
describe('LzConnectionsScreen menu and guidance (#4111, #4299)', () => {
  const ITEMS = ['Add landing zone', 'Add scope: Platform (PLZ) or Application landing zone (ALZ)', 'Probe read-only access and coverage', 'Remove scope or landing zone', 'Continue the setup'];
  const bars = (f: string): number => f.split('\n').filter((l) => /^\s*={20,}\s*$/.test(l)).length;
  const HEADER_WIDTH = 100; // ink-testing-library columns; HeaderView caps the rule at 100

  function assertIntact(frame: string): void {
    expect(bars(frame)).toBe(0);
    ITEMS.forEach((t, i) => expect(frame).toMatch(new RegExp(`${i + 1}\\.?\\s+${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)));
    expect(frame).not.toMatch(/\b0\s+(Continue|Back)/);
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(HEADER_WIDTH);
  }

  it('one header: the embedded screen draws none, the standalone screen draws one and has no Continue item', async () => {
    const standalone = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(150);
    expect(bars(standalone.lastFrame() ?? '')).toBeGreaterThan(0);
    expect(standalone.lastFrame()).not.toContain('Continue the setup');
    expect(standalone.lastFrame()).toContain('Esc back');
    const embedded = render(<LzConnectionsScreen embedded onBack={vi.fn()} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(150);
    expect(bars(embedded.lastFrame() ?? '')).toBe(0);
  });

  it('menu 1 to 5 without gaps, no 0 item; a selection and back keep every item intact', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsScreen embedded onBack={vi.fn()} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(150);
    assertIntact(lastFrame() ?? '');
    expect(lastFrame()).toContain('needs a landing zone first');
    stdin.write('\u001B[B'); await settle();
    assertIntact(lastFrame() ?? '');
    stdin.write('1'); await settle();
    expect(lastFrame()).toContain('Provider of the landing zone');
    stdin.write('\u001B'); await settle(); // back to the list
    assertIntact(lastFrame() ?? '');
  });

  it('the list rows name the scope kind (PLZ, ALZ)', async () => {
    const { lastFrame } = render(<LzConnectionsScreen embedded onBack={vi.fn()} workspace={workspace(REGISTERED)} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    expect(lastFrame()).not.toContain('needs a landing zone');
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('platform Platform landing zone (PLZ), auth session-keys');
  });

  it('embedded in the Setup Wizard (the owner path): the guidance follows the item and the arrows work with it open', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsScreen embedded onBack={vi.fn()} workspace={workspace(REGISTERED)} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    stdin.write('\x07'); await settle();
    const flat = (): string => (lastFrame() ?? '').replace(/[│\s]+/g, ' ');
    expect(flat()).toContain(LZ_CONNECTIONS_ACTION_GUIDANCE['add-lz'].what.slice(0, 50));
    stdin.write('\u001B[B'); await settle();
    stdin.write('\u001B[B'); await settle();
    expect(flat()).toContain(LZ_CONNECTIONS_ACTION_GUIDANCE.probe.what.slice(0, 50));
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Landing zone:');
  });

  it('the guidance follows the highlighted item and the arrows keep working with the guidance open', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED)} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    stdin.write('\x07'); await settle();
    const flat = (): string => (lastFrame() ?? '').replace(/[│\s]+/g, ' ');
    expect(flat()).toContain(LZ_CONNECTIONS_ACTION_GUIDANCE['add-lz'].what.slice(0, 50));
    stdin.write('\u001B[B'); await settle();
    expect(flat()).toContain('PLZ: Platform landing zone');
    expect(flat()).toContain('ALZ: Application landing zone');
    stdin.write('\u001B[B'); await settle();
    expect(flat()).toContain(LZ_CONNECTIONS_ACTION_GUIDANCE.probe.what.slice(0, 50));
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Landing zone:'); // Enter opened Probe with the box open
  });

  it('#4459: a registration whose session token has expired is a warning, not a green success, and no probe runs', async () => {
    const calls: Call[] = [];
    const run: ConnectionsCliRunner = async (args, onLine, stdinText) => {
      calls.push({ args, ...(stdinText !== undefined ? { stdin: stdinText } : {}) });
      onLine('landing zone aws-demo, scope payments: scope added in .swao.yml');
      onLine(lzExpiredSessionLine('2020-01-01T00:00:00+00:00'));
      return 0;
    };
    const ws = workspace(REGISTERED);
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={ws} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(200);
    stdin.write('2'); await settle();
    stdin.write('\r'); await settle(); // aws-demo
    stdin.write('\r'); await settle(); // application
    stdin.write('\r'); await settle(); // session-keys
    stdin.write('\r'); await settle(); // no regions
    await type(stdin, 'account=123456789012'); stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(); // no app link
    stdin.write('\r'); await settle(); // scope id
    await type(stdin, 'akid'); stdin.write('\r'); await settle();
    await type(stdin, SECRET); stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(); // session-token skipped
    stdin.write('\r'); await settle(); // expires-at skipped
    stdin.write('\r'); await settle(200);
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('but the session token expired at 2020-01-01T00:00:00+00:00; refresh it before a run (Refresh the AWS SSO session in the menu).');
    expect(calls.map((c) => c.args[1])).toEqual(['connect']); // no probe of the expired token
    expect(frame).not.toContain(SECRET);
  });

  describe('#4459: Refresh the AWS SSO session', () => {
    const PROFILES = [
      { name: 'ro-a', startUrl: 'https://a.example/start', ssoRegion: 'eu-west-1', accountId: '111122223333', roleName: 'ReadOnly' },
      { name: 'ro-b', startUrl: 'https://a.example/start', ssoRegion: 'eu-west-1', accountId: '111122223333', roleName: 'SecurityAudit' },
    ];

    it('scope, profile, then the URL and code while the sign-in waits; the result names the profile; argv is the CLI command', async () => {
      const calls: Call[] = [];
      let finish: (code: number) => void = () => {};
      const run: ConnectionsCliRunner = (args, onLine) => {
        calls.push({ args });
        onLine('AWS SSO sign-in for aws-demo / platform: open this URL in a browser and confirm the code (the code expires in 10 min):');
        onLine('https://device.sso.example/?user_code=WXYZ-1234');
        onLine('code: WXYZ-1234');
        return new Promise<number>((r) => { finish = r; });
      };
      const ws = workspace(REGISTERED);
      const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={ws} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} ssoProfiles={() => PROFILES} />);
      await settle(200);
      expect(lastFrame()).toContain('Refresh the AWS SSO session');
      stdin.write('5'); await settle();
      expect(lastFrame()).toContain('Scope to refresh');
      expect(lastFrame()).toContain('aws-demo / platform');
      stdin.write('\r'); await settle();
      expect(lastFrame()).toContain('AWS profile for the sign-in');
      expect(lastFrame()).toContain('role SecurityAudit');
      expect(lastFrame()).not.toContain('111122223333');
      stdin.write('\u001B[B'); await settle(); // ro-b
      stdin.write('\r'); await settle(100);
      const waiting = (lastFrame() ?? '').replace(/\s+/g, ' ');
      expect(waiting).toContain('open this URL in a browser and confirm the code');
      // #4496: the URL on a line of its own, whole, without frame characters, and not in the guidance box.
      const urlLines = (lastFrame() ?? '').split('\n').filter((l) => l.includes('user_code=WXYZ-1234'));
      expect(urlLines).toHaveLength(1);
      expect(urlLines[0]!.trim()).toBe('https://device.sso.example/?user_code=WXYZ-1234');
      expect(waiting).toContain('code: WXYZ-1234');
      expect(calls[0]?.args).toEqual(['lz', 'credentials', 'refresh', 'aws-demo', 'platform', '--profile', 'ro-b']);
      finish(0); await settle(100);
      // #4496: a profile the scope does not name yet: the question, Yes (Enter) stores aws_profile.
      expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('Use ro-b for this scope from now on?');
      stdin.write('\r'); await settle(100);
      const result = (lastFrame() ?? '').replace(/\s+/g, ' ');
      expect(result).toContain('AWS SSO session of aws-demo / platform refreshed with the profile ro-b');
      expect(result).toContain('stored as aws_profile of aws-demo / platform');
      expect(result).not.toContain('user_code=');
      expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toMatch(/aws_profile: ro-b/);
    });

    it('Esc while the sign-in waits stops the command; nothing is stored', async () => {
      let signalSeen: AbortSignal | undefined;
      const run: ConnectionsCliRunner = (_args, onLine, _stdin, signal) => {
        signalSeen = signal;
        onLine('  and confirm the code WXYZ-1234 (the code expires in 10 min)');
        return new Promise<number>((r) => { signal?.addEventListener('abort', () => r(1)); });
      };
      const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED)} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} ssoProfiles={() => PROFILES.slice(0, 1)} />);
      await settle(200);
      stdin.write('5'); await settle();
      stdin.write('\r'); await settle(100); // one profile: straight to the sign-in
      expect(lastFrame()).toContain('confirm the code WXYZ-1234');
      stdin.write('\u001B'); await settle(150);
      expect(signalSeen?.aborted).toBe(true);
      expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('stopped before the sign-in; nothing was stored');
    });

    it('without an SSO profile the result says how to add one, and no command runs', async () => {
      const calls: Call[] = [];
      const run: ConnectionsCliRunner = async (args) => { calls.push({ args }); return 0; };
      const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED)} run={run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} ssoProfiles={() => []} />);
      await settle(200);
      stdin.write('5'); await settle();
      stdin.write('\r'); await settle(100);
      const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
      expect(frame).toContain('No AWS SSO profile for the account of this scope found in the AWS config file. Add one with aws configure sso');
      expect(frame).toContain('swao lz credentials refresh aws-demo platform --profile <aws-profile>');
      expect(calls).toEqual([]);
    });
  });

  it('#4458: the app link rows show id, name and type at 80 columns, applications first; the filter matches the name', async () => {
    const ws = workspace(REGISTERED);
    const app = (id: string, yml: string | null): void => {
      mkdirSync(join(ws, 'apps', id), { recursive: true });
      if (yml !== null) writeFileSync(join(ws, 'apps', id, '.swao.yml'), yml);
    };
    app('app0034', ['app_id: app0034', 'app_name: Demo Antivirus', 'assessment:', '  type: service', ''].join('\n'));
    app('app0039', ['app_id: app0039', 'assessment:', '  type: service', ''].join('\n'));
    app('zeta-portal', ['app:', '  id: zeta-portal', '  name: "Demo Portal"', ''].join('\n'));
    for (let i = 0; i < 8; i++) app(`svc${i}`, ['assessment:', '  type: service', ''].join('\n'));
    const r = renderAt(<LzConnectionsScreen onBack={vi.fn()} workspace={ws} run={runner('verified').run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />, 80, 50);
    await settle(200);
    r.stdin.write('2'); await settle();
    r.stdin.write('\r'); await settle(); // aws-demo
    r.stdin.write('\r'); await settle(); // application
    r.stdin.write('\r'); await settle(); // session-keys
    r.stdin.write('\r'); await settle(); // no regions
    await type(r.stdin, 'account=123456789012'); r.stdin.write('\r'); await settle();
    const lines = r.lines();
    expect(r.lastFrame()).toContain('Link the scope to an app (optional)');
    expect(lines.find((l) => l.includes('app0034'))).toMatch(/app0034\s+Demo Antivirus\s+service/);
    expect(lines.find((l) => l.includes('app0039'))).toMatch(/app0039\s+service/);
    const portal = lines.findIndex((l) => l.includes('zeta-portal'));
    expect(lines[portal]).toMatch(/zeta-portal\s+Demo Portal\s+application/);
    expect(portal).toBeLessThan(lines.findIndex((l) => l.includes('app0034'))); // applications first
    expect(widest(lines)).toBeLessThanOrEqual(80);
    await type(r.stdin, 'antivirus');
    const filtered = r.lastFrame() ?? '';
    expect(filtered).toContain('app0034');
    expect(filtered).not.toContain('app0039');
    expect(filtered).not.toContain('zeta-portal');
    r.unmount();
  });

  for (const columns of [100, 80]) {
    it(`fits ${columns} columns (list, kind sub-step and confirm)`, async () => {
      const r = renderAt(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace(REGISTERED)} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />, columns, 50);
      await settle(200);
      expect(widest(r.lines())).toBeLessThanOrEqual(columns);
      r.stdin.write('2'); await settle();
      r.stdin.write('\r'); await settle(); // aws-demo
      expect(r.lastFrame()).toContain('Application landing zone (ALZ)');
      expect(widest(r.lines())).toBeLessThanOrEqual(columns);
      r.unmount();
    });
  }

  it('Ctrl+G on the screen guidance shows every section in full (paged), never "(N more sections)"', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsScreen embedded onBack={vi.fn()} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={DRIVERS} />);
    await settle(150);
    // The screen guidance is the fallback of an item without its own entry; it lists every section.
    expect(LZ_CONNECTIONS_GUIDANCE.map((d) => d.label)).toContain('Credentials');
    stdin.write('\x07'); await settle();
    expect((lastFrame() ?? '').replace(/[│\s]+/g, ' ')).not.toMatch(/more sections/);
  });
});

describe('actionDisabledReason (#4111)', () => {
  it('needs-a-landing-zone actions carry a reason only while none is registered', () => {
    for (const id of ['add-scope', 'probe', 'remove'] as const) {
      expect(actionDisabledReason(id, 0)).toMatch(/needs a landing zone/);
      expect(actionDisabledReason(id, 1)).toBeNull();
    }
    expect(actionDisabledReason('add-lz', 0)).toBeNull();
    expect(actionDisabledReason('migrate', 0)).toBeNull();
  });
});

describe('LzConnectionsScreen stored credentials (#4232) and provider brand (#4234)', () => {
  async function addOtcScope(store: CredentialStore, run: ConnectionsCliRunner) {
    const r = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={run} store={store} drivers={DRIVERS} />);
    await settle(150);
    r.stdin.write('1'); await settle();
    r.stdin.write('\r'); await settle(); // otc
    r.stdin.write('\r'); await settle(); // otc-prod
    r.stdin.write('\r'); await settle(); // display T Cloud Public
    r.stdin.write('\r'); await settle(); // kind platform
    r.stdin.write('\r'); await settle(); // auth iam-password-token
    r.stdin.write('\r'); await settle(); // no regions
    r.stdin.write('\r'); await settle(); // no locator
    r.stdin.write('\r'); await settle(); // no app link
    r.stdin.write('\r'); await settle(); // scope id platform (#4229: proposed, asked after the app link)
    return r;
  }

  it('offers the stored set of the same provider and auth method by name; confirming it runs lz connect --credentials-from without stdin', async () => {
    const store = new CredentialStore(dir('swao-lzc-vault-'));
    await store.set('lz:otc-test:platform:username', 'operator');
    await store.set('lz:otc-test:platform:password', SECRET);
    await store.set('lz:otc-test:platform:domain', 'tenant-domain');
    const { run, calls } = runner('verified');
    const { lastFrame, stdin } = await addOtcScope(store, run);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Use the stored credentials of otc-test / platform');
    expect(frame).toContain('Enter new credentials');
    expect(frame).toContain('per user');
    expect(frame).not.toContain(SECRET);
    expect(frame).not.toContain('operator');
    // #4299: the guidance follows the stored-credential option; vault key names only there.
    expect(frame).toContain('Stored credentials of otc-test / platform');
    stdin.write('\u001B[B'); await settle();
    expect(lastFrame()).toMatch(/Enter new credentials\s+\(Ctrl\+G/);
    stdin.write('\u001B[A'); await settle();
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('the stored set of otc-test / platform, copied to this scope');
    stdin.write('\r'); await settle(200);
    expect(calls[0]?.args).toEqual(['lz', 'connect', 'otc-prod', '--provider', 'otc', '--scope', 'platform', '--kind', 'platform', '--auth', 'iam-password-token', '--display', 'T Cloud Public', '--credentials-from', 'otc-test:platform', '--no-probe']);
    expect(calls[0]?.stdin).toBeUndefined();
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('registered with the stored credentials of otc-test / platform');
  });

  it('Enter new credentials goes to the masked inputs; a set of another provider is never offered', async () => {
    const store = new CredentialStore(dir('swao-lzc-vault-'));
    await store.set('lz:aws-dev:platform:access-key-id', 'akid');
    await store.set('lz:aws-dev:platform:secret-access-key', SECRET);
    const { run } = runner('verified');
    const { lastFrame } = await addOtcScope(store, run);
    expect(lastFrame()).not.toContain('Use the stored credentials');
    expect(lastFrame()).toContain('Credential 1 of 3');
    const store2 = new CredentialStore(dir('swao-lzc-vault-'));
    await store2.set('lz:otc-test:platform:username', 'operator');
    await store2.set('lz:otc-test:platform:password', SECRET);
    await store2.set('lz:otc-test:platform:domain', 'tenant-domain');
    const r2 = await addOtcScope(store2, runner('verified').run);
    r2.stdin.write('\u001B[B'); await settle();
    r2.stdin.write('\r'); await settle();
    expect(r2.lastFrame()).toContain('Credential 1 of 3');
  });

  it('no operator-facing source string names the provider "Open Telecom Cloud", or "Open Telekom Cloud" without "formerly" (#4234)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', 'dist', '__tests__', '.git'].includes(e.name)) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
        readFileSync(p, 'utf-8').split('\n').forEach((l, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comments are not operator-facing
          if (/Open Telecom Cloud/i.test(l) || (/Open Telekom Cloud/i.test(l) && !/former/i.test(l))) hits.push(`${p}:${i + 1}`);
        });
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

describe('LzConnectionsScreen guidance per sub-step and per highlighted row (#4230, run 8)', () => {
  const OTC_TWO: ConnectionDriverInfo[] = [
    { provider: 'otc', authMethods: [
      { id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [], unattended: true },
      { id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'], unattended: true },
    ] },
    DRIVERS[1]!,
  ];
  const flat = (f: string | undefined): string => (f ?? '').replace(/[│\s]+/g, ' ');

  it('with the box open: provider, scope kind and auth method follow the cursor; the arrows move the selection', async () => {
    const { lastFrame, stdin } = render(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={runner().run} store={new CredentialStore(dir('swao-lzc-vault-'))} drivers={OTC_TWO} />);
    await settle(200);
    stdin.write('1'); await settle();
    stdin.write('\x07'); await settle(); // open the box on the provider sub-step
    expect(flat(lastFrame())).toContain('Auth methods: iam-password-token, aksk');
    stdin.write('\u001B[B'); await settle();
    expect(flat(lastFrame())).toContain('Auth methods: session-keys');
    stdin.write('\u001B[A'); await settle();
    stdin.write('\r'); await settle(); // otc
    stdin.write('\r'); await settle(); // id
    stdin.write('\r'); await settle(); // display name
    expect(flat(lastFrame())).toContain('Platform landing zone (PLZ)');
    expect(flat(lastFrame())).toContain('organisation policies, IAM structure');
    stdin.write('\u001B[B'); await settle();
    expect(flat(lastFrame())).toContain('that project or account, but in depth');
    expect(flat(lastFrame())).not.toContain('organisation policies, IAM structure');
    stdin.write('\u001B[A'); await settle();
    stdin.write('\r'); await settle(); // platform
    expect(flat(lastFrame())).toContain('Auth method iam-password-token');
    expect(flat(lastFrame())).toContain('user name, password and domain name');
    stdin.write('\u001B[B'); await settle();
    expect(flat(lastFrame())).toContain('Auth method aksk');
    expect(flat(lastFrame())).toContain('access key and secret key (AK/SK)');
    stdin.write('\r'); await settle(); // aksk chosen with the box open
    // #4494: the catalogue knows the OTC regions: the grouped picker, not a free-text list.
    expect(flat(lastFrame())).toContain('Germany (DE)');
    expect(flat(lastFrame())).toContain('Enter without a tick keeps all regions');
    expect(flat(lastFrame())).toContain('eu-de, eu-nl');
    stdin.write('\r'); await settle(); // all regions
    expect(flat(lastFrame())).toContain('project=eu-de_payments');
    expect(flat(lastFrame())).toContain('Leave it empty');
    stdin.write('\r'); await settle(); // no locator
    expect(flat(lastFrame())).toContain('No app link');
  });
});
