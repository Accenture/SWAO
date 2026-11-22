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

// #4263: the one place Setup Wizard steps log their end. Esc reaches every
// active input handler in the same key event: a step that treats Esc as
// "keep" logs its completion, while the wizard (when the step does not capture
// Esc) leaves the setup. So a step completion is queued and written after the
// key event; when the wizard cancels the step in that event, the queued
// completion is dropped and the wizard writes `wizard.step.cancelled` instead.
// A cancelled step therefore never logs `wizard.step.complete`.

import { logPortfolio } from '@swao/core';

interface Pending { message: string; context: Record<string, unknown> }

let pending: Pending[] = [];
let cancelled = false;
let scheduled = false;

function flush(): void {
  scheduled = false;
  const batch = pending;
  pending = [];
  const drop = cancelled;
  cancelled = false;
  if (drop) return;
  for (const p of batch) {
    try { logPortfolio('info', 'wizard.step.complete', p.message, { context: p.context }); } catch { /* best-effort */ }
  }
}

/** Logs `wizard.step.complete` for `step` once the current key event is over, unless the wizard cancels it. */
export function logSetupStepComplete(step: string, message: string, context: Record<string, unknown> = {}): void {
  pending.push({ message, context: { step, ...context } });
  if (!scheduled) { scheduled = true; setImmediate(flush); }
}

/** Why the wizard left a step. */
export type SetupCancelReason = 'user_escape';

/**
 * The wizard leaves `step` (Esc not captured by the step): logs
 * `wizard.step.cancelled` and drops a completion the same key event queued.
 */
export function cancelSetupStep(step: string, reason: SetupCancelReason): void {
  cancelled = true;
  if (!scheduled) { scheduled = true; setImmediate(flush); }
  try { logPortfolio('warn', 'wizard.step.cancelled', `Setup step ${step} cancelled`, { context: { step, reason } }); } catch { /* best-effort */ }
}

/** Test hook: writes or drops what is queued now. */
export function flushSetupStepEvents(): void { flush(); }
