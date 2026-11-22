// #4278: every test process of this package runs on a temporary user profile,
// so tests never read or write the developer's licence file, assessment
// counter (~/.swao-state.json) or credential vault. Opt out with
// SWAO_TEST_KEEP_HOME=1. Loaded first through vitest setupFiles.
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

if (!process.env['SWAO_TEST_KEEP_HOME']) {
  const sandboxHome = mkdtempSync(join(tmpdir(), 'swao-test-home-'));
  process.env['HOME'] = sandboxHome;
  process.env['USERPROFILE'] = sandboxHome;
  process.env['APPDATA'] = join(sandboxHome, 'AppData', 'Roaming');
  process.env['XDG_CONFIG_HOME'] = join(sandboxHome, '.config');
  const realLocal = process.env['LOCALAPPDATA'];
  const sandboxLocal = join(sandboxHome, 'AppData', 'Local');
  mkdirSync(sandboxLocal, { recursive: true });
  mkdirSync(process.env['APPDATA'], { recursive: true });
  if (realLocal && existsSync(join(realLocal, 'ms-playwright'))) {
    try { symlinkSync(join(realLocal, 'ms-playwright'), join(sandboxLocal, 'ms-playwright'), 'junction'); } catch { /* browser tests skip without it */ }
  }
  process.env['LOCALAPPDATA'] = sandboxLocal;
  // #4375: remove the profile when the test file is done: the ms-playwright
  // junction is unlinked first (the link, never the real browser cache), then
  // the folder. Only a direct child of the temp folder named swao-test-home-*.
  afterAll(async () => {
    const { removeSandboxProfile } = await import('@swao/core');
    removeSandboxProfile(sandboxHome);
  });
}
