// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, single-line inputs keep accepting a paste (#4379)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4379 criterion 4: the credential fields, URL prompts and search inputs
// (@swao/tui-kit TextInput and PasswordInput) take a pasted chunk whole,
// also through the Ctrl+C guard, which passes every byte but Ctrl+C on.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { PasswordInput, TextInput } from '@swao/tui-kit';
import { createCtrlCGuard, installCtrlCGuard, resetCtrlCGuard } from './ctrl-c-guard.js';

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => { resetCtrlCGuard(); });

describe('single-line inputs accept a paste (#4379)', () => {
  it('TextInput takes a pasted URL whole and submits it on Enter', async () => {
    const onSubmit = vi.fn();
    const r = render(<TextInput label="URL" onSubmit={onSubmit} />);
    await tick();
    r.stdin.write('https://portal.example.test/tenant/a?b=c');
    await tick();
    expect(r.lastFrame()).toContain('https://portal.example.test/tenant/a?b=c');
    r.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('https://portal.example.test/tenant/a?b=c');
    r.unmount();
  });

  it('TextInput takes a bracketed paste', async () => {
    const onSubmit = vi.fn();
    const r = render(<TextInput label="Search" onSubmit={onSubmit} />);
    await tick();
    r.stdin.write('\u001b[200~landing zone\u001b[201~');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('landing zone');
    r.unmount();
  });

  it('PasswordInput takes a pasted secret whole (masked) and submits it on Enter', async () => {
    const onSubmit = vi.fn();
    const secret = 'p' + 'a'.repeat(15) + '9';
    const r = render(<PasswordInput label="Secret" onSubmit={onSubmit} />);
    await tick();
    r.stdin.write(secret);
    await tick();
    expect(r.lastFrame()).toContain('*'.repeat(secret.length));
    expect(r.lastFrame()).not.toContain(secret);
    r.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(secret);
    r.unmount();
  });

  it('a paste passes the Ctrl+C guard unchanged', async () => {
    const onSubmit = vi.fn();
    const r = render(<TextInput label="URL" onSubmit={onSubmit} />);
    const guard = createCtrlCGuard({ onQuit: vi.fn() });
    const uninstall = installCtrlCGuard(r.stdin as unknown as { read: (size?: number) => unknown }, guard);
    await tick();
    r.stdin.write('https://portal.example.test/x');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('https://portal.example.test/x');
    uninstall();
    guard.dispose();
    r.unmount();
  });
});

describe('bracketed paste in PasswordInput (#4379)', () => {
  it('PasswordInput takes a bracketed paste without the markers', async () => {
    const onSubmit = vi.fn();
    const secret = 's' + 'b'.repeat(10) + '7';
    const r = render(<PasswordInput label="Secret" onSubmit={onSubmit} />);
    await tick();
    r.stdin.write(`\u001b[200~${secret}\u001b[201~`);
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(secret);
    r.unmount();
  });
});

describe('a pasted secret with a trailing line break (#4379)', () => {
  it('PasswordInput stores the secret without the line break, bracketed or not', async () => {
    for (const chunk of ['k' + 'e'.repeat(8) + 'y\r\n', '\u001b[200~' + 'k' + 'e'.repeat(8) + 'y\n\u001b[201~']) {
      const onSubmit = vi.fn();
      const r = render(<PasswordInput label="Secret" onSubmit={onSubmit} />);
      await tick();
      r.stdin.write(chunk);
      await tick();
      r.stdin.write('\r');
      await tick();
      expect(onSubmit).toHaveBeenCalledWith('k' + 'e'.repeat(8) + 'y');
      r.unmount();
    }
  });
});
