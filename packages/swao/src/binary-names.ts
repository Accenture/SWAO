/**
 * Release binary names, the single source of truth (#4119).
 *
 * Released binaries are named `swao-<tier>-<os>-<arch>[.exe]` with no version
 * suffix (#2794). `swao init` derives the workspace `.gitignore` patterns from
 * these lists, and `tests/audit-gates/binary-name-no-version.gate.mjs` reads
 * the two arrays below (line-based, so keep them as plain string literals on
 * one line each) and checks the release workflows build exactly this set.
 */

export const RELEASE_TIERS = ['community', 'consultant', 'enterprise'] as const;
export const RELEASE_TARGETS = ['linux-x64', 'linux-arm64', 'macos-x64', 'macos-arm64', 'win-x64'] as const;

export type ReleaseTier = (typeof RELEASE_TIERS)[number];
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

/** File name of one released binary, `.exe` on Windows targets. */
export function releaseBinaryFileName(tier: ReleaseTier, target: ReleaseTarget): string {
  return `swao-${tier}-${target}${target.startsWith('win-') ? '.exe' : ''}`;
}

/** Every released binary file name, all tiers and all targets. */
export function releaseBinaryFileNames(): string[] {
  return RELEASE_TIERS.flatMap((tier) => RELEASE_TARGETS.map((target) => releaseBinaryFileName(tier, target)));
}

/**
 * Names used by earlier releases that may still sit in an existing workspace
 * root (#0968 era tiered names and the un-tiered names before tiering).
 */
export const LEGACY_BINARY_FILE_NAMES = [
  'swao-enterprise-win.exe',
  'swao-community-win.exe',
  'swao-consultant-win.exe',
  'swao-win-x64.exe',
  'swao-linux-x64',
  'swao-linux-arm64',
  'swao-macos-x64',
  'swao-macos-arm64',
] as const;

/**
 * `.gitignore` patterns that keep every SWAO binary and the launcher out of
 * version control: one wildcard pattern per release target (covers all tiers),
 * the legacy names, and the Windows launcher.
 */
export function binaryGitignorePatterns(): string[] {
  const targetPatterns = RELEASE_TARGETS.map((target) => `swao-*-${target}${target.startsWith('win-') ? '.exe' : ''}`);
  return [...targetPatterns, ...LEGACY_BINARY_FILE_NAMES, 'swao.bat'];
}

/**
 * #4160: the Windows launcher template (`docs/runbooks/swao.bat`, referenced by
 * docs/runbooks/windows-install.md), generated from the shared name list so it
 * always points at a binary a release ships. Behaviour: with arguments it
 * forwards them and exits with the binary's code; without arguments it opens
 * the TUI menu. The binary is resolved next to the launcher (`%~dp0`).
 * LF line endings, like the committed template.
 */
export function windowsLauncherScript(tier: ReleaseTier = 'enterprise'): string {
  const exe = releaseBinaryFileName(tier, 'win-x64');
  return [
    'REM =======================================================================',
    'REM',
    'REM                          S  W  A  O',
    'REM',
    'REM     Sovereign Workload Assessment and Onboarding',
    'REM     Windows launcher',
    'REM',
    'REM     Community Edition  -  Apache 2.0',
    'REM',
    'REM     Website       :  https://steady-echo-yp4z.here.now/',
    'REM     Technical Docs:  https://accenture.github.io/SWAO/en/',
    'REM     Source Code   :  https://github.com/Accenture/SWAO',
    'REM',
    'REM =======================================================================',
    '@echo off',
    'REM swao.bat: stable wrapper for the SWAO Windows binary.',
    'REM Generated from swao/packages/swao/src/binary-names.ts',
    'REM (windowsLauncherScript, #4160); do not edit by hand.',
    'REM',
    `REM Copy this file to a directory on your PATH alongside ${exe}`,
    'REM (e.g. C:\\swao-e2e\\). See docs/runbooks/windows-install.md for the',
    'REM full setup walkthrough.',
    'REM',
    'REM Behaviour:',
    `REM   - With args:    forwards them to ${exe} and exits with its code`,
    'REM   - Without args: opens the SWAO TUI menu (`swao menu`)',
    'REM',
    `REM The wrapper uses %~dp0 to resolve ${exe} relative to itself, so`,
    'REM the .bat + .exe can sit in any directory together without editing',
    'REM this file.',
    '',
    'setlocal EnableDelayedExpansion',
    'title SWAO - Sovereign Workload Assessment and Onboarding',
    `set "SWAO=%~dp0${exe}"`,
    '',
    'if not "%~1"=="" (',
    '    "%SWAO%" %*',
    '    exit /b %ERRORLEVEL%',
    ')',
    '',
    '"%SWAO%" menu',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\n');
}
