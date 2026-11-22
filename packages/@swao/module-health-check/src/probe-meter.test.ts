// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, expect, it } from 'vitest';
import {
  meterFileRead,
  meterStep,
  probeMeterLogFields,
  slowProbeCause,
  SLOW_PROBE_MS,
  startProbeMeter,
  takeProbeMeterReading,
} from './probe-meter.js';

describe('probe meter (#4461)', () => {
  it('does nothing outside a running meter', () => {
    meterFileRead(100);
    expect(meterStep('x', () => 7)).toBe(7);
    expect(takeProbeMeterReading()).toBeNull();
    expect(probeMeterLogFields(20_000, null)).toEqual({});
  });

  it('counts files and bytes and names the slowest step, then resets', () => {
    const stop = startProbeMeter();
    try {
      meterFileRead(1000);
      meterFileRead(500);
      meterStep('fast', () => undefined);
      const t0 = Date.now();
      meterStep('slow', () => { while (Date.now() - t0 < 20) { /* busy */ } });
      const r = takeProbeMeterReading()!;
      expect(r.files_read).toBe(2);
      expect(r.bytes_read).toBe(1500);
      expect(r.slowest_step).toBe('slow');
      expect(r.slowest_step_ms).toBeGreaterThanOrEqual(15);
      const next = takeProbeMeterReading()!;
      expect(next.files_read).toBe(0);
      expect(next.slowest_step).toBeUndefined();
    } finally {
      stop();
    }
  });

  it('names the cause of a probe over 10 s only', () => {
    const reading = { cpu_ms: 900, files_read: 702, bytes_read: 1_258_291, slowest_step: 'detect osv-scanner', slowest_step_ms: 5000 };
    expect(slowProbeCause(SLOW_PROBE_MS, reading)).toBeNull();
    expect(slowProbeCause(12_000, reading)).toBe(
      'waiting 11.1 s of 12.0 s (disk, scanner, child process or network; CPU 0.9 s); read 702 files (1.2 MB); slowest step detect osv-scanner 5.0 s',
    );
    expect(slowProbeCause(12_000, { cpu_ms: 11_000, files_read: 0, bytes_read: 0 })).toBe('CPU 11.0 s of 12.0 s (parsing or computing)');
    const fields = probeMeterLogFields(12_000, reading);
    expect(fields).toMatchObject({ cpu_ms: 900, files_read: 702, bytes_read: 1_258_291, slowest_step: 'detect osv-scanner', slowest_step_ms: 5000 });
    expect(String(fields['slow_cause'])).toContain('slowest step detect osv-scanner');
    expect(probeMeterLogFields(500, { cpu_ms: 10, files_read: 0, bytes_read: 0 })).toEqual({ cpu_ms: 10 });
  });
});
