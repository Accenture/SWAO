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

// #4196 SET-07 (Design 125 sections 5.6 and 5.7, Q-05): the values of the LLM
// branch. Candidates: two to five gateway connectors (with a model each) from
// wsp/inputs/llm-gateway/, with their credential status. Subject: the app the
// comparison runs on; Q-05 (owner 2026-11-08) requires a completed
// Application Assessment run, checked with the LLM Assessment's own gate
// (@swao/module-llm-assessment gates.ts checkAppAssessmentPrecondition).
// Both are written to the workspace .swao.yml as assessment.llm.candidates
// and assessment.llm.subject_app (core SwaoYmlAssessmentLlmSchema), the
// fields setup/defaults.ts readLlmDefaults reads for the preselection.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { CredentialStore, SwaoYmlAssessmentLlmSchema, patchSwaoYmlFile } from '@swao/core';
import { checkAppAssessmentPrecondition, type PreconditionFailure } from '@swao/module-llm-assessment';
import { listConnectors, type LoadedConnector } from '@swao/module-llm-providers';
import { readApplicationDefaults, readLlmDefaults, type LlmCandidate } from './defaults.js';
import { hasCredentialKey } from './application-source.js';
import type { SetupCheckItem } from './types.js';

/** Design 125 section 5.6 and the core schema: two to five candidates. */
export const LLM_CANDIDATES_MIN = 2;
export const LLM_CANDIDATES_MAX = 5;

export interface CandidateConnector {
  id: string;
  name: string;
  defaultModel: string;
  /** Catalogue model ids (may be empty: any model id the platform serves). */
  models: string[];
  /** The vault key the connector needs; undefined for keyless connectors (local runtimes). */
  credentialKey?: string;
  hasCredential: boolean;
  /** #4347: the catalogue price per million tokens of a model, when the connector file states it. */
  prices?: Readonly<Record<string, { input: number; output: number }>>;
  /** #4475: the loaded connector, for the live model discovery of the model picker. */
  loaded?: LoadedConnector;
}

export function toCandidateConnector(c: LoadedConnector, vault: Readonly<Record<string, string>>, env: NodeJS.ProcessEnv = process.env): CandidateConnector {
  const conn = c.file.connector;
  const key = conn.auth.credential_key;
  const models = [conn.models.default, ...(conn.models.catalogue ?? []).map((m) => m.id)];
  const prices: Record<string, { input: number; output: number }> = {};
  for (const m of conn.models.catalogue ?? []) {
    if (!m.cost || m.id === '__proto__' || m.id === 'constructor' || m.id === 'prototype') continue;
    prices[m.id] = { input: m.cost.input_per_million, output: m.cost.output_per_million };
  }
  return {
    id: conn.id,
    name: conn.name,
    defaultModel: conn.models.default,
    models: [...new Set(models)],
    ...(key ? { credentialKey: key } : {}),
    hasCredential: !key || hasCredentialKey(key, vault, env),
    ...(Object.keys(prices).length > 0 ? { prices } : {}),
    loaded: c,
  };
}

/** The gateway connectors of the workspace with credential status (no seeding unless asked). */
export function listCandidateConnectors(
  workspaceRoot: string,
  opts: { vault?: Readonly<Record<string, string>>; env?: NodeJS.ProcessEnv; seedIfEmpty?: boolean } = {},
): CandidateConnector[] {
  let connectors: LoadedConnector[] = [];
  try { connectors = listConnectors({ workspaceRoot, ...(opts.seedIfEmpty ? { seedIfEmpty: true } : {}) }).connectors; } catch { /* no connectors */ }
  const vault = opts.vault ?? safeLoadVault();
  return connectors.map((c) => toCandidateConnector(c, vault, opts.env));
}

function safeLoadVault(): Record<string, string> {
  try { return new CredentialStore().loadSync(); } catch { return {}; }
}

export const candidateKey = (c: LlmCandidate): string => `${c.connector}/${c.model ?? ''}`;

/** Why a candidate list cannot be saved, or null (2 to 5 entries, no duplicate connector and model pair, schema-valid). */
export function candidatesProblem(candidates: readonly LlmCandidate[]): string | null {
  if (candidates.length < LLM_CANDIDATES_MIN) return `Choose at least ${LLM_CANDIDATES_MIN} candidates.`;
  if (candidates.length > LLM_CANDIDATES_MAX) return `Choose at most ${LLM_CANDIDATES_MAX} candidates.`;
  const keys = candidates.map(candidateKey);
  if (new Set(keys).size !== keys.length) return 'The same connector and model is listed twice.';
  const parsed = SwaoYmlAssessmentLlmSchema.safeParse({ candidates });
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'invalid candidates');
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * Writes assessment.llm.candidates and/or assessment.llm.subject_app into the
 * workspace .swao.yml. Only the `llm:` block under `assessment:` is replaced,
 * so comments and the other keys of the file are kept (the line-based
 * approach of yaml-helpers.ts writeTestCodeModeToYaml). Other keys of the
 * llm block are kept. The new text is parsed and compared before it is
 * written; when it does not parse or differs, the file is left unchanged and
 * the call throws.
 */
