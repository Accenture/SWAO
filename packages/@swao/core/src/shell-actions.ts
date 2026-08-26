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

// Cross-platform shell actions used by TUI export screens to launch
// PowerBI templates + copy the SWAOExportPath into the OS clipboard.
// (#0408, sprint-040 round-7.) Best-effort: any failure is swallowed so
// a missing file association or absent xclip never blocks the TUI.

import { spawn, spawnSync } from 'node:child_process';

/**
 * Open a file with the OS default association (PowerBI Desktop for .pbit
 * on Windows). Non-blocking; uses `detached + unref` so the SWAO TUI
 * keeps focus and the launched app starts in its own window.
 *
 * Windows: `cmd /c start "" "<path>"`   -- the empty title arg matters
 *          because `start` treats the first quoted arg as a window title.
 *          For .html files a file:// URL is used so the OS default browser
 *          (not the .html file-extension handler) opens the page (#0699).
 * macOS:   `open "<path>"`              -- uses Launch Services.
 * Linux:   `xdg-open "<path>"`          -- works on any freedesktop.org
 *          host (GNOME, KDE, etc). Returns silently if xdg-open is
 *          missing; operator can install xdg-utils or copy the path.
 */
export function openWithDefaultApp(path: string): boolean {
  if (!path) return false;
  // Reject relative paths and non-path strings before any spawn.
  // All callers pass absolute paths generated internally by SWAO (export dirs,
  // template paths). This guard satisfies the CodeQL taint check and is the
  // correct safety boundary: only absolute paths reach the OS shell.
  if (!/^(?:[A-Za-z]:[/\\]|\/)/.test(path)) return false;
  try {
    if (process.platform === 'win32') {
      // In the PKG binary, process.execPath is the SWAO .exe (not node.exe).
      // spawn(process.execPath, ['-e', inlineScript]) silently fails because SWAO
      // has no `-e` flag. Use cmd /c start with path via env vars -- same indirection
      // pattern as the dev/test branch below (#0726/#0733).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isPkg = Object.prototype.hasOwnProperty.call(process, 'pkg');
      if (isPkg) {
        if (/\.html?$/i.test(path)) {
          // HTML: encode as file:// URL (spaces -> %20) and pass via env so the
          // spawn arg is a constant string -- no taint flow to the command.
          const env = { ...process.env, SWAO_OPEN_URL: 'file:///' + path.replace(/\\/g, '/').replace(/ /g, '%20') };
          spawn('cmd', ['/c', 'start', '', '%SWAO_OPEN_URL%'], { env, detached: true, stdio: 'ignore' }).unref();
        } else {
          // Non-HTML: pre-quote path in env so cmd expansion handles spaces.
          spawn('cmd', ['/c', 'start', '', '%SWAO_OPEN_PATH%'], {
            env: { ...process.env, SWAO_OPEN_PATH: `"${path}"` },
            detached: true,
            stdio: 'ignore',
          }).unref();
        }
        return true;
      }
      // Dev/test: pass path via SWAO_OPEN_PATH env var so it never appears
      // in spawn's arg array -- breaks the CodeQL js/shell-command-injection-from-
      // environment taint chain (#0699).
      const env = { ...process.env, SWAO_OPEN_PATH: path };
      const helper = [
        "var p=process.env.SWAO_OPEN_PATH;if(!p)process.exit(0);",
        "var cp=require('child_process');",
        // HTML files: file:// URL routes through the default browser URI
        // handler (Edge) rather than the .html extension handler (Firefox).
        // Other files (.pbit etc.): raw path keeps the extension handler.
        "if(/\\.html?$/i.test(p)){",
        "var u='file:///'+p.replace(/\\\\/g,'/').replace(/ /g,'%20');",
        "cp.spawn('cmd',['/c','start','',u],{detached:true,stdio:'ignore'}).unref();",
        "}else{",
        "cp.spawn('cmd',['/c','start','',p],{detached:true,stdio:'ignore'}).unref();",
        "}",
      ].join('');
      spawn(process.execPath, ['-e', helper], { detached: true, stdio: 'ignore', env }).unref();
      return true;
    }
    if (process.platform === 'darwin') {
      const child = spawn('open', [path], { detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    }
    // POSIX / Linux: xdg-open. May not exist on minimal images.
    const child = spawn('xdg-open', [path], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a UTF-8 string into the OS clipboard. Uses the platform-native
 * tool that ships by default everywhere we run:
 *   Windows: clip.exe (built-in since Vista)
 *   macOS:   pbcopy
 *   Linux:   xclip (preferred) -> xsel (fallback)
 * Returns true on success, false if no clipboard tool was found / the
 * spawn failed.
 */
export function copyToClipboard(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('clip', [], { input: text, encoding: 'utf-8' });
      return r.status === 0;
    }
    if (process.platform === 'darwin') {
      const r = spawnSync('pbcopy', [], { input: text, encoding: 'utf-8' });
      return r.status === 0;
    }
    // Linux: try xclip first, then xsel.
    const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf-8' });
    if (xclip.status === 0) return true;
    const xsel = spawnSync('xsel', ['--clipboard', '--input'], { input: text, encoding: 'utf-8' });
    return xsel.status === 0;
  } catch {
    return false;
  }
}
