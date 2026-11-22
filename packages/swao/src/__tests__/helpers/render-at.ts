// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, test helper
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4256 (TUI-12, Design 126 section 10): screens are tested at 100 and 80
// columns. ink-testing-library renders at a fixed 100 columns, so this
// harness (the same as tui-kit's testing/render-at.ts, which the package does
// not export) gives Ink a fake stdout of a chosen width and keeps the frames.

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
  /** The last frame with its colour codes (#4299: selection colour checks). */
  rawFrame(): string;
  lines(): string[];
  stdin: FakeStdin;
  unmount(): void;
}

/** Remove ANSI escape sequences. */
export function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Render `tree` in a terminal of `columns` x `rows`; frames without colours. */
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
  return { lastFrame, rawFrame: () => stdout.frames[stdout.frames.length - 1] ?? '', lines: () => lastFrame().split('\n'), stdin, unmount: () => instance.unmount() };
}

/** Width of the widest line in characters. */
export function widest(lines: readonly string[]): number {
  return Math.max(0, ...lines.map((l) => [...l].length));
}
