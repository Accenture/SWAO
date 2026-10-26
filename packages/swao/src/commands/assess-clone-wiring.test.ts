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

// #3439: the assess clone step must go through providers/vcs/clone.ts
// (core.longpaths, no credential prompt, async spawn with a deadline) and
// never print or log the raw source.vcs.url. clone.test.ts covers the helpers;
// this pins that assess actually uses them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');
const start = src.indexOf('async function cloneIfNeeded(');
const end = src.slice(start).search(/\r?\n\}\r?\n/);
const body = start === -1 || end === -1 ? '' : src.slice(start, start + end);

describe('assess clone wiring (#3439)', () => {
  it('finds the cloneIfNeeded body', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body.length).toBeGreaterThan(100);
  });

  it('clones through buildCloneArgs + buildCloneEnv + runGitClone', () => {
    expect(body).toContain('buildCloneArgs({ cloneUrl, targetPath, ref })');
    expect(body).toContain('await runGitClone(args, buildCloneEnv(process.env, gitConfigEnv), cloneTimeoutMs)');
    expect(body).not.toMatch(/spawnSync\('git', args/);
    expect(body).not.toMatch(/\['clone', '--depth'/);
  });

  it('prints and logs only the credential-stripped URL', () => {
    expect(body).toContain('const safeUrl = redactVcsUrl(vcsUrl)');
    expect(body).not.toMatch(/vcs_url: vcsUrl/);
    expect(body).not.toMatch(/Cloning \$\{vcsUrl\}/);
    expect(body).not.toMatch(/URL: \$\{vcsUrl\}/);
  });
});

describe('assess clone deadline wiring (#3439 clone_timeout_minutes)', () => {
  it('reads source.vcs.clone_timeout_minutes through cloneTimeoutMsFromVcs and passes it to runGitClone', () => {
    expect(body).toContain('const cloneTimeoutMs = cloneTimeoutMsFromVcs(vcs?.clone_timeout_minutes);');
    const read = body.indexOf('cloneTimeoutMsFromVcs(vcs?.clone_timeout_minutes)');
    const call = body.indexOf('await runGitClone(');
    expect(read).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(read);
  });

  it('names the setting when the clone hits the deadline', () => {
    expect(body).toMatch(/result\.timedOut \? ` {2}Deadline: .*source\.vcs\.clone_timeout_minutes/);
  });
});
