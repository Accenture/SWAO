import { describe, it, expect } from 'vitest';
import { formatLzPassDone, formatLzPassStart, formatLzTargetVerdict, formatLzVerdict, parseLzRunMarker } from './lz-run-marker.js';

describe('LZ Catalog run markers (#4506)', () => {
  it('round-trips every marker through the one parser', () => {
    expect(parseLzRunMarker(formatLzPassStart('otc', 'eu-de'))).toEqual({ kind: 'pass', pass: 'lz_fit', label: 'otc:eu-de' });
    expect(parseLzRunMarker(formatLzPassDone('stackit', 'eu01'))).toEqual({ kind: 'pass-done', pass: 'lz_fit' });
    expect(parseLzRunMarker(formatLzTargetVerdict('otc/eu-de', 'NEEDS_VERIFICATION', 0))).toEqual({ kind: 'target-verdict', target: 'otc/eu-de', verdict: 'needs_verification', gaps: 0 });
    expect(parseLzRunMarker(formatLzVerdict('SOVEREIGNTY_BLOCKED'))).toEqual({ kind: 'verdict', verdict: 'sovereignty_blocked' });
  });
  it('a CRLF line is a marker; ordinary output and malformed markers are not', () => {
    expect(parseLzRunMarker(`${formatLzVerdict('READY')}\r`)).toEqual({ kind: 'verdict', verdict: 'ready' });
    expect(parseLzRunMarker('[ok]  Landing-zone fit complete  OTC: eu-de  verdict: READY  0 gap(s)')).toBeNull();
    expect(parseLzRunMarker('  Overall: NEEDS_VERIFICATION  (2 CSP/region target(s) assessed)')).toBeNull();
    expect(parseLzRunMarker('[lz-target-verdict] target=otc/eu-de verdict=ready gaps=x')).toBeNull();
    expect(parseLzRunMarker('[pass] ')).toBeNull();
  });
});
