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

// #4377: after `swao.run.complete` nothing but stdio may keep the assess
// process alive. Two layers:
//
// 1. In-process: the resources an application run opens (run lifecycle with
//    its process guards, the #4300 run heartbeat and progress sink, the Pass 14
//    file-backed tool runner with a real child) are all released when the run
//    completes. Vitest keeps its own handles, so an async hook records only the
//    loop-keeping resources created during the mocked run and checks that each
//    was destroyed.
// 2. dist-backed: a real `swao assess` on a local-source fixture (Pass 01
//    only, no LLM, no clone, sandboxed profile). A preload records the active
//    resources two event loop turns after the "Assessment complete" line and
//    the time of process exit; only stdio may remain and the process must exit
//    within 2 s.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHook } from 'node:async_hooks';
import { createRunHeartbeat, fileBackedToolRunner, reportPassProgress, setPassProgressSink } from '@swao/core';
import { createRunLifecycle } from './run-lifecycle.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '..', '..', 'dist', 'index.js');

/** Resources of the process itself (stdio) and of the preload's own turn (dist-backed layer). */
const STDIO = new Set(['PipeWrap', 'TTYWrap', 'FSReqCallback', 'Immediate']);

/**
 * Async resource types that keep the event loop alive. Promises, ticks,
 * immediates and file system requests do not; stdio is opened before the run.
 */
const LOOP_KEEPING = new Set(['Timeout', 'PROCESSWRAP', 'TCPWRAP', 'TCPSERVERWRAP', 'PIPEWRAP', 'PIPESERVERWRAP', 'TTYWRAP', 'UDPWRAP', 'FSEVENTWRAP', 'STATWATCHER', 'SIGNALWRAP', 'HTTPCLIENTREQUEST', 'HTTPINCOMINGMESSAGE', 'TLSWRAP', 'GETADDRINFOREQWRAP']);

