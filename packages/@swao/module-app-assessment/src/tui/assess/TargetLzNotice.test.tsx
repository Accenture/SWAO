// #4349: the Target Landing Zone notice and hint wrap with one left edge.
// ink-testing-library is a dependency of packages/swao only, so this file
// renders through ink directly with a minimal in-memory stdout.
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { render as inkRender, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { formatKeyHints } from '@swao/tui-kit';
import { TargetLzNotice, TARGET_LZ_SUBTITLE, TARGET_LZ_PROVIDER_KEYS, TARGET_LZ_GAP_KEYS, TARGET_LZ_PROVIDER_HINT, TARGET_LZ_FILTER_KEYS, TARGET_LZ_MANUAL_REGION_KEYS, targetLzRegionKeys, targetLzMarketScanOption, lzMarketScanArgs, TARGET_LZ_MARKET_SCAN } from './TargetLzNotice.js';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const LONG_NOTICE = 'Static LZ catalogue; live data only in the LZ Live Assessment (otc-prod, stackit-platform-a, aws-landing-zone-eu)';

class FakeStdout extends EventEmitter {
  constructor(public columns = 120) { super(); }
  last = '';
  write = (frame: string): boolean => { this.last = frame; return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  read = (): string | null => null;
  setEncoding(): void { /* no-op */ }
  setRawMode(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  pause(): void { /* no-op */ }
  ref(): void { /* no-op */ }
  unref(): void { /* no-op */ }
}

const instances: Instance[] = [];
afterEach(() => { for (const i of instances.splice(0)) i.unmount(); });

function render(tree: ReactElement, columns = 120): { lastFrame: () => string; unmount: () => void } {
  const stdout = new FakeStdout(columns);
  const inst = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  instances.push(inst);
  return { lastFrame: () => stdout.last, unmount: () => { /* afterEach unmounts */ } };
}

function lines(frame: string | undefined): string[] {
  return (frame ?? '').replace(ANSI, '').split('\n').filter((l) => l.trim() !== '');
}

describe('TargetLzNotice (#4349)', () => {
  for (const width of [100, 80]) {
    it(`every wrapped line of the notice and the hint starts at the same column at ${width} columns`, () => {
      // As on the screen: no width prop, the header width of the terminal.
      const { lastFrame, unmount } = render(<TargetLzNotice notice={LONG_NOTICE} hint={TARGET_LZ_PROVIDER_HINT} />, width);
      const out = lines(lastFrame());
      unmount();
      expect(out.length).toBeGreaterThan(2);
      const starts = new Set(out.map((l) => l.length - l.trimStart().length));
      expect([...starts]).toEqual([2]);
      for (const l of out) expect(l.length).toBeLessThanOrEqual(width);
    });
  }

  it('renders nothing without a notice and a hint', () => {
    const { lastFrame, unmount } = render(<TargetLzNotice />);
    expect(lines(lastFrame())).toEqual([]);
    unmount();
  });

  it('the subtitle has no double hyphen and no "(optional)"; Esc and Enter are key hints, not body text', () => {
    expect(TARGET_LZ_SUBTITLE).toBe('Application Assessment: Target Landing Zone');
    expect(TARGET_LZ_PROVIDER_HINT).not.toMatch(/Esc|Enter/);
    // #4255 (Design 126 section 7.4): Esc aborts on every Target LZ step; it never skips or goes back.
    for (const keys of [TARGET_LZ_PROVIDER_KEYS, TARGET_LZ_GAP_KEYS, TARGET_LZ_FILTER_KEYS, targetLzRegionKeys(true), targetLzRegionKeys(false), TARGET_LZ_MANUAL_REGION_KEYS]) {
      expect(formatKeyHints(keys)).toContain('Esc abort');
    }
    expect(formatKeyHints(TARGET_LZ_PROVIDER_KEYS)).toContain('← back');
    expect(formatKeyHints(TARGET_LZ_GAP_KEYS)).toBe('Enter confirm without them   ← back to the regions   Esc abort');
    expect(formatKeyHints(TARGET_LZ_FILTER_KEYS)).toContain('Shift+Tab back to the providers');
    expect(formatKeyHints(targetLzRegionKeys(true))).toContain('← cancel filter');
    expect(formatKeyHints(targetLzRegionKeys(false))).toContain('← back');
    expect(formatKeyHints(TARGET_LZ_MANUAL_REGION_KEYS)).toContain('Enter next (empty skips the LZ fit)');
  });
});

describe('#4481 market scan entry of the Target LZ provider step', () => {
  it('is an action entry whose label shows the state, off by default in the screen', () => {
    const off = targetLzMarketScanOption(false);
    expect(off.action).toBe(true);
    expect(off.value).toBe(TARGET_LZ_MARKET_SCAN);
    expect(off.label).toBe('Market scan (bundled provider list, lower confidence): off');
    expect(targetLzMarketScanOption(true).label).toMatch(/: on$/);
    expect(off.guidance?.what).toContain('180 days');
  });
  it('maps to --lz-market-scan only when on', () => {
    expect(lzMarketScanArgs(false)).toEqual([]);
    expect(lzMarketScanArgs(true)).toEqual(['--lz-market-scan']);
  });
});
