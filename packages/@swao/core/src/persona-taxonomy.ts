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

// Canonical persona taxonomy (#0286, sprint-039; relocated to @swao/core in
// #0580, sprint-063). One persona, one stable machine ID, one Display label
// (UI), one Short label (banner), one optional legacy report-view alias.
//
// This is a SHARED CONTRACT: the Community `report` command (host) maps its
// `--view` flag through it, and the Enterprise `challenge` command
// (@swao/module-challenge) drives its persona runners from it. It therefore
// lives in core, not in the challenge module -- otherwise the Community report
// would depend on an Enterprise module, which breaks per-tier builds (#0583).
//
// AGENT_IDS is kept as a thin {id: display} view for backward compat; every new
// caller should reach for PERSONAS / CANONICAL_AGENT_ORDER / reportViewToAgentId()
// instead so additions to the persona shape land in one place.

export interface Persona {
  readonly id: AgentId;
  readonly display: string;
  readonly short: string;
  readonly reportViewAlias: string;
}

export const CANONICAL_AGENT_ORDER = [
  'application-architect',
  'business-owner',
  'grc-compliance-officer',
  'finops-lead',
  'programme-manager',
] as const;

export type AgentId = (typeof CANONICAL_AGENT_ORDER)[number];

export const PERSONAS: Readonly<Record<AgentId, Persona>> = {
  'application-architect': {
    id: 'application-architect',
    display: 'Application Architect',
    short: 'Architect',
    reportViewAlias: 'technical',
  },
  'business-owner': {
    id: 'business-owner',
    display: 'Business Owner',
    short: 'Business',
    reportViewAlias: 'exec',
  },
  'grc-compliance-officer': {
    id: 'grc-compliance-officer',
    display: 'GRC / Compliance Officer',
    short: 'Compliance',
    reportViewAlias: 'compliance',
  },
  'finops-lead': {
    id: 'finops-lead',
    display: 'FinOps Lead',
    short: 'FinOps',
    reportViewAlias: 'finops',
  },
  'programme-manager': {
    id: 'programme-manager',
    display: 'Migration / Programme Manager',
    short: 'Migration',
    reportViewAlias: 'migration-manager',
  },
} as const;

export const AGENT_IDS = Object.fromEntries(
  CANONICAL_AGENT_ORDER.map((id) => [id, PERSONAS[id].display]),
) as Record<AgentId, string>;

// Map legacy report-view IDs to canonical agent IDs. Used by report.ts and MCP
// swao_report to keep old --view flags / tool inputs working with a deprecation
// notice. Reverse lookup: PERSONAS[id].reportViewAlias.
export const REPORT_VIEW_ALIASES: Readonly<Record<string, AgentId>> = {
  technical: 'application-architect',
  exec: 'business-owner',
  compliance: 'grc-compliance-officer',
  finops: 'finops-lead',
  'migration-manager': 'programme-manager',
} as const;

export function reportViewToAgentId(view: string): AgentId | null {
  if ((CANONICAL_AGENT_ORDER as readonly string[]).includes(view)) {
    return view as AgentId;
  }
  return REPORT_VIEW_ALIASES[view] ?? null;
}
