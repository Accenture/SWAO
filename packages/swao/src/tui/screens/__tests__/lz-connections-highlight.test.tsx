// #4299 (Design 126 section 5): the highlighted row of the Landing Zone
// Connections menu and of its sub-step pickers is drawn in the selection
// colour, like every other menu. Colours are forced on for this file only
// (FORCE_COLOR before Ink loads), so the frame carries the colour codes.
import { vi, describe, it, expect, afterEach } from 'vitest';

vi.hoisted(() => { process.env['FORCE_COLOR'] = '1'; });

import React from 'react';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { LzConnectionsScreen, type ConnectionDriverInfo } from '../LzConnectionsScreen.js';
import { renderAt } from '../../../__tests__/helpers/render-at.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });
const dir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; };
const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

const REGISTERED = ['name: demo', 'landing_zones:', '  - id: aws-demo', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', ''].join('\n');
const DRIVERS: ConnectionDriverInfo[] = [
  { provider: 'otc', authMethods: [{ id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [], unattended: true }] },
  { provider: 'aws', authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: [], unattended: true }] },
];

/** The ANSI code of the selection token (cyanBright). */
const SELECTION = '\x1b[96m';

describe('Landing Zone Connections selection colour (#4299)', () => {
  it('the highlighted menu row and the highlighted picker row use the selection colour; the others do not', async () => {
    const ws = dir('swao-lzc-hl-');
    writeFileSync(join(ws, '.swao.yml'), REGISTERED);
    const r = renderAt(<LzConnectionsScreen onBack={vi.fn()} workspace={ws} run={async () => 0} store={new CredentialStore(dir('swao-lzc-hl-vault-'))} drivers={DRIVERS} />, 100, 40);
    await settle(250);
    r.stdin.write('\u001B[B'); await settle();
    const menu = r.rawFrame().split('\n');
    expect(menu.find((l) => l.includes('Add scope'))).toContain(SELECTION);
    expect(menu.find((l) => l.includes('Add landing zone'))).not.toContain(SELECTION);
    r.stdin.write('\u001B[A'); await settle();
    r.stdin.write('\r'); await settle(); // Add landing zone: provider picker
    r.stdin.write('\u001B[B'); await settle();
    const picker = r.rawFrame().split('\n');
    expect(picker.find((l) => l.includes('Amazon Web Services'))).toContain(SELECTION);
    expect(picker.find((l) => l.includes('T Cloud Public'))).not.toContain(SELECTION);
    r.unmount();
  });
});
