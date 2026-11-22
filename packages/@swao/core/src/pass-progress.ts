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

// #4266: progress of long deterministic pass work (the source walk, the
// language census, the input folder walk, the Pass 01 phases). These loops
// are synchronous, so a timer (the run heartbeat of `swao assess`) cannot
// fire while they run; the loops call reportPassProgress instead and the
// sink installed by `swao assess` decides, by elapsed time, whether to write
// an assessment.pass.progress event. Without a sink (tests, other commands)
// a report is a no-op. Counts only, never a path: a log line must not carry
// file names of the client source.

export interface PassProgress {
  /** Work step: `source_walk`, `language_census`, `input_walk` or a pass phase (`inventory:manifests`). */
  phase: string;
  /** Files seen or processed so far in this step. */
  files?: number;
  /** Directories walked so far in this step. */
  dirs?: number;
}

export type PassProgressSink = (p: PassProgress) => void;

let sink: PassProgressSink | null = null;

/** Install (or with null remove) the process-wide progress sink. */
export function setPassProgressSink(next: PassProgressSink | null): void {
  sink = next;
}

/** Report progress; the sink throttles. Never throws. */
export function reportPassProgress(p: PassProgress): void {
  if (!sink) return;
  try { sink(p); } catch { /* progress is best-effort */ }
}

/**
 * Report progress and yield to the event loop, so timers (the run heartbeat)
 * can fire between the synchronous steps of an async pass.
 */
export async function yieldPassProgress(p: PassProgress): Promise<void> {
  reportPassProgress(p);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export interface RunHeartbeatOptions {
  /** Gap between two heartbeats (the 30 s run heartbeat). */
  intervalMs: number;
  /** Minimum gap between a heartbeat or progress line and the next progress line. */
  progressGapMs: number;
  /** Writes one assessment.heartbeat line. */
  heartbeat: () => void;
  /** Writes one assessment.pass.progress line. */
  progress: (p: PassProgress) => void;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface RunHeartbeat {
  /** The progress sink to install with setPassProgressSink. */
  sink: PassProgressSink;
  /** Start the timer (the first heartbeat follows intervalMs after start). */
  start: () => void;
  /** Stop the timer; the sink writes nothing afterwards. */
  stop: () => void;
}

/**
 * #4300: the run heartbeat of `swao assess`, time-based in two ways.
 *
 * - A timer writes a heartbeat `intervalMs` after the last heartbeat. The
 *   timer is re-armed after every heartbeat, so the gap never exceeds the
 *   interval while the event loop is free.
 * - A timer cannot fire inside synchronous work (the source walk, the
 *   language census, the file scans of Passes 03 and 26). Those loops call
 *   reportPassProgress for every file; the sink compares the clock and, when
 *   the heartbeat is overdue, writes it itself (and re-arms the timer), and
 *   writes a progress line when `progressGapMs` passed since the last line.
 *   The cost per call is one clock read.
 */
export function createRunHeartbeat(opts: RunHeartbeatOptions): RunHeartbeat {
  const now = opts.now ?? Date.now;
  let lastBeat = now();
  let lastLine = lastBeat;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const beat = (): void => {
    const t = now();
    lastBeat = t;
    lastLine = t;
    try { opts.heartbeat(); } catch { /* best-effort */ }
  };
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!running) return;
    timer = setTimeout(() => { timer = null; beat(); arm(); }, Math.max(1, lastBeat + opts.intervalMs - now()));
  };

  return {
    sink: (p) => {
      if (!running) return;
      const t = now();
      const progressDue = t - lastLine >= opts.progressGapMs;
      if (t - lastBeat >= opts.intervalMs) {
        beat();
        arm();
      }
      if (progressDue) {
        lastLine = t;
        try { opts.progress(p); } catch { /* best-effort */ }
      }
    },
    start: () => {
      running = true;
      lastBeat = now();
      lastLine = lastBeat;
      arm();
    },
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * The time throttle `swao assess` wraps around its event writer: `write` runs
 * when at least `minGapMs` passed since the last beat (a write here or a
 * heartbeat recorded through `beat`). `now` is injectable for tests.
 */
export function createProgressThrottle(
  minGapMs: number,
  write: (p: PassProgress) => void,
  now: () => number = Date.now,
): { sink: PassProgressSink; beat: () => void } {
  let last = now();
  return {
    sink: (p) => {
      const t = now();
      if (t - last < minGapMs) return;
      last = t;
      write(p);
    },
    beat: () => { last = now(); },
  };
}
