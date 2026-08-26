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

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import { appendFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import { CredentialStore, LicenseGuard, writeCrawlSection } from '@swao/core';
import { HeaderView, type LicenseStateView } from '@swao/tui-kit';

// SWAO_TUI_DEBUG=1 enables file-based TUI tracing to wsp/logs/tui-debug.log.
// Never writes to stdout (would corrupt Ink's cursor tracking).
const _tuiDebugPath = process.env['SWAO_TUI_DEBUG']
  ? join(process.cwd(), 'wsp', 'logs', 'tui-debug.log')
  : null;
const tuiDebug = (msg: string): void => {
  if (!_tuiDebugPath) return;
  try {
    mkdirSync(join(process.cwd(), 'wsp', 'logs'), { recursive: true });
    appendFileSync(_tuiDebugPath, `${new Date().toISOString()} ${msg}\n`, 'utf-8');
  } catch { /* best-effort */ }
};

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

export interface LzCatalogueRegion { id: string; display: string; country?: string; }
export interface LzCatalogueEntry  { provider: string; name: string; regions: LzCatalogueRegion[]; }
export interface LzCatalogueHint   { entries: LzCatalogueEntry[]; }

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
}
import { TextInput } from '@swao/tui-kit';
import { SelectInput } from '@swao/tui-kit';
import { MultiSelect } from '@swao/tui-kit';
import { ProgressBar } from '@swao/tui-kit';
import { LiveOutput } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { CommunityFrameworkPicker } from '@swao/tui-kit';
import type { CommunityFrameworkOption } from '@swao/tui-kit';
import { LzCatalogPicker, applyLzCuratedLabels } from '@swao/tui-kit';
import { LlmModelPicker, formatLlmCurrentLabel } from '@swao/tui-kit';
import { filterList, FILTER_THRESHOLD, SHOW_ALL } from './list-filter.js';
import { findWorkspace } from '@swao/core';
import { logApp } from '@swao/core';
import { openWithDefaultApp, copyToClipboard } from '@swao/core';
import { findInstalledChromium, PLAYWRIGHT_VERSION } from '@swao/core';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

// Core passes used as the first-run default selection (#0901).
// dynamic and malware are opt-in: they require external tooling (Playwright / malware
// scanners) and add significant run time. Only pre-select the core 12 passes.
const DEFAULT_PASS_KEYS = 'inv,state,data,ctx,sbom,tf,egr,crypto,synth,comp,blocks,scope'.split(',');

// All-passes string (includes dynamic) used for spawn args when "All passes" is chosen.
// Keep in sync with the --passes default in src/commands/assess.ts.
// The spawn logic conditionally omits --no-crawl when dynamic is in the selection (#0692).
const ALL_PASSES = 'inv,state,data,ctx,sbom,tf,egr,crypto,synth,dynamic,comp,blocks,scope';
const ALL_PASS_COUNT = ALL_PASSES.split(',').length;

type Phase =
  | 'input-app'
  | 'input-app-new'
  | 'input-vcs-url'
  | 'input-vcs-ref'
  | 'input-source-subdir'
  | 'input-playwright-url'
  // #0885: credential reuse prompt when a matching URL is found in the store
  | 'input-playwright-url-reuse'
  // #0776-C: inline login sub-steps following the URL prompt
  | 'input-playwright-username'
  | 'input-playwright-password'
  // #0814: per-app credential hub + sub-steps (VCS + Playwright)
  | 'input-app-credentials'
  | 'input-app-cred-vcs-url'
  | 'input-app-cred-vcs-token'
  | 'input-app-cred-playwright-url'
  | 'input-app-cred-playwright-user'
  | 'input-app-cred-playwright-pass'
  | 'input-app-cred-playwright-mfa'
  // #0800: per-app LLM override (L key from credential hub)
  | 'input-app-llm'
  | 'input-ingest-tip'
  | 'input-lenses'
  | 'input-regimes'
  | 'input-passes'
  | 'playwright-warn'
  | 'input-source-path'
  | 'input-iter'
  | 'pick-delete'
  | 'confirm-delete'
  | 'pick-rename'
  | 'input-rename'
  | 'op-done'
  | 'input-lz-provider'
  | 'input-lz-frameworks'
  | 'input-lz-region'
  | 'input-app-lz-provider'
  | 'input-app-lz-region'
  | 'running'
  // #0407 (sprint-040 round-6): explicit "assessment done -- press Enter
  // for BI export options" step so the operator can see the final
  // 100% green bar + summary before being whisked into the export menu.
  | 'assess-done'
  | 'challenge-prompt'
  | 'export-prompt'
  | 'export-running'
  | 'done';

const PASS_DESCRIPTIONS: Record<string, { summary: string; tip?: string }> = {
  inventory_scan:      { summary: 'Building component inventory: packages, services, databases, IaC files, API surface.' },
  state_analysis:      { summary: 'Detecting stateful components: databases, Redis, queues, K8s config. Affects migration complexity.' },
  data_classification: { summary: 'Classifying data in models and APIs: PII, health records, financial data, GDPR-regulated fields.' },
  context_ingestion:   { summary: 'Reading wsp/inputs/ folder: CMDB records, architecture docs, incidents, FinOps data. Add files to wsp/inputs/ to enrich this pass.' },
  sbom_cve:            { summary: 'Building Software Bill of Materials and checking OSV vulnerability database for CVEs and EOL runtimes.' },
  twelve_factor:       { summary: 'Validating Twelve-Factor compliance: config externalisation, logging, stateless design, port binding.' },
  egress:              { summary: 'Mapping external service calls: cloud SDKs, analytics, CDNs, US-hosted SaaS -- checks data residency conflicts.' },
  crypto_posture:      { summary: 'Scanning cryptography: KDF strength (bcrypt/argon2), JWT mode, HTTPS enforcement, encryption at rest.' },
  synthesis:           { summary: 'AI synthesis: reads all 8 passes, produces 7R recommendation (Rehost/Replatform/Refactor/...) and sovereignty coverage score.', tip: 'Requires LLM API access. If this fails: verify API key in Credentials (7) and outbound HTTPS to the LLM endpoint.' },
  dynamic_analysis:    { summary: 'Playwright crawl: captures UI screenshots and JavaScript execution traces for dynamic analysis. Requires Chromium.', tip: 'Opt-in: only runs when dynamic is in the pass selection. Skipped automatically when --no-crawl is set or Chromium is absent.' },
  compliance_evaluation: { summary: 'LLM-driven compliance evaluation: maps signals to control outcomes (SATISFIED/PARTIAL/GAP) per selected regime. Feeds the Compliance, Auditor, and Risk PowerBI pages.', tip: 'Requires LLM API access. Without it every control falls back to UNKNOWN. Standard / Premium tier feature.' },
  block_assessments:     { summary: 'LLM-driven block assessments (Pass 12): evaluates 8 operational blocks -- Observability (logging/alerting), Licence Compliance (open-source risk), Testing Maturity (coverage/quality), Architecture (design patterns), Database (DB sizing/risk), Integration (API/event contracts), IAM (identity/RBAC), Disaster Recovery (RTO/RPO). Each block receives a scored verdict (STRONG/ADEQUATE/WEAK/MISSING). Feeds the Auditor PowerBI page.', tip: 'Requires LLM API access. Without it every block falls back to UNKNOWN.' },
  scope_analysis:        { summary: 'Mapping which SWAO-assessed services are in-scope for the active compliance frameworks. Determines the coverage denominator for the sovereignty score.' },
  malware_scanning:      { summary: 'Optional: scans source dependencies and binaries for known malicious patterns using OSS tools (Gitleaks, ORT). Opt-in only -- not included in "All passes".', tip: 'Selecting this pass auto-writes a passes.malware block in .swao.yml with default tool settings. Enable ORT under passes.malware.tools.ort.enabled. Adds significant run time; run separately after the core assessment.' },
};

const PASS_FAIL_ADVICE: Record<string, string> = {
  synthesis: 'The 7R recommendation and coverage score will be absent from the report. You can re-run synthesis alone: select passes -> synth. Check: API key set in Credentials (7); outbound HTTPS to api.anthropic.com not blocked by corporate proxy.',
};

const PASS_OPTIONS = [
  { label: 'All passes (recommended)',                  value: 'all'     },
  { label: '01-inv     -- Inventory analysis',          value: 'inv'     },
  { label: '02-state   -- State detection',             value: 'state'   },
  { label: '03-data    -- Data classification',         value: 'data'    },
  { label: '04-ctx     -- Context ingestion',           value: 'ctx'     },
  { label: '05-sbom    -- Software Bill of Materials',  value: 'sbom'    },
  { label: '06-tf      -- Terraform analysis',          value: 'tf'      },
  { label: '07-egr     -- Egress analysis',             value: 'egr'     },
  { label: '08-crypto  -- Cryptography scan',           value: 'crypto'  },
  { label: '09-synth   -- AI synthesis + 7R',           value: 'synth'   },
  { label: '10-dynamic -- Playwright crawl',             value: 'dynamic' },
  { label: '11-comp    -- Compliance evaluation (LLM)', value: 'comp'    },
  { label: '12-blocks  -- Block assessments (LLM)',     value: 'blocks'  },
  { label: '13-scope   -- Scope analysis',              value: 'scope'   },
  { label: '14-malware -- Malware scan',                 value: 'malware' },
];

// #0383: maps short pass keys (PASS_OPTIONS) to the long names used in
// PASS_DESCRIPTIONS so the per-pass GuidanceBox below the picker can show
// the right description as the cursor moves. Keep keys aligned with
// PASS_MAP in src/commands/assess.ts.
const PASS_SHORT_TO_LONG: Record<string, string> = {
  inv:     'inventory_scan',
  state:   'state_analysis',
  data:    'data_classification',
  ctx:     'context_ingestion',
  sbom:    'sbom_cve',
  tf:      'twelve_factor',
  egr:     'egress',
  crypto:  'crypto_posture',
  synth:   'synthesis',
  dynamic: 'dynamic_analysis',
  comp:    'compliance_evaluation',
  blocks:  'block_assessments',
  scope:   'scope_analysis',
  malware: 'malware_scanning',
};

interface AssessScreenProps {
  onBack: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
  /** Workspace scaffolding functions, injected by the host (`swao init` owns them). */
  scaffold: AssessScaffold;
  /** Assessment surface: 'application' (default) uses the full pass suite;
   *  'landing-zone' collects provider + region then runs `--type landing-zone`.
   *  (#0630/#0631; the 'audit' surface was removed at #1434) */
  assessmentType?: 'application' | 'landing-zone';
  /** #0928: called when the operator presses C on the assess-done screen to
   *  launch the Stakeholder Challenge for the just-assessed app. */
  onChallenge?: (app: string) => void;
  /** #1109: called when the operator presses C on the LZ assess-done screen to
   *  launch the LZ Sovereignty Challenge. Separate from onChallenge -- output
   *  path and agent set are different (wsp/challenge-lz/, LZCA_ prefix). */
  onLzChallenge?: (app: string) => void;
}

function readStoredCredentials(): Record<string, string> {
  try { return new CredentialStore().loadSync(); }
  catch { return {}; }
}

// #0814: fire-and-forget write (set is async; caller does not need to await)
function writeCredential(name: string, value: string): void {
  try { void new CredentialStore().set(name, value); } catch { /* best-effort */ }
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

// #0800: read per-app LLM config (falls back to workspace if absent)
function readAppLlmConfig(workspace: string | null, appId: string): WorkspaceLlmConfig {
  if (!workspace || !appId) return {};
  try {
    const appYml = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(appYml)) return {};
    const raw = readFileSync(appYml, 'utf-8');
    const providersSection = raw.split('providers:')[1] ?? '';
    const typeMatch     = providersSection.match(/type:\s+([^\s~][^\n]*)/);
    const endpointMatch = providersSection.match(/endpoint:\s+"?([^"\n~]+)"?/);
    const modelMatch    = providersSection.match(/model:\s+([^\s~][^\n]*)/);
    const connectorMatch = providersSection.match(/connector:\s+([^\s~][^\n]*)/);
    if (!typeMatch && !connectorMatch) return {};
    return {
      type:     typeMatch?.[1]?.trim(),
      endpoint: endpointMatch?.[1]?.trim(),
      model:    modelMatch?.[1]?.trim(),
      connector: connectorMatch?.[1]?.trim(),
    };
  } catch { return {}; }
}

// #0723: read partnership_lead from workspace .swao.yml to pre-fill assessor: in new app yamls
function readWorkspacePartnershipLead(workspace: string | null): string | undefined {
  if (!workspace) return undefined;
  try {
    const raw = readFileSync(join(workspace, '.swao.yml'), 'utf-8');
    const m = raw.match(/^\s*partnership_lead:\s+"?([^"~\n][^\n]*?)"?\s*$/m);
    return m?.[1]?.trim() || undefined;
  } catch { return undefined; }
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
 * Module-level + exported so the empty-state detection is unit-testable.
 */
/**
 * Map an AssessmentType to the short token used in assessment_type_scope.
 * Returns undefined for types that have no scope restriction (landing-zone).
 */
