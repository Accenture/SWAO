// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, render harness for the component tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4246 / #4247 / #4248 (Design 126 section 10): the components are tested at
// 100 and 80 columns. tui-kit is a leaf package (react and ink only, ADR-0048),
// so instead of ink-testing-library (fixed at 100 columns) this harness gives
// Ink a fake stdout with a chosen width and keeps the last frame. Test-only:
// excluded from the build (tsconfig.json).

import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';
import { render } from 'ink';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string): void => { this.data = data; this.emit('readable'); this.emit('data', data); };
  read = (): string | null => { const d = this.data; this.data = null; return d; };
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

export interface RenderedAt {
  lastFrame(): string;
  lines(): string[];
  stdin: FakeStdin;
  unmount(): void;
}

/** Render `tree` in a terminal of `columns` x `rows`; strip colours from frames with `plain`. */
export function renderAt(tree: ReactElement, columns: number, rows = 40): RenderedAt {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const instance = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, rows) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  const lastFrame = (): string => plain(stdout.frames[stdout.frames.length - 1] ?? '');
  return {
    lastFrame,
    lines: () => lastFrame().split('\n'),
    stdin,
    unmount: () => instance.unmount(),
  };
}

/** Remove ANSI escape sequences. */
export function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Width of the widest line (characters; the components use single-width glyphs). */
export function widest(lines: string[]): number {
  return Math.max(0, ...lines.map((l) => [...l].length));
}
