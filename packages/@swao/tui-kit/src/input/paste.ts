// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4379 (Design 126 section 7.11): pasted text in a single-line input.
//
// A paste reaches Ink as one input chunk (Windows Terminal, Ctrl+V or right
// click). For a single-line input the chunk is cleaned: the bracketed paste
// markers ESC[200~ and ESC[201~ are removed, a line break (CR, LF or CR LF)
// and a tab become one space, every other control character (C0, DEL, C1)
// is removed. Character loop, no regular expression on the input (CodeQL).

const PASTE_OPEN = '[200~';
const PASTE_CLOSE = '[201~';

function dropMarkers(raw: string): string {
  let s = raw;
  for (const marker of [PASTE_OPEN, PASTE_CLOSE]) {
    for (;;) {
      const withEsc = s.indexOf(`\u001b${marker}`);
      if (withEsc >= 0) { s = s.slice(0, withEsc) + s.slice(withEsc + marker.length + 1); continue; }
      // Ink strips the leading ESC of a chunk, so a marker can arrive without it.
      if (s.startsWith(marker)) { s = s.slice(marker.length); continue; }
      if (s.endsWith(marker)) { s = s.slice(0, s.length - marker.length); continue; }
      break;
    }
  }
  return s;
}

/** True when the chunk carries a bracketed paste marker. */
export function hasPasteMarker(raw: string): boolean {
  return raw.includes(PASTE_OPEN) || raw.includes(PASTE_CLOSE);
}

/** The chunk as single-line text: markers removed, line breaks and tabs as one space, control characters removed. */
export function sanitisePastedText(raw: string, opts: { lineBreaks?: 'space' | 'drop' } = {}): string {
  // A secret field drops line breaks: a password manager paste often ends in one,
  // and a trailing space would become part of the stored secret.
  const br = opts.lineBreaks === 'drop' ? '' : ' ';
  const s = dropMarkers(raw);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = ch.charCodeAt(0);
    if (ch === '\r') {
      if (s[i + 1] === '\n') i++;
      out += br;
      continue;
    }
    if (ch === '\n') { out += br; continue; }
    if (ch === '\t') { out += ' '; continue; }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

export interface PasteAppendResult {
  value: string;
  /** True when the input limit cut the pasted text. */
  truncated: boolean;
}

/** Appends a cleaned chunk to `current`, at most `max` characters in total. */
export function appendPastedText(current: string, raw: string, max: number): PasteAppendResult {
  const clean = sanitisePastedText(raw);
  const room = Math.max(0, max - current.length);
  if (clean.length <= room) return { value: current + clean, truncated: false };
  // Cut at a code point, never inside a surrogate pair.
  let cut = room;
  if (cut > 0) {
    const last = clean.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut--;
  }
  return { value: current + clean.slice(0, cut), truncated: true };
}
