// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Portfolio analytics over all service apps (Design 103 §21.3-§21.5, #3111-#3113):
 * integration graph + blast radius, migration waves, vendor consolidation.
 * Formulas follow Design 103 §21 (authoritative over the issue text).
 */

import type { TimeQuadrant } from '@swao/core';
import type { InfraCatalogue } from '../catalog/infra-cat.js';

export type EolSignal = 'BLOCKED' | 'AMBER' | 'GREEN';

/** Design 103 §6.2.2: past end of life = BLOCKED, within 18 months = AMBER, later = GREEN. */
export function eolSignal(eol: { is_eol?: unknown; months_until_eol?: unknown } | null | undefined): EolSignal | null {
  if (!eol) return null;
  if (eol.is_eol === true) return 'BLOCKED';
  const m = eol.months_until_eol;
  if (typeof m !== 'number') return eol.is_eol === false ? 'GREEN' : null;
  if (m <= 0) return 'BLOCKED';
  return m <= 18 ? 'AMBER' : 'GREEN';
}

// ---------------------------------------------------------------- §21.4 integration graph

export interface GraphInput { id: string; integrations: readonly string[]; clusterMembers?: readonly string[] | null }

export interface IntegrationGraph {
  generated_at: string;
  /** source app -> apps it depends on (portfolio members only, cluster members mapped to the cluster). */
  edges: Record<string, string[]>;
  fan_in: Record<string, number>;
  /** References to IDs that are not in the portfolio, kept for analyst review. */
  dangling: Array<{ from: string; to: string }>;
}

export function buildIntegrationGraph(apps: readonly GraphInput[], now: Date): IntegrationGraph {
  const alias = new Map<string, string>();
  for (const a of apps) {
    alias.set(a.id, a.id);
    for (const m of a.clusterMembers ?? []) alias.set(m, a.id);
  }
  const edges: Record<string, string[]> = {};
  const fanIn: Record<string, number> = Object.fromEntries(apps.map((a) => [a.id, 0]));
  const dangling: Array<{ from: string; to: string }> = [];
  for (const a of apps) {
    const targets = new Set<string>();
    for (const raw of a.integrations) {
      const to = alias.get(raw.toLowerCase());
      if (!to) { dangling.push({ from: a.id, to: raw }); continue; }
      if (to !== a.id) targets.add(to);
    }
    edges[a.id] = [...targets].sort();
    for (const t of targets) fanIn[t] = (fanIn[t] ?? 0) + 1;
  }
  return { generated_at: now.toISOString(), edges, fan_in: fanIn, dangling };
}

const TIME_WEIGHT: Record<TimeQuadrant, number> = { Eliminate: 0, Migrate: 5, 'Migrate-Critical': 5, Invest: 3, Tolerate: 1 };
const EOL_BONUS: Record<EolSignal, number> = { BLOCKED: 20, AMBER: 10, GREEN: 0 };

/** Design 103 §21.4: fan_in * 10 + time weight (E0 M5 I3 T1) + EoL bonus (BLOCKED 20, AMBER 10). */
export function blastRadius(fanIn: number, time: TimeQuadrant, eol: EolSignal | null): { score: number; tier: 'LOW' | 'MEDIUM' | 'HIGH' } {
  const score = fanIn * 10 + TIME_WEIGHT[time] + (eol ? EOL_BONUS[eol] : 0);
  return { score, tier: score >= 30 ? 'HIGH' : score >= 10 ? 'MEDIUM' : 'LOW' };
}

// ---------------------------------------------------------------- §21.3 migration waves

export interface WaveInput {
  id: string;
  time: TimeQuadrant;
  eolSignal: EolSignal | null;
  healthData: boolean;
  gdprArt9: boolean;
  fanIn: number;
  blastScore: number;
  infraCategory: string | null;
  isCluster: boolean;
  mdr: boolean;
}

export const WAVE_LABELS: Record<number, { label: string; horizon: string }> = {
  1: { label: 'Eliminate', horizon: 'Now' },
  2: { label: 'Migrate: Critical', horizon: 'Next 3 months' },
  3: { label: 'Migrate: Standard', horizon: '3-12 months' },
  4: { label: 'Invest', horizon: '12-24 months' },
  5: { label: 'Tolerate', horizon: 'Monitor' },
};

export function waveOf(a: WaveInput): 1 | 2 | 3 | 4 | 5 {
  switch (a.time) {
    case 'Eliminate': return 1;
    case 'Migrate-Critical': return 2;
    case 'Migrate': return a.eolSignal === 'BLOCKED' || a.healthData || a.gdprArt9 ? 2 : 3;
    case 'Invest': return 4;
    case 'Tolerate': return 5;
  }
}

