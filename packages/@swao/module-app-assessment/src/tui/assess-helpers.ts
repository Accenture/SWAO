// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4344 (Design 126 audit U-6): the shared helpers and host-injected types of
// the retired legacy AssessScreen.tsx. The routed flows (AppAssessmentScreen,
// LzAssessmentScreen) and their tests import them from here.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { CredentialStore, readRunStatus, providerLabel as centralProviderLabel, discoverFrameworks, frameworkContributorName, normalizeDashes } from '@swao/core';
import { listLocalConnectors as sharedListLocalConnectors } from '@swao/module-llm-providers';
import type { LocalConnectorInfo } from './assess/shared/types.js';

// Workspace-scaffolding is host-only (`swao init` owns it). The host injects
// these via the `scaffold` prop so this guest-module screen does not import the
// host (#0553, dependency-injection). AppYamlOptions is inlined to type the prop
// without importing from @swao/swao.
export interface AppYamlOptions {
  appId: string;
  appName?: string;
  vcsType?: 'github' | 'gitlab' | 'azure-devops';
  vcsUrl?: string;
  vcsRef?: string;
  vcsSubdir?: string;
  sourcePathOverride?: string;
  regimes?: readonly string[];
  assessorEmail?: string;
  /** #1050: optional pass subset written as assessment.pass_profile ([] or omitted = all passes) */
  passProfile?: string[];
}

export interface LzCatalogueRegion { id: string; display: string; country?: string; area?: string; label?: string; }
export interface LzCatalogueEntry  {
  provider: string;
  name: string;
  regions: LzCatalogueRegion[];
  /** #3399: pre-computed picker label `<id> - <name>` (host uses the shared lzProviderLabel helper). */
  label?: string;
  /** #3399: catalogue confidence + source, shown in the provider guidance box. */
  confidence?: string;
  source?: string;
}
export interface LzCatalogueHint   { entries: LzCatalogueEntry[]; }

/**
 * #3399: per-provider guidance text for the LZ provider picker, derived from
 * the catalogue hint the host injects (no module-landing-zone import -- this
 * module stays isolated). Summarises the residency countries and region count
 * so the operator sees what each cloud is while the cursor hovers it.
 */
export function buildLzProviderGuidance(entry: LzCatalogueEntry | undefined): { what: string; details: { label: string; value: string }[] } {
  if (!entry) {
    return {
      what: 'The CSP whose service catalogue SWAO matches the app\'s assessed requirements. Select multiple CSPs to run a side-by-side comparison.',
      details: [],
    };
  }
  const countries = [...new Set(entry.regions.map(r => r.country).filter((c): c is string => !!c && c.trim() !== ''))].sort();
  // #4296: names from the central provider map, the same on every surface.
  const name = centralProviderLabel(entry.provider, 'full', entry.name);
  const details: { label: string; value: string }[] = [
    { label: 'Provider', value: entry.label ?? centralProviderLabel(entry.provider, 'pair', entry.name) },
    { label: 'Regions', value: `${entry.regions.length} in catalogue${countries.length ? ` across ${countries.join(', ')}` : ''}` },
  ];
  if (entry.confidence) details.push({ label: 'Catalogue confidence', value: entry.confidence });
  if (entry.source)     details.push({ label: 'Source', value: entry.source });
  return {
    what: `${name}: SWAO matches this provider's service catalogue against the app's assessed requirements and sovereignty frameworks. Select multiple CSPs to compare side by side.`,
    details,
  };
}

/**
 * #4213 (Design 126 section 9): the guidance entry of one provider row of a
 * Target LZ provider picker: the entry of `buildLzProviderGuidance` as sections.
 */
export function lzProviderRowGuidance(entry: LzCatalogueEntry | undefined, provider: string): { title: string; what: string; sections: { label: string; text: string }[] } {
  const g = buildLzProviderGuidance(entry);
  return { title: centralProviderLabel(provider, 'full', entry?.name), what: g.what, sections: g.details.map((d) => ({ label: d.label, text: d.value })) };
}

/** #4213: the guidance entry of one `provider:region` row of a Target region picker. */
export function lzRegionRowGuidance(providerName: string, region: { id: string; display: string; country?: string }, app: string): { title: string; what: string } {
  return {
    title: `${providerName} ${region.id}`,
    what: `Compares the service catalogue of ${providerName} region ${region.id} (${region.display}${region.country ? `, ${region.country}` : ''}) with the assessed needs of ${app} in this run.`,
  };
}

