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

// #3431: deterministic cloud-native and portability scores. Both used to be
// LLM estimates (portability 0.6 for every application, cloud-native the
// 12-factor pass rate over the few determinate factors). The formulas and
// weights are in swao/controls/migration-scores-catalogue.yaml and are
// documented in docs/design/037 section 6.4 and docs/design/passes/079
// section 4.7.
//
// computeCloudNativeScore / computePortabilityScore are pure (no I/O): the same
// input always gives the same output. readMigrationScoreInputs reads the pass
// outputs of one run (01-inv, 06-tf, 07-egr) and the landing-zone catalogues;
// computeMigrationScores combines both. derive-plan writes the result to
// wsp.yaml `overall`; Pass 09 (SYNTH) shows it to the LLM as context and
// stamps it over anything the model returns.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { deriveConstraints, type Signal } from '@swao/core';
import {
  loadMigrationScoresCatalogue,
  PORTABILITY_COMPONENTS,
  type MigrationScoresCatalogue,
  type PortabilityComponentId,
} from '../catalogue/migration-scores-catalogue.js';
import { loadSovereignAvailability, sovereignProvidersFor } from '../catalogue/lz-sovereign-availability.js';

// ---------------------------------------------------------------------------
// Output shapes (written to wsp.yaml overall.cloud_native / overall.portability)
// ---------------------------------------------------------------------------

export type ScoreConfidence = 'high' | 'medium' | 'low';

export interface CloudNativeFactorResult {
  factor: string;
  status: string;
  weight: number;
  value: number;
}

export interface CloudNativeResult {
  score: number;
  /** Factors with a determinate status (pass, partial or fail). */
  factors_checked: number;
  /** Factors Pass 06 reported (determinate or unknown). */
  factors_total: number;
  confidence: ScoreConfidence;
  factors: CloudNativeFactorResult[];
}

export interface PortabilityComponent {
  id: PortabilityComponentId;
  /** Catalogue weight before renormalisation. */
  weight: number;
  /** false: no input data, weight dropped and the others renormalised. */
  used: boolean;
  /** 0..1, null when not used. */
  value: number | null;
  /** Why the component was not used, or how the value was derived. */
  reason: string;
  detail?: Record<string, unknown>;
}

export interface PortabilityResult {
  /** null when no component had input data. */
  score: number | null;
  components: PortabilityComponent[];
  components_used: PortabilityComponentId[];
  /** Share of the catalogue weight that had input data (1 = every component used). */
  weight_coverage: number;
}

