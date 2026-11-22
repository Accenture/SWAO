// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, semantic colour tokens (Design 126 section 15)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4258 (TUI-16): the only place in the TUI where an Ink colour name appears
// (gate G-13, tui-colour-central.test.ts). Components and screens style text
// with `tone(token)` and borders with `tokenColor('border')`, never with a
// colour name. Each token maps to exactly one Ink style; two tokens may share
// a colour, a token never has two (section 15.2). A light terminal variant
// (Q-11, not now) would change this file only.

/** The semantic colour tokens of Design 126 section 15.2. */
export type Token =
  | 'brand'
  | 'text'
  | 'muted'
  | 'selection'
  | 'accent'
  | 'ok'
  | 'info'
  | 'warning'
  | 'error'
  | 'progressRunning'
  | 'progressDone'
  | 'border';

/** The Ink text props a token sets. */
export interface InkStyle {
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
}

/** Token to Ink style (section 15.2). `text` is the terminal default. */
export const TOKENS: Readonly<Record<Token, Readonly<InkStyle>>> = {
  brand: { color: 'cyanBright', bold: true },
  text: {},
  muted: { dimColor: true },
  selection: { color: 'cyanBright' },
  accent: { color: 'cyan' },
  ok: { color: 'green' },
  info: { dimColor: true },
  warning: { color: 'yellow' },
  error: { color: 'red' },
  progressRunning: { color: 'cyan' },
  progressDone: { color: 'green' },
  border: { color: 'gray' },
};

/** Every token, in the order of the section 15.2 table (mockup M-00). */
export const TOKEN_NAMES: readonly Token[] = [
  'brand', 'text', 'muted', 'selection', 'accent', 'ok', 'info', 'warning', 'error', 'progressRunning', 'progressDone', 'border',
];

/**
 * Ink props of `token`, to spread on a `<Text>`: `<Text {...tone('muted')}>`.
 * `bold` overrides the token's weight (for example `brand` without bold for
 * a subtitle or a group header, section 15.3).
 */
export function tone(token: Token, opts: { bold?: boolean } = {}): InkStyle {
  const style: InkStyle = { ...TOKENS[token] };
  if (opts.bold !== undefined) style.bold = opts.bold;
  return style;
}

/** The status levels of Design 126 section 6 (one word and one token each). */
export type StatusLevel = 'ok' | 'info' | 'warn' | 'fail' | 'missing' | 'waiting' | 'cancelled';

/** Status level to token (section 15.4); STATUS_MAP takes its colours from here. */
export const STATUS_TOKENS: Readonly<Record<StatusLevel, Token>> = {
  ok: 'ok',
  info: 'info',
  warn: 'warning',
  waiting: 'warning',
  cancelled: 'warning',
  fail: 'error',
  missing: 'error',
};

/** The Ink colour of `token` for props that take a colour only (`borderColor`); undefined for the terminal default. */
export function tokenColor(token: Token): string | undefined {
  return TOKENS[token].color;
}

/** The Ink style of a token in words ("cyanBright", "dimColor", "default"), for the M-00 legend. */
export function inkStyleName(style: Readonly<InkStyle>): string {
  if (style.color) return style.color;
  if (style.dimColor) return 'dimColor';
  return 'default';
}