/**
 * #3378 Part B (ADR-0067): the LZ targets of this app's last landing-zone run,
 * as `provider:region` labels, read from the run record (run-status.json of
 * the run `latest-landing-zone-catalog.txt` points at). The picker pre-selects
 * these so a re-run defaults to the previous choice without persisting
 * anything to the app .swao.yml. Empty when the app has never had an LZ run.
 */
/**
 * #3380 (decision 1b): insert a non-selectable country header row before each
 * country group in a (country-sorted) region option list. Options are grouped by
 * `country` in incoming order; a missing country falls under "Other". Returns
 * MultiSelectOption rows (header rows carry `header: true`).
 */
export function insertCountryHeaders(
  opts: ReadonlyArray<{ label: string; value: string; country?: string; guidance?: { title: string; what: string } }>,
): Array<{ label: string; value: string; header?: boolean; guidance?: { title: string; what: string } }> {
  const sorted = [...opts].sort((a, b) => (a.country ?? '~').localeCompare(b.country ?? '~') || a.label.localeCompare(b.label));
  const out: Array<{ label: string; value: string; header?: boolean; guidance?: { title: string; what: string } }> = [];
  let lastCountry: string | undefined;
  for (const o of sorted) {
    const c = o.country && o.country.trim() ? o.country : 'Other';
    if (c !== lastCountry) { out.push({ label: c, value: `__hdr:${c}`, header: true }); lastCountry = c; }
    // #4213: a row keeps its guidance entry (the box follows the cursor).
    out.push({ label: o.label, value: o.value, ...(o.guidance ? { guidance: o.guidance } : {}) });
  }
  return out;
}

export function readLastRunLzTargets(workspace: string | null, appId: string): string[] {
  if (!workspace || !appId) return [];
  try {
    const wspDir = join(workspace, 'apps', appId, 'wsp');
    const pointer = join(wspDir, 'latest-landing-zone-catalog.txt');
    if (!existsSync(pointer)) return [];
    const rel = readFileSync(pointer, 'utf-8').trim();
    if (!rel) return [];
    return readRunStatus(join(wspDir, rel))?.targets ?? [];
  } catch { return []; }
}

/**
 * #3378 Part B: the LZ targets of this app's last APPLICATION run, read from
 * that run's run-status.json (an app run records its inline-fit targets there).
 * There is no latest-application pointer, so scan the newest run dir whose
 * marker is an application run. Empty when the app has no application run.
 */
export function readLastRunAppLzTargets(workspace: string | null, appId: string): string[] {
  if (!workspace || !appId) return [];
  try {
    const runsDir = join(workspace, 'apps', appId, 'wsp', 'runs');
    if (!existsSync(runsDir)) return [];
    const runs = readdirSync(runsDir).filter(n => /^\d{4}-\d{2}-\d{2}/.test(n)).sort().reverse();
    for (const r of runs) {
      const s = readRunStatus(join(runsDir, r));
      if (s?.assessment_type === 'application') return s.targets ?? [];
    }
    return [];
  } catch { return []; }
}

// #0985 Design 074: lens definition shape (mirrors LensDef in commands/lenses.ts).
// Inlined here so this guest module does not import from the host.
export interface LensDef {
  id: string;
  passes: string[];
  auto_frameworks: string[];
  /** Guidance text shown in the TUI when this lens is focused (#0991). */
  description?: string;
}

export interface AssessScaffold {
  imports: (appDir: string) => void;
  ingestion: (appDir: string) => void;
  source: (appDir: string) => void;
  landingZoneStubs: (appDir: string) => void;
  appYmlTemplate: (opts: AppYamlOptions) => string;
  /** Available LZ catalogue providers + regions -- injected by host from module-landing-zone. */
  lzCatalogueHint?: LzCatalogueHint | null;
  // #0985 Design 074: lens scaffold -- injected by host from commands/lenses.ts.
  lenses?: LensDef[];
  readWorkspaceLenses?: (workspacePath: string) => string[];
  /** #4283: explicit save-as-default only (minimal patch of assessment.lenses); throws when refused. */
  saveWorkspaceLenses?: (workspacePath: string, ids: string[]) => void;
  /** #1379: gate-capable sovereignty frameworks for the LZ picker -- injected
   *  by host from module-landing-zone discoverGateCapableFrameworks so
   *  workspace-installed frameworks with a D-LZ-07 gate appear dynamically. */
  discoverLzGateFrameworks?: (workspacePath: string, appId: string) => Array<{
    id: string;
    name?: string;
    gate_summary?: string;
    description?: string;
    authority?: string;
    controlsCount?: number;
    slug?: string;
    contributorName?: string;
  }>;
  /** #1601: bundled community frameworks directory (from @swao/community-frameworks).
   *  When provided, non-Demo bundled frameworks appear in the picker even when absent
   *  from the workspace. Demo frameworks (id ending in _DEMO) are suppressed from
   *  the bundled source so deleting them from the workspace removes them permanently. */
  bundledCommunityDir?: string;
  /** #4285: the set-up LZ targets of an app as `swao assess` resolves them (geographies mapped to their default region); host-injected from commands/lz-target-config.ts. */
  resolveSetupLzTargets?: (workspacePath: string, appId: string) => { targets: string[]; resolved: Array<{ requested: string; resolved: string; geography: string }>; source: string };
}

