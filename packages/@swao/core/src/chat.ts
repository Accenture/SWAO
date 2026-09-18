// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- Chat + Agent interfaces
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { z } from 'zod';

// ---- ChatTurn (#2770) ----
// One conversational turn stored in wsp/chat/*.ndjson.
// role: 'system' only on the first line of a session file (context snapshot).

export const ChatTurnSchema = z.object({
  ts: z.string(),               // ISO-8601 UTC
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  model: z.string().optional(), // populated on assistant turns
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});

export type ChatTurn = z.infer<typeof ChatTurnSchema>;

// ---- AgentToolCall (#2770) ----
// One MCP tool invocation stored in wsp/agent-runs/*/trace.ndjson.

export const AgentToolCallSchema = z.object({
  ts: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  latency_ms: z.number().nonnegative(),
  result_summary: z.string(), // first 500 chars of tool output
  status: z.enum(['ok', 'error', 'timeout']),
});

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;
