// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- tests: Windows launcher template (#4160)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4160: the swao.bat launcher template pointed at swao-win-x64.exe, a name no
// release ships. It is now generated from the shared release name list
// (binary-names.ts); the committed template must equal the generator output.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_BINARY_FILE_NAMES, releaseBinaryFileName, windowsLauncherScript } from '../binary-names.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/__tests__ -> swao/packages/swao -> repository root (private repo only).
const TEMPLATE = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'runbooks', 'swao.bat');

describe('Windows launcher template (#4160)', () => {
  it('points at the released Enterprise Windows binary, never at a legacy name', () => {
    const bat = windowsLauncherScript();
    const exe = releaseBinaryFileName('enterprise', 'win-x64');
    expect(exe).toBe('swao-enterprise-win-x64.exe');
    expect(bat).toContain(`set "SWAO=%~dp0${exe}"`);
    for (const legacy of LEGACY_BINARY_FILE_NAMES) expect(bat).not.toContain(legacy);
    expect(bat).not.toContain('swao-win-x64.exe');
  });

  it('keeps the launcher behaviour: pass-through, menu without args, clean exit', () => {
    const bat = windowsLauncherScript();
    expect(bat).toContain('setlocal EnableDelayedExpansion');
    expect(bat).toContain('if not "%~1"=="" (');
    expect(bat).toContain('"%SWAO%" %*');
    expect(bat).toMatch(/"%SWAO%"\s+menu/);
    expect(bat).toContain('exit /b %ERRORLEVEL%');
    expect(bat).not.toMatch(/^title .*--/m);
  });

  it('other tiers resolve to their own binary', () => {
    expect(windowsLauncherScript('community')).toContain('%~dp0swao-community-win-x64.exe');
  });

  it.skipIf(!existsSync(TEMPLATE))('docs/runbooks/swao.bat equals the generator output byte for byte', () => {
    expect(readFileSync(TEMPLATE, 'utf-8')).toBe(windowsLauncherScript());
  });
});