function readStoredCredentials(): Record<string, string> {
  try { return new CredentialStore().loadSync(); }
  catch { return {}; }
}

interface WorkspaceLlmConfig { type?: string; endpoint?: string; model?: string; connector?: string; }

function readWorkspaceLlmConfig(workspace: string | null): WorkspaceLlmConfig {
  if (!workspace) return {};
  try {
    const raw = readFileSync(join(workspace, '.swao.yml'), 'utf-8');
    const providersSection = raw.split('providers:')[1] ?? '';
    const typeMatch     = providersSection.match(/type:\s+([^\s~][^\n]*)/);
    const endpointMatch = providersSection.match(/endpoint:\s+"?([^"\n~]+)"?/);
    const modelMatch    = providersSection.match(/model:\s+([^\s~][^\n]*)/);
    const connectorMatch = providersSection.match(/connector:\s+([^\s~][^\n]*)/);
    return {
      type:     typeMatch?.[1]?.trim(),
      endpoint: endpointMatch?.[1]?.trim(),
      model:    modelMatch?.[1]?.trim(),
      connector: connectorMatch?.[1]?.trim(),
    };
  } catch { return {}; }
}

// Build the env for the child assess process, injecting credentials + LLM provider + model.
// Accepts pre-read creds and wsLlm to avoid disk I/O at spawn time.
// #0473: stub provider deleted -- no more useStub path.
// #0800: appLlm overrides wsLlm when a per-app LLM provider is set.
// Exported for assess-child-env.test.ts (#1409).
export function buildChildEnv(
  workspace: string | null,
  creds: Record<string, string> = readStoredCredentials(),
  wsLlm: WorkspaceLlmConfig = readWorkspaceLlmConfig(workspace),
  appLlm: WorkspaceLlmConfig = {},
): NodeJS.ProcessEnv {
  // Per-app config takes precedence over workspace config; workspace is the fallback.
  const effectiveLlm: WorkspaceLlmConfig = { ...wsLlm, ...Object.fromEntries(Object.entries(appLlm).filter(([, v]) => v !== undefined)) };
  const env = { ...process.env };
  // #3387: Node process warnings (experimental APIs, TLS env) stay out of the TUI output.
  env['NODE_NO_WARNINGS'] = '1';
  // #1409: gateway connector config wins (Design 090). Without this branch
  // the legacy key-based detection below silently rerouted gateway
  // workspaces to anthropic/openai while the TUI banner said "Gateway:".
  // The child assess process resolves SWAO_LLM_CONNECTOR through the
  // factory's gateway path; credentials come from the store inside the
  // child, so no key material needs to cross the process boundary.
  if (effectiveLlm.connector) {
    env['SWAO_LLM_CONNECTOR'] = effectiveLlm.connector;
    if (effectiveLlm.model) env['SWAO_LLM_MODEL'] = effectiveLlm.model;
    return env;
  }
  const anthropicKey = creds['anthropic-api-key'] ?? process.env['ANTHROPIC_API_KEY'] ?? process.env['SWAO_ANTHROPIC_API_KEY'];
  const openaiKey    = creds['openai-api-key']    ?? process.env['OPENAI_API_KEY']    ?? process.env['SWAO_OPENAI_API_KEY'];
  const providerType = effectiveLlm.type ?? (anthropicKey ? 'anthropic' : openaiKey ? 'openai' : null);

  if (providerType === 'anthropic' && anthropicKey) {
    env['SWAO_LLM_PROVIDER']      = 'anthropic';
    env['SWAO_ANTHROPIC_API_KEY'] = anthropicKey;
    if (effectiveLlm.model) env['SWAO_ANTHROPIC_MODEL'] = effectiveLlm.model;
  } else if (providerType === 'openai' && openaiKey) {
    env['SWAO_LLM_PROVIDER']   = 'openai';
    env['SWAO_OPENAI_API_KEY'] = openaiKey;
    if (effectiveLlm.model) env['SWAO_OPENAI_MODEL'] = effectiveLlm.model;
  } else if (providerType === 'ollama') {
    env['SWAO_LLM_PROVIDER'] = 'ollama';
    const endpoint = effectiveLlm.endpoint ?? creds['ollama-endpoint'];
    const model    = effectiveLlm.model    ?? creds['ollama-model'];
    if (endpoint) env['SWAO_OLLAMA_URL']   = endpoint;
    if (model)    env['SWAO_OLLAMA_MODEL'] = model;
  }
  return env;
}

