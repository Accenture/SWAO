// TU-01 credential-window: windowing pure-function tests (#1413)
import { describe, it, expect } from 'vitest';
import { computeCredentialWindow, CRED_CHROME_RESERVED, CRED_MIN_VISIBLE } from './credential-window.js';

describe('computeCredentialWindow', () => {
  // 35-line list, 24-row terminal => viewportSize = max(4, 24-12) = 12
  const ROWS = 24;
  const TOTAL = 35;
  const VP = Math.max(CRED_MIN_VISIBLE, ROWS - CRED_CHROME_RESERVED);

  it('starts at top with offset 0', () => {
    const w = computeCredentialWindow(0, TOTAL, ROWS);
    expect(w).toEqual({ start: 0, end: VP, aboveCount: 0, belowCount: TOTAL - VP });
  });

  it('scrolls down by positive offset', () => {
    const w = computeCredentialWindow(5, TOTAL, ROWS);
    expect(w).toEqual({ start: 5, end: 5 + VP, aboveCount: 5, belowCount: TOTAL - 5 - VP });
  });

  it('clamps offset when scrolled past the end', () => {
    const maxOffset = TOTAL - VP;
    const w = computeCredentialWindow(maxOffset + 99, TOTAL, ROWS);
    expect(w.start).toBe(maxOffset);
    expect(w.end).toBe(TOTAL);
    expect(w.belowCount).toBe(0);
  });

  it('clamps negative offset to 0', () => {
    const w = computeCredentialWindow(-5, TOTAL, ROWS);
    expect(w.start).toBe(0);
    expect(w.aboveCount).toBe(0);
  });

  it('handles total shorter than viewport -- no scrolling needed', () => {
    const w = computeCredentialWindow(0, VP - 2, ROWS);
    expect(w).toEqual({ start: 0, end: VP - 2, aboveCount: 0, belowCount: 0 });
  });

  it('enforces CRED_MIN_VISIBLE on very short terminals', () => {
    const w = computeCredentialWindow(0, 20, 6); // 6-row terminal
    expect(w.end - w.start).toBe(CRED_MIN_VISIBLE);
  });
});
