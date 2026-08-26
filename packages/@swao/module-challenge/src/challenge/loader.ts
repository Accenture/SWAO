// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import type { WspSummary, WspSignal, WspBlocker, LzCandidate, LzWspSummary, LzAssessedTarget, LzFitItemSummary } from './types.js';

function loadYaml(p: string): unknown {
  try {
    return load(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Resolve the best data sources for wsp.yaml, wsp-plan.yaml, and passes/.
 * Assessment artefacts live under wsp/runs/<ts>/ (new layout) but some
 * fixtures still carry them at the flat wsp/ level (legacy layout).
 * Priority: latest-application.txt > latest.txt > flat wsp/ fallback.
 */
function resolveDataPaths(wspDir: string): { wspYaml: string; wspPlan: string; passesDir: string; runDir: string | null } {
  let runDir: string | null = null;
  for (const ptr of ['latest-application.txt', 'latest.txt']) {
    const ptrPath = join(wspDir, ptr);
    if (!existsSync(ptrPath)) continue;
    try {
      const rel = readFileSync(ptrPath, 'utf-8').trim();
      if (rel) runDir = join(wspDir, rel);
    } catch { /* ignore */ }
    if (runDir) break;
  }

  const candidate = runDir ?? wspDir;
  return {
    wspYaml:  existsSync(join(candidate, 'wsp.yaml'))    ? join(candidate, 'wsp.yaml')    : join(wspDir, 'wsp.yaml'),
    wspPlan:  existsSync(join(candidate, 'wsp-plan.yaml')) ? join(candidate, 'wsp-plan.yaml') : join(wspDir, 'wsp-plan.yaml'),
    passesDir: existsSync(join(candidate, 'passes'))      ? join(candidate, 'passes')      : join(wspDir, 'passes'),
    runDir,
  };
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];

function severityRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i >= 0 ? i : 99;
}

export function buildWspSummary(appDir: string, focusPrefixes?: string[]): WspSummary {
  const wspDir = join(appDir, 'wsp');
  const { wspYaml, wspPlan, passesDir, runDir } = resolveDataPaths(wspDir);

  const spine = loadYaml(wspYaml) as Record<string, unknown> | null;
  const plan = loadYaml(wspPlan) as Record<string, unknown> | null;

  const spineOverall = (spine?.overall ?? {}) as Record<string, unknown>;
  const spineLz = (spine?.landing_zone ?? {}) as Record<string, unknown>;

  // Extract assessment timestamp -- try both wsp.yaml schema variants
  const spineMeta = (spine?.meta as Record<string, unknown> | undefined) ?? {};
  const assessedAt = spineMeta.assessed_at
    ? String(spineMeta.assessed_at)
    : spine?.assessed_at
      ? String(spine.assessed_at)
      : undefined;

  const sevenRLabel = spineOverall.seven_r_label
    ? String(spineOverall.seven_r_label)
    : (plan?.migration_plan as Record<string, unknown> | undefined)?.strategy
      ? String((plan?.migration_plan as Record<string, unknown>).strategy)
      : 'pending';

  const rawScore = spineOverall.coverage_score !== undefined ? Number(spineOverall.coverage_score) : 0;
  const coverageScore = isNaN(rawScore) ? 0 : rawScore;

  const landingZone = spineLz.primary ? String(spineLz.primary) : '';

  // Landing zone candidates from wsp-plan.yaml
  const landingZoneCandidates: LzCandidate[] = [];
  const planLzRaw = (plan?.landing_zone_candidates ?? []) as Array<Record<string, unknown>>;
  for (const c of planLzRaw) {
    landingZoneCandidates.push({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      fitScore: Number(c.fit_score ?? 0),
      lockInFlags: Array.isArray(c.lock_in_flags) ? c.lock_in_flags.map(String) : [],
    });
  }

  // Aggregate signals from all pass files
  const allSignals: WspSignal[] = [];
  if (existsSync(passesDir)) {
    const files = readdirSync(passesDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    for (const file of files) {
      const parsed = loadYaml(join(passesDir, file)) as {
        signals?: Array<{
          id?: string;
          severity?: string;
          derivation?: string;
          evidence?: unknown;
          confidence?: number;
          synthesis?: boolean;
        }>;
      } | null;

      if (!parsed?.signals) continue;

      for (const s of parsed.signals) {
        if (!s.id) continue;
        const prefix = s.id.split('-')[0];
        if (focusPrefixes && focusPrefixes.length > 0) {
          if (!focusPrefixes.map(p => p.toUpperCase()).includes(prefix.toUpperCase())) continue;
        }
        const derivation = s.derivation ?? '';
        allSignals.push({
          id: s.id,
          prefix,
          severity: s.severity ?? 'informational',
          description: derivation.trim(),
          confidence: typeof s.confidence === 'number' ? s.confidence : 1.0,
          evidence: Array.isArray(s.evidence) ? s.evidence.map(String) : undefined,
        });
      }
    }
  }

  allSignals.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  // Blockers: critical signals + high EGR/SBOM
  const blockers: WspBlocker[] = allSignals
    .filter(s => {
      return (
        s.severity === 'critical' ||
        (s.severity === 'high' && (s.prefix === 'EGR' || s.prefix === 'SBOM'))
      );
    })
    .map(s => ({ id: s.id, description: s.description }));

  // Compliance verdicts from wsp-plan.yaml compliance block
  const complianceVerdicts: Record<string, string> = {};
  const planCompliance = (plan?.compliance as Record<string, unknown> | undefined);
  if (planCompliance) {
    const regimes = (planCompliance.regimes ?? []) as Array<Record<string, unknown>>;
    for (const r of regimes) {
      if (r.id && r.status) {
        complianceVerdicts[String(r.id)] = String(r.status);
      }
    }
  }

  // Recommended next steps from SYNTH pass
  const recommendedNextSteps: string[] = [];
  if (existsSync(passesDir)) {
    const synthFile = join(passesDir, '09-synth.yaml');
    if (existsSync(synthFile)) {
      const parsed = loadYaml(synthFile) as { assessment?: Record<string, unknown> } | null;
      const steps = parsed?.assessment?.recommended_next_steps;
      if (Array.isArray(steps)) {
        for (const s of steps) recommendedNextSteps.push(String(s));
      }
    }
  }

  // Optionally inject LZ catalog assessment results (#1360).
  // Priority 1: standalone LZ catalog run via latest-landing-zone-catalog.txt (lz-fit-*.yaml in passes/).
  // Priority 2: inline fits from the latest app run (lz-catalogue-fit-*.yaml at the run root).
  const lzCatalogFit: import('./types.js').LzAssessedTarget[] = [];
  try {
    const lzPtrPath = join(wspDir, 'latest-landing-zone-catalog.txt');
    if (existsSync(lzPtrPath)) {
      const rel = readFileSync(lzPtrPath, 'utf-8').trim();
      const lzRunDir = rel ? join(wspDir, rel) : null;
      const lzPassesDir = lzRunDir ? join(lzRunDir, 'passes') : join(wspDir, 'passes');
      if (existsSync(lzPassesDir)) {
        const lzFiles = readdirSync(lzPassesDir)
          .filter(f => f.startsWith('lz-fit-') && (f.endsWith('.yaml') || f.endsWith('.yml')))
          .sort();
        for (const lzFile of lzFiles) {
          const parsed = loadYaml(join(lzPassesDir, lzFile)) as Record<string, unknown> | null;
          if (!parsed) continue;
          const assessment = parsed['assessment'] as Record<string, unknown> | undefined;
          if (!assessment) continue;
          const provider = String(assessment['provider'] ?? '');
          const region = String(assessment['region'] ?? '');
          const overall = String(assessment['overall'] ?? '');
          const sovereignty_statement = String(assessment['sovereignty_statement'] ?? '');
          const rawItems = ((assessment['items'] ?? []) as Array<Record<string, unknown>>)
            .filter(i => String(i['verdict'] ?? '') !== 'SUPPORTED')
            .map(i => ({
              service_code: String(i['service_code'] ?? i['label'] ?? ''),
              verdict: String(i['verdict'] ?? ''),
              detail: String(i['detail'] ?? ''),
            }));
          if (provider && region) {
            lzCatalogFit.push({ provider, region, overall, sovereignty_statement, items: rawItems });
          }
        }
      }
    } else if (runDir && existsSync(runDir)) {
      // Inline fits: written to the app run root by the LZ catalogue fit step.
      // Format is flat (provider/region/overall/sovereignty_statement/items at top level),
      // unlike standalone lz-fit-*.yaml which wraps everything under `assessment`.
      const fitFiles = readdirSync(runDir)
        .filter(f => f.startsWith('lz-catalogue-fit-') && (f.endsWith('.yaml') || f.endsWith('.yml')))
        .sort();
      for (const fitFile of fitFiles) {
        const parsed = loadYaml(join(runDir, fitFile)) as Record<string, unknown> | null;
        if (!parsed) continue;
        const provider = String(parsed['provider'] ?? '');
        const region = String(parsed['region'] ?? '');
        const overall = String(parsed['overall'] ?? '');
        const sovereignty_statement = String(parsed['sovereignty_statement'] ?? '');
        const rawItems = ((parsed['items'] ?? []) as Array<Record<string, unknown>>)
          .filter(i => String(i['verdict'] ?? '') !== 'SUPPORTED')
          .map(i => ({
            service_code: String(i['service_code'] ?? i['label'] ?? ''),
            verdict: String(i['verdict'] ?? ''),
            detail: String(i['detail'] ?? ''),
          }));
        if (provider && region) {
          lzCatalogFit.push({ provider, region, overall, sovereignty_statement, items: rawItems });
        }
      }
    }
  } catch { /* LZ data is optional -- ignore all errors */ }

  return {
    appId: spine ? String((spine.meta as Record<string, unknown> | undefined)?.app_id ?? '') || extractAppId(appDir) : extractAppId(appDir),
    sevenRLabel,
    coverageScore,
    landingZone,
    assessedAt,
    signals: allSignals,
    blockers,
    complianceVerdicts,
    recommendedNextSteps,
    landingZoneCandidates: landingZoneCandidates.length > 0 ? landingZoneCandidates : undefined,
    lzCatalogFit: lzCatalogFit.length > 0 ? lzCatalogFit : undefined,
  };
}

function extractAppId(appDir: string): string {
  return appDir.split(/[\\/]/).pop() ?? 'unknown';
}

/**
 * Build the LZ context summary for the LZ Sovereignty Challenge (#1109).
 * Reads the latest LZ Catalog Assessment run via latest-landing-zone-catalog.txt,
 * then parses all lz-fit-*.yaml pass files from that run's passes/ directory.
 * Strictly separate from buildWspSummary -- no shared state or pointer files.
 */
export function buildLzWspSummary(appDir: string): LzWspSummary {
  const wspDir = join(appDir, 'wsp');
  const appId = extractAppId(appDir);

  // Resolve the latest LZ run via the type-specific pointer (#0909).
  let runDir: string | null = null;
  const ptrPath = join(wspDir, 'latest-landing-zone-catalog.txt');
  if (existsSync(ptrPath)) {
    try {
      const rel = readFileSync(ptrPath, 'utf-8').trim();
      if (rel) runDir = join(wspDir, rel);
    } catch { /* ignore */ }
  }
  const passesDir = runDir ? join(runDir, 'passes') : join(wspDir, 'passes');

  const targets: LzAssessedTarget[] = [];
  let frameworks: string[] = [];
  let assessedAt: string | undefined;
  let catalogueOnly = false;

  if (existsSync(passesDir)) {
    const files = readdirSync(passesDir)
      .filter(f => f.startsWith('lz-fit-') && (f.endsWith('.yaml') || f.endsWith('.yml')))
      .sort();

    for (const file of files) {
      const parsed = loadYaml(join(passesDir, file)) as Record<string, unknown> | null;
      if (!parsed) continue;

      const assessment = parsed['assessment'] as Record<string, unknown> | undefined;
      if (!assessment) continue;

      if (!assessedAt && typeof assessment['generated_at'] === 'string') {
        assessedAt = assessment['generated_at'];
      }

      const sovStmt = typeof assessment['sovereignty_statement'] === 'string'
        ? assessment['sovereignty_statement']
        : '';

      // Extract framework names from the sovereignty statement ("derived from X, Y").
      if (frameworks.length === 0 && sovStmt) {
        const match = /derived from ([^.]+)/.exec(sovStmt);
        if (match) {
          frameworks = match[1]!.split(/,\s*/).map(s => s.trim()).filter(Boolean);
        }
      }

      // Detect catalogue-only mode: signals array is empty AND sovereignty statement
      // mentions no-snapshot or the pass file has no items.
      const items = Array.isArray(assessment['items']) ? assessment['items'] as Array<Record<string, unknown>> : [];
      if (!catalogueOnly && items.length === 0) {
        // Catalogue-only when items is empty (no requiredServices from app assessment).
        catalogueOnly = true;
      }

      const fitItems: LzFitItemSummary[] = items.map(i => ({
        service_code: String(i['service_code'] ?? ''),
        verdict: String(i['verdict'] ?? ''),
        detail: String(i['detail'] ?? ''),
      }));

      targets.push({
        provider: String(assessment['provider'] ?? 'unknown'),
        region: String(assessment['region'] ?? 'unknown'),
        overall: String(assessment['overall'] ?? 'UNKNOWN'),
        sovereignty_statement: sovStmt,
        items: fitItems,
      });
    }
  }

  return {
    appId,
    assessedAt,
    frameworks,
    catalogueOnly,
    targets,
  };
}
