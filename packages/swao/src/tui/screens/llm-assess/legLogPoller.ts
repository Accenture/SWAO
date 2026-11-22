// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4479: the per-call progress lines of the LLM Assessment running stage.
//
// The running stage polled the leg's app-events log every 1.5 s by reading the
// whole file and skipping the lines it had seen: the read volume grew with the
// square of the log size (a leg log grows for the whole leg). The poller reads
// only the bytes added since the last poll (LegLogTailer of
// @swao/module-llm-assessment, a byte offset and the partial last line) and
// starts a new tailer and formatter when the leg workspace changes.

import { join } from 'path';
import { LegLogTailer } from '@swao/module-llm-assessment';
import { createLegEventFormatter, type LegEventFormatter } from './legEventLines.js';

export interface LegLogPoller {
  /** The formatted lines of the events added since the last poll, and the passes done of the current leg. */
  poll(legWorkspace: string | null): { lines: string[]; passesDone: number | null };
}

/** One poller per running stage; `appId` names the app whose leg log is read. */
export function createLegLogPoller(appId: string): LegLogPoller {
  let dir: string | null = null;
  let tailer: LegLogTailer | null = null;
  let formatter: LegEventFormatter = createLegEventFormatter();
  return {
    poll(legWorkspace) {
      if (!legWorkspace) return { lines: [], passesDone: null };
      const logDir = join(legWorkspace, 'apps', appId, 'wsp', 'logs');
      if (logDir !== dir || tailer === null) {
        // A new leg: its pass count starts at 0. A new month file of the same leg is followed by the tailer.
        dir = logDir;
        tailer = new LegLogTailer(logDir);
        formatter = createLegEventFormatter();
      }
      const lines: string[] = [];
      for (const e of tailer.poll()) {
        const line = formatter.line({ code: e.code, ...(e.message !== undefined ? { message: e.message } : {}), context: e.context });
        if (line) lines.push(line);
      }
      return { lines, passesDone: formatter.passesDone() };
    },
  };
}
