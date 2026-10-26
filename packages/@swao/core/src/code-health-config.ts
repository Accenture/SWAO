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

// #3487: `.swao.yml` `assessment.code_health` (Pass 26, Design 117 section 2,
// Design 009 section 2).
//
//   assessment:
//     code_health:
//       top_n: 25                     # worklist length, 1 to 500
//       endpoint_allowlist: [ ... ]   # hosts Pass 26 does not count as hard-coded
//       tools: [lizard, jscpd]        # opt-in enrichment; default none
//       tool_timeout_seconds: 300     # ceiling per tool run, 10 to 3600
//
// Resolution is per key: the app `.swao.yml` wins, then the workspace
// `.swao.yml`, then the default. A list is taken whole from the file that
// declares it (an app allowlist replaces the workspace allowlist).

import { normaliseEndpointAllowlist } from './endpoint-scanner.js';
import { CODE_HEALTH_TOOL_NAMES, type CodeHealthToolName } from './code-health-tools.js';

export const CODE_HEALTH_DEFAULT_TOP_N = 25;
export const CODE_HEALTH_TOP_N_MIN = 1;
export const CODE_HEALTH_TOP_N_MAX = 500;
export const CODE_HEALTH_ALLOWLIST_MAX = 500;
export const CODE_HEALTH_DEFAULT_TOOL_TIMEOUT_S = 300;
export const CODE_HEALTH_TOOL_TIMEOUT_MIN_S = 10;
export const CODE_HEALTH_TOOL_TIMEOUT_MAX_S = 3600;

export type CodeHealthSettingSource = 'app' | 'workspace' | 'default';

export interface ResolvedCodeHealthSetting {
  topN: number;
  /** Normalised (lower-cased, de-duplicated, sorted); empty = no allowlist. */
  endpointAllowlist: string[];
  /** Requested tools in CODE_HEALTH_TOOL_NAMES order; empty = no tool is started. */
  tools: CodeHealthToolName[];
  toolTimeoutSeconds: number;
  source: {
    top_n: CodeHealthSettingSource;
    endpoint_allowlist: CodeHealthSettingSource;
    tools: CodeHealthSettingSource;
    tool_timeout_seconds: CodeHealthSettingSource;
  };
}

export const DEFAULT_CODE_HEALTH_SETTING: ResolvedCodeHealthSetting = {
  topN: CODE_HEALTH_DEFAULT_TOP_N,
  endpointAllowlist: [],
  tools: [],
  toolTimeoutSeconds: CODE_HEALTH_DEFAULT_TOOL_TIMEOUT_S,
  source: { top_n: 'default', endpoint_allowlist: 'default', tools: 'default', tool_timeout_seconds: 'default' },
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function toolList(v: unknown): CodeHealthToolName[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return CODE_HEALTH_TOOL_NAMES.filter((n) => v.includes(n));
}

/** The `code_health` block of one `assessment` block, or undefined. */
function block(assessment: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(assessment)?.['code_health']);
}

/**
 * Effective Pass 26 settings for a run. Tolerant: values the schema would
 * refuse (callers that skip validation) fall through to the next level.
 */
export function resolveCodeHealthSetting(appAssessment: unknown, workspaceAssessment?: unknown): ResolvedCodeHealthSetting {
  const levels: Array<[Exclude<CodeHealthSettingSource, 'default'>, Record<string, unknown> | undefined]> = [
    ['app', block(appAssessment)],
    ['workspace', block(workspaceAssessment)],
  ];
  const out: ResolvedCodeHealthSetting = {
    ...DEFAULT_CODE_HEALTH_SETTING,
    source: { ...DEFAULT_CODE_HEALTH_SETTING.source },
  };
  const pick = <T>(key: keyof ResolvedCodeHealthSetting['source'], read: (v: unknown) => T | undefined): [T, CodeHealthSettingSource] | undefined => {
    for (const [src, b] of levels) {
      if (!b) continue;
      const v = read(b[key]);
      if (v !== undefined) return [v, src];
    }
    return undefined;
  };
  const topN = pick('top_n', (v) => intIn(v, CODE_HEALTH_TOP_N_MIN, CODE_HEALTH_TOP_N_MAX));
  if (topN) { out.topN = topN[0]; out.source.top_n = topN[1]; }
  const allow = pick('endpoint_allowlist', (v) => (Array.isArray(v) ? normaliseEndpointAllowlist(v).slice(0, CODE_HEALTH_ALLOWLIST_MAX) : undefined));
  if (allow) { out.endpointAllowlist = allow[0]; out.source.endpoint_allowlist = allow[1]; }
  const tools = pick('tools', toolList);
  if (tools) { out.tools = tools[0]; out.source.tools = tools[1]; }
  const timeout = pick('tool_timeout_seconds', (v) => intIn(v, CODE_HEALTH_TOOL_TIMEOUT_MIN_S, CODE_HEALTH_TOOL_TIMEOUT_MAX_S));
  if (timeout) { out.toolTimeoutSeconds = timeout[0]; out.source.tool_timeout_seconds = timeout[1]; }
  return out;
}
