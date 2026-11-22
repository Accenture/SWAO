// #4484 (Design 126 section 7.12): the first frame is drawn before the load;
// the load runs once per dependency change; keys typed while loading are dropped.

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { Text, useInput } from 'ink';
import { useAfterFirstFrame } from './useAfterFirstFrame.js';
import { renderAt } from '../testing/render-at.js';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function Probe({ load }: { load: () => string[] }): JSX.Element {
  const apps = useAfterFirstFrame(load, []);
  const [keys, setKeys] = useState('');
  useInput((input) => { if (apps) setKeys((k) => k + input); });
  return apps ? <Text>{`apps ${apps.join(',')} keys ${keys}`}</Text> : <Text>Loading apps</Text>;
}

describe('useAfterFirstFrame (#4484)', () => {
  it('draws the loading frame first, then the loaded value, and loads once', async () => {
    const load = vi.fn(() => ['sovereign-health']);
    const r = renderAt(<Probe load={load} />, 100);
    expect(r.lastFrame()).toContain('Loading apps');
    expect(load).not.toHaveBeenCalled();
    for (let i = 0; i < 40 && !r.lastFrame().includes('apps sovereign'); i++) await wait(25);
    expect(r.lastFrame()).toContain('apps sovereign-health');
    expect(load).toHaveBeenCalledTimes(1);
    await wait(30); // the input effect of the loaded render
    r.stdin.write('x');
    await wait(30);
    expect(r.lastFrame()).toContain('keys x');
    r.unmount();
  });

  it('drops keys typed while the load blocks', async () => {
    let r: ReturnType<typeof renderAt> | null = null;
    const load = (): string[] => {
      // A key arrives while the scan blocks the event loop (a buffered keystroke).
      setTimeout(() => r?.stdin.write('q'), 0);
      const until = Date.now() + 50;
      while (Date.now() < until) { /* blocking scan */ }
      return ['a'];
    };
    r = renderAt(<Probe load={load} />, 100);
    for (let i = 0; i < 40 && !r.lastFrame().includes('apps a'); i++) await wait(25);
    await wait(30);
    expect(r.lastFrame().trimEnd()).toBe('apps a keys');
    r.unmount();
  });
});
