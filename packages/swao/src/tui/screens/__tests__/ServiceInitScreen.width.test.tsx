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

// #4237 / #4238 / #4256 (TUI-12, Design 126 section 10): the Service Portfolio
// Assessment run and finish screens at 100 and 80 columns. The stage line
// never wraps its bracket, output lines wrap instead of being cut, user paths
// are shortened, no double dash reaches the screen, and the run ends on the
// finish screen with the What next menu.

import { describe, it, expect, afterAll } from 'vitest';
import React from 'react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceInitScreen, type ServiceInitPreview } from '../ServiceInitScreen.js';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
// The real profile path, so the shortening (run-output.ts USER_PATH_VARIABLES) applies on every machine.
const LOCAL = process.env['LOCALAPPDATA'];
const DOWN = '\u001B[B';
const LONG = '[3/5] app0002: cve created, eol created/high, virustotal created, vendor created, certificate created, contract created, support created';

describe('Service Portfolio Assessment run and finish screens at 100 and 80 columns (#4237, #4238)', () => {
  for (const columns of [100, 80]) {
    it(`fits ${columns} columns while running and on the finish screen`, async () => {
      const ws = mkdtempSync(join(tmpdir(), 'swao-svc-width-'));
      dirs.push(ws);
      const ids = Array.from({ length: 5 }, (_, i) => `app${String(i).padStart(4, '0')}`);
      for (const id of ids) {
        mkdirSync(join(ws, 'apps', id, 'wsp'), { recursive: true });
        writeFileSync(join(ws, 'apps', id, '.swao.yml'), 'assessment:\n  type: service\n');
      }
      let release: (() => void) | null = null;
      const runChild = (args: string[], onText: (t: string) => void): Promise<number> => {
        if (args[1] === 'research') {
          onText(`${LONG}\n`);
          if (LOCAL) onText(`Pass 25 -- binary: Chromium at ${LOCAL}\\ms-playwright\\chromium\n`);
          onText('[3/5] app0002: cve created\n');
          return new Promise((r) => { release = () => { onText('Research complete: 5 app(s)\n'); r(0); }; });
        }
        return Promise.resolve(0);
      };
      const previewInit = async (): Promise<ServiceInitPreview> => ({ sourceName: 'intake.xlsx', plannedAppIds: ids, existingServiceAppIds: ids, conflict: { appIds: [], sources: [] } });
      const r = renderAt(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={runChild} previewInit={previewInit} />, columns, 50);
      await tick();
      r.stdin.write('intake.xlsx'); await tick();
      r.stdin.write('\r'); await tick(); // intake
      r.stdin.write('\r'); await tick(); // column map
      r.stdin.write('\r'); await tick(150); // LLM research: run
      r.stdin.write(DOWN); await tick();
      r.stdin.write(DOWN); await tick();
      r.stdin.write('\r'); await tick(150); // scaffold and research only
      r.stdin.write('\r'); await tick(300); // confirm and start

      const running = r.lines();
      const text = running.join('\n');
      expect(text).toContain('Stage 2 of 4');
      expect(text).toContain('3 of 5 apps researched');
      expect(text).toContain('Esc cancel');
      expect(text).not.toContain(' -- ');
      if (LOCAL) {
        expect(text).toContain('%LOCALAPPDATA%');
        expect(text).not.toContain(LOCAL);
      }
      // The long research line wraps instead of being cut at the frame edge.
      expect(text.replace(/\s+/g, ' ')).toContain('support created');
      expect(widest(running)).toBeLessThanOrEqual(columns);
      // The stage bar keeps its closing bracket on its own line.
      const bar = running.find((l) => l.includes('Stage') && l.includes('['));
      expect(bar).toMatch(/\]\s+\d+%/);

      release!();
      await tick(400);
      const finished = r.lines();
      const done = finished.join('\n');
      expect(done).toContain('Scaffold and research complete');
      expect(done).toContain('What next');
      expect(done).toContain('Show the priority list');
      expect(done).toContain('Back to main menu');
      expect(done).not.toContain(' -- ');
      expect(widest(finished)).toBeLessThanOrEqual(columns);
      r.unmount();
    }, 30_000);
  }
});

// #4400 (Design 126 section 4.2, G-06): the One service app picker over 234 service
// apps and the framework step over the bundled frameworks fit 24 rows at 80 columns.
describe('One service picker and framework step at 24 rows (#4400)', () => {
  it('both steps stay inside 80 columns and 24 rows', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4400-rows-'));
    dirs.push(ws);
    const ids = Array.from({ length: 234 }, (_, i) => `app${String(i).padStart(4, '0')}`);
    const previewInit = async (): Promise<ServiceInitPreview> => ({ sourceName: 'inventory.xlsx', plannedAppIds: ids, existingServiceAppIds: [], conflict: { appIds: [], sources: [] } });
    const r = renderAt(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={async () => 0} previewInit={previewInit} />, 80, 24);
    await tick();
    r.stdin.write('inventory.xlsx');
    await tick();
    for (let i = 0; i < 3; i++) { r.stdin.write('\r'); await tick(120); }
    for (let i = 0; i < 3; i++) { r.stdin.write(DOWN); await tick(); }
    r.stdin.write('\r'); // One service
    await tick(120);
    const fits = (frame: string): void => {
      const lines = frame.split('\n');
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
      expect(lines.length).toBeLessThanOrEqual(24);
      expect(widest(lines)).toBeLessThanOrEqual(80);
    };
    let frame = r.lastFrame() ?? '';
    expect(frame).toContain('Which service app should SWAO assess?');
    expect(frame).not.toContain('app0233');
    fits(frame);
    r.stdin.write('\r'); // app0000
    await tick(200);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Add community frameworks to this run');
    expect(frame).toContain('SWAO_APM');
    fits(frame);
    r.unmount();
  }, 30_000);
});
