// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3415: detected secret values are masked at source. Pass 03 (LLM data pass)
// with a stub model that echoes a planted password, and Pass 14 Gitleaks
// mapping with a planted Secret/Match. Synthetic values only.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PassContext } from '@swao/core';
import { runDataPass, maskDataSignalSecrets, SECRET_VALUE_PROMPT_RULE } from './pass-03-data.js';
import { mapGitleaksJson } from './pass-14-malware.js';

const PLANTED = 'Zx9-fake-Pw42'; // gitleaks:allow (synthetic #3415 fixture)
const MASKED = 'Zx***(13)';

let tmp: string;
let src: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3415-'));
  src = join(tmp, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'user-auth.ts'), `// test helper\nconst pwd = "${PLANTED}"; // personal_data\n`); // gitleaks:allow
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctxWithLlm(response: string, prompts: string[]): PassContext {
  return {
    workspacePath: tmp,
    sourcePath: src,
    appId: 'test-app',
    iter: 1,
    assessedAt: '2026-10-23',
    llm: { complete: async (p: string) => { prompts.push(p); return response; } },
  } as unknown as PassContext;
}

describe('pass-03 masks detected secrets at source (#3415)', () => {
  it('emits only the masked value when the model echoes the password in derivation and secret_value', async () => {
    const response = JSON.stringify({
      signals: [{
        id: 'DATA-02', source: 'static_analysis', category: 'application', severity: 'high', confidence: 'high',
        derivation: `Hard-coded password ${PLANTED} found in the test helper src/user-auth.ts:2 (DATA-02).`,
        evidence: [`src/user-auth.ts:2 pwd ${PLANTED}`],
        secret_value: PLANTED,
      }],
      assessment: { data_classes: ['credential'], secrets_in_env: true, note: `value ${PLANTED}` },
    });
    const prompts: string[] = [];
    const result = await runDataPass(ctxWithLlm(response, prompts));
    const out = JSON.stringify(result);
    expect(out).not.toContain(PLANTED);
    expect(result.signals[0]!.derivation).toContain(MASKED);
    expect(out).not.toContain('secret_value');
    expect(prompts[0]).toContain(SECRET_VALUE_PROMPT_RULE);
  });

  it('masks a quoted credential value even when the model omits secret_value', async () => {
    const response = JSON.stringify({
      signals: [{
        id: 'DATA-02', source: 'static_analysis', category: 'application', severity: 'high', confidence: 'high',
        derivation: `Hard-coded password '${PLANTED}' in src/user-auth.ts:2 (DATA-02).`,
        evidence: ['src/user-auth.ts:2'],
      }],
      assessment: {},
    });
    const result = await runDataPass(ctxWithLlm(response, []));
    expect(JSON.stringify(result)).not.toContain(PLANTED);
    expect(result.signals[0]!.derivation).toContain(`'${MASKED}'`);
  });

  it('masks a value the model repeats unquoted and without secret_value (taken from the scanned source)', async () => {
    const response = JSON.stringify({
      signals: [{
        id: 'DATA-02', source: 'static_analysis', category: 'application', severity: 'high', confidence: 'high',
        derivation: `The test helper uses the password ${PLANTED} for every login (DATA-02).`,
        evidence: ['src/user-auth.ts:2'],
      }],
      assessment: {},
    });
    const result = await runDataPass(ctxWithLlm(response, []));
    expect(JSON.stringify(result)).not.toContain(PLANTED);
    expect(result.signals[0]!.derivation).toContain(MASKED);
  });

  it('the truncated-response warning never prints the value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await runDataPass(ctxWithLlm(`not json "secret_value": "${PLANTED}" and pwd ${PLANTED}`, []));
      expect(result.pass.status).not.toBe('complete');
      const printed = warn.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(printed).toContain('DATA pass');
      expect(printed).not.toContain(PLANTED);
    } finally {
      warn.mockRestore();
    }
  });

  it('maskDataSignalSecrets masks a secret_value array, longest first', () => {
    const longer = `${PLANTED}-x`;
    const masked = maskDataSignalSecrets({ derivation: `a ${longer} b ${PLANTED}`, secret_value: [PLANTED, longer] });
    expect(JSON.stringify(masked)).not.toContain(PLANTED);
    expect('secret_value' in masked).toBe(false);
  });
});

describe('pass-14 Gitleaks mapping never copies the value (#3415)', () => {
  it('keeps rule + location, adds a masked fingerprint, drops Secret and Match', () => {
    const sig = mapGitleaksJson([{
      RuleID: 'generic-api-key', File: 'src/config.ts', StartLine: 7,
      Secret: PLANTED, Match: `password = "${PLANTED}"`, // gitleaks:allow
    }]);
    expect(sig).not.toBeNull();
    const out = JSON.stringify(sig);
    expect(out).not.toContain(PLANTED);
    expect(sig!.evidence).toEqual(['generic-api-key: src/config.ts:7']);
    expect(sig!.derivation).toContain(`generic-api-key ${MASKED}`);
  });
});
