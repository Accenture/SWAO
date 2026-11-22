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

// #4190 SET-01 / #4198 SET-10 (Design 125 section 5.7): "setup values are
// the assessment defaults". One reader per branch, used by the assessment
// screens and the CLI to preselect what the branch stored. The branches write
// exactly these fields (in the existing .swao.yml files, no new file):
//
// | Branch      | Field(s) written                                             |
// |-------------|--------------------------------------------------------------|
// | application | apps/<id>/.swao.yml; assessment.test_code.mode               |
// | service     | service_portfolio.intake, service_portfolio.mapping          |
// | lz-catalog  | assessment.landing_zone.targets                              |
// | lz-live     | landing_zones[] (scopes), landing_zones[].frameworks         |
// | llm         | assessment.llm.candidates[], assessment.llm.subject_app      |
//
// Older fields are read as fallbacks: service_portfolio.source (#3521),
// llm_assessment.legs and llm_assessment.default_app (Design 092 section 4).

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import {
  SwaoYmlAssessmentLlmSchema,
  SwaoYmlLlmAssessmentSchema,
  SwaoYmlServicePortfolioSchema,
  SwaoYmlTestCodeSchema,
  listWorkspaceApps,
} from '@swao/core';
import { readWorkspaceLzTargets } from '../tui/screens/wizard/lz-targets-helpers.js';

