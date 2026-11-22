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

/**
 * #4461: the probe meter. Each health check probe gets its cause named when it
 * takes longer than SLOW_PROBE_MS: the files and bytes it read (reported by the
 * shared app config walk and by the probes' own reads), its CPU time (CPU bound:
 * parsing; little CPU: waiting on the disk, a scanner or a child process) and
 * its slowest named step (for example one tool detection).
 *
 * The meter is module state that is active only while a health check gathers
 * its probes (gatherProbes); outside that, the report functions do nothing.
 */

/** #4461: a probe above this duration gets a slow_cause in health-check.probe.complete. */
export const SLOW_PROBE_MS = 10_000;

export interface ProbeMeterReading {
  cpu_ms: number;
  files_read: number;
  bytes_read: number;
  slowest_step?: string;
  slowest_step_ms?: number;
}

interface MeterState {
  files: number;
  bytes: number;
  steps: Map<string, number>;
  cpu: NodeJS.CpuUsage;
}

let active: MeterState | null = null;

function fresh(): MeterState {
  return { files: 0, bytes: 0, steps: new Map(), cpu: process.cpuUsage() };
}

/** Starts the meter (gatherProbes); returns the function that stops it. */
export function startProbeMeter(): () => void {
  const previous = active;
  active = fresh();
  return () => { active = previous; };
}

/** Records one file read of `bytes` bytes for the running probe. */
export function meterFileRead(bytes: number): void {
  if (!active) return;
  active.files += 1;
  active.bytes += bytes;
}

function addStep(state: MeterState, name: string, ms: number): void {
  state.steps.set(name, (state.steps.get(name) ?? 0) + ms);
}

/** Times one named step of the running probe (synchronous). */
export function meterStep<T>(name: string, fn: () => T): T {
  const state = active;
  if (!state) return fn();
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    addStep(state, name, Date.now() - t0);
  }
}

/** Times one named asynchronous step of the running probe. */
export async function meterStepAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const state = active;
  if (!state) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    addStep(state, name, Date.now() - t0);
  }
}

/** Returns the reading since the previous take (or the start) and resets the counters. */
export function takeProbeMeterReading(): ProbeMeterReading | null {
  const s = active;
  if (!s) return null;
  active = fresh();
  const cpu = process.cpuUsage(s.cpu);
  let slowest: [string, number] | undefined;
  for (const entry of s.steps) if (!slowest || entry[1] > slowest[1]) slowest = entry;
  return {
    cpu_ms: Math.round((cpu.user + cpu.system) / 1000),
    files_read: s.files,
    bytes_read: s.bytes,
    ...(slowest ? { slowest_step: slowest[0], slowest_step_ms: slowest[1] } : {}),
  };
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * #4461: the cause of a slow probe in one sentence, for example "CPU 9.1 s of
 * 10.4 s (parsing or computing); read 702 files (1.2 MB); slowest step detect
 * osv-scanner 5.0 s". Null when the probe was not slow.
 */
export function slowProbeCause(elapsedMs: number, reading: ProbeMeterReading | null): string | null {
  if (elapsedMs <= SLOW_PROBE_MS || !reading) return null;
  const cpuShare = reading.cpu_ms / Math.max(1, elapsedMs);
  const parts = [
    cpuShare >= 0.5
      ? `CPU ${seconds(reading.cpu_ms)} of ${seconds(elapsedMs)} (parsing or computing)`
      : `waiting ${seconds(Math.max(0, elapsedMs - reading.cpu_ms))} of ${seconds(elapsedMs)} (disk, scanner, child process or network; CPU ${seconds(reading.cpu_ms)})`,
  ];
  if (reading.files_read > 0) parts.push(`read ${reading.files_read} files (${(reading.bytes_read / 1_048_576).toFixed(1)} MB)`);
  if (reading.slowest_step) parts.push(`slowest step ${reading.slowest_step} ${seconds(reading.slowest_step_ms ?? 0)}`);
  return parts.join('; ');
}

/** #4461: the log fields of a probe reading: CPU time always, files and steps when any, the cause when slow. */
export function probeMeterLogFields(elapsedMs: number, reading: ProbeMeterReading | null): Record<string, unknown> {
  if (!reading) return {};
  const cause = slowProbeCause(elapsedMs, reading);
  return {
    cpu_ms: reading.cpu_ms,
    ...(reading.files_read > 0 ? { files_read: reading.files_read, bytes_read: reading.bytes_read } : {}),
    ...(reading.slowest_step ? { slowest_step: reading.slowest_step, slowest_step_ms: reading.slowest_step_ms } : {}),
    ...(cause ? { slow_cause: cause } : {}),
  };
}
