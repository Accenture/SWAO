// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4272: a path under the user profile written profile-relative for log
// context and console lines (`%LOCALAPPDATA%\ms-playwright\...`, `~/...`), so
// an event log or a TUI output line never carries the Windows user name. The
// most specific folder wins: LOCALAPPDATA and APPDATA sit under USERPROFILE.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace the well-known profile folders in `text` by %LOCALAPPDATA%, %APPDATA% or ~. */
export function shortenProfilePath(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const prefixes: Array<[string | undefined, string]> = [
    [env['LOCALAPPDATA'], '%LOCALAPPDATA%'],
    [env['APPDATA'], '%APPDATA%'],
    [env['USERPROFILE'], '~'],
    [env['HOME'], '~'],
  ];
  for (const [dir, token] of prefixes) {
    // A root such as `C:\` or `/` is never a profile folder.
    let d = dir;
    while (d && (d.endsWith('/') || d.endsWith('\\'))) d = d.slice(0, -1);
    if (!d || d.length <= 3) continue;
    // Windows paths compare case-insensitively; a match must end at a separator or the end.
    out = out.replace(new RegExp(`${escapeRegExp(d)}(?=[\\\\/]|$|[^\\w.-])`, 'gi'), token);
  }
  return out;
}