/** Design 103 §21.3 effort model (rough order of magnitude, days per app). */
export function effortDays(a: Pick<WaveInput, 'infraCategory' | 'isCluster' | 'mdr'>): number {
  if (a.infraCategory === 'INFRA_WORKPLACE_VDI' && a.isCluster) return 2;
  if (a.infraCategory?.startsWith('INFRA_MEDIZIN') && a.mdr) return 15;
  if (a.infraCategory?.startsWith('INFRA_PLATFORM')) return 5;
  return 3;
}

export interface WavePlan {
  waves: Array<{ wave: number; label: string; horizon: string; apps: string[]; effort_days: number }>;
  byApp: Record<string, { wave: number; effort_days: number }>;
  /** HIGH blast-radius apps scheduled before apps that depend on them (cross-wave conflict). */
  warnings: string[];
}

export function planWaves(apps: readonly WaveInput[], graph: IntegrationGraph): WavePlan {
  const byApp: WavePlan['byApp'] = {};
  const groups = new Map<number, WaveInput[]>();
  for (const a of apps) {
    const w = waveOf(a);
    byApp[a.id] = { wave: w, effort_days: w === 5 ? 0 : effortDays(a) };
    groups.set(w, [...(groups.get(w) ?? []), a]);
  }
  const waves = [1, 2, 3, 4, 5].map((w) => {
    const members = [...(groups.get(w) ?? [])].sort((x, y) =>
      w === 1 ? x.blastScore - y.blastScore || x.id.localeCompare(y.id) : x.fanIn - y.fanIn || x.id.localeCompare(y.id));
    return { wave: w, ...WAVE_LABELS[w]!, apps: members.map((m) => m.id), effort_days: members.reduce((s, m) => s + byApp[m.id]!.effort_days, 0) };
  });
  const warnings: string[] = [];
  const blast = new Map(apps.map((a) => [a.id, a]));
  for (const [source, targets] of Object.entries(graph.edges)) {
    for (const target of targets) {
      const t = blast.get(target);
      const s = byApp[source];
      if (!t || !s) continue;
      if (byApp[target]!.wave === 1) {
        warnings.push(`${target} is eliminated in wave 1 but ${source} depends on it; reconfigure ${source} before decommissioning`);
      } else if (t.blastScore >= 30 && byApp[target]!.wave < s.wave) {
        warnings.push(`${target} (HIGH blast radius, wave ${byApp[target]!.wave}) is scheduled before its dependent ${source} (wave ${s.wave}); confirm the dependent is ready first`);
      }
    }
  }
  return { waves, byApp, warnings };
}

export interface WaveReportApp {
  id: string;
  name: string | null;
  eol_date: string | null;
  time_quadrant: string;
  fan_in?: number;
  /** #3290: `not_assessed` marks an app without a service assessment run. */
  evidence?: string | null;
  assessed?: boolean | null;
  /** #3280: `application` or `service`; absent means service. */
  assessment_type?: string | null;
}

/** #3290 (Design 110 D-24): the mark rank and wave views show for an app without a service assessment run. */
export const NOT_ASSESSED_MARK = 'not assessed';

export function renderWaveReport(plan: WavePlan, apps: ReadonlyArray<WaveReportApp>, date: string): { md: string; csv: string } {
  const info = new Map(apps.map((a) => [a.id, a]));
  const notAssessed = (a: WaveReportApp | undefined) => a !== undefined && (a.evidence === 'not_assessed' || a.assessed === false);
  const unassessed = apps.filter((a) => notAssessed(a)).length;
  // #3280 (Design 103 §22): a combined plan gets a type column (last, in both files); a service-only plan is unchanged.
  const combined = apps.some((a) => a.assessment_type === 'application');
  const typeOf = (a: WaveReportApp | undefined) => (a?.assessment_type === 'application' ? 'application' : 'service');
  const lines = [
    '# Migration Wave Plan', '', `Generated: ${date}. Effort figures are a rough order of magnitude, not a project plan.`, '',
    // #3290: say which wave members rest on intake and research only.
    ...(unassessed > 0
      ? [combined
        ? `${unassessed} app(s) are marked "${NOT_ASSESSED_MARK}": they have no assessment run of their type, so their wave rests on intake, research or configuration data only.`
        : `${unassessed} app(s) are marked "${NOT_ASSESSED_MARK}": they have no service assessment run, so their wave rests on intake and research data only.`, '']
      : []),
    '| Wave | Apps | Horizon | Est. effort (days) |', '|---|---|---|---|',
    ...plan.waves.map((w) => `| ${w.wave}: ${w.label} | ${w.apps.length} | ${w.horizon} | ${w.effort_days} |`), '',
  ];
  for (const w of plan.waves.filter((x) => x.apps.length > 0)) {
    lines.push(`## Wave ${w.wave}: ${w.label} (${w.horizon})`, '',
      `| Order | App | Name | TIME | EoL | Dependents | Assessment |${combined ? ' Type |' : ''}`, `|---|---|---|---|---|---|---|${combined ? '---|' : ''}`);
    w.apps.forEach((id, i) => {
      const a = info.get(id);
      lines.push(`| ${i + 1} | ${id} | ${a?.name ?? '-'} | ${a?.time_quadrant ?? '-'} | ${a?.eol_date ?? '-'} | ${a?.fan_in ?? 0} | ${notAssessed(a) ? NOT_ASSESSED_MARK : a?.assessed === true ? 'assessed' : '-'} |${combined ? ` ${typeOf(a)} |` : ''}`);
    });
    lines.push('');
  }
  if (plan.warnings.length > 0) lines.push('## Dependency warnings', '', ...plan.warnings.map((w) => `- ${w}`), '');
  // #3290: `evidence` is the last column so the existing column positions stay.
  const csv = [`app,wave,wave_label,order,effort_days,dependents,evidence${combined ? ',assessment_type' : ''}`, ...plan.waves.flatMap((w) => w.apps.map((id, i) => {
    const a = info.get(id);
    return `${id},${w.wave},${w.label},${i + 1},${plan.byApp[id]!.effort_days},${a?.fan_in ?? 0},${notAssessed(a) ? 'not_assessed' : a?.evidence ?? ''}${combined ? `,${typeOf(a)}` : ''}`;
  }))].join('\n');
  return { md: `${lines.join('\n')}\n`, csv: `${csv}\n` };
}

