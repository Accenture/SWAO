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

// Structured auditor-report payload backing `swao report --view auditor
// --format yaml|json` (#0219). The Zod schema is the contract for any
// consumer that parses this output: CI gates, MCP tool responses, dbt
// sources, downstream ETL.
//
// Producer lives in this module too (buildAuditorReport) so the schema
// stays the source of truth -- producer output is validated against it
// before serialisation.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
// #0576: ReportData moved to @swao/core. Import direct (not via ./report.js)
// to avoid a latent cycle -- report.ts imports buildAuditorReport from here.
import type { ReportData } from '@swao/core';

export const SIGNAL_OUTCOMES = ['positive', 'negative', 'neutral', 'indeterminate'] as const;
export const SIGNAL_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;

const SignalDrilldownSchema = z.object({
  signal_id: z.string(),
  severity: z.string().optional(),
  outcome: z.string().optional(),
  derivation: z.string(),
  false_positive_considered: z.boolean().optional(),
  false_positive_ruled_out: z.string().optional(),
  assessor: z.string().optional(),
  assessed_at: z.string().optional(),
  evidence: z.array(z.string()),
  pass: z.string(),
});

const ControlGapSchema = z.object({
  control_id: z.string(),
  severity: z.string().optional(),
  rationale: z.string().optional(),
  remediation: z.string().optional(),
});

const RegimeSummarySchema = z.object({
  regime_id: z.string(),
  controls_total: z.number().int().nonnegative(),
  satisfied: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  gap: z.number().int().nonnegative(),
  gap_details: z.array(ControlGapSchema),
});

export const AuditorReportSchema = z.object({
  schema_version: z.literal('1.0'),
  // #0228: engagement metadata, mirrors the dim_app columns in the BI
  // bundle. Optional fields so reports against fixtures predating the
  // engagement block still validate.
  engagement: z.object({
    name:             z.string().optional(),
    client_code:      z.string().optional(),
    partnership_lead: z.string().optional(),
    start_date:       z.string().optional(),
  }).optional(),
  workload: z.object({
    app_id: z.string(),
    seven_r_label: z.string(),
    coverage_score: z.string(),
    landing_zone: z.string().optional(),
    assessed_at: z.string(),
    iter: z.number().int().positive(),
  }),
  signals: z.object({
    total: z.number().int().nonnegative(),
    by_outcome: z.record(z.string(), z.number().int().nonnegative()),
    by_severity: z.record(z.string(), z.number().int().nonnegative()),
    top_negative_high_severity: z.array(SignalDrilldownSchema),
  }),
  compliance: z.object({
    regimes: z.array(RegimeSummarySchema),
  }),
  traceability: z.object({
    signal_outcome_coverage: z.number().min(0).max(1),
    signal_rationale_coverage: z.number().min(0).max(1),
    fp_consideration_rate: z.number().min(0).max(1),
    chain_coverage: z.number().min(0).max(1),
    control_outcome_coverage: z.number().min(0).max(1),
    control_rationale_coverage: z.number().min(0).max(1),
  }),
  run: z.object({
    run_id: z.string().optional(),
    duration_minutes: z.number().nonnegative().optional(),
    llm: z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
      total_cost_usd: z.number().nonnegative().optional(),
      total_tokens_in: z.number().int().nonnegative().optional(),
      total_tokens_out: z.number().int().nonnegative().optional(),
      call_count: z.number().int().nonnegative().optional(),
    }).optional(),
  }),
});

export type AuditorReport = z.infer<typeof AuditorReportSchema>;

interface RawSignal {
  id?: string;
  severity?: string;
  outcome?: string;
  derivation?: string;
  evidence?: unknown;
  derivation_chain?: unknown;
  false_positive_considered?: boolean;
  false_positive_ruled_out?: string;
  assessor?: string;
  assessed_at?: string;
}

interface RawControl {
  id?: string;
  outcome?: string;
  status?: string;
  severity?: string;
  rationale?: string;
  remediation?: string;
}

