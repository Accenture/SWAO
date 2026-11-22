// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4192 SET-03 (Design 125 sections 5.2, 8 and 9): Source access. Outcomes of
// the vcs_auth probe in plain words without CLI syntax; the non-interactive
// check needs no network; a token entered in the step lands in the vault
// under the provider-scoped key the probe and the clone read.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, credentialEnvVarName } from '@swao/core';
import { createApplicationApp } from './application-app.js';
import { checkApplicationSource, hasCredentialKey, storeVcsToken, vcsOutcomeView, type VcsOutcome } from './application-source.js';
import { buildVcsAuthProbe } from '../health-check/vcs-auth-probe.js';

const OUTCOMES: VcsOutcome[] = ['ok', 'public', 'auth-failed', 'not-found', 'network-unreachable', 'no-token', 'no-vcs-config', 'skip-non-https', 'skip-fixture-host', 'skip-deadline'];

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }

function ws(): string {
  const root = tmp('swao-4192-src-');
  writeFileSync(join(root, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
  return root;
}

describe('vcsOutcomeView (#4192)', () => {
  it('covers every probe outcome with short text and no CLI syntax (Design 125 section 9)', () => {
    for (const o of OUTCOMES) {
      const v = vcsOutcomeView(o);
      expect(v.text.length).toBeGreaterThan(0);
      expect(v.text.length).toBeLessThanOrEqual(40);
      for (const s of [v.text, v.help]) {
        expect(s).not.toMatch(/--|\bswao\s|`/);
      }
    }
    expect(vcsOutcomeView('no-token')).toMatchObject({ state: 'missing', tokenFixes: true });
    // #4222: a public repository is ok and offers no token entry.
    expect(vcsOutcomeView('public')).toMatchObject({ text: 'public, no token needed', state: 'ok', tokenFixes: false });
    expect(vcsOutcomeView('ok')).toMatchObject({ state: 'ok', tokenFixes: false });
    expect(vcsOutcomeView('no-vcs-config').state).toBe('info');
  });
});

describe('checkApplicationSource (#4192, non-interactive, no network)', () => {
  it('reports local apps ok and repository apps by token presence in vault or environment', () => {
    const root = ws();
    createApplicationApp(root, { appId: 'gh', source: { kind: 'repository', url: 'https://github.com/o/r' } });
    createApplicationApp(root, { appId: 'gl', source: { kind: 'repository', url: 'https://gitlab.com/o/r' } });
    createApplicationApp(root, { appId: 'later', source: { kind: 'later' } });
    const items = checkApplicationSource(root, { 'provider:github:token': 'x' }, {});
    // #4282 (D-8): no token is a warning (a public repository needs none; the
    // health check tests access); an empty source folder says when the clone happens.
    expect(items).toEqual([
      { label: 'Source gh', state: 'ok', detail: 'token in the vault' },
      { label: 'Clone gh', state: 'info', detail: 'wsp/inputs/source/ is empty; SWAO clones the repository at the first assessment', short: 'cloned at the first assessment' },
      // #4222: no token is information (a public repository needs none); the health check tries anonymous access.
      { label: 'Source gl', state: 'info', detail: 'no token stored; public repositories need none (the health check tries anonymous access)', short: 'no token stored' },
      { label: 'Clone gl', state: 'info', detail: 'wsp/inputs/source/ is empty; SWAO clones the repository at the first assessment', short: 'cloned at the first assessment' },
      { label: 'Source later', state: 'ok', detail: 'local source' },
    ]);
    expect(items.some((i) => i.state === 'missing')).toBe(false);
    // Once the source is there, the clone line goes away.
    mkdirSync(join(root, 'apps', 'gh', 'wsp', 'inputs', 'source'), { recursive: true });
    writeFileSync(join(root, 'apps', 'gh', 'wsp', 'inputs', 'source', 'main.ts'), 'x');
    expect(checkApplicationSource(root, { 'provider:github:token': 'x' }, {}).map((i) => i.label)).not.toContain('Clone gh');
    const env = { [credentialEnvVarName('provider:gitlab:token')]: 'y' };
    expect(checkApplicationSource(root, {}, env).find((i) => i.label === 'Source gl')).toMatchObject({ state: 'ok' });
    expect(hasCredentialKey('provider:gitlab:token', {}, env)).toBe(true);
  });

  it('says there is no app yet in an empty workspace', () => {
    expect(checkApplicationSource(ws(), {}, {})).toEqual([{ label: 'Source access', state: 'info', detail: 'No app yet' }]);
  });
});

describe('storeVcsToken (#4192)', () => {
  it('stores under the provider-scoped key the vcs_auth probe reads', async () => {
    const root = ws();
    createApplicationApp(root, { appId: 'fx', source: { kind: 'repository', url: 'https://git.example/o/r' } });
    const store = new CredentialStore(tmp('swao-4192-vault-'));
    const key = await storeVcsToken(store, 'https://github.com/o/r', '  tok-123  ');
    expect(key).toBe('provider:github:token');
    expect(await store.get(key)).toBe('tok-123');
    await expect(storeVcsToken(store, 'https://github.com/o/r', '   ')).rejects.toThrow(/empty token/);
    // The probe never contacts the reserved example host (fixture), so this runs offline.
    const probe = await buildVcsAuthProbe(root, store);
    expect(probe.apps.map((a) => [a.app_id, a.outcome])).toEqual([['fx', 'skip-fixture-host']]);
  });
});
