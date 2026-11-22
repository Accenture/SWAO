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

/**
 * Normalise dashes in LLM-emitted and WSP-stored text (CLAUDE.md section 5.1;
 * #3240, #3244, #3291). Single implementation shared by the CLI text report
 * (swao/src/commands/report.ts) and the HTML publication renderer
 * (@swao/publication-render blocks/helpers.ts); Design 110 D-28.
 *
 * Project guardrail: no em-dash, en-dash, or double-dash in report output.
 *   - U+2014 em-dash (with any surrounding spaces or tabs) -> ", "
 *   - U+2013 en-dash -> single hyphen
 *   - spaced ASCII double-dash separator " -- " -> ", "
 *
 * CLI flags such as `--report` are untouched (no surrounding spaces).
 * Apply to TEXT before HTML escaping, never to rendered HTML: a whole-page
 * pass would corrupt HTML comments, CSS custom properties and inline JS.
 */
export function normalizeDashes(text: string): string {
  return replaceEmDashes(text)
    .replace(/\u2013/g, '-')
    .split(' -- ').reduce(joinWithComma);
}

/**
 * #4467: join two pieces at a replaced dash with ", ", or with the blank only
 * when the left piece already ends with a comma (`NOT NULL,  -- hash` gives
 * `NOT NULL, hash`, not `NOT NULL, , hash`), or with nothing when the right
 * piece starts with one. Linear: only the blanks next to the join are read.
 */
function joinWithComma(left: string, right: string): string {
  let end = left.length;
  while (end > 0 && isBlank(left.charCodeAt(end - 1))) end--;
  if (end > 0 && left.charCodeAt(end - 1) === 0x2c) return `${left.slice(0, end)} ${right}`;
  let start = 0;
  while (start < right.length && isBlank(right.charCodeAt(start))) start++;
  if (start < right.length && right.charCodeAt(start) === 0x2c) return `${left}${right.slice(start)}`;
  return `${left}, ${right}`;
}

const isBlank = (code: number): boolean => code === 0x20 || code === 0x09;

/**
 * Every em-dash together with the spaces and tabs on either side becomes ", ".
 * Same result as `replace(/[ \t]*\u2014[ \t]*\/g, ', ')` but linear: the text
 * is split at the dashes and each piece loses its blanks next to a dash, so a
 * long run of blanks cannot cause regex backtracking (CodeQL js/polynomial-redos).
 */
function replaceEmDashes(text: string): string {
  if (!text.includes('\u2014')) return text;
  const parts = text.split('\u2014');
  const last = parts.length - 1;
  return parts.map((part, i) => {
    let start = 0;
    let end = part.length;
    if (i > 0) while (start < end && isBlank(part.charCodeAt(start))) start++;
    if (i < last) while (end > start && isBlank(part.charCodeAt(end - 1))) end--;
    return part.slice(start, end);
  }).reduce(joinWithComma);
}