// ---------------------------------------------------------------- §21.5 vendor consolidation

export interface VendorInput { id: string; vendorName: string | null; infraCategory: string | null; time: TimeQuadrant; eolSignal: EolSignal | null }

export interface VendorGroup {
  vendor: string;
  matched: boolean;
  app_count: number;
  apps: string[];
  categories: string[];
  time_summary: Record<string, number>;
  opportunity_score: number;
  opportunity_tier: 'LOW' | 'MEDIUM' | 'HIGH';
}

const TIME_LETTER: Record<TimeQuadrant, string> = { Tolerate: 'T', Invest: 'I', Migrate: 'M', 'Migrate-Critical': 'M', Eliminate: 'E' };
const LEGAL_SUFFIX = /\b(gmbh|ag|se|kg|inc|ltd|llc|plc|corp|corporation|co|b\.?v|n\.?v|s\.?a)\b\.?/gi;

/**
 * Canonical vendor: the matching INFRA-CAT entry's `vendor_canonical_name`, else the
 * matched `vendor_patterns` string (§21.5). Extension beyond §21.5: an unmatched but
 * real vendor name is normalised (legal suffixes dropped) and grouped with
 * `matched: false`. Blank and redacted vendors are never grouped.
 */
export function canonicalVendor(name: string | null, catalogue: InfraCatalogue): { vendor: string; matched: boolean } | null {
  if (!name || !name.trim() || name === '[contact-name-redacted]') return null;
  const lower = name.toLowerCase();
  for (const svc of catalogue.services) {
    const p = (svc.vendor_patterns ?? []).find((v) => lower.includes(v.toLowerCase()));
    if (p) return { vendor: (svc as { vendor_canonical_name?: string }).vendor_canonical_name ?? p, matched: true };
  }
  const normalised = name.replace(LEGAL_SUFFIX, ' ').replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalised ? { vendor: normalised, matched: false } : null;
}

export function vendorConsolidation(apps: readonly VendorInput[], catalogue: InfraCatalogue): VendorGroup[] {
  const groups = new Map<string, { matched: boolean; members: VendorInput[] }>();
  for (const a of apps) {
    const c = canonicalVendor(a.vendorName, catalogue);
    if (!c) continue;
    const g = groups.get(c.vendor) ?? { matched: c.matched, members: [] };
    g.members.push(a);
    groups.set(c.vendor, g);
  }
  return [...groups.entries()].map(([vendor, g]) => {
    const n = g.members.length;
    const categories = [...new Set(g.members.map((m) => m.infraCategory).filter((c): c is string => !!c && c !== 'UNKNOWN'))].sort();
    let score = n >= 5 ? 30 : n >= 3 ? 15 : n === 2 ? 5 : 0;
    if (categories.length > 1) score += 15;
    if (g.members.some((m) => ['Migrate', 'Migrate-Critical', 'Eliminate'].includes(m.time))) score += 10;
    if (g.members.some((m) => m.eolSignal === 'BLOCKED')) score += 10;
    const time_summary: Record<string, number> = {};
    for (const m of g.members) time_summary[TIME_LETTER[m.time]] = (time_summary[TIME_LETTER[m.time]] ?? 0) + 1;
    return {
      vendor,
      matched: g.matched,
      app_count: n,
      apps: g.members.map((m) => m.id).sort(),
      categories,
      time_summary,
      opportunity_score: Math.min(100, score),
      opportunity_tier: (score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW') as VendorGroup['opportunity_tier'],
    };
  }).sort((x, y) => y.opportunity_score - x.opportunity_score || y.app_count - x.app_count || x.vendor.localeCompare(y.vendor));
}