export function writeAssessmentLlm(workspaceRoot: string, patch: { candidates?: readonly LlmCandidate[]; subjectApp?: string }): void {
  const path = join(workspaceRoot, '.swao.yml');
  if (!existsSync(path)) throw new Error('The workspace configuration file is missing.');
  if (patch.candidates) {
    const problem = candidatesProblem(patch.candidates);
    if (problem) throw new Error(problem);
  }
  const doc = obj(yamlLoad(readFileSync(path, 'utf-8'))) ?? {};
  const assessment = obj(doc['assessment']) ?? {};
  const llm: Record<string, unknown> = { ...(obj(assessment['llm']) ?? {}) };
  if (patch.candidates) llm['candidates'] = patch.candidates.map((c) => ({ connector: c.connector, ...(c.model ? { model: c.model } : {}) }));
  if (patch.subjectApp !== undefined) llm['subject_app'] = patch.subjectApp;
  const parsed = SwaoYmlAssessmentLlmSchema.safeParse(llm);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid assessment.llm');

  // #4283: the central minimal-patch writer (@swao/core) replaces the llm
  // block only, also when assessment: is written in flow style, keeps CRLF
  // line endings and verifies the result by a reparse before writing.
  // #4403 (Design 092 section 4): saved LLM Assessment legs win over the
  // candidates (readLlmDefaults); saving candidates in the setup removes them,
  // so the newer explicit choice is the one default.
  const savedLegs = obj(doc['llm_assessment'])?.['legs'] !== undefined;
  const r = patchSwaoYmlFile(path, [
    { path: ['assessment', 'llm'], value: llm, style: 'block' },
    ...(patch.candidates && savedLegs ? [{ path: ['llm_assessment', 'legs'], value: undefined }] : []),
  ]);
  if (!r.ok) throw new Error('The workspace configuration could not be updated safely; it was left unchanged.');
}

export interface SubjectApp {
  appId: string;
  eligible: boolean;
  /** Latest completed run (directory name), when eligible. */
  latestRun?: string;
  reason?: PreconditionFailure;
}

/** Every app with its LLM Assessment eligibility (Q-05: a completed Application Assessment run). */
export function listSubjectApps(workspaceRoot: string): SubjectApp[] {
  return readApplicationDefaults(workspaceRoot).apps.map((appId) => {
    const pre = checkAppAssessmentPrecondition(workspaceRoot, appId);
    return pre.ok
      ? { appId, eligible: true, ...(pre.latestRun ? { latestRun: pre.latestRun.runTs } : {}) }
      : { appId, eligible: false, ...(pre.reason ? { reason: pre.reason } : {}) };
  });
}

/** Plain-language reason an app is not eligible (no CLI syntax, Design 125 section 9). */
export function subjectReasonText(reason: PreconditionFailure | undefined): string {
  switch (reason) {
    case undefined: return 'ready';
    case 'no-app': return 'app folder missing';
    case 'no-runs': return 'no Application Assessment run yet';
    case 'no-completed-run': return 'no completed Application Assessment run';
    // #4242: LZ Catalog, LZ Live, service or challenge runs only.
    case 'no-application-run': return 'no Application Assessment run (only other assessment types)';
    default: {
      const never: never = reason;
      throw new Error(`unknown precondition failure: ${String(never)}`);
    }
  }
}

/** The subject preselected on entry: the stored subject when eligible, else the only eligible app. */
export function preselectedSubject(apps: readonly SubjectApp[], stored: string | undefined): string | undefined {
  const eligible = apps.filter((a) => a.eligible);
  if (stored && eligible.some((a) => a.appId === stored)) return stored;
  return eligible.length === 1 ? eligible[0]!.appId : undefined;
}

/** Non-interactive check of the Candidates step (Design 125 section 8). */
export function checkLlmCandidates(
  workspaceRoot: string,
  opts: { vault?: Readonly<Record<string, string>>; env?: NodeJS.ProcessEnv } = {},
): SetupCheckItem[] {
  const { candidates } = readLlmDefaults(workspaceRoot);
  if (candidates.length < LLM_CANDIDATES_MIN) {
    return [{ label: 'LLM candidates', state: 'missing', detail: `Choose ${LLM_CANDIDATES_MIN} to ${LLM_CANDIDATES_MAX} connectors to compare` }];
  }
  const connectors = new Map(listCandidateConnectors(workspaceRoot, opts).map((c) => [c.id, c] as const));
  // #4223: the connector is the label and the model leads the value, so a
  // long model id never breaks inside the label column of the Ready step.
  return candidates.map((c) => {
    const conn = connectors.get(c.connector);
    const label = `Candidate ${c.connector}`;
    const value = (text: string): string => (c.model ? `${c.model}, ${text}` : text);
    if (!conn) return { label, state: 'missing' as const, detail: value('connector not in the workspace') };
    return conn.hasCredential
      ? { label, state: 'ok' as const, detail: value(conn.credentialKey ? 'credential stored' : 'no credential needed') }
      : { label, state: 'missing' as const, detail: value('credential missing') };
  });
}

/** Non-interactive check of the Subject step (Design 125 section 8). */
export function checkLlmSubject(workspaceRoot: string): SetupCheckItem[] {
  const { subjectApp } = readLlmDefaults(workspaceRoot);
  const apps = listSubjectApps(workspaceRoot);
  if (!subjectApp) {
    const eligible = apps.filter((a) => a.eligible).length;
    // #4223: the assessed app is the next step, not a defect: waiting (yellow)
    // with the next action, as for the Service intake (#4225, #4295).
    return [{
      label: 'Assessed app',
      state: 'waiting',
      detail: eligible > 0 ? 'Choose the app the comparison runs on in the Subject step' : 'No app has a completed Application Assessment; set up and run the Application Assessment first',
      short: eligible > 0 ? 'choose the app in the Subject step' : 'run the Application Assessment first',
    }];
  }
  const app = apps.find((a) => a.appId === subjectApp);
  if (!app) return [{ label: 'Assessed app', state: 'missing', detail: `${subjectApp}: app not found` }];
  return [{ label: 'Assessed app', state: app.eligible ? 'ok' : 'warn', detail: `${subjectApp}: ${subjectReasonText(app.reason)}` }];
}