export interface MigrationScores {
  /** Catalogue version, or why the catalogue was not loaded. */
  catalogue: string;
  cloud_native: CloudNativeResult | null;
  /** Why the cloud-native score is null. */
  cloud_native_skipped_reason?: string;
  portability: PortabilityResult | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Cloud-native score
// ---------------------------------------------------------------------------

export interface FactorScoreInput {
  factor: string;
  status: string;
}

/** Roman numeral prefix of a Pass 06 factor label ("III (Config)" -> "III"). */
export function factorKey(label: string): string {
  return label.trim().split(/\s+/)[0] ?? label;
}

const CN_STATUSES = ['pass', 'partial', 'unknown', 'fail'] as const;
type CnStatus = (typeof CN_STATUSES)[number];
function isCnStatus(s: string): s is CnStatus {
  return (CN_STATUSES as readonly string[]).includes(s);
}

/**
 * Weighted 12-factor coverage. `unknown` counts status_values.unknown (0.5)
 * instead of being excluded; an unrecognised status is treated as unknown.
 * Returns null when Pass 06 reported no factor.
 */
export function computeCloudNativeScore(
  factorScores: readonly FactorScoreInput[],
  cat: MigrationScoresCatalogue,
): CloudNativeResult | null {
  if (factorScores.length === 0) return null;
  const cfg = cat.cloud_native;
  const factors: CloudNativeFactorResult[] = factorScores.map((f) => {
    const status: CnStatus = isCnStatus(f.status) ? f.status : 'unknown';
    const weight = cfg.factor_weights[factorKey(f.factor)] ?? cfg.default_factor_weight;
    return { factor: f.factor, status, weight, value: cfg.status_values[status] };
  });
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const score = totalWeight > 0 ? factors.reduce((s, f) => s + f.weight * f.value, 0) / totalWeight : 0;
  const checked = factors.filter((f) => f.status !== 'unknown').length;
  const share = checked / factors.length;
  const confidence: ScoreConfidence = share >= cfg.confidence.high_min_checked_share
    ? 'high'
    : share >= cfg.confidence.medium_min_checked_share ? 'medium' : 'low';
  return { score: round2(score), factors_checked: checked, factors_total: factors.length, confidence, factors };
}

// ---------------------------------------------------------------------------
// Portability score
// ---------------------------------------------------------------------------

export interface PortabilityInputs {
  /**
   * Required capabilities (service_dep tokens) with the sovereign providers
   * offering each. null: the landing-zone catalogues were not available.
   */
  serviceAvailability: {
    required: Array<{ capability: string; providers: string[] }>;
    sovereign_providers: string[];
    catalogue_source: string;
  } | null;
  /** Vendor SDK scan (01-inv reference_catalogue_checks.vendor_sdk + vendor_sdks). */
  vendor: { check: string | null; hits: Array<{ id: string; sovereign_impact: string }> };
  /** Runtime evidence. null: Pass 01 output not available. */
  runtime: { kubernetes: boolean; container: boolean; evidence: string[] } | null;
  /** IaC evidence. null: neither Pass 01 nor Pass 06 output available. */
  iac: { present: boolean; evidence: string[] } | null;
  /** Egress evidence. null: Pass 07 output not available. */
  egress: {
    verdicts: Array<{ service: string; verdict: string }>;
    destinations: number;
    hardcoded_hosts: Array<{ host: string; classification: string }>;
  } | null;
}

export function computePortabilityScore(inputs: PortabilityInputs, cat: MigrationScoresCatalogue): PortabilityResult {
  const cfg = cat.portability;
  const comps: PortabilityComponent[] = [];
  const add = (id: PortabilityComponentId, value: number | null, reason: string, detail?: Record<string, unknown>): void => {
    comps.push({
      id,
      weight: cfg.weights[id],
      used: value !== null,
      value: value === null ? null : round2(Math.max(0, Math.min(1, value))),
      reason,
      ...(detail ? { detail } : {}),
    });
  };

  // service_availability
  const sa = inputs.serviceAvailability;
  const minProviders = cfg.service_availability.min_sovereign_providers;
  if (!sa) {
    add('service_availability', null, 'landing-zone catalogues not available');
  } else if (sa.required.length === 0) {
    add('service_availability', null, 'no required services derived (no service_dep signal)', {
      sovereign_providers: sa.sovereign_providers,
    });
  } else {
    const portable = sa.required.filter((r) => r.providers.length >= minProviders);
    add('service_availability', portable.length / sa.required.length,
      `${portable.length} of ${sa.required.length} required service(s) offered by ${minProviders} or more sovereign providers`, {
        sovereign_providers: sa.sovereign_providers,
        catalogue_source: sa.catalogue_source,
        min_sovereign_providers: minProviders,
        services: sa.required.map((r) => ({ capability: r.capability, providers: r.providers })),
      });
  }

  // vendor_lock
  const vc = inputs.vendor.check;
  if (vc === 'matched' || vc === 'no_match') {
    const penalty = inputs.vendor.hits.reduce((s, h) => s + (cfg.vendor_lock.impact_penalty[h.sovereign_impact] ?? 0), 0);
    add('vendor_lock', 1 - penalty,
      inputs.vendor.hits.length === 0 ? 'no proprietary SDK found' : `${inputs.vendor.hits.length} proprietary SDK(s) found`, {
        sdks: inputs.vendor.hits.map((h) => ({ id: h.id, sovereign_impact: h.sovereign_impact })),
      });
  } else {
    add('vendor_lock', null, vc ? `vendor SDK scan ${vc}` : 'vendor SDK scan not run');
  }

  // container
  const rt = inputs.runtime;
  if (!rt) {
    add('container', null, 'inventory (Pass 01) output not available');
  } else {
    const kind = rt.kubernetes ? 'kubernetes' : rt.container ? 'container' : 'none';
    add('container', cfg.container[kind],
      kind === 'kubernetes' ? 'Kubernetes or Helm deployment manifests' : kind === 'container' ? 'container image build or Compose file' : 'no container evidence',
      { runtime: kind, evidence: rt.evidence });
  }

  // iac
  const iac = inputs.iac;
  if (!iac) {
    add('iac', null, 'inventory and twelve-factor outputs not available');
  } else {
    add('iac', iac.present ? cfg.iac.present : cfg.iac.absent,
      iac.present ? 'infrastructure as code present' : 'no infrastructure as code found', { evidence: iac.evidence });
  }

  // egress
  const eg = inputs.egress;
  if (!eg) {
    add('egress', null, 'egress (Pass 07) output not available');
  } else if (eg.verdicts.length > 0) {
    const vv = cfg.egress.verdict_values;
    const sum = eg.verdicts.reduce((s, v) => s + (v.verdict in vv ? vv[v.verdict as keyof typeof vv] : 0), 0);
    add('egress', sum / eg.verdicts.length,
      `${eg.verdicts.length} egress service(s) with a sovereign service catalogue verdict`, {
        source: 'sovereign_services',
        verdicts: eg.verdicts,
      });
  } else if (eg.hardcoded_hosts.length > 0) {
    const hv = cfg.egress.hardcoded_host_values;
    const sum = eg.hardcoded_hosts.reduce((s, h) => s + (h.classification === 'public' ? hv.public : hv.private), 0);
    add('egress', sum / eg.hardcoded_hosts.length,
      `no egress verdict; ${eg.hardcoded_hosts.length} hard-coded endpoint host(s) in production code`, {
        source: 'hardcoded_endpoints',
        hosts: eg.hardcoded_hosts,
      });
  } else {
    add('egress', null, eg.destinations > 0
      ? `${eg.destinations} egress destination(s) without a sovereign service verdict`
      : 'no egress destination detected');
  }

  const used = comps.filter((c) => c.used);
  const totalWeight = PORTABILITY_COMPONENTS.reduce((s, id) => s + cfg.weights[id], 0);
  const usedWeight = used.reduce((s, c) => s + c.weight, 0);
  const score = usedWeight > 0 ? used.reduce((s, c) => s + c.weight * (c.value ?? 0), 0) / usedWeight : null;
  return {
    score: score === null ? null : round2(score),
    components: comps,
    components_used: used.map((c) => c.id),
    weight_coverage: totalWeight > 0 ? round2(usedWeight / totalWeight) : 0,
  };
}

// ---------------------------------------------------------------------------
// Reading one run's pass outputs
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function readPass(passesDir: string, file: string): { assessment: Rec; signals: Signal[] } | null {
  const path = join(passesDir, file);
  if (!existsSync(path)) return null;
  try {
    const parsed = load(readFileSync(path, 'utf-8')) as { assessment?: Rec; signals?: Signal[] } | null;
    return { assessment: parsed?.assessment ?? {}, signals: Array.isArray(parsed?.signals) ? parsed.signals : [] };
  } catch { return null; }
}

const asRec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Signals of every pass file of the run except 09-synth (sorted file order). */
function readRunSignals(passesDir: string): Signal[] {
  let files: string[];
  try { files = readdirSync(passesDir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('09-synth')).sort(); } catch { return []; }
  return files.flatMap((f) => readPass(passesDir, f)?.signals ?? []);
}

const STATE_IAC_RE = /^(Terraform\/OpenTofu|Pulumi) state declares /;

export interface ReadInputsOptions {
  /** Signals of the run (SYNTH signals are ignored). Default: every pass file except 09-synth. */
  signals?: Signal[];
  /** App directory (`<root>/apps/<id>`) for workspace landing-zone catalogue overrides. */
  workspaceAppDir?: string;
  /** Test hook: landing-zone catalogue directories. */
  lzDirs?: string[];
}

export function readMigrationScoreInputs(
  passesDir: string,
  cat: MigrationScoresCatalogue,
  opts: ReadInputsOptions = {},
): { factorScores: FactorScoreInput[] | null; portability: PortabilityInputs } {
  const inv = readPass(passesDir, '01-inv.yaml');
  const tf = readPass(passesDir, '06-tf.yaml');
  const egr = readPass(passesDir, '07-egr.yaml');

  const factorScores = tf
    ? asArr(tf.assessment['factor_scores'])
        .map(asRec)
        .filter((f): f is Rec => f !== null && typeof f['factor'] === 'string')
        .map((f) => ({ factor: f['factor'] as string, status: str(f['status']) ?? 'unknown' }))
    : null;

  // Required services: the landing-zone fit derivation (deriveConstraints over
  // the run's signals), so the score and the LZ section agree.
  const signals = (opts.signals ?? readRunSignals(passesDir))
    .filter((s) => typeof s?.id === 'string' && !s.id.startsWith('SYNTH-'));
  const required = [...new Set(deriveConstraints(signals).requiredServices.map((r) => r.name))].sort();
  const availability = loadSovereignAvailability(cat.portability.service_availability, {
    ...(opts.workspaceAppDir ? { workspaceAppDir: opts.workspaceAppDir } : {}),
    ...(opts.lzDirs ? { dirs: opts.lzDirs } : {}),
  });
  const serviceAvailability = availability
    ? {
        required: required.map((capability) => ({ capability, providers: sovereignProvidersFor(availability, capability) })),
        sovereign_providers: availability.sovereign_providers,
        catalogue_source: availability.source,
      }
    : null;

  const refChecks = inv ? asRec(inv.assessment['reference_catalogue_checks']) : null;
  const vendor = {
    check: str(refChecks?.['vendor_sdk']),
    hits: asArr(inv?.assessment['vendor_sdks'])
      .map(asRec)
      .filter((h): h is Rec => h !== null)
      .map((h) => ({ id: str(h['id']) ?? 'unknown', sovereign_impact: str(h['sovereign_impact']) ?? 'none' })),
  };

  const stacks = asArr(asRec(tf?.assessment['config_externalisation'])?.['stacks']).filter((s): s is string => typeof s === 'string');
  let runtime: PortabilityInputs['runtime'] = null;
  if (inv && typeof inv.assessment['runtime_type'] === 'string') {
    const a = inv.assessment;
    const evidence: string[] = [];
    if (a['k8s_manifests'] === true) evidence.push('k8s_manifests');
    if (stacks.includes('kubernetes')) evidence.push('stack:kubernetes');
    if (stacks.includes('helm')) evidence.push('stack:helm');
    const kubernetes = evidence.length > 0;
    if (a['dockerfile'] === true) evidence.push('dockerfile');
    if (a['docker_compose'] === true) evidence.push('docker_compose');
    if (stacks.includes('docker')) evidence.push('stack:docker');
    runtime = { kubernetes, container: evidence.length > 0, evidence };
  }

  let iac: PortabilityInputs['iac'] = null;
  if (inv || tf) {
    const evidence: string[] = [];
    const invSignals = inv?.signals ?? [];
    if (invSignals.some((s) => s.id === 'INV-06')) evidence.push('INV-06 (Terraform HCL)');
    for (const s of invSignals) {
      if (typeof s.derivation === 'string' && STATE_IAC_RE.test(s.derivation)) {
        evidence.push(`${s.id} (${s.derivation.startsWith('Pulumi') ? 'Pulumi' : 'Terraform'} state)`);
        break;
      }
    }
    const roots = tf?.assessment['iac_roots'];
    if (typeof roots === 'number' && roots > 0) evidence.push(`${roots} Terraform root(s)`);
    if ((tf?.signals ?? []).some((s) => typeof s.id === 'string' && s.id.startsWith('TF-IAC-'))) evidence.push('TF-IAC findings');
    if (stacks.includes('helm')) evidence.push('Helm chart');
    iac = { present: evidence.length > 0, evidence };
  }

  let egress: PortabilityInputs['egress'] = null;
  if (egr) {
    const a = egr.assessment;
    const verdicts = asArr(a['sovereign_services'])
      .map(asRec)
      .filter((s): s is Rec => s !== null && typeof s['portability_verdict'] === 'string')
      .map((s) => ({ service: str(s['service_id']) ?? str(s['name']) ?? 'unknown', verdict: s['portability_verdict'] as string }));
    const destinations = asArr(a['egress_destinations']).map(asRec).filter((d) => d !== null && d['note'] !== 'none_detected').length;
    const hosts = asArr(asRec(a['hardcoded_endpoints'])?.['hosts'])
      .map(asRec)
      .filter((h): h is Rec => h !== null && typeof h['host'] === 'string')
      // Test-only hosts do not move with the production workload.
      .filter((h) => (Number(h['production'] ?? 0) + Number(h['unclassified'] ?? 0)) > 0)
      .map((h) => ({ host: h['host'] as string, classification: str(h['classification']) ?? 'public' }));
    egress = { verdicts, destinations, hardcoded_hosts: hosts };
  }

  return { factorScores, portability: { serviceAvailability, vendor, runtime, iac, egress } };
}

/** Load the catalogue, read the run's pass outputs and compute both scores. Never throws. */
export function computeMigrationScores(
  passesDir: string,
  opts: ReadInputsOptions & { cataloguePath?: string } = {},
): MigrationScores {
  const cat = loadMigrationScoresCatalogue(opts.cataloguePath);
  if (!cat.ok) {
    return { catalogue: `skipped: ${cat.reason}`, cloud_native: null, cloud_native_skipped_reason: cat.reason, portability: null };
  }
  try {
    const inputs = readMigrationScoreInputs(passesDir, cat.data, opts);
    const cloudNative = inputs.factorScores ? computeCloudNativeScore(inputs.factorScores, cat.data) : null;
    return {
      catalogue: cat.data.version,
      cloud_native: cloudNative,
      ...(cloudNative ? {} : { cloud_native_skipped_reason: inputs.factorScores ? 'twelve-factor pass reported no factor' : 'twelve-factor (Pass 06) output not available' }),
      portability: computePortabilityScore(inputs.portability, cat.data),
    };
  } catch (err) {
    const reason = `error: ${(err as Error).message.split('\n')[0]}`;
    return { catalogue: reason, cloud_native: null, cloud_native_skipped_reason: reason, portability: null };
  }
}