/** Records every loop-keeping resource created while active, and which were destroyed. */
function trackResources(): { stop: () => void; open: () => string[] } {
  const live = new Map<number, string>();
  const hook = createHook({
    init(id, type) { if (LOOP_KEEPING.has(type)) live.set(id, type); },
    destroy(id) { live.delete(id); },
  });
  hook.enable();
  return { stop: () => hook.disable(), open: () => [...live.values()] };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

const GUARDED = ['SIGINT', 'SIGTERM', 'uncaughtException', 'exit'] as const;

describe('#4377: a completed run releases every resource it opened (in-process)', () => {
  let runDir: string;
  beforeAll(() => { runDir = mkdtempSync(join(tmpdir(), 'swao-4377-run-')); });
  afterAll(() => { rmSync(runDir, { recursive: true, force: true }); });

  it('lifecycle guards, heartbeat, progress sink and a tool runner child leave no handle behind', async () => {
    await nextTurn();
    const tracker = trackResources();
    const listenersBefore = GUARDED.map((ev) => process.listenerCount(ev));

    const lifecycle = createRunLifecycle({
      assessmentType: 'application', app: 'demo', runDir, startedAt: new Date(), swaoVersion: 'test',
    });
    lifecycle.markStarted();
    lifecycle.installProcessGuards();
    let beats = 0;
    const heartbeat = createRunHeartbeat({ intervalMs: 20, progressGapMs: 10, heartbeat: () => { beats++; }, progress: () => {} });
    setPassProgressSink(heartbeat.sink);
    heartbeat.start();

    // Pass 14 runs its scanners through the file-backed runner (#4300); a real short child.
    const tool = await fileBackedToolRunner({ command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], cwd: runDir, timeoutMs: 30_000 });
    expect(tool.exitCode).toBe(0);
    expect(tool.stdout).toBe('ok');
    reportPassProgress({ phase: 'scan', files: 1 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(beats).toBeGreaterThan(0);

    // The completion order of assess.ts: stop the heartbeat, drop the sink, close the run.
    heartbeat.stop();
    setPassProgressSink(null);
    lifecycle.complete({ exitCode: 0 });

    // Destroy hooks are delivered asynchronously; one more turn settles them.
    await nextTurn();
    tracker.stop();
    expect(tracker.open()).toEqual([]);
    expect(GUARDED.map((ev) => process.listenerCount(ev))).toEqual(listenersBefore);
    const marker = JSON.parse(readFileSync(join(runDir, 'run-status.json'), 'utf-8')) as { status: string };
    expect(marker.status).toBe('complete');
  }, 60_000);
});

describe.skipIf(!existsSync(CLI))('#4377: swao assess exits right after swao.run.complete (dist-backed)', () => {
  let root: string;
  let ws: string;
  let probe: { resources: string[]; completeAt: number; exitAt: number } | undefined;
  let runCompleteTs: number | undefined;
  let status: number | null = null;
  let stderr = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-4377-'));
    // Sandboxed profile: the run must not touch the real licence or counter files (#4278).
    const home = join(root, 'home');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home, USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'), APPDATA: join(home, 'AppData', 'Roaming'),
      TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
      SWAO_LICENSE_TIER_OVERRIDE: 'community',
    };
    for (const d of [home, join(home, '.config'), join(home, 'AppData', 'Local'), join(home, 'AppData', 'Roaming'), join(root, 'tmp')]) mkdirSync(d, { recursive: true });

    ws = join(root, 'ws');
    const app = join(ws, 'apps', 'demo');
    const src = join(app, 'wsp', 'inputs', 'source');
    mkdirSync(join(src, 'src'), { recursive: true });
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    writeFileSync(join(app, '.swao.yml'), 'wsp_version: "0.9"\napp_id: demo\nsource:\n  path: wsp/inputs/source/\n');
    writeFileSync(join(src, 'package.json'), '{"name":"demo","dependencies":{"express":"^4.0.0"}}\n');
    writeFileSync(join(src, 'src', 'index.js'), "require('express')().listen(8080);\n");

    const probeFile = join(root, 'probe.json');
    const preload = join(root, 'probe.cjs');
    writeFileSync(preload, [
      "const fs = require('fs');",
      `const out = ${JSON.stringify(probeFile)};`,
      'const state = { resources: null, completeAt: 0, exitAt: 0 };',
      'const write = process.stdout.write.bind(process.stdout);',
      'process.stdout.write = (chunk, ...rest) => {',
      "  if (!state.completeAt && /Assessment complete/.test(String(chunk))) {",
      '    state.completeAt = Date.now();',
      '    setImmediate(() => setImmediate(() => { state.resources = process.getActiveResourcesInfo(); }));',
      '  }',
      '  return write(chunk, ...rest);',
      '};',
      "process.on('exit', () => { state.exitAt = Date.now(); fs.writeFileSync(out, JSON.stringify(state)); });",
    ].join('\n'));

    const r = spawnSync(process.execPath, ['--require', preload, CLI, 'assess', '--app', 'demo', '--workspace', ws, '--skip-llm', '--no-crawl', '--passes', 'inv'], {
      cwd: ws, encoding: 'utf-8', timeout: 240_000, env,
    });
    status = r.status;
    stderr = r.stderr;
    if (existsSync(probeFile)) probe = JSON.parse(readFileSync(probeFile, 'utf-8')) as typeof probe;
    const logs = join(app, 'wsp', 'logs');
    const complete = readdirSync(logs).filter((f) => f.startsWith('app-events-'))
      .flatMap((f) => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean))
      .map((l) => JSON.parse(l) as { ts: string; code: string })
      .find((e) => e.code === 'swao.run.complete');
    if (complete) runCompleteTs = Date.parse(complete.ts);
  }, 300_000);
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  it('runs to completion', () => {
    expect(status, stderr).toBe(0);
    expect(runCompleteTs).toBeDefined();
  });

  it('only stdio is active after the run completed', () => {
    expect(probe?.resources).toBeDefined();
    const extra = (probe?.resources ?? []).filter((r) => !STDIO.has(r));
    expect(extra).toEqual([]);
  });

  it('the process exits within 2 s of swao.run.complete', () => {
    expect(probe?.exitAt).toBeGreaterThan(0);
    expect(probe!.exitAt - runCompleteTs!).toBeLessThan(2_000);
  });
});
