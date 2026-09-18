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

// Chat history persistence -- NDJSON append log (#2782).
//
// Each call to appendTurn writes one JSON line to wsp/chat/<ts>.ndjson.
// The ChatTurn schema from @swao/core is the canonical record shape.
// Exported helpers are unit-tested against ChatTurnSchema so the format
// stays stable across refactors.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ChatTurnSchema, type ChatTurn } from '@swao/core';

export type { ChatTurn };

/** Construct the NDJSON history file path for a given session timestamp. */
export function chatHistoryPath(workspace: string, sessionTs: string): string {
  return join(workspace, 'wsp', 'chat', `${sessionTs}.ndjson`);
}

/** Append one ChatTurn as a JSON line. Creates directories on first call. */
export function appendTurn(historyPath: string, turn: ChatTurn): void {
  mkdirSync(dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, JSON.stringify(turn) + '\n', 'utf-8');
}

/** Parse and validate one NDJSON line; returns null if invalid (skip). */
export function parseTurnLine(line: string): ChatTurn | null {
  try {
    return ChatTurnSchema.parse(JSON.parse(line.trim()));
  } catch {
    return null;
  }
}

/** Estimate token count at 4 chars/token (no tokenizer dependency). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Return true when accumulated input tokens exceed budget * threshold (0.80 default). */
export function isOverBudget(tokensIn: number, budget: number, threshold = 0.8): boolean {
  return tokensIn >= budget * threshold;
}
