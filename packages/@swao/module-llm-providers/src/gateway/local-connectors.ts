// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- one TUI-facing connector reader (#3388 step 2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3388 (Design 112): the single connector reader for every TUI screen and
// credential flow, replacing the four private `listLocalConnectors` copies
// (AppAssessmentScreen, LzAssessmentScreen, AssessScreen, CredentialScreen)
// that drifted and showed different lists in the field test (#3372/#3381/
// #3385). Built on `listConnectors`, so precedence, validation and skip
// warnings are identical everywhere, and it seeds the workspace folder when it
// is empty (D-3: the folder is the single source, no runtime fallback).

import { listConnectors } from './connector-loader.js';

/** The connector fields the TUI screens and credential flow need. */
export interface LocalConnectorInfo {
  id: string;
  name: string;
  credentialKey: string | undefined;
  envVar: string | undefined;
  baseUrl: string;
  protocol: string;
  defaultModel: string;
  /** #3385: false when the connector sets tls.reject_unauthorized: false. */
  rejectUnauthorized?: boolean;
  /** #3385: model of a specific run (set by the caller, not by the loader). */
  model?: string;
}

/**
 * Every connector visible to this workspace, in the common TUI shape. Seeds the
 * packaged connectors into `wsp/inputs/llm-gateway/` when the folder is empty,
 * so the workspace is the single source even on a fresh checkout.
 */
export function listLocalConnectors(workspaceRoot?: string): LocalConnectorInfo[] {
  return listConnectors({ workspaceRoot, seedIfEmpty: true }).connectors.map(({ file }) => {
    const c = file.connector;
    return {
      id: c.id,
      name: c.name,
      credentialKey: c.auth?.credential_key,
      envVar: c.auth?.env_var,
      baseUrl: c.base_url,
      protocol: c.protocol,
      defaultModel: c.models.default,
      rejectUnauthorized: c.tls?.reject_unauthorized,
    };
  });
}