interface RawRegime {
  id?: string;
  name?: string;
  controls?: RawControl[];
}

interface RawPlan {
  compliance?: { regimes?: RawRegime[] };
}

interface RawManifest {
  run_id?: string;
  duration_ms?: number;
  llm?: {
    provider?: string;
    model?: string;
    total_cost_usd?: number;
    total_tokens_in?: number;
    total_tokens_out?: number;
    call_count?: number;
  };
}

function loadYamlFile(p: string): unknown {
  try { return load(readFileSync(p, 'utf-8')); } catch { return null; }
}

function loadJsonFile(p: string): unknown {
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function resolvePassesAndManifest(wspDir: string): { passesDir: string; runManifestPath: string } {
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim();
      const runDir = join(wspDir, rel);
      if (existsSync(runDir)) {
        return { passesDir: join(runDir, 'passes'), runManifestPath: join(runDir, 'run-manifest.json') };
      }
    } catch { /* fall through */ }
  }
  return { passesDir: join(wspDir, 'passes'), runManifestPath: join(wspDir, 'run-manifest.json') };
}

function resolvePlanPath(wspDir: string): string {
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim();
      const runPlan = join(wspDir, rel, 'wsp-plan.yaml');
      if (existsSync(runPlan)) return runPlan;
    } catch { /* fall through */ }
  }
  return join(wspDir, 'wsp-plan.yaml');
}

function loadRawSignals(passesDir: string): Array<RawSignal & { pass: string }> {
  if (!existsSync(passesDir)) return [];
  const out: Array<RawSignal & { pass: string }> = [];
  for (const file of readdirSync(passesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).sort()) {
    const parsed = loadYamlFile(join(passesDir, file)) as { signals?: RawSignal[] } | null;
    if (!parsed?.signals) continue;
    for (const s of parsed.signals) {
      if (s.id) out.push({ ...s, pass: file });
    }
  }
  return out;
}

function loadRawRegimes(planPath: string): RawRegime[] {
  if (!existsSync(planPath)) return [];
  const parsed = loadYamlFile(planPath) as RawPlan | null;
  return parsed?.compliance?.regimes ?? [];
}

function classifyControl(c: RawControl): 'satisfied' | 'partial' | 'gap' | 'unset' {
  const o = (c.outcome ?? c.status ?? '').toLowerCase();
  if (o === 'satisfied' || o === 'pass' || o === 'ok')            return 'satisfied';
  if (o === 'partial'   || o === 'partial_compliance')             return 'partial';
  if (o === 'gap'       || o === 'fail' || o === 'not_implemented') return 'gap';
  return 'unset';
}

function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

/**
 * Build the structured AuditorReport payload from a workspace. Validates
 * against the Zod schema before returning so producer drift is caught
 * here rather than downstream.
 */
