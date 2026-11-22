// #4267: stdout pass markers of `swao assess` (Design 098 section 4.1).

import { describe, it, expect } from 'vitest';
import { formatPassMarker, parsePassMarker, passMarkersEnabled, passLabel, parsePassRunningLine, parsePassResultLine, parsePassProgressLine, passLabelsIn, countPassOkLines } from './pass-marker.js';

describe('pass markers (#4267)', () => {
  it('round-trips a start and a done marker', () => {
    const start = formatPassMarker({ kind: 'start', num: '01', key: 'inv', name: 'inventory', pass_id: '2026-11-09T14-08-36-p01-inv', run_id: '2026-11-09T14:08:36.531Z' });
    expect(start).toBe('[pass-start] num=01 key=inv name=inventory pass_id=2026-11-09T14-08-36-p01-inv run_id=2026-11-09T14:08:36.531Z');
    expect(parsePassMarker(start)).toEqual({ kind: 'start', num: '01', key: 'inv', name: 'inventory', pass_id: '2026-11-09T14-08-36-p01-inv', run_id: '2026-11-09T14:08:36.531Z' });
    const done = formatPassMarker({ kind: 'done', num: '01', key: 'inv', name: 'inventory', pass_id: 'p', run_id: 'r', status: 'ok', duration_ms: 121010.4, signals: 7 });
    expect(done).toBe('[pass-done] num=01 key=inv name=inventory pass_id=p run_id=r status=ok duration_ms=121010 signals=7');
    expect(parsePassMarker(done)).toMatchObject({ kind: 'done', key: 'inv', status: 'ok', duration_ms: 121010, signals: 7 });
  });

  it('ignores operator lines and incomplete markers', () => {
    expect(parsePassMarker('[info] Running Pass 01 -- inventory...')).toBeNull();
    expect(parsePassMarker('[ok]  Pass 01 -- inventory  7 signals emitted')).toBeNull();
    expect(parsePassMarker('[pass-start] num=01 name=inventory')).toBeNull();
    expect(parsePassMarker('see [pass-start] num=01 key=inv pass_id=x')).toBeNull();
  });

  it('accepts a trailing carriage return (Windows child stdout)', () => {
    expect(parsePassMarker('[pass-start] num=02 key=state name=state_analysis pass_id=x\r')?.key).toBe('state');
  });

  it('does not match the TUI pass-counting patterns', () => {
    const line = formatPassMarker({ kind: 'done', num: '03', key: 'data', name: 'data_classification', pass_id: 'x', status: 'ok', duration_ms: 1, signals: 0 });
    expect(/Pass (\d+) -- (\S+)/i.test(line)).toBe(false);
    expect(/\[ok\]\s+Pass\s+(\d+)/i.test(line)).toBe(false);
    expect(/\[info\]\s+Running Pass/i.test(line)).toBe(false);
  });

  it('is opt-in: only SWAO_PASS_MARKERS=1 turns the markers on', () => {
    expect(passMarkersEnabled({})).toBe(false);
    expect(passMarkersEnabled({ SWAO_PASS_MARKERS: '1' })).toBe(true);
    expect(passMarkersEnabled({ SWAO_PASS_MARKERS: '0' })).toBe(false);
    expect(passMarkersEnabled({ SWAO_PASS_MARKERS: 'true' })).toBe(false);
  });
});

describe('operator pass lines (#4402): one formatter, one parser', () => {
  it('PL-01 the label has no spaced double hyphen', () => {
    expect(passLabel('04', 'context_ingestion')).toBe('Pass 04, context_ingestion');
    expect(passLabel(11, 'BSI_C5')).toBe('Pass 11, BSI_C5');
    expect(`[info] Running ${passLabel('04', 'context_ingestion')}...`).not.toMatch(/ -- /);
  });

  it('PL-02 parses the running line of the formatter and of an older child', () => {
    expect(parsePassRunningLine(`[info] Running ${passLabel('04', 'context_ingestion')}...`)).toEqual({ num: '04', name: 'context_ingestion' });
    expect(parsePassRunningLine('[info] Running Pass 01 -- inventory...')).toEqual({ num: '01', name: 'inventory' });
    expect(parsePassRunningLine('[info] Running Pass 23, lzr (landing_zone_readiness) for "lz"...')).toEqual({ num: '23', name: 'lzr' });
    expect(parsePassRunningLine('[ok]  Pass 04, context_ingestion  5 signals')).toBeNull();
  });

  it('PL-03 parses ok, skip and fail result lines in both forms', () => {
    expect(parsePassResultLine('[ok]  Pass 04, context_ingestion  5 signals  ->  wsp/runs/x/passes/04-ctx.yaml  [22s]')).toEqual({ status: 'ok', num: '04', name: 'context_ingestion' });
    expect(parsePassResultLine('[skip]  Pass 02, state_analysis  0 items')).toEqual({ status: 'skip', num: '02', name: 'state_analysis' });
    expect(parsePassResultLine('[ok]  Pass 01 -- inventory  7 signals')).toEqual({ status: 'ok', num: '01', name: 'inventory' });
    expect(parsePassResultLine('[ok]  Pass inv recovered via secondary LLM connector')).toBeNull();
  });

  it('PL-04 parses the sub-progress line', () => {
    expect(parsePassProgressLine(`[progress] ${passLabel(11, 'BSI_C5')} (3/7)`)).toEqual({ num: '11', label: 'BSI_C5', done: 3, total: 7 });
    expect(parsePassProgressLine('[progress] Pass 11 -- GDPR (1/2)')).toEqual({ num: '11', label: 'GDPR', done: 1, total: 2 });
    expect(parsePassProgressLine('[info] Running Pass 11, x...')).toBeNull();
  });

  it('PL-05 finds every label in a chunk and counts the ok lines', () => {
    const chunk = `[ok]  ${passLabel('04', 'context_ingestion')}  6 signals\n[info] Running ${passLabel(11, 'compliance_evaluation')}...\n`;
    expect(passLabelsIn(chunk).map((p) => p.name)).toEqual(['context_ingestion', 'compliance_evaluation']);
    expect(countPassOkLines(chunk)).toBe(1);
    expect(countPassOkLines('[ok]  Pass 04, a  1\n[ok]  Pass 05 -- b  2\n')).toBe(2);
  });

  it('PL-06 a marker line is not a pass label', () => {
    const line = formatPassMarker({ kind: 'start', num: '03', key: 'data', name: 'data_classification', pass_id: 'x' });
    expect(passLabelsIn(line)).toEqual([]);
    expect(parsePassRunningLine(line)).toBeNull();
  });
});
