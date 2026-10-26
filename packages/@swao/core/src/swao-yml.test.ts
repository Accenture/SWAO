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

// #3404: source.vcs keys that assess.ts reads from the PARSED .swao.yml must
// survive SwaoYmlSchema. Before the fix the plain z.object stripped `subdir`
// (so passes scanned the whole repo) and the #2749 proxy / TLS keys.

import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { SwaoYmlSchema, SwaoYmlVcsSchema, SwaoYmlContextSchema } from './swao-yml.js';

const CLIENT_APP_YAML = `
source:
  path: wsp/inputs/source/
  vcs:
    type: github
    url: https://github.com/example-org/acme-orders-api
    ref: main
    subdir: src
    token_scheme: x-access-token
    git_proxy: http://proxy.example:8080
    ssl_verify: false
`;

describe('SwaoYmlSchema source.vcs (#3404)', () => {
  it('keeps vcs.subdir after parsing', () => {
    const r = SwaoYmlSchema.safeParse(load(CLIENT_APP_YAML));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.source?.vcs?.subdir).toBe('src');
    expect(r.data.source?.vcs?.type).toBe('github');
    expect(r.data.source?.vcs?.ref).toBe('main');
  });

  it('passes through the clone keys read by cloneIfNeeded (token_scheme, git_proxy, ssl_verify)', () => {
    const r = SwaoYmlSchema.safeParse(load(CLIENT_APP_YAML));
    expect(r.success).toBe(true);
    if (!r.success) return;
    const vcs = r.data.source?.vcs as Record<string, unknown> | undefined;
    expect(vcs?.['token_scheme']).toBe('x-access-token');
    expect(vcs?.['git_proxy']).toBe('http://proxy.example:8080');
    expect(vcs?.['ssl_verify']).toBe(false);
  });

  it('rejects a non-string subdir', () => {
    expect(SwaoYmlVcsSchema.safeParse({ subdir: 42 }).success).toBe(false);
  });

  it('still accepts a vcs block without subdir', () => {
    const r = SwaoYmlVcsSchema.safeParse({ type: 'github', url: 'https://github.com/a/b' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.subdir).toBeUndefined();
  });
});

// #3439: optional clone deadline in minutes; the clone helper defaults to 10.
describe('SwaoYmlVcsSchema clone_timeout_minutes (#3439)', () => {
  it('is optional (absent leaves the field undefined)', () => {
    const r = SwaoYmlVcsSchema.safeParse({ url: 'https://github.com/a/b' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.clone_timeout_minutes).toBeUndefined();
  });

  it.each([1, 10, 30, 240])('accepts %i', (m) => {
    const r = SwaoYmlVcsSchema.safeParse({ clone_timeout_minutes: m });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.clone_timeout_minutes).toBe(m);
  });

  it.each([0, -5, 241, 1000, 2.5, '30'])('rejects %j', (m) => {
    expect(SwaoYmlVcsSchema.safeParse({ clone_timeout_minutes: m }).success).toBe(false);
  });

  it('is validated through the full app .swao.yml', () => {
    const ok = SwaoYmlSchema.safeParse(load(`${CLIENT_APP_YAML}    clone_timeout_minutes: 45\n`));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.source?.vcs?.clone_timeout_minutes).toBe(45);
    expect(SwaoYmlSchema.safeParse(load(`${CLIENT_APP_YAML}    clone_timeout_minutes: 600\n`)).success).toBe(false);
  });
});

// #3429: context.infra_roles declares current vs target infrastructure inputs.
// Before the fix SwaoYmlContextSchema (plain z.object) stripped the key.
const INFRA_ROLES_YAML = `
context:
  allocations:
    ctx: 40000
  infra_roles:
    - path: terraform/legacy-ocp-export.json
      role: current
    - path: terraform/lz-*-snapshot.json
      role: target
`;

describe('SwaoYmlSchema context.infra_roles (#3429)', () => {
  it('parses and preserves infra_roles entries in order', () => {
    const r = SwaoYmlSchema.safeParse(load(INFRA_ROLES_YAML));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.context?.infra_roles).toEqual([
      { path: 'terraform/legacy-ocp-export.json', role: 'current' },
      { path: 'terraform/lz-*-snapshot.json', role: 'target' },
    ]);
    expect(r.data.context?.allocations).toEqual({ ctx: 40000 });
  });

  it('rejects an unknown role', () => {
    expect(SwaoYmlContextSchema.safeParse({ infra_roles: [{ path: 'x.json', role: 'future' }] }).success).toBe(false);
  });

  it('rejects an entry without a path', () => {
    expect(SwaoYmlContextSchema.safeParse({ infra_roles: [{ role: 'target' }] }).success).toBe(false);
  });

  it('keeps a context block without infra_roles valid (backward compatible)', () => {
    const r = SwaoYmlContextSchema.safeParse({ categories: { terraform: 0.5 } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.infra_roles).toBeUndefined();
  });
});
