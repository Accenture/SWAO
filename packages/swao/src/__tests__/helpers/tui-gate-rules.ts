// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, offender rules of the Design 126 TUI audit gates
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4245 (Design 126 section 13.2): one pure function per gate. Each takes the
// text of a source file and returns the 1-based numbers of its offending
// lines. The gates (src/tui/__tests__/tui-*.test.ts) run them over the TUI
// trees and compare the result with their allowlist. Dash characters are
// written as \u escapes so this file passes its own gate.

import { lineOffenders } from './tui-gate.ts';

/** G-01: an em dash, an en dash or a spaced double hyphen in code (strings, JSX text). */
export function dashPunctuation(text: string): number[] {
  return lineOffenders(text, (code) => /[\u2014\u2013]/.test(code) || /\s--\s/.test(code));
}

/**
 * G-02: a cursor marker drawn by the screen: the U+276F marker, or a string
 * literal "> " or one that starts with "> " (a row prefix), or ">" as a
 * ternary branch (`cursor ? '>' : ' '`); a ">" breadcrumb is not a marker. A quote
 * that closes a JSX attribute (`color="cyan">`) is not a literal start.
 */
export function cursorMarker(text: string): number[] {
  return lineOffenders(text, (code) =>
    /\u276F/.test(code)
    || /(?<![=\w\\])(['"`])> \1/.test(code)
    || /\?\s*(['"`])>\1/.test(code)
    || /(?<![=\w\\])(['"`])> \S/.test(code));
}

const STATUS_WORD = /\[(ok|warn|miss|missing|fail|info|waiting|cancelled)\]/;
const UPPER_STATUS = /(['"`])(OK|WARN|FAIL|INFO)\1/;
const DATA_CONTEXT = /===|!==|\bcase\b|\|\s*['"`]|['"`]\s*\|/;

/** G-03: a status word literal (`[ok]`, `[warn]`, ...) or `OK`/`WARN`/`FAIL`/`INFO` as row text. */
export function statusLiteral(text: string): number[] {
  return lineOffenders(text, (code) =>
    STATUS_WORD.test(code) || (UPPER_STATUS.test(code) && !DATA_CONTEXT.test(code)));
}

/** G-04: key hint wording outside KeyHints, and literal `affordances` arrays. */
export function keyHintWording(text: string): number[] {
  return lineOffenders(text, (code) =>
    /Press Enter|Press Esc|\bEsc to |\bEscape to |\bEsc:|\bEscape:|\bEnter:|\bto continue\b/.test(code)
    || /affordances\s*[=:]\s*\{?\s*\[\s*['"`]/.test(code));
}

/**
 * G-11: CLI syntax in screen text: a `--flag` after a word ("Run swao assess
 * --app x"), "protocol:" or "kebab-case". Lines that build a child process
 * argument list or carry a guidance `cli` field or a "CLI:" mention are not
 * screen text.
 */
export function cliOnScreen(text: string): number[] {
  return lineOffenders(text, (code) =>
    (/[A-Za-z0-9.)>}]\s+--[a-z][a-z0-9-]*/.test(code) || /\(protocol:|protocol: \$\{/.test(code) || /kebab-case/i.test(code))
    && !/\bcli\s*:|CLI:|['"`]CLI['"`]|spawn|execFile|execSync|args\.push|argv/.test(code));
}

/** End index (exclusive) of a JSX opening tag that starts at `start` ("<Name"), brace and string aware. */
function openingTagEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i + 1;
  }
  return text.length;
}

/**
 * G-06: a `SelectInput` or `MultiSelect` call site without `visibleCount`
 * whose options are not a static list (an inline array literal or an
 * UPPER_CASE constant). Options computed from data can grow with the
 * workspace (apps, landing zones, connectors, frameworks, targets; #4239).
 */
export function unboundedPicker(text: string): number[] {
  const hits: number[] = [];
  const re = /<(SelectInput|MultiSelect)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = text.slice(m.index, openingTagEnd(text, m.index));
    if (/\bvisibleCount\b/.test(tag)) continue;
    const opts = /\boptions=\{\s*([\s\S]{0,40})/.exec(tag);
    const expr = opts ? opts[1] : '';
    if (expr.startsWith('[') || /^[A-Z][A-Z0-9_]*\s*\}/.test(expr)) continue;
    hits.push(text.slice(0, m.index).split('\n').length);
  }
  return hits;
}

const COLOUR_PROP = /\b(color|borderColor|backgroundColor|inkColor)\s*[=:]\s*\{?[^,}]*?(['"`])(black|red|green|yellow|blue|magenta|cyan|white|gray|grey|blackBright|redBright|greenBright|yellowBright|blueBright|magentaBright|cyanBright|whiteBright|#[0-9a-fA-F]{3,6})\2/;

/**
 * G-13: a colour outside theme.ts: an Ink colour name or hex value given to
 * `color`, `borderColor`, `backgroundColor` (JSX or object property, also in
 * a ternary), or `dimColor` used directly instead of the muted or info token.
 */
export function colourLiteral(text: string): number[] {
  return lineOffenders(text, (code) => COLOUR_PROP.test(code) || /\bdimColor\b/.test(code));
}

/** G-07: a screen file (`*Screen.tsx`, `*Menu.tsx`, `*Wizard.tsx`) is a screen. */
export function isScreenFile(file: string): boolean {
  return /(Screen|Menu|Wizard)\.tsx$/.test(file);
}

/**
 * G-07: a screen that does not render ScreenLayout (one offender at line 1).
 * #4256: a flow screen may render through FlowFrame
 * (`module-app-assessment/src/tui/assess/shared/flow-frame.tsx`, which draws
 * ScreenLayout, or the same blocks in the same order for the composite
 * pickers that bring their own hints and box). Such a screen passes only when
 * no phase still draws the legacy header: no `<Header` element and no
 * `Header={...}` prop handed to a shared phase.
 */
export function notOnScreenLayout(text: string): number[] {
  if (/<ScreenLayout\b/.test(text)) return [];
  const onFlowFrame = /<FlowFrame\b/.test(text);
  const legacyHeader = /<Header\b/.test(text) || /\bHeader=\{/.test(text);
  return onFlowFrame && !legacyHeader ? [] : [1];
}

// #4343 (Design 126 audit 2026-11-10, sections 5.1 U-2, U-3 and 5.2 B-1 to B-5):
// the blind spots of the gates above. Each rule is added to its gate, so the
// gate's allowlist pins today's offenders and may only shrink.

/** U-2: the tui-kit files that own a rule's construct (the central components); every other tui-kit file is scanned. */
export const TUI_KIT_OWNERS: Readonly<Record<'cursor' | 'status' | 'keys', readonly string[]>> = {
  // ColourLegend shows one sample per token (M-00), StatusLabel marks the selected status row.
  cursor: ['components/SelectInput.tsx', 'components/MultiSelect.tsx', 'components/picker.ts', 'components/ColourLegend.tsx', 'components/StatusLabel.tsx'],
  status: ['components/StatusLabel.tsx', 'theme.ts', 'components/ColourLegend.tsx'],
  keys: ['components/KeyHints.tsx'],
};

/** True when `file` is a tui-kit file that owns the construct of `rule`. */
export function ownsConstruct(file: string, rule: keyof typeof TUI_KIT_OWNERS): boolean {
  const f = file.split('\\').join('/');
  return f.includes('/@swao/tui-kit/src/') && TUI_KIT_OWNERS[rule].some((o) => f.endsWith(`/tui-kit/src/${o}`));
}

/** B-2 (G-02): a cursor row drawn with the central CURSOR_MARKER outside SelectInput and MultiSelect. */
export function localCursorRow(text: string): number[] {
  return lineOffenders(text, (code) => /\?\s*CURSOR_MARKER\b|\bCURSOR_MARKER\s*:/.test(code));
}

// A status key mapped to a padded status word or an upper case one (a column of
// row text); a map to a token or a status level ({ ok: 'ok', warn: 'warning' }) is not.
const LOCAL_STATUS_ENTRY = /\b(?:ok|warn|warning|fail|failed|missing|waiting|info|cancelled|pass)\s*:\s*(['"`])(?:\s*(?:ok|warn|warning|fail|failed|missing|waiting|info|cancelled|pass)\s+|\s*(?:OK|WARN|FAIL|INFO|PASS)\s*)\1/;

/** B-5 (G-03): a local status word table (`{ ok: 'ok     ', warn: 'warn   ' }`) instead of STATUS_MAP and StatusLabel. */
export function localStatusTable(text: string): number[] {
  return lineOffenders(text, (code) => LOCAL_STATUS_ENTRY.test(code));
}

const KEY_LETTER_SENTENCE = /(['"`]|\s)[A-Z] (skips|toggles|opens|adds|removes|deletes|creates|selects|keeps|edits|starts|runs|retries|refreshes|saves|confirms|cancels|leaves|returns|continues|aborts)\b/;
const KEY_NAMED_SENTENCE = /\b(Enter|Esc|Space|Tab|Backspace) (key )?(to |(skips|toggles|opens|adds|removes|deletes|creates|selects|keeps|edits|starts|runs|retries|refreshes|saves|confirms|cancels|leaves|returns|continues|aborts)\b)/;

/**
 * B-3 (G-04): a sentence in a string that names a key and what it does, outside
 * KeyHints: a single letter key ("S skips this step") or a named key with a verb
 * or "to" ("Esc returns to the menu", "Space to toggle").
 */
export function keySentence(text: string): number[] {
  return lineOffenders(text, (code) => KEY_LETTER_SENTENCE.test(code) || KEY_NAMED_SENTENCE.test(code));
}

/**
 * B-4 (G-11): a `swao <command>` in screen text ("Running swao health-check...").
 * The guidance `cli` field, a "CLI:" mention and child process argument lists
 * are not screen text (the exclusions of cliOnScreen).
 */
export function swaoCommandOnScreen(text: string): number[] {
  return lineOffenders(text, (code) =>
    /(['"`>])[^'"`<]*\bswao [a-z][a-z-]+/.test(code)
    && !/\bcli\s*:|CLI:|['"`]CLI['"`]|spawn|execFile|execSync|args\.push|argv/.test(code));
}

/** B-1 (G-07): a Setup Wizard step file (setup/ and wizard/steps/, not the frame itself). */
export function isWizardStepFile(file: string): boolean {
  const f = file.split('\\').join('/');
  if (!f.endsWith('.tsx')) return false;
  if (f.endsWith('/setup/setup-frame.tsx')) return false;
  return f.includes('/swao/src/setup/') || f.includes('/tui/screens/wizard/steps/');
}

/**
 * B-1 (G-07): a wizard step that draws the frame blocks itself (key hints,
 * guidance box, step title or header) instead of handing them to the wizard
 * through SetupStepFrame. One offender per drawn block.
 */
export function stepBypassesFrame(text: string): number[] {
  // A level 2 StepTitle is a heading inside the content (Design 126 section 8), not block 4.
  return lineOffenders(text, (code) =>
    /<(KeyHints|GuidanceBox|HeaderView|Header|ScreenLayout)\b/.test(code)
    || (/<StepTitle\b/.test(code) && !/level=\{2\}/.test(code)));
}

/** The offending lines of several rules, each line once, in order. */
export function anyOf(...rules: Array<(text: string) => number[]>): (text: string) => number[] {
  return (text: string) => [...new Set(rules.flatMap((r) => r(text)))].sort((a, b) => a - b);
}