/**
 * A community framework discovered from a workspace's
 * `wsp/inputs/catalogs/community/<id>/framework-meta.yaml`. Folder-driven
 * (#0382): a framework appears iff its folder + meta exist.
 */
export interface RegimeOption {
  id: string;
  name: string;
  /** Slug used for the on-disk folder under catalogs/community/. */
  slug: string;
  authority?: string;
  description?: string;
  controlsCount?: number;
  contributorName?: string;
  /** Assessment-type scope tokens from framework-meta.yaml (#0696). */
  assessmentTypeScope?: string[];
}

/**
 * Enumerate the community frameworks installed under
 * `<workspace>/wsp/inputs/catalogs/community/`. Returns [] when the workspace
 * or directory is absent, or when no framework folder carries a
 * `framework-meta.yaml` -- the "no frameworks installed" empty state (#0621).
 * Optional `scopeToken` filters to frameworks whose `assessment_type_scope`
 * includes the token; frameworks with no scope field are always shown (#0696).
 * Module-level + exported so the empty-state detection is unit-testable.
 */
export function discoverCommunityRegimes(workspace: string | null | undefined, scopeToken?: string, _bundledDir?: string): RegimeOption[] {
  if (!workspace) return [];
  const communityDir = join(workspace, 'wsp', 'inputs', 'catalogs', 'community');
  // #3297: the same discovery as `swao framework list` and `swao init`
  // (discoverFrameworks in @swao/core, validated framework-meta.yaml). Only the
  // workspace is read (#1659); `listed: false` does not hide a workspace copy.
  // Warnings are dropped here because console output would break the Ink
  // render; `swao framework list` prints them. A workspace copy whose meta
  // fails FrameworkMetaSchema no longer appears in the picker (#3297).
  const out: RegimeOption[] = [];
  for (const f of discoverFrameworks(communityDir, { includeUnlisted: true, warn: () => {} })) {
    const ats = f.meta.assessment_type_scope.length > 0 ? f.meta.assessment_type_scope : undefined;
    if (scopeToken && ats && !ats.includes(scopeToken)) continue;
    let controlsCount: number | undefined;
    const controlsPath = join(f.dir, 'controls.yaml');
    if (existsSync(controlsPath)) {
      try {
        const cyml = loadYaml(readFileSync(controlsPath, 'utf-8')) as { controls?: unknown[] } | null;
        controlsCount = Array.isArray(cyml?.controls) ? cyml.controls.length : undefined;
      } catch { /* fall through; count stays undefined */ }
    }
    out.push({
      id: f.id,
      // #4501: no spaced double hyphen on screen (normalizeDashes).
      name: normalizeDashes(f.meta.name ?? f.id),
      slug: f.folder,
      authority: f.meta.authority === undefined ? undefined : normalizeDashes(f.meta.authority),
      description: f.meta.description === undefined ? undefined : normalizeDashes(f.meta.description.replace(/\s+/g, ' ').trim()),
      controlsCount,
      contributorName: frameworkContributorName(f.meta),
      assessmentTypeScope: ats,
    });
  }
  return out;
}

/**
 * #4501: the gate-capable frameworks of the LZ Catalog frameworks step with
 * their metadata read for the screen: name, description, authority and gate
 * summary go through normalizeDashes (framework-meta.yaml may hold a spaced
 * double hyphen, "GDPR Demo (11 controls) -- Live-Presentation Subset").
 */
export function normaliseLzGateFrameworks<T extends { name?: string; description?: string; authority?: string; gate_summary?: string }>(list: readonly T[]): T[] {
  return list.map((f) => ({
    ...f,
    ...(f.name !== undefined ? { name: normalizeDashes(f.name) } : {}),
    ...(f.description !== undefined ? { description: normalizeDashes(f.description) } : {}),
    ...(f.authority !== undefined ? { authority: normalizeDashes(f.authority) } : {}),
    ...(f.gate_summary !== undefined ? { gate_summary: normalizeDashes(f.gate_summary) } : {}),
  }));
}

