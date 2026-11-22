// #4272: profile-relative paths in log context and console lines.

import { describe, it, expect } from 'vitest';
import { shortenProfilePath } from './profile-path.js';

const winEnv = {
  USERPROFILE: 'C:\\Users\\jane.doe',
  LOCALAPPDATA: 'C:\\Users\\jane.doe\\AppData\\Local',
  APPDATA: 'C:\\Users\\jane.doe\\AppData\\Roaming',
} as NodeJS.ProcessEnv;

describe('shortenProfilePath (#4272)', () => {
  it('writes the Chromium path under LOCALAPPDATA as %LOCALAPPDATA%', () => {
    const p = 'C:\\Users\\jane.doe\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';
    expect(shortenProfilePath(p, winEnv)).toBe('%LOCALAPPDATA%\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe');
  });

  it('uses %APPDATA% and ~ for the other profile folders', () => {
    expect(shortenProfilePath('C:\\Users\\jane.doe\\AppData\\Roaming\\npm\\x', winEnv)).toBe('%APPDATA%\\npm\\x');
    expect(shortenProfilePath('C:\\Users\\jane.doe\\Desktop\\a.txt', winEnv)).toBe('~\\Desktop\\a.txt');
  });

  it('matches case-insensitively and inside a console line', () => {
    const line = '[info] Pass 10: Chromium at c:\\users\\JANE.DOE\\appdata\\local\\ms-playwright\\chrome.exe, ready.';
    expect(shortenProfilePath(line, winEnv)).toBe('[info] Pass 10: Chromium at %LOCALAPPDATA%\\ms-playwright\\chrome.exe, ready.');
  });

  it('does not shorten a sibling folder that only shares the prefix', () => {
    expect(shortenProfilePath('C:\\Users\\jane.doe2\\x', winEnv)).toBe('C:\\Users\\jane.doe2\\x');
  });

  it('writes ~ for HOME on POSIX and ignores a root folder', () => {
    expect(shortenProfilePath('/home/jane/.cache/ms-playwright/chrome', { HOME: '/home/jane' } as NodeJS.ProcessEnv)).toBe('~/.cache/ms-playwright/chrome');
    expect(shortenProfilePath('/usr/bin/chromium', { HOME: '/' } as NodeJS.ProcessEnv)).toBe('/usr/bin/chromium');
  });
});