function assessmentTypeToScopeToken(at: string | undefined): string | undefined {
  if (at === 'application') return 'app';
  if (at === 'llm')         return 'llm';
  return undefined; // landing-zone: no filter -- show all
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
export function discoverCommunityRegimes(workspace: string | null | undefined, scopeToken?: string, bundledDir?: string): RegimeOption[] {
  if (!workspace) return [];
  const communityDir = join(workspace, 'wsp', 'inputs', 'catalogs', 'community');
  const out: RegimeOption[] = [];
  const workspaceIds = new Set<string>(); // track IDs from workspace (for bundled dedup + Demo guard)

  // Helper: parse a framework folder from a given base directory.
  function readFrameworkEntry(baseDir: string, folderName: string): RegimeOption | null {
    const metaPath = join(baseDir, folderName, 'framework-meta.yaml');
    if (!existsSync(metaPath)) return null;
    try {
      const yml = loadYaml(readFileSync(metaPath, 'utf-8')) as {
        framework?: {
          id?: string;
          name?: string;
          authority?: string;
          description?: string;
          contributor?: { name?: string };
          assessment_type_scope?: string[];
        };
      } | null;
      const fw = yml?.framework;
      const id = fw?.id;
      if (!id) return null;
      const ats = Array.isArray(fw?.assessment_type_scope) ? fw.assessment_type_scope : undefined;
      if (scopeToken && ats && !ats.includes(scopeToken)) return null;
      let controlsCount: number | undefined;
      const controlsPath = join(baseDir, folderName, 'controls.yaml');
      if (existsSync(controlsPath)) {
        try {
          const cyml = loadYaml(readFileSync(controlsPath, 'utf-8')) as { controls?: unknown[] } | null;
          controlsCount = Array.isArray(cyml?.controls) ? cyml.controls.length : undefined;
        } catch { /* fall through; count stays undefined */ }
      }
      return {
        id,
        name: fw.name ?? id,
        slug: folderName,
        authority: fw.authority,
        description: fw.description?.replace(/\s+/g, ' ').trim(),
        controlsCount,
        contributorName: fw.contributor?.name,
        assessmentTypeScope: ats,
      };
    } catch { return null; }
  }

  // 1. Workspace entries (highest priority; defines which IDs are "user-owned").
  if (existsSync(communityDir)) {
    for (const entry of readdirSync(communityDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue; // skip .bundled, etc.
      const ro = readFrameworkEntry(communityDir, entry.name);
      if (!ro) continue;
      workspaceIds.add(ro.id);
      out.push(ro);
    }
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
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

export function AssessScreen({ onBack, version, scaffold, assessmentType = 'application', onChallenge, onLzChallenge }: AssessScreenProps): JSX.Element | null {
  const workspace = findWorkspace(process.cwd());
  const typeLabel = assessmentType === 'landing-zone' ? 'Landing Zone Catalog Assessment'
    : 'Application Assessment';

  // Local master-banner wrapper: closes over the host-injected version + the
  // licence state (LicenseGuard is in @swao/core). Memoised for a stable
  // identity so HeaderView (which holds resize state) does not remount. Lets
  // the existing `<Header subtitle=... />` call sites stay unchanged.
  const Header = useMemo(() => {
    let licenseState: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseState = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; contextPrefix?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseState} licenseError={licenseError} />;
    };
  }, [version]);

  const [phase, setPhase]     = useState<Phase>('input-app');
  const [app, setApp]         = useState('');
  const [vcsUrl, setVcsUrl]       = useState('');
  const [vcsRef, setVcsRef]       = useState('');
  const [, setVcsSubdir] = useState('');
  const [regimes, setRegimes] = useState<string[]>([]);
  // #0382: tracks the MultiSelect cursor row so the per-framework
  // #0385 Design 074: active lens selection + auto-framework hints from confirmed lenses.
  const [selectedLenses, setSelectedLenses] = useState<string[]>([]);
  const [lensAutoFrameworks, setLensAutoFrameworks] = useState<string[]>([]);
  // #1068: ref mirrors lensAutoFrameworks so initialSelected in the regime picker reads the
  // synchronously-updated value, not the stale state captured before React flushes the batch.
  const lensAutoFrameworksRef = useRef<string[]>([]);
  // #0991: tracks the MultiSelect cursor for the lens picker so the GuidanceBox
  // below can show per-lens description + pass/framework details.
  const [lensCursor, setLensCursor] = useState<string>('');
  // #0383: tracks the passes-MultiSelect cursor so the per-pass GuidanceBox
  // updates with the highlighted pass's purpose + what it measures.
  const [passCursor, setPassCursor] = useState<string>('all');
  const [passes, setPasses]   = useState<string[]>([]);
  // #0895 -- Stats on by default; set SWAO_ASSESS_STATS=0 to suppress for
  // headless/CI runs.  Toggle with 'S' during input-passes phase.
  const [showStats, setShowStats] = useState<boolean>(process.env['SWAO_ASSESS_STATS'] !== '0');
  // Cassette fallback: true = use committed fixtures when workspace cache misses (default).
  // Toggle with 'C' key. Default OFF -- interactive assessments always call the LLM fresh.
  // Enable only when explicitly replaying a known-good cassette (cost saving / CI).
  const [useCassette, setUseCassette] = useState<boolean>(false);
  // #0259.C1 -- CLI/TUI parity. --source-path overrides .swao.yml source.path
  // (useful for re-running against a fresh clone or a sibling directory
  // without editing the YAML). Empty string = no override. --iter pins the
  // iteration number for the run-manifest; defaults to 1.
  const [sourcePath, setSourcePath] = useState<string>('');
  const [iter, setIter]             = useState<string>('1');
  // #0516 AC#2: inline warning shown when the URL input does not match any
  // recognised pattern (relative path, ambiguous string).
  const [sourceInputWarning, setSourceInputWarning] = useState<string>('');
  const [lzProvider, setLzProvider]       = useState<string>('');
  const [lzRegion, setLzRegion]           = useState<string>('');
  const [lzRegionFilter, setLzRegionFilter] = useState<string>('');
  // #0803: multi-CSP/multi-region LZ target selection.
  // appLzCatProviders: selected provider IDs (multi-select).
  // appLzCatTargets: confirmed "provider:region" pairs passed via --lz-cat-targets.
  // appLzCatFrameworks: selected community framework IDs for sovereignty gate.
  const [appLzCatProviders, setAppLzCatProviders] = useState<string[]>([]);
  const [appLzCatTargets, setAppLzCatTargets]     = useState<string[]>([]);
  const [appLzCatFrameworks, setAppLzCatFrameworks] = useState<string[]>([]);
  const [appLzRegionFilter, setAppLzRegionFilter] = useState<string>('');
  // #0814: per-app credential collection. Credentials are stored in CredentialStore
  // with per-app keys (e.g. vcs-token-sovereign-health). appCredStoredKeys tracks
  // which keys are already stored so the UI can show "stored -- Enter to keep."
  const [appCredStoredKeys, setAppCredStoredKeys] = useState<Set<string>>(new Set());
  // #0800: edit-only mode -- E key from input-app opens credential hub without
  // advancing to regimes/passes. Enter/S in hub returns to input-app instead.
  const [editOnlyMode, setEditOnlyMode] = useState(false);
  // #0800: track the currently highlighted app value in the input-app SelectInput.
  const [appCursorValue, setAppCursorValue] = useState('');
  // #0800: saved pass profile from app .swao.yml, used as initialSelected in input-passes.
  // #0901: default to core passes only (no dynamic/malware) -- operator opts in explicitly.
  const [initialPassProfile, setInitialPassProfile] = useState<string[]>(DEFAULT_PASS_KEYS);
  // #0776-C: collect Playwright URL + login credentials before writing atomically
  // at the password step so all three fields land in the crawl block together.
  const [playwrightUrl, setPlaywrightUrl]                     = useState('');
  const [playwrightUsername, setPlaywrightUsername]           = useState('');
  const [playwrightUrlMatchSourceApp, setPlaywrightUrlMatchSourceApp] = useState('');
  // #0908: tracks whether the reuse check was entered from the wizard or the credential hub.
  const [playwrightUrlReuseOrigin, setPlaywrightUrlReuseOrigin] = useState<'wizard' | 'hub'>('wizard');
  // #0763: live filter for large app lists (>10 apps).
  const [appFilter, setAppFilter]   = useState<string>('');
  const [lines, setLines]     = useState<string[]>([]);
  // passNum was tracked when the progress bar was driven by it directly;
  // #0379 replaced that with `completedPasses + subFraction`, leaving
  // passNum as a read-nowhere state. Dropped to satisfy no-unused-vars.
  const [passName, setPassName] = useState('');
  // #0246: per-pass sub-progress label (e.g. "BSI_C5 (3/7)" while
  // Pass 11 iterates regimes). Cleared on every new pass.
  const [passSubLabel, setPassSubLabel] = useState('');
  // #0379: track completed passes + intra-pass fractional advancement so the
  // progress bar reflects actual work done. Previously the bar was driven by
  // passNum (rising 1..12) against a hardcoded total of 9, so it pinned at
  // 100 percent the moment passNum reached 9 -- well before Pass 11 (comp)
  // had iterated all selected community frameworks.
  const [completedPasses, setCompletedPasses] = useState(0);
  const [subFraction, setSubFraction] = useState(0);
  const [failedPass, setFailedPass] = useState('');
  const [done, setDone]       = useState(false);
  const [code, setCode]       = useState<number | null>(null);
  const [deleteSelection, setDeleteSelection] = useState<string[]>([]);
  const [renameTarget, setRenameTarget]       = useState('');
  const [opMessage, setOpMessage]             = useState('');
  const [opError, setOpError]                 = useState('');
  const [exportLines, setExportLines]   = useState<string[]>([]);
  const [exportDone, setExportDone]     = useState(false);
  const [exportCode, setExportCode]     = useState<number | null>(null);
  const [exportBundleDir, setExportBundleDir] = useState('');
  // #0928: block assessment verdicts read from 12-blocks.yaml when assess-done.
  const [blockVerdicts, setBlockVerdicts] = useState<Record<string, string>>({});
  // #0408 (sprint-040 round-7): inline export panel hot-keys.
  const [exportPbitPath, setExportPbitPath] = useState('');
  const [exportPortfolioPbitPath, setExportPortfolioPbitPath] = useState('');
  const [exportActionToast, setExportActionToast] = useState('');
  // #0659: landing-zone verdict + per-target breakdown captured from child stdout
  const [lzVerdict, setLzVerdict] = useState('');
  const [lzTargetVerdicts, setLzTargetVerdicts] = useState<{ target: string; verdict: string; gaps: number }[]>([]);
  // #0715: path to the assess.log written after child closes; drives the L key.
  const [logFilePath, setLogFilePath] = useState('');
  // #0805: ref so the useInput stale-closure sees the live logFilePath value.
  const logFilePathRef = useRef(logFilePath);
  logFilePathRef.current = logFilePath;

  // Read files once at mount -- never during render to avoid lag on every keypress
  const [storedCreds] = useState(() => readStoredCredentials());
  const [wsLlmConfig] = useState(() => readWorkspaceLlmConfig(workspace));

  const detectedProvider = (() => {
    // #1401 sprint-113: gateway connector selection wins (Design 090).
    const connector = wsLlmConfig.connector ?? process.env['SWAO_LLM_CONNECTOR'];
    if (connector) return `Gateway: ${connector}${wsLlmConfig.model ? `  (${wsLlmConfig.model})` : ''}`;
    const type = wsLlmConfig.type ?? process.env['SWAO_LLM_PROVIDER'];
    // #0392 (sprint-040): when .swao.yml pins a provider, the workspace
    // YAML wins -- match buildChildEnv's actual selection so the TUI
    // header does not lie. Previous code returned 'OpenAI' whenever an
    // OpenAI key was stored, even if .swao.yml pinned Anthropic; the
    // run then used Anthropic, leaving the operator confused why their
    // OpenAI key showed "Never used" on the OpenAI dashboard.
    if (type === 'ollama')    return `Ollama  (${wsLlmConfig.endpoint ?? 'http://localhost:11434'})`;
    if (type === 'anthropic') return `Anthropic Claude${wsLlmConfig.model ? ` (${wsLlmConfig.model})` : ''}`;
    if (type === 'openai')    return `OpenAI${wsLlmConfig.model ? ` (${wsLlmConfig.model})` : ''}`;
    // No type in .swao.yml -- fall back to credential availability + ordering
    // (anthropic first because the .swao.yml template defaults to it).
    if (storedCreds['anthropic-api-key'] || process.env['ANTHROPIC_API_KEY']) return 'Anthropic Claude  (credential-only; .swao.yml has no provider pinned)';
    if (storedCreds['openai-api-key']    || process.env['OPENAI_API_KEY'])    return 'OpenAI  (credential-only; .swao.yml has no provider pinned)';
    return 'No LLM credentials configured. Set SWAO_LLM_PROVIDER or add credentials via `swao credential set`.';
  })();

  // #0620: terminal-size-based caps keep the TUI frame from overflowing the
  // viewport (which strands the previous frame's header in scrollback).
  // Row budget: outer-padding(2) + header(6) + app-row(1) + progress(3) +
  // status(1) + live-box-overhead(2) + guidance(4) = 19 reserved rows.
  // For input-passes MultiSelect: header(6) + info-row(2) + multiselect-
  // fixed-overhead(4) + guidance(4) + scroll-indicators(2) = 18 reserved.
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalCols = stdout?.columns ?? 80;
  const maxLiveLines = Math.max(3, terminalRows - 19);
  const passVisibleCount = Math.max(4, terminalRows - 18);
  // Match the GuidanceBox width formula (#0741) so all bordered panels align.
  const guidanceWidth = Math.min(100, Math.max(63, terminalCols - 2));

  // SWAO_TUI_DEBUG: log every phase transition to wsp/logs/tui-debug.log.
  useEffect(() => {
    tuiDebug(`phase:${phase} rows=${terminalRows} cols=${terminalCols}`);
  }, [phase, terminalRows, terminalCols]);

  useEffect(() => {
    if (phase !== 'running') return;

    // Reset counters + output from any previous run in the same session (#0379).
    setCompletedPasses(0);
    setSubFraction(0);
    setLines([]);
    setLzVerdict('');
    setLzTargetVerdicts([]);
    // #0805 (sprint-078): do NOT write ANSI escape sequences to stdout from
    // inside a useEffect. Ink's diff renderer does not know the screen was
    // cleared so it uses a stale cursor offset for the next frame, which
    // paints over a blank surface and leaves the TUI visually frozen.
    // The alt-screen buffer (run-app.ts) already gives the running phase a
    // clean viewport; Ink's full re-render overwrites prior content correctly.

    // Branch args by assessment type (#0630/#0631; audit removed at #1434).
    let args: string[];
    if (assessmentType === 'landing-zone') {
      args = ['assess', '--type', 'landing-zone', '--app', app,
              '--lz-cat-targets', appLzCatTargets.join(','), '--no-crawl'];
      if (appLzCatFrameworks.length > 0) {
        args.push('--lz-frameworks', appLzCatFrameworks.join(','));
      }
    } else {
      const passArg = passes.includes('all') ? ALL_PASSES : passes.join(',');
      // #0692: include --no-crawl only when dynamic is not in the effective pass list.
      // When "all" is selected, ALL_PASSES now includes dynamic so the crawl runs.
      const includeDynamic = passes.includes('all')
        ? ALL_PASSES.split(',').includes('dynamic')
        : passes.includes('dynamic');
      args = ['assess', '--app', app, '--passes', passArg];
      if (!includeDynamic) args.push('--no-crawl');
      if (showStats) args.push('--stats');
      if (!useCassette) args.push('--no-cache');
      if (sourcePath.trim()) args.push('--source-path', sourcePath.trim());
      if (iter.trim() && iter.trim() !== '1') args.push('--iter', iter.trim());
      if (appLzCatTargets.length > 0) {
        args.push('--lz-cat-targets', appLzCatTargets.join(','));
      }
    }

    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildChildEnv(workspace, storedCreds, wsLlmConfig, readAppLlmConfig(workspace, app)),
      cwd: workspace ?? undefined,
      // #0805: prevent child PKG binary from inheriting the parent's Windows
      // console handle. Without this, the child's Node.js runtime calls
      // Windows console APIs (SetConsoleCtrlHandler, GetConsoleMode, etc.)
      // on startup, corrupting the parent Ink terminal state and causing the
      // TUI to go blank immediately after the running-phase transition.
      windowsHide: true,
    });

    const allLines: string[] = [];
    // #0996: Filter Node.js runtime deprecation warnings from third-party deps.
    // Buffer() deprecation ([DEP0005]) from xlsx/docx processing is not actionable
    // for the operator and pollutes the assess.log.
    const DEP_WARN_FILTER = /\[DEP\d{4}\] DeprecationWarning|Use `.*--trace-deprecation/;
    // #1686: batch setLines updates so rapid stdout chunks coalesce into one
    // re-render per tick instead of one per line. This keeps the Ink useInput
    // hook responsive to Ctrl+G during active pass execution.
    let pendingLines: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      if (pendingLines.length > 0) {
        const batch = pendingLines;
        pendingLines = [];
        setLines(prev => [...prev, ...batch]);
      }
      flushTimer = null;
    };
    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      const newLines = text.split('\n').filter(line => Boolean(line) && !DEP_WARN_FILTER.test(line));
      allLines.push(...newLines);
      pendingLines.push(...newLines);
      if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
      // Match every "Pass NN -- name" occurrence; take the LAST. A single
      // stdout chunk often carries both "[ok] Pass NN -- finished" AND the
      // next "[info] Running Pass NN+1 -- starting" -- with .match() only
      // the first match wins, so passName lagged a pass behind and the
      // label + error-state both showed the wrong pass name. #0403.
      const passMatches = [...text.matchAll(/Pass (\d+) -- (\S+)/gi)];
      const m = passMatches.length > 0 ? passMatches[passMatches.length - 1] : null;
      if (m) {
        setPassName((m[2] ?? '').replace(/\.+$/, ''));
        setPassSubLabel('');
        setSubFraction(0);
      }
      // #0379: count completed passes via "[ok] Pass NN" so the progress
      // bar denominator stays honest. Use match-all to handle the case
      // where two passes complete in the same stdout chunk.
      const okMatches = text.matchAll(/\[ok\]\s+Pass\s+\d+\s+--/g);
      let okDelta = 0;
      for (const _ of okMatches) okDelta += 1;
      if (okDelta > 0) setCompletedPasses(prev => prev + okDelta);
      // #0659: landing-zone fit completion -- one line per target in multi-target runs.
      // #1114: use matchAll+/g so multiple targets arriving in one stdout chunk are all
      // captured; provider names may contain spaces (e.g. "AWS ESC") so [^/]* instead of \S+.
      if (/\[ok\].*Landing-zone fit complete/i.test(text)) {
        setCompletedPasses(prev => prev + [...text.matchAll(/\[ok\].*Landing-zone fit complete/gi)].length);
        for (const m of text.matchAll(/fit complete\s+(\S[^/]*\/\S+)\s+verdict:\s+(\S+)\s+(\d+)\s+gap/gi)) {
          const tv = { target: m[1] ?? '', verdict: (m[2] ?? '').toLowerCase(), gaps: parseInt(m[3] ?? '0', 10) };
          setLzTargetVerdicts(prev => [...prev.filter(v => v.target !== tv.target), tv]);
          setLzVerdict(tv.verdict); // single-target fallback; overwritten by Overall: below
        }
      }
      // Overall verdict from multi-target summary line -- always printed even for 1 target.
      const overallM = text.match(/Overall:\s+(\S+)/i);
      if (overallM) setLzVerdict((overallM[1] ?? '').toLowerCase());
      // #0246 + #0379: per-pass sub-progress "[progress] Pass 11 -- BSI_C5 (3/7)".
      // The label surfaces intra-pass advancement so the operator knows the
      // LLM is making headway; subFraction (n/d) feeds into the bar value
      // so Pass 11's framework loop advances the bar smoothly rather than
      // jumping a full pass-width at the end.
      const pm = text.match(/\[progress\] Pass \d+ -- (\S+) \((\d+)\/(\d+)\)/);
      if (pm) {
        const num = parseInt(pm[2] ?? '0', 10);
        const den = parseInt(pm[3] ?? '0', 10);
        setPassSubLabel(`${pm[1]} (${num}/${den})`);
        if (den > 0) setSubFraction(num / den);
      }
      // #1097: advance sub-fraction when a pass STARTS so the bar shows
      // non-zero progress during long-running LLM calls (not just on completion).
      if (/\[info\]\s+Running Pass \d+ --/i.test(text)) {
        setSubFraction(0.5);
      }
      // Match "[error] Pass synth failed: ..."
      const errM = text.match(/\[error\] Pass (\S+) failed/i);
      if (errM) setFailedPass((errM[1] ?? '').trim());
    };

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    // #0802: surface spawn failures as a normal failure state rather than an
    // unhandled 'error' event that terminates the process silently.
    child.on('error', (err) => {
      setLines(prev => [...prev, `[error] Failed to start assessment process: ${err.message}`]);
      setCode(1);
      setDone(true);
      setPhase('done');
    });
    child.on('close', (exitCode) => {
      // #1686: flush any batched lines before signalling done.
      if (flushTimer) { clearTimeout(flushTimer); flushPending(); }
      setCode(exitCode);
      setDone(true);
      // #1782: lz.assess.complete is emitted by the CLI subprocess (assess.ts)
      // with authoritative context. The TUI emission was redundant and caused
      // double-entry in the NDJSON event log with inconsistent context shapes.
      try {
        const wspDir = workspace ? resolve(workspace, 'apps', app, 'wsp') : null;
        if (wspDir) {
          mkdirSync(wspDir, { recursive: true });
          // #0909: LZ catalogue runs write latest-landing-zone-catalog.txt, not latest.txt.
          // Use the type-specific pointer so the log lands in the correct run folder.
          const latestFile = assessmentType === 'landing-zone'
            ? join(wspDir, 'latest-landing-zone-catalog.txt')
            : join(wspDir, 'latest.txt');
          let logDir = wspDir;
          if (existsSync(latestFile)) {
            try {
              const latestPath = readFileSync(latestFile, 'utf-8').trim();
              const runDir = join(wspDir, latestPath);
              if (existsSync(runDir)) logDir = runDir;
            } catch { /* use wspDir */ }
          }
          const logFile = join(logDir, 'assess.log');
          writeFileSync(logFile, allLines.join('\n') + '\n', 'utf-8');
          setLogFilePath(logFile);
        }
      } catch { /* non-fatal */ }
      // #0407 (sprint-040 round-6): on success, pause at an explicit
      // "assessment done" summary screen so the operator can see the
      // final 100% green bar + signals total before deciding to emit the
      // BI bundle. Previously this auto-routed straight to export-prompt
      // and the 100% bar flashed by too quickly.
      // On non-zero exit, the BI bundle is meaningless -- skip the prompt.
      if (exitCode === 0) {
        setPhase('assess-done');
      } else { setPhase('done'); }
    });
    return () => { child.kill(); if (flushTimer) clearTimeout(flushTimer); };
  }, [phase]);

  // Pattern A (#0220): chain `swao export` after a successful assess.
  useEffect(() => {
    if (phase !== 'export-running') return;
    const args = ['export', '--app', app, '--formats', 'csv,ndjson,xlsx'];
    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: workspace ?? undefined,
      windowsHide: true,
    });
    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      setExportLines(prev => [...prev, ...text.split('\n').filter(Boolean)]);
      const starMatch = text.match(/\[ok\]\s+Star CSV bundle written\s+->\s+(\S+[/\\]star[/\\]?)/);
      if (starMatch) setExportBundleDir((starMatch[1] ?? '').replace(/[/\\]$/, ''));
      // #0408: capture both .pbit paths for the inline export panel hot-keys.
      const pbitMatches = text.matchAll(/\[ok\]\s+PowerBI template ready\s+->\s+(\S+\.pbit)/g);
      for (const m of pbitMatches) {
        const p = (m[1] ?? '').trim();
        if (/swao-portfolio\.pbit$/i.test(p)) setExportPortfolioPbitPath(p);
        else                                  setExportPbitPath(p);
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => {
      setLines(prev => [...prev, `[error] Failed to start export process: ${err.message}`]);
      setExportCode(1);
      setExportDone(true);
      setPhase('done');
    });
    child.on('close', (exitCode) => {
      setExportCode(exitCode);
      setExportDone(true);
      setPhase('done');
    });
    return () => { child.kill(); };
  }, [phase]);

  // #0397 / #0400 / #0406 / #0407 REVERTED AGAIN: writing \x1b[2J\x1b[H
  // during render confused Ink's diff-renderer -- Ink doesn't know about
  // external terminal mutations, so its next-frame diff was wrong and
  // the post-export screen rendered blank.  Tracked for sprint-041; the
  // bleed-tolerance approach (let Ink redraw within its own bounds, even
  // if a tail of the previous phase shows) is the lesser evil.

  // Event-handler-safe clear: fires inside event callbacks (never during render),
  // so Ink renders the new phase into the already-cleared buffer. Mirrors App.tsx.
  const clearScreen = () => {
    try { process.stdout.write('\x1B[2J\x1B[3J\x1B[H'); } catch { /* terminal gone */ }
  };

  // #0815: auto-advance LZ region phases when only one option exists.
  // Runs as a useEffect (not inline render logic) to avoid React side-effect
  // violations. Fires whenever the relevant phases become active.
  // #0832: removed the regions.length === 1 auto-advance guard that was
  // silently jumping to 'running' when only one region was available (#0815).
  // Operators must now explicitly confirm even a single-region catalogue so
  // they see the region name and can go back if needed.
  useEffect(() => {
    if (phase !== 'input-lz-region' && phase !== 'input-app-lz-region') return;
    const hint = scaffold.lzCatalogueHint;
    if (!hint) return;
    // #0848: for single-region LZ catalog, auto-advance (operator doesn't need to confirm
    // the obvious). For multi-region, just pre-select the first as a starting point.
    // input-lz-region now uses multi-select -- no single-region auto-advance (#0899).
    if (phase === 'input-app-lz-region') {
      const allTargets = appLzCatProviders.flatMap(pid => {
        const entry = hint.entries.find(e => e.provider === pid);
        if (!entry) return [];
        return entry.regions.map(r => `${pid}:${r.id}`);
      });
      if (allTargets.length === 1 && appLzCatTargets.length === 0) {
        tuiDebug(`pre-selected single app LZ target: ${allTargets[0]!}`);
        setAppLzCatTargets([allTargets[0]!]);
      }
    }
  }, [phase, appLzCatProviders, appLzCatTargets, scaffold.lzCatalogueHint]);

  // #0814: load stored credential keys when entering the credential hub so the
  // UI can show "already stored -- Enter to keep" hints per sub-step.
  useEffect(() => {
    if (phase !== 'input-app-credentials') return;
    const stored = readStoredCredentials();
    const keys = new Set(Object.keys(stored));
    setAppCredStoredKeys(keys);
  }, [phase]);

  // #0408 (round-7): toast helper for the inline export panel hot-keys.
  const toastExport = (msg: string) => {
    setExportActionToast(msg);
    setTimeout(() => setExportActionToast(''), 2500);
  };

  const guidanceOpenRef = useRef(false);

  // #0928: read block verdicts from 12-blocks.yaml when the assessment finishes.
  useEffect(() => {
    if (phase !== 'assess-done' || !workspace || !app) return;
    try {
      const runsDir = join(workspace, 'apps', app, 'wsp', 'runs');
      if (!existsSync(runsDir)) return;
      const latest = readdirSync(runsDir).sort().at(-1);
      if (!latest) return;
      const blocksPath = join(runsDir, latest, 'passes', '12-blocks.yaml');
      if (!existsSync(blocksPath)) return;
      const parsed = loadYaml(readFileSync(blocksPath, 'utf-8')) as { assessment?: { blocks?: Record<string, unknown> } } | null;
      const blocks = parsed?.assessment?.blocks;
      if (blocks && typeof blocks === 'object') {
        const verdicts: Record<string, string> = {};
        for (const [k, v] of Object.entries(blocks)) {
          if (v && typeof v === 'object' && 'verdict' in (v as object)) {
            verdicts[k] = String((v as Record<string, unknown>)['verdict'] ?? 'UNKNOWN');
          }
        }
        setBlockVerdicts(verdicts);
      }
    } catch { /* no blocks data -- skip */ }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    // Allow C/L to pass through even when guidance is open; they trigger
    // phase transitions that naturally close the guidance box.
    if (guidanceOpenRef.current && !(input === 'c' || input === 'C' || input === 'l' || input === 'L')) return;
    if ((phase === 'done') && (key.return || key.escape)) onBack();
    // assess-done summary: Esc always returns to main menu; Enter goes to the
    // challenge-prompt step if onChallenge is wired (#0988 Design 074 Step 8).
    if (phase === 'assess-done' && key.escape) onBack();
    if (phase === 'assess-done' && key.return) {
      if (assessmentType === 'landing-zone' && onLzChallenge) { setPhase('challenge-prompt'); }
      else if (onChallenge && assessmentType !== 'landing-zone') { setPhase('challenge-prompt'); }
      else { onBack(); }
    }
    // challenge-prompt Enter: route to the correct challenge handler by assessment type.
    if (phase === 'challenge-prompt' && key.return) {
      if (assessmentType === 'landing-zone') { onLzChallenge?.(app); }
      else { onChallenge?.(app); }
    }
    if (phase === 'challenge-prompt' && key.escape) { onBack(); }
    // #0715: open the assess.log in the OS default viewer when L is pressed.
    // Use ref so stale closure always reads the live path (#0805).
    if (phase === 'assess-done' && (input === 'l' || input === 'L') && logFilePathRef.current) {
      tuiDebug(`L key pressed -- opening log: ${logFilePathRef.current}`);
      openWithDefaultApp(logFilePathRef.current);
    }
    // #0928: C key launches App Stakeholder Challenge; #1109: C also launches LZ Sovereignty Challenge.
    if (phase === 'assess-done' && (input === 'c' || input === 'C')) {
      if (assessmentType === 'landing-zone') { onLzChallenge?.(app); }
      else { onChallenge?.(app); }
    }
    // #0408: in the inline export-done state, R/P/C/E launch templates +
    // copy the paths. Only active after the export completes successfully.
    if (phase === 'done' && exportDone && exportCode === 0) {
      if ((input === 'r' || input === 'R') && exportPbitPath) {
        toastExport(openWithDefaultApp(exportPbitPath) ? `Opening report template -> ${exportPbitPath}` : `Could not open ${exportPbitPath}`);
      }
      if ((input === 'p' || input === 'P') && exportPortfolioPbitPath) {
        toastExport(openWithDefaultApp(exportPortfolioPbitPath) ? `Opening portfolio template -> ${exportPortfolioPbitPath}` : `Could not open ${exportPortfolioPbitPath}`);
      }
      if ((input === 'c' || input === 'C') && exportBundleDir) {
        toastExport(copyToClipboard(exportBundleDir) ? `Copied SWAOExportPath to clipboard: ${exportBundleDir}` : 'Clipboard copy failed (xclip/xsel missing?)');
      }
      // #0409 (sprint-040 round-8): copy EvidenceUrlPrefix. Standard
      // value for local PowerBI Desktop authoring is `file:///<workspace>/apps/<app>/`.
      // Documented as the production-vs-Service swap target in #0268.
      if ((input === 'e' || input === 'E') && workspace) {
        const evidenceUrl = `file:///${workspace.replace(/\\/g, '/')}/apps/${app}/`;
        toastExport(copyToClipboard(evidenceUrl) ? `Copied EvidenceUrlPrefix to clipboard: ${evidenceUrl}` : 'Clipboard copy failed');
      }
    }
    if (phase === 'input-app' && key.escape) {
      // #0763: Esc clears the filter first; second Esc goes back
      if (appFilter) { setAppFilter(''); } else { onBack(); }
    }
    // #0800: E key opens the credential hub in edit-only mode for the
    // currently highlighted app (no assessment started).
    if (phase === 'input-app' && (input === 'e' || input === 'E')) {
      const target = appCursorValue;
      if (target && target !== '__new__' && target !== '__delete__' && target !== '__rename__') {
        handleEditApp(target);
      }
    }
    if (phase === 'input-vcs-url' && key.escape) setPhase('input-app-new');
    if (phase === 'input-vcs-ref' && key.escape) setPhase('input-vcs-url');
    if (phase === 'input-source-subdir' && key.escape) setPhase('input-vcs-ref');
    if (phase === 'input-playwright-url' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-playwright-url-reuse' && key.escape)
      setPhase(playwrightUrlReuseOrigin === 'hub' ? 'input-app-cred-playwright-url' : 'input-playwright-url');
    // #0776-C: escape from login sub-steps walks back through the chain
    if (phase === 'input-playwright-username' && key.escape) setPhase('input-playwright-url');
    if (phase === 'input-playwright-password' && key.escape) setPhase('input-playwright-username');
    // #0814: escape navigation for the credential hub and all sub-steps
    if (phase === 'input-app-credentials' && key.escape) { setEditOnlyMode(false); setPhase('input-app'); }
    if (phase === 'input-app-cred-vcs-url' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-vcs-token' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-playwright-url' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-playwright-user' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-playwright-pass' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-playwright-mfa' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-llm' && key.escape) setPhase('input-app-credentials');
    // #0814: credential hub hot-keys
    if (phase === 'input-app-credentials' && (input === 'r' || input === 'R')) setPhase('input-app-cred-vcs-url');
    if (phase === 'input-app-credentials' && (input === 'a' || input === 'A')) setPhase('input-app-cred-vcs-token');
    if (phase === 'input-app-credentials' && (input === 't' || input === 'T')) setPhase('input-app-cred-playwright-url');
    if (phase === 'input-app-credentials' && (input === 'u' || input === 'U')) setPhase('input-app-cred-playwright-user');
    if (phase === 'input-app-credentials' && (input === 'p' || input === 'P')) setPhase('input-app-cred-playwright-pass');
    if (phase === 'input-app-credentials' && (input === 'm' || input === 'M')) setPhase('input-app-cred-playwright-mfa');
    // #0800: L key opens per-app LLM override selector
    if (phase === 'input-app-credentials' && (input === 'l' || input === 'L')) setPhase('input-app-llm');
    // Enter/S on hub: in edit-only mode return to input-app; otherwise advance to assessment
    if (phase === 'input-app-credentials' && (key.return || input === 's' || input === 'S')) {
      if (editOnlyMode) { setEditOnlyMode(false); setPhase('input-app'); }
      else if (assessmentType === 'landing-zone') { setAppLzCatProviders([]); setAppLzCatTargets([]); setAppLzCatFrameworks([]); setAppLzRegionFilter(''); setPhase('input-lz-provider'); }
      else { setPhase('input-ingest-tip'); }
    }
    if (phase === 'input-ingest-tip') {
      if (key.return) {
        if ((scaffold.lenses?.length ?? 0) > 0) setPhase('input-lenses');
        else setPhase('input-regimes');
      }
      if (key.escape) setPhase('input-app');
    }
    if (phase === 'input-lenses' && key.escape) setPhase('input-ingest-tip');
    if (phase === 'input-regimes' && key.escape) {
      if ((scaffold.lenses?.length ?? 0) > 0) { setPhase('input-lenses'); }
      else { setPhase('input-app'); }
    }
    if (phase === 'input-passes' && key.escape) setPhase('input-regimes');
    if (phase === 'input-lz-provider' && key.escape) setPhase('input-app');
    if (phase === 'input-lz-frameworks' && key.escape) { setAppLzCatFrameworks([]); setPhase('input-lz-provider'); }
    if (phase === 'input-lz-region' && key.escape) {
      if (appLzRegionFilter) { setAppLzRegionFilter(''); } else { setPhase('input-lz-frameworks'); }
    }
    if (phase === 'input-app-lz-provider' && key.escape) setPhase('running');
    if (phase === 'input-app-lz-region' && key.escape) {
      if (appLzRegionFilter) { setAppLzRegionFilter(''); } else { setAppLzCatProviders([]); setPhase('input-app-lz-provider'); }
    }
    // #0621: in the no-frameworks empty-state there is no active MultiSelect to
    // consume Enter, so advance to the passes step here. Gated on the empty set
    // so it never competes with the picker's own Enter (onConfirm) when present.
    if (phase === 'input-regimes' && key.return && discoverRegimes().length === 0) setPhase('input-passes');
    if (phase === 'running' && key.escape) onBack();
    if (phase === 'export-running' && key.escape) onBack();
    if (phase === 'input-passes' && (input === 's' || input === 'S')) setShowStats(s => !s);  // #0259
    if (phase === 'input-passes' && (input === 'c' || input === 'C')) setUseCassette(c => !c);  // cassette opt-out
    if (phase === 'input-passes' && (input === 'p' || input === 'P')) setPhase('input-source-path');  // #0259.C1
    if (phase === 'input-passes' && (input === 'i' || input === 'I')) setPhase('input-iter');         // #0259.C1
    if ((phase === 'input-source-path' || phase === 'input-iter') && key.escape) setPhase('input-passes');
    if ((phase === 'pick-delete' || phase === 'pick-rename') && key.escape) setPhase('input-app');
    if (phase === 'input-rename' && key.escape) setPhase('pick-rename');
    if (phase === 'op-done' && (key.return || key.escape)) {
      setOpMessage(''); setOpError(''); setDeleteSelection([]); setRenameTarget('');
      setPhase('input-app');
    }
    if (phase === 'confirm-delete') {
      if (input === 'y' || input === 'Y') {
        try {
          if (!workspace) throw new Error('No workspace found');
          for (const id of deleteSelection) {
            rmSync(join(workspace, 'apps', id), { recursive: true, force: true });
          }
          setOpMessage(`Deleted ${deleteSelection.length} app${deleteSelection.length === 1 ? '' : 's'}: ${deleteSelection.join(', ')}`);
          setOpError('');
        } catch (e) {
          setOpError((e as Error).message);
          setOpMessage('');
        }
        setPhase('op-done');
      } else if (input === 'n' || input === 'N' || key.escape) {
        setDeleteSelection([]);
        setPhase('input-app');
      }
    }
  });

  // Single entry point shared with `swao init` (#0227): writes the
  // canonical app .swao.yml + scaffolds wsp/inputs/ (per-type subfolders
  // with samples) + wsp/inputs/source/ for the cloned code tree.
  //
  // #0386 (sprint-040): `localPath` flips the source from a clone-and-mount
  // model (git url + ref + monorepo subdir) to a point-at-existing-tree
  // model. When set, source.path in .swao.yml is the absolute local path
  // and no source.vcs block is emitted.
  const createApp = (appId: string, url: string, ref: string, subdir: string, localPath: string = '') => {
    if (!workspace) return;
    const appDir = join(workspace, 'apps', appId);
    mkdirSync(appDir, { recursive: true });

    // CodeQL #3, #4, #5: parse the URL and match the hostname exactly,
    // not by substring. Substring-includes accepts crafted hosts like
    // gitlab.com.attacker-corp.example. URL.hostname is lowercased and
    // normalised; URL constructor rejects malformed inputs (caught below).
    let vcsType: 'github' | 'gitlab' | 'azure-devops' = 'github';
    let urlHostname = '';
    try {
      urlHostname = new URL(url).hostname.toLowerCase();
    } catch {
      // Malformed URL -- keep the default vcsType and let downstream
      // validation surface a clearer error.
    }
    if (urlHostname === 'gitlab.com' || urlHostname.endsWith('.gitlab.com')) {
      vcsType = 'gitlab';
    } else if (
      urlHostname === 'dev.azure.com' ||
      urlHostname === 'visualstudio.com' ||
      urlHostname.endsWith('.visualstudio.com')
    ) {
      vcsType = 'azure-devops';
    }

    const yaml = scaffold.appYmlTemplate({
      appId,
      vcsType: url ? vcsType : undefined,
      vcsUrl: url || undefined,
      vcsRef: ref || undefined,
      vcsSubdir: subdir || undefined,
      sourcePathOverride: localPath || undefined,
      // #1042: omit regimes so no regimes_active: [all] is written;
      // regimes are set via the Regime Selector TUI after the app is created.
      assessorEmail: readWorkspacePartnershipLead(workspace),
    });
    writeFileSync(join(appDir, '.swao.yml'), yaml, 'utf-8');

    scaffold.imports(appDir);
    scaffold.ingestion(appDir);
    // Only scaffold the source/ landing area when we expect to clone into
    // it. For a local-path engagement the source lives outside the
    // workspace, so the scaffold would just litter wsp/inputs/source/.
    if (!localPath) scaffold.source(appDir);
    scaffold.landingZoneStubs(appDir);

    // #0398 (sprint-040): structured log so an operator's debug bundle
    // shows EXACTLY what they entered + what landed in .swao.yml. Single
    // line, parseable. Useful when an assessment fails later -- support
    // can see whether the operator typed a tree URL, what the splitter
    // produced, and what hand-edited yaml carried into the run.
    try {
      logApp(appId, 'info', 'tui.app.created', `App created from TUI New-App flow`, {
        context: {
          app_id: appId,
          source_mode: localPath ? 'local-path' : (url ? 'git-clone' : 'no-source'),
          vcs_url: url || null,
          vcs_ref: ref || null,
          vcs_subdir: subdir || null,
          local_path: localPath || null,
          vcs_type: url ? vcsType : null,
          yaml_path: join(appDir, '.swao.yml'),
        },
      });
    } catch { /* logging is best-effort; never block app creation */ }
  };

  // #0386: classify the operator's input at the "Source location" prompt.
  // A git URL kicks off the clone flow (branch + monorepo subdir prompts);
  // a local filesystem path skips both and writes source.path directly.
  const classifySourceInput = (raw: string): 'git-url' | 'local-path' | 'ambiguous' => {
    const v = raw.trim();
    if (!v) return 'ambiguous';
    if (/^(https?|ssh|git):\/\//i.test(v)) return 'git-url';
    if (/^git@[^:]+:/.test(v)) return 'git-url';
    // Windows drive letter, UNC, POSIX absolute, or existing dir
    if (/^[a-zA-Z]:[\\/]/.test(v)) return 'local-path';
    if (v.startsWith('\\\\')) return 'local-path';
    if (v.startsWith('/'))    return 'local-path';
    try { if (existsSync(v))  return 'local-path'; } catch { /* fall through */ }
    return 'ambiguous';
  };

  // #0391 (sprint-040): when an operator pastes a GitHub *tree-view* URL
  // (e.g. https://github.com/org/repo/tree/main/apps/health/sovereign-health)
  // we split it into the clone URL + ref + subdirectory so SWAO can clone
  // cleanly. Before this split, the whole URL was stored as the clone
  // *target path* on disk, producing `C:\...\source\https:\github.com\...`
  // -- which Windows rejects (colon in path) and `git clone` reports as
  // "could not create leading directories". Returns null when the input
  // is not a tree URL so the regular git-url path applies.
  interface SplitTreeUrl { cloneUrl: string; ref: string; subdir: string }
  const splitGithubTreeUrl = (raw: string): SplitTreeUrl | null => {
    // Bound first: a repo URL is short; capping keeps the multi-`[^/]+` match
    // constant-time on many-`/` input (CodeQL js/polynomial-redos).
    const m = raw.trim().slice(0, 2048).match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/([^/]+)(?:\/(.+))?$/i);
    if (!m) return null;
    return {
      cloneUrl: (m[1] ?? '').replace(/\.git$/, '') + '.git',
      ref:      m[2] ?? 'main',
      subdir:   (m[3] ?? '').replace(/\/+$/, ''),
    };
  };

  // #0382 (sprint-040) -- was reading from `wsp/inputs/catalogs/standard/`
  // which is the legacy scope retired by ADR-0035 (sprint-039 #0358 Phase
  // 3). Now reads each community framework's `framework-meta.yaml` so the
  // list is folder-driven: deleting a folder under
  // `wsp/inputs/catalogs/community/` removes the framework from the picker.
  const discoverRegimes = (): RegimeOption[] =>
    discoverCommunityRegimes(workspace, assessmentTypeToScopeToken(assessmentType), scaffold.bundledCommunityDir);

  const lzProviderName = (id: string): string =>
    scaffold.lzCatalogueHint?.entries.find(e => e.provider === id)?.name ?? id;

  // #1021: truncate a string to fit within the usable terminal line width.
  const truncateLabel = (s: string, reservedChars = 0): string => {
    const cols = (process.stdout.columns ?? 80) - 2 - reservedChars;
    return s.length > cols ? s.slice(0, Math.max(0, cols - 3)) + '...' : s;
  };

  // Read the app's current regimes from .swao.yml. #0245: defaults to
  // ['all'] (the picker sentinel that expands to every available regime)
  // so first-time consultants see every regime pre-selected and Enter
  // accepts the "all regimes recommended" default without exploration.
  // #0689: filter stored IDs against currently installed frameworks so stale
  // entries (from a prior full-install) do not become phantom pre-selections.
  const readAppRegimes = (appId: string): string[] => {
    if (!workspace) return ['all'];
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return ['all'];
    try {
      // #0755: compliance-evaluator reads assessment.regimes_active (since #0748).
      // Fall back to top-level regimes for workspaces created before the fix.
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as {
        regimes?: string[];
        assessment?: { regimes_active?: string[] };
      } | null;
      const stored =
        (Array.isArray(yml?.assessment?.regimes_active) && (yml?.assessment?.regimes_active?.length ?? 0) > 0
          ? yml!.assessment!.regimes_active!
          : null) ??
        (Array.isArray(yml?.regimes) && (yml?.regimes?.length ?? 0) > 0 ? yml!.regimes! : null) ??
        ['all'];
      return filterRegimesAgainstInstalled(stored, discoverCommunityRegimes(workspace, undefined, scaffold.bundledCommunityDir).map(r => r.id));
    } catch { return ['all']; }
  };

  // #0800: read the saved pass profile from the app's .swao.yml assessment.pass_profile.
  // #0901: dynamic and malware are always opt-in -- stripped from any stored profile so
  // they are never pre-selected regardless of what was saved in a previous run.
  // #1018: normalize stored entries -- lowercase + dedup + restrict to known PASS_OPTIONS
  // values so stale uppercase entries (INV, LZR, MAL) or duplicates are silently dropped.
  const readAppPassProfile = (appId: string): string[] => {
    const OPT_IN = new Set(['dynamic', 'malware', 'all']);
    const VALID_KEYS = new Set(PASS_OPTIONS.map(o => o.value));
    if (!workspace) return DEFAULT_PASS_KEYS;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return DEFAULT_PASS_KEYS;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as {
        assessment?: { pass_profile?: string[] };
      } | null;
      const stored = yml?.assessment?.pass_profile;
      if (Array.isArray(stored) && stored.length > 0) {
        const seen = new Set<string>();
        const normalized = stored
          .map(p => (typeof p === 'string' ? p.toLowerCase() : ''))
          .filter(p => VALID_KEYS.has(p) && !OPT_IN.has(p) && !seen.has(p) && seen.add(p) !== undefined);
        return normalized.length > 0 ? normalized : DEFAULT_PASS_KEYS;
      }
    } catch { /* fall through */ }
    return DEFAULT_PASS_KEYS;
  };

  // #0800: persist the chosen pass profile to assessment.pass_profile in app .swao.yml.
  // #0886: if malware is selected, auto-write a passes.malware block when not already present.
  const writeAppPassProfile = (appId: string, chosen: string[]): void => {
    if (!workspace) return;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
      const assessment = (yml['assessment'] ?? {}) as Record<string, unknown>;
      assessment['pass_profile'] = chosen;
      yml['assessment'] = assessment;
      if (chosen.includes('malware')) {
        const passes = (yml['passes'] ?? {}) as Record<string, unknown>;
        if (!passes['malware']) {
          passes['malware'] = {
            tools: {
              gitleaks: { enabled: true },
              osv: { enabled: true },
              clamav: { enabled: true },
              yara: { enabled: true },
              ort: { enabled: false },
            },
          };
          yml['passes'] = passes;
        }
      }
      writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
    } catch { /* best-effort */ }
  };

  // #0800: write per-app LLM override to the app's .swao.yml providers.llm.primary block.
  const writeAppLlmProvider = (appId: string, type: string, model?: string, endpoint?: string): void => {
    if (!workspace) return;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
      const providers = (yml['providers'] ?? {}) as Record<string, unknown>;
      const llm = (providers['llm'] ?? {}) as Record<string, unknown>;
      const primary: Record<string, unknown> = { type };
      if (model)    primary['model']    = model;
      if (endpoint) primary['endpoint'] = endpoint;
      llm['primary']    = primary;
      providers['llm']  = llm;
      yml['providers']  = providers;
      writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
    } catch { /* best-effort */ }
  };

  // #0800: clear per-app LLM override so the workspace default is used.
  const clearAppLlmProvider = (appId: string): void => {
    if (!workspace) return;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
      const providers = yml['providers'] as Record<string, unknown> | undefined;
      if (!providers) return;
      delete (providers['llm'] as Record<string, unknown> | undefined)?.['primary'];
      writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
    } catch { /* best-effort */ }
  };

  // Persist the chosen regimes back to the app's .swao.yml. Round-trips
  // the YAML so other keys (source, vcs, context_inputs) are preserved.
  const writeAppRegimes = (appId: string, chosen: string[]): void => {
    if (!workspace) return;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
      // #0755: write to assessment.regimes_active (compliance-evaluator reads this since #0748).
      const assessment = (yml['assessment'] ?? {}) as Record<string, unknown>;
      assessment['regimes_active'] = chosen;
      yml['assessment'] = assessment;
      writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
    } catch { /* best-effort */ }
  };

  // Existing app selected -- route to the appropriate next phase based on
  // the selected assessment type (#0630/#0631).
  const handleSelectApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setEditOnlyMode(false);
    // Self-heal: ensure ingestion/ exists for apps created before sprint-070.
    if (workspace) {
      try { scaffold.ingestion(join(workspace, 'apps', id)); } catch { /* best-effort */ }
    }
    setRegimes(readAppRegimes(id));
    // #0800: pre-load the saved pass profile so input-passes shows saved defaults.
    setInitialPassProfile(readAppPassProfile(id));
    // #0814: credential hub -- both application and landing-zone types; LZ shows
    // VCS section only (no Playwright). 'input-app-credentials' uses assessmentType
    // to conditionally render the Playwright section.
    setPhase('input-app-credentials');
  };

  // #0800: E key from input-app -- open credential hub in edit-only mode
  // (no assessment started; Enter/S in hub returns to input-app).
  const handleEditApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setEditOnlyMode(true);
    if (workspace) {
      try { scaffold.ingestion(join(workspace, 'apps', id)); } catch { /* best-effort */ }
    }
    setRegimes(readAppRegimes(id));
    setInitialPassProfile(readAppPassProfile(id));
    setPhase('input-app-credentials');
  };

  // New app entered in text field (no existing apps case)
  const handleNewAppId = (id: string) => {
    if (!id) return;
    setApp(id);
    setVcsUrl('');
    setVcsRef('');
    setSourcePath('');
    setIter('1');
    setPasses([]);
    // #1073/#1074: clear lens state so a new app never inherits the previous app's
    // lens selection, auto-frameworks, or pass profile.
    setSelectedLenses([]);
    setLensAutoFrameworks([]);
    lensAutoFrameworksRef.current = [];
    setInitialPassProfile(DEFAULT_PASS_KEYS);
    setPhase('input-vcs-url');
  };

  // #0379: was hardcoded 9 here but the actual ALL_PASSES contract is 12
  // (inv,state,data,ctx,sbom,tf,egr,crypto,synth,comp,blocks,scope). The 9
  // mismatch was the demo-visible "100 percent mid-Pass-11" bug; now the
  // denominator tracks the count actually being run.
  // #0659: landing-zone runs exactly one deterministic pass (lz_fit); skip the
  // passes[] state which is never populated for the LZ flow.
  // #0692: malware is opt-in -- not in ALL_PASSES -- so exclude it from the
  // denominator when individual passes are selected.
  const totalPasses = assessmentType === 'landing-zone'
    ? (appLzCatTargets.length || 1)
    : passes.includes('all')
      ? ALL_PASS_COUNT + (passes.includes('malware') ? 1 : 0)
      : passes.filter(p => p !== 'all').length;
  // Effective work-done. #0396 (sprint-040): on FAILURE keep the bar at
  // the last actual progress instead of snapping to 100 percent. The bar
  // turns red so the failure is unmistakable; jumping to 100 percent on
  // an exit-1 looked like the run succeeded but with warnings.
  const inProgressValue = Math.min(totalPasses, completedPasses + subFraction);
  const progressValue = done
    ? (code === 0 ? totalPasses : inProgressValue)
    : inProgressValue;
  // Show at least 10% when the assessment is actively running, so the bar
  // does not flash 0% before the first pass completes.
  const displayProgressValue = (phase === 'running' && progressValue === 0)
    ? totalPasses * 0.1
    : progressValue;

  // ---- render phases ----

  if (phase === 'input-app') {
    const existingApps: string[] = workspace && existsSync(join(workspace, 'apps'))
      ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
      : [];

    if (assessmentType === 'application' || existingApps.length > 0) {
      // #0763: for large workspaces (>FILTER_THRESHOLD apps) show a filter step first.
      if (existingApps.length > FILTER_THRESHOLD && appFilter === '') {
        return (
          <Box flexDirection="column" padding={1}>
            <Header subtitle={typeLabel} />
            <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
            <Text dimColor>{existingApps.length} apps found. Filter to narrow the list.</Text>
            <Box marginTop={1}>
              <TextInput
                key="app-filter"
                label="Filter by name (or Enter to show all)"
                placeholder="sovereign-health"
                onSubmit={(v) => setAppFilter(v || SHOW_ALL)}
                active
              />
            </Box>
            <GuidanceBox
              title="Filter apps"
              what={`${existingApps.length} apps in workspace. Type part of the app name to filter, or Enter to show all.`}
              affordances={['Type -- filter  |  Enter -- confirm filter  |  Esc -- back']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        );
      }

      // Audit and landing-zone operate on existing workspaces only; hide
      // workspace-management options that don't apply to those flows.
      // #0773: + New app... is first so on a fresh workspace (empty apps/) it
      // is the default selection. apps/ prefix preserved from #0762.
      const filteredApps = filterList(existingApps, appFilter, a => a);
      const appOptions = assessmentType === 'application'
        ? [
          { label: '+ New app...',     value: '__new__'    },
          ...filteredApps.map(a => ({ label: `apps/${a}`, value: a })),
          { label: '-- Delete app...', value: '__delete__' },
          { label: '-- Rename app...', value: '__rename__' },
        ]
        : filteredApps.map(a => ({ label: `apps/${a}`, value: a }));
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle={typeLabel} />
          <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
          {appFilter && appFilter !== SHOW_ALL && (
            <Text dimColor>Filter: <Text color="cyanBright">{appFilter}</Text>  ({filteredApps.length}/{existingApps.length} apps)  Esc to clear</Text>
          )}
          <Box marginTop={1}>
            <SelectInput
              label="Select application to assess"
              options={appOptions}
              onCursorChange={(v) => setAppCursorValue(v)}
              onSelect={(v) => {
                if      (v === '__new__')    setPhase('input-app-new');
                else if (v === '__delete__') setPhase('pick-delete');
                else if (v === '__rename__') setPhase('pick-rename');
                else                         handleSelectApp(v);
              }}
              active
            />
          </Box>
          <GuidanceBox
            title="Select app to assess"
            what={filteredApps.length !== existingApps.length
              ? `Showing ${filteredApps.length} of ${existingApps.length} apps matching "${appFilter}". Esc to reset filter.`
              : 'Choose the app from your workspace. Enter to confirm.'}
            affordances={['Up/Down -- pick  |  Enter -- start assessment  |  E -- edit settings  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        {workspace
          ? <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
          : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>No apps found in this workspace. Run `swao init` first to create one.</Text>
          <Box marginTop={1}>
            <TextInput
              key="input-app"
              label="Application ID (e.g. sovereign-health)"
              placeholder="sovereign-health"
              onSubmit={handleNewAppId}
              active
            />
          </Box>
        </Box>
      </Box>
    );
  }

  if (phase === 'input-app-new') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="New Application" />
        <Text>Workspace: <Text bold color="whiteBright">{workspace ?? '(none)'}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-new"
            label="New application ID (e.g. my-app)"
            placeholder="my-app"
            onSubmit={handleNewAppId}
            active
          />
        </Box>
        <GuidanceBox
          title="New application ID"
          what="Folder-safe identifier for this app in the engagement (e.g. my-app)."
          details={[{ label: 'Format', value: 'Lowercase letters, digits, hyphens' }]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-lz-provider') {
    const hint = scaffold.lzCatalogueHint;
    const providerOptions = hint?.entries.map(e => ({ label: `${e.name}  (${e.provider})`, value: e.provider })) ?? [];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Landing Zone Catalog Assessment" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        {/* #0765 stub: catalog sync indicator -- auto-sync planned for a future sprint */}
        <Text dimColor>  Catalog: bundled  |  run `swao lz catalogue update` to refresh</Text>
        <Box marginTop={1}>
          {providerOptions.length > 0 ? (
            <MultiSelect
              label="Cloud provider(s)"
              options={providerOptions}
              onConfirm={(selected) => {
                if (selected.length === 0) return;
                setAppLzCatProviders(selected);
                setAppLzCatFrameworks([]);
                setAppLzRegionFilter('');
                setPhase('input-lz-frameworks');
              }}
            />
          ) : (
            <TextInput
              key="input-lz-provider"
              label="Cloud provider (aws, azure, stackit, ...)"
              placeholder="aws"
              onSubmit={(raw) => {
                const v = raw.trim();
                if (!v) return;
                setAppLzCatProviders([v]);
                setAppLzCatFrameworks([]);
                setAppLzRegionFilter('');
                setPhase('input-lz-frameworks');
              }}
              active
            />
          )}
        </Box>
        <GuidanceBox
          title="Cloud Service Provider"
          what="The CSP whose service catalogue SWAO fetches and matches the app's assessed requirements. Select multiple CSPs to run a side-by-side comparison."
          details={[
            { label: 'Edit catalogues', value: 'Place a lz-catalogues/ folder in the workspace root to override or extend the bundled provider JSON files.' },
            { label: 'aws vs aws-esc', value: 'Standard aws (eu-central-1) is SOVEREIGNTY_BLOCKED under BSI_C5/Cloud Act frameworks -- it is a US-entity operator subject to FISA 702 and the US Cloud Act. Select aws-esc (AWS European Sovereign Cloud, AWS EMEA SARL) for EU-entity sovereignty evaluation: no Cloud Act extraterritorial exposure.' },
            { label: 'aws-iso-e', value: 'AWS ISOE Europe (aws-iso-e) is for classified/government environments only -- not applicable to standard commercial sovereign workloads.' },
          ]}
          affordances={['Up/Down -- move  |  Space -- toggle  |  A -- all  |  Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-lz-frameworks') {
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);
    const discovered = scaffold.discoverLzGateFrameworks?.(workspace ?? '', app) ?? [];
    const lzFwOptions = applyLzCuratedLabels(discovered);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Landing Zone Catalog Assessment" />
        <LzCatalogPicker
          app={app}
          providerLabel={providerLabel}
          options={lzFwOptions}
          visibleCount={passVisibleCount}
          onConfirm={(selected) => {
            setAppLzCatFrameworks(selected);
            setPhase('input-lz-region');
          }}
          onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-lz-region') {
    const hint = scaffold.lzCatalogueHint;
    // Build a flat list of provider:region options from ALL selected providers (#0899).
    // Label includes country code in brackets so filtering by "DE", "AT" etc. works (#1000).
    // Regions sorted alphabetically within each provider (#1291: eu01 before eu02 in STACKIT).
    const allTargetOptions = appLzCatProviders.flatMap(pid => {
      const entry = hint?.entries.find(e => e.provider === pid);
      if (!entry) return [];
      return [...entry.regions]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(r => ({
          label: `${pid.toUpperCase()} / ${r.id} - ${r.display}${r.country ? ` [${r.country}]` : ''}`,
          value: `${pid}:${r.id}`,
        }));
    });
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);

    // Case 1: large catalogue -- show filter prompt first.
    if (allTargetOptions.length > FILTER_THRESHOLD && appLzRegionFilter === '') {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle="Landing Zone Catalog Assessment" />
          <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
          <Text dimColor>{allTargetOptions.length} regions available. Type a substring to filter.</Text>
          <Box marginTop={1}>
            <TextInput
              key="lz-region-filter"
              label="Filter by provider/region ID or name (Enter to show all)"
              placeholder="eu, Frankfurt, aws"
              onSubmit={(v) => setAppLzRegionFilter(v || SHOW_ALL)}
              active
            />
          </Box>
          <GuidanceBox
            title="Filter regions"
            what={`${allTargetOptions.length} regions across ${appLzCatProviders.length} CSP(s). Type part of the region ID or display name, or Enter to show all.`}
            details={[
              { label: 'Filter by provider', value: 'Type the provider key (e.g. "stackit", "aws", "gcp") to see ALL regions for that provider -- not just the ones visible before filtering.' },
              { label: 'STACKIT Germany vs Austria', value: 'STACKIT has two regions: eu01 (Germany, BSI_C5-certified -- READY under BSI_C5 frameworks) and eu02 (Austria, ISO_27001 only -- SOVEREIGNTY_BLOCKED under BSI_C5). Type "stackit" or "eu01" to reach the German region.' },
            ]}
            affordances={['Type -- filter  |  Enter -- apply  |  Esc -- back to provider']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    // Case 2: catalogue available (small list or filter applied).
    const filteredTargetOptions = filterList(allTargetOptions, appLzRegionFilter, r => r.label);
    if (allTargetOptions.length > 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle="Landing Zone Catalog Assessment" />
          <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
          {appLzRegionFilter && appLzRegionFilter !== SHOW_ALL && (
            <Text dimColor>Filter: <Text color="cyanBright">{appLzRegionFilter}</Text>  ({filteredTargetOptions.length}/{allTargetOptions.length} regions)
              {appLzCatProviders.length > 1 && (
                <Text dimColor>  [{appLzCatProviders.map(pid => {
                  const n = filteredTargetOptions.filter(o => o.value.startsWith(`${pid}:`)).length;
                  return `${pid.toUpperCase()}: ${n}`;
                }).join('  ')}]</Text>
              )}
              <Text dimColor>  Esc to clear</Text>
            </Text>
          )}
          <Box marginTop={1}>
            {filteredTargetOptions.length > 0 ? (
              <MultiSelect
                key={`lz-region-${appLzCatProviders.join('-')}-${appLzRegionFilter}`}
                label="Target region(s) -- Space to toggle, Enter to confirm"
                options={filteredTargetOptions}
                visibleCount={12}
                onConfirm={(selected) => {
                  if (selected.length === 0) return;
                  setAppLzCatTargets(selected);
                  setPhase('running');
                }}
              />
            ) : (
              <Text color="yellow">No regions match "{appLzRegionFilter}". Press Esc to clear filter.</Text>
            )}
          </Box>
          <GuidanceBox
            title="Target Regions"
            what={appLzRegionFilter && appLzRegionFilter !== SHOW_ALL
              ? `${filteredTargetOptions.length} of ${allTargetOptions.length} combinations match "${appLzRegionFilter}".`
              : `${allTargetOptions.length} provider/region combinations. Select all targets to compare in one run.`}
            affordances={['Up/Down -- move  |  Space -- toggle  |  A -- all  |  Enter -- confirm  |  Esc -- clear filter or back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    // Case 3: no catalogue data -- manual TextInput fallback.
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Landing Zone Catalog Assessment" />
        <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-lz-region"
            label="Region ID (e.g. eu-central-1, westeurope)"
            placeholder="eu-central-1"
            onSubmit={(raw) => {
              const v = raw.trim();
              if (!v) return;
              const target = appLzCatProviders.length > 0
                ? `${appLzCatProviders[0]}:${v}`
                : v;
              setAppLzCatTargets([target]);
              setPhase('running');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Landing Zone Region"
          what="No region catalogue loaded. Enter the region ID manually. Run `swao lz catalogue list` to see available regions."
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0732: optional target LZ step for app assessments -- Esc skips to running.
  if (phase === 'input-app-lz-provider') {
    const hint = scaffold.lzCatalogueHint;
    const providerOptions = hint?.entries.map(e => ({ label: `${e.name}  (${e.provider})`, value: e.provider })) ?? [];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Application Assessment -- Target Landing Zone (optional)" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text dimColor>  Select one or more target CSPs. HTML publication will show per-service readiness for each. <Text color="yellow">Esc to skip.</Text></Text>
        <Box marginTop={1}>
          {providerOptions.length > 0 ? (
            <MultiSelect
              label="Cloud provider(s)"
              options={providerOptions}
              allowEmptyConfirm
              onConfirm={(selected) => {
                if (selected.length === 0) { setPhase('running'); return; }
                setAppLzCatProviders(selected);
                setAppLzRegionFilter('');
                setPhase('input-app-lz-region');
              }}
            />
          ) : (
            <TextInput
              key="input-app-lz-provider"
              label="Cloud provider (aws, azure, stackit, ...)"
              placeholder="aws"
              onSubmit={(raw) => {
                const v = raw.trim();
                if (!v) { setPhase('running'); return; }
                setAppLzCatProviders([v]);
                setAppLzRegionFilter('');
                setPhase('input-app-lz-region');
              }}
              active
            />
          )}
        </Box>
        <GuidanceBox
          title="Target Landing Zone"
          what="Optional: select one or more CSPs and regions to run catalogue fits during this assessment. Each combination produces a readiness block in the HTML publication."
          affordances={['Up/Down -- move  |  Space -- toggle  |  A -- select all  |  Enter -- confirm  |  Esc -- skip LZ step']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-app-lz-region') {
    const hint = scaffold.lzCatalogueHint;
    // Build a flat list of provider:region options from ALL selected providers.
    // Regions sorted alphabetically within each provider (#1291: eu01 before eu02 in STACKIT).
    const allTargetOptions = appLzCatProviders.flatMap(pid => {
      const entry = hint?.entries.find(e => e.provider === pid);
      if (!entry) return [];
      return [...entry.regions]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(r => ({
          label: `${pid.toUpperCase()} / ${r.id} - ${r.display}`,
          value: `${pid}:${r.id}`,
        }));
    });
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);

    if (allTargetOptions.length > FILTER_THRESHOLD && appLzRegionFilter === '') {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle="Application Assessment -- Target Landing Zone (optional)" />
          <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
          <Text dimColor>{allTargetOptions.length} regions available. Type a substring to filter. <Text color="yellow">Esc to skip.</Text></Text>
          <Box marginTop={1}>
            <TextInput
              key="app-lz-region-filter"
              label="Filter by provider/region ID or name (Enter to show all)"
              placeholder="eu, Frankfurt, aws-esc"
              onSubmit={(v) => setAppLzRegionFilter(v || SHOW_ALL)}
              active
            />
          </Box>
          <GuidanceBox
            title="Filter regions"
            what={`${allTargetOptions.length} provider/region combinations for ${providerLabel}. Type part of the region ID or name, or press Enter to show all.`}
            affordances={['Type -- filter  |  Enter -- apply  |  Esc -- back to provider']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    const filteredTargetOptions = filterList(allTargetOptions, appLzRegionFilter, r => r.label);
    if (allTargetOptions.length > 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle="Application Assessment -- Target Landing Zone (optional)" />
          <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
          {appLzRegionFilter && appLzRegionFilter !== SHOW_ALL && (
            <Text dimColor>Filter: <Text color="cyanBright">{appLzRegionFilter}</Text>  ({filteredTargetOptions.length}/{allTargetOptions.length} regions)  Esc to clear</Text>
          )}
          <Box marginTop={1}>
            {filteredTargetOptions.length > 0 ? (
              <MultiSelect
                key={`app-lz-region-${appLzCatProviders.join('-')}-${appLzRegionFilter}`}
                label="Target region(s)"
                options={filteredTargetOptions}
                initialSelected={appLzCatTargets.length > 0 ? appLzCatTargets : (filteredTargetOptions[0] ? [filteredTargetOptions[0].value] : [])}
                allowEmptyConfirm
                visibleCount={12}
                onConfirm={(selected) => {
                  tuiDebug(`input-app-lz-region:onConfirm selected=[${selected.join(',')}]`);
                  if (selected.length === 0) { setPhase('running'); return; }
                  setAppLzCatTargets(selected);
                  setPhase('running');
                }}
              />
            ) : (
              <Text color="yellow">No regions match "{appLzRegionFilter}". Press Esc to clear filter.</Text>
            )}
          </Box>
          <GuidanceBox
            title="Target Region(s)"
            what={appLzRegionFilter && appLzRegionFilter !== SHOW_ALL
              ? `${filteredTargetOptions.length} of ${allTargetOptions.length} combinations match "${appLzRegionFilter}".`
              : `${allTargetOptions.length} provider/region combinations across ${appLzCatProviders.length} CSP(s). Select all targets to compare in one run.`}
            affordances={['Up/Down -- move  |  Space -- toggle  |  A -- select all  |  Enter -- confirm  |  Esc -- clear filter or back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    // No catalogue loaded for the selected providers -- fall back to manual entry.
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Application Assessment -- Target Landing Zone (optional)" />
        <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-lz-region"
            label="Region ID (e.g. eu-central-1, westeurope)"
            placeholder="eu-central-1"
            onSubmit={(raw) => {
              const v = raw.trim();
              if (!v) { setPhase('running'); return; }
              const target = appLzCatProviders.length > 0
                ? `${appLzCatProviders[0]}:${v}`
                : v;
              setAppLzCatTargets([target]);
              setPhase('running');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Target Region"
          what="No region catalogue loaded for the selected provider(s). Enter the region ID manually."
          affordances={['Enter -- confirm  |  Esc -- skip']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-vcs-url') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="New Application" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text dimColor>Enter the git repository URL -- SWAO clones it before running assessment passes. Branch and subdir follow on the next screen.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-vcs-url"
            label="Git repository URL"
            placeholder="https://github.com/org/repo"
            onSubmit={(raw) => {
              const value = raw.trim();
              setSourceInputWarning('');
              const kind = classifySourceInput(value);
              if (!value) {
                // Empty -- create the app with no source; operator wires it later
                createApp(app, '', '', '', '');
                setRegimes(['all']);
                setPhase('input-playwright-url');
                return;
              }
              if (kind === 'local-path') {
                // Absolute local path: skip clone, write source.path directly
                setVcsUrl('');
                setVcsRef('');
                setVcsSubdir('');
                createApp(app, '', '', '', value);
                setRegimes(['all']);
                setPhase('input-playwright-url');
                return;
              }
              if (kind === 'ambiguous') {
                // #0516 AC#2: relative path or unrecognised string -- reject with guidance
                setSourceInputWarning(
                  `'${value}' is not a recognised URL or absolute path.\n` +
                  `  git URL:     https://github.com/org/repo  or  git@github.com:org/repo.git\n` +
                  `  local path:  C:\\path\\to\\app  (Windows)  or  /path/to/app  (POSIX)\n` +
                  `  Enter alone to skip and configure manually later.`,
                );
                return;
              }
              // #0391: GitHub tree-view URL? Auto-split into clone URL +
              // ref + subdir so the operator never has to fight Windows'
              // refusal to create folders containing `:` and `/`.
              const split = splitGithubTreeUrl(value);
              if (split) {
                setVcsUrl(split.cloneUrl);
                setVcsRef(split.ref);
                setVcsSubdir(split.subdir);
                createApp(app, split.cloneUrl, split.ref, split.subdir, '');
                setRegimes(['all']);
                setPhase('input-playwright-url');
                return;
              }
              setVcsUrl(value);
              setPhase('input-vcs-ref');
            }}
            active
          />
        </Box>
        {sourceInputWarning ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">{sourceInputWarning}</Text>
          </Box>
        ) : null}
        <GuidanceBox
          title="Git repository URL"
          what="SWAO clones the repository using git. Private repos require a stored VCS token (swao credential set vcs-token)."
          details={[
            { label: 'GitHub',       value: 'https://github.com/org/repo' },
            { label: 'Azure DevOps', value: 'https://dev.azure.com/org/project/_git/repo' },
            { label: 'GitLab',       value: 'https://gitlab.com/org/repo' },
            { label: 'SSH',          value: 'git@github.com:org/repo.git' },
            { label: 'Local path',   value: 'C:\\path\\to\\app  (absolute -- skips clone)' },
          ]}
          affordances={['Enter -- confirm  |  Esc -- back  |  Enter alone -- skip']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-vcs-ref') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="New Application" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text>URL: <Text color="cyanBright">{vcsUrl}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-vcs-ref"
            label="Branch / ref (Enter for main)"
            placeholder="main"
            onSubmit={(ref) => {
              setVcsRef(ref || 'main');
              setVcsSubdir('');
              setPhase('input-source-subdir');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Branch / ref"
          what="Branch, tag, or commit SHA to assess. Enter for main."
          details={[{ label: 'Format', value: 'Branch name, tag, or 40-char SHA' }]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-source-subdir') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="New Application" />
        <Text>App: <Text color="cyanBright">{app}</Text>  Ref: <Text color="cyanBright">{vcsRef}</Text></Text>
        <Text dimColor>If the repository is a monorepo, enter the path to the app inside it.</Text>
        <Text dimColor>Example: <Text color="cyanBright">apps/health/sovereign-health</Text>  -- or press Enter if the root is the app.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-source-subdir"
            label="App subdirectory within repository (Enter if repo root is the app)"
            placeholder="apps/my-app"
            onSubmit={(subdirRaw) => {
              // #0395 (sprint-040): sanitise the subdir input. Operators
              // sometimes paste a full GitHub tree URL here instead of
              // just the path-after-tree, which Windows then rejects as
              // a folder name. Strip http(s)://host/owner/repo/tree/ref/
              // prefix if present so the operator gets a working clone
              // either way.
              // Bound first: a pasted repo URL is short; capping keeps the
              // multi-`[^/]+` match constant-time (CodeQL js/polynomial-redos).
              let subdir = subdirRaw.trim().slice(0, 2048);
              const treeMatch = subdir.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/tree\/[^/]+\/(.+)$/i);
              if (treeMatch) subdir = (treeMatch[1] ?? '').replace(/\/+$/, '');
              // Reject any leftover URL-ish characters that would break
              // Windows directory creation.
              subdir = subdir.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
              if (/^[a-zA-Z]+:\/\//.test(subdir) || subdir.includes(':')) {
                // Bail out -- still looks like a URL or has a colon
                setVcsSubdir('');
                createApp(app, vcsUrl, vcsRef, '', '');
              } else {
                setVcsSubdir(subdir);
                createApp(app, vcsUrl, vcsRef, subdir, '');
              }
              setRegimes(['all']);
              setPhase('input-playwright-url');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="App subdirectory"
          what="For monorepos: subfolder containing this app. Enter for repo root."
          details={[{ label: 'Format', value: 'Relative path, no leading slash (e.g. apps/billing)' }]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-playwright-url') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-playwright-url"
            label="Playwright crawl URL (Enter to skip)"
            placeholder="https://app.example.com"
            onSubmit={(raw) => {
              const target = raw.trim();
              if (!target) {
                // Empty URL -- skip all crawl sub-steps entirely (#0776-C).
                setPhase('input-app-credentials');
                return;
              }
              // #0885: check for an existing URL match in the credential store.
              setPlaywrightUrl(target);
              const freshCreds = readStoredCredentials();
              const matchSrc = Object.entries(freshCreds).find(
                ([k, v]) => k.startsWith('playwright-url-') && v === target && k !== `playwright-url-${app}`,
              );
              if (matchSrc) {
                setPlaywrightUrlMatchSourceApp(matchSrc[0].replace('playwright-url-', ''));
                setPlaywrightUrlReuseOrigin('wizard');
                setPhase('input-playwright-url-reuse');
              } else {
                // #0776-C: store URL; collect login credentials before writing.
                setPhase('input-playwright-username');
              }
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Playwright crawl URL"
          what="SWAO can crawl the app web UI to capture screenshots and network traces during the dynamic analysis pass. Provide the base URL of the running app. Leave empty to skip dynamic analysis."
          details={[{ label: 'Stored in', value: 'apps/' + app + '/.swao.yml  (crawl.target_url)' }]}
          affordances={['Enter -- save URL and continue to login step', 'Enter (empty) -- skip crawl setup  |  Esc -- back to credentials']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0885: credential reuse -- offer to copy stored creds from another app with the same URL.
  if (phase === 'input-playwright-url-reuse') {
    const reuseOptions = [
      { label: `Reuse credentials from app "${playwrightUrlMatchSourceApp}"`, value: 'reuse' },
      { label: 'Enter new credentials', value: 'new' },
    ];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text dimColor>URL <Text color="cyanBright">{playwrightUrl}</Text> is already stored for app <Text color="cyanBright">{playwrightUrlMatchSourceApp}</Text>.</Text>
        <Box marginTop={1}>
          <SelectInput
            label="Reuse stored credentials?"
            options={reuseOptions}
            onSelect={(v) => {
              if (v === 'reuse') {
                const freshCreds = readStoredCredentials();
                const srcUser = freshCreds[`playwright-user-${playwrightUrlMatchSourceApp}`];
                const srcPass = freshCreds[`playwright-pass-${playwrightUrlMatchSourceApp}`];
                if (workspace && playwrightUrl) {
                  const appYmlPath = join(workspace, 'apps', app, '.swao.yml');
                  writeCrawlSection(appYmlPath, {});
                }
                writeCredential(`playwright-url-${app}`, playwrightUrl);
                if (srcUser) writeCredential(`playwright-user-${app}`, srcUser);
                if (srcPass) writeCredential(`playwright-pass-${app}`, srcPass);
                setPlaywrightUrl('');
                setPlaywrightUsername('');
                setPlaywrightUrlMatchSourceApp('');
                setPhase('input-app-credentials');
              } else {
                setPlaywrightUrlMatchSourceApp('');
                // #0908: hub flow uses the hub-specific username/password sub-steps.
                setPhase(playwrightUrlReuseOrigin === 'hub' ? 'input-app-cred-playwright-user' : 'input-playwright-username');
              }
            }}
          />
        </Box>
        <GuidanceBox
          title="Reuse credentials"
          what={`The URL "${playwrightUrl}" is already configured for app "${playwrightUrlMatchSourceApp}". Reuse copies the stored username and password so you do not have to re-enter them.`}
          affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back to URL entry']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0776-C: inline Playwright login sub-step 1 -- username.
  if (phase === 'input-playwright-username') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-playwright-username"
            label="Playwright login username (Enter to skip)"
            placeholder="username"
            onSubmit={(raw) => {
              setPlaywrightUsername(raw.trim());
              setPhase('input-playwright-password');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Playwright login username"
          what="Optional: username for the crawl target login form. Leave empty to skip authentication."
          details={[{ label: 'Stored in', value: 'apps/' + app + '/.swao.yml  (crawl.username)' }]}
          affordances={['Enter -- save username and continue', 'Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0776-C: inline Playwright login sub-step 2 -- password.
  // Writing all crawl fields atomically here (URL + username + password).
  if (phase === 'input-playwright-password') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-playwright-password"
            label="Playwright login password (Enter to skip)"
            mask="*"
            onSubmit={(raw) => {
              const password = raw.trim();
              if (workspace && playwrightUrl) {
                const appYmlPath = join(workspace, 'apps', app, '.swao.yml');
                writeCrawlSection(appYmlPath, {});
                writeCredential(`playwright-url-${app}`, playwrightUrl);
                if (playwrightUsername) {
                  writeCredential(`playwright-user-${app}`, playwrightUsername);
                }
                if (password) {
                  writeCredential(`playwright-pass-${app}`, password);
                }
              }
              setPlaywrightUrl('');
              setPlaywrightUsername('');
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Playwright login password"
          what="Optional: password for the crawl target login form. Stored encrypted in the SWAO credential vault -- safe to use real credentials."
          details={[{ label: 'Stored in', value: 'SWAO credential vault  (crawl-password:<hostname>)' }]}
          affordances={['Enter -- save password and continue', 'Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: credential hub -- shows stored status and shortcuts for each sub-step.
  // Landing Zone assessments show only the VCS section; Playwright section is
  // hidden because LZ assessments are static catalogue comparisons (no crawler).
  if (phase === 'input-app-credentials') {
    const vcsUrlKey   = `vcs-url-${app}`;
    const vcsKey      = `vcs-token-${app}`;
    const pwUrlKey    = `playwright-url-${app}`;
    const pwUserKey   = `playwright-user-${app}`;
    const pwPassKey   = `playwright-pass-${app}`;
    const pwMfaKey    = `playwright-mfa-${app}`;
    const s = (k: string) => appCredStoredKeys.has(k);
    const dot = (k: string) => (
      <Text color={s(k) ? 'green' : 'gray'}>{s(k) ? '[stored]' : '[  --  ]'}</Text>
    );
    const isLz = assessmentType === 'landing-zone';
    const continueLabel = editOnlyMode ? 'Save + back' : 'continue';
    const affordances = isLz
      ? [`R -- repo URL  |  T -- access token  |  L -- LLM override  |  Enter/S -- ${continueLabel}  |  Esc -- back`]
      : [`R -- repo URL  |  A -- access token  |  T -- Playwright URL  |  U -- PW username  |  P -- PW password  |  M -- MFA seed  |  L -- LLM override  |  Enter/S -- ${continueLabel}  |  Esc -- back`];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text>{editOnlyMode && <Text dimColor>  (edit mode -- Enter to save and return)</Text>}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Credentials for this app</Text>
          <Text color="gray">Press a shortcut to edit a credential, or Enter to continue.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>  VCS:</Text>
          <Text>    {dot(vcsUrlKey)}  <Text bold>R</Text>  Repository URL</Text>
          <Text>    {dot(vcsKey)}  <Text bold>A</Text>  Access token</Text>
          {!isLz && <Text>  Playwright:</Text>}
          {!isLz && <Text>    {dot(pwUrlKey)}  <Text bold>T</Text>  Target URL</Text>}
          {!isLz && <Text>    {dot(pwUserKey)}  <Text bold>U</Text>  Username</Text>}
          {!isLz && <Text>    {dot(pwPassKey)}  <Text bold>P</Text>  Password</Text>}
          {!isLz && <Text>    {dot(pwMfaKey)}  <Text bold>M</Text>  MFA seed (TOTP base32)</Text>}
        </Box>
        <GuidanceBox
          title="Per-app credentials"
          what="Credentials are keyed to this app only (not shared). Stored securely in the SWAO credential store. All fields are optional -- skip any that do not apply."
          details={isLz
            ? [{ label: 'VCS URL key', value: vcsUrlKey }, { label: 'VCS token key', value: vcsKey }]
            : [
                { label: 'VCS URL key', value: vcsUrlKey },
                { label: 'VCS token key', value: vcsKey },
                { label: 'Playwright URL key', value: pwUrlKey },
                { label: 'MFA seed format', value: 'base32, 16-32 chars (e.g. JBSWY3DPEHPK3PXP)' },
              ]}
          affordances={affordances}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: per-app VCS repository URL input
  if (phase === 'input-app-cred-vcs-url') {
    const credKey = `vcs-url-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-vcs-url"
            label={alreadyStored ? 'Repository URL (Enter to keep existing)' : 'Repository URL (Enter to skip)'}
            placeholder="https://github.com/org/repo"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="VCS repository URL"
          what="Full HTTPS clone URL for the application source repository. Stored per-app so different apps can point to different repositories."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: per-app VCS token input
  if (phase === 'input-app-cred-vcs-token') {
    const credKey = `vcs-token-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-vcs-token"
            label={alreadyStored ? 'VCS token (Enter to keep existing)' : 'VCS token (Enter to skip)'}
            placeholder=""
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="VCS token"
          what="Personal access token or deploy token for cloning the app repository. Stored per-app so different apps can use different accounts."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: per-app Playwright crawl URL input (from the credential hub)
  if (phase === 'input-app-cred-playwright-url') {
    const credKey = `playwright-url-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-url"
            label={alreadyStored ? 'Playwright target URL (Enter to keep existing)' : 'Playwright target URL (Enter to skip)'}
            placeholder="https://app.example.com"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                // #0908: check for an existing URL match before storing (mirrors wizard flow).
                setPlaywrightUrl(val);
                const freshCreds = readStoredCredentials();
                const matchSrc = Object.entries(freshCreds).find(
                  ([k, v]) => k.startsWith('playwright-url-') && v === val && k !== credKey,
                );
                if (matchSrc) {
                  setPlaywrightUrlMatchSourceApp(matchSrc[0].replace('playwright-url-', ''));
                  setPlaywrightUrlReuseOrigin('hub');
                  setPhase('input-playwright-url-reuse');
                  return;
                }
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Playwright target URL"
          what="URL the Playwright crawler navigates to for this app. Stored per-app in the credential store so different apps can target different URLs."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: Playwright login username
  if (phase === 'input-app-cred-playwright-user') {
    const credKey = `playwright-user-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-user"
            label={alreadyStored ? 'Playwright login username (Enter to keep existing)' : 'Playwright login username (Enter to skip)'}
            placeholder=""
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Playwright login username"
          what="Username for form-based or basic authentication during the Playwright dynamic analysis crawl. Leave empty if the app does not require authentication."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: Playwright login password
  if (phase === 'input-app-cred-playwright-pass') {
    const credKey = `playwright-pass-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-pass"
            label={alreadyStored ? 'Playwright login password (Enter to keep existing)' : 'Playwright login password (Enter to skip)'}
            placeholder=""
            mask="*"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Playwright login password"
          what="Password for form-based or basic authentication during the Playwright dynamic analysis crawl. Stored encrypted in the SWAO credential store."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back  |  Ctrl+E -- reveal/hide']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0814: Playwright MFA / TOTP seed
  if (phase === 'input-app-cred-playwright-mfa') {
    const credKey = `playwright-mfa-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-mfa"
            label={alreadyStored ? 'TOTP MFA seed (Enter to keep existing)' : 'TOTP MFA seed (Enter to skip)'}
            placeholder="JBSWY3DPEHPK3PXP"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="MFA / TOTP seed"
          what="Base32-encoded TOTP secret for multi-factor authentication. SWAO generates a one-time code from this seed at crawl time. Typically found in the app authenticator setup QR code."
          details={[
            { label: 'Credential key', value: credKey },
            { label: 'Format', value: 'base32, 16-32 uppercase chars (e.g. JBSWY3DPEHPK3PXP)' },
          ]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0800: per-app LLM provider override
  if (phase === 'input-app-llm') {
    const currentAppLlm = readAppLlmConfig(workspace, app);
    const currentLabel = formatLlmCurrentLabel(currentAppLlm.type, currentAppLlm.model, wsLlmConfig.type);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <LlmModelPicker
          app={app}
          currentLabel={currentLabel}
          onSelect={(v) => {
            if (v === 'workspace-default') {
              clearAppLlmProvider(app);
            } else {
              writeAppLlmProvider(app, v);
            }
            setPhase('input-app-credentials');
          }}
          onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'pick-delete') {
    const existingApps: string[] = workspace && existsSync(join(workspace, 'apps'))
      ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
          .filter(d => d.isDirectory()).map(d => d.name)
      : [];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Delete Application" />
        <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
        <Text color="yellow">Select one or more apps to delete (space to toggle, Enter to confirm).</Text>
        <Box marginTop={1}>
          <MultiSelect
            label="Apps"
            options={existingApps.map(a => ({ label: a, value: a }))}
            initialSelected={[]}
            onConfirm={(selected) => {
              if (selected.length === 0) { setPhase('input-app'); return; }
              setDeleteSelection(selected);
              setPhase('confirm-delete');
            }}
            active
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Escape to cancel.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Confirm Delete" />
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text color="yellow" bold>Delete the following app{deleteSelection.length === 1 ? '' : 's'} permanently?</Text>
          {deleteSelection.map(id => (
            <Text key={id}>  apps/<Text color="cyanBright">{id}</Text>/  (all WSP runs, exports, and source code)</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text bold>Type <Text color="green">y</Text> to confirm, <Text color="yellow">n</Text> or Escape to cancel.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'pick-rename') {
    const existingApps: string[] = workspace && existsSync(join(workspace, 'apps'))
      ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
          .filter(d => d.isDirectory()).map(d => d.name)
      : [];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Rename Application" />
        <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
        <Box marginTop={1}>
          <SelectInput
            label="Select the app to rename"
            options={existingApps.map(a => ({ label: a, value: a }))}
            onSelect={(v) => { setRenameTarget(v); setPhase('input-rename'); }}
            active
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Escape to cancel.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'input-rename') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Rename Application" />
        <Text>Renaming: <Text color="cyanBright">{renameTarget}</Text></Text>
        <Text dimColor>New id must be lowercase, alphanumeric, hyphen-separated.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-rename"
            label="New application id"
            placeholder={renameTarget}
            onSubmit={(newId) => {
              if (!newId || newId === renameTarget) { setPhase('input-app'); return; }
              if (!/^[a-z][a-z0-9-]*$/.test(newId)) {
                setOpError(`Invalid id "${newId}". Use lowercase letters, digits, and hyphens; must start with a letter.`);
                setOpMessage('');
                setPhase('op-done');
                return;
              }
              try {
                if (!workspace) throw new Error('No workspace found');
                const oldDir = join(workspace, 'apps', renameTarget);
                const newDir = join(workspace, 'apps', newId);
                if (!existsSync(oldDir)) throw new Error(`Source directory does not exist: apps/${renameTarget}/`);
                if (existsSync(newDir))  throw new Error(`Target id already exists: apps/${newId}/`);
                renameSync(oldDir, newDir);
                const ymlPath = join(newDir, '.swao.yml');
                if (existsSync(ymlPath)) {
                  const yml = readFileSync(ymlPath, 'utf-8');
                  // Rewrite both id and name fields (the latter often mirrors id; keep it consistent).
                  const updated = yml
                    .replace(/(^|\n)(\s*)id:\s*[^\n]+/,   `$1$2id: ${newId}`)
                    .replace(/(^|\n)(\s*)name:\s*"[^"]*"/, `$1$2name: "${newId}"`);
                  writeFileSync(ymlPath, updated, 'utf-8');
                }
                setOpMessage(`Renamed apps/${renameTarget}/ to apps/${newId}/`);
                setOpError('');
              } catch (e) {
                setOpError((e as Error).message);
                setOpMessage('');
              }
              setPhase('op-done');
            }}
            active
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Escape to cancel.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'op-done') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        {opMessage && <Text color="green">{opMessage}</Text>}
        {opError   && <Text color="red">Error: {opError}</Text>}
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Escape to return.</Text>
        </Box>
      </Box>
    );
  }

  // #1020: ingestion folder tip -- shown once before lens/regime selection.
  if (phase === 'input-ingest-tip') {
    const ingestPath = workspace
      ? `${workspace}${workspace.endsWith('/') || workspace.endsWith('\\') ? '' : '/'}apps/${app ?? '<app>'}/wsp/inputs/`
      : `wsp/inputs/`;
    const truncIngest = truncateLabel(ingestPath, 0);
    return (
      <Box flexDirection="column" padding={1}>
        <Header contextPrefix={typeLabel} subtitle="Ingestion Folder" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Before starting the assessment, you can drop files into the ingestion folder.</Text>
          <Text>Pass 00 (INGEST) will pick them up and incorporate them into the analysis.</Text>
        </Box>
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width={guidanceWidth}>
          <Text><Text bold>Ingestion folder:</Text></Text>
          <Text color="cyanBright">{truncIngest}</Text>
          <Text dimColor>Supported: .pdf, .docx, .txt, .md, .yaml, .json, .csv, screenshots</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press <Text bold>Enter</Text> to continue  |  <Text bold>Esc</Text> to go back.</Text>
        </Box>
      </Box>
    );
  }

  // #0985 Design 074 Step 3: lens selection.
  if (phase === 'input-lenses') {
    const lenses = scaffold.lenses ?? [];
    const activeLenses = selectedLenses.length > 0
      ? selectedLenses
      : (workspace ? (scaffold.readWorkspaceLenses?.(workspace) ?? []) : []);
    return (
      <Box flexDirection="column" padding={1}>
        <Header contextPrefix={typeLabel} subtitle="Assessment Lenses" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Lenses pre-configure the pass set and auto-select compliance frameworks.</Text>
          <Text dimColor>Select lenses matching your assessment goal, or skip with Enter for defaults.</Text>
        </Box>
        <Box marginTop={1}>
          <MultiSelect
            label="Select lenses (space to toggle, Enter to confirm)"
            options={lenses.map(l => {
              if (l.auto_frameworks.length > 0) {
                // #1019: show DEMO suffix when only demo variant is installed
                const installedRegimeIds = new Set((workspace ? discoverRegimes() : []).map(r => r.id.toLowerCase()));
                const resolvedFw = l.auto_frameworks.map(fw => {
                  if (installedRegimeIds.has(fw.toLowerCase())) return fw;
                  if (installedRegimeIds.has((fw + '_DEMO').toLowerCase())) return fw + '_DEMO';
                  return fw;
                });
                return { label: `${l.id}  (auto: ${resolvedFw.join(', ')})`, value: l.id };
              }
              return {
                label: `${l.id}${l.passes.length > 0 ? `  (${l.passes.length} passes)` : ''}`,
                value: l.id,
              };
            })}
            initialSelected={activeLenses}
            onCursorChange={(v) => setLensCursor(v)}
            onConfirm={(chosen) => {
              scaffold.saveWorkspaceLenses?.(workspace ?? '', chosen);
              setSelectedLenses(chosen);
              // #0987: pre-populate frameworks from lens auto-selection
              const confirmed = lenses.filter(l => chosen.includes(l.id));
              // #1059: resolve each auto_framework to the installed variant (GDPR -> GDPR_DEMO
              // when only the demo is present) so the regime selector can find and pre-select it.
              const installedIds = new Set((workspace ? discoverRegimes() : []).map(r => r.id.toLowerCase()));
              const autoFw = Array.from(new Set(confirmed.flatMap(l =>
                l.auto_frameworks.map(fw => {
                  if (installedIds.has(fw.toLowerCase())) return fw;
                  if (installedIds.has((fw + '_DEMO').toLowerCase())) return fw + '_DEMO';
                  return fw;
                })
              )));
              lensAutoFrameworksRef.current = autoFw;   // #1068: sync ref before phase transition
              setLensAutoFrameworks(autoFw);
              // #0986: merge lens passes into pass profile
              // #1054: normalise to lowercase so Set dedup works when prev has lowercase entries.
              const lensPasses = Array.from(new Set(confirmed.flatMap(l => l.passes.map(p => p.toLowerCase()))));
              // #1074: when a lens prescribes specific passes, REPLACE the profile with
              // exactly those passes so the picker shows only the lens-intended selection.
              // Previously, the guard `prev.includes('all') ? prev` silently discarded
              // lens passes when the default 'all' profile was active.
              if (lensPasses.length > 0) {
                setInitialPassProfile(lensPasses);
              }
              setPhase('input-regimes');
            }}
            active
            allowEmptyConfirm
          />
        </Box>
        {(() => {
          const focusedLens = lenses.find(l => l.id === lensCursor);
          if (!focusedLens) return null;
          return (
            <GuidanceBox
              title={`Lens: ${focusedLens.id}`}
              what={focusedLens.description ?? 'No description available for this lens.'}
              details={[
                { label: 'Passes', value: focusedLens.passes.length > 0 ? focusedLens.passes.join(', ') : '(none)' },
                { label: 'Auto-frameworks', value: focusedLens.auto_frameworks.length > 0 ? focusedLens.auto_frameworks.join(', ') : '(none)' },
              ]}
              affordances={['Space -- toggle  |  Enter -- confirm or skip (no lens = use defaults)  |  Esc -- back']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          );
        })()}
        <Box marginTop={1}>
          <Text dimColor>Esc to go back.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'input-regimes') {
    const available = discoverRegimes();
    // Compute initialSelected: merge lens auto-frameworks into existing regime selection.
    // #0987/#1068: read from ref for synchronous access; state may not propagate yet.
    const computedInitialSelected = (() => {
      const autoFw = lensAutoFrameworksRef.current;
      if (autoFw.length === 0) return regimes;
      const installedIds = available.map(r => r.id);
      // #1019: DEMO fallback -- if exact ID not installed, check for <ID>_DEMO variant
      const validAuto = autoFw.flatMap(fw => {
        const exactMatch = installedIds.find(id => id.toLowerCase() === fw.toLowerCase());
        if (exactMatch) return [exactMatch];
        const demoMatch = installedIds.find(id => id.toLowerCase() === (fw + '_DEMO').toLowerCase());
        if (demoMatch) return [demoMatch];
        return [];
      });
      return Array.from(new Set([...regimes.filter(r => r !== 'all'), ...validAuto]));
    })();
    const pickerOptions: CommunityFrameworkOption[] = available.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      authority: r.authority,
      controlsCount: r.controlsCount,
      slug: r.slug,
      contributorName: r.contributorName,
    }));
    return (
      <Box flexDirection="column" padding={1}>
        <Header contextPrefix={typeLabel} subtitle="Community Frameworks" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <CommunityFrameworkPicker
          app={app}
          options={pickerOptions}
          initialSelected={computedInitialSelected}
          onConfirm={(chosen) => {
            setRegimes(chosen);
            writeAppRegimes(app, chosen);
            setPhase('input-passes');
          }}
          onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-passes') {
    const llmMode = detectedProvider;
    const llmColor = 'green';
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header subtitle={typeLabel} />
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text>{'   '}</Text>
            <Text>LLM: <Text color={llmColor}>{llmMode}</Text><Text dimColor>  (L)</Text></Text>
          </Box>
          <Box flexDirection="row">
            <Text>Stats: <Text color={showStats ? 'green' : 'gray'}>{showStats ? 'on' : 'off'}</Text><Text dimColor>  (S)</Text></Text>
            <Text>{'   '}</Text>
            <Text>LLM cache: <Text color={useCassette ? 'yellow' : 'green'}>{useCassette ? 'on (reuse cached)' : 'off (always fresh)'}</Text><Text dimColor>  (C to toggle)</Text></Text>
            {sourcePath && <><Text>{'   '}</Text><Text>Source: <Text color="green">{sourcePath}</Text><Text dimColor>  (P)</Text></Text></>}
            {iter !== '1' && <><Text>{'   '}</Text><Text>Iter: <Text color="green">{iter}</Text><Text dimColor>  (I)</Text></Text></>}
          </Box>
        </Box>
        <MultiSelect
          label="Select passes to run"
          options={PASS_OPTIONS}
          initialSelected={initialPassProfile}
          allValue="all"
          onCursorChange={(v) => setPassCursor(v)}
          onConfirm={(selected) => {
            setPasses(selected);
            // #0800: persist the chosen profile so the next run pre-selects it.
            writeAppPassProfile(app, selected);
            // #0833: warn before the run if dynamic_analysis is selected but
            // Chromium is not installed. Runs fresh here so re-entering the
            // screen after install picks up the new state without a restart.
            // The bundled playwright-core can use any discovered Chromium via
            // executablePath -- an npm package check is not needed (#0971).
            const hasDynamic = selected.includes('dynamic') || selected.includes('all');
            const chromiumMissing = findInstalledChromium() === null;
            if (hasDynamic && chromiumMissing) {
              setPhase('playwright-warn');
            } else {
              setPhase(assessmentType === 'application' ? 'input-app-lz-provider' : 'running');
            }
          }}
          active
          visibleCount={passVisibleCount}
        />
        {(() => {
          if (passCursor === 'all') {
            return (
              <GuidanceBox
                title="All passes"
                what={`Runs all ${ALL_PASS_COUNT} passes (inv through scope, including dynamic crawl). Static: ~30 s. LLM passes: 3-8 min. Malware (14) excluded -- opt-in only.`}
                details={[
                  { label: 'Static',    value: 'inv, state, sbom, tf, egr, crypto, scope' },
                  { label: 'Dynamic',   value: 'dynamic (Playwright crawl -- requires Chromium)' },
                  { label: 'LLM',       value: 'data, ctx, synth, comp, blocks' },
                  { label: 'Stats (S)', value: 'Show per-pass timing + token cost table at end of run' },
                  { label: 'Cache (C)', value: 'Reuse cached LLM responses -- faster, no API cost for reruns' },
                ]}
                affordances={['Space -- toggle  |  A -- all  |  Enter -- run  |  Esc -- back']}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
            );
          }
          const longName = PASS_SHORT_TO_LONG[passCursor];
          const desc = longName ? PASS_DESCRIPTIONS[longName] : undefined;
          if (!desc) return null;
          return (
            <GuidanceBox
              title={`${passCursor} -- ${longName!.replace(/_/g, ' ')}`}
              what={desc.summary}
              details={desc.tip ? [{ label: 'Tip', value: desc.tip }] : []}
              affordances={['Space -- toggle this pass', 'A -- toggle all', 'Enter -- confirm + run', 'Esc -- back to framework selector']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          );
        })()}
      </Box>
    );
  }

  // #0833: playwright-warn phase -- shown when dynamic_analysis is selected
  // but Chromium is not installed. Operator can proceed or return to pass selection.
  if (phase === 'playwright-warn') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1} width={guidanceWidth}>
          <Text color="yellow">Pass 10 (dynamic_analysis) requires the Chromium browser, which is not installed.</Text>
          <Text dimColor>The pass will fail mid-run because no Chromium executable was found.</Text>
          <Text dimColor>Deselect it or install Chromium to continue.</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            label="Continue anyway?"
            options={[
              { label: 'Yes -- proceed with dynamic_analysis (will fail at runtime)', value: 'yes' },
              { label: 'No -- return to pass selection', value: 'no' },
            ]}
            onSelect={(value) => {
              if (value === 'yes') {
                setPhase(assessmentType === 'application' ? 'input-app-lz-provider' : 'running');
              } else {
                setPhase('input-passes');
              }
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Chromium not installed"
          what="Pass 10 (dynamic_analysis) crawls the application UI using a Playwright-controlled Chromium browser. It is safe to skip if you only need static analysis results."
          details={[
            { label: 'Install', value: `npx playwright@${PLAYWRIGHT_VERSION} install chromium` },
            { label: 'Detect',  value: 'swao doctor   (Playwright row shows installed path)' },
          ]}
          affordances={['Enter -- confirm selection', 'Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-source-path') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header contextPrefix={typeLabel} subtitle="Source Path Override" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text dimColor>Overrides the source.path field in apps/{app}/.swao.yml for this run only.</Text>
        <Text dimColor>Leave empty (Enter on blank) to clear the override.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-source-path"
            label="Source path (absolute or relative to workspace)"
            placeholder={sourcePath || 'C:/path/to/source'}
            onSubmit={(value) => { setSourcePath(value); setPhase('input-passes'); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Source Path Override"
          what="Overrides source.path for this run only -- does not persist to .swao.yml."
          details={[
            { label: 'Format', value: 'Absolute path (C:/...) or workspace-relative path' },
            { label: 'Persist', value: 'Edit source.path in apps/{app}/.swao.yml to make it permanent' },
          ]}
          affordances={['Enter -- apply override  |  Esc -- back to passes']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
        <Box marginTop={1}>
          <Text dimColor>Escape to cancel without changing.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'input-iter') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header contextPrefix={typeLabel} subtitle="Iteration Number" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text dimColor>Pins the iteration number in the run-manifest. Defaults to 1.</Text>
        <Text dimColor>Useful for re-running the same assessment with the same iter tag.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-iter"
            label="Iteration number"
            placeholder={iter}
            onSubmit={(value) => {
              const trimmed = (value || '1').trim();
              const n = parseInt(trimmed, 10);
              setIter(Number.isFinite(n) && n > 0 ? String(n) : '1');
              setPhase('input-passes');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Iteration Number"
          what="Tags the run-manifest with an iteration counter. Useful for comparing repeated runs."
          details={[
            { label: 'Default', value: '1' },
            { label: 'Usage', value: 'Increment each time you re-run to track assessment evolution' },
          ]}
          affordances={['Enter -- confirm  |  Esc -- back to passes']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
        <Box marginTop={1}>
          <Text dimColor>Escape to cancel without changing.</Text>
        </Box>
      </Box>
    );
  }

  // #0407 (sprint-040 round-6): assessment-done summary screen. Pauses
  // between the final pass [ok] line + the BI export prompt so the
  // operator can see the green 100% bar, the summary, and decide
  // explicitly to continue (Enter) or quit (Escape).
  if (phase === 'assess-done') {
    const signalsTotal = lines.filter(l => l.startsWith('[ok]  Pass ') || l.startsWith('[skip]  Pass ')).length;
    const isLz = assessmentType === 'landing-zone';
    const passesLabel = passes.includes('all') ? 'all' : (passes.join(', ').length > 40 ? `${passes.slice(0, 3).join(', ')} +${passes.length - 3} more` : passes.join(', '));
    // #0716: detect connectivity-degraded passes from structured warning lines.
    const degradedPasses = lines
      .filter(l => l.includes('connectivity-degraded pass='))
      .map(l => { const m = l.match(/pass=(\S+)/); return m ? m[1] : null; })
      .filter((p): p is string => p !== null);
    // #1004: detect skipped passes from structured warning lines emitted before the run.
    const skippedPassGroups: Array<{ passes: string; reason: string }> = [];
    if (lines.some(l => l.includes('Pass 10 (dynamic_analysis) skipped'))) {
      skippedPassGroups.push({ passes: 'dynamic (10)', reason: 'Playwright not installed' });
    }
    if (lines.some(l => l.includes('No LLM provider configured'))) {
      skippedPassGroups.push({ passes: 'data, ctx, synth, comp, blocks', reason: 'no LLM provider configured' });
    }
    // #1108: detect catalogue-only LZ run (no prior app assessment provided service signals).
    const lzCatalogueOnly = isLz && lines.some(l => l.includes('No app required-services found'));
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <ProgressBar value={totalPasses} total={totalPasses} label="done" color="green" />
        <Text color="green">Assessment complete.</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>  App:          <Text color="cyanBright">{app}</Text></Text>
          {isLz ? (
            <>
              <Text>  Passes:       <Text color="cyanBright">{appLzCatTargets.length} (lz_fit)</Text></Text>
              {lzTargetVerdicts.length > 0 ? (
                <Box flexDirection="column">
                  <Text>  Verdicts:</Text>
                  {lzTargetVerdicts.map(tv => {
                    const col = tv.verdict === 'ready' ? 'green' : tv.verdict === 'advisory' ? 'yellow' : 'red';
                    return (
                      <Text key={tv.target}>    <Text color="cyanBright">{tv.target}</Text>{'  '}<Text color={col}>{tv.verdict.toUpperCase()}</Text>{tv.gaps > 0 ? <Text dimColor>{`  (${tv.gaps} gap${tv.gaps !== 1 ? 's' : ''})`}</Text> : null}</Text>
                    );
                  })}
                </Box>
              ) : (
                <>
                  {lzVerdict === 'ready' && <Text>  Verdict:      <Text color="green">READY  (all LZ controls passed)</Text></Text>}
                  {lzVerdict === 'blocked' && <Text>  Verdict:      <Text color="red">BLOCKED  (blocker-severity controls failed -- review run dir)</Text></Text>}
                  {lzVerdict === 'advisory' && <Text>  Verdict:      <Text color="yellow">ADVISORY  (advisory warnings raised -- migration score penalised)</Text></Text>}
                  {lzVerdict && lzVerdict !== 'ready' && lzVerdict !== 'blocked' && lzVerdict !== 'advisory' && <Text>  Verdict:      <Text color="gray">{lzVerdict.toUpperCase()}</Text></Text>}
                </>
              )}
              <Text>  Outputs:      <Text color="cyanBright">apps/{app}/wsp/runs/&lt;ts&gt;/passes/lz-fit*.yaml</Text></Text>
              {lzCatalogueOnly && (
                <Box marginTop={1} flexDirection="column">
                  <Text color="yellow">  [!] Catalogue-only result: no service signals found from a prior App Assessment.</Text>
                  <Text dimColor>      Service-fit gap analysis was skipped. Run App Assessment first, then re-run LZ for full results.</Text>
                </Box>
              )}
            </>
          ) : (
            <>
              <Text>  Passes:       <Text color="cyanBright">{totalPasses} ({passesLabel})</Text></Text>
              <Text>  LLM:          <Text color="cyanBright">{detectedProvider}</Text></Text>
              <Text>  Pass files:   <Text color="cyanBright">{signalsTotal} written</Text></Text>
              <Text>  Outputs:      <Text color="cyanBright">apps/{app}/wsp/passes/ + wsp/runs/&lt;ts&gt;/</Text></Text>
            </>
          )}
        </Box>
        {/* #0928: block assessment summary from 12-blocks.yaml */}
        {!isLz && Object.keys(blockVerdicts).length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>  Block assessments:</Text>
            {(['observability', 'licence', 'testing', 'architecture', 'db', 'integration', 'iam', 'dr'] as const).map(k => {
              const v = blockVerdicts[k];
              if (!v) return null;
              const col = v === 'SATISFACTORY' ? 'green' : v === 'PARTIAL' ? 'yellow' : v === 'UNSATISFACTORY' ? 'red' : 'gray';
              const label = k.charAt(0).toUpperCase() + k.slice(1);
              return (
                <Text key={k}>    <Text dimColor>{label.padEnd(16)}</Text><Text color={col}>{v}</Text></Text>
              );
            })}
          </Box>
        )}
        {degradedPasses.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">  {degradedPasses.length} pass{degradedPasses.length > 1 ? 'es' : ''} degraded (LLM connectivity failure): {degradedPasses.join(', ')}</Text>
            <Text dimColor>  Results are incomplete. Re-run when network access is restored.</Text>
            {logFilePath ? <Text dimColor>  <Text color="cyanBright">L</Text> -- view retry trace in log</Text> : null}
          </Box>
        ) : null}
        {skippedPassGroups.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">  {skippedPassGroups.length} pass group{skippedPassGroups.length > 1 ? 's' : ''} skipped:</Text>
            {skippedPassGroups.map(sg => (
              <Text key={sg.passes} dimColor>    {sg.passes} -- {sg.reason}</Text>
            ))}
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text>Press <Text color="cyanBright">Esc</Text> (or Enter) to return to the main menu.{logFilePath ? <Text>  <Text color="cyanBright">L</Text> -- view log</Text> : null}{!isLz && onChallenge ? <Text>  <Text color="cyanBright">C</Text> -- Stakeholder Challenge</Text> : null}{isLz && onLzChallenge ? <Text>  <Text color="cyanBright">C</Text> -- LZ Sovereignty Challenge</Text> : null}</Text>
        </Box>
        <GuidanceBox
          title="Assessment complete"
          what={isLz
            ? (lzVerdict === 'ready'
                ? (appLzCatFrameworks.length === 0
                    ? 'No sovereignty framework was selected. READY means catalogue-level service requirements are met for the selected regions. Sovereignty compliance is not confirmed -- select a framework on the next run to apply the sovereignty gate.'
                    : 'No blockers detected for the selected regions and frameworks. Catalogue-level service requirements are met. Check the lz-catalogue-fit YAML for sovereignty_active status. Use swao publish to include the LZ Catalogue section in the HTML report.')
                : lzVerdict === 'sovereignty_blocked'
                  ? 'One or more target regions fail sovereignty requirements from the active frameworks. Red regions lack required certifications or operator jurisdiction. Select compliant regions or adjust the framework selection.'
                  : lzVerdict === 'blocked'
                    ? 'One or more compliance controls failed with severity: blocker. All migration paths are downgraded to Retain until blockers are resolved. Review 23-lzr.yaml in the run directory for the failing controls.'
                    : lzVerdict === 'advisory'
                      ? 'No hard blockers, but advisory-severity controls raised warnings. Migration scores are penalised (-0.15). Review advisory items before proceeding.'
                      : 'Landing-zone fit written to the run dir. Use swao publish to include the LZ Catalogue section in the HTML report.')
            : 'All passes finished and written to the run dir. To produce the Power BI export bundle, use the Export BI menu (or run `swao export`) when you are ready.'}
          details={[{ label: 'Run dir', value: `apps/${app}/wsp/runs/<latest>/` }]}
          affordances={[
            ...(logFilePath ? ['L -- view log file'] : []),
            ...(!isLz && onChallenge ? ['C -- Stakeholder Challenge'] : []),
            ...(isLz && onLzChallenge ? ['C -- LZ Sovereignty Challenge'] : []),
            'Esc -- main menu',
          ]}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // #0988 Design 074 Step 8: post-assessment challenge prompt (#1109: also for LZ).
  if (phase === 'challenge-prompt') {
    const isLzPrompt = assessmentType === 'landing-zone';
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={isLzPrompt ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge'} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>{isLzPrompt
            ? 'Assessment complete. Run an LZ Sovereignty Challenge?'
            : 'Assessment complete. Run a Stakeholder Challenge?'}
          </Text>
          {isLzPrompt ? (
            <>
              <Text dimColor>Four AI agent personas challenge the sovereignty verdicts, CSP selection, and contractual basis.</Text>
              <Text dimColor>Results are saved to wsp/challenge-lz/ (separate from App challenge output).</Text>
            </>
          ) : (
            <>
              <Text dimColor>A Stakeholder Challenge runs AI-powered agent reviews of the assessment findings.</Text>
              <Text dimColor>Results are saved to wsp/challenge-app/ alongside the HTML report.</Text>
            </>
          )}
        </Box>
        <Box marginTop={2} flexDirection="column">
          <Text>  <Text color="green" bold>Enter</Text>  Run {isLzPrompt ? 'LZ Sovereignty' : 'Stakeholder'} Challenge</Text>
          <Text>  <Text color="yellow" bold>Esc</Text>    Skip and return to main menu</Text>
        </Box>
        <GuidanceBox
          title={isLzPrompt ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge'}
          what={isLzPrompt
            ? 'Four AI agent personas challenge the sovereignty verdicts and CSP selection based on your WSP: Sovereignty/GRC Reviewer, LZ Architect, Procurement/Vendor, and CISO/Security.'
            : 'Five AI agent personas challenge the assessment findings from their stakeholder perspective: Application Architect, Business Owner, GRC Compliance Officer, FinOps Lead, and Programme Manager.'}
          details={isLzPrompt
            ? [{ label: 'Output', value: 'apps/<app>/wsp/challenge-lz/<ts>/LZCA_<agent>.yaml' }]
            : [{ label: 'Output', value: 'apps/<app>/wsp/challenge-app/<ts>/AA_<agent>.yaml' }]}
          affordances={['Enter -- run challenge  |  Esc -- skip']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'export-prompt') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text color="green">Assessment complete -- {totalPasses} passes.</Text>
        <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}>
          <Text bold>Emit the BI export bundle now?</Text>
          <Text dimColor>Required input for the PowerBI dashboard (swao-report.pbit).</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            label=" "
            options={[
              { label: 'Yes -- emit CSV + NDJSON + XLSX (recommended)', value: 'yes' },
              { label: 'No  -- I will run swao export later',           value: 'no'  },
            ]}
            onSelect={(v) => setPhase(v === 'yes' ? 'export-running' : 'done')}
            active
          />
        </Box>
        <GuidanceBox
          title="Emit BI export bundle?"
          what="Exports CSV + NDJSON + XLSX for PowerBI (~2-5 s). You can also run this later from Export BI."
          affordances={['Up/Down -- Yes/No  |  Enter -- confirm  |  Esc -- skip']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  // running / export-running / done
  const inExportPhase = phase === 'export-running' || (phase === 'done' && (exportDone || exportLines.length > 0));

  // #0410 (sprint-040 round-9): once export completes successfully, the
  // assessment-progress panel + LiveOutput are redundant noise (the user
  // is here for the PowerBI paths). Render a focused "export complete"
  // view with just the header, the export results panel + GuidanceBox,
  // and the footer. Operator round-8 feedback: "after I confirmed the
  // BI export I got the screen showing again the Pass results. this is
  // wrong I should only see the export screen".
  if (phase === 'done' && exportDone && exportCode === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Box>
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Text dimColor>  LLM: {detectedProvider}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text bold color="green">BI export complete -- ready for PowerBI</Text>
          {exportBundleDir && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>1. SWAOExportPath (press <Text color="cyanBright">C</Text> to copy):</Text>
              <Text bold color="whiteBright">   {exportBundleDir}</Text>
            </Box>
          )}
          {exportPbitPath && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>2. App report template (press <Text color="cyanBright">R</Text> to open):</Text>
              <Text bold color="whiteBright">   {exportPbitPath}</Text>
            </Box>
          )}
          {exportPortfolioPbitPath && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>3. Portfolio template (press <Text color="cyanBright">P</Text> to open):</Text>
              <Text bold color="whiteBright">   {exportPortfolioPbitPath}</Text>
            </Box>
          )}
          {workspace && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>4. EvidenceUrlPrefix (press <Text color="cyanBright">E</Text> to copy):</Text>
              <Text bold color="whiteBright">   file:///{workspace.replace(/\\/g, '/')}/apps/{app}/</Text>
            </Box>
          )}
          {exportActionToast && (
            <Box marginTop={1}>
              <Text color="yellow">{exportActionToast}</Text>
            </Box>
          )}
        </Box>
        <GuidanceBox
          title="BI export complete"
          what="Use the hot-keys to open templates and copy paths into PowerBI."
          details={[
            { label: 'R / P', value: 'Open report / portfolio template in PowerBI Desktop' },
            { label: 'C / E', value: 'Copy SWAOExportPath / EvidenceUrlPrefix to clipboard' },
          ]}
          affordances={['R/P -- open  |  C/E -- copy path  |  Enter/Esc -- main menu']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Escape to return to menu...</Text>
        </Box>
      </Box>
    );
  }
  // #0657: always cap to 5 lines while running so the guidance box + footer
  // stay visible regardless of which pass is active (including passes that
  // have no PASS_DESCRIPTIONS entry).  Only expand to the full terminal-
  // height-aware cap once the assessment is done and the output is static.
  // #1676: show starting panel until first pass name arrives so the panel area
  // is never blank during the clone/pre-analysis phase (~0-10% progress).
  const startPanelVisible = !done && !passName;
  const passInfoVisible = !done && !!passName && PASS_DESCRIPTIONS[passName] !== undefined;
  const effectiveLiveLines = done ? maxLiveLines : 5;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={typeLabel} />
      <ProgressBar
        value={displayProgressValue}
        total={totalPasses}
        label={done ? (code === 0 ? 'done' : `failed at ${passName || (assessmentType === 'landing-zone' ? 'setup' : 'pre-pass clone')}`) : (passSubLabel ? `${passName} -- ${passSubLabel}` : passName)}
        color={done ? (code === 0 ? 'green' : 'red') : 'cyan'}
      />
      {!done && <Text color="yellow">Running assessment...</Text>}
      {done && code === 0 && <Text color="green">Assessment complete.  {totalPasses} passes  {lines.filter(l => l.includes('signals emitted')).length} pass files written</Text>}
      {done && code !== 0 && <Text color="yellow">Assessment finished with warnings (exit {code}).</Text>}
      <LiveOutput lines={lines} maxLines={effectiveLiveLines} label="Output" />

      {/* Pass description / error context panel -- #1676: always visible when running */}
      {!done && (
        <Box marginTop={1}>
          <GuidanceBox
            title={passInfoVisible ? `Pass info -- ${passName.replace(/_/g, ' ')}` : 'Assessment in Progress'}
            what={passInfoVisible
              ? PASS_DESCRIPTIONS[passName]!.summary
              : (startPanelVisible
                ? 'Cloning source repository and preparing analysis passes...'
                : 'Assessment running. Each pass analyses a different workload dimension.')}
            details={passInfoVisible && PASS_DESCRIPTIONS[passName]!.tip
              ? [{ label: 'Tip', value: PASS_DESCRIPTIONS[passName]!.tip! }]
              : undefined}
            affordances={['Ctrl+G -- toggle this panel', 'Esc -- cancel assessment']}
            initiallyCollapsed
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {done && code !== 0 && failedPass && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1} width={guidanceWidth}>
          <Text bold color="yellow">[!] Pass {failedPass} failed</Text>
          <Text dimColor>{PASS_FAIL_ADVICE[failedPass] ?? 'Check the output above for details. Re-run this pass individually after fixing the issue.'}</Text>
        </Box>
      )}
      {done && code !== 0 && (() => {
        // #0391: error-context GuidanceBox. Surfaces the structured log
        // path + the most common remediation depending on what we can
        // detect in the stdout (currently: git clone tree-URL mishap).
        const lastLines = lines.slice(-12).join('\n');
        const cloneFailed = /git clone failed/i.test(lastLines);
        const treeUrl = /\/tree\//i.test(lastLines);
        const logPath = workspace ? `${workspace}/wsp/logs/portfolio-events-<YYYY-MM>.ndjson` : 'wsp/logs/portfolio-events-<YYYY-MM>.ndjson';
        return (
          <GuidanceBox
            title="Assessment failed -- where to look + how to react"
            what={cloneFailed
              ? (treeUrl
                ? 'The source URL appears to be a GitHub tree-view URL (containing `/tree/<ref>/<subdir>`). SWAO now auto-splits these into clone URL + branch + subdir, but this app was created with the un-split URL stored in `.swao.yml`. Edit `apps/<app>/.swao.yml` to point `source.vcs.url` at the bare repo URL and move the ref/subdir into their own fields, then re-run.'
                : 'git clone failed before any pass ran. Most common causes: wrong URL, missing VCS token for a private repo, or corporate proxy blocking outbound HTTPS to the git host. Inspect the stderr above for the exact reason; for private repos confirm the token is stored via Setup Step 2.')
              : 'A pass exited non-zero. The "Pass info" panel above (if visible) explains the most likely cause; the structured log entry carries the full traceback.'}
            details={[
              { label: 'Exit code',  value: `${code}` },
              { label: 'Log file',   value: logPath },
              { label: 'Tail logs',  value: 'swao log tail --level error' },
              { label: 'Re-run',     value: cloneFailed ? 'After editing .swao.yml: run Assessment again from the main menu' : 'After fixing the issue, you can re-run a single pass instead of the whole assessment' },
            ]}
            affordances={['Enter -- return to main menu', 'Escape -- return to main menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        );
      })()}

      {inExportPhase && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text bold color="cyanBright">BI export</Text>
          {!exportDone && <Text color="yellow">Emitting CSV + NDJSON + XLSX bundle...</Text>}
          {exportDone && exportCode === 0 && (
            <>
              <Text color="green">Bundle ready.</Text>
              {exportBundleDir && (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>1. SWAOExportPath (press <Text color="cyanBright">C</Text> to copy):</Text>
                  <Text bold color="whiteBright">   {exportBundleDir}</Text>
                </Box>
              )}
              {exportPbitPath && (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>2. App report template (press <Text color="cyanBright">R</Text> to open):</Text>
                  <Text bold color="whiteBright">   {exportPbitPath}</Text>
                </Box>
              )}
              {exportPortfolioPbitPath && (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>3. Portfolio template (press <Text color="cyanBright">P</Text> to open):</Text>
                  <Text bold color="whiteBright">   {exportPortfolioPbitPath}</Text>
                </Box>
              )}
              {workspace && (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>4. EvidenceUrlPrefix (press <Text color="cyanBright">E</Text> to copy; paste into PowerBI's EvidenceUrlPrefix parameter):</Text>
                  <Text bold color="whiteBright">   file:///{workspace.replace(/\\/g, '/')}/apps/{app}/</Text>
                </Box>
              )}
              {exportActionToast && (
                <Box marginTop={1}>
                  <Text color="yellow">{exportActionToast}</Text>
                </Box>
              )}
            </>
          )}
          {exportDone && exportCode !== 0 && (
            <Text color="yellow">Export finished with warnings (exit {exportCode}). Re-run from Main Menu, Export BI.</Text>
          )}
          <LiveOutput lines={exportLines} maxLines={8} />
        </Box>
      )}

      {phase === 'done' && code === 0 && !exportDone && exportLines.length === 0 && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text dimColor>When you are ready to produce the BI bundle, run:</Text>
          <Text color="cyanBright">  swao export --app {app} --formats csv,ndjson,xlsx</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>{done ? 'Press Enter or Escape to return to menu...' : 'Escape to cancel...'}</Text>
      </Box>
    </Box>
  );
}
