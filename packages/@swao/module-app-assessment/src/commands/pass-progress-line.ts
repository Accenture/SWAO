// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment, the pass progress lines of the assess command
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================


// #4213 / #4257 (Design 126 sections 6 and 8, gates G-01 and G-03): the assess
// command prints one line per pass ("[info] Running Pass 11, name...",
// "[ok]  Pass 11, name  6 signals", "[progress] Pass 11, BSI_C5 (3/7)",
// swao/src/commands/assess.ts). The screens that spawn it (Application
// Assessment, Service Portfolio) read the pass name, the completed passes and
// the sub-progress from those lines. #4402: the line format and its one parser
// live in @swao/core pass-marker.ts (passLabel and the parse functions); this
// module keeps the screen-facing names.

import { countPassOkLines, parsePassProgressLine, passLabelsIn } from '@swao/core';

/** The pass named by the last pass label in a chunk of output (a chunk can hold two), trailing dots removed. */
export function lastPassName(text: string): string | null {
  return passLabelsIn(text).at(-1)?.name ?? null;
}

/** Passes completed in a chunk of output: one "[ok]  Pass NN, name" line each. */
export function completedPassCount(text: string): number {
  return countPassOkLines(text);
}

/** The sub-progress of a long pass ("[progress] Pass 11, BSI_C5 (3/7)"): the label, done and total. */
export function passSubProgress(text: string): { label: string; done: number; total: number } | null {
  const p = parsePassProgressLine(text);
  return p ? { label: p.label, done: p.done, total: p.total } : null;
}

/** True for the summary line of a finished or skipped pass ("[ok]  Pass 04 ...", "[skip]  Pass 10 ..."). */
export function isPassResultLine(line: string): boolean {
  return line.startsWith('[ok]  Pass ') || line.startsWith('[skip]  Pass ');
}
