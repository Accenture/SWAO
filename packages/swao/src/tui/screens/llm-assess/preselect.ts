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

// #4198 SET-10 (Design 125 section 5.7): the LLM Assessment preselects what
// the LLM setup branch stored (assessment.llm.subject_app and
// assessment.llm.candidates, read by readLlmDefaults with the Design 092
// fallbacks). The operator can still change both at run time.

import type { LoadedConnector } from '@swao/module-llm-providers';
import type { LlmCandidate } from '../../../setup/defaults.js';
import type { EligibleApp, PendingLeg } from './types.js';

/** The eligible apps with the stored subject first (the picker cursor starts on it). */
export function orderAppsWithDefault(apps: readonly EligibleApp[], subjectApp: string | undefined): EligibleApp[] {
  if (!subjectApp) return [...apps];
  const hit = apps.find((a) => a.id === subjectApp);
  return hit ? [hit, ...apps.filter((a) => a !== hit)] : [...apps];
}

/**
 * The stored candidates as pending legs: connectors that are not available
 * in the workspace are left out; a candidate without a model uses the
 * connector's default model. At most `max` legs.
 */
export function defaultPendingLegs(candidates: readonly LlmCandidate[], connectors: readonly LoadedConnector[], max = 5): PendingLeg[] {
  const legs: PendingLeg[] = [];
  for (const c of candidates) {
    const loaded = connectors.find((l) => l.file.connector.id === c.connector);
    if (!loaded) continue;
    legs.push({ connectorId: c.connector, connector: loaded, model: c.model ?? loaded.file.connector.models.default });
    if (legs.length >= max) break;
  }
  return legs;
}