export function buildAuditorReport(data: ReportData, wspDir: string): AuditorReport {
  const { passesDir, runManifestPath } = resolvePassesAndManifest(wspDir);
  const planPath = resolvePlanPath(wspDir);

  const signals = loadRawSignals(passesDir);
  const regimes = loadRawRegimes(planPath);
  const manifest = loadJsonFile(runManifestPath) as RawManifest | null;

  const byOutcome: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const s of signals) {
    const o = s.outcome ?? 'unset';
    const sev = s.severity ?? 'unset';
    byOutcome[o]   = (byOutcome[o]   ?? 0) + 1;
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }

  const drilldownSignals = signals
    .filter(s => s.outcome === 'negative' && (s.severity === 'critical' || s.severity === 'high' || s.severity === 'medium'))
    .slice(0, 25)
    .map(s => ({
      signal_id: s.id ?? '',
      severity: s.severity,
      outcome: s.outcome,
      derivation: s.derivation ?? '',
      false_positive_considered: s.false_positive_considered,
      false_positive_ruled_out: s.false_positive_ruled_out,
      assessor: s.assessor,
      assessed_at: s.assessed_at,
      evidence: Array.isArray(s.evidence) ? (s.evidence as string[]) : [],
      pass: s.pass,
    }));

  const regimeSummaries = regimes.map(r => {
    const controls = r.controls ?? [];
    let satisfied = 0, partial = 0, gap = 0;
    const gapDetails: Array<z.infer<typeof ControlGapSchema>> = [];
    for (const c of controls) {
      const klass = classifyControl(c);
      if      (klass === 'satisfied') satisfied++;
      else if (klass === 'partial')   partial++;
      else if (klass === 'gap')       gap++;
      if (klass === 'gap' || klass === 'partial') {
        gapDetails.push({
          control_id: c.id ?? '?',
          severity: c.severity,
          rationale: c.rationale,
          remediation: c.remediation,
        });
      }
    }
    return {
      regime_id: r.id ?? r.name ?? '?',
      controls_total: controls.length,
      satisfied,
      partial,
      gap,
      gap_details: gapDetails,
    };
  });

  const total = signals.length;
  const sigWithOutcome   = signals.filter(s => !!s.outcome).length;
  const sigWithRationale = signals.filter(s => (s.derivation ?? '').length >= 20).length;
  const sigWithChain     = signals.filter(s => Array.isArray(s.derivation_chain) && (s.derivation_chain as unknown[]).length >= 1).length;
  const sigNeedFp        = signals.filter(s => s.outcome === 'negative' && ['medium', 'high', 'critical'].includes(s.severity ?? ''));
  const sigWithFp        = sigNeedFp.filter(s => s.false_positive_considered === true && (s.false_positive_ruled_out ?? '').length >= 20);
  const allControls      = regimes.flatMap(r => r.controls ?? []);
  const ctlWithOutcome   = allControls.filter(c => !!(c.outcome ?? c.status)).length;
  const ctlWithRationale = allControls.filter(c => (c.rationale ?? '').length >= 20).length;

  const payload: AuditorReport = {
    schema_version: '1.0',
    ...(data.engagement
      ? { engagement: {
          name:             data.engagement.name,
          client_code:      data.engagement.client_code,
          partnership_lead: data.engagement.partnership_lead,
          start_date:       data.engagement.start_date,
        } }
      : {}),
    workload: {
      app_id: data.appId,
      seven_r_label: data.sevenRLabel,
      coverage_score: data.coverageScore,
      landing_zone: data.landingZone || undefined,
      assessed_at: data.assessedAt,
      iter: data.iter,
    },
    signals: {
      total,
      by_outcome: byOutcome,
      by_severity: bySeverity,
      top_negative_high_severity: drilldownSignals,
    },
    compliance: {
      regimes: regimeSummaries,
    },
    traceability: {
      signal_outcome_coverage:   safeDiv(sigWithOutcome,   total),
      signal_rationale_coverage: safeDiv(sigWithRationale, total),
      fp_consideration_rate:     safeDiv(sigWithFp.length, sigNeedFp.length),
      chain_coverage:            safeDiv(sigWithChain,     total),
      control_outcome_coverage:   safeDiv(ctlWithOutcome,   allControls.length),
      control_rationale_coverage: safeDiv(ctlWithRationale, allControls.length),
    },
    run: {
      run_id: manifest?.run_id,
      duration_minutes: manifest?.duration_ms !== undefined
        ? Math.round((manifest.duration_ms / 60_000) * 100) / 100
        : undefined,
      llm: manifest?.llm
        ? {
            provider:         manifest.llm.provider,
            model:            manifest.llm.model,
            total_cost_usd:   manifest.llm.total_cost_usd,
            total_tokens_in:  manifest.llm.total_tokens_in,
            total_tokens_out: manifest.llm.total_tokens_out,
            call_count:       manifest.llm.call_count,
          }
        : undefined,
    },
  };

  return AuditorReportSchema.parse(payload);
}
