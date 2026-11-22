// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4267 (Design 098 section 4.1): the Assess screen's event writer reads the
// child's stdout line by line. The `[pass-start]` / `[pass-done]` markers of
// `swao assess` give the canonical pass key, name, pass_id, run_id and
// duration for assess.app.pass.start / .complete (the same keys as the engine
// assessment.pass.* events). Each output line is attributed to the pass it is
// about, updated per line, so "Running Pass 02" is logged as pass 02 and not
// as the previous pass. Without markers (an older child) the operator lines
// "Running Pass NN, name..." and "[ok] Pass NN, name" are the fallback,
// with the name cleaned of trailing dots. #4402: those lines are parsed by
// the one parser in @swao/core pass-marker.ts.

import { parsePassMarker, parsePassResultLine, parsePassRunningLine } from '@swao/core';

export interface PassLineEvent {
  code: 'assess.app.pass.start' | 'assess.app.pass.complete';
  message: string;
  context: Record<string, unknown>;
}

export interface PassLineResult {
  /** Pass key the line is about (tui.output context.pass); undefined before the first pass. */
  pass: string | undefined;
  /** assess.app.pass.* events to write for this line. */
  events: PassLineEvent[];
  /** True for a marker line: not shown and not logged as tui.output. */
  marker: boolean;
}

interface CurrentPass {
  num: string;
  key: string;
  name: string;
  pass_id?: string;
  run_id?: string;
  startedAt: number;
}


/** Pass name as the operator line writes it, without trailing dots or punctuation. */
export function cleanPassName(raw: string): string {
  return raw.replace(/[.,:;]+$/, '');
}

export interface PassLineTracker {
  consume(line: string): PassLineResult;
}

/** One tracker per child process. `now` is injectable for tests. */
export function createPassLineTracker(now: () => number = Date.now): PassLineTracker {
  let current: CurrentPass | undefined;
  let markersSeen = false;

  const consume = (line: string): PassLineResult => {
    const marker = parsePassMarker(line);
    if (marker) {
      markersSeen = true;
      const ids = { pass_id: marker.pass_id, ...(marker.run_id ? { run_id: marker.run_id } : {}) };
      if (marker.kind === 'start') {
        current = { num: marker.num, key: marker.key, name: marker.name, ...ids, startedAt: now() };
        return {
          pass: marker.key,
          marker: true,
          events: [{
            code: 'assess.app.pass.start',
            message: `Pass ${marker.num} ${marker.name} start`,
            context: { pass: marker.key, name: marker.name, num: marker.num, ...ids },
          }],
        };
      }
      return {
        pass: marker.key,
        marker: true,
        events: [{
          code: 'assess.app.pass.complete',
          message: `Pass ${marker.num} ${marker.name} complete`,
          context: {
            pass: marker.key, name: marker.name, num: marker.num, ...ids,
            ...(marker.status ? { status: marker.status } : {}),
            ...(typeof marker.duration_ms === 'number' ? { duration_ms: marker.duration_ms } : {}),
            ...(typeof marker.signals === 'number' ? { signals: marker.signals } : {}),
          },
        }],
      };
    }

    const events: PassLineEvent[] = [];
    const running = parsePassRunningLine(line);
    if (running) {
      const num = running.num;
      const name = cleanPassName(running.name);
      // With markers the [pass-start] line came first and already names this pass.
      if (!(markersSeen && current?.num === num)) {
        current = { num, key: name, name, startedAt: now() };
        if (!markersSeen) {
          events.push({ code: 'assess.app.pass.start', message: `Pass ${num} ${name} start`, context: { pass: name, name, num } });
        }
      }
      return { pass: current.key, events, marker: false };
    }
    const result = parsePassResultLine(line);
    const finished = result && result.status !== 'fail' ? result : null;
    if (finished && !markersSeen) {
      const num = finished.num;
      const name = cleanPassName(finished.name);
      const started = current?.num === num ? current.startedAt : undefined;
      events.push({
        code: 'assess.app.pass.complete',
        message: `Pass ${num} ${name} complete`,
        context: {
          pass: name, name, num, status: finished.status,
          ...(started !== undefined ? { duration_ms: now() - started } : {}),
        },
      });
      return { pass: name, events, marker: false };
    }
    return { pass: current?.key, events, marker: false };
  };

  return { consume };
}