/** Parsed workspace .swao.yml as a plain object; {} when missing or unreadable. */
export function readWorkspaceYml(workspaceRoot: string): Record<string, unknown> {
  const p = join(workspaceRoot, '.swao.yml');
  if (!existsSync(p)) return {};
  try {
    const doc = yamlLoad(readFileSync(p, 'utf-8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export interface ApplicationDefaults {
  /**
   * Application app ids with an apps/<id>/.swao.yml, sorted. A single app is
   * chosen automatically. #4490: service apps (`assessment.type: service`, the
   * rule of the app picker) are not listed; `serviceApps` counts them.
   */
  apps: string[];
  /** #4490: the service apps of the workspace, left out of `apps`. */
  serviceApps: number;
  testCodeMode?: 'include' | 'tag' | 'exclude';
}

export function readApplicationDefaults(workspaceRoot: string): ApplicationDefaults {
  const appsDir = join(workspaceRoot, 'apps');
  // #4490 / #4484: through the app index; application apps only.
  const listed = listWorkspaceApps(workspaceRoot);
  const apps = listed
    .filter((a) => a.kind === 'application' && existsSync(join(appsDir, a.id, '.swao.yml')))
    .map((a) => a.id)
    .sort();
  const serviceApps = listed.filter((a) => a.kind === 'service').length;
  const tc = SwaoYmlTestCodeSchema.safeParse(obj(obj(readWorkspaceYml(workspaceRoot)['assessment'])?.['test_code']) ?? {});
  return { apps, serviceApps, ...(tc.success && tc.data.mode ? { testCodeMode: tc.data.mode } : {}) };
}

export interface ServiceDefaults {
  /** Intake workbook: service_portfolio.intake, else service_portfolio.source. */
  intake?: string;
  mapping?: string;
}

export function readServiceDefaults(workspaceRoot: string): ServiceDefaults {
  const sp = SwaoYmlServicePortfolioSchema.safeParse(obj(readWorkspaceYml(workspaceRoot)['service_portfolio']) ?? {});
  if (!sp.success) return {};
  const intake = sp.data.intake ?? sp.data.source;
  return { ...(intake ? { intake } : {}), ...(sp.data.mapping ? { mapping: sp.data.mapping } : {}) };
}

/**
 * #4198: the stored intake workbook and mapping file as absolute paths, only
 * when the files exist (relative values resolve against the workspace).
 * The Service Portfolio Assessment preselects them before scanning the
 * intake folder.
 */
export function readStoredServiceIntake(workspaceRoot: string): { intake?: string; mapping?: string } {
  const d = readServiceDefaults(workspaceRoot);
  const abs = (v: string | undefined): string | undefined => {
    if (!v) return undefined;
    const p = isAbsolute(v) ? v : join(workspaceRoot, v);
    return existsSync(p) ? p : undefined;
  };
  const intake = abs(d.intake);
  const mapping = intake ? abs(d.mapping) : undefined;
  return { ...(intake ? { intake } : {}), ...(mapping ? { mapping } : {}) };
}

export interface LzCatalogDefaults {
  /** assessment.landing_zone.targets as provider:region labels. */
  targets: string[];
}

export function readLzCatalogDefaults(workspaceRoot: string): LzCatalogDefaults {
  return { targets: readWorkspaceLzTargets(workspaceRoot) };
}

export interface LzLiveDefaultsEntry {
  id: string;
  provider: string;
  scopes: string[];
  frameworks: string[];
}

export interface LzLiveDefaults {
  landingZones: LzLiveDefaultsEntry[];
}

export function readLzLiveDefaults(workspaceRoot: string): LzLiveDefaults {
  const raw = readWorkspaceYml(workspaceRoot)['landing_zones'];
  if (!Array.isArray(raw)) return { landingZones: [] };
  const landingZones: LzLiveDefaultsEntry[] = [];
  for (const item of raw) {
    const lz = obj(item);
    if (!lz || typeof lz['id'] !== 'string' || typeof lz['provider'] !== 'string') continue;
    const scopes = Array.isArray(lz['scopes']) ? lz['scopes'].map((s) => obj(s)?.['id']).filter((s): s is string => typeof s === 'string') : [];
    const frameworks = Array.isArray(lz['frameworks']) ? lz['frameworks'].filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
    landingZones.push({ id: lz['id'], provider: lz['provider'], scopes, frameworks });
  }
  return { landingZones };
}

export interface LlmCandidate {
  connector: string;
  model?: string;
}

export interface LlmDefaults {
  candidates: LlmCandidate[];
  subjectApp?: string;
  /** Where the values came from: the Design 125 fields, the Design 092 fields, or nothing. */
  source: 'assessment.llm' | 'llm_assessment' | 'none';
  /** Where the candidates came from (#4198; `source` covers both fields). */
  candidatesFrom?: 'assessment.llm' | 'llm_assessment' | 'none';
}

export function readLlmDefaults(workspaceRoot: string): LlmDefaults {
  const yml = readWorkspaceYml(workspaceRoot);
  const a = SwaoYmlAssessmentLlmSchema.safeParse(obj(obj(yml['assessment'])?.['llm']) ?? {});
  const legacy = SwaoYmlLlmAssessmentSchema.safeParse(obj(yml['llm_assessment']) ?? {});
  const cur = a.success ? a.data : {};
  const old = legacy.success ? legacy.data : {};
  const pick = (c: { connector: string; model?: string | undefined }): LlmCandidate => ({ connector: c.connector, ...(c.model ? { model: c.model } : {}) });
  // #4403 (Design 092 section 4, one source of truth for the default legs):
  // llm_assessment.legs is written only by an explicit "Save as the new
  // default" = Yes in the LLM Assessment (#4198), and the LLM setup removes it
  // when it saves assessment.llm.candidates (writeAssessmentLlm). The saved
  // legs, when present, are therefore the newer explicit choice and win over
  // the setup candidates; otherwise the candidates apply. The subject keeps
  // the Design 125 field first.
  const savedLegs = old.legs && old.legs.length > 0 ? old.legs : undefined;
  const candidates = savedLegs?.map(pick) ?? cur.candidates?.map(pick) ?? [];
  const subjectApp = cur.subject_app ?? old.default_app;
  const source = cur.candidates || cur.subject_app ? 'assessment.llm' : old.legs || old.default_app ? 'llm_assessment' : 'none';
  const candidatesFrom = savedLegs ? 'llm_assessment' : cur.candidates ? 'assessment.llm' : 'none';
  return { candidates, ...(subjectApp ? { subjectApp } : {}), source, candidatesFrom };
}

export interface AssessDefaultsInput {
  type?: string | undefined;
  app?: string | undefined;
  lz?: string | undefined;
  frameworks?: string | undefined;
  portfolio?: boolean | undefined;
}

export interface AssessDefaults {
  app?: string;
  lz?: string;
  frameworks?: string;
  /** One line per value taken from the workspace setup, for the CLI to print. */
  notes: string[];
}

/**
 * #4198 SET-10 (Design 125 section 5.7): CLI defaults for `swao assess` when
 * flags are omitted. Explicit flags always win; nothing is written back.
 * - Application (no type or `application`): a workspace with exactly one app runs it.
 * - LLM: the stored subject app (assessment.llm.subject_app, else llm_assessment.default_app).
 * - LZ Live: the `landing_zones[].frameworks` of the chosen `--lz` are the
 *   frameworks when `--frameworks` is omitted (the TUI preselects the landing zone).
 */
export function resolveAssessDefaults(workspaceRoot: string, input: AssessDefaultsInput): AssessDefaults {
  const out: AssessDefaults = { notes: [] };
  const type = (input.type ?? '').trim().toLowerCase();
  if (input.portfolio) return out;
  if (type === 'landing-zone-live') {
    // The landing zone itself stays an explicit choice on the CLI: a live run
    // reads a real cloud account, so it is never started on an implied target.
    const { landingZones } = readLzLiveDefaults(workspaceRoot);
    const entry = landingZones.find((l) => l.id === input.lz);
    if (!input.frameworks && entry && entry.frameworks.length > 0) {
      out.frameworks = entry.frameworks.join(',');
      out.notes.push(`--frameworks ${out.frameworks} (landing_zones[].frameworks of ${entry.id})`);
    }
    return out;
  }
  if (input.app) return out;
  if (type === 'llm') {
    const { subjectApp } = readLlmDefaults(workspaceRoot);
    if (subjectApp) {
      out.app = subjectApp;
      out.notes.push(`--app ${subjectApp} (the assessed app stored by the LLM setup)`);
    }
    return out;
  }
  if (type === '' || type === 'application' || type === 'source-code') {
    const { apps } = readApplicationDefaults(workspaceRoot);
    if (apps.length === 1) {
      out.app = apps[0]!;
      out.notes.push(`--app ${out.app} (the only app in the workspace)`);
    }
  }
  return out;
}
