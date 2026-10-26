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

// #3437: the support bundle must not carry internal host names, absolute
// client paths, tool-output file names, verbatim chat text or key suffixes.
// Every fixture value below is synthetic (invented domains, paths, prompts).

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { _paths as licencePaths } from '@swao/core';
import { cmdSupportBundle, PII_ATTESTATION } from './support-bundle.js';
import { createBundleRedactor, redactWorkspaceRoot } from './support-bundle-redact.js';

const GATEWAY_HOST = 'llm-gw.corp.example.internal';
const GIT_HOST = 'git.intra.example';
const CLIENT_DIR = 'C:\\Data\\client-poc\\workspace';
const REPO_FILE = 'ledger-reconcile-batch.cbl';
const PROMPT = 'Why is the ledger reconcile service flagged as non-compliant for the payments regime?';
const REPLY = 'The ledger reconcile service stores card holder data in an unencrypted share.';
const KEY_SUFFIX = 'q7Zx';

describe('createBundleRedactor (#3437)', () => {
  it('pseudonymises internal hosts stably, keeps allowlisted public hosts and benign dotted tokens', () => {
    const r = createBundleRedactor('salt');
    const a = r.scrubText(`calling https://${GATEWAY_HOST}:8443/v1/chat/completions?api-version=2 via ${GATEWAY_HOST}`);
    expect(a).not.toContain('corp.example');
    expect(a).toMatch(/^calling https:\/\/<host-[0-9a-f]{8}>:8443\/v1\/chat\/completions\?<query> via <host-[0-9a-f]{8}>$/);
    const ids = a.match(/<host-[0-9a-f]{8}>/g)!;
    expect(ids[0]).toBe(ids[1]);
    expect(r.counts.hosts).toBe(1);
    const benign = 'wrote run-manifest.json and .swao.yml for gemma-4-31b-it, v1.4.2, provider.llm.text.attempt via https://api.openai.com/v1/models';
    expect(r.scrubText(benign)).toBe(benign);
  });

  it('uses a per-bundle salt (placeholders differ across bundles)', () => {
    const a = createBundleRedactor('one').scrubText(GIT_HOST);
    const b = createBundleRedactor('two').scrubText(GIT_HOST);
    expect(a).not.toBe(b);
  });

  it('replaces drive, UNC, POSIX and home-relative paths, keeping only the extension', () => {
    const r = createBundleRedactor('salt');
    const out = r.scrubText(`read ${CLIENT_DIR}\\apps\\billing\\.swao.yml, \\\\fs01.corp.example.internal\\share\\x.txt, /srv/client-poc/repo/main.tf and ~/client-poc/notes.md`);
    for (const leak of ['client-poc', 'billing', 'fs01', 'share', '/srv', 'main.tf', 'notes']) expect(out).not.toContain(leak);
    expect(out).toMatch(/<path-[0-9a-f]{8}\.yml>/);
    expect(r.counts.paths).toBe(4);
  });

  it('scrubs file names, relative paths and quoted fragments in stderr excerpts and drops key suffixes', () => {
    const r = createBundleRedactor('salt');
    const ctx = r.scrubValue({
      api_key_suffix: KEY_SUFFIX,
      endpoint: `https://${GATEWAY_HOST}/v1/chat/completions`,
      stderr_excerpt: `Cloning into 'ledger-service'...\nerror: unable to create file src/batch/${REPO_FILE}: Filename too long\nfatal: repository 'https://${GIT_HOST}/finance/ledger-service.git/' not found`,
      prompt_chars: 1200,
    }) as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('api_key_suffix');
    expect(ctx['prompt_chars']).toBe(1200);
    const ex = String(ctx['stderr_excerpt']);
    for (const leak of ['ledger', REPO_FILE, 'src/batch', GIT_HOST, 'finance']) expect(ex).not.toContain(leak);
    expect(ex).toContain('Filename too long');
    expect(ex).toContain('not found');
    expect(r.counts.key_fields).toBe(1);
    expect(r.counts.excerpts).toBe(1);
  });

  it('keeps JSON valid when the host pass runs over serialised text', () => {
    const r = createBundleRedactor('salt');
    const json = JSON.stringify({ m: `line one\n${GATEWAY_HOST}\tdown`, p: 'C:\\swao\\swao-enterprise-win-x64.exe' });
    const out = r.scrubHosts(json);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('corp.example');
    expect((JSON.parse(out) as { p: string }).p).toBe('C:\\swao\\swao-enterprise-win-x64.exe');
  });

  it('leaves serialised event codes and scopes alone in the text-level host pass', () => {
    const r = createBundleRedactor('salt');
    const line = JSON.stringify({ code: 'dynamic.vision.cloud', scope: 'portfolio', message: `via ${GIT_HOST}` });
    const out = r.scrubHosts(line);
    expect(out).toContain('"code":"dynamic.vision.cloud"');
    expect(out).not.toContain(GIT_HOST);
  });

  it('replaces the workspace root in any separator style, case-insensitively', () => {
    const json = JSON.stringify({ a: `${CLIENT_DIR}\\apps\\x`, b: 'c:/data/client-poc/workspace/wsp', c: `${CLIENT_DIR}-backup` });
    const parsed = JSON.parse(redactWorkspaceRoot(json, CLIENT_DIR)) as Record<string, string>;
    expect(parsed['a']).toBe('<workspace>\\apps\\x');
    expect(parsed['b']).toBe('<workspace>/wsp');
    expect(parsed['c']).toBe(`${CLIENT_DIR}-backup`); // a different directory is not this workspace
    expect(redactWorkspaceRoot(`raw ${CLIENT_DIR}\\x`, CLIENT_DIR)).toBe('raw <workspace>\\x');
  });

  it('stays linear on long pathological input', () => {
    const r = createBundleRedactor('salt');
    const inputs = ['a.'.repeat(50_000), '/a'.repeat(50_000), 'C:\\ a\\'.repeat(20_000), `${'x'.repeat(100_000)}://`, "'".repeat(50_000)];
    const t0 = Date.now();
    for (const s of inputs) { r.scrubText(s); r.scrubExcerpt(s); r.scrubHosts(s); }
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

function untar(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('ascii').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    off += 512;
    files.set(name, buf.subarray(off, off + size).toString('utf-8'));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

describe('cmdSupportBundle: fixture bundle carries no client identifiers (#3437)', () => {
  let ws = '';
  let cwd = '';
  let savedPaths = { ...licencePaths };

  beforeEach(() => {
    cwd = process.cwd();
    ws = mkdtempSync(join(tmpdir(), 'swao-sbt-3437-'));
    savedPaths = { ...licencePaths };
    const lic = join(ws, 'licence-sandbox');
    mkdirSync(lic);
    Object.assign(licencePaths, {
      statePath: join(lic, '.swao-state.json'),
      licensePath: join(lic, 'licence.json'),
      legacyLicencePath: join(lic, 'no-legacy.json'),
    });
  });
  afterEach(() => {
    Object.assign(licencePaths, savedPaths);
    process.chdir(cwd);
    process.exitCode = undefined;
    rmSync(ws, { recursive: true, force: true });
  });

  it('redacts hosts, paths, repo file names, chat text and api_key_suffix across the bundle', () => {
    mkdirSync(join(ws, 'apps'), { recursive: true });
    writeFileSync(join(ws, '.swao.yml'), `workspace:\n  name: fixture-3437\nvcs:\n  url: https://${GIT_HOST}/finance/ledger-service.git\n`);
    const logs = join(ws, 'wsp', 'logs');
    mkdirSync(logs, { recursive: true });
    const now = new Date().toISOString(); // error-context.json keeps only the last 7 days
    const events = [
      { ts: now, level: 'info', scope: 'portfolio', code: 'provider.llm.text.attempt', message: 'attempt 1',
        context: { endpoint: `https://${GATEWAY_HOST}/v1/chat/completions`, api_key_suffix: KEY_SUFFIX, prompt_chars: 900 } },
      { ts: now, level: 'warn', scope: 'portfolio', code: 'dynamic.vision.cloud', message: 'cloud vision enabled' },
      { ts: now, level: 'error', scope: 'portfolio', code: 'provider.vcs.clone-failed',
        message: `git clone failed for https://${GIT_HOST}/finance/ledger-service.git into ${CLIENT_DIR}\\apps\\ledger`,
        context: { vcs_url: `https://${GIT_HOST}/finance/ledger-service.git`,
          stderr_excerpt: `error: unable to create file src/batch/${REPO_FILE}: Filename too long\nfatal: could not open '${CLIENT_DIR}\\apps\\ledger\\${REPO_FILE}'` } },
    ];
    writeFileSync(join(logs, 'portfolio-events-2026-10.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(join(logs, 'health-check-2026-10.ndjson'), `${JSON.stringify({
      ts: now, fail_count: 1, probes: {
        gateway: { status: 'fail', message: `TLS handshake with ${GATEWAY_HOST}:443 failed` },
        workspace: { status: 'warn', message: `stale lock in ${join(ws, 'apps', 'billing', 'wsp')}` },
      },
    })}\n`);
    const appWsp = join(ws, 'apps', 'billing', 'wsp');
    mkdirSync(appWsp, { recursive: true });
    writeFileSync(join(appWsp, 'run-manifest.json'), JSON.stringify({
      run_id: 'r1', source_dir: join(ws, 'apps', 'billing', 'src'), gateway: `https://${GATEWAY_HOST}/v1`,
    }));
    const chat = join(ws, 'wsp', 'chat');
    mkdirSync(chat, { recursive: true });
    writeFileSync(join(chat, '2026-10-20_10-00_portfolio.ndjson'), [
      { ts: now, role: 'system', content: 'portfolio context' },
      { ts: now, role: 'user', content: PROMPT },
      { ts: now, role: 'assistant', content: REPLY, model: 'gemma-4-31b-it', tokens_in: 10, tokens_out: 400 },
    ].map((t) => JSON.stringify(t)).join('\n') + '\n');

    const outDir = join(ws, 'out');
    process.chdir(ws);
    cmdSupportBundle({ workspace: ws, out: outDir });
    expect(process.exitCode ?? 0).toBe(0);
    const tgz = readdirSync(outDir).filter((f) => f.endsWith('.tar.gz'));
    expect(tgz).toHaveLength(1);
    const files = untar(gunzipSync(readFileSync(join(outDir, tgz[0]!))));

    // Non-vacuous: the redacted artefacts carry the planted events and turns.
    const trace = files.get('execution-trace.ndjson')!.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const attempt = trace.find((e) => e['code'] === 'provider.llm.text.attempt');
    expect(attempt).toBeDefined();
    expect((attempt!['context'] as Record<string, unknown>)['prompt_chars']).toBe(900);
    expect((attempt!['context'] as Record<string, unknown>)).not.toHaveProperty('api_key_suffix');
    const errs = JSON.parse(files.get('error-context.json')!) as { error_events: Array<{ context: Record<string, unknown> }> };
    expect(errs.error_events).toHaveLength(1);
    expect(String(errs.error_events[0]!.context['stderr_excerpt'])).toContain('Filename too long');
    const turns = files.get('chat-transcripts.ndjson')!.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t['content_chars'])).toEqual([PROMPT.length, REPLY.length]);
    expect(turns.every((t) => !('content' in t))).toBe(true);

    expect(trace.some((e) => e['code'] === 'dynamic.vision.cloud')).toBe(true);
    expect(files.get('health-check.json')!).toContain('stale lock in <workspace>');
    const rm = files.get('run-manifests.json')!;
    expect(rm).toContain('"run_id": "r1"');
    expect(rm).toContain('<workspace>');

    const needles = [ws, GATEWAY_HOST, 'corp.example', GIT_HOST, 'client-poc', REPO_FILE, 'ledger-service', 'finance/',
      PROMPT.slice(0, 40), REPLY.slice(0, 40), KEY_SUFFIX, 'api_key_suffix'];
    const hits: string[] = [];
    for (const [name, text] of files) {
      for (const n of needles) {
        const variants = [n, n.replace(/\\/g, '\\\\')];
        if (variants.some((v) => text.includes(v))) hits.push(`${name}: ${n}`);
      }
      if (name.endsWith('.json')) expect(() => JSON.parse(text), name).not.toThrow();
    }
    expect(hits).toEqual([]);

    // The attestation describes what the bundle holds, with counts only.
    const manifest = JSON.parse(files.get('manifest.json')!) as Record<string, unknown>;
    expect(manifest['pii_attestation']).toBe(PII_ATTESTATION);
    expect(manifest['pii_attestation']).not.toBe('no-user-data-collected');
    const red = manifest['pii_redaction'] as Record<string, number>;
    expect(red['chat_turns']).toBe(2);
    expect(red['key_fields']).toBeGreaterThanOrEqual(1);
    expect(red['hosts']).toBeGreaterThanOrEqual(2);
    expect(red['paths']).toBeGreaterThanOrEqual(1);
    expect(red['excerpts']).toBe(2); // the error event appears in the trace and in error-context
  }, 120_000);
});
