// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment, tests of the pass progress line parse
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { completedPassCount, isPassResultLine, lastPassName, passSubProgress } from './pass-progress-line.js';

describe('pass progress lines of the assess command (#4213, #4257)', () => {
  it('PP-01 the last pass of a chunk wins, trailing dots removed (#0403)', () => {
    expect(lastPassName('[ok]  Pass 04 -- context_ingestion  6 signals\n[info] Running Pass 11 -- compliance_evaluation...')).toBe('compliance_evaluation');
    expect(lastPassName('no pass here')).toBeNull();
  });

  it('PP-02 counts each completed pass once, also two in one chunk (#0379)', () => {
    expect(completedPassCount('[ok]  Pass 04 -- a  1 signal\n[ok]  Pass 05 -- b  2 signals\n[info] Running Pass 06 -- c...')).toBe(2);
    expect(completedPassCount('[info] Running Pass 06 -- c...')).toBe(0);
  });

  it('PP-03 reads the sub-progress of a long pass', () => {
    expect(passSubProgress('[progress] Pass 11 -- BSI_C5 (3/7)')).toEqual({ label: 'BSI_C5', done: 3, total: 7 });
    expect(passSubProgress('[info] Running Pass 11 -- x...')).toBeNull();
  });

  it('PP-04 a result line is a finished or skipped pass', () => {
    expect(isPassResultLine('[ok]  Pass 04 -- context_ingestion  6 signals')).toBe(true);
    expect(isPassResultLine('[skip]  Pass 10 -- dynamic_analysis')).toBe(true);
    expect(isPassResultLine('[info] Running Pass 04 -- x')).toBe(false);
  });
});

describe('pass progress lines without the double hyphen (#4402)', () => {
  it('PP-05 reads the comma form the CLI writes', () => {
    expect(lastPassName('[ok]  Pass 04, context_ingestion  6 signals\n[info] Running Pass 11, compliance_evaluation...')).toBe('compliance_evaluation');
    expect(completedPassCount('[ok]  Pass 04, a  1 signal\n[ok]  Pass 05, b  2 signals\n[info] Running Pass 06, c...')).toBe(2);
    expect(passSubProgress('[progress] Pass 11, BSI_C5 (3/7)')).toEqual({ label: 'BSI_C5', done: 3, total: 7 });
  });
});