// #0689: pure helper -- strip stored regime IDs that are no longer installed.
// Exposed for unit testing; used by readAppRegimes() to prevent phantom
// pre-selections when a workspace has had frameworks removed since setup.
export function filterRegimesAgainstInstalled(
  stored: readonly string[],
  installedIds: readonly string[],
): string[] {
  if (stored.length === 0) return ['all'];
  if (stored.length === 1 && stored[0] === 'all') return ['all'];
  if (installedIds.length === 0) return ['all'];
  const lower = installedIds.map(id => id.toLowerCase());
  const filtered = stored.filter(id => lower.includes(id.toLowerCase()));
  return filtered.length > 0 ? filtered : ['all'];
}

// #3388 (Design 112): the private listLocalConnectors copy was removed; the
// one reader now lives in @swao/module-llm-providers (imported below as
// sharedListLocalConnectors) and seeds the workspace folder when empty
// (single source, D-3).
const listLocalConnectors = sharedListLocalConnectors;

// #2351: built-in LLM connectors always shown in the credential hub API tokens section.
// Derived from bundled seed YAMLs; only connectors with a credential_key or env_var are listed.
// Exported for testing.
export const BUILTIN_API_CONNECTORS: LocalConnectorInfo[] = [
  { id: 'anthropic',  name: 'Anthropic Claude', credentialKey: 'anthropic-api-key',  envVar: 'SWAO_ANTHROPIC_API_KEY', baseUrl: '', protocol: '', defaultModel: '' },
  { id: 'bedrock',    name: 'Amazon Bedrock',   credentialKey: undefined,            envVar: 'AWS_ACCESS_KEY_ID',      baseUrl: '', protocol: '', defaultModel: '' },
  { id: 'openrouter', name: 'OpenRouter',        credentialKey: 'openrouter-api-key', envVar: 'SWAO_OPENROUTER_API_KEY', baseUrl: '', protocol: '', defaultModel: '' },
];

// #2351: enumerate connectors for the credential hub API tokens section.
// Returns: built-in connectors + workspace connectors (wsp/inputs/llm-gateway/) + connectors
// from <workspace>/llm-gateways/ (simple credential reference YAMLs).
// Exported for testing.
export function listApiTokenConnectors(workspaceRoot?: string): LocalConnectorInfo[] {
  const out: LocalConnectorInfo[] = [...BUILTIN_API_CONNECTORS];
  const seen = new Set<string>(out.map(c => c.id));

  // Workspace connectors from wsp/inputs/llm-gateway/ not already in the built-in list
  for (const c of listLocalConnectors(workspaceRoot)) {
    if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
  }

  if (!workspaceRoot) return out;

  // Additional connectors from <workspace>/llm-gateways/ (simple or full connector format)
  const gwDir = join(workspaceRoot, 'llm-gateways');
  if (!existsSync(gwDir)) return out;
  let gwFiles: string[] = [];
  try { gwFiles = readdirSync(gwDir).filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_')); } catch { return out; }
  for (const f of gwFiles.sort()) {
    try {
      const parsed = loadYaml(readFileSync(join(gwDir, f), 'utf-8')) as Record<string, unknown> | null;
      if (!parsed) continue;
      const connector = parsed['connector'] as { id?: string; name?: string; base_url?: string; protocol?: string; models?: { default?: string }; auth?: { credential_key?: string; env_var?: string } } | undefined;
      const id = (connector?.id ?? f.replace(/\.(yaml|yml)$/, '')) as string;
      if (seen.has(id)) continue;
      const name = (connector?.name ?? parsed['name'] ?? id) as string;
      const credentialKey = (parsed['api_key_vault_key'] ?? connector?.auth?.credential_key) as string | undefined;
      const envVar = (parsed['env_var'] ?? connector?.auth?.env_var) as string | undefined;
      if (!credentialKey && !envVar) continue; // omit connectors with no credential reference
      seen.add(id);
      out.push({
        id,
        name: `${name}  (from llm-gateways/${f})`,
        credentialKey,
        envVar,
        baseUrl: connector?.base_url ?? '',
        protocol: connector?.protocol ?? '',
        defaultModel: connector?.models?.default ?? '',
      });
    } catch { /* skip malformed files */ }
  }
  return out;
}
