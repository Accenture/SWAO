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

// Viewport windowing for the in-process credential list view (#1413).
// Pure function -- no React/Ink imports -- so it can be tested directly.
// Mirrors the computeProbeWindow pattern in @swao/module-health-check.

// Fixed UI chrome rows consumed by CredentialScreen around the list content:
// header (2) + outer padding (1) + above-indicator (1) + footer "press Enter" (1)
// + bottom hint (2) + GuidanceBox collapsed (4) + margin (1) = 12
export const CRED_CHROME_RESERVED = 12;
export const CRED_MIN_VISIBLE = 4;

export interface CredentialWindow {
  start: number;
  end: number;
  aboveCount: number;
  belowCount: number;
}

export function computeCredentialWindow(
  offset: number,
  total: number,
  terminalRows: number,
): CredentialWindow {
  const viewportSize = Math.max(CRED_MIN_VISIBLE, terminalRows - CRED_CHROME_RESERVED);
  const maxOffset = Math.max(0, total - viewportSize);
  const clamped = Math.max(0, Math.min(offset, maxOffset));
  const end = Math.min(total, clamped + viewportSize);
  return {
    start: clamped,
    end,
    aboveCount: clamped,
    belowCount: total - end,
  };
}
